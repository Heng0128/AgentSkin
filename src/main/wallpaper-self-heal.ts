// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Self-Heal
 *
 * Monitors consecutive injection failures per agent and triggers a full
 * restore cycle when a threshold is exceeded. This handles the common case
 * where repeated CSP bypass failures leave stale wallpaper elements on the
 * page, preventing future injections from succeeding.
 *
 * ## Cooldown
 *
 * After self-heal fires for an agent, a cooldown window
 * ({@link SELF_HEAL_COOLDOWN_MS}) suppresses subsequent triggers. Without it,
 * an agent whose CSP permanently blocks wallpaper injection (e.g. qoderwork)
 * would loop forever: 3 failures → restore → 3 failures → restore …, burning
 * CPU and flooding logs. The cooldown forces at least one window between
 * attempts so a permanently-blocked agent only retries at most once per
 * window instead of once per 3 failures.
 *
 * Usage: call recordInjectionFailure() / recordInjectionSuccess() from
 * injectAgentWallpaper in wallpaper-injector.ts.
 */

import type { AgentId } from '../shared/types';

const FAILURE_THRESHOLD = 3;
/** Minimum time between self-heal triggers for the same agent. */
const SELF_HEAL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** appId → consecutive failure count. */
const consecutiveFailures = new Map<AgentId, number>();
/** appId → epoch ms of the last self-heal trigger (0 = never). */
const lastSelfHealTime = new Map<AgentId, number>();

/** Callback invoked when the self-heal threshold is reached. */
type SelfHealCallback = (appId: AgentId) => Promise<void>;

let selfHealCb: SelfHealCallback | null = null;

export function setSelfHealCallback(cb: SelfHealCallback): void {
  selfHealCb = cb;
}

/**
 * Record a successful injection — resets the failure counter and cooldown
 * timestamp for this agent. Clearing the cooldown means a fresh failure
 * streak after a success can trigger self-heal immediately (the agent was
 * healthy, so the next problem is a new incident, not a continuation).
 */
export function recordInjectionSuccess(appId: AgentId): void {
  consecutiveFailures.set(appId, 0);
  lastSelfHealTime.delete(appId);
}

/**
 * Record an injection failure. If the threshold is reached AND the cooldown
 * window has elapsed, trigger self-heal. Returns true if self-heal was
 * triggered.
 *
 * Within the cooldown window the counter keeps accumulating (it is NOT
 * reset) so a successful injection still clears it via
 * {@link recordInjectionSuccess}; only an actual trigger resets the counter.
 */
export function recordInjectionFailure(appId: AgentId): boolean {
  const current = consecutiveFailures.get(appId) ?? 0;
  const next = current + 1;
  consecutiveFailures.set(appId, next);

  if (next >= FAILURE_THRESHOLD && selfHealCb) {
    const now = Date.now();
    const lastTrigger = lastSelfHealTime.get(appId) ?? 0;
    if (now - lastTrigger < SELF_HEAL_COOLDOWN_MS) {
      // Cooldown active: a previous self-heal fired recently and clearly
      // didn't fix the root cause (we're still failing). Skip this trigger
      // to avoid hammering a permanently-blocked agent. The counter stays
      // so a later success still resets it.
      return false;
    }
    // P0#7: Reset the counter BEFORE firing self-heal so subsequent failures
    // must build up a fresh streak of FAILURE_THRESHOLD to trigger again.
    // Without this reset, any failure after the threshold would re-trigger
    // self-heal on every single recordInjectionFailure() call — a storm.
    consecutiveFailures.set(appId, 0);
    lastSelfHealTime.set(appId, now);

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
  lastSelfHealTime.delete(appId);
}

/** Drop ALL module-scoped self-heal state — called only on app shutdown. */
export function disposeSelfHealState(): void {
  consecutiveFailures.clear();
  lastSelfHealTime.clear();
}
