// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentEngineService — Facade
 *
 * AgentSkin's control-layer orchestrator (thin facade after god-object
 * teardown).  Covers only cross-cutting concerns that do not fit a single
 * extracted module:
 *
 *   - State registry — owned by {@link AgentEngineRegistry} (./services/agent-engine-registry)
 *   - Persistence — owned by {@link PersistChain} (./services/agent-engine-persist)
 *   - Apply/restore option merging — pure functions from ./services/agent-engine-options
 *   - Epoch management (`EpochManager`) — the cross-cutting cancellation guard
 *   - Concurrency (inflight / applyingTheme / mutex) — retained on the Facade
 *   - Logging (`log` / `logStructured`) — shared by every deps slice
 *   - The `apply` / `restore` flow itself — the top-level orchestration that
 *     sequences the extracted modules in the right order
 *
 * Everything else has been peeled off into cohesive modules:
 *   - {@link ./app-discovery}       — port discovery, CDP-ready, status probe
 *   - {@link ./services/agent-engine-options} — render option merging
 *   - {@link ./services/agent-engine-persist}  — PersistedState shape, persist chain
 *   - {@link ./services/agent-engine-registry} — per-agent state CRUD
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { requireAdapter } from '../adapters/registry';
import { toMessage } from '../shared/errors';
import { IpcChannel } from '../shared/ipc-channels';
import {
  AGENT_IDS,
  AGENT_META,
  type AgentId,
  type AppStatus,
  type ApplyRequest,
  type ApplyResponse,
  type ConcurrencyMetrics,
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
  probeAppStatus,
  reconcileZombiePorts,
  removeAgentVideoWallpaper,
  resolveLivePort,
  restoreOriginalScheme,
  syncSchemeWithStability,
  tryEngineInjection,
  type WithPageSessionDeps,
  withPageSession,
} from './agent-engine/delegates';
import { type DiscoveryDeps, LivePortCache } from './app-discovery';
import {
  ApplyBaselineCache,
  captureBaselineOnPort,
  probeThemeLiveOnPort,
} from './cdp/apply-baseline';
import { type CdpFanoutDeps, injectSecondaryTargets } from './cdp/cdp-fanout';
import { captureFingerprintOnPort } from './cdp/cdp-fingerprint';
import { clearTargetsCache } from './cdp/cdp-targets';
import {
  cleanupEngineInjectionForAgent,
  disposeEngineInjectionState,
} from './cdp/injection/engine-strategy';
import { disposeReloadWatchdogs } from './cdp/reload-watchdog';
import type { RendererHints } from './cdp/renderer-rank';
import { CdpSessionPool } from './cdp/session-pool';
import { EpochManager } from './epoch-manager';
import { appendLogLine, writeJsonAtomic } from './fs-utils';
import { ctx, notifyPersistFailure } from './main-context';
import { resolveEngineDirDefault } from './palette-builder';
import type { SchemeSyncDeps } from './scheme-sync';
import { mergeRenderOptions, themeRenderOptions } from './services/agent-engine-options';
import {
  isPersistedState,
  PersistChain,
  type PersistedState,
} from './services/agent-engine-persist';
import { AgentEngineRegistry } from './services/agent-engine-registry';
import { getAppRunStateCoordinator } from './services/app-run-state-coordinator';
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

function platform(): Platform {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? process.platform
    : 'unsupported';
}

/**
 * RFC §4.8: per-agent min verify delay (ms) for the hardening/verify loop.
 * Fast-applying agents can lower this from the 500ms default to shave latency
 * off the apply hot path. The map is keyed by `AgentId`; agents absent from it
 * keep the 500ms default. Populate entries only after confirming an agent's
 * theme applies reliably within the reduced window.
 */
const APPLY_VERIFY_DELAY_OVERRIDES: Partial<Record<AgentId, number>> = Object.freeze({});

// ---------------------------------------------------------------------------
// RC6-S6-A: Named constants for hardening/verify loop timing
// ---------------------------------------------------------------------------

/** Default interval (ms) between consecutive CDP evaluate calls during the hardening verify pass. */
const DEFAULT_VERIFY_INTERVAL_MS = 50;

// ---------------------------------------------------------------------------
// Facade class
// ---------------------------------------------------------------------------

