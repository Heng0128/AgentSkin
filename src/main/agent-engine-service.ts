// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { requireAdapter } from '../adapters/registry';
import { toMessage } from '../shared/errors';
import {
  AGENT_IDS,
  AGENT_META,
  type AgentId,
  type ApplyRequest,
  type ApplyResponse,
  type Platform,
  type SystemStatus,
  type WallpaperRenderOptions,
} from '../shared/types';
import {
  ensureCdpReady,
  hardeningPass,
  hardeningRemove,
  inferRestartReason,
  injectAgentWallpaperFromApply,
  injectSecondaryTargets,
  probeAppStatus,
  reconcileZombiePorts,
  removeAgentVideoWallpaper,
  removeSecondaryTargets,
  resolveLivePort,
  restoreOriginalScheme,
  syncSchemeWithStability,
  tryEngineInjection,
  type WithPageSessionDeps,
  withPageSession,
} from './agent-engine/delegates';
import type { SchemeSnapshot } from './agent-scheme';
import type { DiscoveryDeps } from './app-discovery';
import type { CdpFanoutDeps } from './cdp/cdp-fanout';
import {
  cleanupEngineInjectionForAgent,
  disposeEngineInjectionState,
} from './cdp/injection/engine-strategy';
import { EpochManager } from './epoch-manager';
import { appendLogLine, writeJsonAtomic } from './fs-utils';
import { resolveEngineDirDefault } from './palette-builder';
import type { SchemeSyncDeps } from './scheme-sync';
import type {
  AgentEngineServiceApi,
  LoggerApi,
  SettingsServiceApi,
  StructuredLogEvent,
  ThemeLibraryApi,
  WallpaperResolver,
} from './services/contracts';
import { disposeThemeAssetCache } from './theme/utils';
import { type ApplyFlowDeps, applyThemeFlow as applyThemeFlowImpl } from './theme-apply-flow';
import { type ThemeEntry, toInstalledTheme } from './theme-library';
import {
  type RestoreFlowDeps,
  restoreThemeFlow as restoreThemeFlowImpl,
} from './theme-restore-flow';
import {
  cleanupWallpaperStateForAgent,
  disposeWallpaperInjectionState,
} from './wallpaper/injection-state';
import {
  applyAgentWallpaperNow as applyAgentWallpaperNowImpl,
  applyWallpaperToAgent as applyWallpaperToAgentImpl,
  getCapturedTokensSize,
  getDeferredSelfHealsSize,
  removeWallpaperFromAgent as removeWallpaperFromAgentImpl,
  type WallpaperInjectorDeps,
} from './wallpaper-injector';
import {
  cleanupSelfHealForAgent,
  disposeSelfHealState,
  getSelfHealingAgentsSize,
} from './wallpaper-self-heal';

/**
 * Canonical product display names for each AgentId, derived from AGENT_META
 * (the single source of truth in shared/types). The UI never leaks internal
 * names like "TRAE", "Qoder", etc.
 */
const PRODUCT_DISPLAY_NAMES: Readonly<Record<AgentId, string>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(AGENT_META) as [AgentId, { displayName: string }][]).map(([id, meta]) => [
      id,
      meta.displayName,
    ]),
  ) as Record<AgentId, string>,
);

interface PersistedState {
  version: 2;
  apps: Partial<
    Record<
      AgentId,
      {
        activeThemeId: string | null;
        /**
         * Color-scheme id of the active theme (v2.2+). 'default' (or absent)
         * means the theme's own manifest colors; other values are alternative
         * schemes applied via `ApplyRequest.schemeId`.
         */
        activeSchemeId?: string | null;
        port: number | null;
        /**
         * The agent's light/dark scheme state captured before AgentSkin first
         * switched it to match a theme. Restored when the theme is removed.
         */
        schemeSnapshot?: SchemeSnapshot | null;
        /**
         * Auto-detected install directory for this agent (cached from the
         * first successful `detectInstallation`). Lets status() skip the
         * full filesystem + registry scan on later polls — the path is
         * verified cheaply on each use and refreshed when it goes stale.
         * `null` means "auto-detection has not run yet for this agent".
         */
        detectedPath?: string | null;
      }
    >
  >;
}

/**
 * Narrow `unknown` (from JSON.parse) to PersistedState without unsafe casts.
 * Checks the minimal structural contract: version === 2, apps is a plain object.
 * Field-level types are enforced by the TypeScript interface at compile time;
 * the guard ensures the parse result matches the shape before assignment.
 *
 * R6-24: 增加 apps entry 字段级检查。原实现 `isPersistedState` 只做浅层检查
 * （只验证 apps 是对象），不验证 apps 内部结构。损坏数据（如 port 为字符串）
 * 会进入运行态导致后续逻辑出错。
 */
