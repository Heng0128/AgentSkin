// SPDX-License-Identifier: MPL-2.0

/**
 * # import-guard tests
 *
 * Unit tests for cross-store import deduplication. Proves that:
 *
 *   1. Concurrent `withImportLock` calls on the SAME path execute fn exactly
 *      once (the 2nd call bails before awaiting anything).
 *   2. Concurrent `withImportLock` calls on DIFFERENT paths both execute —
 *      the lock is per-path, not global.
 *   3. After fn settles, `isImportingPath` returns false for that path.
 *   4. If fn throws, the lock is released so subsequent calls are not stuck.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isImportingPath, withImportLock } from './import-guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Small delay to simulate real async import work. */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withImportLock — deduplication', () => {
  beforeEach(() => {
    // No direct reset hook — use paths unique to each test.
  });

  afterEach(async () => {
    // Let any in-flight fn settle so the module-level Set is empty for the
    // next test. waitFor is not needed — we just give pending microtasks
    // and timers a chance to run.
    await delay(20);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 1: same path, concurrent calls — fn executes exactly once
  // -----------------------------------------------------------------------

  it('concurrent calls with the same path execute fn exactly once', async () => {
    const PATH = '/themes/cyber-neon.agentskin-theme';
    let execCount = 0;

    const fn = async () => {
      execCount++;
      await delay(50);
    };

    // Fire two locks concurrently — the second must bail immediately.
    const [r1, r2] = await Promise.all([withImportLock(PATH, fn), withImportLock(PATH, fn)]);

    // Exactly one of them returned true, one returned false.
    const results = [r1, r2].sort();
    expect(results).toEqual([false, true]);

    // fn was called exactly once.
    expect(execCount).toBe(1);

    // After settle, the path is no longer importing.
    expect(isImportingPath(PATH)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 2: same path, one-after-another — fn executes twice
  // -----------------------------------------------------------------------

  it('sequential calls with the same path execute fn twice (no leak)', async () => {
    const PATH = '/themes/tokyo-night.agentskin-theme';
    let execCount = 0;

    const fn = async () => {
      execCount++;
      await delay(10);
    };

    const r1 = await withImportLock(PATH, fn);
    const r2 = await withImportLock(PATH, fn);

    // Both must return true — the lock is released after each fn settles.
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(execCount).toBe(2);
    expect(isImportingPath(PATH)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 3: different paths, concurrent calls — both execute
  // -----------------------------------------------------------------------

  it('concurrent calls with different paths execute both fns', async () => {
    const PATH_A = '/themes/theme-a.agentskin-theme';
    const PATH_B = '/themes/theme-b.agentskin-theme';
    let execCount = 0;

    const fn = async () => {
      execCount++;
      await delay(30);
    };

    const [r1, r2] = await Promise.all([withImportLock(PATH_A, fn), withImportLock(PATH_B, fn)]);

    // Both must return true — independent locks.
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(execCount).toBe(2);

    // After settle, both paths are clear.
    expect(isImportingPath(PATH_A)).toBe(false);
    expect(isImportingPath(PATH_B)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 4: fn throws — lock is released (no deadlock)
  // -----------------------------------------------------------------------

  it('lock is released when fn throws — subsequent call can proceed', async () => {
    const PATH = '/themes/broken.agentskin-theme';
    let attempt = 0;

    const fn = async () => {
      attempt++;
      await delay(10);
      throw new Error('ipc import failed');
    };

    // First call: fn throws — withImportLock propagates the error.
    await expect(withImportLock(PATH, fn)).rejects.toThrow('ipc import failed');

    // Path must be cleared despite the throw (finally block).
    expect(isImportingPath(PATH)).toBe(false);

    // Second call: the lock is NOT held — fn runs again.
    await expect(withImportLock(PATH, fn)).rejects.toThrow('ipc import failed');
    expect(attempt).toBe(2);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 5: isImportingPath tracks during execution but not before/after
  // -----------------------------------------------------------------------

  it('isImportingPath is true mid-execution and false afterwards', async () => {
    const PATH = '/themes/flag-check.agentskin-theme';

    let resolveFn: () => void;
    const fnStarted = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    const fn = async () => {
      resolveFn!();
      await delay(50);
    };

    const promise = withImportLock(PATH, fn);

    // After the synchronous add() inside withImportLock but before fn awaits,
    // the path should be tracked.
    await fnStarted;
    expect(isImportingPath(PATH)).toBe(true);

    // After fn settles, it should be cleared.
    await promise;
    expect(isImportingPath(PATH)).toBe(false);
  });
});
