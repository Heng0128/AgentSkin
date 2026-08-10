// SPDX-License-Identifier: MPL-2.0

/**
 * # Per-agent mutex for wallpaper state Maps.
 *
 * Serializes async critical sections per AgentId so concurrent
 * apply/remove/fallback operations cannot interleave their Map reads/writes.
 *
 * ## Problem
 *
 * `applyWallpaperToAgent` → `injectWithFallback` → `setLastSuccessfulWallpaper`
 * and `removeWallpaperFromAgent` → `clearLastSuccessfulWallpaper` share the
 * module-level `lastSuccessfulWallpaper` Map (in `injection-state.ts`) without
 * coordination. When they fire concurrently:
 *
 *   T1: injectWithFallback succeeds → setLastSuccessfulWallpaper(A)
 *   T2: removeWallpaperFromAgent    → clearLastSuccessfulWallpaper()
 *
 * T2 wipes the entry T1 just wrote. The next `injectWithFallback` that fails
 * inside `injectWithFallback` reads an empty `getLastSuccessfulWallpaper()`,
 * finds nothing to fall back to, and the agent page stays black.
 *
 * The same hazard exists for `consecutiveFailures` (in `wallpaper-self-heal.ts`),
 * `activeMediaTokens`, and `activeWallpaperAgents` — all are module-level Maps
 * with concurrent readers and writers.
 *
 * ## Design
 *
 * Per-agent promise chain. For a given `appId`, every call to `withExclusive`
 * waits for the previous call to settle before entering its critical section.
 * Different appIds use independent chains — no global lock, no contention
 * across agents.
 *
 * This is the same pattern used in `import-guard.ts` but adapted from a
 * fire-and-forget Set to a per-appId promise chain so we can `await` the
 * critical section.
 */

import type { AgentId } from '../../shared/types';

/** Per-appId tail of the promise chain. `undefined` when no one holds the lock. */
const agentLocks = new Map<AgentId, Promise<void>>();

/**
 * Execute `fn` under a per-appId exclusive lock.
 *
 * For the same `appId`, calls are serialized: each waits for the previous to
 * settle before executing. Different appIds are fully independent — no global
 * lock, no inter-agent contention.
 *
 * Tolerates `fn` throwing: the lock is always released in a `finally` block so
 * a rejected critical section does not deadlock subsequent operations.
 */
export async function withExclusive<T>(appId: AgentId, fn: () => T | Promise<T>): Promise<T> {
  // Read the current tail — the promise we must wait on before entering.
  const prev = agentLocks.get(appId) ?? Promise.resolve();

  // Create our own tail: a promise that resolves when our `fn` settles.
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  // The queued tail promise: waits for `prev` to settle, then for `next` to
  // settle. This means the next caller waits for us (not just for prev).
  const queued = prev.then(() => next);
  agentLocks.set(appId, queued);

  // Wait for our turn (everyone ahead of us has finished).
  await prev;
  try {
    return await fn();
  } finally {
    // Release the next in line regardless of whether `fn` threw.
    release!();
    // Best-effort cleanup: if no one queued after us while we were working,
    // the map still points to our `queued` — drop it so we don't leak entries
    // for retired agents.
    if (agentLocks.get(appId) === queued) {
      agentLocks.delete(appId);
    }
  }
}

/**
 * Test / inspection helper — number of appIds currently tracked.
 * Useful for asserting leak-free operation in unit tests.
 */
export function getLockedAgentCount(): number {
  return agentLocks.size;
}
