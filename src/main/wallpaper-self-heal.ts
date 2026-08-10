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
 * ## Callback contract (v2 — race-safe)
 *
 * The self-heal callback returns `Promise<(() => Promise<void>) | null>`
 * instead of executing the operation directly. This lazy-thunk contract lets
 * the caller (wallpaper-injector.ts) decide *when* to invoke the callback:
 *
 *   - If no apply/restore is in-flight → invoke immediately.
 *   - If an apply/restore IS in-flight → enqueue to a deferred queue that
 *     drains after the in-flight op releases its lock.
 *
 * Why: previously the callback fired-and-forgore the restore directly
 * (`void selfHealCb(appId).catch(() => {})`). When restore had already cleared
 * `activeThemeId`, the in-flight self-heal could call
 * `removeAgentVideoWallpaper` / `restoreThemeFlow` concurrently with the
 * real restore — the second remove raced the first and the agent ended up in
 * a zombie state: UI says "no theme" but CSS/钩子 still linger in the DOM.
 *
 * ## Concurrent self-heal guard
 *
 * A module-level `selfHealingAgents` Set prevents the same agent from being
 * entered twice even if another failure self-heal triggers mid-heal. The
 * wrapped thunk removes itself from the Set on settlement (success OR failure)
 * so a later failure can re-trigger.
 *
 * Usage: call `await recordInjectionFailure()` /
 * `recordInjectionSuccess()` from the injectors in `wallpaper-injector.ts`.
 */

import type { AgentId } from '../shared/types';

const FAILURE_THRESHOLD = 3;
/** Minimum time between self-heal triggers for the same agent. */
const SELF_HEAL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/** appId → consecutive failure count. */
const consecutiveFailures = new Map<AgentId, number>();
/** appId → epoch ms of the last self-heal trigger (0 = never). */
const lastSelfHealTime = new Map<AgentId, number>();
/**
 * Agents currently undergoing self-heal. Guards against concurrent self-heal
 * for the same agent (a new failure streak mid-heal must not start a second
 * parallel self-heal). Entries are removed when the thunk settles.
 */
const selfHealingAgents = new Set<AgentId>();

/**
 * Callback invoked when the self-heal threshold is reached.
 *
 * Returns a deferred thunk (or null if it declines to act). The thunk, when
 * invoked, performs the actual self-heal work (typically wrapping
 * `restoreThemeFlow` to tear down all engine artifacts from the agent).
 *
 * Returning a thunk instead of performing the work in-body lets the caller
 * serialise with in-flight apply/restore operations via `deps.isApplyingTheme`.
 */
type SelfHealCallback = (appId: AgentId) => Promise<(() => Promise<void>) | null>;

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
 * window has elapsed, invoke the self-heal callback (without blocking the
 * caller on the actual self-heal work).
 *
 * Returns a deferred thunk `() => Promise<void>` that the caller MUST invoke
 * to execute the self-heal, OR null if self-heal is not triggered (threshold
 * not reached, callback unset, cooldown active, or concurrent heal in progress).
 *
 * The returned thunk wraps the caller-provided action and always cleans up
 * `selfHealingAgents` when it settles, so a later failure can re-trigger.
 *
 * Within the cooldown window the counter keeps accumulating (it is NOT
 * reset) so a successful injection still clears it via
 * {@link recordInjectionSuccess}; only an actual trigger resets the counter.
 */
export async function recordInjectionFailure(
  appId: AgentId,
): Promise<(() => Promise<void>) | null> {
  const current = consecutiveFailures.get(appId) ?? 0;
  const next = current + 1;
  consecutiveFailures.set(appId, next);

  if (!(next >= FAILURE_THRESHOLD && selfHealCb)) {
    return null;
  }

  // Concurrent self-heal guard: don't re-enter for the same agent.
  if (selfHealingAgents.has(appId)) {
    console.warn(
      `[wallpaper-self-heal] ${appId}: self-heal already in progress — skipping trigger (concurrent guard)`,
    );
    return null;
  }

  const now = Date.now();
  const lastTrigger = lastSelfHealTime.get(appId) ?? 0;
  if (now - lastTrigger < SELF_HEAL_COOLDOWN_MS) {
    // Cooldown active: a previous self-heal fired recently and clearly
    // didn't fix the root cause (we're still failing). Skip this trigger
    // to avoid hammering a permanently-blocked agent. The counter stays
    // so a later success still resets it.
    return null;
  }

  // --- Atomic claim (sync — no await before this point) ---
  // Claim the cooldown slot and concurrent-guard membership in the SAME
  // synchronous block, immediately after the cooldown check passes. This
  // eliminates the check-then-act race: without it, two fire-and-forget
  // callers that both pass the cooldown check could interleave at a future
  // `await` inserted between this point and the callback invocation below.
  //
  // lastSelfHealTime.set MUST come first — it is the cooldown token.
  // selfHealingAgents.add follows — it is the concurrent-restart guard.
  // Both are store-level writes (Map/Set), guaranteed atomic by the JS
  // event loop: no other synchronous chunk can run between them.
  lastSelfHealTime.set(appId, now);
  selfHealingAgents.add(appId);

  // P0#7: Reset the counter AFTER claiming the slot so subsequent failures
  // must build up a fresh streak of FAILURE_THRESHOLD to trigger again.
  // Without this reset, any failure after the threshold would re-trigger
  // self-heal on every single recordInjectionFailure() call — a storm.
  consecutiveFailures.set(appId, 0);

  console.warn(
    `[wallpaper-self-heal] ${appId}: ${FAILURE_THRESHOLD} consecutive failures — invoking self-heal callback`,
  );

  try {
    const action = await selfHealCb(appId);
    if (!action) {
      // Callback declined to act (e.g. caller determined it wasn't safe).
      // Release the guard so a later failure can re-trigger.
      selfHealingAgents.delete(appId);
      return null;
    }
    // Wrap the caller-provided thunk so `selfHealingAgents` is cleaned up
    // regardless of whether the action succeeds or throws.
    return async (): Promise<void> => {
      try {
        await action();
      } finally {
        selfHealingAgents.delete(appId);
      }
    };
  } catch {
    // Callback threw — release the guard so a later failure can re-trigger.
    selfHealingAgents.delete(appId);
    return null;
  }
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
  selfHealingAgents.delete(appId);
}

/** Drop ALL module-scoped self-heal state — called only on app shutdown. */
export function disposeSelfHealState(): void {
  consecutiveFailures.clear();
  lastSelfHealTime.clear();
  selfHealingAgents.clear();
}

/**
 * Current size of the `selfHealingAgents` Set — the number of agents that are
 * actively running a self-heal cycle right now. Exposed for the periodic
 * concurrency-metrics broadcast (diagnostics:concurrency-metrics) so the
 * renderer can visualise self-heal pressure without piercing module boundaries.
 */
export function getSelfHealingAgentsSize(): number {
  return selfHealingAgents.size;
}