function isPersistedState(x: unknown): x is PersistedState {
  if (!x || typeof x !== 'object') return false;
  const rec = x as Record<string, unknown>;
  if (rec.version !== 2) return false;
  if (!rec.apps || typeof rec.apps !== 'object' || Array.isArray(rec.apps)) return false;
  // R6-24: 逐条验证 apps 内部结构。
  for (const [appId, entry] of Object.entries(rec.apps)) {
    // appId 必须是合法 AgentId
    if (!(AGENT_IDS as readonly string[]).includes(appId)) return false;
    // entry 可以为 null 或对象
    if (entry == null) continue;
    if (typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    // activeThemeId: string | null | undefined
    if (e.activeThemeId != null && typeof e.activeThemeId !== 'string') return false;
    // activeSchemeId: string | null | undefined
    if (e.activeSchemeId != null && typeof e.activeSchemeId !== 'string') return false;
    // port: number | null | undefined
    if (e.port != null && typeof e.port !== 'number') return false;
    // schemeSnapshot: object | null | undefined
    if (e.schemeSnapshot != null && typeof e.schemeSnapshot !== 'object') return false;
    // schemeSnapshot 为对象时验证其必要字段
    if (e.schemeSnapshot && typeof e.schemeSnapshot === 'object') {
      const ss = e.schemeSnapshot as Record<string, unknown>;
      if (ss.mode != null && typeof ss.mode !== 'string') return false;
    }
    // detectedPath: string | null | undefined
    if (e.detectedPath != null && typeof e.detectedPath !== 'string') return false;
  }
  return true;
}

function platform(): Platform {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? process.platform
    : 'unsupported';
}

/**
 * Concurrency-subsystem runtime metrics. Each field is a snapshot of the
 * underlying Map/Set size (or derived depth) at collection time.
 * Pushed to the renderer every 5s via the
 * `diagnostics:concurrency-metrics` IPC channel so the Diagnostics tab can
 * visualise apply/restore pressure, self-heal activity, and persist-queue
 * health in real time.
 */
export interface ConcurrencyMetrics {
  companionBusyByAgent: number;
  inflightOperations: number;
  selfHealingAgents: number;
  capturedTokens: number;
  persistChainDepth: number;
  deferredSelfHeals: number;
  switchEpochByAgent: number;
}

/**
 * Merge two render option sets with a per-field precedence: `base` supplies
 * defaults, `override` wins on any field it sets. Used to resolve the
 * per-agent → global → theme render chain so a partially-configured
 * per-agent setting does not wipe the global default.
 */
function mergeRenderOptions(
  base: WallpaperRenderOptions | undefined,
  override: WallpaperRenderOptions | undefined,
): WallpaperRenderOptions | undefined {
  if (!override) return base;
  if (!base) return override;
  return { ...base, ...override };
}

/**
 * Fold a theme wallpaper's top-level `speed/loop/scrimOpacity` (legacy fields)
 * into its `render` options. The CDP injector only reads `render` — without
 * this fold, a theme that sets `speed: 2` (but no `render.speed`) would play
 * at 1×. Returns undefined when the wallpaper sets nothing.
 */
function themeRenderOptions(wp: {
  render?: WallpaperRenderOptions;
  speed?: number;
  loop?: boolean;
  scrimOpacity?: number;
}): WallpaperRenderOptions | undefined {
  if (
    !wp.render &&
    wp.speed === undefined &&
    wp.loop === undefined &&
    wp.scrimOpacity === undefined
  ) {
    return undefined;
  }
  return {
    ...(wp.render ?? {}),
    ...(wp.speed !== undefined ? { speed: wp.speed } : {}),
    ...(wp.loop !== undefined ? { loop: wp.loop } : {}),
    ...(wp.scrimOpacity !== undefined ? { scrimOpacity: wp.scrimOpacity } : {}),
  };
}

/**
 * AgentSkin's control-layer orchestrator (now a thin facade after the
 * P1-2..P1-5 god-object teardown).
 *
 * The service is intentionally agnostic of specific applications — it does
 * not switch on app ids or know how any single app is detected or skinned.
 * All per-app knowledge lives in the adapter (from the registry), which in
 * turn delegates to the legacy core runtime.
 *
 * Call chain:
 *   UI -> IPC -> this service -> registry.getAdapter() -> ApplicationAdapter -> runtime -> @agentskin/engine
 *
 * The service owns only cross-cutting concerns that do not fit a single
 * extracted module:
 *   - State persistence (which theme is active per app, scheme snapshots)
 *   - Epoch management (`applyEpoch` / `applyingTheme`) — the cross-cutting
 *     cancellation guard that spans ALL extracted modules' background tasks.
 *   - Logging (`log` / `logStructured`) — shared by every deps slice.
 *   - The `apply` / `restore` flow itself — the top-level orchestration that
 *     sequences the extracted modules in the right order.
 *
 * Everything else has been peeled off into cohesive modules, each owning a
 * single concern with a thin `*Deps` interface injected by this facade:
 *   - {@link ./app-discovery}      — port discovery, CDP-ready, status probe, restart-reason inference
 *   - {@link ./palette-builder}    — engine palette CSS + multi-layer engine injection
 *   - {@link ./scheme-sync}        — light/dark scheme capture / apply / restore + stability window
 *   - {@link ./wallpaper-injector} — video / image wallpaper CDP injection + UI entry points
 *   - {@link ./cdp-fanout}         — multi-target CDP fan-out (hardening + secondary targets)
 *   - {@link ./agent-engine/delegates} — delegation wrappers for the above + `withPageSession`
 */

export class AgentEngineService implements AgentEngineServiceApi {
  private state: PersistedState = { version: 2, apps: {} };
  private logListener: ((line: string) => void) | null = null;
  /**
   * Apps currently undergoing a user-initiated applyTheme. Used to prevent
   * concurrent apply/restore from racing each other on the same CDP target.
   *
   * P1 audit #6: previously this Set was only ever `add`ed to and `delete`d
   * from — the `has()` check at the entry of {@link apply} / {@link restore}
   * was missing, so rapid double-clicks or tray bursts could start two
   * applies on the same agent simultaneously, racing each other on the same
   * CDP target (CSS layering corruption, duplicate persistence scripts).
   * The `has()` check is now enforced, and the in-flight Promise Maps below
   * go one step further: a concurrent call awaits the in-flight operation
   * instead of being rejected, so the user's second click still gets a
   * correct result instead of a stale snapshot.
   */
  private readonly applyingTheme = new Set<AgentId>();
  /**
   * Set to true during dispose() to short-circuit any inflight callbacks
   * (especially fire-and-forget self-heal thunks) that try to operate on
   * already-disposed CDP sessions / media tokens.
   */
  private disposed = false;

  /**
   * Unified in-flight operations per agent. Replaces the previous pair of
   * separate maps (inflightApply / inflightRestore) so apply↔restore races
   * are globally ordered:
   *   - Same kind (apply during apply, restore during restore) → deduplicate
   *     by sharing the Promise, preserving the previous behaviour.
   *   - Opposite kind (restore issued mid-apply or vice-versa) → queue
   *     BEHIND the currently running operation. This avoids the previous
   *     race where restoreThemeFlow's isApplyingTheme check would silently
   *     skip the user's restore click if the apply was still inside its
   *     lock window, and avoids the indeterminate end-state when both
   *     operations overlap on the CDP target (each writing + erasing the
   *     same CSS layers).
   *
   * The epoch manager handles cancellation of the previous op's *background*
   * follow-ups (hardening, scheme-sync stability window, secondary inject) —
   * this queue only serialises the top-level apply/restore orchestration so
   * the user-visible result of "what's the state of this agent after my
   * click" is deterministic regardless of event-loop timing.
   *
   * P0-CONCURRENCY-FIX: each entry now carries a `cleanup` promise that only
   * settles after ALL background follow-ups (hardening, wallpaper, scheme
   * sync) have completed.  The old code deleted the entry in apply's `finally`
   * immediately after `applyTheme` returned, while the .then() chains for
   * hardening→wallpaper and scheme-sync were still fire-and-forget in the
   * background.  This allowed a concurrent `restore` to acquire the lock and
   * run in parallel with those still-flying self-heal/wallpaper tasks,
   * producing CDP target corruption.  Now:
   *   - `promise` resolves/rejects when the user-visible result is ready;
   *     this is what the caller receives and same-kind deduplication shares.
   *   - `cleanup` resolves after promise settles AND all background tasks
   *     have settled; the inflight entry is deleted only when cleanup
   *     resolves, preventing opposite-kind ops from racing background work.
   */
  private readonly inflightOperations = new Map<
    AgentId,
    {
      kind: 'apply' | 'restore';
      promise: Promise<unknown>;
      cleanup: Promise<void>;
    }
  >();

  /**
   * Serialisation chain for all persistence writes.
   *
   * Every `persist()` call is routed through `persistSafe()`, which appends
   * to this chain. This guarantees that `writeJsonAtomic` operations never
   * overlap — even when `reconcileZombiePorts` (fire-and-forget from
   * `initialize()`) and `reconcileActiveThemes` run concurrently during
   * the boot phase, their serialised writes cannot overwrite each other's
   * mutations (e.g. zombie clearing ports vs. theme reconciler clearing
   * activeThemeId). Without this, the tmp+rename pattern in writeJsonAtomic
   * would allow the later-started write to clobber the earlier one.
   *
   * `persistSafe` appends `result.catch(() => {})` so a single failed write
   * does not break the chain (following writes would stall forever on a
   * rejected promise).
   */
  private persistChain: Promise<void> = Promise.resolve();
  /**
   * Tracks the number of writes currently queued or in-flight on
   * {@link persistChain}. Incremented in `persistSafe()` before the write
   * is appended, decremented when the write settles (resolution OR rejection).
   * Exposed as `persistChainDepth` in the concurrency metrics so operators
   * can detect a persist backlog before it becomes a data-loss risk.
   */
  private persistChainPending = 0;

  /**
   * Monotonic epoch per agent — bumped at the start of every apply / restore
   * / reapply. Background tasks (hardening, scheme-sync, secondary-inject,
   * secondary-remove, scheme-restore) capture the epoch when they start and
   * abort early if it changes, so a stale background task from a previous
   * operation can never race the next operation's CDP target manipulation.
   *
   * This covers the gap left by `applyingTheme`: the lock only guards
   * `adapter.applyTheme` / `adapter.restoreTheme`, but the real theme
   * lifecycle includes non-blocking follow-ups (secondary inject, hardening,
   * scheme stability window up to 10s) that keep touching the CDP target
   * after the lock is released. Epoch cancellation makes those follow-ups
   * self-terminate the moment a newer operation supersedes them.
   */
  private readonly epochs = new EpochManager();

  // -------------------------------------------------------------------------
  // Concurrency-metrics broadcast state
  // -------------------------------------------------------------------------
  //
  // Two concurrency primitives live on the renderer side (wallpaperStore's
  // `companionBusyByAgent` and environmentStore's `switchEpochByAgent`).
  // The main process cannot read them directly, so the renderer pushes their
  // sizes back to us via the `updateConcurrencyMetricsFromRenderer` method.
  // Those cached values are then included in the periodic broadcast.
  //
  // All other metrics are collected from main-process module state at
  // broadcast time.

  /** Cached size of wallpaperStore's `companionBusyByAgent` Set (renderer-side). */
  private cachedCompanionBusySize = 0;
  /** Cached size of environmentStore's `switchEpochByAgent` Map (renderer-side). */
  private cachedSwitchEpochSize = 0;
  /** Handle for the 5-second metrics broadcast interval (null when stopped). */
  private concurrencyMetricsTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Callback used to deliver the metrics payload to the renderer. Injected at
   * start time so the service does not depend on main-context's `ctx` singleton
   * (avoids a circular import and keeps the service testable).
   */
  private sendMetricsToRenderer: ((metrics: ConcurrencyMetrics) => void) | null = null;

  constructor(
    private readonly library: ThemeLibraryApi,
    private readonly stateFile: string,
    private readonly settings: SettingsServiceApi,
  ) {
    // Detection report lives next to the persisted state, under userData/logs.
    this.detectionLogFile = path.join(path.dirname(stateFile), 'logs', 'agent-detection.log');
    this.engineLogFile = path.join(path.dirname(stateFile), 'logs', 'agent-engine.log');
  }

  /** Absolute path of the human-readable agent detection report. */
  private readonly detectionLogFile: string;
  /** Absolute path of the engine log (apply/reapply/reconcile diagnostics). */
  private readonly engineLogFile: string;

  setLogListener(listener: (line: string) => void): void {
    this.logListener = listener;
  }

  /** Wallpaper service reference for resolving theme video/image paths. */
  private wallpaperService: WallpaperResolver | null = null;
  setWallpaperService(svc: WallpaperResolver): void {
    this.wallpaperService = svc;
  }

  /**
   * Resolve the effective wallpaper id for an agent. Priority:
   * 1. Per-agent wallpaper setting (settings.agentWallpaper) when enabled
   * 2. Active theme's bundled wallpaper (theme.wallpaper.workshopId or video)
   * 3. null (no wallpaper)
   *
   * When `entry` is provided (e.g. during an active apply flow), the theme's
   * bundled wallpaper is read from it directly; otherwise the method looks up
   * the agent's persisted active theme from the library.
   */
  private async resolveAgentWallpaperId(
    appId: AgentId,
    entry?: ThemeEntry,
  ): Promise<{
    id: string | null;
    render?: WallpaperRenderOptions;
  }> {
    // When actively applying a theme (entry provided), the theme is the SOLE
    // authority on wallpaper: theme has wallpaper → use it; theme has no
    // wallpaper → return null (removes any previously injected wallpaper).
    // "Last applied wins" — no fallback to stale per-agent settings. The
    // theme's own render setting (wp.render) is used, but per-agent settings
    // are NOT consulted during an explicit apply.
    if (entry) {
      const installed = toInstalledTheme(entry);
      const wp = installed.wallpaper;
      if (wp) {
        const themeId = installed.id;
        // All playback settings ride in `render` (single source of truth —
        // the CDP injector reads only render). Top-level speed/loop/scrimOpacity
        // are folded in via themeRenderOptions so legacy themes still apply.
        if (wp.workshopId)
          return {
            id: wp.workshopId,
            render: themeRenderOptions(wp),
          };
        if (wp.video)
          return {
            id: `theme:${themeId}`,
            render: themeRenderOptions(wp),
          };
      }
      // Theme has no wallpaper → clear whatever was there before.
      return { id: null };
    }

    // Not applying a theme (restart/reconnect) — resolve with the full
    // per-agent → global → theme precedence so the restored wallpaper renders
    // exactly as configured.
    const agentWp = this.settings.agentWallpaper(appId);
    const globalWp = this.settings.wallpaper();
    if (agentWp.enabled && agentWp.id) {
      return {
        id: agentWp.id,
        // per-agent render wins; fall back to the global default for the
        // fields the per-agent setting does not override.
        render: mergeRenderOptions(globalWp.render, agentWp.render),
      };
    }

    // No per-agent setting — look up the persisted active theme's wallpaper.
    const themeId = this.state.apps[appId]?.activeThemeId;
    if (!themeId) return { id: null };
    try {
      const found = await this.library.find(themeId);
      const installed = toInstalledTheme(found);
      const wp = installed.wallpaper;
      if (!wp) return { id: null };
      if (wp.workshopId)
        return {
          id: wp.workshopId,
          // global default → theme render (theme is the base when there is no
          // per-agent override). Top-level speed/loop/scrimOpacity folded in.
          render: mergeRenderOptions(globalWp.render, themeRenderOptions(wp)),
        };
      if (wp.video)
        return {
          id: `theme:${themeId}`,
          render: mergeRenderOptions(globalWp.render, themeRenderOptions(wp)),
        };
    } catch {
      return { id: null };
    }
    return { id: null };
  }

  private log(line: string): void {
    this.logListener?.(line);
    // Also append to the engine log file so failures are diagnosable even
    // when the UI is not open or the user closed the log panel.
    const ts = new Date().toISOString();
    void appendLogLine(this.engineLogFile, `[${ts}] ${line}\n`);
  }

  /**
   * Emit a structured log entry that useEnvironments can parse reliably
   * regardless of UI locale.  The renderer splits on the first "|" and
   * parses the JSON payload; human-readable log lines remain unaffected.
   *
   * Event taxonomy (covers the full boot/apply/restore lifecycle so the UI
   * can show real-time progress instead of a single spinner):
   *
   *   Boot phase (no prior apply):
   *     boot_start            — boot restore started (carries agentCount)
   *     boot_agent_start      — beginning to restore one agent
   *     cdp_resolving         — looking up live CDP port
   *     cdp_killing           — killing old PIDs before relaunch
   *     cdp_spawning          — spawned the app with --remote-debugging-port=0
   *     cdp_ready             — CDP port is live
   *     cdp_timeout           — gave up waiting for CDP
   *     cdp_spawn_failed      — spawn failed (reason: not-installed / spawn-error / singleton-lock)
   *     inject_start          — beginning theme injection
   *     inject_done           — injection succeeded
   *     inject_failed         — injection failed (reason)
   *     scheme_sync           — scheme sync phase (phase: start|stable|drifted|done)
   *     boot_agent_done       — one agent finished restore
   *     boot_agent_failed     — one agent failed to restore
   *     boot_done             — boot restore completed for all agents
   *
   *   User-initiated apply/restore:
   *     theme_apply           — apply succeeded
   *     theme_restore         — restore succeeded
   *     apply_failed          — apply failed (reason)
   *     restore_failed        — restore failed (reason)
   *
   * `progress` is 0..100 for the current agent's phase; the UI aggregates
   * per-agent progress into an overall boot bar.
   *
   * The event shape is the shared {@link StructuredLogEvent} contract from
   * `services/contracts.ts`; this method is the canonical implementer of
   * {@link LoggerApi.logStructured}.
   */
  private logStructured(event: StructuredLogEvent): void {
    this.log(`[STRUCTURED]|${JSON.stringify(event)}`);
  }

  /**
   * Expose the logger as a {@link LoggerApi} so consumers (boot sequence,
   * future services, tests) can depend on the interface rather than the
   * concrete class. Returns bound methods so the resulting object can be
   * passed around without `this` rebinding concerns.
   */
  asLogger(): LoggerApi {
    return {
      log: (line: string) => this.log(line),
      logStructured: (event: StructuredLogEvent) => this.logStructured(event),
    };
  }

  async initialize(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (isPersistedState(parsed)) {
        this.state = parsed;
      }
    } catch {
      // Fresh install or legacy state - defaults apply.
    }
    // Clean up zombie ports in the background — this only touches persisted
    // state (clearing dead ports), and status() independently re-probes all
    // ports on every call, so blocking startup for the cleanup is unnecessary.
    // The probePortLive timeout (1.5s per agent) previously caused multi-
    // second startup delays when all agents' persisted ports were dead.
    void reconcileZombiePorts(AGENT_IDS, this.discoveryDeps()).catch((error) => {
      this.log(`[state] zombie port reconciliation failed: ${toMessage(error)}`);
    });

    // NOTE: Boot-time auto-restore was removed. AgentSkin no longer
    // auto-launches agents or auto-injects themes on startup — that behavior
    // killed user workflows by force-restarting apps the user was actively
    // using. Themes are now applied ONLY when the user explicitly clicks
    // "Apply". The persisted activeThemeId is preserved so the UI shows
    // "themed" state and the user can re-apply with one click.
  }

  /**
   * Build the {@link DiscoveryDeps} slice that backs all calls into
   * `app-discovery`. Defined once so every delegating method shares the
   * same plumbing (adapter factory, settings access, state accessors,
   * logger, structured logger, persist callback).
   *
   * `activeThemeId` is intentionally preserved by `reconcileZombiePorts`
   * (via `clearAppPort`): the user chose to apply a theme, and a port going
   * dead does not mean they un-chose it. The UI shows "themed" state and the
   * user can re-apply with one click when the agent is running again.
   */
  private discoveryDeps(): DiscoveryDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      settings: {
        appPathFor: (appId) => this.settings.overridesFor(appId).appPath ?? null,
        portOverrideFor: (appId) => this.settings.overridesFor(appId).port ?? null,
      },
      log: (line) => this.log(line),
      logStructured: (event) => this.logStructured(event),
      detectionLogFile: this.detectionLogFile,
      displayName: (appId) => PRODUCT_DISPLAY_NAMES[appId],
      getAppPort: (appId) => this.state.apps[appId] ?? null,
      clearAppPort: (appId) => {
        const s = this.state.apps[appId];
        if (s) s.port = null;
      },
      getDetectedPath: (appId) => this.state.apps[appId]?.detectedPath ?? null,
      setDetectedPath: (appId, path) => {
        const s = this.state.apps[appId];
        if (s) s.detectedPath = path;
      },
      persist: () => this.persistSafe(() => this.persist()),
      activeThemeId: (appId) => this.activeThemeId(appId),
      activeSchemeId: (appId) => this.activeSchemeId(appId),
    };
  }

  /**
   * Build the {@link SchemeSyncDeps} slice that backs all calls into
   * `scheme-sync`. Defined once so {@link syncSchemeWithStability} and
   * {@link restoreOriginalScheme} share the same plumbing (page-session
   * helper, scheme-snapshot accessors, epoch guard, port re-resolver,
   * logger, structured logger, persist callback).
   *
   * `withPageSession` is wired through because it owns the retry-on-launch
   * logic — a freshly (re)launched app's renderer is not ready yet and the
   * scheme sync would otherwise throw "no reachable page target" on the
   * first attempt.
   */
  private schemeSyncDeps(): SchemeSyncDeps {
    const withPageSessionDeps: WithPageSessionDeps = {
      adapter: (appId) => this.adapter(appId),
      resolveLivePort: (appId, knownDeadPort) =>
        resolveLivePort(appId, this.discoveryDeps(), knownDeadPort ?? null),
    };
    return {
      withPageSession: (appId, port, fn, retries) =>
        withPageSession(appId, port, fn, retries ?? 8, withPageSessionDeps),
      getSchemeSnapshot: (appId) => this.state.apps[appId]?.schemeSnapshot ?? null,
      setSchemeSnapshot: (appId, snapshot) => {
        const s = this.state.apps[appId];
        if (s) s.schemeSnapshot = snapshot;
      },
      persist: () => this.persistSafe(() => this.persist()),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      log: (line) => this.log(line),
      logStructured: (event) => this.logStructured(event),
    };
  }

  /**
   * Build the {@link WallpaperInjectorDeps} slice that backs all calls
   * into `wallpaper-injector`. Defined once so the apply/restore flows
   * and the three UI entry points share the same plumbing (wallpaper
   * service, epoch guard / bumper, wallpaper-id resolver, CDP-ready
   * orchestrator, settings persistence, logger).
   *
   * `resolveAgentWallpaperId` is wired through because it owns the
   * priority resolution (per-agent setting → theme-bundled wallpaper)
   * and reads from `settings` + `library` + persisted `activeThemeId`.
   */
  private wallpaperDeps(): WallpaperInjectorDeps {
    return {
      wallpaperService: this.wallpaperService,
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      bumpEpoch: (appId) => this.epochs.bumpEpoch(appId),
      resolveAgentWallpaperId: (appId, entry) => this.resolveAgentWallpaperId(appId, entry),
      ensureCdpReady: (appId, timeoutMs) =>
        ensureCdpReady(appId, this.discoveryDeps(), timeoutMs ?? 30000),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      inferRestartReason: (appId, cdpFailureReason) =>
        inferRestartReason(appId, this.discoveryDeps(), cdpFailureReason ?? null),
      findAgentTargets: (appId, port) => this.adapter(appId).findTargets(port, 1200),
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      // Shared concurrency-lock check with apply/restore flows. Lets the
      // self-heal deferred-queue serialise with in-flight operations instead
      // of racing them — see wallpaper-self-heal.ts v2 callback contract.
      isApplyingTheme: (appId) => this.applyingTheme.has(appId),
      isDisposed: () => this.disposed,
      log: (line) => this.log(line),
    };
  }

  /**
   * Build the {@link CdpFanoutDeps} slice that backs all calls into
   * `cdp-fanout`. Defined once so the apply/restore flows share the same
   * plumbing (adapter factory, epoch guard, engine-injection callback,
   * logger).
   *
   * `tryEngineInjection` is wired through as a callback so the fanout
   * module stays free of engine-dir resolution concerns — this facade
   * owns the `EngineInjectionDeps` construction.
   */
  private fanoutDeps(): CdpFanoutDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      tryEngineInjection: (session, appId, bundle, targetTheme, heroDataUrl) =>
        tryEngineInjection(session, appId, bundle, targetTheme, heroDataUrl, {
          resolveEngineDir: resolveEngineDirDefault,
          log: (line) => this.log(line),
          customThemeCss: () => this.settings.customThemeCss(),
        }),
      log: (line) => this.log(line),
    };
  }

  /**
   * Build the {@link RestoreFlowDeps} slice that backs the restore flow.
   * Defined once so the restore orchestration shares the same plumbing
   * (adapter factory, concurrency lock, epoch guard, state accessors,
   * CDP fan-out, wallpaper injection, scheme sync, logger) as the other
   * extracted modules.
   */
  private restoreFlowDeps(): RestoreFlowDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isApplyingTheme: (appId) => this.applyingTheme.has(appId),
      lockAgent: (appId) => this.applyingTheme.add(appId),
      unlockAgent: (appId) => this.applyingTheme.delete(appId),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      bumpEpoch: (appId) => this.epochs.bumpEpoch(appId),
      getSchemeSnapshot: (appId) => this.state.apps[appId]?.schemeSnapshot ?? null,
      clearActiveTheme: (appId, port) => {
        this.state.apps[appId] = {
          activeThemeId: null,
          activeSchemeId: null,
          port,
          schemeSnapshot: null,
        };
      },
      persist: () => this.persistSafe(() => this.persist()),
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      hardeningRemove: (appId, port, epoch) =>
        hardeningRemove(appId, port, epoch, this.fanoutDeps()),
      removeSecondaryTargets: (appId, port, epoch) =>
        removeSecondaryTargets(appId, port, epoch, this.fanoutDeps()),
      removeAgentVideoWallpaper: (appId, port, epoch) =>
        removeAgentVideoWallpaper(appId, port, epoch, this.wallpaperDeps()),
      restoreOriginalScheme: (appId, port, snapshot, epoch) =>
        restoreOriginalScheme(appId, port, snapshot, epoch, this.schemeSyncDeps()),
      cleanupModuleStateForAgent: (appId) => {
        // Order: CDP-layer ids first, then wallpaper (media tokens must be
        // unregistered in the server), then self-heal counters. Theme cover/
        // icon cache is per-theme-id, not per-agent, so it is cleaned up via
        // the theme-uninstall path instead of the restore path.
        cleanupEngineInjectionForAgent(appId);
        cleanupWallpaperStateForAgent(appId);
        cleanupSelfHealForAgent(appId);
      },
      status: () => this.status(),
      log: (line) => this.log(line),
      logStructured: (event) => this.logStructured(event),
    };
  }

  /**
   * Build the {@link ApplyFlowDeps} slice that backs the apply flow.
   * Defined once so the apply orchestration shares the same plumbing
   * (adapter factory, concurrency lock, epoch guard, CDP discovery,
   * theme library, state accessors, CDP fan-out, wallpaper injection,
   * scheme sync, logger, display-name resolver) as the other extracted
   * modules.
   */
  private applyFlowDeps(): ApplyFlowDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isApplyingTheme: (appId) => this.applyingTheme.has(appId),
      lockAgent: (appId) => this.applyingTheme.add(appId),
      unlockAgent: (appId) => this.applyingTheme.delete(appId),
      ensureCdpReady: (appId, timeoutMs) =>
        ensureCdpReady(appId, this.discoveryDeps(), timeoutMs ?? 30000),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      inferRestartReason: (appId, cdpFailureReason) =>
        inferRestartReason(appId, this.discoveryDeps(), cdpFailureReason ?? null),
      findTheme: (themeId) => this.library.find(themeId),
      bumpEpoch: (appId) => this.epochs.bumpEpoch(appId),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      setActiveTheme: (appId, themeId, port, schemeId) => {
        this.state.apps[appId] = {
          activeThemeId: themeId,
          activeSchemeId: schemeId ?? null,
          port,
          schemeSnapshot: this.state.apps[appId]?.schemeSnapshot ?? null,
        };
      },
      persist: () => this.persistSafe(() => this.persist()),
      getAppPath: (appId) => this.settings.overridesFor(appId).appPath,
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      injectSecondaryTargets: (appId, port, bundle, epoch) =>
        injectSecondaryTargets(appId, port, bundle, epoch, this.fanoutDeps()),
      hardeningPass: (appId, port, bundle, epoch) =>
        hardeningPass(appId, port, bundle, epoch, this.fanoutDeps()),
      injectAgentWallpaperFromApply: (appId, port, entry, epoch) =>
        injectAgentWallpaperFromApply(appId, port, entry, epoch, this.wallpaperDeps()),
      syncSchemeWithStability: (appId, port, mode, epoch) =>
        syncSchemeWithStability(appId, port, mode, epoch, this.schemeSyncDeps()),
      status: () => this.status(),
      displayName: (appId) => PRODUCT_DISPLAY_NAMES[appId],
      log: (line) => this.log(line),
      logStructured: (event) => this.logStructured(event),
    };
  }

  /**
   * Drop persisted active-theme references that no longer exist in the
   * library — e.g. built-in themes pruned from the bundle after an upgrade.
   * Called once at boot after seeding/pruning so status and UI never point
   * at a missing package.
   */
  async reconcileActiveThemes(availableIds: Set<string>): Promise<void> {
    let dirty = false;
    for (const [appId, appState] of Object.entries(this.state.apps)) {
      if (appState?.activeThemeId && !availableIds.has(appState.activeThemeId)) {
        this.log(
          `[state] ${appId}: dropping reference to removed theme "${appState.activeThemeId}"`,
        );
        appState.activeThemeId = null;
        appState.activeSchemeId = null;
        dirty = true;
        continue;
      }
      // When a scheme variant is active, the persisted base id must resolve to
      // an installed bundle; if the base is present but the specific scheme
      // variant was removed, fall back to the base theme (default colors).
      if (
        appState?.activeSchemeId &&
        !availableIds.has(`${appState.activeThemeId}--${appState.activeSchemeId}`)
      ) {
        this.log(
          `[state] ${appId}: scheme "${appState.activeSchemeId}" of "${appState.activeThemeId}" no longer available, falling back to default`,
        );
        appState.activeSchemeId = null;
        dirty = true;
      }
    }
    if (dirty) await this.persistSafe(() => this.persist());
  }

  /**
   * Serialise a persistence write onto {@link persistChain}.
   *
   * Every write operation (whether fire-and-forget from deps callbacks or
   * awaited from `reconcileActiveThemes`) passes through here. The chain
   * guarantees FIFO ordering and mutual exclusion for the underlying
   * `writeJsonAtomic` call.
   *
   * @returns A promise that settles when THIS write completes (not just
   * when it is queued). The returned promise rejects if the update throws,
   * but the chain itself always continues (see `persistChain` field).
   */
  private persistSafe(update: () => Promise<void> | void): Promise<void> {
    this.persistChainPending++;
    const result = this.persistChain.then(() => update());
    // Swallow rejection so a single failed write does not poison the chain.
    this.persistChain = result.catch(() => {});
    // Decrement the pending counter when this write settles (success OR failure).
    void result.finally(() => {
      this.persistChainPending = Math.max(0, this.persistChainPending - 1);
    });
    return result;
  }

  private async persist(): Promise<void> {
    // R6-4: persist() 被 fire-and-forget 调用（如 () => this.persist()），
    // 写盘失败时异常会被静默丢弃，用户以为保存成功但状态未持久化。
    // 在内部 wrap try/catch + log 确保失败可观测。
    try {
      await writeJsonAtomic(this.stateFile, this.state);
    } catch (error) {
      this.log(`[state] persist failed: ${toMessage(error)}`);
    }
  }

  /**
   * Look up the adapter for an app id via the registry. Throws if no adapter
   * is registered - the service never constructs adapters or falls back to a
   * hardcoded default.
   */
  private adapter(appId: AgentId): ApplicationAdapter {
    return requireAdapter(appId);
  }

  /**
   * The user's explicit port override for this app, or null if none.
   *
   * AgentSkin no longer falls back to the core adapter's `defaultPort`
   * (9336/9337/9338) because those are stale assumptions: WorkBuddy 5.3.x
   * binds a random port, QoderWork forces port=0, and TRAE SOLO only opens
   * CDP when explicitly launched with --remote-debugging-port. Returning null
   * here forces all CDP discovery through the dynamic resolveLivePort path
   * (DevToolsActivePort + PID/netstat probing) instead of trusting a hardcoded
   * number that may point at a zombie socket.
   */
  portFor(appId: AgentId): number | null {
    return this.settings.overridesFor(appId).port ?? this.state.apps[appId]?.port ?? null;
  }

  activeThemeId(appId: AgentId): string | null {
    return this.state.apps[appId]?.activeThemeId ?? null;
  }

  /** Active color-scheme id for an agent (null/undefined = default colors). */
  activeSchemeId(appId: AgentId): string | null {
    return this.state.apps[appId]?.activeSchemeId ?? null;
  }

  /**
   * Cached status result with a TTL (ms). The UI typically polls status
   * every few seconds; without caching, each poll triggers a full CDP
   * discovery cycle (DevToolsActivePort file reads + PID/netstat probing)
   * for ALL agents simultaneously. A 2-second TTL collapses repeated
   * polls within that window into a single probe burst.
   */
  private statusCache: SystemStatus | null = null;
  private statusCacheAt = 0;
  private static readonly STATUS_CACHE_TTL = 2000;

  async status(): Promise<SystemStatus> {
    const now = Date.now();
    if (this.statusCache && now - this.statusCacheAt < AgentEngineService.STATUS_CACHE_TTL) {
      return this.statusCache;
    }
    const apps = await Promise.all(
      AGENT_IDS.map((appId) =>
        probeAppStatus(appId, this.discoveryDeps(), (id) => this.portFor(id)),
      ),
    );
    const result = { platform: platform(), apps };
    this.statusCache = result;
    this.statusCacheAt = now;
    return result;
  }

  /**
   * Immediately apply (or remove) the wallpaper to a running agent's page.
   * Called from the UI when the user selects a wallpaper for an agent.
   *
   * Implementation lives in {@link applyAgentWallpaperNowImpl}
   * (wallpaper-injector.ts); this method threads the orchestrator's deps
   * slice through.
   */
  async applyAgentWallpaperNow(
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    return applyAgentWallpaperNowImpl(appId, this.wallpaperDeps(), options);
  }

  /**
   * Apply a specific wallpaper to a specific agent. Persists the per-agent
   * preference and immediately injects via CDP. This is the primary entry
   * point from the Wallpaper Engine UI page.
   *
   * Implementation lives in {@link applyWallpaperToAgentImpl}
   * (wallpaper-injector.ts); this method threads the orchestrator's deps
   * slice through.
   */
  async applyWallpaperToAgent(
    wallpaperId: string,
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    return applyWallpaperToAgentImpl(wallpaperId, appId, this.wallpaperDeps(), options);
  }

  /**
   * Remove the wallpaper from a specific agent. Clears the per-agent
   * preference and removes the injected elements via CDP.
   *
   * Implementation lives in {@link removeWallpaperFromAgentImpl}
   * (wallpaper-injector.ts); this method threads the orchestrator's deps
   * slice through.
   */
  async removeWallpaperFromAgent(appId: AgentId): Promise<{ ok: boolean }> {
    return removeWallpaperFromAgentImpl(appId, this.wallpaperDeps());
  }

  async apply(request: ApplyRequest): Promise<ApplyResponse> {
    const appId = request.appId;
    // (1) Same-kind dedup: a second apply() joins the already-running promise.
    const existing = this.inflightOperations.get(appId);
    if (existing && existing.kind === 'apply') {
      return existing.promise as Promise<ApplyResponse>;
    }
    // (2) Opposite-kind ordering: wait for the in-flight restore's *cleanup*
    // (not just its promise) so all background follow-ups from that restore
    // have also settled before this apply touches the CDP target.
    if (existing && existing.kind === 'restore') {
      this.log(`[apply] ${appId}: restore in progress — queued behind in-flight restore`);
      try {
        await existing.cleanup;
      } catch (error) {
        this.log(
          `[apply] ${appId}: queued restore failed — proceeding anyway: ${toMessage(error)}`,
        );
      }
      // Re-check: a new op may have been enqueued while we awaited; if so
      // recurse so we chain onto it instead of racing it.
      return this.apply(request);
    }
    // Create a cleanup promise that settles only after the response AND all
    // fire-and-forget follow-ups (hardening, wallpaper, scheme sync) have
    // settled.  The inflight entry is deleted only when this resolves.
    let cleanupResolve!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      cleanupResolve = resolve;
    });
    // Chain the inflight-entry deletion onto cleanup: only delete once the
    // full chain (including background) has settled, not when the response
    // alone is ready.
    void cleanup.finally(() => {
      if (this.inflightOperations.get(appId)?.cleanup === cleanup) {
        this.inflightOperations.delete(appId);
      }
    });
    // biome-ignore lint/style/useConst: deferred assignment pattern
    let promise!: Promise<ApplyResponse>;
    promise = (async () => {
      try {
        const { response, background } = await this.applyInternal(request);
        // Attach the background settle to cleanup: if there are background
        // tasks, wait for them; otherwise resolve cleanup immediately.
        if (background) {
          void background.catch(() => undefined).finally(cleanupResolve);
        } else {
          cleanupResolve();
        }
        return response;
      } catch (error) {
        // Error path: resolve cleanup immediately so the inflight entry is
        // cleared (any background tasks that did start will still best-effort
        // run via applyThemeFlow's epoch cancellation, but we don't block
        // cleanup on them — an errored apply has no meaningful background).
        cleanupResolve();
        throw error;
      }
    })();
    this.inflightOperations.set(appId, { kind: 'apply', promise, cleanup });
    return promise;
  }

  private async applyInternal(request: ApplyRequest): Promise<{
    response: ApplyResponse;
    background: Promise<void>;
  }> {
    this.statusCache = null; // Invalidate cache — apply changes app state
    return applyThemeFlowImpl(request, this.applyFlowDeps());
  }

  async restore(appId: AgentId): Promise<SystemStatus> {
    // Mirror of apply() — same-kind dedup, opposite-kind ordered queueing.
    const existing = this.inflightOperations.get(appId);
    if (existing && existing.kind === 'restore') {
      return existing.promise as Promise<SystemStatus>;
    }
    if (existing && existing.kind === 'apply') {
      this.log(`[restore] ${appId}: apply in progress — queued behind in-flight apply`);
      try {
        // Wait for cleanup (not just promise) so background follow-ups from
        // the in-flight apply (hardening→wallpaper, scheme sync, self-heal)
        // have also settled before restore touches the CDP target.
        await existing.cleanup;
      } catch (error) {
        this.log(
          `[restore] ${appId}: queued apply failed — proceeding anyway: ${toMessage(error)}`,
        );
      }
      return this.restore(appId);
    }
    let cleanupResolve!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      cleanupResolve = resolve;
    });
    void cleanup.finally(() => {
      if (this.inflightOperations.get(appId)?.cleanup === cleanup) {
        this.inflightOperations.delete(appId);
      }
    });
    // biome-ignore lint/style/useConst: deferred assignment pattern
    let promise!: Promise<SystemStatus>;
    promise = (async () => {
      try {
        const status = await this.restoreInternal(appId);
        // resolve cleanup immediately — restoreThemeFlow is sequential
        // (no fire-and-forget chains that outlive the response).
        cleanupResolve();
        return status;
      } catch (error) {
        cleanupResolve();
        throw error;
      }
    })();
    this.inflightOperations.set(appId, { kind: 'restore', promise, cleanup });
    return promise;
  }

  private async restoreInternal(appId: AgentId): Promise<SystemStatus> {
    this.statusCache = null; // Invalidate cache — restore changes app state
    return restoreThemeFlowImpl(appId, this.restoreFlowDeps());
  }

  async restoreAll(): Promise<void> {
    // 并行恢复所有已应用主题的 agent —— 各 agent 的 restore 相互独立。
    // Also includes agents that have no theme but DO have a wallpaper
    // preference, so "restore all" truly clears every visual modification.
    const targets = AGENT_IDS.filter(
      (appId) => this.activeThemeId(appId) || this.settings.agentWallpaper(appId)?.enabled,
    );
    await Promise.all(targets.map((appId) => this.restore(appId).catch(() => undefined)));
    // For agents that had a wallpaper but no theme, restore() will not touch
    // them (it skips when activeThemeId is null). Clear their wallpaper
    // preference explicitly so nothing visual survives the "restore all".
    await Promise.all(
      AGENT_IDS.filter(
        (appId) => !this.activeThemeId(appId) && this.settings.agentWallpaper(appId)?.enabled,
      ).map((appId) => this.removeWallpaperFromAgent(appId).catch(() => undefined)),
    );
  }

  // -------------------------------------------------------------------------
  // Concurrency-metrics broadcast
  // -------------------------------------------------------------------------

  /**
   * Collect current concurrency metrics from all main-process sources.
   *
   * - `inflightOperations`, `persistChainPending` — read directly from the
   *   service's own state.
   * - `selfHealingAgents`, `capturedTokens`, `deferredSelfHeals` — obtained
   *   from the corresponding module-scoped getters in wallpaper-self-heal
   *   and wallpaper-injector.
   * - `companionBusyByAgent`, `switchEpochByAgent` — cached from the latest
   *   `updateConcurrencyMetricsFromRenderer` call (these maps live on the
   *   renderer side and cannot be read directly from the main process).
   */
  collectConcurrencyMetrics(): ConcurrencyMetrics {
    return {
      companionBusyByAgent: this.cachedCompanionBusySize,
      inflightOperations: this.inflightOperations.size,
      selfHealingAgents: getSelfHealingAgentsSize(),
      capturedTokens: getCapturedTokensSize(),
      persistChainDepth: this.persistChainPending,
      deferredSelfHeals: getDeferredSelfHealsSize(),
      switchEpochByAgent: this.cachedSwitchEpochSize,
    };
  }

  /**
   * Update the cached sizes of renderer-side concurrency primitives.
   * Called by the IPC layer when the renderer reports changes to its
   * `companionBusyByAgent` Set and `switchEpochByAgent` Map.
   *
   * These cached values are included in the next periodic broadcast.
   */
  updateConcurrencyMetricsFromRenderer(companionBusy: number, switchEpoch: number): void {
    this.cachedCompanionBusySize = Math.max(0, companionBusy);
    this.cachedSwitchEpochSize = Math.max(0, switchEpoch);
  }

  /**
   * Send the current concurrency metrics payload to the renderer via the
   * injected send callback. No-op if the timer has not been started.
   */
  private broadcastConcurrencyMetrics(): void {
    if (!this.sendMetricsToRenderer) return;
    try {
      this.sendMetricsToRenderer(this.collectConcurrencyMetrics());
    } catch (error) {
      this.log(`[metrics] broadcast failed: ${toMessage(error)}`);
    }
  }

  /**
   * Start the 5-second periodic broadcast of concurrency metrics to the
   * renderer. The `sender` callback delivers the payload (typically via
   * `webContents.send(IpcChannel.DIAGNOSTICS_CONCURRENCY_METRICS, ...)`).
   *
   * A one-shot immediate broadcast fires on start so the renderer does not
   * have to wait up to 5s for the first data point.
   *
   * Idempotent: calling start() again while already running is a no-op.
   */
  startConcurrencyMetricsTimer(sender: (metrics: ConcurrencyMetrics) => void): void {
    if (this.concurrencyMetricsTimer !== null) return;
    this.sendMetricsToRenderer = sender;
    this.concurrencyMetricsTimer = setInterval(() => {
      this.broadcastConcurrencyMetrics();
    }, 5000);
    // Immediate first broadcast so the renderer has data without waiting.
    this.broadcastConcurrencyMetrics();
  }

  /**
   * Stop the periodic metrics broadcast. Safe to call multiple times and
   * from within `dispose()`.
   */
  stopConcurrencyMetricsTimer(): void {
    if (this.concurrencyMetricsTimer !== null) {
      clearInterval(this.concurrencyMetricsTimer);
      this.concurrencyMetricsTimer = null;
    }
    this.sendMetricsToRenderer = null;
  }

  /**
   * Release ALL module-scoped state retained by sub-modules. Intended to be
   * called once at app shutdown (before-quit) so the process does not exit
   * with stale streaming file handles held open by the media server, or with
   * maps retaining references for every agent/theme that was ever touched.
   *
   * Ordering notes:
   *   - The metrics timer must be stopped before the send callback's
   *     webContents reference (captured in `sender`) becomes invalid.
   *   - Wallpapers first so media tokens are unregistered before the maps
   *     are cleared (server.handle needs the token to look up the stream).
   *   - CDP engine injection next so persistence-script identifiers are
   *     dropped before we clear UI-level caching state.
   *   - Self-heal + UI caches last (purely in-memory, no side effects).
   */
  dispose(): void {
    this.stopConcurrencyMetricsTimer();
    this.disposed = true;
    disposeWallpaperInjectionState();
    disposeEngineInjectionState();
    disposeSelfHealState();
    disposeThemeAssetCache();
    this.applyingTheme.clear();
    this.inflightOperations.clear();
    this.statusCache = null;
  }
}