export class AgentEngineService implements AgentEngineServiceApi {
  // -----------------------------------------------------------------------
  // State (delegated to extracted modules)
  // -----------------------------------------------------------------------

  /** Per-agent state — owned by the registry module. */
  private readonly registry = new AgentEngineRegistry();
  /** Persistence serialisation chain — owned by the persist module. */
  private readonly persist = new PersistChain();

  // -----------------------------------------------------------------------
  // Concurrency primitives (kept on the Facade — cross-cutting concerns)
  // -----------------------------------------------------------------------

  private logListener: ((line: string) => void) | null = null;
  /**
   * Apps currently undergoing a user-initiated applyTheme. Used to prevent
   * concurrent apply/restore from racing each other on the same CDP target.
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
   * are globally ordered.
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
   * Monotonic epoch per agent — bumped at the start of every apply / restore
   * / reapply. Background tasks capture the epoch when they start and abort
   * early if it changes.
   */
  private readonly epochs = new EpochManager();

  /**
   * Per-agent CDP session pool. Reuses a target's WebSocket across the
   * fan-out sub-tasks (secondary inject + hardening + remove) within a single
   * epoch, and is invalidated on every epoch bump so sessions never leak
   * across apply/restore operations (RFC §4.1).
   */
  private readonly cdpSessionPool = new CdpSessionPool();

  /**
   * Per-agent live CDP port cache (RFC §4.2) — 30s TTL, invalidated on every
   * epoch bump so a freshly-restarted app's new port is never shadowed by a
   * stale entry.
   */
  private readonly livePortCache = new LivePortCache();

  /**
   * Per-agent {@link BaselineSnapshot} cache (RFC §4.5) — LRU(3) + 60s TTL,
   * keyed by `{appId, url, themeId}`. Seeds after a successful apply and is
   * read on the theme-switch fast path; invalidated on probe failure and on
   * every epoch bump so a stale baseline never crosses an apply boundary.
   */
  private readonly applyBaselineCache = new ApplyBaselineCache();

  /**
   * Bump the epoch for an agent AND invalidate its pooled CDP sessions. Every
   * apply/restore bumps the epoch at its start, so pooled sessions are closed
   * at each operation boundary and never reused across operations (RFC §4.1).
   */
  private bumpEpoch(appId: AgentId): number {
    const epoch = this.epochs.bumpEpoch(appId);
    this.cdpSessionPool.invalidateEpoch(appId);
    this.livePortCache.clear(appId);
    this.applyBaselineCache.clearAgent(appId);
    clearTargetsCache();
    return epoch;
  }

  // -----------------------------------------------------------------------
  // Concurrency-metrics broadcast state
  // -----------------------------------------------------------------------

  /** Cached size of wallpaperStore's `companionBusyByAgent` Set (renderer-side). */
  private cachedCompanionBusySize = 0;
  /** Cached size of environmentStore's `switchEpochByAgent` Map (renderer-side). */
  private cachedSwitchEpochSize = 0;
  /** Count of persistence failures since last reset — surfaced via ConcurrencyMetrics. */
  private persistFailures = 0;
  /**
   * Message of the most recent persistence failure (or null when the last
   * write succeeded). Additive observability so operators can detect the
   * in-memory/disk desync window (see `writeState`) without waiting for the
   * threshold-based user notification. Does NOT change the swallow contract.
   */
  private lastPersistErrorMessage: string | null = null;
  /** Handle for the 5-second metrics broadcast interval (null when stopped). */
  private concurrencyMetricsTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Callback used to deliver the metrics payload to the renderer. Injected at
   * start time so the service does not depend on main-context's `ctx` singleton.
   */
  private sendMetricsToRenderer: ((metrics: ConcurrencyMetrics) => void) | null = null;

  // -----------------------------------------------------------------------
  // Constructor & injected services
  // -----------------------------------------------------------------------

  /** Absolute path of the human-readable agent detection report. */
  private readonly detectionLogFile: string;
  /** Absolute path of the engine log (apply/reapply/reconcile diagnostics). */
  private readonly engineLogFile: string;

