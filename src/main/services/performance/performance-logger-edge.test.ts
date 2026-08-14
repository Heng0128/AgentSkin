// SPDX-License-Identifier: MPL-2.0

/**
 * Edge-case, state-isolation, and boundary tests for PerformanceLogger.
 *
 * The companion files cover the mainstream happy paths:
 *   - performance-logger-timeout.test.ts  → IPC timeout recording
 *   - performance-logger.test.ts          → trace buffer main flow
 *
 * This file deliberately prowls the corners:
 *   - count boundary (0, -1, NaN, undefined, null, >>length)
 *   - clearTimeouts vs clear state isolation
 *   - defensive copy verification
 *   - FIFO order after ring-buffer overflow
 *   - logTimeout id monotonicity after reset
 *
 * Because the production logger is a module-level singleton, every test
 * calls `clear()` in `beforeEach` for a clean slate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performanceLogger } from './performance-logger';
import type { ThemeApplyTrace } from './types';

/* ------------------------------------------------------------------ */
/*  helpers                                                           */
/* ------------------------------------------------------------------ */

/** Build a minimal ThemeApplyTrace for tests. Uses `as unknown as`
 *  because source code in the tested paths never accesses id/startedAt/
 *  finishedAt/device sub-fields — the mock supplies only what the tests *
 *  actually read (agentId, duration, steps). */
const makeTrace = (agentId: string, duration = 100): ThemeApplyTrace =>
  ({
    agentId,
    themeId: 't1',
    duration,
    success: true,
    steps: [{ name: 's1', duration: 50, success: true }],
    device: { platform: 'win32', hostname: 'test' },
    timestamp: new Date().toISOString(),
  }) as unknown as ThemeApplyTrace;

/** Insert `n` traces with sequential agentIds (trace_001 … trace_NN). */
function fillTraces(n: number): void {
  for (let i = 1; i <= n; i++) {
    performanceLogger.log(makeTrace(`trace_${String(i).padStart(3, '0')}`));
  }
}

/* ------------------------------------------------------------------ */
/*  count boundary — getRecent                                        */
/* ------------------------------------------------------------------ */

describe('getRecent — count boundary', () => {
  // Source: n = Math.max(0, Math.min(count, buffer.length)),
  //         returns buffer.slice(-n).reverse()
  //
  // Quick verification (PowerShell/node):
  //   slice(-0)  = slice(0) = full array
  //   Math.max(0, Math.min(-1, 10))   = 0  → slice(-0) = all
  //   Math.max(0, Math.min(NaN, 10))  = NaN → slice(-NaN)=slice(0) = all
  //   Math.max(0, Math.min(undefined,10)) = NaN → same
  //   Math.max(0, Math.min(null, 10)) = 0   → slice(-0) = all
  //   Math.max(0, Math.min(9999, 10)) = 10  → slice(-10) = all
  //
  // Conclusion: every boundary value returns the *entire* buffer reversed.

  beforeEach(() => {
    fillTraces(10);
  });

  it('count=0 returns full buffer reversed (slice(-0) === slice(0))', () => {
    const result = performanceLogger.getRecent(0);
    expect(result).toHaveLength(10);
    // Newest first
    expect(result[0]!.agentId).toBe('trace_010');
    expect(result[9]!.agentId).toBe('trace_001');
  });

  it('count=-1 returns full buffer reversed (Math.max(0,-1)=0)', () => {
    const result = performanceLogger.getRecent(-1);
    expect(result).toHaveLength(10);
    expect(result[0]!.agentId).toBe('trace_010');
  });

  it('count=NaN returns full buffer reversed (Math.max(0,NaN)=NaN → slice(0))', () => {
    const result = performanceLogger.getRecent(NaN);
    expect(result).toHaveLength(10);
    expect(result[0]!.agentId).toBe('trace_010');
  });

  it('count=undefined returns full buffer reversed (→ NaN path)', () => {
    const result = performanceLogger.getRecent(undefined as unknown as number);
    expect(result).toHaveLength(10);
    expect(result[0]!.agentId).toBe('trace_010');
  });

  it('count=null returns full buffer reversed (Math.max(0,0)=0)', () => {
    const result = performanceLogger.getRecent(null as unknown as number);
    expect(result).toHaveLength(10);
    expect(result[0]!.agentId).toBe('trace_010');
  });

  it('count >> buffer.length returns full buffer reversed (clamped to length)', () => {
    const result = performanceLogger.getRecent(9999);
    expect(result).toHaveLength(10);
    expect(result[0]!.agentId).toBe('trace_010');
    expect(result[9]!.agentId).toBe('trace_001');
  });
});

