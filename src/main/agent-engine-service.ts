// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { requireAdapter } from '../adapters/registry';
import {
  ERROR_CODES,
  type ResolvedThemeTarget,
  type ThemeBundle,
} from '../legacy/agentskin-core-runtime';
import { isPort, resolveLivePort } from '../shared/cdp-discovery';
import { toMessage } from '../shared/errors';
import { getMainMessages } from '../shared/i18n';
import {
  AGENT_IDS,
  AGENT_META,
  type AgentId,
  type ApplyRequest,
  type ApplyResponse,
  type AppStatus,
  type InstalledTheme,
  type Platform,
  type SystemStatus,
} from '../shared/types';
import { resolveSchemeMode, type SchemeMode, type SchemeSnapshot } from './agent-scheme';
import {
  type CdpReadyResult as CdpReadyResultT,
  type DiscoveryDeps,
  ensureCdpReady as ensureCdpReadyImpl,
  inferRestartReason as inferRestartReasonImpl,
  probeAppStatus as probeAppStatusImpl,
  reconcileZombiePorts as reconcileZombiePortsImpl,
  resolveLivePort as resolveLivePortImpl,
} from './app-discovery';
import { type CdpSession, connectCdp } from './cdp-client';
import {
  type CdpFanoutDeps,
  hardeningPass as hardeningPassImpl,
  hardeningRemove as hardeningRemoveImpl,
  injectSecondaryTargets as injectSecondaryTargetsImpl,
  removeSecondaryTargets as removeSecondaryTargetsImpl,
} from './cdp-fanout';
import { pickPageTarget } from './cdp-targets';
import { appendLogLine, writeJsonAtomic } from './fs-utils';
import { detectInstallation } from './install-detection';
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
  LoggerApi,
  SettingsServiceApi,
  StructuredLogEvent,
  ThemeLibraryApi,
  WallpaperResolver,
} from './services/contracts';
import { inferModeFromColors, type ThemeEntry, toInstalledTheme } from './theme-library';
import {
  applyAgentWallpaperNow as applyAgentWallpaperNowImpl,
  applyWallpaperToAgent as applyWallpaperToAgentImpl,
  injectAgentWallpaperFromApply as injectAgentWallpaperFromApplyImpl,
  removeAgentVideoWallpaper as removeAgentVideoWallpaperImpl,
  removeWallpaperFromAgent as removeWallpaperFromAgentImpl,
  type WallpaperInjectorDeps,
} from './wallpaper-injector';

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
 * AgentSkin's control-layer orchestrator (now a thin facade after the
 * P1-2..P1-5 god-object teardown).
 *
 * The service is intentionally agnostic of specific applications — it does
 * not switch on app ids or know how any single app is detected or skinned.
 * All per-app knowledge lives in the adapter (from the registry), which in
 * turn delegates to the legacy core runtime.
 *
 * Call chain:
 *   UI -> IPC -> this service -> registry.getAdapter() -> ApplicationAdapter -> runtime -> @agentskin/core
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

export class AgentEngineService {
  private state: PersistedState = { version: 2, apps: {} };
  private logListener: ((line: string) => void) | null = null;
  /**
   * Apps currently undergoing a user-initiated applyTheme. Used to prevent
   * concurrent apply/restore from racing each other on the same CDP target.
   */
  private readonly applyingTheme = new Set<AgentId>();

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
  private readonly applyEpoch = new Map<AgentId, number>();

  /** Bump the epoch for an agent. Returns the new value for the caller to
   *  pass to background tasks so they can detect supersession. */
  private bumpEpoch(appId: AgentId): number {
    const next = (this.applyEpoch.get(appId) ?? 0) + 1;
    this.applyEpoch.set(appId, next);
    return next;
  }