  constructor(
    private readonly library: ThemeLibraryApi,
    private readonly stateFile: string,
    private readonly settings: SettingsServiceApi,
  ) {
    // Detection report lives next to the persisted state, under userData/logs.
    this.detectionLogFile = path.join(path.dirname(stateFile), 'logs', 'agent-detection.log');
    this.engineLogFile = path.join(path.dirname(stateFile), 'logs', 'agent-engine.log');
    // R7: Surface persist failures via structured log + diagnostic counter.
    // RC3-S3-B: Single increment point. Do NOT increment in log()'s catch block
    // to avoid double-counting when appendLogLine itself fails.
    this.persist.onError = (error) => {
      this.persistFailures++;
      const message = error instanceof Error ? error.message : String(error);
      this.log(`[persist] write failed: ${message}`);
    };
  }

  setLogListener(listener: (line: string) => void): void {
    this.logListener = listener;
  }

  /** Wallpaper service reference for resolving theme video/image paths. */
  private wallpaperService: WallpaperResolver | null = null;
  setWallpaperService(svc: WallpaperResolver): void {
    this.wallpaperService = svc;
  }

  // -----------------------------------------------------------------------
  // Logging (kept on the Facade — shared by every deps slice)
  // -----------------------------------------------------------------------

  private log(line: string): void {
    this.logListener?.(line);
    // Also append to the engine log file so failures are diagnosable even
    // when the UI is not open or the user closed the log panel.
    // RC3-S3-B: Swallow append errors without incrementing persistFailures.
    // Rationale: persistFailures tracks registry persistence health, not log
    // file write health. The onError callback already handles persist failures.
    const ts = new Date().toISOString();
    void appendLogLine(this.engineLogFile, `[${ts}] ${line}\n`).catch(() => {
      // intentionally swallowed — log file write is best-effort
    });
  }