/* ------------------------------------------------------------------ */
/*  count boundary — getRecentTimeouts                                */
/* ------------------------------------------------------------------ */

describe('getRecentTimeouts — count boundary', () => {
  // Source: getRecentTimeouts(count = 10) { return timeouts.slice(-count); }
  //
  // Verification (source: timeouts.slice(-count)):
  //   count=0     → slice(-0) = slice(0) = all
  //   count=-1    → slice(-(-1)) = slice(1) = all except first
  //   count=NaN   → slice(-NaN) = slice(NaN) = slice(0) = all
  //   count=undefined → default parameter kicks in → count=10
  //   count=null  → slice(-null) = slice(0) = all
  //   count=9999  → slice(-9999) = all
  //   no arg      → default → count=10 → last 10

  beforeEach(() => {
    for (let i = 1; i <= 15; i++) {
      performanceLogger.logTimeout({ channel: `CH_${i}`, ms: i * 100, timestamp: Date.now() + i });
    }
  });

  it('count=0 returns all timeouts (slice(-0) === slice(0))', () => {
    const result = performanceLogger.getRecentTimeouts(0);
    expect(result).toHaveLength(15);
  });

  it('count=-1 returns all timeouts (clamped: Math.max(0, Math.min(-1, 15)) = 0 → slice(-0) = all)', () => {
    // Post-fix: negative count is clamped to 0 → slice(-0) === slice(0) → all 15.
    // This matches getRecent() behavior where count=0 also returns the full buffer.
    const result = performanceLogger.getRecentTimeouts(-1);
    expect(result).toHaveLength(15);
    expect(result[0]!.channel).toBe('CH_1');
    expect(result[14]!.channel).toBe('CH_15');
  });

  it('count=NaN returns all timeouts (NaN poisons Math.min/max → slice(-NaN) === slice(0))', () => {
    // Post-fix: Math.min(NaN, 15) = NaN → Math.max(0, NaN) = NaN
    // slice(-NaN) → ToInteger(NaN) = 0 → slice(0) → all 15 timeouts
    const result = performanceLogger.getRecentTimeouts(NaN);
    expect(result).toHaveLength(15);
  });

  it('count=undefined triggers default (count=10) → last 10', () => {
    const result = performanceLogger.getRecentTimeouts(undefined);
    expect(result).toHaveLength(10);
    expect(result[0]!.channel).toBe('CH_6');
    expect(result[9]!.channel).toBe('CH_15');
  });

  it('count=null returns all timeouts (slice(-null) === slice(0))', () => {
    const result = performanceLogger.getRecentTimeouts(null as unknown as number);
    expect(result).toHaveLength(15);
  });

  it('count >> buffer.length returns all timeouts', () => {
    const result = performanceLogger.getRecentTimeouts(9999);
    expect(result).toHaveLength(15);
  });

  it('default parameter (no arg) returns at most 10', () => {
    const result = performanceLogger.getRecentTimeouts();
    expect(result).toHaveLength(10);
    expect(result[0]!.channel).toBe('CH_6');
    expect(result[9]!.channel).toBe('CH_15');
  });
});

/* ------------------------------------------------------------------ */
/*  state isolation — clearTimeouts vs clear                          */
/* ------------------------------------------------------------------ */

