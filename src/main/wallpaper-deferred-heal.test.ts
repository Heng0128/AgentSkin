// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../shared/types';

// Mock wallpaper-server so injectAgentWallpaper never hits real loopback HTTP.
vi.mock('./wallpaper-server', () => ({
  wallpaperMediaServer: {
    register: vi.fn().mockResolvedValue(null),
    unregister: vi.fn(),
  },
}));

import type { WallpaperInjectorDeps } from './wallpaper-injector';
import {
  _resetDeferredSelfHealsForTest,
  drainAllDeferredSelfHeals,
  scheduleDeferredSelfHeal,
} from './wallpaper-injector';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const TEST_AGENT: AgentId = 'traework' as AgentId;

/**
 * Controls what deps.isApplyingTheme returns. The poll loop reads this
 * dynamically, so flipping the return value mid-test simulates the lock
 * being released.
 */
function createIsApplyingThemeController(initial = true) {
  let applying = initial;
  return {
    isApplyingTheme: vi.fn((appId: AgentId) => {
      expect(appId).toBe(TEST_AGENT);
      return applying;
    }),
    setApplying: (value: boolean) => {
      applying = value;
    },
  };
}

function createMockDeps(isApplyingTheme: (appId: AgentId) => boolean): WallpaperInjectorDeps {
  return {
    wallpaperService: null,
    isEpochCurrent: () => true,
    bumpEpoch: () => 1,
    resolveAgentWallpaperId: async () => ({ id: null }),
    ensureCdpReady: async () => ({ port: 0, reason: 'test' }),
    resolveLivePort: async () => null,
    inferRestartReason: async () => 'no-cdp' as const,
    findAgentTargets: async () => [],
    setAgentWallpaper: async () => {},
    log: vi.fn(),
    isApplyingTheme,
  } as unknown as WallpaperInjectorDeps;
}

// ---------------------------------------------------------------------------
// Drain constants — must match the production values for correctness
// ---------------------------------------------------------------------------

/** Base poll interval (ms). This is the actual delay only for attempts 0–4;
 *  later attempts use progressive backoff via {@link backoffForAttempt}. */
const DEFERRED_POLL_INTERVAL_MS = 100;
const DEFERRED_MAX_WAIT_MS = 10_000;

/**
 * Mirror of the production backoff formula in wallpaper-injector.ts.
 * Used so tests track real scheduling rather than assuming a fixed interval.
 *   attempts 0-4  → 100ms
 *   attempts 5-9  → 200ms
 *   attempts 10-14 → 400ms
 *   attempts 15-19 → 800ms
 *   attempts 20+   → 1600ms (cap)
 */
const backoffForAttempt = (attempt: number): number =>
  Math.min(1600, 100 * 2 ** Math.floor(attempt / 5));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scheduleDeferredSelfHeal — drain after lock released', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetDeferredSelfHealsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDeferredSelfHealsForTest();
  });

  it('drains thunk after isApplyingTheme releases during polling', async () => {
    // Scenario: self-heal triggered while apply/restore is in-flight.
    // The poll loop should detect the lock release and execute the thunk.
    const ctrl = createIsApplyingThemeController(true); // starts locked
    const deps = createMockDeps(ctrl.isApplyingTheme);
    const thunk = vi.fn().mockResolvedValue(undefined);

    scheduleDeferredSelfHeal(TEST_AGENT, thunk, deps);

    // Initially: thunk should not be called — still locked.
    expect(thunk).not.toHaveBeenCalled();

    // Advance 100ms → first poll. Still locked → re-poll.
    await vi.advanceTimersByTimeAsync(DEFERRED_POLL_INTERVAL_MS);
    expect(thunk).not.toHaveBeenCalled();

    // Advance another 100ms → second poll. Still locked → re-poll.
    await vi.advanceTimersByTimeAsync(DEFERRED_POLL_INTERVAL_MS);
    expect(thunk).not.toHaveBeenCalled();

    // Now simulate the in-flight op releasing the lock.
    ctrl.setApplying(false);

    // Advance 100ms → third poll. Lock released → drain the thunk.
    await vi.advanceTimersByTimeAsync(DEFERRED_POLL_INTERVAL_MS);
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('does not drain while lock is held', async () => {
    // Scenario: lock remains held through multiple poll cycles — thunk
    // must NOT execute until the lock releases.
    const ctrl = createIsApplyingThemeController(true);
    const deps = createMockDeps(ctrl.isApplyingTheme);
    const thunk = vi.fn().mockResolvedValue(undefined);

    scheduleDeferredSelfHeal(TEST_AGENT, thunk, deps);

    // Walk the real schedule using progressive backoff. After each advance we
    // assert the thunk has NOT drained — the lock is held and elapsed < 10 s.
    // The loop accumulates ~3.1 s (well below the 10 s safety bound).
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(backoffForAttempt(i));
      expect(thunk).not.toHaveBeenCalled();
    }
    // Final assertion: still no drainage after several poll cycles.
    expect(thunk).not.toHaveBeenCalled();
  });
});