  /**
   * Emit a structured log entry that useEnvironments can parse reliably
   * regardless of UI locale.  The renderer splits on the first "|" and
   * parses the JSON payload; human-readable log lines remain unaffected.
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

  // -----------------------------------------------------------------------
  // Wallpaper-id resolution (delegates to options helpers)
  // -----------------------------------------------------------------------

  /**
   * Resolve the effective wallpaper id for an agent. Priority:
   * 1. Per-agent wallpaper setting (settings.agentWallpaper) when enabled
   * 2. Active theme's bundled wallpaper (theme.wallpaper.workshopId or video)
   * 3. null (no wallpaper)
   */
  private async resolveAgentWallpaperId(
    appId: AgentId,
    entry?: ThemeEntry,
  ): Promise<{
    id: string | null;
    render?: WallpaperRenderOptions;
  }> {
    // When actively applying a theme (entry provided), the theme is the SOLE
    // authority on wallpaper.
    // RC3-S3-B: Wrap in try-catch to prevent malformed entry from throwing
    // through the entire apply chain. The non-entry branch already has this guard.
    if (entry) {
      try {
        const installed = toInstalledTheme(entry);
        const wp = installed.wallpaper;
        if (wp) {
          const themeId = installed.id;
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
        return { id: null };
      } catch (error) {
        this.log(`[wallpaper] ${appId}: failed to resolve entry wallpaper — ${toMessage(error)}`);
        return { id: null };
      }
    }

    // Not applying a theme (restart/reconnect) — resolve with the full
    // per-agent → global → theme precedence.
    const agentWp = this.settings.agentWallpaper(appId);
    const globalWp = this.settings.wallpaper();
    if (agentWp.enabled && agentWp.id) {
      return {
        id: agentWp.id,
        render: mergeRenderOptions(globalWp.render, agentWp.render),
      };
    }

    // No per-agent setting — look up the persisted active theme's wallpaper.
    const themeId = this.registry.getActiveThemeId(appId);
    if (!themeId) return { id: null };
    try {
      const found = await this.library.find(themeId);
      const installed = toInstalledTheme(found);
      const wp = installed.wallpaper;
      if (!wp) return { id: null };
      if (wp.workshopId)
        return {
          id: wp.workshopId,
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

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (isPersistedState(parsed)) {
        this.registry.loadFrom(parsed);
      }
    } catch {
      // Fresh install or legacy state - defaults apply.
    }
    // Clean up zombie ports in the background — this only touches persisted
    // state (clearing dead ports), and status() independently re-probes all
    // ports on every call, so blocking startup for the cleanup is unnecessary.
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

  // -----------------------------------------------------------------------
  // Deps slice builders
  // -----------------------------------------------------------------------

  /**
   * Build the {@link DiscoveryDeps} slice that backs all calls into
   * `app-discovery`.
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
      getAppPort: (appId) => this.registry.getApp(appId) ?? null,
      clearAppPort: (appId) => this.registry.clearPort(appId),
      getDetectedPath: (appId) => this.registry.getDetectedPath(appId),
      setDetectedPath: (appId, detectedPath) => this.registry.setDetectedPath(appId, detectedPath),
      persist: () => this.persist.safe(() => this.writeState()),
      activeThemeId: (appId) => this.registry.getActiveThemeId(appId),
      activeSchemeId: (appId) => this.registry.getActiveSchemeId(appId),
      livePortCache: this.livePortCache,
    };
  }

  /**
   * Build the {@link SchemeSyncDeps} slice that backs all calls into
   * `scheme-sync`.
   */
  private schemeSyncDeps(): SchemeSyncDeps {
    const withPageSessionDeps: WithPageSessionDeps = {
      adapter: (appId) => this.adapter(appId),
      resolveLivePort: (appId, knownDeadPort) =>
        resolveLivePort(appId, this.discoveryDeps(), knownDeadPort ?? null),
      isDisposed: () => this.disposed,
    };
    return {
      withPageSession: (appId, port, fn, retries) =>
        withPageSession(appId, port, fn, retries ?? 8, withPageSessionDeps),
      getSchemeSnapshot: (appId) => this.registry.getSchemeSnapshot(appId),
      setSchemeSnapshot: (appId, snapshot) => this.registry.setSchemeSnapshot(appId, snapshot),
      persist: () => this.persist.safe(() => this.writeState()),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      log: (line) => this.log(line),
      logStructured: (event) => this.logStructured(event),
    };
  }

  /**
   * Build the {@link WallpaperInjectorDeps} slice that backs all calls
   * into `wallpaper-injector`.
   */
  private wallpaperDeps(): WallpaperInjectorDeps {
    return {
      wallpaperService: this.wallpaperService,
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      bumpEpoch: (appId) => this.bumpEpoch(appId),
      resolveAgentWallpaperId: (appId, entry) => this.resolveAgentWallpaperId(appId, entry),
      ensureCdpReady: (appId, timeoutMs, forceRestart) =>
        ensureCdpReady(appId, this.discoveryDeps(), timeoutMs ?? 30000, forceRestart),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      inferRestartReason: (appId, cdpFailureReason) =>
        inferRestartReason(appId, this.discoveryDeps(), cdpFailureReason ?? null),
      findAgentTargets: (appId, port) => this.adapter(appId).findTargets(port, 1200),
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      rendererHints: (appId): RendererHints | undefined =>
        this.adapter(appId).rendererHints(),
      isApplyingTheme: (appId) => this.applyingTheme.has(appId),
      isDisposed: () => this.disposed,
      log: (line) => this.log(line),
    };
  }

  /**
   * Build the {@link CdpFanoutDeps} slice that backs all calls into
   * `cdp-fanout`.
   */
  private fanoutDeps(): CdpFanoutDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      tryEngineInjection: (session, appId, bundle, targetTheme, imageDataUrls, imageFilePaths) =>
        tryEngineInjection(session, appId, bundle, targetTheme, imageDataUrls, imageFilePaths, {
          resolveEngineDir: resolveEngineDirDefault,
          log: (line) => this.log(line),
          customThemeCss: () => this.settings.customThemeCss(),
          // RFC §4.8: per-agent verification tuning. Fast-applying agents can
          // lower the min verify delay (200ms) and poll interval (50ms default)
          // to shave latency off the hardening pass; the map is a no-op until
          // an agent is added here.
          verifyDelayMs: APPLY_VERIFY_DELAY_OVERRIDES[appId] ?? 500,
          verifyIntervalMs: DEFAULT_VERIFY_INTERVAL_MS,
        }),
      log: (line) => this.log(line),
      // Reuse target sessions across the fan-out sub-tasks within one epoch.
      sessions: this.cdpSessionPool,
      // Forward secondary-injection progress/summary to the renderer so the UI
      // can render a per-target injection timeline. The discriminator ('targetId'
      // vs 'injected') distinguishes progress events from the summary event.
      onSecondaryProgress: (event) => {
        const win = ctx.mainWindow;
        if (win && !win.isDestroyed()) {
          const channel =
            'targetId' in event
              ? IpcChannel.THEME_SECONDARY_INJECT_PROGRESS
              : IpcChannel.THEME_SECONDARY_INJECT_SUMMARY;
          win.webContents.send(channel, event);
        }
      },
    };
  }

  /**
   * Build the {@link RestoreFlowDeps} slice that backs the restore flow.
   */
  private restoreFlowDeps(): RestoreFlowDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isApplyingTheme: (appId) => this.applyingTheme.has(appId),
      lockAgent: (appId) => this.applyingTheme.add(appId),
      unlockAgent: (appId) => this.applyingTheme.delete(appId),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      bumpEpoch: (appId) => this.bumpEpoch(appId),
      getSchemeSnapshot: (appId) => this.registry.getSchemeSnapshot(appId),
      clearActiveTheme: (appId, port) => this.registry.clearActiveTheme(appId, port),
      persist: () => this.persist.safe(() => this.writeState()),
      setAgentWallpaper: (appId, setting) => this.settings.setAgentWallpaper(appId, setting),
      hardeningRemove: (appId, port, epoch) =>
        hardeningRemove(appId, port, epoch, this.fanoutDeps()),
      removeAgentVideoWallpaper: (appId, port, epoch) =>
        removeAgentVideoWallpaper(appId, port, epoch, this.wallpaperDeps()),
      restoreOriginalScheme: (appId, port, snapshot, epoch) =>
        restoreOriginalScheme(appId, port, snapshot, epoch, this.schemeSyncDeps()),
      cleanupModuleStateForAgent: (appId) => {
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
   */
  private applyFlowDeps(): ApplyFlowDeps {
    return {
      adapter: (appId) => this.adapter(appId),
      isApplyingTheme: (appId) => this.applyingTheme.has(appId),
      lockAgent: (appId) => this.applyingTheme.add(appId),
      unlockAgent: (appId) => this.applyingTheme.delete(appId),
      ensureCdpReady: (appId, timeoutMs, forceRestart) =>
        ensureCdpReady(appId, this.discoveryDeps(), timeoutMs ?? 30000, forceRestart),
      resolveLivePort: (appId) => resolveLivePort(appId, this.discoveryDeps()),
      inferRestartReason: (appId, cdpFailureReason) =>
        inferRestartReason(appId, this.discoveryDeps(), cdpFailureReason ?? null),
      cachedPort: (appId) => this.livePortCache.get(appId),
      baselineGet: (appId, url, themeId) => this.applyBaselineCache.get(appId, url, themeId),
      baselinePut: (snap) => this.applyBaselineCache.put(snap),
      baselineInvalidate: (appId) => this.applyBaselineCache.invalidate(appId),
      probeThemeLiveOnPort: (port) => probeThemeLiveOnPort(port),
      captureBaselineOnPort: (port, appId, themeId) => captureBaselineOnPort(port, appId, themeId),
      captureFingerprintOnPort: (port, appId, themeId, colors, themeDir) =>
        captureFingerprintOnPort(port, appId, themeId, colors, themeDir),
      findTheme: (themeId) => this.library.find(themeId),
      bumpEpoch: (appId) => this.bumpEpoch(appId),
      isEpochCurrent: (appId, captured) => this.epochs.isEpochCurrent(appId, captured),
      setActiveTheme: (appId, themeId, port, schemeId) => {
        this.registry.patchApp(appId, {
          activeThemeId: themeId,
          activeSchemeId: schemeId ?? null,
          port,
        });
      },
      persist: () => this.persist.safe(() => this.writeState()),
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

  // -----------------------------------------------------------------------
  // Persistence (delegates to PersistChain)
  // -----------------------------------------------------------------------

  /**
   * Serialise the current registry snapshot to disk.
   *
   * Persistence failures are logged and swallowed so a single failed write
   * does not poison the promise chain (which would stall all later writes).
   * On failure, the `lastPersistError()` signal is set and a `persist_failed`
   * structured-log event is emitted so the in-memory/disk desync window is
   * observable (additive — it does not change the swallow contract).
   */
  private async writeState(): Promise<void> {
    try {
      await writeJsonAtomic(this.stateFile, this.registry.snapshot() as PersistedState);
      this.lastPersistErrorMessage = null;
    } catch (error) {
      this.persistFailures++;
      const message = toMessage(error);
      this.lastPersistErrorMessage = message;
      this.log(`[state] persist failed: ${message}`);
      // Structured, locale-independent signal for operators/renderers so the
      // in-memory/disk desync window is observable even before the threshold
      // notification fires (additive — does not alter the swallow contract).
      this.logStructured({
        type: 'persist_failed',
        agentId: '*',
        timestamp: new Date().toISOString(),
        reason: message,
      });
      // Threshold-based notification: alert user after 3 consecutive failures
      if (this.persistFailures >= 3) {
        notifyPersistFailure(this.persistFailures);
      }
    }
  }

  /**
   * Message of the most recent persistence failure, or null when the last
   * write succeeded. Additive observability for the in-memory/disk desync
   * window; does not change persistence-failure handling semantics.
   */
  lastPersistError(): string | null {
    return this.lastPersistErrorMessage;
  }

  // -----------------------------------------------------------------------
  // State accessors (delegated to registry)
  // -----------------------------------------------------------------------

  /** Look up the adapter for an app id via the registry. */
  private adapter(appId: AgentId): ApplicationAdapter {
    return requireAdapter(appId);
  }

  portFor(appId: AgentId): number | null {
    return this.settings.overridesFor(appId).port ?? this.registry.getPort(appId);
  }

  activeThemeId(appId: AgentId): string | null {
    return this.registry.getActiveThemeId(appId);
  }

  /** Active color-scheme id for an agent (null/undefined = default colors). */
  activeSchemeId(appId: AgentId): string | null {
    return this.registry.getActiveSchemeId(appId);
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /** Cached status result with a TTL (ms). */
  private statusCache: SystemStatus | null = null;
  private statusCacheAt = 0;
  private static readonly STATUS_CACHE_TTL = 2000;

  /** Interval (ms) for pushing concurrency metrics to the renderer. */
  private static readonly METRICS_BROADCAST_INTERVAL_MS = 5000;

  async status(): Promise<SystemStatus> {
    const now = Date.now();
    if (this.statusCache && now - this.statusCacheAt < AgentEngineService.STATUS_CACHE_TTL) {
      return this.statusCache;
    }
    // RC5-S5-A: Use Promise.allSettled for per-agent error isolation.
    // A single agent's probeAppStatus failure should not prevent status()
    // from returning partial results for the other 5 agents.
    const settledResults = await Promise.allSettled(
      AGENT_IDS.map((appId) =>
        probeAppStatus(appId, this.discoveryDeps(), (id) => this.portFor(id)),
      ),
    );
    const apps: AppStatus[] = [];
    for (const [index, result] of settledResults.entries()) {
      if (result.status === 'fulfilled' && result.value) {
        apps.push(result.value);
      } else if (result.status === 'rejected') {
        // Log the individual agent's failure for debugging but continue.
        const appId = AGENT_IDS[index];
        this.log(`[status] ${appId}: probe failed — ${result.reason}`);
      }
      // fulfilled but undefined → skip (probeAppStatus contract says non-null, but be defensive)
    }
    const result = { platform: platform(), apps };
    this.statusCache = result;
    this.statusCacheAt = now;

    // Sync runtime fields to coordinator (change-detected to avoid no-op emits).
    // This ensures coordinator reflects apps started outside the launcher
    // (e.g., already running at boot, or spawned by ensureCdpReady).
    const coordinator = getAppRunStateCoordinator();
    for (const app of apps) {
      if (!app) continue; // Guard: probeAppStatus may return undefined in tests
      const prev = coordinator.getState(app.appId);
      if (
        !prev ||
        prev.running !== app.running ||
        prev.port !== app.port ||
        prev.debugReady !== app.debugReady
      ) {
        coordinator.updateState(app.appId, {
          running: app.running,
          pid: 0, // probeAppStatus doesn't return pid
          port: app.port,
          debugReady: app.debugReady,
        });
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Wallpaper entry points
  // -----------------------------------------------------------------------

  async applyAgentWallpaperNow(
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    return applyAgentWallpaperNowImpl(appId, this.wallpaperDeps(), options);
  }

  async applyWallpaperToAgent(
    wallpaperId: string,
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    return applyWallpaperToAgentImpl(wallpaperId, appId, this.wallpaperDeps(), options);
  }

  async removeWallpaperFromAgent(appId: AgentId): Promise<{ ok: boolean }> {
    return removeWallpaperFromAgentImpl(appId, this.wallpaperDeps());
  }

  // -----------------------------------------------------------------------
  // Apply / Restore orchestration
  // -----------------------------------------------------------------------

  async apply(request: ApplyRequest): Promise<ApplyResponse> {
    const appId = request.appId;
    const existing = this.inflightOperations.get(appId);
    if (existing && existing.kind === 'apply') {
      return existing.promise as Promise<ApplyResponse>;
    }
    if (existing && existing.kind === 'restore') {
      this.log(`[apply] ${appId}: restore in progress — queued behind in-flight restore`);
      try {
        await existing.cleanup;
      } catch (error) {
        this.log(
          `[apply] ${appId}: queued restore failed — proceeding anyway: ${toMessage(error)}`,
        );
      }
      // RC1-S1-B: Guard against disposed service before recursive call.
      // If dispose() fired during the await above, recursing would operate
      // on already-released resources (cdpSessionPool, livePortCache).
      if (this.disposed) {
        this.log(`[apply] ${appId}: service disposed during restore cleanup — aborting`);
        throw new Error('AgentEngineService disposed');
      }
      return this.apply(request);
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
    let promise!: Promise<ApplyResponse>;
    promise = (async () => {
      try {
        const { response, background } = await this.applyInternal(request);
        if (background) {
          void background.catch(() => undefined).finally(cleanupResolve);
        } else {
          cleanupResolve();
        }
        return response;
      } catch (error) {
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
    this.statusCache = null;
    return applyThemeFlowImpl(request, this.applyFlowDeps());
  }

  async restore(appId: AgentId): Promise<SystemStatus> {
    const existing = this.inflightOperations.get(appId);
    if (existing && existing.kind === 'restore') {
      return existing.promise as Promise<SystemStatus>;
    }
    if (existing && existing.kind === 'apply') {
      this.log(`[restore] ${appId}: apply in progress — queued behind in-flight apply`);
      try {
        await existing.cleanup;
      } catch (error) {
        this.log(
          `[restore] ${appId}: queued apply failed — proceeding anyway: ${toMessage(error)}`,
        );
      }
      // RC1-S1-B: Guard against disposed service before recursive call.
      if (this.disposed) {
        this.log(`[restore] ${appId}: service disposed during apply cleanup — aborting`);
        throw new Error('AgentEngineService disposed');
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
    this.statusCache = null;
    // Idempotent restore (RFC 2026-08-19 R4): when the agent has no active
    // theme AND no wallpaper preference, there is nothing to tear down —
    // skip the CDP round-trip entirely and return the current snapshot.
    // Repeated delete/restore calls (e.g. double-clicks, delete-then-restore
    // flows) are therefore safe no-ops instead of error paths.
    if (!this.registry.getActiveThemeId(appId) && !this.settings.agentWallpaper(appId)?.enabled) {
      this.log(`[restore] ${appId}: nothing to restore — no-op (idempotent)`);
      return this.status();
    }
    return restoreThemeFlowImpl(appId, this.restoreFlowDeps());
  }

  async restoreAll(): Promise<void> {
    // Collect agents that have either an active theme or a wallpaper preference.
    // restore() handles theme teardown + wallpaper-preference clearing, but for
    // wallpaper-only agents (no active theme) it does NOT call removeWallpaperFromAgent
    // — that requires a separate explicit call to remove the live wallpaper from
    // the running agent's DOM.
    const toRestore: AgentId[] = [];
    const wallpaperOnly: AgentId[] = [];
    for (const appId of AGENT_IDS) {
      if (this.registry.getActiveThemeId(appId)) {
        toRestore.push(appId);
      } else if (this.settings.agentWallpaper(appId)?.enabled) {
        toRestore.push(appId);
        wallpaperOnly.push(appId);
      }
    }
    // Phase 1: restore() for all agents with theme or wallpaper preference.
    await Promise.all(toRestore.map((appId) => this.restore(appId).catch(() => undefined)));
    // Phase 2: Explicit wallpaper removal for wallpaper-only agents.
    // restoreThemeFlow clears the preference (setAgentWallpaper) and removes
    // video wallpaper from DOM (removeAgentVideoWallpaper), but for image
    // wallpaper on wallpaper-only agents we need removeWallpaperFromAgent.
    await Promise.all(
      wallpaperOnly.map((appId) => this.removeWallpaperFromAgent(appId).catch(() => undefined)),
    );
  }

  // -----------------------------------------------------------------------
  // Theme reconciliation
  // -----------------------------------------------------------------------

  /**
   * Drop persisted active-theme references that no longer exist in the library.
   */
  async reconcileActiveThemes(availableIds: Set<string>): Promise<void> {
    let dirty = false;
    this.registry.forEachApp((appId, appState) => {
      if (appState?.activeThemeId && !availableIds.has(appState.activeThemeId)) {
        this.log(
          `[state] ${appId}: dropping reference to removed theme "${appState.activeThemeId}"`,
        );
        appState.activeThemeId = null;
        appState.activeSchemeId = null;
        dirty = true;
        return;
      }
      // RC5-S5-A: Guard against null activeThemeId generating 'null--schemeId' composite key.
      // When activeThemeId is null (cleared above or never set), there's no theme to look up
      // schemes for. Skip scheme reconciliation entirely in this case.
      if (
        appState?.activeSchemeId &&
        appState?.activeThemeId &&
        !availableIds.has(`${appState.activeThemeId}--${appState.activeSchemeId}`)
      ) {
        this.log(
          `[state] ${appId}: scheme "${appState.activeSchemeId}" of "${appState.activeThemeId}" no longer available, falling back to default`,
        );
        appState.activeSchemeId = null;
        dirty = true;
      }
    });
    if (dirty) await this.persist.safe(() => this.writeState());
  }

  // -----------------------------------------------------------------------
  // Concurrency-metrics broadcast
  // -----------------------------------------------------------------------

  collectConcurrencyMetrics(): ConcurrencyMetrics {
    return {
      companionBusyByAgent: this.cachedCompanionBusySize,
      inflightOperations: this.inflightOperations.size,
      selfHealingAgents: getSelfHealingAgentsSize(),
      capturedTokens: getCapturedTokensSize(),
      persistChainDepth: this.persist.depth,
      deferredSelfHeals: getDeferredSelfHealsSize(),
      switchEpochByAgent: this.cachedSwitchEpochSize,
      persistFailures: this.persistFailures,
    };
  }

  updateConcurrencyMetricsFromRenderer(companionBusy: number, switchEpoch: number): void {
    this.cachedCompanionBusySize = Math.max(0, companionBusy);
    this.cachedSwitchEpochSize = Math.max(0, switchEpoch);
  }

  private broadcastConcurrencyMetrics(): void {
    if (!this.sendMetricsToRenderer) return;
    try {
      this.sendMetricsToRenderer(this.collectConcurrencyMetrics());
    } catch (error) {
      this.log(`[metrics] broadcast failed: ${toMessage(error)}`);
    }
  }

  startConcurrencyMetricsTimer(sender: (metrics: ConcurrencyMetrics) => void): void {
    if (this.concurrencyMetricsTimer !== null) return;
    this.sendMetricsToRenderer = sender;
    this.concurrencyMetricsTimer = setInterval(() => {
      this.broadcastConcurrencyMetrics();
    }, AgentEngineService.METRICS_BROADCAST_INTERVAL_MS);
    this.broadcastConcurrencyMetrics();
  }

  stopConcurrencyMetricsTimer(): void {
    if (this.concurrencyMetricsTimer !== null) {
      clearInterval(this.concurrencyMetricsTimer);
      this.concurrencyMetricsTimer = null;
    }
    this.sendMetricsToRenderer = null;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    this.stopConcurrencyMetricsTimer();
    this.disposed = true;
    disposeWallpaperInjectionState();
    disposeEngineInjectionState();
    disposeSelfHealState();
    disposeReloadWatchdogs();
    disposeThemeAssetCache();
    this.applyingTheme.clear();
    this.inflightOperations.clear();
    this.cdpSessionPool.dispose();
    this.livePortCache.clearAll();
    this.statusCache = null;
    // RC3-S3-B: Reset persist failure counter so a future service instance
    // (if the lifecycle ever supports re-initialization) starts clean.
    this.persistFailures = 0;
    this.lastPersistErrorMessage = null;
  }
}
