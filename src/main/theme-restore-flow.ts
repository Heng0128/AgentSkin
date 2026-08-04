// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Restore Flow
 *
 * Extracted from `AgentEngineService` (P2-b of the god-object teardown).
 *
 * Owns the top-level restore orchestration that tears down a previously
 * applied theme:
 *   1. Defensive concurrency guard (skip if an apply is in-flight).
 *   2. Resolve the live CDP port — if unreachable, clear persisted state
 *      only (the CSS is session-scoped and dies with the renderer).
 *   3. Bump epoch so background tasks from the previous apply self-terminate.
 *   4. Remove engine injection (CSS layers + adapter.mjs + persistence
 *      script) from ALL DOM-bearing targets BEFORE the core restore.
 *   5. Core `adapter.restoreTheme(port)`.
 *   6. Best-effort teardown: secondary targets, video wallpaper, original
 *      light/dark scheme.
 *   7. Clear persisted state and emit a structured `theme_restore` event.
 *
 * Why a separate module: the restore flow sequences 6+ extracted sub-modules
 * (cdp-fanout, wallpaper-injector, scheme-sync, app-discovery, epoch-manager)
 * in a specific order with precise error-handling semantics. Isolating it
 * makes the sequence unit-testable with a mock deps slice, and keeps the
 * `AgentEngineService` facade focused on state ownership + deps wiring.
 *
 * Call chain:
 *   AgentEngineService.restore → restoreThemeFlow (this module)
 *     → resolveLivePort       (app-discovery)
 *     → hardeningRemove       (cdp-fanout)
 *     → adapter.restoreTheme  (adapters/*)
 *     → removeSecondaryTargets (cdp-fanout)
 *     → removeAgentVideoWallpaper (wallpaper-injector)
 *     → restoreOriginalScheme (scheme-sync)
 */

import type { ApplicationAdapter } from '../adapters/base';
import { toMessage } from '../shared/errors';
import type { AgentId, SystemStatus, WallpaperAgentSetting } from '../shared/types';
import type { SchemeSnapshot } from './agent-scheme';
import type { LogCallback, StructuredLogEvent } from './services/contracts';

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Dependency slice injected by {@link AgentEngineService} — the restore flow
 * touches state, epoch, CDP fan-out, wallpaper injection, and scheme sync,
 * so every collaborator is wired through this interface to keep the module
 * free of direct class references.
 *
 * The facade builds this slice once per call via a private `restoreFlowDeps()`
 * method, mirroring the `discoveryDeps()` / `schemeSyncDeps()` / etc. pattern
 * used by the other extracted modules.
 */
export interface RestoreFlowDeps {
  /** Look up the adapter for an app id via the registry. */
  adapter: (appId: AgentId) => ApplicationAdapter;

  // -- Concurrency guard -------------------------------------------------

  /** True when the agent is currently undergoing an apply (skip concurrent restore). */
  isApplyingTheme: (appId: AgentId) => boolean;
  /** Add the agent to the in-flight apply/restore lock. */
  lockAgent: (appId: AgentId) => void;
  /** Remove the agent from the in-flight apply/restore lock. */
  unlockAgent: (appId: AgentId) => void;

  // -- Port discovery ----------------------------------------------------

  /** Discover the live CDP port for an app (null if unreachable). */
  resolveLivePort: (appId: AgentId) => Promise<number | null>;

  // -- Epoch -------------------------------------------------------------

  /** Bump the epoch for an agent. Returns the new epoch value. */
  bumpEpoch: (appId: AgentId) => number;

  // -- Persisted state ---------------------------------------------------

  /** Read the persisted scheme snapshot for an agent (null when never captured). */
  getSchemeSnapshot: (appId: AgentId) => SchemeSnapshot | null;
  /** Clear the active theme for an agent and update its port. */
  clearActiveTheme: (appId: AgentId, port: number | null) => void;
  /** Persist the orchestrator state to disk. */
  persist: () => Promise<void>;

  // -- Settings ----------------------------------------------------------

  /** Set the agent's wallpaper preference. */
  setAgentWallpaper: (appId: AgentId, setting: WallpaperAgentSetting) => Promise<void>;

  // -- CDP fan-out / wallpaper / scheme teardown -------------------------

  /** Remove engine injection from all DOM-bearing CDP targets. */
  hardeningRemove: (appId: AgentId, port: number, epoch: number) => Promise<void>;
  /** Remove theme CSS from secondary CDP targets (webviews/iframes). */
  removeSecondaryTargets: (appId: AgentId, port: number, epoch: number) => Promise<void>;
  /** Remove any injected wallpaper (video/image) from the agent's page. */
  removeAgentVideoWallpaper: (appId: AgentId, port: number, epoch: number) => Promise<void>;
  /** Restore the user's original light/dark scheme (best-effort). */
  restoreOriginalScheme: (
    appId: AgentId,
    port: number,
    snapshot: SchemeSnapshot,
    epoch: number,
  ) => Promise<void>;

  // -- Module-state cleanup ---------------------------------------------

  /**
   * Drop per-agent tracking state held at module scope by the extracted
   * sub-modules (CDP persistence-script ids, wallpaper media tokens,
   * self-heal counters, etc). Called after a successful restore so the next
   * fresh apply starts from a clean slate, and so long-running tray apps
   * don't accumulate stale entries across thousands of theme switches.
   */
  cleanupModuleStateForAgent: (appId: AgentId) => void;

  // -- Status & logging --------------------------------------------------

  /** Build a read-only {@link SystemStatus} snapshot. */
  status: () => Promise<SystemStatus>;
  /** Plain log-line sink. */
  log: LogCallback;
  /** Structured log event sink (parsed by the renderer for progress UI). */
  logStructured: (event: StructuredLogEvent) => void;
}

// ---------------------------------------------------------------------------
// Restore flow
// ---------------------------------------------------------------------------

/**
 * Tear down a previously applied theme for `appId`.
 *
 * Sequences: epoch bump → hardening remove → core restore → secondary
 * teardown → scheme restore → state clear → persist.
 *
 * When no live CDP port is reachable (app closed or running without
 * `--remote-debugging-port`), the persisted state and wallpaper preference
 * are still cleared so the theme doesn't silently survive the restore. The
 * CSS itself is session-scoped (persistence script dies with the renderer
 * process), so for a fully-closed app nothing visual lingers.
 *
 * On core-restore failure the original `activeThemeId` is PRESERVED so the
 * user can retry — only a successful restore clears it.
 */
export async function restoreThemeFlow(
  appId: AgentId,
  deps: RestoreFlowDeps,
): Promise<SystemStatus> {
  const adapter = deps.adapter(appId);

  // Defensive has() check — see applyFlow for rationale.
  if (deps.isApplyingTheme(appId)) {
    deps.log(`[restore] ${appId}: apply in progress, skipping concurrent restore`);
    return deps.status();
  }

  const port = await deps.resolveLivePort(appId);
  if (port == null) {
    // No live CDP port (app closed or running without --remote-debugging-port).
    // We can't reach the renderer to remove the theme CSS, but we MUST still
    // clear the persisted state (activeThemeId, schemeSnapshot) and the
    // per-agent wallpaper preference — otherwise the theme silently survives
    // the "restore" and re-appears the next time the app starts. The CSS
    // itself is session-scoped (persistence script dies with the renderer
    // process), so for a fully-closed app nothing visual lingers. For an
    // app running without CDP, the CSS stays until the next restart, but
    // the state no longer lies about it being "applied".
    deps.log(`[restore] ${appId}: no live CDP port, clearing persisted state only`);
    const _epoch = deps.bumpEpoch(appId);
    deps.clearActiveTheme(appId, null);
    await deps.setAgentWallpaper(appId, { enabled: false, id: null });
    await deps.persist();
    deps.cleanupModuleStateForAgent(appId);
    deps.logStructured({
      type: 'theme_restore',
      agentId: appId,
      timestamp: new Date().toISOString(),
    });
    return deps.status();
  }

  deps.log(`[restore] ${appId} (port ${port})`);
  const snapshot = deps.getSchemeSnapshot(appId);

  // Bump epoch so any background tasks still running from the previous
  // apply/reapply self-terminate before they re-inject CSS or re-apply the
  // scheme that restore is about to tear down.
  const epoch = deps.bumpEpoch(appId);
  deps.lockAgent(appId);

  // Remove engine injection (CSS layers + adapter.mjs + persistence script)
  // from ALL DOM-bearing targets BEFORE the core restore. This ensures the
  // persistence script (Page.addScriptToEvaluateOnNewDocument) is torn down
  // first, otherwise it would re-apply the engine on the next navigation
  // even after the core restore succeeds. Must iterate the same target set
  // as hardeningPass (page, webview, iframe) so no surface is missed.
  await deps.hardeningRemove(appId, port, epoch).catch(() => undefined);
  try {
    await adapter.restoreTheme(port);
  } catch (error) {
    // Restoring when the app is closed still clears host settings state.
    // P2-8/N2: Previously this catch block returned early, which:
    //   1. Left the epoch bumped at its new value but no downstream cleanup used
    //      it (epoch looked "stale" to the next restore/apply, causing epoch
    //      check false-fails or background task misfires).
    //   2. Skipped removeSecondaryTargets / removeAgentVideoWallpaper /
    //      restoreOriginalScheme — leaving engine artifacts (CSS layers,
    //      hero blob URLs, CDP media emulation, video wallpaper <video> tag)
    //      in the DOM for the lifetime of the agent process.
    // We now log the failure and continue through all best-effort cleanup
    // steps so epoch is consumed symmetrically with the success path and
    // engine teardown still happens even if adapter-level restore barfed.
    deps.log(`[restore] ${appId}: ${toMessage(error)}`);
    deps.logStructured({
      type: 'restore_failed',
      agentId: appId,
      reason: toMessage(error),
      timestamp: new Date().toISOString(),
    });
  } finally {
    deps.unlockAgent(appId);
  }

  // Remove the theme CSS from secondary targets (webviews/iframes) too.
  // Best-effort — the main window is already restored by adapter.restoreTheme.
  await deps.removeSecondaryTargets(appId, port, epoch).catch(() => undefined);

  // Remove video wallpaper if one was injected.
  await deps.removeAgentVideoWallpaper(appId, port, epoch).catch(() => undefined);

  // Put the user's original light/dark scheme back (best-effort).
  // P1#2: Always call this — even when snapshot is null. The apply flow
  // unconditionally sets CDP prefers-color-scheme emulation via
  // emulateColorScheme() for ALL agents (including workbuddy, which has no
  // DOM strategy and therefore never produces a capturable snapshot from DOM
  // state). If we skip the call on null snapshot, the emulation is NEVER
  // cleared on workbuddy (and similar no-strategy agents), locking the app
  // in the wrong theme mode after restore. A synthetic minimal snapshot
  // still triggers restoreScheme's mandatory clearColorSchemeEmulation()
  // call after the DOM restoration step (which is a no-op for empty values).
  const snapshotOrFallback: SchemeSnapshot = snapshot ?? {
    agentId: appId,
    dataTheme: null,
    storage: {},
  };
  await deps.restoreOriginalScheme(appId, port, snapshotOrFallback, epoch);

  deps.clearActiveTheme(appId, port);
  await deps.persist();
  deps.cleanupModuleStateForAgent(appId);

  // Structured log for reliable parsing (locale-independent).
  deps.logStructured({
    type: 'theme_restore',
    agentId: appId,
    timestamp: new Date().toISOString(),
  });
  return deps.status();
}
