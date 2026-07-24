// SPDX-License-Identifier: MPL-2.0

/**
 * # Scheme Sync
 *
 * Extracted from `AgentEngineService` (P1-3 of the god-object teardown).
 *
 * Owns the best-effort light/dark scheme synchronisation that runs after a
 * theme is applied (and the corresponding restore when a theme is removed):
 *   - {@link syncSchemeToTheme}: one-shot capture + apply.
 *   - {@link syncSchemeWithStability}: initial sync + 2s/5s/10s stability
 *     window that re-applies the mode when the agent overwrites it during
 *     its own render cycle (common for Trae/Qoder).
 *   - {@link restoreOriginalScheme}: put back the user's pre-AgentSkin
 *     scheme snapshot when the theme is removed.
 *
 * Why these go together: all three touch the same `SchemeSnapshot` slot on
 * the persisted state, share the same epoch / page-session plumbing, and
 * delegate to the low-level `agent-scheme` primitives (`captureScheme` /
 * `applyScheme` / `restoreScheme`). None of them touch `applyEpoch` beyond
 * reading it, so they form a clean cohesive slice that can be peeled off
 * the god object.
 *
 * Call chain:
 *   AgentEngineService.apply  → syncSchemeWithStability
 *   AgentEngineService.restore → restoreOriginalScheme
 */

import type { CdpSession } from './cdp-client';
import {
  applyScheme,
  captureScheme,
  restoreScheme,
  type SchemeMode,
  type SchemeSnapshot,
} from './agent-scheme';
import { toMessage } from '../shared/errors';
import type { LogCallback } from './services/contracts';
import type { AgentId } from '../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Open a CDP session against the app's main page target and run `fn` with
 * it, always closing the socket afterwards. Wired to
 * {@link AgentEngineService.withPageSession} which retries for a short
 * window because the app may have just been (re)launched and its renderer
 * is not ready yet.
 */
export type WithPageSession = (
  appId: AgentId,
  port: number,
  fn: (session: CdpSession) => Promise<void>,
  retries?: number,
) => Promise<void>;

/**
 * Read the persisted scheme snapshot for an agent (null when never captured
 * or already restored). Wired to a thin accessor over the orchestrator's
 * `state.apps[appId].schemeSnapshot` slot.
 */
export type GetSchemeSnapshot = (appId: AgentId) => SchemeSnapshot | null | undefined;

/**
 * Write the scheme snapshot for an agent. The orchestrator owns the slot
 * so it can persist it atomically with the rest of the state.
 */
export type SetSchemeSnapshot = (appId: AgentId, snapshot: SchemeSnapshot | null) => void;

/** Persist the orchestrator state to disk. */
export type PersistCallback = () => Promise<void>;

/**
 * True when `captured` is still the current epoch for `appId`. Background
 * stability checks poll this between CDP touches and abort early when a
 * newer apply/restore/reapply supersedes them — prevents stale tasks from
 * clobbering a newer scheme state.
 */
export type IsEpochCurrent = (appId: AgentId, captured: number) => boolean;

/**
 * Re-resolve the live CDP port for an agent. The stability window calls
 * this between checkpoints because the app may have been restarted and
 * bound a different debug port.
 */
export type ResolveLivePort = (appId: AgentId) => Promise<number | null>;

/** Best-effort log line sink. Re-exported from `services/contracts.ts` for
 *  backward compatibility — new consumers should import `LogCallback` directly
 *  from `./services/contracts`. */
export type { LogCallback };

/**
 * Structured event sink — used for the `scheme_sync` event with phases
 * `start` | `drifted` | `done` so the UI can render a progress bar for
 * the stability window.
 */
export type SchemeStructuredLogCallback = (event: {
  type: 'scheme_sync';
  agentId: AgentId;
  timestamp: string;
  phase: 'start' | 'drifted' | 'done';
  progress?: number;
}) => void;

/**
 * The orchestrator slice that backs all calls in this module. Each field
 * is a thin lambda over the orchestrator's private state so the pure
 * transformation can be unit-tested without spinning up a real agent.
 */
export interface SchemeSyncDeps {
  withPageSession: WithPageSession;
  getSchemeSnapshot: GetSchemeSnapshot;
  setSchemeSnapshot: SetSchemeSnapshot;
  persist: PersistCallback;
  isEpochCurrent: IsEpochCurrent;
  resolveLivePort: ResolveLivePort;
  log: LogCallback;
  logStructured: SchemeStructuredLogCallback;
}

// ---------------------------------------------------------------------------
// syncSchemeToTheme
// ---------------------------------------------------------------------------

/**
 * Match the agent's internal light/dark scheme to the applied theme. The
 * user's original scheme is captured once (before the first switch) and
 * stored on the persisted state via {@link SchemeSyncDeps.setSchemeSnapshot}
 * so {@link restoreOriginalScheme} can put it back. Best-effort: never
 * throws.
 */
