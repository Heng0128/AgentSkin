// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Apply Flow
 *
 * Extracted from `AgentEngineService` (P2-c of the god-object teardown).
 *
 * Owns the top-level apply orchestration that installs a theme onto an
 * agent application:
 *   1. Platform guard (throw on unsupported OS).
 *   2. Defensive concurrency guard (skip if another apply is in-flight).
 *   3. CDP discovery + conditional restart policy:
 *      - First attempt: probe for a live port only (no restart).
 *      - User-confirmed restart: `ensureCdpReady` may kill + relaunch with
 *        `--remote-debugging-port=0`.
 *      - No port found → return `requires-restart` with a structured reason.
 *   4. Core `adapter.applyTheme(bundle, { port, launch:false })`.
 *   5. Error mapping: `RESTART_REQUIRED` → `requires-restart`,
 *      `PORT_OCCUPIED` → `port-occupied`, everything else rethrown.
 *   6. Persist active-theme state.
 *   7. Non-blocking follow-ups: secondary-target injection, hardening pass,
 *      wallpaper injection, scheme sync (light/dark match).
 *   8. Emit structured `inject_done` + `theme_apply` events.
 *
 * Why a separate module: the apply flow is the single most complex operation
 * in the system — it sequences 7+ extracted sub-modules with precise
 * error-handling and CDP-discovery semantics. Isolating it makes the
 * sequence unit-testable with a mock deps slice, and keeps the
 * `AgentEngineService` facade focused on state ownership + deps wiring.
 *
 * Call chain:
 *   AgentEngineService.apply → applyThemeFlow (this module)
 *     → ensureCdpReady / resolveLivePort  (app-discovery)
 *     → inferRestartReason                (app-discovery)
 *     → adapter.applyTheme                (adapters/*)
 *     → injectSecondaryTargets            (cdp-fanout)
 *     → hardeningPass                     (cdp-fanout)
 *     → injectAgentWallpaperFromApply     (wallpaper-injector)
 *     → syncSchemeWithStability           (scheme-sync)
 */

import { dirname } from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { ERROR_CODES, type ThemeBundle } from '../legacy/agentskin-core-runtime';
import { isPort } from '../shared/cdp-discovery';
import { toMessage } from '../shared/errors';
import { getMainMessages } from '../shared/i18n';
import type {
  AgentId,
  ApplyRequest,
  ApplyResponse,
  SystemStatus,
  WallpaperAgentSetting,
} from '../shared/types';
import { resolveSchemeMode, type SchemeMode } from './agent-scheme';
import type { CdpReadyResult } from './app-discovery';
import type { ThemeColors } from './catalog/theme-manifest';
import type { BaselineSnapshot } from './cdp/apply-baseline';
import { ensureAgentCdpReady } from './cdp/cdp-ready';
import type { LogCallback, StructuredLogEvent, ThemeEntry } from './services/contracts';
import {
  type ApplyTraceBuilder,
  PerformanceRecorder,
  performanceLogger,
} from './services/performance';
import { inferModeFromColors, toInstalledTheme } from './theme-library';

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Dependency slice injected by {@link AgentEngineService} — the apply flow
 * touches state, epoch, CDP discovery, CDP fan-out, wallpaper injection,
 * scheme sync, and the theme library, so every collaborator is wired through
 * this interface to keep the module free of direct class references.
 *
 * The facade builds this slice once per call via a private `applyFlowDeps()`
 * method, mirroring the `restoreFlowDeps()` / `discoveryDeps()` / etc.
 * pattern used by the other extracted modules.
 */
export interface ApplyFlowDeps {
  // -- Adapter & concurrency ---------------------------------------------

  /** Look up the adapter for an app id via the registry. */
  adapter: (appId: AgentId) => ApplicationAdapter;
  /** True when the agent is currently undergoing an apply/restore (skip concurrent apply). */
  isApplyingTheme: (appId: AgentId) => boolean;
  /** Add the agent to the in-flight apply/restore lock. */
  lockAgent: (appId: AgentId) => void;
  /** Remove the agent from the in-flight apply/restore lock. */
  unlockAgent: (appId: AgentId) => void;

  // -- CDP discovery ------------------------------------------------------

  /** Ensure the app has a live CDP port, (re)starting it when permitted. */
  ensureCdpReady: (
    appId: AgentId,
    timeoutMs?: number,
    forceRestart?: boolean,
  ) => Promise<CdpReadyResult>;
  /** Discover the live CDP port for an app (null if unreachable). */
  resolveLivePort: (appId: AgentId) => Promise<number | null>;
  /** Infer a structured restart reason for the UI. */
  inferRestartReason: (
    appId: AgentId,
    cdpFailureReason: CdpReadyResult['reason'],
  ) => Promise<NonNullable<ApplyResponse['restartReason']>>;
  /**
   * Fast-path port source (RFC §4.2/§4.4). Returns a recently-confirmed live
   * CDP port for an app (30s TTL cache), or null. When non-null, the flow
   * skips CDP discovery + restart entirely and applies directly on this port.
   */
  cachedPort: (appId: AgentId) => number | null;

  // -- Fast-path baseline cache (RFC §4.5/§4.6) --------------------------

  /** Read a cached {@link BaselineSnapshot} for an agent+url+theme (null on miss/expiry). */
  baselineGet: (appId: AgentId, url: string, themeId: string) => BaselineSnapshot | null;
  /** Store a {@link BaselineSnapshot} (per-agent LRU(3) + 60s TTL). */
  baselinePut: (snap: BaselineSnapshot) => void;
  /** Invalidate baseline cache entries for an agent (probe failure / epoch flip). */
  baselineInvalidate: (appId: AgentId) => void;
  /** §4.6 light theme-live probe on the main DOM target of a port. */
  probeThemeLiveOnPort: (port: number) => Promise<boolean>;
  /** Capture a {@link BaselineSnapshot} from the main DOM target of a port. */
  captureBaselineOnPort: (
    port: number,
    appId: AgentId,
    themeId: string,
  ) => Promise<BaselineSnapshot | null>;
  /**
   * Capture fingerprint, detect drift, and conditionally dispatch regen.
   * P3 self-healing loop integration: runs as a background task after apply.
   */
  captureFingerprintOnPort: (
    port: number,
    appId: AgentId,
    themeId: string,
    colors: ThemeColors,
    themeDir: string,
  ) => Promise<void>;

  // -- Theme library -----------------------------------------------------

  /** Look up a theme package by id. Throws if not found. */
  findTheme: (themeId: string) => Promise<ThemeEntry>;

  // -- Epoch -------------------------------------------------------------

  /** Bump the epoch for an agent. Returns the new epoch value. */
  bumpEpoch: (appId: AgentId) => number;
  /** True if `captured` is still the current epoch for `appId`. Used by
   *  non-blocking follow-ups (hardening → wallpaper chain) to self-
   *  terminate when a newer operation has superseded them. */
  isEpochCurrent: (appId: AgentId, captured: number) => boolean;

  // -- Persisted state ---------------------------------------------------

  /** Set the active theme (and optional color-scheme) for an agent
   *  (preserves existing schemeSnapshot). */
  setActiveTheme: (appId: AgentId, themeId: string, port: number, schemeId?: string) => void;
  /** Persist the orchestrator state to disk. */
  persist: () => Promise<void>;

  // -- Settings ----------------------------------------------------------

  /** The user-set app path override for an agent (null when not overridden). */
  getAppPath: (appId: AgentId) => string | null;
  /** Set the agent's wallpaper preference. */
  setAgentWallpaper: (appId: AgentId, setting: WallpaperAgentSetting) => Promise<void>;

  // -- CDP fan-out (non-blocking follow-ups) -----------------------------

  /**
   * Secondary-target injection (webview/iframe CSS-only). Backward-compatible
   * alias for {@link hardeningPass} — kept in the deps interface so existing
   * test mocks continue to work. New code should use `hardeningPass` directly.
   */
  injectSecondaryTargets: (
    appId: AgentId,
    port: number,
    bundle: ThemeBundle,
    epoch: number,
  ) => Promise<void>;

  /** Hardening pass: re-inject page targets via engine layers + inject
   *  webview/iframe targets with lightweight CSS, then verify. */
  hardeningPass: (
    appId: AgentId,
    port: number,
    bundle: ThemeBundle,
    epoch: number,
  ) => Promise<void>;

  // -- Wallpaper ---------------------------------------------------------

  /** Inject the resolved wallpaper into the agent's page (from apply flow). */
  injectAgentWallpaperFromApply: (
    appId: AgentId,
    port: number,
    entry: ThemeEntry,
    epoch: number,
  ) => Promise<void>;

  // -- Scheme sync -------------------------------------------------------

  /** Stability-window scheme sync (initial + 2s/5s/10s re-checks). */
  syncSchemeWithStability: (
    appId: AgentId,
    port: number,
    mode: SchemeMode,
    epoch: number,
  ) => Promise<void>;

  // -- Status & logging --------------------------------------------------

  /** Build a read-only {@link SystemStatus} snapshot. */
  status: () => Promise<SystemStatus>;
  /** Product display name for an agent (never leaks internal ids). */
  displayName: (appId: AgentId) => string;
  /** Plain log-line sink. */
  log: LogCallback;
  /** Structured log event sink (parsed by the renderer for progress UI). */
  logStructured: (event: StructuredLogEvent) => void;
}

// ---------------------------------------------------------------------------
// Apply flow
// ---------------------------------------------------------------------------

/**
 * Apply a theme to an agent application.
 *
 * Dispatcher between two execution chains (RFC §4.4):
 *
 *   - **Fast path** ({@link fastApplyThemeFlow}): reuses a recently-confirmed
 *     live CDP port from the 30s TTL cache, skipping process detection, port
 *     scan, restart, and full baseline snapshot. This is the theme-switch hot
 *     path (~500–1000ms instead of 2000–4000ms).
 *   - **Full-init path**: probes/restarts the app via `ensureCdpReady` then
 *     applies. Used on first apply / after a restart / when the cache misses.
 *
 * Both chains converge on {@link applyOnResolvedPort}, which owns the core
 * `adapter.applyTheme` call, error mapping, state persist, and the
 * non-blocking follow-ups (secondary injection, hardening, wallpaper, scheme
 * sync).
 *
 * Returns `requires-restart` when no CDP port is reachable so the UI can show
 * a confirmation dialog — the app is never silently killed on the first
 * attempt. Only when `request.restartExisting === true` is `ensureCdpReady`
 * allowed to kill + relaunch with `--remote-debugging-port=0`.
 *
 * Error mapping (in `applyOnResolvedPort`):
 *   - `RESTART_REQUIRED` → `{ status: 'requires-restart', ... }`
 *   - `PORT_OCCUPIED`    → `{ status: 'port-occupied', ... }`
 *   - Everything else is rethrown for the IPC layer to surface.
 */
export async function applyThemeFlow(
  request: ApplyRequest,
  deps: ApplyFlowDeps,
): Promise<{ response: ApplyResponse; background: Promise<void> }> {
  const copy = getMainMessages();

  // Platform guard
  const supportedPlatform = process.platform === 'darwin' || process.platform === 'win32';
  if (!supportedPlatform) throw new Error(copy.unsupportedPlatform);

  const appId = request.appId;

  // Defensive: the dedup wrapper should have prevented a concurrent entry,
  // but applyingTheme is also checked here so the lock holds even if a
  // future caller bypasses the wrapper (e.g. a direct applyInternal call
  // from boot).
  if (deps.isApplyingTheme(appId)) {
    deps.log(`[apply] ${appId}: already applying, skipping concurrent call`);
    return {
      response: { status: 'skipped-concurrent', message: '', system: await deps.status() },
      background: Promise.resolve(),
    };
  }

  // Fast path (RFC §4.4): try the cached-live-port chain first. When it
  // returns non-null, the apply completed on the cached port and skipped CDP
  // discovery + restart entirely. Returns null on a cache miss (first apply /
  // after a restart), in which case we fall through to full discovery.
  const fast = await fastApplyThemeFlow(request, deps);
  if (fast) return fast;

  // -- Full-init path ------------------------------------------------------
  // CDP discovery + (conditional) restart policy — unified with the wallpaper
  // flow via ensureAgentCdpReady:
  //
  //   - If the user has NOT confirmed a restart (restartExisting !== true),
  //     we only probe for a live CDP port. If none is found we return
  //     `requires-restart` so the UI can show a confirmation dialog — we never
  //     silently kill an app the user may be working in.
  //   - If the user HAS confirmed (restartExisting === true), ensureCdpReady
  //     is allowed to kill and relaunch the app with --remote-debugging-port=0
  //     (or launch a not-running app from its install path).
  //
  // This two-phase flow guarantees an app is only ever restarted after an
  // explicit user "Restart & apply" click, not on the first apply attempt.
  //
  // -- Performance trace (observation only; never changes apply behavior) --
  // Created only for the full-init path; the fast path starts its own trace
  // (no cdpDiscovery step). Wraps key sequential phases with high-resolution
  // timing so we can pinpoint latency bottlenecks. The trace uses internal
  // re-throw, so control flow and error handling are identical with/without it.
  const trace = PerformanceRecorder.start(appId, request.themeId);
  let traceFinished = false;
  const finishTrace = () => {
    if (traceFinished) return;
    traceFinished = true;
    const t = trace.finish();
    // Structured log: ring-buffered for Diagnostics UI consumption.
    performanceLogger.log(t);
  };

  try {
    const cdp = await trace.step('cdpDiscovery', (addSubStep) => {
      // findExistingPort probes for a live CDP endpoint on the agent.
      // The CDP handshake and target enumeration are internal to
      // ensureAgentCdpReady today; per-phase decomposition will be added
      // when that module exposes granular timing hooks.
      const t0 = performance.now();
      return ensureAgentCdpReady(appId, deps, {
        restartExisting: request.restartExisting === true,
      }).then((r) => {
        addSubStep('findExistingPort', performance.now() - t0);
        return r;
      });
    });
    if (cdp.status === 'requires-restart') {
      deps.log(
        `[apply] ${appId}: no live CDP port${request.restartExisting ? ` (restart failed: ${cdp.restartReason})` : ' (not running with --remote-debugging-port)'}`,
      );
      finishTrace();
      return {
        response: {
          status: 'requires-restart',
          message: copy.cdpNotDetectedMessage,
          system: await deps.status(),
          restartReason: cdp.restartReason,
        },
        background: Promise.resolve(),
      };
    }
    if (!isPort(cdp.port)) throw new Error(copy.invalidCdpPort);
    return await applyOnResolvedPort(request, deps, cdp.port, 'discovered', trace, finishTrace);
  } catch (error) {
    finishTrace();
    throw error;
  }
}

/**
 * Fast-path apply chain (RFC §4.4): reuse a recently-confirmed live CDP port
 * from the 30s TTL cache and apply directly on it, skipping process detection,
 * port scan, restart, and full baseline snapshot.
 *
 * Returns the apply result when a cached live port is available, or `null`
 * when the cache misses so the caller falls through to full discovery.
 *
 * The port's stability is guarded by the 30s TTL cache in `app-discovery`,
 * and the port was re-verified with a cheap probe before it ever entered the
 * cache. The actual apply (including epoch bump + follow-ups) is delegated to
 * {@link applyOnResolvedPort} — the same core the full-init path uses, so both
 * chains share identical correctness semantics.
 */
export async function fastApplyThemeFlow(
  request: ApplyRequest,
  deps: ApplyFlowDeps,
): Promise<{ response: ApplyResponse; background: Promise<void> } | null> {
  const appId = request.appId;
  let port: number | null | undefined = request.port;
  if (!port) {
    const cached = deps.cachedPort(appId);
    if (cached && isPort(cached)) {
      deps.log(`[apply] ${appId}: fast path — reusing live port ${cached}`);
      port = cached;
    }
  }
  if (!isPort(port)) return null;

  const trace = PerformanceRecorder.start(appId, request.themeId);
  let traceFinished = false;
  const finishTrace = () => {
    if (traceFinished) return;
    traceFinished = true;
    performanceLogger.log(trace.finish());
  };
  try {
    return await applyOnResolvedPort(request, deps, port, 'cache', trace, finishTrace);
  } catch (error) {
    finishTrace();
    throw error;
  }
}

/**
 * Shared apply core used by both the fast and full-init chains once a target
 * port is resolved. Owns: bundle resolution → epoch bump → `adapter.applyTheme`
 * (with error mapping) → state persist → non-blocking follow-ups (secondary
 * inject, hardening, wallpaper, scheme sync) → structured events.
 *
 * `source` distinguishes the execution chain ('cache' | 'discovered') for
 * diagnostics; it never changes apply behavior.
 */
async function applyOnResolvedPort(
  request: ApplyRequest,
  deps: ApplyFlowDeps,
  port: number,
  source: 'cache' | 'discovered',
  trace: ApplyTraceBuilder,
  finishTrace: () => void,
): Promise<{ response: ApplyResponse; background: Promise<void> }> {
  // Collect fire-and-forget follow-up promises so the caller can track when
  // the entire chain (applyTheme + hardening + wallpaper + scheme sync) has
  // fully settled.  These were previously detached `void` chains that kept
  // executing after the ApplyResponse returned — racing restore operations.
  const backgroundTasks: Promise<unknown>[] = [];
  const copy = getMainMessages();
  const appId = request.appId;
  const adapter = deps.adapter(appId);

  // Resolve the bundle id. Scheme variants install under `<themeId>--<schemeId>`
  // (see ThemeInstaller); requesting a scheme resolves to that variant, while
  // the default scheme uses the plain theme id.
  const resolvedThemeId = request.schemeId
    ? `${request.themeId}--${request.schemeId}`
    : request.themeId;
  const entry = await trace.step('resolveTheme', () => deps.findTheme(resolvedThemeId));

  // CDP is guaranteed live at this point (either from the cache or after
  // ensureCdpReady restarted the app and waited for a port). Inject CSS
  // directly via the existing connection — launch:false skips core's own
  // launch/restart, which would otherwise fight the port we just resolved.
  deps.log(`[apply] ${entry.bundle.theme.id} -> ${appId} (port ${port}, ${source} path)`);

  // Bump epoch before applying so any background tasks still running from a
  // previous apply/restore/reapply will see the epoch flip and self-terminate
  // before they touch the CDP target again.
  const epoch = deps.bumpEpoch(appId);
  deps.lockAgent(appId);
  deps.logStructured({
    type: 'inject_start',
    agentId: appId,
    themeId: entry.bundle.theme.id,
    timestamp: new Date().toISOString(),
    progress: 60,
  });
  try {
    await trace.step('applyTheme', () => {
      // The adapter's applyTheme is a single black-box call that internally
      // sequences: createStylesheet → injectPalette → injectTokens →
      // injectCosmetic → injectTheme → verify. The parent step records the
      // real wall-clock duration; per-phase decomposition is deferred until
      // adapters expose per-hook timing callbacks.
      return adapter.applyTheme(entry.bundle, {
        port,
        launch: false,
        appPath: deps.getAppPath(appId),
        restartExisting: false,
      });
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = toMessage(error);
    deps.log(`[apply] ${appId} failed${code ? ` [${code}]` : ''}: ${message}`);
    deps.logStructured({
      type: 'apply_failed',
      agentId: appId,
      themeId: entry.bundle.theme.id,
      reason: code ? `${code}: ${message}` : message,
      timestamp: new Date().toISOString(),
    });
    if (code === ERROR_CODES.RESTART_REQUIRED) {
      finishTrace();
      return {
        response: {
          status: 'requires-restart',
          message: copy.restartRequiredMessage,
          system: await deps.status(),
        },
        background: Promise.resolve(),
      };
    }
    // An occupied port is not fixed by restarting the target app, so it must
    // not funnel into the restart dialog.
    if (code === ERROR_CODES.PORT_OCCUPIED) {
      const occupiedPort = (error as { port?: number }).port ?? port;
      finishTrace();
      return {
        response: {
          status: 'port-occupied',
          message: copy.portOccupiedMessage(occupiedPort),
          system: await deps.status(),
        },
        background: Promise.resolve(),
      };
    }
    throw error;
  } finally {
    deps.unlockAgent(appId);
  }

  // Persist the user-facing theme id (base, without the scheme suffix) plus
  // the optional scheme id so restore and the UI can reconstruct the exact
  // applied variant.
  deps.setActiveTheme(appId, request.themeId, port, request.schemeId);
  await trace.step('persist', () => deps.persist());

  // Inject the theme into webview/iframe targets inside hardeningPass (below)
  // — its loop applies the engine layers to page targets and lightweight CSS
  // to webview/iframe targets in a single pass, so there is no separate
  // secondary-target step.

  // Wallpaper: "last applied wins". Sync per-agent setting to match the
  // theme's wallpaper state so restarts restore the correct wallpaper.
  const installed = toInstalledTheme(entry);
  const themeWp = installed.wallpaper;
  const wpId = themeWp
    ? (themeWp.workshopId ?? (themeWp.video ? `theme:${installed.id}` : null))
    : null;
  if (wpId) {
    await deps.setAgentWallpaper(appId, { enabled: true, id: wpId });
  } else {
    // Theme has no wallpaper — clear stale per-agent setting.
    await deps.setAgentWallpaper(appId, { enabled: false, id: null });
  }

  // Hardening pass: re-inject via adoptedStyleSheets (bypasses Doubao's
  // MutationObserver anti-tamper) and verify the theme actually took effect.
  //
  // Wallpaper inject is chained AFTER hardening via .then() — this ordering
  // matters for P3#1 (hardening vs wallpaper race). hardeningPass appends a
  // new theme sheet to adoptedStyleSheets, which would win over the
  // punch-through sheet on source order and hide the wallpaper. At the end
  // of hardening it re-moves the punch-through sheet to the END of
  // adoptedStyleSheets, restoring its priority. If wallpaper injection ran
  // in parallel with hardening, the freshly-created wallpaper container
  // (with z-index -1 + transparent body) could be covered by the theme's
  // body::before art-layer because punch-through was re-appended BEFORE the
  // new wallpaper mount script ran.
  //
  // Chaining guarantees: hardening sheet append → punch-through re-append
  // → wallpaper container create → nothing else touches adoptedStyleSheets.
  // Both operations stay non-blocking (fire-and-forget); the caller does
  // not await them so the "applied" response still returns promptly.
  backgroundTasks.push(
    deps.hardeningPass(appId, port, entry.bundle, epoch).then(() => {
      if (!deps.isEpochCurrent(appId, epoch)) return;
      return deps.injectAgentWallpaperFromApply(appId, port, entry, epoch);
    }),
  );

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
    const livePort = (await deps.resolveLivePort(appId)) ?? port;
    // Best-effort and non-blocking: the theme CSS is already applied, so the
    // "applied" response returns immediately while the agent's light/dark
    // scheme is matched a moment later. After the initial sync, a stability
    // window re-checks at 2s/5s/10s to catch apps that overwrite our mode
    // setting during their own render cycle.
    backgroundTasks.push(deps.syncSchemeWithStability(appId, livePort, schemeMode, epoch));
  }

  // Baseline seeding + light probe (RFC §4.5/§4.6). Best-effort background
  // task: capture a BaselineSnapshot for this url+theme (seeding the fast-path
  // cache so a later theme switch can reuse the verified DOM state), then run
  // the §4.6 light probe to confirm the theme is actually live. A probe
  // failure invalidates the agent's baseline cache, forcing a future apply to
  // fall back to full initialization instead of trusting a stale baseline.
  //
  // Non-blocking so the hot path still returns promptly; both capture and
  // probe are best-effort (captureBaselineOnPort / probeThemeLiveOnPort never
  // throw). Guarded by the epoch so a newer operation can't have its baseline
  // written over a superseding apply instance.
  backgroundTasks.push(
    (async () => {
      if (!deps.isEpochCurrent(appId, epoch)) return;
      const snap = await deps.captureBaselineOnPort(port, appId, resolvedThemeId);
      if (snap) deps.baselinePut(snap);
      if (!deps.isEpochCurrent(appId, epoch)) return;
      const live = await deps.probeThemeLiveOnPort(port);
      if (!live) {
        deps.log(`[apply] ${appId}: light probe failed — invalidating baseline cache`);
        deps.baselineInvalidate(appId);
      }
    })(),
  );

  // P3 self-healing loop: fingerprint capture + drift detection + conditional
  // regen dispatch. Best-effort background task (non-blocking). Captures the
  // current fingerprint from the live CDP session, compares against baseline,
  // and conditionally triggers regeneration if drift exceeds threshold.
  //
  // Guarded by the epoch so a newer operation can't have its fingerprint
  // written over a superseding apply instance. Uses the theme package
  // directory for baseline persistence.
  const themeDir = dirname(entry.filePath);
  const themeColors = installed.colors as unknown as ThemeColors;
  backgroundTasks.push(
    (async () => {
      if (!deps.isEpochCurrent(appId, epoch)) return;
      try {
        await deps.captureFingerprintOnPort(port, appId, resolvedThemeId, themeColors, themeDir);
      } catch (error) {
        // Best-effort: never crash the apply flow
        deps.log(`[apply] ${appId}: fingerprint capture failed: ${toMessage(error)}`);
      }
    })(),
  );

  deps.log(`[apply] ${entry.bundle.theme.id} applied to ${appId}`);
  // Structured log for reliable parsing (locale-independent).
  deps.logStructured({
    type: 'inject_done',
    agentId: appId,
    themeId: entry.bundle.theme.id,
    timestamp: new Date().toISOString(),
    progress: 100,
  });
  deps.logStructured({
    type: 'theme_apply',
    agentId: appId,
    themeId: entry.bundle.theme.id,
    timestamp: new Date().toISOString(),
  });
  return {
    response: {
      status: 'applied',
      message: copy.themeApplied(entry.bundle.theme.displayName, deps.displayName(appId)),
      system: await deps.status(),
    },
    background: Promise.allSettled(backgroundTasks).then((results) => {
      // Finalize the trace AFTER background tasks settle so the trace
      // captures the full apply duration including hardening/wallpaper/scheme.
      finishTrace();
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        const reasons = failed
          .map(
            (f) =>
              (f as PromiseRejectedResult).reason?.message ??
              String((f as PromiseRejectedResult).reason),
          )
          .join('; ');
        deps.log(`[apply] ${appId}: ${failed.length} background task(s) failed: ${reasons}`);
      }
    }),
  };
}
