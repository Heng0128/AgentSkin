// SPDX-License-Identifier: MPL-2.0

/**
 * # L1 — Watchdog (Mocked Side Effects)
 *
 * Tests the three-layer watchdog with fully mocked dependencies
 * (WatchdogDeps). No real process signals, no timers advancing in wall-clock
 * time — all controlled by vi.useFakeTimers().
 *
 * Run: npm run test:backtest:l1
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchdogDeps, WatchdogStatus } from '../../src/main/cdp/watchdog';
import { DEFAULT_WATCHDOG_CONFIG, Watchdog } from '../../src/main/cdp/watchdog';

// ---------------------------------------------------------------------------
// Mock the logger
// ---------------------------------------------------------------------------

vi.mock('../../src/main/logger', () => ({
  mainWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function mockOf<T extends (...args: never[]) => unknown>(fn: T): ReturnType<typeof vi.fn> {
  return fn as unknown as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Tests — basic watch / unwatch
// ---------------------------------------------------------------------------

describe('L1 — Watchdog: basic watch / unwatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('registers a pid and starts CPU monitoring', () => {
    const wd = new Watchdog(makeDeps());
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

  it('unwatch is a no-op for an untracked pid', () => {
    const wd = new Watchdog(makeDeps());
    expect(() => wd.unwatch(42)).not.toThrow();
  });

  it('stops CPU timer on unwatch (no further getCpuUsage calls)', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(null) });
    const wd = new Watchdog(deps);
    wd.watch(100);

    await vi.advanceTimersByTimeAsync(DEFAULT_WATCHDOG_CONFIG.cpuCheckIntervalMs);
    expect(mockOf(deps.getCpuUsage)).toHaveBeenCalledTimes(1);

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
    wd.watch(50, { cpuThresholdPercent: 99 });
    expect(wd.getStatus(50)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — Layer 1: CPU lag detection
// ---------------------------------------------------------------------------

describe('L1 — Watchdog: Layer 1 CPU lag detection', () => {
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

    await vi.advanceTimersByTimeAsync(100);
    expect(wd.getStatus(200)!.cpuOverCount).toBe(1);
    expect(wd.getStatus(200)!.layer).toBe('idle');
  });

  it('transitions to "soft" layer after consecutive threshold', async () => {
    const deps = makeDeps({ getCpuUsage: vi.fn().mockResolvedValue(95) });
    const wd = new Watchdog(deps);
    wd.watch(201, {
      cpuCheckIntervalMs: 100,
      cpuThresholdPercent: 80,
      cpuConsecutiveThreshold: 3,
    });

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
    expect(wd.getStatus(204)!.cpuOverCount).toBe(0);
    expect(wd.getStatus(204)!.layer).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Tests — Layer 2: Orphan detection
// ---------------------------------------------------------------------------

describe('L1 — Watchdog: Layer 2 orphan detection', () => {
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
    wd.watch(300, {}, 999);

    const entry = (wd as unknown as { entries: Map<number, unknown> }).entries.get(300);
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);

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

    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    expect(wd.getStatus(301)!.parentDead).toBe(true);

    alive = true;
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);

    const status = wd.getStatus(301);
    expect(status!.parentDead).toBe(false);
    expect(status!.orphanSince).toBeNull();
    expect(status!.layer).toBe('idle');
  });

  it('escalates to Layer 3 after orphanTimeoutMs', async () => {
    const deps = makeDeps({
      isProcessAlive: vi.fn().mockReturnValue(false),
      now: vi.fn(() => 5000),
    });
    const wd = new Watchdog(deps);
    wd.watch(302, { orphanTimeoutMs: 200 }, 777);

    const entry = (wd as unknown as { entries: Map<number, unknown> }).entries.get(302);
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    expect(wd.getStatus(302)!.layer).toBe('orphan');

    await vi.advanceTimersByTimeAsync(200);

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
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);
    expect(wd.getStatus(303)!.layer).toBe('orphan');

    alive = true;
    await vi.advanceTimersByTimeAsync(100);
    (wd as unknown as { checkParent: (e: unknown) => void }).checkParent(entry);

    await vi.advanceTimersByTimeAsync(200);
    expect(deps.sendSignal).not.toHaveBeenCalled();
    expect(wd.getStatus(303)!.layer).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Tests — Layer 3: Force kill / cleanup
// ---------------------------------------------------------------------------

describe('L1 — Watchdog: Layer 3 force kill / cleanup', () => {
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
    await expect(wd.cleanup(402)).resolves.toBeUndefined();
    expect(deps.cleanupResources).toHaveBeenCalledWith(402);
  });
});

// ---------------------------------------------------------------------------
// Tests — stopAll
// ---------------------------------------------------------------------------

describe('L1 — Watchdog: stopAll', () => {
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

// ---------------------------------------------------------------------------
// Tests — getStatus immutability
// ---------------------------------------------------------------------------

describe('L1 — Watchdog: getStatus immutability', () => {
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

    (snap1 as WatchdogStatus).cpuOverCount = 999;

    const snap2 = wd.getStatus(700);
    expect(snap2!.cpuOverCount).toBe(0);
  });
});
