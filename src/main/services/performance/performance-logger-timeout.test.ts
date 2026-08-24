// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for IPC timeout event recording inside PerformanceLogger.
 *
 * Because the production logger is a module-level singleton, each test case
 * calls `clear()` (which now also resets the timeout buffer) to guarantee a
 * clean slate. Since `vi.resetModules()` is used in `beforeEach` to invalidate
 * the module cache, each test performs a dynamic `await import()` to obtain a
 * fresh singleton instance after the `Date` stub is installed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Fixed value returned by the mocked Date.now(). */
const FIXED_NOW = 1_700_000_000_000;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  vi.resetModules();
  // Proactively clear the fresh singleton to guarantee a clean slate, even if
  // a previous test threw before completing its dynamic import (mirrors the
  // sibling performance-logger.test.ts pattern).
  const mod = await import('./performance-logger');
  mod.performanceLogger.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function freshLogger(): Promise<import('./performance-logger').PerformanceLoggerApi> {
  const mod = await import('./performance-logger');
  return mod.performanceLogger;
}

describe('PerformanceLogger — IPC timeout events', () => {
  it('logTimeout auto-assigns incrementing ids (timeout_001, timeout_002, …)', async () => {
    const logger = await freshLogger();

    logger.logTimeout({ channel: 'THEME_APPLY', ms: 5000, timestamp: Date.now() });
    logger.logTimeout({ channel: 'THEME_RESTORE', ms: 3000, timestamp: Date.now() });

    const all = logger.getAllTimeouts();
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe('timeout_001');
    expect(all[1]!.id).toBe('timeout_002');
    expect(all[0]!.channel).toBe('THEME_APPLY');
    expect(all[1]!.channel).toBe('THEME_RESTORE');
  });

  it('ring-buffer trims events beyond MAX_TIMEOUTS (20) keeping only the latest', async () => {
    const logger = await freshLogger();

    for (let i = 0; i < 25; i++) {
      logger.logTimeout({
        channel: `CH_${i}`,
        ms: 1000 + i,
        timestamp: Date.now() + i,
      });
    }

    const all = logger.getAllTimeouts();
    expect(all).toHaveLength(20);
    // First event should be timeout_006 (the 6th insertion) because the first 5 were dropped.
    expect(all[0]!.id).toBe('timeout_006');
    expect(all[0]!.channel).toBe('CH_5');
    // Last event should be timeout_025 (the 25th insertion).
    expect(all[19]!.id).toBe('timeout_025');
    expect(all[19]!.channel).toBe('CH_24');
  });

  it('getRecentTimeouts(count) returns the N most recent events in FIFO order', async () => {
    const logger = await freshLogger();

    for (let i = 0; i < 10; i++) {
      logger.logTimeout({ channel: `EV_${i}`, ms: i * 100, timestamp: Date.now() + i });
    }

    const recent3 = logger.getRecentTimeouts(3);
    expect(recent3.map((e) => e.channel)).toEqual(['EV_7', 'EV_8', 'EV_9']);

    // Default parameter (no arg) returns up to 10 — all 10 in this case.
    const recentAll = logger.getRecentTimeouts();
    expect(recentAll).toHaveLength(10);
  });

  it('clearTimeouts resets the buffer and id sequence', async () => {
    const logger = await freshLogger();

    logger.logTimeout({ channel: 'A', ms: 100, timestamp: Date.now() });
    logger.logTimeout({ channel: 'B', ms: 200, timestamp: Date.now() + 1 });
    expect(logger.getAllTimeouts()).toHaveLength(2);

    logger.clearTimeouts();
    expect(logger.getAllTimeouts()).toHaveLength(0);

    // After clear, sequence restarts from 001.
    logger.logTimeout({ channel: 'C', ms: 300, timestamp: Date.now() + 2 });
    expect(logger.getAllTimeouts()[0]!.id).toBe('timeout_001');
  });

  it('getAllTimeouts returns events in chronological (insertion) order', async () => {
    const logger = await freshLogger();

    logger.logTimeout({ channel: 'FIRST', ms: 1000, timestamp: Date.now() });
    logger.logTimeout({ channel: 'SECOND', ms: 2000, timestamp: Date.now() + 1 });
    logger.logTimeout({ channel: 'THIRD', ms: 3000, timestamp: Date.now() + 2 });

    const all = logger.getAllTimeouts();
    expect(all.map((e) => e.channel)).toEqual(['FIRST', 'SECOND', 'THIRD']);
    expect(all.map((e) => e.id)).toEqual(['timeout_001', 'timeout_002', 'timeout_003']);
  });
});
