// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { requireAdapter } from '../adapters/registry';
import type { ResolvedThemeTarget, ThemeBundle } from '../legacy/agentskin-core-runtime';
import { toMessage } from '../shared/errors';
import {
  AGENT_IDS,
  AGENT_META,
  type AgentId,
  type ApplyRequest,
  type ApplyResponse,
  type AppStatus,
  type Platform,
  type SystemStatus,
  type WallpaperRenderOptions,
} from '../shared/types';
import type { SchemeMode, SchemeSnapshot } from './agent-scheme';
import {
  type CdpReadyResult as CdpReadyResultT,
  type DiscoveryDeps,
  ensureCdpReady as ensureCdpReadyImpl,
  inferRestartReason as inferRestartReasonImpl,
  probeAppStatus as probeAppStatusImpl,
  reconcileZombiePorts as reconcileZombiePortsImpl,
  resolveLivePort as resolveLivePortImpl,
} from './app-discovery';
import { type CdpSession, connectCdp } from './cdp/cdp-client';
import {
  type CdpFanoutDeps,
  hardeningPass as hardeningPassImpl,
  hardeningRemove as hardeningRemoveImpl,
  injectSecondaryTargets as injectSecondaryTargetsImpl,
  removeSecondaryTargets as removeSecondaryTargetsImpl,
} from './cdp/cdp-fanout';
import { pickPageTarget } from './cdp/cdp-targets';
import {
  cleanupEngineInjectionForAgent,
  disposeEngineInjectionState,
} from './cdp/injection/engine-strategy';
import { EpochManager } from './epoch-manager';
import { appendLogLine, writeJsonAtomic } from './fs-utils';
import {
  type EngineInjectionDeps,
  resolveEngineDirDefault,
  tryEngineInjection as tryEngineInjectionImpl,
} from './palette-builder';
import {
  restoreOriginalScheme as restoreOriginalSchemeImpl,
  type SchemeSyncDeps,
  syncSchemeWithStability as syncSchemeWithStabilityImpl,
} from './scheme-sync';
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
  injectAgentWallpaperFromApply as injectAgentWallpaperFromApplyImpl,
  removeAgentVideoWallpaper as removeAgentVideoWallpaperImpl,
  removeWallpaperFromAgent as removeWallpaperFromAgentImpl,
  type WallpaperInjectorDeps,
} from './wallpaper-injector';
import { cleanupSelfHealForAgent, disposeSelfHealState } from './wallpaper-self-heal';

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
  }
  return true;
}

/**
 * Structured result of {@link AgentEngineService.ensureCdpReady}. When the
 * port is null, `reason` carries the precise failure cause so
 * {@link AgentEngineService.inferRestartReason} can map it to a user-facing
 * restart reason instead of re-detecting (and guessing) from scratch.
 *
 * Type re-exported from {@link app-discovery} so consumers and the
 * orchestrator share a single definition.
 */
type CdpReadyResult = CdpReadyResultT;

function platform(): Platform {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? process.platform
    : 'unsupported';
}

