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
import { ensureAgentCdpReady } from './cdp/cdp-ready';
import type { LogCallback, StructuredLogEvent, ThemeEntry } from './services/contracts';
import { PerformanceRecorder, performanceLogger } from './services/performance';
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
  ensureCdpReady: (appId: AgentId, timeoutMs?: number) => Promise<CdpReadyResult>;
  /** Discover the live CDP port for an app (null if unreachable). */
  resolveLivePort: (appId: AgentId) => Promise<number | null>;
  /** Infer a structured restart reason for the UI. */
  inferRestartReason: (
    appId: AgentId,
    cdpFailureReason: CdpReadyResult['reason'],
  ) => Promise<NonNullable<ApplyResponse['restartReason']>>;

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

  /** Inject theme CSS into secondary CDP targets (webviews/iframes). */
  injectSecondaryTargets: (
    appId: AgentId,
    port: number,
    bundle: ThemeBundle,
    epoch: number,
  ) => Promise<void>;
  /** Hardening pass: re-inject via adoptedStyleSheets + verify. */
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
 * Sequences: platform guard → concurrency guard → CDP discovery →
 * core apply → error mapping → state persist → non-blocking follow-ups
 * (secondary inject, hardening, wallpaper, scheme sync) → structured events.
 *
 * Returns `requires-restart` when no CDP port is reachable so the UI can
 * show a confirmation dialog — the app is never silently killed on the
 * first attempt. Only when `request.restartExisting === true` is
 * `ensureCdpReady` allowed to kill + relaunch with
 * `--remote-debugging-port=0`.
 *
 * Error mapping:
 *   - `RESTART_REQUIRED` → `{ status: 'requires-restart', ... }`
 *   - `PORT_OCCUPIED`    → `{ status: 'port-occupied', ... }`
 *   - Everything else is rethrown for the IPC layer to surface.
 */
export async function applyThemeFlow(
  request: ApplyRequest,
  deps: ApplyFlowDeps,
): Promise<{ response: ApplyResponse; background: Promise<void> }> {
  // Collect fire-and-forget follow-up promises so the caller can track when
  // the entire chain (applyTheme + hardening + wallpaper + scheme sync) has
  // fully settled.  These were previously detached `void` chains that kept
  // executing after the ApplyResponse returned — racing restore operations.
  const backgroundTasks: Promise<unknown>[] = [];
  const copy = getMainMessages();

  // Platform guard
  const supportedPlatform = process.platform === 'darwin' || process.platform === 'win32';
  if (!supportedPlatform) throw new Error(copy.unsupportedPlatform);

  const appId = request.appId;
  const adapter = deps.adapter(appId);

  // -- Performance trace (observation only; never changes apply behavior) --
  // Wraps key sequential phases with high-resolution timing so we can
  // pinpoint latency bottlenecks. The trace uses internal re-throw, so
  // control flow and error handling are identical with or without tracing.
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
    // Defensive: the dedup wrapper should have prevented a concurrent entry,
    // but applyingTheme is also checked here so the lock holds even if a
    // future caller bypasses the wrapper (e.g. a direct applyInternal call
    // from boot).
    if (deps.isApplyingTheme(appId)) {
      deps.log(`[apply] ${appId}: already applying, skipping concurrent call`);
      finishTrace();
      return {
        response: { status: 'applied', message: '', system: await deps.status() },
        background: Promise.resolve(),
      };
    }

    // CDP discovery + (conditional) restart policy — unified with the wallpaper
    // flow via {@link ensureAgentCdpReady}:
    //
    //   - If the user has NOT confirmed a restart (restartExisting !== true),
    //     we only probe for a live CDP port via resolveLivePort. If none is
    //     found we return `requires-restart` so the UI can show a confirmation
    //     dialog — we never silently kill an app the user may be working in.
    //   - If the user HAS confirmed (restartExisting === true), ensureCdpReady
    //     is allowed to kill and relaunch the app with --remote-debugging-port=0
    //     (or launch a not-running app from its install path).
    //
    // This two-phase flow guarantees an app is only ever restarted after an
    // explicit user "Restart & apply" click, not on the first apply attempt.
    let port: number | null | undefined = request.port;
    if (!port) {
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
      port = cdp.port;
    }
    if (!isPort(port)) throw new Error(copy.invalidCdpPort);

    // Resolve the bundle id. Scheme variants install under `<themeId>--<schemeId>`
    // (see ThemeInstaller); requesting a scheme resolves to that variant, while
    // the default scheme uses the plain theme id.
    const resolvedThemeId = request.schemeId
      ? `${request.themeId}--${request.schemeId}`
      : request.themeId;
    const entry = await trace.step('resolveTheme', () => deps.findTheme(resolvedThemeId));

    // CDP is guaranteed live at this point (ensureCdpReady either found an
    // existing port or restarted the app and waited for one). Inject CSS
    // directly via the existing connection — launch:false skips core's own
    // launch/restart, which would otherwise fight the port we just resolved.
    deps.log(`[apply] ${entry.bundle.theme.id} -> ${appId} (port ${port})`);

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

    // Inject the theme CSS into secondary targets (MCP webviews, ardot
    // iframes) that the core's matchTarget/preflight filter out. Non-blocking
    // and best-effort — the main page is already themed, the response can
    // return immediately while embedded content is themed a moment later.
    backgroundTasks.push(deps.injectSecondaryTargets(appId, port, entry.bundle, epoch));

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
    finishTrace();
    return {
      response: {
        status: 'applied',
        message: copy.themeApplied(entry.bundle.theme.displayName, deps.displayName(appId)),
        system: await deps.status(),
      },
      background: Promise.allSettled(backgroundTasks).then((results) => {
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
  } catch (error) {
    finishTrace();
    throw error;
  }
}
