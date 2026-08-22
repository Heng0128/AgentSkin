// SPDX-License-Identifier: MPL-2.0

/**
 * # useConcurrencyReporter tests
 *
 * Verifies the renderer-side concurrency reporter that pushes
 * `companionBusyByAgent.size` and `switchEpochByAgent.size` to the
 * main process via the `diagnostics:update-renderer-concurrency` IPC channel.
 *
 * Without this push, the main process's cached sizes stay 0 forever and the
 * Diagnostics tab never shows the renderer-side concurrency guards.
 *
 * Testing strategy (matches PerformancePanel-polling.test.tsx):
 *   - The `ui` vitest project uses `environment: 'node' (no jsdom) and
 *     `pool: 'forks'. React's useEffect does not execute under SSR-style
 *     rendering, so we verify the REPORTING PATTERN (setInterval + cleanup)
 *     by replicating the exact timer logic with fake timers.
 *   - The `reportConcurrencyMetrics` pure function is tested directly with
 *     mocked api + store getters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSendMetrics, mockGetCompanionSize, mockGetSwitchEpochSize } = vi.hoisted(() => ({
  mockSendMetrics: vi.fn(),
  mockGetCompanionSize: vi.fn().mockReturnValue(0),
  mockGetSwitchEpochSize: vi.fn().mockReturnValue(0),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    sendRendererConcurrencyMetrics: mockSendMetrics,
  },
}));

vi.mock('@/stores/wallpaperStore', () => ({
  getCompanionBusySize: mockGetCompanionSize,
}));

vi.mock('@/stores/environmentStore', () => ({
  getSwitchEpochSize: mockGetSwitchEpochSize,
}));

// Import AFTER mocks are in place
import { REPORT_INTERVAL_MS, reportConcurrencyMetrics } from './useConcurrencyReporter';

// ---------------------------------------------------------------------------
// Group A — reportConcurrencyMetrics (pure function, tested directly)
// ---------------------------------------------------------------------------

describe('reportConcurrencyMetrics — pure function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCompanionSize.mockReturnValue(0);
    mockGetSwitchEpochSize.mockReturnValue(0);
  });

  it('reads sizes from both stores and forwards them to api', () => {
    mockGetCompanionSize.mockReturnValue(2);
    mockGetSwitchEpochSize.mockReturnValue(1);

    reportConcurrencyMetrics();

    expect(mockSendMetrics).toHaveBeenCalledTimes(1);
    expect(mockSendMetrics).toHaveBeenCalledWith(2, 1);
  });

  it('forwards zeros when no guards are active', () => {
    mockGetCompanionSize.mockReturnValue(0);
    mockGetSwitchEpochSize.mockReturnValue(0);

    reportConcurrencyMetrics();

    expect(mockSendMetrics).toHaveBeenCalledWith(0, 0);
  });

  it('forwards the maximum observed values from a busy renderer', () => {
    mockGetCompanionSize.mockReturnValue(5);
    mockGetSwitchEpochSize.mockReturnValue(3);

    reportConcurrencyMetrics();

    expect(mockSendMetrics).toHaveBeenCalledWith(5, 3);
  });

  it('reads the CURRENT values on every call (re-reads, not cached)', () => {
    // First call: sizes are low
    mockGetCompanionSize.mockReturnValue(1);
    mockGetSwitchEpochSize.mockReturnValue(0);
    reportConcurrencyMetrics();
    expect(mockSendMetrics).toHaveBeenLastCalledWith(1, 0);

    // Second call: sizes changed. Must reflect new values.
    mockGetCompanionSize.mockReturnValue(4);
    mockGetSwitchEpochSize.mockReturnValue(2);
    reportConcurrencyMetrics();
    expect(mockSendMetrics).toHaveBeenLastCalledWith(4, 2);
  });
});

// ---------------------------------------------------------------------------
// Group B — Timer pattern (fake timers, matches the hook's exact logic)
//
// The hook body is:
//   useEffect(() => {
//     reportConcurrencyMetrics();
//     const id = window.setInterval(reportConcurrencyMetrics, REPORT_INTERVAL_MS);
//     return () => window.clearInterval(id);
//   }, []);
//
// We replicate this exact pattern with fake timers to prove:
//   B1: One immediate call fires on mount (cold-start).
//   B2: Periodic calls fire every REPORT_INTERVAL_MS.
//   B3: Reflects updated store sizes in subsequent ticks.
//   B4: clearInterval stops all future calls (unmount cleanup).
// ---------------------------------------------------------------------------

describe('useConcurrencyReporter — timer pattern (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockGetCompanionSize.mockReturnValue(0);
    mockGetSwitchEpochSize.mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('B1: fires one immediate call on mount (cold-start data)', () => {
    // Replicate the hook's effect body:
    void reportConcurrencyMetrics();
    const id = setInterval(reportConcurrencyMetrics, REPORT_INTERVAL_MS);

    // Interval hasn't fired yet → exactly 1 call from the immediate invocation
    expect(mockSendMetrics).toHaveBeenCalledTimes(1);
    expect(mockSendMetrics).toHaveBeenCalledWith(0, 0);

    clearInterval(id);
  });

  it('B2: fires again after each REPORT_INTERVAL_MS tick', () => {
    void reportConcurrencyMetrics();
    const id = setInterval(reportConcurrencyMetrics, REPORT_INTERVAL_MS);

    // Advance one interval → 2 calls total (mount + 1 tick)
    vi.advanceTimersByTime(REPORT_INTERVAL_MS);
    expect(mockSendMetrics).toHaveBeenCalledTimes(2);

    // Advance another interval → 3 calls total
    vi.advanceTimersByTime(REPORT_INTERVAL_MS);
    expect(mockSendMetrics).toHaveBeenCalledTimes(3);

    // Advance 3 ticks at once → 6 calls total
    vi.advanceTimersByTime(REPORT_INTERVAL_MS * 3);
    expect(mockSendMetrics).toHaveBeenCalledTimes(6);

    clearInterval(id);
  });

  it('B3: reflects updated store sizes in subsequent ticks', () => {
    let callCount = 0;
    mockGetCompanionSize.mockImplementation(() => (callCount++ < 1 ? 0 : 2));
    mockGetSwitchEpochSize.mockReturnValue(0);

    void reportConcurrencyMetrics(); // mount: reads 0 → sends (0,0)
    expect(mockSendMetrics).toHaveBeenLastCalledWith(0, 0);

    const id = setInterval(reportConcurrencyMetrics, REPORT_INTERVAL_MS);

    vi.advanceTimersByTime(REPORT_INTERVAL_MS); // first tick

    // After the interval tick, the mock reports the updated size
    expect(mockSendMetrics).toHaveBeenLastCalledWith(2, 0);

    clearInterval(id);
  });

  it('B4: clearInterval stops all future calls (unmount cleanup)', () => {
    void reportConcurrencyMetrics();
    const id = setInterval(reportConcurrencyMetrics, REPORT_INTERVAL_MS);

    // Advance 4 ticks → 5 calls total (mount + 4)
    vi.advanceTimersByTime(REPORT_INTERVAL_MS * 4);
    expect(mockSendMetrics).toHaveBeenCalledTimes(5);

    // Simulate unmount: cleanup runs clearInterval
    clearInterval(id);

    // Advance far past interval — NO more calls should fire
    vi.advanceTimersByTime(REPORT_INTERVAL_MS * 100);
    expect(mockSendMetrics).toHaveBeenCalledTimes(5);
  });
});
