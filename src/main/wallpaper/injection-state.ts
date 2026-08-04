// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/injection-state
 *
 * Module-scoped state tracking and session management for wallpaper injection.
 * Extracted from `wallpaper-injector.ts`.
 *
 * Contents:
 *   - **Media token tracking**: `activeMediaTokens` Map + `setActiveMediaToken`
 *     (unregisters previous token before setting new) + test helpers.
 *   - **Active wallpaper tracking**: `activeWallpaperAgents` Map (appId → CDP
 *     port) for lifecycle pause/resume broadcast + `getActiveWallpaperAgents`.
 *   - **Fallback tracking**: `lastSuccessfulWallpaper` Map + accessors, so a
 *     failed injection can fall back to the previous wallpaper instead of
 *     leaving the agent page black.
 *   - **Session management**: `wallpaperDeps` snapshot + `setWallpaperDeps` +
 *     `openAgentWallpaperSession` (connects to an agent's main page target).
 *
 * Dependency: imports from {@link ./types}, {@link ./target-discovery},
 * `cdp/cdp-client`, `cdp/cdp-wallpaper-inject`, and `wallpaper-server`.
 * No circular dependencies.
 */

import { uninstallCdpFetchInterceptor } from '../../legacy/agentskin-core-runtime';
import { toMessage } from '../../shared/errors';
import type { AgentId } from '../../shared/types';
import { type CdpSession, connectCdp } from '../cdp/cdp-client';
import { removeAllWallpapers } from '../cdp/cdp-wallpaper-inject';
import { wallpaperMediaServer } from '../wallpaper-server';
import type { WallpaperApplyOptions, WallpaperInjectorDeps } from './injector-types';
import { resolvePageTarget, resolvePageTargets } from './target-discovery';

// ---------------------------------------------------------------------------
// Media token tracking
// ---------------------------------------------------------------------------

/**
 * Tracks the currently-registered media-server token per agent. Each token
 * is created by `wallpaperMediaServer.register()` when a video wallpaper is
 * streamed over loopback HTTP. Without this map, every wallpaper apply
 * (including re-applies, theme switches, and boot-time rehydration) would
 * register a fresh token and the old one would leak forever in the server's
 * `entries` Map — the file path stays referenced and the loopback URL stays
 * valid long after the wallpaper it served is gone.
 *
 * Lifecycle:
 *   - Set when a video wallpaper is successfully registered.
 *   - Replaced (and the previous token unregistered) on the next register.
 *   - Cleared (and token unregistered) when the wallpaper is removed via
 *     {@link removeAgentVideoWallpaper} or the no-wallpaper branches of
 *     {@link applyAgentWallpaperNow} / {@link injectAgentWallpaperFromApply}.
 *
 * Module-scoped (not per-instance) because there is only ever one
 * AgentEngineService and one media server per process; storing it on the
 * deps slice would just add churn for no benefit.
 */
const activeMediaTokens = new Map<AgentId, string>();

/** Replace the active token for an agent: unregister the previous one (if
 *  any) and record the new one. Pass `null` to clear. */
export function setActiveMediaToken(appId: AgentId, token: string | null): void {
  const prev = activeMediaTokens.get(appId);
  if (prev) wallpaperMediaServer.unregister(prev);
  if (token) activeMediaTokens.set(appId, token);
  else activeMediaTokens.delete(appId);
}

/** Directly place a token in {@link activeMediaTokens} WITHOUT calling
 *  `wallpaperMediaServer.unregister` — for test setup only. Production code
 *  uses {@link setActiveMediaToken} which always unregisters the previous
 *  token first. Tests need to simulate a token left behind by a prior call
 *  without triggering a real unregister on a fake token. */
export function _setActiveMediaTokenForTest(appId: AgentId, token: string): void {
  activeMediaTokens.set(appId, token);
}

/** Clear all entries from {@link activeMediaTokens} — for test cleanup only. */
export function _clearActiveMediaTokensForTest(): void {
  activeMediaTokens.clear();
}

// ---------------------------------------------------------------------------
// Active wallpaper tracking (for lifecycle pause/resume)
// ---------------------------------------------------------------------------

/**
 * Agents that currently have a *video* wallpaper injected (appId → CDP port at
 * inject time). Used by `wallpaper-lifecycle.ts` to broadcast pause/resume to
 * the agent renderers (e.g. on system suspend) without re-resolving media.
 * Image wallpapers are not tracked because there is no decoding to suspend.
 */
const activeWallpaperAgents = new Map<AgentId, number>();

/** Snapshot of agents with an active video wallpaper. */
export function getActiveWallpaperAgents(): Array<{ appId: AgentId; port: number }> {
  return Array.from(activeWallpaperAgents.entries()).map(([appId, port]) => ({ appId, port }));
}

/** Record that an agent has an active video wallpaper at the given CDP port. */
export function setActiveWallpaperAgent(appId: AgentId, port: number): void {
  activeWallpaperAgents.set(appId, port);
}

/** Clear the active-wallpaper record for an agent. */
export function clearActiveWallpaperAgent(appId: AgentId): void {
  activeWallpaperAgents.delete(appId);
}

// ---------------------------------------------------------------------------
// Last-successful-wallpaper tracking (for fallback recovery)
// ---------------------------------------------------------------------------

/**
 * Records the last successfully-injected wallpaper per agent, so that a
 * failed injection can fall back to the previous wallpaper instead of
 * leaving the agent page black.
 *
 * The core problem: every CDP injection function starts by clearing old
 * wallpaper elements (Step 1), then mounts the new wallpaper (Step 2).
 * If Step 2 fails — CSP block, codec issue, CDP timeout — the old
 * wallpaper is already gone and the page goes black. The user sees a
 * flash to black with no way to recover except clicking "apply" again.
 *
 * This map breaks that cycle: {@link injectWithFallback} records every
 * successful injection, and on failure re-injects the last successful
 * wallpaper. The re-injection creates fresh DOM elements on an already-
 * cleaned page, so there's no conflict with the failed attempt's remnants
 * (those are torn down by the injection function's own failure cleanup).
 *
 * Lifecycle:
 *   - Set when injection succeeds (via {@link injectWithFallback}).
 *   - Cleared when the wallpaper is explicitly removed
 *     ({@link removeAgentVideoWallpaper}, {@link removeWallpaperFromAgent},
 *     or the no-wallpaper branches of the apply* functions).
 *
 * Module-scoped because there is only one AgentEngineService per process.
 */
const lastSuccessfulWallpaper = new Map<
  AgentId,
  { wallpaperId: string; options: WallpaperApplyOptions }
>();

/** Clear the last-successful-wallpaper record for an agent. Exported for
 *  unit testing — production code clears it via the remove/restore paths. */
export function clearLastSuccessfulWallpaper(appId: AgentId): void {
  lastSuccessfulWallpaper.delete(appId);
}

/** Set the last-successful-wallpaper record for an agent. Exported for
 *  unit testing — production code sets it via {@link injectWithFallback}. */
export function setLastSuccessfulWallpaper(
  appId: AgentId,
  wallpaperId: string,
  options: WallpaperApplyOptions,
): void {
  lastSuccessfulWallpaper.set(appId, { wallpaperId, options });
}

/** Get the last-successful-wallpaper record for an agent. Returns undefined
 *  if no previous successful wallpaper exists. */
export function getLastSuccessfulWallpaper(
  appId: AgentId,
): { wallpaperId: string; options: WallpaperApplyOptions } | undefined {
  return lastSuccessfulWallpaper.get(appId);
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/** Latest deps slice, captured on each inject/apply so {@link
 *  openAgentWallpaperSession} can resolve targets without the caller threading
 *  deps through the lifecycle broadcast path. */
let wallpaperDeps: WallpaperInjectorDeps | null = null;

/** Capture the latest deps slice for use by {@link openAgentWallpaperSession}. */
export function setWallpaperDeps(deps: WallpaperInjectorDeps): void {
  wallpaperDeps = deps;
}

/** Open a CDP session to an agent's main page target (best-effort). */
export async function openAgentWallpaperSession(
  appId: AgentId,
  port: number,
): Promise<CdpSession | null> {
  if (!wallpaperDeps) return null;
  try {
    const target = await resolvePageTarget(wallpaperDeps, appId, port);
    if (!target) return null;
    return await connectCdp(target.webSocketDebuggerUrl, 4000);
  } catch (error) {
    wallpaperDeps.log(
      `[wallpaper] ${appId}: openAgentWallpaperSession failed — ${toMessage(error)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Multi-target wallpaper removal
// ---------------------------------------------------------------------------

/**
 * Remove wallpaper from ALL matching targets for an agent. Injection uses
 * {@link resolvePageTargets} (plural) to inject into every compatible target,
 * so removal must do the same — otherwise wallpaper elements remain on
 * secondary targets (e.g. Doubao's background page, WorkBuddy's webviews)
 * after the user removes the wallpaper.
 *
 * Returns the number of targets successfully cleaned.
 */
export async function removeAllWallpapersFromAllTargets(
  deps: WallpaperInjectorDeps,
  appId: AgentId,
  port: number,
): Promise<number> {
  const targets = await resolvePageTargets(deps, appId, port);
  if (targets.length === 0) return 0;
  let cleaned = 0;
  for (const target of targets) {
    const wsUrl = target.webSocketDebuggerUrl;
    let session: CdpSession;
    try {
      session = await connectCdp(wsUrl, 4000);
    } catch (error) {
      deps.log(
        `[wallpaper] ${appId}: removeAllWallpapers connectCdp failed for target — ${toMessage(error)}`,
      );
      continue;
    }
    try {
      await removeAllWallpapers(session);
      cleaned++;
    } catch (error) {
      // best-effort, but log so a stuck removal is diagnosable
      deps.log(
        `[wallpaper] ${appId}: removeAllWallpapers session cleanup failed — ${toMessage(error)}`,
      );
    } finally {
      session.close();
    }
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Lifecycle cleanup (module-scoped maps)
// ---------------------------------------------------------------------------

/**
 * Drop ALL wallpaper-injection tracking state for a single agent. Invoked
 * after a successful theme-restore + wallpaper-remove so the next fresh
 * apply starts from a clean slate. Active media tokens are unregistered in
 * the media server (not just forgotten) so their HTTP entries are freed.
 */
export function cleanupWallpaperStateForAgent(appId: AgentId): void {
  const token = activeMediaTokens.get(appId);
  if (token) wallpaperMediaServer.unregister(token);
  activeMediaTokens.delete(appId);
  activeWallpaperAgents.delete(appId);
  lastSuccessfulWallpaper.delete(appId);
}

/**
 * Drop ALL module-scoped wallpaper-injection state + unregister every live
 * media token. Called only at app shutdown — this gives the media server a
 * chance to close streaming file handles before the process exits, and
 * releases all retained references so maps don't pin bytes forever.
 */
export function disposeWallpaperInjectionState(): void {
  for (const token of activeMediaTokens.values()) wallpaperMediaServer.unregister(token);
  activeMediaTokens.clear();
  activeWallpaperAgents.clear();
  lastSuccessfulWallpaper.clear();
  // P3-12: The legacy agentskin-core-runtime installs a global fetch
  // interceptor on first win32 boot so CDP /json/list calls can fall back to
  // WebSocket. Without uninstalling it here, a dispose → re-init cycle
  // (hot-reload, test harness re-bootstrap, or any future runtime reset)
  // layers a new wrapper over the already-wrapped fetch until the call
  // stack crashes from recursion. Tear it down symmetrically so the next
  // install captures the *actual* platform fetch.
  uninstallCdpFetchInterceptor();
}