/**
 * Merge two render option sets with a per-field precedence: `base` supplies
 * defaults, `override` wins on any field it sets. Used to resolve the
 * per-agent → global → theme render chain so a partially-configured
 * per-agent setting doesn't wipe the global default.
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
 * The service owns only cross-cutting concerns that don't fit a single
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
   */
  private readonly inflightOperations = new Map<
    AgentId,
    { kind: 'apply' | 'restore'; promise: Promise<unknown> }
  >();

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
    speed?: number;
    loop?: boolean;
    scrimOpacity?: number;
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
        if (wp.workshopId)
          return {
            id: wp.workshopId,
            speed: wp.speed,
            loop: wp.loop,
            scrimOpacity: wp.scrimOpacity,
            render: wp.render,
          };
        if (wp.video)
          return {
            id: `theme:${themeId}`,
            speed: wp.speed,
            loop: wp.loop,
            scrimOpacity: wp.scrimOpacity,
            render: wp.render,
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
          speed: wp.speed,
          loop: wp.loop,
          scrimOpacity: wp.scrimOpacity,
          // global default → theme render (theme is the base when there is no
          // per-agent override).
          render: mergeRenderOptions(globalWp.render, wp.render),
        };
      if (wp.video)
        return {
          id: `theme:${themeId}`,
          speed: wp.speed,
          loop: wp.loop,
          scrimOpacity: wp.scrimOpacity,
          render: mergeRenderOptions(globalWp.render, wp.render),
        };
    } catch {
      return { id: null };
    }
    return { id: null };
  }

  private log(line: string): void {
    this.logListener?.(line);
    // Also append to the engine log file so failures are diagnosable even
    // when the UI isn't open or the user closed the log panel.
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
    void this.reconcileZombiePorts().catch((error) => {
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
   * dead doesn't mean they un-chose it. The UI shows "themed" state and the
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
      persist: () => this.persist(),
      activeThemeId: (appId) => this.activeThemeId(appId),
      activeSchemeId: (appId) => this.activeSchemeId(appId),
    };
  }

  private async reconcileZombiePorts(): Promise<void> {
    await reconcileZombiePortsImpl(AGENT_IDS, this.discoveryDeps());
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
    return {
      withPageSession: (appId, port, fn, retries) => this.withPageSession(appId, port, fn, retries),
      getSchemeSnapshot: (appId) => this.state.apps[appId]?.schemeSnapshot ?? null,
      setSchemeSnapshot: (appId, snapshot) => {
        const s = this.state.apps[appId];
        if (s) s.schemeSnapshot = snapshot;
      },
      persist: () => this.persist(),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      resolveLivePort: (appId) => this.resolveLivePort(appId),
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
      ensureCdpReady: (appId, timeoutMs) => this.ensureCdpReady(appId, timeoutMs),
      resolveLivePort: (appId) => this.resolveLivePort(appId),
      inferRestartReason: (appId, cdpFailureReason) =>
        this.inferRestartReason(appId, cdpFailureReason),
      findAgentTargets: (appId, port) => this.adapter(appId).findTargets(port, 1200),
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
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
   * owns the `EngineInjectionDeps` construction (see {@link tryEngineInjection}).
   */
  private fanoutDeps(): CdpFanoutDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      tryEngineInjection: (session, appId, bundle, targetTheme, heroDataUrl) =>
        this.tryEngineInjection(session, appId, bundle, targetTheme, heroDataUrl),
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
      resolveLivePort: (appId) => this.resolveLivePort(appId),
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
      persist: () => this.persist(),
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      hardeningRemove: (appId, port, epoch) => this.hardeningRemove(appId, port, epoch),
      removeSecondaryTargets: (appId, port, epoch) =>
        this.removeSecondaryTargets(appId, port, epoch),
      removeAgentVideoWallpaper: (appId, port, epoch) =>
        this.removeAgentVideoWallpaper(appId, port, epoch),
      restoreOriginalScheme: (appId, port, snapshot, epoch) =>
        this.restoreOriginalScheme(appId, port, snapshot, epoch),
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
      ensureCdpReady: (appId, timeoutMs) => this.ensureCdpReady(appId, timeoutMs),
      resolveLivePort: (appId) => this.resolveLivePort(appId),
      inferRestartReason: (appId, cdpFailureReason) =>
        this.inferRestartReason(appId, cdpFailureReason),
      findTheme: (themeId) => this.library.find(themeId),
      bumpEpoch: (appId) => this.epochs.bumpEpoch(appId),
      setActiveTheme: (appId, themeId, port, schemeId) => {
        this.state.apps[appId] = {
          activeThemeId: themeId,
          activeSchemeId: schemeId ?? null,
          port,
          schemeSnapshot: this.state.apps[appId]?.schemeSnapshot ?? null,
        };
      },
      persist: () => this.persist(),
      getAppPath: (appId) => this.settings.overridesFor(appId).appPath,
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      injectSecondaryTargets: (appId, port, bundle, epoch) =>
        this.injectSecondaryTargets(appId, port, bundle, epoch),
      hardeningPass: (appId, port, bundle, epoch) => this.hardeningPass(appId, port, bundle, epoch),
      injectAgentWallpaperFromApply: (appId, port, entry, epoch) =>
        this.injectAgentWallpaperFromApply(appId, port, entry, epoch),
      syncSchemeWithStability: (appId, port, mode, epoch) =>
        this.syncSchemeWithStability(appId, port, mode, epoch),
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
    if (dirty) await this.persist();
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

  /**
   * Discover the live CDP port for an app without trusting any hardcoded
   * "default port" (the 9336/9337/9338 assumptions are stale — WorkBuddy 5.3.x
   * binds a random port, QoderWork forces port=0, TRAE SOLO only opens CDP
   * when explicitly launched with --remote-debugging-port).
   *
   * `knownDeadPort` (previously `preferredPort`) is now purely a filter: if
   * the caller already knows a port is dead (e.g. a zombie override, or the
   * port=0 we just spawned), passing it here skips re-probing that one port
   * in Layers 2/3. It is never probed itself — there is no "Layer 1" anymore.
   *
   * Discovery layers:
   *   1. DevToolsActivePort files (may point at an ephemeral port).
   *   2. PID → command line → /json/list (fast path for apps whose launcher
   *      writes --remote-debugging-port=N into argv, e.g. WorkBuddy 5.3.x).
   *   3. PID → netstat → /json/list (catches port=0 apps where Chromium
   *      picks the port itself and argv has no usable value).
   *
   * Returns null if no live CDP endpoint is reachable.
   */
  private async resolveLivePort(
    appId: AgentId,
    knownDeadPort: number | null = null,
  ): Promise<number | null> {
    return resolveLivePortImpl(appId, this.discoveryDeps(), knownDeadPort);
  }

  /**
   * Ensure the target app has a live CDP endpoint, (re)starting it with
   * `--remote-debugging-port=0` on the command line when no debug port is
   * currently open. Chromium then picks a free random port itself; we
   * discover it via `resolveLivePort` (netstat layer). Returns the live
   * port, or null if the app couldn't be (re)launched within the timeout.
   *
   * This is invoked from `apply` so the user's "apply theme" click is the
   * authorization to restart the app if needed — AgentSkin never restarts an
   * app outside of an explicit apply request.
   *
   * Implementation lives in {@link ensureCdpReadyImpl} (app-discovery.ts);
   * this method just threads the orchestrator's deps slice through.
   */
  private async ensureCdpReady(appId: AgentId, timeoutMs = 30000): Promise<CdpReadyResult> {
    return ensureCdpReadyImpl(appId, this.discoveryDeps(), timeoutMs);
  }

  activeThemeId(appId: AgentId): string | null {
    return this.state.apps[appId]?.activeThemeId ?? null;
  }

  /** Active color-scheme id for an agent (null/undefined = default colors). */
  activeSchemeId(appId: AgentId): string | null {
    return this.state.apps[appId]?.activeSchemeId ?? null;
  }

  /**
   * Open a CDP session against the app's main page target and run `fn` with
   * it, always closing the socket afterwards. Best-effort: retries for a short
   * window because the app may have just been (re)launched by `applyTheme` and
   * its renderer / CDP endpoint is not ready yet — without this the scheme
   * sync would throw "no reachable page target" and silently skip, leaving the
   * agent in the wrong light/dark mode. After the retries are exhausted the
   * error propagates so callers can log it as a best-effort skip.
   */
  private async withPageSession(
    appId: AgentId,
    _port: number,
    fn: (session: CdpSession) => Promise<void>,
    retries = 8,
  ): Promise<void> {
    const adapter = this.adapter(appId);
    let lastError: Error | null = null;
    // Cache the resolved port across retries. Previously every retry called
    // resolveLivePort again (DevToolsActivePort file read + PID/netstat
    // probing), wasting IO when the port doesn't change between attempts.
    // The port is only re-resolved when the cached port fails to yield
    // targets (app may have restarted and bound a new port).
    let cachedPort: number | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      // First attempt or previous port yielded no targets → re-resolve.
      if (cachedPort == null) {
        cachedPort = await this.resolveLivePort(appId);
      }
      if (cachedPort == null) {
        // No live CDP port yet (app still booting / not debug-enabled) — wait
        // and retry. Reset cachedPort so the next iteration re-resolves.
        lastError = new Error('no live CDP port');
        cachedPort = null;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      let targets: Awaited<ReturnType<typeof adapter.findTargets>> = [];
      try {
        targets = await adapter.findTargets(cachedPort, 1200);
      } catch (error) {
        lastError = error as Error;
        // Port may be stale (app restarted) → force re-resolve on next attempt.
        cachedPort = null;
      }
      const page = pickPageTarget(targets);
      if (page) {
        const session = await connectCdp(page.webSocketDebuggerUrl);
        try {
          await fn(session);
          return;
        } finally {
          session.close();
        }
      }
      lastError = new Error('no reachable page target');
      // Renderer not ready yet (fresh launch / restart) — wait and retry.
      // Keep cachedPort: the app is still launching, the port is likely the
      // same, just the renderer hasn't registered targets yet.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw lastError ?? new Error('no reachable page target');
  }

  /**
   * Stability-window scheme sync: applies the scheme immediately, then
   * re-checks at 2s / 5s / 10s. If the agent has overwritten our mode
   * setting during its own render cycle (common for Trae/Qoder which
   * re-apply persisted theme on startup), we re-apply. Stops early once
   * two consecutive checks confirm the mode is stable.
   *
   * Implementation lives in {@link syncSchemeWithStabilityImpl}
   * (scheme-sync.ts); this method threads the orchestrator's deps slice
   * through.
   */
  private async syncSchemeWithStability(
    appId: AgentId,
    port: number,
    mode: SchemeMode,
    epoch: number,
  ): Promise<void> {
    await syncSchemeWithStabilityImpl(appId, port, mode, epoch, this.schemeSyncDeps());
  }

  /**
   * Write a captured scheme snapshot back to the agent. Best-effort.
   *
   * Implementation lives in {@link restoreOriginalSchemeImpl}
   * (scheme-sync.ts); this method threads the orchestrator's deps slice
   * through.
   */
  private async restoreOriginalScheme(
    appId: AgentId,
    port: number,
    snapshot: SchemeSnapshot,
    epoch: number,
  ): Promise<void> {
    await restoreOriginalSchemeImpl(appId, port, snapshot, epoch, this.schemeSyncDeps());
  }

  /**
   * Build a read-only {@link AppStatus} snapshot for an agent. Pure query —
   * no state mutation, no applyEpoch interaction.
   *
   * Implementation lives in {@link probeAppStatusImpl} (app-discovery.ts);
   * this method threads the orchestrator's deps + `portFor` accessor through.
   */
  private async appStatus(appId: AgentId): Promise<AppStatus> {
    return probeAppStatusImpl(appId, this.discoveryDeps(), (id) => this.portFor(id));
  }

  /**
   * Inject the theme CSS into ALL secondary CDP targets (webviews, iframes)
   * that the core's matchTarget/preflight filter out.
   *
   * Implementation lives in {@link injectSecondaryTargetsImpl}
   * (cdp-fanout.ts); this method threads the orchestrator's deps slice
   * through.
   */
  private async injectSecondaryTargets(
    appId: AgentId,
    port: number,
    bundle: ThemeBundle,
    epoch: number,
  ): Promise<void> {
    await injectSecondaryTargetsImpl(appId, port, bundle, epoch, this.fanoutDeps());
  }

  /**
   * Hardening pass: re-inject the theme via adoptedStyleSheets (stealth
   * channel that bypasses MutationObserver anti-tamper) and verify the
   * theme actually took effect. Runs AFTER core's applyTheme succeeds as
   * a safety net — particularly important for Doubao which strips <style>
   * elements within ~50ms of insertion.
   *
   * Iterates ALL DOM-bearing CDP targets (page, webview, iframe) so the
   * engine layers (palette/tokens/cosmetic/theme CSS + adapter.mjs) are
   * applied to every user-visible surface. This is critical for apps like
   * WorkBuddy that have 13+ CDP targets — previously only the first page
   * was themed, leaving webviews and iframes unstyled. The adapter.mjs
   * and CSS layers are also registered via Page.addScriptToEvaluateOnNewDocument
   * inside `injectThemeViaEngine` so they survive navigation/reload.
   *
   * Also runs a DOM health check on the main page to detect opaque layers
   * that block the hero art, logging a score for diagnostics.
   *
   * Implementation lives in {@link hardeningPassImpl} (cdp-fanout.ts);
   * this method threads the orchestrator's deps slice through.
   */
  private async hardeningPass(
    appId: AgentId,
    port: number,
    bundle: ThemeBundle,
    epoch: number,
  ): Promise<void> {
    await hardeningPassImpl(appId, port, bundle, epoch, this.fanoutDeps());
  }

  /**
   * Remove engine injection (CSS layers + adapter.mjs + persistence script)
   * from ALL DOM-bearing CDP targets on the port. This is the counterpart
   * to {@link hardeningPass} and must iterate the same set of targets
   * (page, webview, iframe) so no surface retains a stale theme after
   * restore.
   *
   * Called during {@link restore} BEFORE `adapter.restoreTheme` so the core
   * runtime's cleanup runs against a target that has already been stripped
   * of the engine's adoptedStyleSheets and adapter markers.
   *
   * Implementation lives in {@link hardeningRemoveImpl} (cdp-fanout.ts);
   * this method threads the orchestrator's deps slice through.
   */
  private async hardeningRemove(appId: AgentId, port: number, epoch: number): Promise<void> {
    await hardeningRemoveImpl(appId, port, epoch, this.fanoutDeps());
  }

  /**
   * Attempt engine-based multi-layer injection (L3/L4/L5 architecture).
   * Delegates to {@link tryEngineInjectionImpl} in the palette-builder module;
   * kept as a private method so callers (hardeningPass) don't need to thread
   * `log()` / engine-dir resolution through their own signatures.
   *
   * Engine dir resolution and error logging are injected via
   * {@link EngineInjectionDeps} so the pure transformation can be unit-tested.
   */
  private async tryEngineInjection(
    session: CdpSession,
    appId: AgentId,
    bundle: ThemeBundle,
    targetTheme: ResolvedThemeTarget,
    heroDataUrl: string | null,
  ): Promise<import('./cdp/cdp-inject').InjectEngineResult | null> {
    const deps: EngineInjectionDeps = {
      resolveEngineDir: resolveEngineDirDefault,
      log: (line) => this.log(line),
      customThemeCss: () => this.settings.customThemeCss(),
    };
    return tryEngineInjectionImpl(session, appId, bundle, targetTheme, heroDataUrl, deps);
  }

  /**
   * Called from the apply flow to inject the resolved wallpaper into the
   * agent's page. Resolves the effective wallpaper id (per-agent setting
   * first, then theme-bundled wallpaper) and delegates to
   * {@link injectAgentWallpaper}. If no wallpaper is resolved, removes any
   * existing wallpaper from the page.
   *
   * Implementation lives in {@link injectAgentWallpaperFromApplyImpl}
   * (wallpaper-injector.ts); this method threads the orchestrator's deps
   * slice through.
   */
  private async injectAgentWallpaperFromApply(
    appId: AgentId,
    port: number,
    entry: ThemeEntry,
    epoch: number,
  ): Promise<void> {
    await injectAgentWallpaperFromApplyImpl(appId, port, entry, epoch, this.wallpaperDeps());
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
   * Remove any injected wallpaper (video or image) from the agent's page.
   * Called during the restore flow. Best-effort.
   *
   * Implementation lives in {@link removeAgentVideoWallpaperImpl}
   * (wallpaper-injector.ts); this method threads the orchestrator's deps
   * slice through.
   */
  private async removeAgentVideoWallpaper(
    appId: AgentId,
    port: number,
    epoch: number,
  ): Promise<void> {
    await removeAgentVideoWallpaperImpl(appId, port, epoch, this.wallpaperDeps());
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

  /**
   * Remove the theme CSS from all secondary CDP targets (webviews, iframes).
   * Called during restore so embedded content doesn't keep showing a stale
   * theme after the main window is restored. Best-effort.
   *
   * Implementation lives in {@link removeSecondaryTargetsImpl}
   * (cdp-fanout.ts); this method threads the orchestrator's deps slice
   * through.
   */
  private async removeSecondaryTargets(appId: AgentId, port: number, epoch: number): Promise<void> {
    await removeSecondaryTargetsImpl(appId, port, epoch, this.fanoutDeps());
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
    const apps = await Promise.all(AGENT_IDS.map((appId) => this.appStatus(appId)));
    const result = { platform: platform(), apps };
    this.statusCache = result;
    this.statusCacheAt = now;
    return result;
  }

  /**
   * Infer a structured reason for why an apply returned `requires-restart`.
   * Used by the UI to show specific guidance (install / start manually /
   * singleton lock / etc.) instead of a single generic message.
   *
   * Implementation lives in {@link inferRestartReasonImpl} (app-discovery.ts);
   * this method just threads the orchestrator's deps slice through.
   */
  private async inferRestartReason(
    appId: AgentId,
    cdpFailureReason: CdpReadyResult['reason'] = null,
  ): Promise<NonNullable<ApplyResponse['restartReason']>> {
    return inferRestartReasonImpl(appId, this.discoveryDeps(), cdpFailureReason);
  }

  async apply(request: ApplyRequest): Promise<ApplyResponse> {
    const appId = request.appId;
    // (1) Same-kind dedup: a second apply() joins the already-running promise.
    const existing = this.inflightOperations.get(appId);
    if (existing && existing.kind === 'apply') {
      return existing.promise as Promise<ApplyResponse>;
    }
    // (2) Opposite-kind ordering: wait for any in-flight restore to settle
    // before starting the apply, so the post-apply state is deterministic.
    if (existing && existing.kind === 'restore') {
      this.log(`[apply] ${appId}: restore in progress — queued behind in-flight restore`);
      try {
        await existing.promise;
      } catch (error) {
        this.log(
          `[apply] ${appId}: queued restore failed — proceeding anyway: ${toMessage(error)}`,
        );
      }
      // Re-check: a new op may have been enqueued while we awaited; if so
      // recurse so we chain onto it instead of racing it.
      return this.apply(request);
    }
    let promise!: Promise<ApplyResponse>;
    promise = (async () => {
      try {
        return await this.applyInternal(request);
      } finally {
        if (this.inflightOperations.get(appId)?.promise === promise) {
          this.inflightOperations.delete(appId);
        }
      }
    })();
    this.inflightOperations.set(appId, { kind: 'apply', promise });
    return promise;
  }

  private async applyInternal(request: ApplyRequest): Promise<ApplyResponse> {
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
        await existing.promise;
      } catch (error) {
        this.log(
          `[restore] ${appId}: queued apply failed — proceeding anyway: ${toMessage(error)}`,
        );
      }
      return this.restore(appId);
    }
    let promise!: Promise<SystemStatus>;
    promise = (async () => {
      try {
        return await this.restoreInternal(appId);
      } finally {
        if (this.inflightOperations.get(appId)?.promise === promise) {
          this.inflightOperations.delete(appId);
        }
      }
    })();
    this.inflightOperations.set(appId, { kind: 'restore', promise });
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
    // For agents that had a wallpaper but no theme, restore() won't touch
    // them (it skips when activeThemeId is null). Clear their wallpaper
    // preference explicitly so nothing visual survives the "restore all".
    await Promise.all(
      AGENT_IDS.filter(
        (appId) => !this.activeThemeId(appId) && this.settings.agentWallpaper(appId)?.enabled,
      ).map((appId) => this.removeWallpaperFromAgent(appId).catch(() => undefined)),
    );
  }

  /**
   * Release ALL module-scoped state retained by sub-modules. Intended to be
   * called once at app shutdown (before-quit) so the process doesn't exit
   * with stale streaming file handles held open by the media server, or with
   * maps retaining references for every agent/theme that was ever touched.
   *
   * Ordering notes:
   *   - Wallpapers first so media tokens are unregistered before the maps
   *     are cleared (server.handle needs the token to look up the stream).
   *   - CDP engine injection next so persistence-script identifiers are
   *     dropped before we clear UI-level caching state.
   *   - Self-heal + UI caches last (purely in-memory, no side effects).
   */
  dispose(): void {
    disposeWallpaperInjectionState();
    disposeEngineInjectionState();
    disposeSelfHealState();
    disposeThemeAssetCache();
    this.applyingTheme.clear();
    this.inflightOperations.clear();
    this.statusCache = null;
  }
}
