// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for the core trace buffer of PerformanceLogger.
 *
 * Coverage targets ring-buffer semantics (push, overflow tracking,
 * one-shot console.warn), read methods (getRecent, getStats, getHistory),
 * and the clear() reset. IPC timeout methods are covered in a sibling
 * file (`performance-logger-timeout.test.ts`).
 *
 * Because the production logger is a module-level singleton shared across
 * test files, every case calls `clear()` in `beforeEach` to guarantee a
 * clean slate and uses the AFTER pattern for cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performanceLogger } from './performance-logger';
import type { ThemeApplyTrace } from './types';

/** Build a minimal ThemeApplyTrace with the given overrides. */
function makeTrace(overrides: Partial<ThemeApplyTrace> = {}): ThemeApplyTrace {
  return {
    id: 'apply_001',
    agentId: 'agent-a',
    themeId: 'theme-1',
    startedAt: 1_700_000_000_000,
    finishedAt: new Date('2024-06-15T10:00:00.000Z').toISOString(),
    duration: 100,
    success: true,
    steps: [{ name: 'resolveTheme', startedAt: 1_700_000_000_000, duration: 50, success: true }],
    device: {
      platform: 'win32',
      arch: 'x64',
      cpus: 8,
      totalMemory: 16384,
      freeMemory: 4096,
      electronVersion: '28.0.0',
    },
    ...overrides,
  } as ThemeApplyTrace;
}

beforeEach(() => {
  performanceLogger.clear();
});

afterEach(() => {
  performanceLogger.clear();
  vi.restoreAllMocks();
});

describe('PerformanceLogger — log() & ring buffer', () => {
  it('first log() pushes one entry and buffer length becomes 1', () => {
    performanceLogger.log(makeTrace());
    expect(performanceLogger.getRecent(10)).toHaveLength(1);
  });

  it('fills up to MAX_HISTORY (50) without overflowing', () => {
    for (let i = 0; i < 50; i++) {
      performanceLogger.log(makeTrace({ id: `apply_${i}` }));
    }
    expect(performanceLogger.getStats().totalApplies).toBe(50);
    expect(performanceLogger.getStats().overflowCount).toBe(0);
  });

  it('51st log() triggers overflow: traceOverflowCount === 1, buffer stays at MAX_HISTORY', () => {
    for (let i = 0; i < 51; i++) {
      performanceLogger.log(makeTrace({ id: `apply_${i}` }));
    }
    expect(performanceLogger.getStats().overflowCount).toBe(1);
    expect(performanceLogger.getStats().totalApplies).toBe(50);
    expect(performanceLogger.getRecent(100)).toHaveLength(50);
  });

  it('accumulates traceOverflowCount across multiple overflows', () => {
    for (let i = 0; i < 120; i++) {
      performanceLogger.log(makeTrace({ id: `apply_${i}` }));
    }
    // 120 insertions – 50 capacity = 70 overflows
    expect(performanceLogger.getStats().overflowCount).toBe(70);
    expect(performanceLogger.getStats().totalApplies).toBe(50);
  });

  it('warns via console.warn exactly once on first overflow, not on subsequent ones', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    for (let i = 0; i < 55; i++) {
      performanceLogger.log(makeTrace({ id: `apply_${i}` }));
    }

    // console.warn should only be called once (one-shot warning)
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain('ring buffer overflow');

    warnSpy.mockRestore();
  });

  it('after overflow, buffer retains the most recent MAX_HISTORY entries (FIFO eviction)', () => {
    for (let i = 0; i < 55; i++) {
      performanceLogger.log(makeTrace({ id: `apply_${i}`, duration: i * 10 }));
    }

    const recent = performanceLogger.getRecent(50);
    // entries 0-4 were evicted; newest entry should be apply_54
    expect(recent[0]!.id).toBe('apply_54');
    // oldest surviving entry should be apply_5
    expect(recent[49]!.id).toBe('apply_5');
  });
});

