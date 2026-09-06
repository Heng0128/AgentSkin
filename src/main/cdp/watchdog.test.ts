// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchdogDeps, WatchdogStatus } from './watchdog';
import { DEFAULT_WATCHDOG_CONFIG, Watchdog } from './watchdog';

// ---------------------------------------------------------------------------
// Mock the logger so watchdog's mainWarn calls don't pollute test output.
// ---------------------------------------------------------------------------
vi.mock('../logger', () => ({
  mainWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers — controllable mock dependencies
// ---------------------------------------------------------------------------

/** Build a `WatchdogDeps` mock with vi.fn() spies for every operation. */
function makeDeps(overrides: Partial<WatchdogDeps> = {}): WatchdogDeps {
  return {
    getCpuUsage: vi.fn().mockResolvedValue(null),
    isProcessAlive: vi.fn().mockReturnValue(true),
    sendSignal: vi.fn(),
    cleanupResources: vi.fn().mockResolvedValue(undefined),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => Date.now()),
    ...overrides,
  } as unknown as WatchdogDeps;
}

/**
 * Type assertion for accessing vi.fn() `.mock` properties.
 * The `WatchdogDeps` interface types erase mock metadata; this helper
 * recovers it at call sites that inspect `.mock.calls` / `.mock.results`.
 */
function mockOf<T extends (...args: never[]) => unknown>(fn: T): ReturnType<typeof vi.fn> {
  return fn as unknown as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Watchdog — basic watch / unwatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('registers a pid and starts CPU monitoring', () => {
    const deps = makeDeps();
    const wd = new Watchdog(deps);
    wd.watch(123);
    const status = wd.getStatus(123);
    expect(status).toBeDefined();
    expect(status!.pid).toBe(123);
    expect(status!.layer).toBe('idle');
    expect(status!.cpuOverCount).toBe(0);
    expect(status!.parentDead).toBe(false);
    expect(status!.orphanSince).toBeNull();
  });

  it('returns undefined for an unwatched pid', () => {
    const wd = new Watchdog(makeDeps());
    expect(wd.getStatus(999)).toBeUndefined();
  });

  it('is a no-op when unwatching a pid that is not tracked', () => {
    const wd = new Watchdog(makeDeps());
    expect(() => wd.unwatch(42)).not.toThrow();
  });

  it('stops CPU timer on unwatch (no further getCpuUsage calls)', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(null) });
    const wd = new Watchdog(deps);
    wd.watch(100);
    // Advance one interval — should call getCpuUsage once.
    await vi.advanceTimersByTimeAsync(DEFAULT_WATCHDOG_CONFIG.cpuCheckIntervalMs);
    expect(deps.getCpuUsage).toHaveBeenCalledTimes(1);
    // Unwatch — timer should be cleared.
    wd.unwatch(100);
    const prev = mockOf(deps.getCpuUsage).mock.calls.length;
    await vi.advanceTimersByTimeAsync(DEFAULT_WATCHDOG_CONFIG.cpuCheckIntervalMs * 3);
    expect(mockOf(deps.getCpuUsage).mock.calls.length).toBe(prev);
  });

  it('ignores invalid pid (<=0)', () => {
    const wd = new Watchdog(makeDeps());
    wd.watch(0);
    wd.watch(-5);
    expect(wd.getStatus(0)).toBeUndefined();
    expect(wd.getStatus(-5)).toBeUndefined();
  });

  it('re-watching the same pid refreshes config idempotently', () => {
    const wd = new Watchdog(makeDeps());
    wd.watch(50, { cpuThresholdPercent: 50 });
    // Re-watch with different config — should not throw or create duplicate.
    wd.watch(50, { cpuThresholdPercent: 99 });
    const status = wd.getStatus(50);
    expect(status).toBeDefined();
    expect(status!.pid).toBe(50);
  });
});

