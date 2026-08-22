// SPDX-License-Identifier: MPL-2.0

/**
 * # mutex (withExclusive) tests
 *
 * Unit tests for the per-agent mutex that serializes wallpaper state
 * mutations. Proves that:
 *
 *   1. Same appId: concurrent `withExclusive` calls execute sequentially
 *      (no interleaving) — fn execution windows do not overlap.
 *   2. Different appIds: calls run in parallel — no global lock contention.
 *   3. Error path: when fn throws, the lock is released so subsequent calls
 *      for the same appId can proceed (no deadlock).
 *   4. Map cleanup: after all calls settle, no stale entries remain for
 *      retired appIds.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../../shared/types';
import { getLockedAgentCount, withExclusive } from './mutex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withExclusive — serialization', () => {
  afterEach(async () => {
    // Let pending tails settle so the agentLocks Map can clean itself up.
    await delay(30);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 1: same appId serializes — no overlapping execution
  // -----------------------------------------------------------------------

  it('same appId: concurrent calls execute sequentially (no overlap)', async () => {
    const appId = 'traework' as AgentId;
    const intervals: Array<{ start: number; end: number }> = [];

    const fn = async (id: number) => {
      const start = Date.now();
      await delay(40);
      const end = Date.now();
      intervals.push({ start, end });
      return id;
    };

    // Fire 3 concurrent calls for the same appId.
    const [r1, r2, r3] = await Promise.all([
      withExclusive(appId, () => fn(1)),
      withExclusive(appId, () => fn(2)),
      withExclusive(appId, () => fn(3)),
    ]);

    // Results preserved.
    expect([r1, r2, r3]).toEqual([1, 2, 3]);

    // Each interval must start at or after the previous one ended.
    // This proves serialization — no two critical sections overlapped.
    expect(intervals.length).toBe(3);
    intervals.sort((a, b) => a.start - b.start);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i].start).toBeGreaterThanOrEqual(intervals[i - 1].end);
    }
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 2: different appIds run in parallel
  // -----------------------------------------------------------------------

  it('different appIds: calls run concurrently (no global lock)', async () => {
    const APP_A = 'traework' as AgentId;
    const APP_B = 'qoderwork' as AgentId;

    const started: Record<string, number> = {};

    const fn = async (label: string) => {
      started[label] = Date.now();
      await delay(50);
      return label;
    };

    const start = Date.now();
    const [r1, r2] = await Promise.all([
      withExclusive(APP_A, () => fn('a')),
      withExclusive(APP_B, () => fn('b')),
    ]);
    const elapsed = Date.now() - start;

    expect([r1, r2]).toEqual(['a', 'b']);

    // Both must have started roughly at the same time — within 30ms of each
    // other (not sequentially which would be > 80ms apart).
    expect(Math.abs(started.a! - started.b!)).toBeLessThan(30);

    // Total wall-clock time should be ~50ms, not ~100ms (which would mean
    // serialization across different appIds).
    expect(elapsed).toBeLessThan(90);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 3: error path — lock released, subsequent call proceeds
  // -----------------------------------------------------------------------

  it('error in fn for same appId does NOT deadlock subsequent call', async () => {
    const appId = 'workbuddy' as AgentId;
    let attempt = 0;

    const fn = async () => {
      attempt++;
      await delay(10);
      throw new Error('Map write failed');
    };

    // First call: fn throws — withExclusive propagates the error.
    await expect(withExclusive(appId, fn)).rejects.toThrow('Map write failed');

    // Lock must be released — second call can proceed.
    await expect(withExclusive(appId, fn)).rejects.toThrow('Map write failed');
    expect(attempt).toBe(2);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 4: Map cleanup — no stale entries for retired appIds
  // -----------------------------------------------------------------------

  it('agentLocks Map is cleaned up after all calls settle for an appId', async () => {
    const APP_X = 'doubao' as AgentId;
    const APP_Y = 'codex' as AgentId;

    // Baseline — no locks held at the start (after afterEach delay).
    expect(getLockedAgentCount()).toBe(0);

    await withExclusive(APP_X, async () => {
      await delay(10);
    });

    await withExclusive(APP_Y, async () => {
      await delay(10);
    });

    // After all calls settle, there should be zero entries retained
    // (the best-effort cleanup in the finally block removes stale entries).
    expect(getLockedAgentCount()).toBe(0);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 5: sequential calls return correct values (no data loss)
  // -----------------------------------------------------------------------

  it('sequential withExclusive calls return correct values', async () => {
    const appId = 'zcode' as AgentId;

    // Use a shared counter to prove the critical sections are isolated.
    let counter = 0;

    const r1 = await withExclusive(appId, async () => {
      counter = 1;
      return counter;
    });

    const r2 = await withExclusive(appId, async () => {
      counter = 2;
      return counter;
    });

    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(counter).toBe(2);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 6: mixed appIds do not cross-contaminate serialization
  // -----------------------------------------------------------------------

  it('cross-appId serialization is independent — one slow call does not block another appId', async () => {
    const SLOW = 'traework' as AgentId;
    const FAST = 'qoderwork' as AgentId;

    let fastCompleted = false;

    const slowFn = async () => {
      await delay(100);
      // After the slow call is underway, the fast call should have completed.
      expect(fastCompleted).toBe(true);
      return 'slow';
    };

    const fastFn = async () => {
      await delay(10);
      fastCompleted = true;
      return 'fast';
    };

    // Fire slow first, then fast — fast must not wait for slow.
    const slowPromise = withExclusive(SLOW, slowFn);
    const fastResult = await withExclusive(FAST, fastFn);

    expect(fastResult).toBe('fast');
    expect(fastCompleted).toBe(true);

    const slowResult = await slowPromise;
    expect(slowResult).toBe('slow');
  });
});