describe('scheduleDeferredSelfHeal — forced drain after max wait (10s)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetDeferredSelfHealsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDeferredSelfHealsForTest();
  });

  it('forces drain after 10s even when lock is never released', async () => {
    // Scenario: apply/restore never releases the lock (stuck/hung). The
    // safety bound must fire after 10s to prevent indefinite deferral.
    // Production uses progressive backoff; we use vi.runAllTimersAsync()
    // to flush all pending timers until the drain triggers.
    const ctrl = createIsApplyingThemeController(true); // locked forever
    const deps = createMockDeps(ctrl.isApplyingTheme);
    const thunk = vi.fn().mockResolvedValue(undefined);

    scheduleDeferredSelfHeal(TEST_AGENT, thunk, deps);

    // Flush all pending timers — the safety bound must eventually trigger.
    await vi.runAllTimersAsync();
    expect(thunk).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleDeferredSelfHeal — "last wins" deduplication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetDeferredSelfHealsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDeferredSelfHealsForTest();
  });

  it('only drains the most recently scheduled thunk for the same agent', async () => {
    // Scenario: self-heal triggered 3 times while apply/restore is in-flight.
    // The Map overwrite semantics must mean only the 3rd thunk executes.
    const ctrl = createIsApplyingThemeController(true);
    const deps = createMockDeps(ctrl.isApplyingTheme);

    const thunk1 = vi.fn().mockResolvedValue(undefined);
    const thunk2 = vi.fn().mockResolvedValue(undefined);
    const thunk3 = vi.fn().mockResolvedValue(undefined);

    // Schedule three deferred self-heals for the same agent.
    scheduleDeferredSelfHeal(TEST_AGENT, thunk1, deps);
    scheduleDeferredSelfHeal(TEST_AGENT, thunk2, deps);
    scheduleDeferredSelfHeal(TEST_AGENT, thunk3, deps);

    // Release the lock.
    ctrl.setApplying(false);

    // Advance one poll cycle → only the last thunk should drain.
    await vi.advanceTimersByTimeAsync(DEFERRED_POLL_INTERVAL_MS);

    expect(thunk1).not.toHaveBeenCalled();
    expect(thunk2).not.toHaveBeenCalled();
    expect(thunk3).toHaveBeenCalledTimes(1);
  });

  it('does not start duplicate drain timers for the same agent', () => {
    // Scenario: multiple triggers during one in-flight window should
    // register only ONE drain timer (the second/third calls see the timer
    // already in deferredSelfHealTimers and skip scheduling).
    const ctrl = createIsApplyingThemeController(true);
    const deps = createMockDeps(ctrl.isApplyingTheme);

    scheduleDeferredSelfHeal(TEST_AGENT, vi.fn().mockResolvedValue(undefined), deps);
    scheduleDeferredSelfHeal(TEST_AGENT, vi.fn().mockResolvedValue(undefined), deps);
    scheduleDeferredSelfHeal(TEST_AGENT, vi.fn().mockResolvedValue(undefined), deps);

    // Count pending setTimeout calls. Only ONE should be registered
    // (the first call schedules the drain; the rest are no-ops).
    const pendingTimers = vi.getTimerCount();
    expect(pendingTimers).toBe(1);
  });
});

describe('drainAllDeferredSelfHeals — emergency flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetDeferredSelfHealsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDeferredSelfHealsForTest();
  });

  it('executes pending thunks and clears timer tracking via drainAll', async () => {
    const ctrl = createIsApplyingThemeController(true);
    const deps = createMockDeps(ctrl.isApplyingTheme);
    const thunk = vi.fn().mockResolvedValue(undefined);

    scheduleDeferredSelfHeal(TEST_AGENT, thunk, deps);
    expect(thunk).not.toHaveBeenCalled();

    // Emergency flush: drain all pending deferred self-heals NOW.
    drainAllDeferredSelfHeals();

    // The thunk must be invoked immediately, bypassing the poll loop.
    expect(thunk).toHaveBeenCalledTimes(1);

    // Advancing timers should NOT trigger another execution (timer cleared).
    await vi.advanceTimersByTimeAsync(DEFERRED_MAX_WAIT_MS);
    expect(thunk).toHaveBeenCalledTimes(1); // still 1, not 2
  });
});