describe('PerformanceLogger — getRecent()', () => {
  it('returns [] when the buffer is empty', () => {
    expect(performanceLogger.getRecent(10)).toEqual([]);
  });

  it('returns up to count entries in most-recent-first order', () => {
    performanceLogger.log(makeTrace({ id: 't1', duration: 10 }));
    performanceLogger.log(makeTrace({ id: 't2', duration: 20 }));
    performanceLogger.log(makeTrace({ id: 't3', duration: 30 }));

    const recent = performanceLogger.getRecent(2);
    expect(recent.map((t) => t.id)).toEqual(['t3', 't2']);
  });

  it('returns all entries when count exceeds buffer length', () => {
    performanceLogger.log(makeTrace({ id: 'a' }));
    performanceLogger.log(makeTrace({ id: 'b' }));

    const recent = performanceLogger.getRecent(100);
    expect(recent).toHaveLength(2);
    expect(recent.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('getRecent(0) returns a full reversed copy (slice(-0) quirk)', () => {
    performanceLogger.log(makeTrace({ id: 'x1' }));
    performanceLogger.log(makeTrace({ id: 'x2' }));
    performanceLogger.log(makeTrace({ id: 'x3' }));

    // Current implementation: Math.max(0, Math.min(0, 3)) = 0, slice(-0) returns all
    const result = performanceLogger.getRecent(0);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.id)).toEqual(['x3', 'x2', 'x1']);
  });

  it('returns a new array instance (structural copy), but entries are shared references (shallow copy)', () => {
    performanceLogger.log(makeTrace({ id: 'orig', duration: 42 }));

    const first = performanceLogger.getRecent(1);
    const second = performanceLogger.getRecent(1);

    // The two calls produce different array instances — structural copy.
    expect(first).not.toBe(second);

    // Pushing/removing on the returned array does not affect the buffer.
    second.push(makeTrace({ id: 'fake', duration: 999 } as ThemeApplyTrace));
    expect(performanceLogger.getStats().totalApplies).toBe(1);

    // However, the entries themselves are shared references (shallow copy).
    // Mutating a returned entry WILL affect the buffer — this is by design
    // (slice() returns a new array of the same object references).
    first[0]!.id = 'mutated';
    expect(performanceLogger.getRecent(1)[0]!.id).toBe('mutated');
  });
});

describe('PerformanceLogger — getStats()', () => {
  it('returns zeroed stats when the buffer is empty', () => {
    const stats = performanceLogger.getStats();
    expect(stats).toEqual({
      totalApplies: 0,
      avgDurationMs: 0,
      perAgentAvg: {},
      overflowCount: 0,
    });
  });

  it('computes avgDurationMs for a single trace', () => {
    performanceLogger.log(makeTrace({ agentId: 'a1', duration: 250 }));
    const stats = performanceLogger.getStats();
    expect(stats.totalApplies).toBe(1);
    expect(stats.avgDurationMs).toBe(250);
    expect(stats.perAgentAvg).toEqual({ a1: 250 });
  });

  it('rounds avgDurationMs to nearest integer (Math.round)', () => {
    performanceLogger.log(makeTrace({ id: 'r1', agentId: 'a1', duration: 101 }));
    performanceLogger.log(makeTrace({ id: 'r2', agentId: 'a1', duration: 102 }));
    // (101 + 102) / 2 = 101.5 → Math.round → 102
    expect(performanceLogger.getStats().avgDurationMs).toBe(102);
  });

  it('buckets by agentId in perAgentAvg', () => {
    performanceLogger.log(makeTrace({ id: 'm1', agentId: 'alpha', duration: 100 }));
    performanceLogger.log(makeTrace({ id: 'm2', agentId: 'alpha', duration: 200 }));
    performanceLogger.log(makeTrace({ id: 'm3', agentId: 'beta', duration: 300 }));
    performanceLogger.log(makeTrace({ id: 'm4', agentId: 'beta', duration: 500 }));

    const stats = performanceLogger.getStats();
    expect(stats.totalApplies).toBe(4);
    // alpha avg = (100 + 200) / 2 = 150
    expect(stats.perAgentAvg.alpha).toBe(150);
    // beta avg = (300 + 500) / 2 = 400
    expect(stats.perAgentAvg.beta).toBe(400);
    // global avg = (100 + 200 + 300 + 500) / 4 = 275
    expect(stats.avgDurationMs).toBe(275);
  });

  it('reflects accumulated overflowCount in stats after buffer wraps', () => {
    for (let i = 0; i < 60; i++) {
      performanceLogger.log(makeTrace({ id: `ov_${i}` }));
    }
    // 60 insertions - 50 capacity = 10 overflows
    expect(performanceLogger.getStats().overflowCount).toBe(10);
    expect(performanceLogger.getStats().totalApplies).toBe(50);
  });
});

describe('PerformanceLogger — getHistory()', () => {
  it('returns a { recent, stats } object structure', () => {
    const history = performanceLogger.getHistory(10);
    expect(history).toHaveProperty('recent');
    expect(history).toHaveProperty('stats');
    expect(Array.isArray(history.recent)).toBe(true);
    expect(typeof history.stats).toBe('object');
  });

  it('recent and stats are consistent (totalApplies matches recent length)', () => {
    for (let i = 0; i < 5; i++) {
      performanceLogger.log(makeTrace({ id: `h_${i}` }));
    }

    const history = performanceLogger.getHistory(10);
    expect(history.stats.totalApplies).toBe(5);
    // When count (10) ≥ buffer length (5), recent should hold all 5
    expect(history.recent).toHaveLength(5);
    expect(history.recent.map((t) => t.id)).toEqual(['h_4', 'h_3', 'h_2', 'h_1', 'h_0']);
  });

  it('respects count parameter — only the most recent N are returned', () => {
    for (let i = 0; i < 20; i++) {
      performanceLogger.log(makeTrace({ id: `c_${i}` }));
    }

    const history = performanceLogger.getHistory(3);
    expect(history.recent).toHaveLength(3);
    expect(history.recent.map((t) => t.id)).toEqual(['c_19', 'c_18', 'c_17']);
    // But stats should reflect the full buffer (totalApplies = 20)
    expect(history.stats.totalApplies).toBe(20);
  });
});

describe('PerformanceLogger — clear()', () => {
  it('empties the trace buffer after clear()', () => {
    performanceLogger.log(makeTrace());
    performanceLogger.log(makeTrace({ id: 't2' }));
    expect(performanceLogger.getStats().totalApplies).toBe(2);

    performanceLogger.clear();
    expect(performanceLogger.getStats().totalApplies).toBe(0);
    expect(performanceLogger.getRecent(10)).toEqual([]);
  });

  it('resets traceOverflowCount to zero', () => {
    for (let i = 0; i < 60; i++) {
      performanceLogger.log(makeTrace({ id: `clr_${i}` }));
    }
    expect(performanceLogger.getStats().overflowCount).toBe(10);

    performanceLogger.clear();
    expect(performanceLogger.getStats().overflowCount).toBe(0);
  });

  it('resets overflowWarned — next overflow triggers console.warn again', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First overflow
    for (let i = 0; i < 51; i++) {
      performanceLogger.log(makeTrace({ id: `w1_${i}` }));
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Clear — this should reset overflowWarned
    performanceLogger.clear();

    // Second overflow after clear — should warn again
    for (let i = 0; i < 51; i++) {
      performanceLogger.log(makeTrace({ id: `w2_${i}` }));
    }
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it('also clears the timeout sidecar state', () => {
    performanceLogger.log(makeTrace());
    performanceLogger.logTimeout({
      channel: 'THEME_APPLY',
      ms: 5000,
      timestamp: Date.now(),
    });

    performanceLogger.clear();

    // Timeout buffer should be empty after clear()
    expect(performanceLogger.getAllTimeouts()).toHaveLength(0);
    // Trace buffer should also be empty
    expect(performanceLogger.getStats().totalApplies).toBe(0);
  });
});