export async function syncSchemeToTheme(
  appId: AgentId,
  port: number,
  mode: SchemeMode,
  deps: SchemeSyncDeps,
): Promise<void> {
  try {
    let captured = false;
    await deps.withPageSession(appId, port, async (session) => {
      if (!deps.getSchemeSnapshot(appId)) {
        const snapshot = await captureScheme(session, appId);
        if (snapshot) {
          deps.setSchemeSnapshot(appId, snapshot);
          captured = true;
        }
      }
      const ok = await applyScheme(session, appId, mode);
      deps.log(`[scheme] ${appId}: ${ok ? `scheme matched to theme (${mode})` : 'scheme sync skipped'}`);
    });
    if (captured) await deps.persist();
  } catch (error) {
    deps.log(`[scheme] ${appId}: best-effort scheme sync skipped (${toMessage(error)})`);
  }
}

// ---------------------------------------------------------------------------
// syncSchemeWithStability
// ---------------------------------------------------------------------------

/**
 * Stability-window scheme sync: applies the scheme immediately, then
 * re-checks at 2s / 5s / 10s. If the agent has overwritten our mode
 * setting during its own render cycle (common for Trae/Qoder which
 * re-apply persisted theme on startup), we re-apply. Stops early once
 * two consecutive checks confirm the mode is stable, or as soon as the
 * epoch flips (a newer apply/restore superseded this one).
 */
export async function syncSchemeWithStability(
  appId: AgentId,
  port: number,
  mode: SchemeMode,
  epoch: number,
  deps: SchemeSyncDeps,
): Promise<void> {
  // Initial sync (includes capture + read-back retries inside applyScheme).
  if (!deps.isEpochCurrent(appId, epoch)) return;
  deps.logStructured({
    type: 'scheme_sync',
    agentId: appId,
    phase: 'start',
    timestamp: new Date().toISOString(),
    progress: 75,
  });
  await syncSchemeToTheme(appId, port, mode, deps);

  // Stability checks at 2s / 5s / 10s. Re-resolve port each time in case
  // the app restarted and bound a new debug port.
  let stableCount = 0;
  const checkPoints = [2000, 5000, 10000];
  for (const delay of checkPoints) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    // Abort if a newer apply/restore/reapply superseded this one — the
    // scheme may have been changed by the newer operation, and re-applying
    // our stale mode would clobber it.
    if (!deps.isEpochCurrent(appId, epoch)) {
      deps.log(`[scheme] ${appId}: epoch changed, aborting stability check`);
      return;
    }
    try {
      const livePort = await deps.resolveLivePort(appId);
      if (livePort == null) return; // app closed / CDP gone — stop checking
      let stillOk = false;
      await deps.withPageSession(appId, livePort, async (session) => {
        // Re-check inside the session callback in case epoch flipped while
        // we were resolving the port / connecting.
        if (!deps.isEpochCurrent(appId, epoch)) return;
        // Re-apply unconditionally — applyScheme's read-back verification
        // will no-op if the mode is already correct (returns quickly).
        stillOk = await applyScheme(session, appId, mode);
      }, 3);
      if (stillOk) {
        stableCount++;
        // Two consecutive stable checks → mode has stuck, stop polling.
        if (stableCount >= 2) {
          deps.logStructured({
            type: 'scheme_sync',
            agentId: appId,
            phase: 'done',
            timestamp: new Date().toISOString(),
            progress: 95,
          });
          return;
        }
      } else {
        stableCount = 0;
        deps.log(`[scheme] ${appId}: mode drifted during stability window, re-applied (${mode})`);
        deps.logStructured({
          type: 'scheme_sync',
          agentId: appId,
          phase: 'drifted',
          timestamp: new Date().toISOString(),
          progress: 80,
        });
      }
    } catch {
      // Agent may have been closed — stop stability checks silently.
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// restoreOriginalScheme
// ---------------------------------------------------------------------------

/**
 * Write a captured scheme snapshot back to the agent. Called during
 * restore so the agent reverts to the user's pre-AgentSkin light/dark
 * choice. Best-effort: never throws.
 */
export async function restoreOriginalScheme(
  appId: AgentId,
  port: number,
  snapshot: SchemeSnapshot,
  epoch: number,
  deps: SchemeSyncDeps,
): Promise<void> {
  if (!deps.isEpochCurrent(appId, epoch)) return;
  try {
    await deps.withPageSession(appId, port, async (session) => {
      if (!deps.isEpochCurrent(appId, epoch)) return;
      const ok = await restoreScheme(session, snapshot);
      deps.log(`[scheme] ${appId}: ${ok ? 'original scheme restored' : 'scheme restore skipped'}`);
    });
  } catch (error) {
    deps.log(`[scheme] ${appId}: best-effort scheme restore skipped (${toMessage(error)})`);
  }
}