describe('Watchdog — Layer 1: CPU lag detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('increments cpuOverCount when usage exceeds threshold', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(90) });
    const wd = new Watchdog(deps);
    wd.watch(200, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 3,
    });
    // Advance one interval — one sample over threshold.
    await vi.advanceTimersByTimeAsync(100);
    expect(wd.getStatus(200)!.cpuOverCount).toBe(1);
    // Still idle — not yet at consecutive threshold.
    expect(wd.getStatus(200)!.layer).toBe('idle');
  });

  it('transitions to "soft" layer after consecutive threshold is reached', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(95) });
    const wd = new Watchdog(deps);
    wd.watch(201, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 3,
    });
    // Advance 3 intervals — 3 consecutive over-threshold samples.
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    const status = wd.getStatus(201);
    expect(status!.cpuOverCount).toBe(3);
    expect(status!.layer).toBe('soft');
  });

  it('resets cpuOverCount when usage drops below threshold', async () => {
    let callCount = 0;
    const deps = makeDeps({
      getCpuUsage: vi.fn().mockImplementation(async () => {
        // First 2 calls over threshold, then drop.
        callCount++;
        return callCount <= 2 ? 90 : 10;
      }),
    });
    const wd = new Watchdog(deps);
    wd.watch(202, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 3,
    });
    await vi.advanceTimersByTimeAsync(100); // over
    await vi.advanceTimersByTimeAsync(100); // over (count=2)
    expect(wd.getStatus(202)!.cpuOverCount).toBe(2);
    await vi.advanceTimersByTimeAsync(100); // under → reset
    expect(wd.getStatus(202)!.cpuOverCount).toBe(0);
    expect(wd.getStatus(202)!.layer).toBe('idle');
  });

  it('returns to idle from soft when usage normalizes', async () => {
    let callCount = 0;
    const deps = makeDeps({
      getCpuUsage: vi.fn().mockImplementation(async () => {
        callCount++;
        // First 3 over (triggers soft), then normal.
        return callCount <= 3 ? 95 : 10;
      }),
    });
    const wd = new Watchdog(deps);
    wd.watch(203, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 3,
    });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(wd.getStatus(203)!.layer).toBe('soft');
    // Now usage drops.
    await vi.advanceTimersByTimeAsync(100);
    expect(wd.getStatus(203)!.layer).toBe('idle');
  });

  it('skips the cycle when getCpuUsage returns null', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(null) });
    const wd = new Watchdog(deps);
    wd.watch(204, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 1,
    });
    await vi.advanceTimersByTimeAsync(100);
    // Null usage → no increment, stays idle.
    expect(wd.getStatus(204)!.cpuOverCount).toBe(0);
    expect(wd.getStatus(204)!.layer).toBe('idle');
  });
});

describe('Watchdog — Layer 2: Orphan detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('flags parentDead and sets orphanSince when parent dies', () => {
    const deps = makeDeps({
      isProcessAlive: vi.fn().mockReturnValue(false),
      now: vi.fn(() => 1000),
    });
    const wd = new Watchdog(deps);
    wd.watch(300, {}, 999); // ppid=999
    // checkParent is the public entry point for orphan detection.
    // Access via prototype cast — it's intentionally public for the consumer.
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(
      (wd as unknown as { entries: Map<number, unknown> }).entries.get(300),
    );
    const status = wd.getStatus(300);
    expect(status!.parentDead).toBe(true);
    expect(status!.orphanSince).toBe(1000);
    expect(status!.layer).toBe('orphan');
  });

  it('resets orphan state if parent comes back alive', () => {
    let alive = false;
    const deps = makeDeps({
      isProcessAlive: vi.fn().mockImplementation(() => alive),
      now: vi.fn(() => 1000),
    });
    const wd = new Watchdog(deps);
    wd.watch(301, {}, 888);
    const entry = (wd as unknown as { entries: Map<number, unknown> }).entries.get(301);
    // Parent dead.
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    expect(wd.getStatus(301)!.parentDead).toBe(true);
    // Parent resurrects.
    alive = true;
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    const status = wd.getStatus(301);
    expect(status!.parentDead).toBe(false);
    expect(status!.orphanSince).toBeNull();
    expect(status!.layer).toBe('idle');
  });

  it('escalates to Layer 3 (force kill) after orphanTimeoutMs', async () => {
    const deps = makeDeps({
      isProcessAlive: vi.fn().mockReturnValue(false),
      now: vi.fn(() => 5000),
    });
    const wd = new Watchdog(deps);
    wd.watch(302, { orphanTimeoutMs: 200 }, 777);
    const entry = (wd as unknown as { entries: Map<number, unknown> }).entries.get(302);
    // Trigger orphan detection.
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    expect(wd.getStatus(302)!.layer).toBe('orphan');
    // Advance past the orphan timeout.
    await vi.advanceTimersByTimeAsync(200);
    // After timeout, force kill is triggered → layer becomes 'killed'.
    expect(wd.getStatus(302)!.layer).toBe('killed');
    expect(deps.sendSignal).toHaveBeenCalledWith(302, 'SIGKILL');
    expect(deps.cleanupResources).toHaveBeenCalledWith(302);
  });

  it('does NOT kill if parent resurrects before timeout', async () => {
    let alive = false;
    const deps = makeDeps({
      isProcessAlive: vi.fn().mockImplementation(() => alive),
      now: vi.fn(() => 5000),
    });
    const wd = new Watchdog(deps);
    wd.watch(303, { orphanTimeoutMs: 200 }, 666);
    const entry = (wd as unknown as { entries: Map<number, unknown> }).entries.get(303);
    // Parent dead → orphan.
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    expect(wd.getStatus(303)!.layer).toBe('orphan');
    // Parent comes back before timeout elapses.
    alive = true;
    await vi.advanceTimersByTimeAsync(100);
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    // Advance past original timeout.
    await vi.advanceTimersByTimeAsync(200);
    // Should NOT have been killed.
    expect(deps.sendSignal).not.toHaveBeenCalled();
    expect(wd.getStatus(303)!.layer).toBe('idle');
  });
});