describe('clearTimeouts vs clear — state isolation', () => {
  it('clearTimeouts resets only timeouts/timeoutSeq, leaves buffer/overflow intact', () => {
    // --- Arrange: fill traces, trigger overflow, log timeouts ---
    fillTraces(51); // 51 > MAX_HISTORY(50) → traceOverflowCount=1, overflowWarned=true
    performanceLogger.logTimeout({ channel: 'T1', ms: 5000, timestamp: Date.now() });
    performanceLogger.logTimeout({ channel: 'T2', ms: 6000, timestamp: Date.now() + 1 });

    const statsBefore = performanceLogger.getStats();
    expect(statsBefore.totalApplies).toBe(50); // capped at MAX_HISTORY
    expect(statsBefore.overflowCount).toBe(1);
    expect(performanceLogger.getAllTimeouts()).toHaveLength(2);

    // --- Act: clearTimeouts only ---
    performanceLogger.clearTimeouts();

    // --- Assert: timeouts reset, buffer & overflow untouched ---
    expect(performanceLogger.getAllTimeouts()).toHaveLength(0);

    const statsAfter = performanceLogger.getStats();
    expect(statsAfter.totalApplies).toBe(50); // buffer untouched
    expect(statsAfter.overflowCount).toBe(1); // traceOverflowCount untouched
  });

  it('clear() resets all 5 state variables (buffer, traceOverflowCount, overflowWarned, timeouts, timeoutSeq)', () => {
    // --- Arrange: fill everything, trigger overflow ---
    fillTraces(51);
    performanceLogger.logTimeout({ channel: 'X', ms: 1000, timestamp: Date.now() });

    // --- Act ---
    performanceLogger.clear();

    // --- Assert: all zeroed ---
    const stats = performanceLogger.getStats();
    expect(stats.totalApplies).toBe(0);
    expect(stats.overflowCount).toBe(0);
    expect(performanceLogger.getAllTimeouts()).toHaveLength(0);
    expect(performanceLogger.getRecent(10)).toHaveLength(0);
  });

  it('after clear(), traceOverflowCount is zero so overflow re-triggers console.warn', () => {
    // --- First overflow: triggers warn, sets overflowWarned=true ---
    fillTraces(51);
    expect(performanceLogger.getStats().overflowCount).toBe(1);

    // --- clear() resets overflowWarned=false ---
    performanceLogger.clear();
    expect(performanceLogger.getStats().overflowCount).toBe(0);

    // --- Spy on console.warn before second overflow ---
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // --- Second overflow: should warn again because overflowWarned was reset ---
    fillTraces(51);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ring buffer overflow'));

    warnSpy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/*  defensive copies                                                  */
/* ------------------------------------------------------------------ */

describe('defensive copy verification', () => {
  it('getRecent() returns a new array — mutating it does not affect internal buffer', () => {
    fillTraces(5);

    const recent = performanceLogger.getRecent(3);
    expect(recent).toHaveLength(3);

    // Mutate the returned array
    recent.push(makeTrace('injected_001'));
    recent.splice(0, 1);

    // Internal buffer must be untouched
    const recentAgain = performanceLogger.getRecent(3);
    expect(recentAgain).toHaveLength(3);
    expect(recentAgain[0]!.agentId).toBe('trace_005');
    expect(recentAgain[2]!.agentId).toBe('trace_003');
  });

  it('getRecent() returns a different reference from the internal buffer', () => {
    fillTraces(3);

    const a = performanceLogger.getRecent(3);
    const b = performanceLogger.getRecent(3);
    expect(a).not.toBe(b); // different array instances
  });

  it('getAllTimeouts() returns a copy — mutating it does not affect internal state', () => {
    performanceLogger.logTimeout({ channel: 'A', ms: 100, timestamp: Date.now() });
    performanceLogger.logTimeout({ channel: 'B', ms: 200, timestamp: Date.now() + 1 });

    const all = performanceLogger.getAllTimeouts();
    expect(all).toHaveLength(2);

    // Mutate the returned array
    all.pop();
    all.push({ id: 'fake_999', channel: 'FAKE', ms: 999, timestamp: Date.now() });

    // Internal state must be untouched
    const allAgain = performanceLogger.getAllTimeouts();
    expect(allAgain).toHaveLength(2);
    expect(allAgain[0]!.channel).toBe('A');
    expect(allAgain[1]!.channel).toBe('B');
  });
});

/* ------------------------------------------------------------------ */
/*  FIFO order after ring-buffer overflow                             */
/* ------------------------------------------------------------------ */

describe('FIFO order after overflow', () => {
  it('after inserting 51 traces, buffer[0] is trace_002 (first was shifted out)', () => {
    fillTraces(51);

    // Buffer capped at MAX_HISTORY=50; trace_001 was shifted out.
    // getRecent(50) returns buffer.slice(-50).reverse() → newest first.
    // The oldest remaining (buffer[0]) is at the end of the reversed array.
    const all = performanceLogger.getRecent(50);
    expect(all).toHaveLength(50);
    expect(all[0]!.agentId).toBe('trace_051'); // newest
    expect(all[49]!.agentId).toBe('trace_002'); // oldest remaining = buffer[0]
  });

  it('after inserting 52 traces, buffer[0] is trace_003', () => {
    fillTraces(52);

    const all = performanceLogger.getRecent(50);
    expect(all).toHaveLength(50);
    expect(all[0]!.agentId).toBe('trace_052'); // newest
    expect(all[49]!.agentId).toBe('trace_003'); // oldest remaining = buffer[0]
  });

  it('FIFO order is preserved across the overflow boundary', () => {
    fillTraces(51);

    // Verify the full chronological order of the buffer (oldest → newest)
    const all = performanceLogger.getRecent(50);
    const chronological = [...all].reverse(); // now oldest first
    expect(chronological[0]!.agentId).toBe('trace_002');
    expect(chronological[1]!.agentId).toBe('trace_003');
    expect(chronological[49]!.agentId).toBe('trace_051');
  });
});

/* ------------------------------------------------------------------ */
/*  logTimeout id monotonicity                                        */
/* ------------------------------------------------------------------ */

describe('logTimeout id monotonicity', () => {
  it('ids are monotonically increasing without reset', () => {
    for (let i = 1; i <= 5; i++) {
      performanceLogger.logTimeout({ channel: `C${i}`, ms: i * 100, timestamp: Date.now() + i });
    }
    const all = performanceLogger.getAllTimeouts();
    expect(all.map((e) => e.id)).toEqual([
      'timeout_001',
      'timeout_002',
      'timeout_003',
      'timeout_004',
      'timeout_005',
    ]);
  });

  it('after clear(), timeoutSeq resets — new ids start from 001', () => {
    // Pre-fill
    for (let i = 1; i <= 3; i++) {
      performanceLogger.logTimeout({ channel: `PRE_${i}`, ms: i * 100, timestamp: Date.now() + i });
    }
    expect(performanceLogger.getAllTimeouts().map((e) => e.id)).toEqual([
      'timeout_001',
      'timeout_002',
      'timeout_003',
    ]);

    // clear() resets timeoutSeq to 0
    performanceLogger.clear();

    // New ids restart from 001
    performanceLogger.logTimeout({ channel: 'NEW_1', ms: 100, timestamp: Date.now() });
    performanceLogger.logTimeout({ channel: 'NEW_2', ms: 200, timestamp: Date.now() + 1 });
    expect(performanceLogger.getAllTimeouts().map((e) => e.id)).toEqual([
      'timeout_001',
      'timeout_002',
    ]);
  });

  it('after clearTimeouts(), timeoutSeq resets — new ids start from 001', () => {
    // Pre-fill
    for (let i = 1; i <= 3; i++) {
      performanceLogger.logTimeout({ channel: `PRE_${i}`, ms: i * 100, timestamp: Date.now() + i });
    }
    expect(performanceLogger.getAllTimeouts()[2]!.id).toBe('timeout_003');

    // clearTimeouts() resets timeoutSeq to 0
    performanceLogger.clearTimeouts();

    // New ids restart from 001
    performanceLogger.logTimeout({ channel: 'AFTER_1', ms: 100, timestamp: Date.now() });
    expect(performanceLogger.getAllTimeouts()[0]!.id).toBe('timeout_001');
  });
});

/* ------------------------------------------------------------------ */
/*  getStats perAgentAvg rounding (independent code path)              */
/* ------------------------------------------------------------------ */

describe('perAgentAvg rounding', () => {
  it('rounds per-agent average independently via Math.round', () => {
    // Agent A: durations 100 + 101 = 201 / 2 = 100.5 → Math.round → 101
    performanceLogger.log(makeTrace('agent-a', 100));
    performanceLogger.log(makeTrace('agent-a', 101));
    // Agent B: single trace 200 → avg = 200 (exact, no rounding needed)
    performanceLogger.log(makeTrace('agent-b', 200));

    const stats = performanceLogger.getStats();
    expect(stats.perAgentAvg['agent-a']).toBe(101); // proves Math.round applied
    expect(stats.perAgentAvg['agent-b']).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  logTimeout field propagation                                       */
/* ------------------------------------------------------------------ */

describe('logTimeout field propagation', () => {
  it('spreads all event fields into the stored record', () => {
    const fixedTs = 1786615200000; // 2026-08-13T18:00:00Z as Date.now()
    const event = { channel: 'theme:apply', ms: 5200, timestamp: fixedTs };
    performanceLogger.logTimeout(event);

    const all = performanceLogger.getAllTimeouts();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('timeout_001');
    expect(all[0].channel).toBe('theme:apply');
    expect(all[0].ms).toBe(5200);
    expect(all[0].timestamp).toBe(fixedTs);
  });
});

/* ------------------------------------------------------------------ */
/*  success:false trace handling                                       */
/* ------------------------------------------------------------------ */

describe('log() with success:false traces', () => {
  it('records failed traces without filtering — totalApplies still increments', () => {
    const failed = makeTrace('agent-fail', 50);
    // Override success via cast (makeTrace hardcodes true)
    (failed as { success: boolean }).success = false;
    performanceLogger.log(failed);

    expect(performanceLogger.getStats().totalApplies).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  global hooks                                                      */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  performanceLogger.clear();
});

afterEach(() => {
  performanceLogger.clear();
  vi.restoreAllMocks();
});