  /** True if `captured` is still the current epoch for `appId`. Background
   *  tasks check this before each CDP touch and abort when it flips. */
  private isEpochCurrent(appId: AgentId, captured: number): boolean {
    return (this.applyEpoch.get(appId) ?? 0) === captured;
  }

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
  }> {
    const agentWp = this.settings.agentWallpaper(appId);
    if (agentWp.enabled && agentWp.id) {
      return { id: agentWp.id };
    }
    // Fall back to the active theme's bundled wallpaper.
    let installed: InstalledTheme | null = null;
    if (entry) {
      installed = toInstalledTheme(entry);
    } else {
      const themeId = this.state.apps[appId]?.activeThemeId;
      if (!themeId) return { id: null };
      try {
        const found = await this.library.find(themeId);
        installed = toInstalledTheme(found);
      } catch {
        return { id: null };
      }
    }
    const wp = installed.wallpaper;
    if (!wp) return { id: null };
    const themeId = installed.id;
    if (wp.workshopId)
      return { id: wp.workshopId, speed: wp.speed, loop: wp.loop, scrimOpacity: wp.scrimOpacity };
    if (wp.video)
      return {
        id: `theme:${themeId}`,
        speed: wp.speed,
        loop: wp.loop,
        scrimOpacity: wp.scrimOpacity,
      };
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
      const parsed = JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as PersistedState;
      if (parsed && parsed.version === 2 && parsed.apps && typeof parsed.apps === 'object') {
        this.state = parsed;
      }
    } catch {
      // Fresh install or legacy state - defaults apply.
    }
    // Clean up zombie ports: if a persisted port is no longer live, the app
    // was restarted (or crashed) and the theme is no longer injected. Drop
    // the port so the UI shows accurate state. activeThemeId is PRESERVED so
    // the user can re-apply with one click after restarting the agent.
    await this.reconcileZombiePorts();

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
      isEpochCurrent: (appId, captured) => this.isEpochCurrent(appId, captured),
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
      isEpochCurrent: (appId, captured) => this.isEpochCurrent(appId, captured),
      bumpEpoch: (appId) => this.bumpEpoch(appId),
      resolveAgentWallpaperId: (appId, entry) => this.resolveAgentWallpaperId(appId, entry),
      ensureCdpReady: (appId, timeoutMs) => this.ensureCdpReady(appId, timeoutMs),
      resolveLivePort: (appId) => this.resolveLivePort(appId),
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
      isEpochCurrent: (appId, captured) => this.isEpochCurrent(appId, captured),
      tryEngineInjection: (session, appId, bundle, targetTheme, heroDataUrl) =>
        this.tryEngineInjection(session, appId, bundle, targetTheme, heroDataUrl),
      log: (line) => this.log(line),
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
        dirty = true;
      }
    }
    if (dirty) await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.stateFile, this.state);
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
    port: number,
    fn: (session: CdpSession) => Promise<void>,
    retries = 8,
  ): Promise<void> {
    const adapter = this.adapter(appId);
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < retries; attempt++) {
      const livePort = await this.resolveLivePort(appId);
      if (livePort == null) {
        // No live CDP port yet (app still booting / not debug-enabled) — wait
        // and re-resolve instead of erroring on a null port.
        lastError = new Error('no live CDP port');
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      let targets: Awaited<ReturnType<typeof adapter.findTargets>> = [];
      try {
        targets = await adapter.findTargets(livePort, 1200);
      } catch (error) {
        lastError = error as Error;
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
      // Renderer not ready yet (fresh launch / restart) — wait and re-resolve.
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
  ): Promise<import('./cdp-inject').InjectEngineResult | null> {
    const deps: EngineInjectionDeps = {
      resolveEngineDir: resolveEngineDirDefault,
      log: (line) => this.log(line),
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
  async applyAgentWallpaperNow(appId: AgentId): Promise<{ ok: boolean; reason?: string }> {
    return applyAgentWallpaperNowImpl(appId, this.wallpaperDeps());
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
  ): Promise<{ ok: boolean; reason?: string }> {
    return applyWallpaperToAgentImpl(wallpaperId, appId, this.wallpaperDeps());
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

  async status(): Promise<SystemStatus> {
    const apps = await Promise.all(AGENT_IDS.map((appId) => this.appStatus(appId)));
    return { platform: platform(), apps };
  }

  /**
   * Infer a structured reason for why an apply returned `requires-restart`.
   * Used by the UI to show specific guidance (install / start manually /
   * singleton lock / etc.) instead of a single generic message.
   *
   * When `cdpFailureReason` is non-null (i.e. ensureCdpReady already
   * diagnosed the failure), it is mapped directly — no re-detection needed.
   * Otherwise (first-attempt probe path, no restart attempted), we fall back
   * to detection-based inference:
   *   - App not installed              → 'not-installed'
   *   - App installed but not running  → 'not-running'
   *   - App running, no CDP            → 'no-cdp'
   */
  private async inferRestartReason(
    appId: AgentId,
    cdpFailureReason: CdpReadyResult['reason'] = null,
  ): Promise<NonNullable<ApplyResponse['restartReason']>> {
    // ensureCdpReady gave us a precise cause — map it directly.
    if (cdpFailureReason) {
      switch (cdpFailureReason) {
        case 'not-installed':
          return 'not-installed';
        case 'singleton-lock':
          return 'singleton-lock';
        case 'spawn-error':
          return 'spawn-failed';
        case 'timeout':
          return 'cdp-timeout';
      }
    }
    try {
      const adapter = this.adapter(appId);
      const override = this.settings.overridesFor(appId);
      let discovered: Awaited<ReturnType<typeof adapter.discover>> = null;
      try {
        discovered = await adapter.discover(process.platform, override.appPath);
      } catch {
        discovered = null;
      }
      const probe = await detectInstallation({
        platform: process.platform,
        appPath: override.appPath,
        hints: adapter.installHints,
        displayName: PRODUCT_DISPLAY_NAMES[appId],
        logFile: this.detectionLogFile,
      });
      const installed = Boolean(discovered) || probe.installed;
      if (!installed) return 'not-installed';

      let running = false;
      try {
        running =
          (await adapter.findRunningPids(process.platform, discovered?.executable ?? null)).length >
          0;
      } catch {
        running = false;
      }

      if (!running) return 'not-running';
      return 'no-cdp';
    } catch {
      // Detection itself failed — fall back to the generic 'no-cdp' reason.
      return 'no-cdp';
    }
  }

  async apply(request: ApplyRequest): Promise<ApplyResponse> {
    const copy = getMainMessages();
    if (platform() === 'unsupported') throw new Error(copy.unsupportedPlatform);
    const appId = request.appId;
    const adapter = this.adapter(appId);

    // CDP discovery + (conditional) restart policy:
    //
    //   - If the user has NOT confirmed a restart (restartExisting !== true),
    //     we only probe for a live CDP port via resolveLivePort. If none is
    //     found we return `requires-restart` so the UI can show a confirmation
    //     dialog — we never silently kill an app the user may be working in.
    //   - If the user HAS confirmed (restartExisting === true), ensureCdpReady
    //     is allowed to kill and relaunch the app with --remote-debugging-port=0.
    //
    // This two-phase flow guarantees an app is only ever restarted after an
    // explicit user "Restart & apply" click, not on the first apply attempt.
    let port: number | null | undefined = request.port;
    let cdpFailureReason: CdpReadyResult['reason'] = null;
    if (!port) {
      if (request.restartExisting) {
        // User confirmed the restart — allowed to kill + relaunch with CDP.
        const cdpResult = await this.ensureCdpReady(appId);
        port = cdpResult.port;
        cdpFailureReason = cdpResult.reason;
      } else {
        // First attempt: probe only, do not restart.
        port = await this.resolveLivePort(appId);
      }
      if (port == null) {
        this.log(
          `[apply] ${appId}: no live CDP port${request.restartExisting ? ` (restart failed: ${cdpFailureReason})` : ' (not running with --remote-debugging-port)'}`,
        );
        // Infer a structured reason so the UI can show specific guidance
        // (install the app / start it manually / singleton lock / etc.)
        // instead of a single generic "restart needed" message. When
        // ensureCdpReady already gave us a precise failure cause, use it
        // directly instead of re-detecting (and guessing) from scratch.
        const restartReason = await this.inferRestartReason(appId, cdpFailureReason);
        return {
          status: 'requires-restart',
          message: copy.cdpNotDetectedMessage,
          system: await this.status(),
          restartReason,
        };
      }
    }
    if (!isPort(port)) throw new Error(copy.invalidCdpPort);

    const entry = await this.library.find(request.themeId);

    // CDP is guaranteed live at this point (ensureCdpReady either found an
    // existing port or restarted the app and waited for one). Inject CSS
    // directly via the existing connection — launch:false skips core's own
    // launch/restart, which would otherwise fight the port we just resolved.
    this.log(`[apply] ${entry.bundle.theme.id} -> ${appId} (port ${port})`);
    // Bump epoch before applying so any background tasks still running from a
    // previous apply/restore/reapply will see the epoch flip and self-terminate
    // before they touch the CDP target again.
    const epoch = this.bumpEpoch(appId);
    this.applyingTheme.add(appId);
    this.logStructured({
      type: 'inject_start',
      agentId: appId,
      themeId: entry.bundle.theme.id,
      timestamp: new Date().toISOString(),
      progress: 60,
    });
    try {
      await adapter.applyTheme(entry.bundle, {
        port,
        launch: false,
        appPath: this.settings.overridesFor(appId).appPath,
        restartExisting: false,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = toMessage(error);
      this.log(`[apply] ${appId} failed${code ? ` [${code}]` : ''}: ${message}`);
      this.logStructured({
        type: 'apply_failed',
        agentId: appId,
        themeId: entry.bundle.theme.id,
        reason: code ? `${code}: ${message}` : message,
        timestamp: new Date().toISOString(),
      });
      if (code === ERROR_CODES.RESTART_REQUIRED) {
        return {
          status: 'requires-restart',
          message: copy.restartRequiredMessage,
          system: await this.status(),
        };
      }
      // An occupied port is not fixed by restarting the target app, so it must
      // not funnel into the restart dialog.
      if (code === ERROR_CODES.PORT_OCCUPIED) {
        const occupiedPort = (error as { port?: number }).port ?? port;
        return {
          status: 'port-occupied',
          message: copy.portOccupiedMessage(occupiedPort),
          system: await this.status(),
        };
      }
      throw error;
    } finally {
      this.applyingTheme.delete(appId);
    }

    this.state.apps[appId] = {
      activeThemeId: entry.bundle.theme.id,
      port,
      schemeSnapshot: this.state.apps[appId]?.schemeSnapshot ?? null,
    };
    await this.persist();
    // Inject the theme CSS into secondary targets (MCP webviews, ardot
    // iframes) that the core's matchTarget/preflight filter out. Non-blocking
    // and best-effort — the main page is already themed, the response can
    // return immediately while embedded content is themed a moment later.
    void this.injectSecondaryTargets(appId, port, entry.bundle, epoch).catch(() => undefined);
    // Hardening pass: re-inject via adoptedStyleSheets (bypasses Doubao's
    // MutationObserver anti-tamper) and verify the theme actually took effect.
    // Non-blocking — core's applyTheme already succeeded, this is a safety net.
    void this.hardeningPass(appId, port, entry.bundle, epoch).catch(() => undefined);
    // Video wallpaper: resolve the effective wallpaper for this agent
    // (per-agent setting takes priority over the theme's bundled wallpaper)
    // and inject it into the agent's page as a fixed background video.
    // Non-blocking — the theme CSS is already applied, wallpaper is cosmetic.
    const installed = toInstalledTheme(entry);
    void this.injectAgentWallpaperFromApply(appId, port, entry, epoch).catch(() => undefined);
    // Match the agent's internal light/dark scheme to the theme so users do
    // not have to toggle dark mode by hand in each agent (best-effort). The
    // app may have been (re)launched by applyTheme and bound a different
    // debug port, so re-resolve the live port first.
    //
    // Mode resolution priority: copy.mode → infer from theme colors → null.
    const rawMode = installed.mode ?? inferModeFromColors(installed.colors);
    const schemeMode = resolveSchemeMode(rawMode);
    if (schemeMode) {
      // Re-resolve in case the app rebound a different port during apply; fall
      // back to the apply port (just-proven-live) if detection isn't ready yet
      // — syncSchemeWithStability re-resolves internally with retries.
      const livePort = (await this.resolveLivePort(appId)) ?? port;
      // Best-effort and non-blocking: the theme CSS is already applied, so the
      // "applied" response returns immediately while the agent's light/dark
      // scheme is matched a moment later. After the initial sync, a stability
      // window re-checks at 2s/5s/10s to catch apps that overwrite our mode
      // setting during their own render cycle.
      void this.syncSchemeWithStability(appId, livePort, schemeMode, epoch).catch(() => undefined);
    }
    this.log(`[apply] ${entry.bundle.theme.id} applied to ${appId}`);
    // Structured log for reliable parsing (locale-independent).
    this.logStructured({
      type: 'inject_done',
      agentId: appId,
      themeId: entry.bundle.theme.id,
      timestamp: new Date().toISOString(),
      progress: 100,
    });
    this.logStructured({
      type: 'theme_apply',
      agentId: appId,
      themeId: entry.bundle.theme.id,
      timestamp: new Date().toISOString(),
    });
    return {
      status: 'applied',
      message: copy.themeApplied(entry.bundle.theme.displayName, PRODUCT_DISPLAY_NAMES[appId]),
      system: await this.status(),
    };
  }

  async restore(appId: AgentId): Promise<SystemStatus> {
    const adapter = this.adapter(appId);
    const port = await this.resolveLivePort(appId);
    if (port == null) {
      // No live CDP port (app closed or running without --remote-debugging-port).
      // We can't reach the renderer to remove the theme CSS — leave state as-is
      // so the UI still shows the theme as active until the app is reachable.
      this.log(`[restore] ${appId}: no live CDP port, skipping renderer restore`);
      return this.status();
    }
    this.log(`[restore] ${appId} (port ${port})`);
    const snapshot = this.state.apps[appId]?.schemeSnapshot ?? null;
    // Bump epoch so any background tasks still running from the previous
    // apply/reapply self-terminate before they re-inject CSS or re-apply the
    // scheme that restore is about to tear down.
    const epoch = this.bumpEpoch(appId);
    this.applyingTheme.add(appId);
    // Remove engine injection (CSS layers + adapter.mjs + persistence script)
    // from ALL DOM-bearing targets BEFORE the core restore. This ensures the
    // persistence script (Page.addScriptToEvaluateOnNewDocument) is torn down
    // first, otherwise it would re-apply the engine on the next navigation
    // even after the core restore succeeds. Must iterate the same target set
    // as hardeningPass (page, webview, iframe) so no surface is missed.
    await this.hardeningRemove(appId, port, epoch).catch(() => undefined);
    try {
      await adapter.restoreTheme(port);
    } catch (error) {
      // Restoring when the app is closed still clears host settings state.
      this.log(`[restore] ${appId}: ${toMessage(error)}`);
      this.logStructured({
        type: 'restore_failed',
        agentId: appId,
        reason: toMessage(error),
        timestamp: new Date().toISOString(),
      });
      // On failure, keep the original activeThemeId - do not clear it.
      return this.status();
    } finally {
      this.applyingTheme.delete(appId);
    }
    // Remove the theme CSS from secondary targets (webviews/iframes) too.
    // Best-effort — the main window is already restored by adapter.restoreTheme.
    await this.removeSecondaryTargets(appId, port, epoch).catch(() => undefined);
    // Remove video wallpaper if one was injected.
    await this.removeAgentVideoWallpaper(appId, port, epoch).catch(() => undefined);
    // Put the user's original light/dark scheme back (best-effort).
    if (snapshot) await this.restoreOriginalScheme(appId, port, snapshot, epoch);
    this.state.apps[appId] = { activeThemeId: null, port };
    await this.persist();
    // Structured log for reliable parsing (locale-independent).
    this.logStructured({
      type: 'theme_restore',
      agentId: appId,
      timestamp: new Date().toISOString(),
    });
    return this.status();
  }

  async restoreAll(): Promise<void> {
    // 并行恢复所有已应用主题的 agent —— 各 agent 的 restore 相互独立。
    const targets = AGENT_IDS.filter((appId) => this.activeThemeId(appId));
    await Promise.all(targets.map((appId) => this.restore(appId).catch(() => undefined)));
  }
}