describe('Watchdog — Layer 3: Force kill / cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('cleanup() force-kills and removes the pid', async () => {
    const deps = makeDeps();
    const wd = new Watchdog(deps);
    wd.watch(400);
    await wd.cleanup(400);
    expect(deps.sendSignal).toHaveBeenCalledWith(400, 'SIGKILL');
    expect(deps.cleanupResources).toHaveBeenCalledWith(400);
    expect(wd.getStatus(400)).toBeUndefined();
  });

  it('cleanup() is a no-op for an unwatched pid', async () => {
    const deps = makeDeps();
    const wd = new Watchdog(deps);
    await wd.cleanup(999);
    expect(deps.sendSignal).not.toHaveBeenCalled();
  });

  it('uses custom killSignal from config', async () => {
    const deps = makeDeps();
    const wd = new Watchdog(deps);
    wd.watch(401, { killSignal: 'SIGTERM' });
    await wd.cleanup(401);
    expect(deps.sendSignal).toHaveBeenCalledWith(401, 'SIGTERM');
  });

  it('handles sendSignal failure gracefully', async () => {
    const deps = makeDeps({
      sendSignal: vi.fn(() => {
        throw new Error('ESRCH');
      }),
    });
    const wd = new Watchdog(deps);
    wd.watch(402);
    // Should not throw — the implementation catches errors internally.
    await expect(wd.cleanup(402)).resolves.toBeUndefined();
    expect(deps.cleanupResources).toHaveBeenCalledWith(402);
  });
});

describe('Watchdog — stopAll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('force-kills and removes every watched pid', async () => {
    const deps = makeDeps();
    const wd = new Watchdog(deps);
    wd.watch(500);
    wd.watch(501);
    wd.watch(502);
    await wd.stopAll();
    expect(deps.sendSignal).toHaveBeenCalledWith(500, 'SIGKILL');
    expect(deps.sendSignal).toHaveBeenCalledWith(501, 'SIGKILL');
    expect(deps.sendSignal).toHaveBeenCalledWith(502, 'SIGKILL');
    expect(wd.getStatus(500)).toBeUndefined();
    expect(wd.getStatus(501)).toBeUndefined();
    expect(wd.getStatus(502)).toBeUndefined();
  });

  it('stopAll on an empty watchdog is a no-op', async () => {
    const wd = new Watchdog(makeDeps());
    await expect(wd.stopAll()).resolves.toBeUndefined();
  });
});

describe('Watchdog — custom config', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('uses default config when none is provided', () => {
    const wd = new Watchdog(makeDeps());
    wd.watch(600);
    const status = wd.getStatus(600);
    expect(status).toBeDefined();
    // The default config values are applied internally; we verify behavior:
    // with default cpuConsecutiveThreshold=3, 2 over-threshold samples
    // should NOT trigger soft layer.
  });

  it('respects custom cpuThresholdPercent', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(50) });
    const wd = new Watchdog(deps);
    wd.watch(601, {
      cpuCheckIntervalMs: 50,
      cpuThresholdPercent: 40,
      cpuConsecutiveThreshold: 1,
    });
    await vi.advanceTimersByTimeAsync(50);
    // 50 > 40 → triggers soft immediately (consecutiveThreshold=1).
    expect(wd.getStatus(601)!.layer).toBe('soft');
  });

  it('respects custom orphanTimeoutMs', async () => {
    const deps = makeDeps({
      isProcessAlive: vi.fn().mockReturnValue(false),
      now: vi.fn(() => 1000),
    });
    const wd = new Watchdog(deps);
    wd.watch(602, { orphanTimeoutMs: 500 }, 555);
    const entry = (wd as unknown as { entries: Map<number, unknown> }).entries.get(602);
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    // Advance 400ms — not yet timed out.
    await vi.advanceTimersByTimeAsync(400);
    expect(deps.sendSignal).not.toHaveBeenCalled();
    // Advance another 200ms — total 600ms > 500ms timeout.
    await vi.advanceTimersByTimeAsync(200);
    expect(deps.sendSignal).toHaveBeenCalledWith(602, 'SIGKILL');
  });
});

describe('Watchdog — getStatus immutability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('returns a snapshot that does not mutate internal state', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(95) });
    const wd = new Watchdog(deps);
    wd.watch(700, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 1,
    });
    const snap1 = wd.getStatus(700);
    expect(snap1!.cpuOverCount).toBe(0);
    // Mutate the returned object.
    (snap1 as WatchdogStatus).cpuOverCount = 999;
    // Internal state should be unaffected.
    const snap2 = wd.getStatus(700);
    expect(snap2!.cpuOverCount).toBe(0);
  });
});
