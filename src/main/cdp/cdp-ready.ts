// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-ready — Unified agent CDP readiness (shared by theme + wallpaper apply)
 *
 * Both the theme apply flow (`applyThemeFlow`) and the wallpaper apply flow
 * (`applyAgentWallpaperNow` / `applyWallpaperToAgent`) need the same answer to
 * the same question: **"does this agent have a live CDP endpoint, and if not,
 * what does the user need to do?"**
 *
 * Previously the two flows hand-mirrored this logic with subtly different
 * semantics (wallpaper returned coarse string reasons, theme returned a
 * structured `restartReason`; the wallpaper entries even disagreed on the
 * `not-installed` naming). This module is the single source of truth:
 *
 *   - **Phase 1 (default)** — probe via `resolveLivePort`. If no CDP port is
 *     found we classify the situation:
 *       - `not-running` (installed, not started) → **auto-launch the app**
 *         via `ensureCdpReady` (which spawns a not-running agent with CDP).
 *         Starting an app the user asked to apply to is NOT a restart — no
 *         confirmation needed.
 *       - `no-cdp` (running WITHOUT a debug port) → returning
 *         `requires-restart` so the UI shows a confirmation dialog — killing
 *         a running app is destructive and needs consent.
 *       - `not-installed` / `spawn-failed` → `requires-restart` so the UI
 *         can guide the user (install / retry).
 *   - **Phase 2 (after the user confirms a restart)** — `restartExisting:
 *     true` allows `ensureCdpReady` to kill + relaunch the agent with
 *     `--remote-debugging-port=0`.
 *
 * Net effect: the ONLY time the user sees a restart/launch confirmation is
 * when the agent is already running without a debug port (a real restart).
 * A first click on an idle agent just starts it and applies.
 */

import type { AgentId, RestartReason } from '../../shared/types';
import type { CdpReadyResult } from '../app-discovery';

/** The discovery slice both apply flows already wire from
 *  `AgentEngineService` (identical implementations in `applyFlowDeps` and
 *  `wallpaperDeps`). */
export interface CdpReadyDeps {
  /** Re-resolve the live CDP port for an agent (probe only, no side effects). */
  resolveLivePort: (appId: AgentId) => Promise<number | null>;
  /** Ensure the agent has a live CDP endpoint — may kill + relaunch (or
   *  launch a not-running agent) with `--remote-debugging-port=0`. */
  ensureCdpReady: (appId: AgentId, timeoutMs?: number) => Promise<CdpReadyResult>;
  /** Infer a structured {@link RestartReason} when no live port is found.
   *  `cdpFailureReason` is null when `ensureCdpReady` was not attempted (pure
   *  probe path). */
  inferRestartReason: (
    appId: AgentId,
    cdpFailureReason: CdpReadyResult['reason'],
  ) => Promise<RestartReason>;
  /** Best-effort log line sink. */
  log: (line: string) => void;
}

/** Result of the unified CDP readiness check. Discriminated on `status` so a
 *  `ready` result always carries a non-null port. */
export type AgentCdpReadyResult =
  | { port: number; status: 'ready' }
  | { port: null; status: 'requires-restart'; restartReason: RestartReason };

/**
 * Resolve a live CDP endpoint for an agent under the unified CDP policy.
 * See the module docblock for the full semantics.
 *
 * @param appId  Agent to prepare.
 * @param deps   The discovery slice (resolveLivePort / ensureCdpReady /
 *               inferRestartReason / log).
 * @param options
 *   - `restartExisting` — when true, the user has already confirmed a
 *     restart, so `ensureCdpReady` may kill + relaunch the running app.
 *   - `timeoutMs` — CDP-ready wait when launching/restarting (default 30s).
 */
export async function ensureAgentCdpReady(
  appId: AgentId,
  deps: CdpReadyDeps,
  options: { restartExisting?: boolean; timeoutMs?: number } = {},
): Promise<AgentCdpReadyResult> {
  const { restartExisting = false, timeoutMs = 30_000 } = options;

  if (restartExisting) {
    // User confirmed the restart — allowed to kill + relaunch with CDP enabled.
    const cdpResult = await deps.ensureCdpReady(appId, timeoutMs);
    if (cdpResult.port) return { port: cdpResult.port, status: 'ready' };
    deps.log(`[cdp-ready] ${appId}: restart failed (${cdpResult.reason})`);
    // Map the failure to a structured reason so the UI can guide the user.
    const restartReason = await deps.inferRestartReason(appId, cdpResult.reason ?? null);
    return { port: null, status: 'requires-restart', restartReason };
  }

  // Phase 1: probe only — never kill a running app on the first click.
  const port = await deps.resolveLivePort(appId);
  if (port) return { port, status: 'ready' };
  deps.log(`[cdp-ready] ${appId}: no live CDP port (probe phase)`);

  // Classify: "installed but not running" is a plain launch (no dialog),
  // everything else needs the user's attention.
  const reason = await deps.inferRestartReason(appId, null);
  if (reason === 'not-running') {
    deps.log(`[cdp-ready] ${appId}: installed but not running — auto-launching`);
    const cdpResult = await deps.ensureCdpReady(appId, timeoutMs);
    if (cdpResult.port) return { port: cdpResult.port, status: 'ready' };
    deps.log(`[cdp-ready] ${appId}: auto-launch failed (${cdpResult.reason})`);
    const mapped = await deps.inferRestartReason(appId, cdpResult.reason ?? null);
    return { port: null, status: 'requires-restart', restartReason: mapped };
  }

  // not-installed / no-cdp (running without a debug port) / other → the UI
  // must involve the user (install guidance, or confirm the restart).
  return { port: null, status: 'requires-restart', restartReason: reason };
}
