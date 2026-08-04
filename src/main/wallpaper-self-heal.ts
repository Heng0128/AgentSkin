// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Self-Heal
 *
 * Monitors consecutive injection failures per agent and triggers a full
 * restore cycle when a threshold is exceeded. This handles the common case
 * where repeated CSP bypass failures leave stale wallpaper elements on the
 * page, preventing future injections from succeeding.
 *
 * Usage: call recordInjectionFailure() / recordInjectionSuccess() from
 * injectAgentWallpaper in wallpaper-injector.ts.
 */

import type { AgentId } from '../shared/types';

const FAILURE_THRESHOLD = 3;

/** appId → consecutive failure count. */
const consecutiveFailures = new Map<AgentId, number>();

/** Callback invoked when the self-heal threshold is reached. */
type SelfHealCallback = (appId: AgentId) => Promise<void>;

let selfHealCb: SelfHealCallback | null = null;

export function setSelfHealCallback(cb: SelfHealCallback): void {
  selfHealCb = cb;
}

/** Record a successful injection — resets the failure counter for this agent. */
export function recordInjectionSuccess(appId: AgentId): void {
  consecutiveFailures.set(appId, 0);
}

/**
 * Record an injection failure. If the threshold is reached, trigger self-heal.
 * Returns true if self-heal was triggered.
 */
export function recordInjectionFailure(appId: AgentId): boolean {
  const current = consecutiveFailures.get(appId) ?? 0;
  const next = current + 1;
  consecutiveFailures.set(appId, next);

  if (next >= FAILURE_THRESHOLD && selfHealCb) {
    // P0#7: Reset the counter BEFORE firing self-heal so subsequent failures
    // must build up a fresh streak of FAILURE_THRESHOLD to trigger again.
    // Without this reset, any failure after the threshold would re-trigger
    // self-heal on every single recordInjectionFailure() call — a storm.
    consecutiveFailures.set(appId, 0);

    console.warn(
      `[wallpaper-self-heal] ${appId}: ${FAILURE_THRESHOLD} consecutive failures, triggering self-heal`,
    );
    // Fire-and-forget: self-heal is best-effort
    void selfHealCb(appId).catch(() => {});
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lifecycle cleanup (module-scoped maps)
// ---------------------------------------------------------------------------

/**
 * Drop self-heal tracking state for a single agent. Called after a successful
 * restore so a fresh apply starts from a zero-failure baseline instead of
 * inheriting stale counters from the previous theme cycle.
 */
export function cleanupSelfHealForAgent(appId: AgentId): void {
  consecutiveFailures.delete(appId);
}

/** Drop ALL module-scoped self-heal state — called only on app shutdown. */
export function disposeSelfHealState(): void {
  consecutiveFailures.clear();
}
