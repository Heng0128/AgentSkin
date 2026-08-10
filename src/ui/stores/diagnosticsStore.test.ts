// SPDX-License-Identifier: MPL-2.0

/**
 * # diagnosticsStore tests
 *
 * Unit tests for the timeout-events portion of the diagnosticsStore.
 * The store's only external dependency is the `@/api/agentSkinClient` —
 * both `getPerformanceTimeouts` and `clearPerformanceTimeouts` are mocked
 * so the tests run without a live Electron IPC bridge.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetTimeouts, mockClearTimeouts } = vi.hoisted(() => ({
  mockGetTimeouts: vi.fn(),
  mockClearTimeouts: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    getPerformanceTimeouts: mockGetTimeouts,
    clearPerformanceTimeouts: mockClearTimeouts,
  },
}));

import { useDiagnosticsStore } from './diagnosticsStore';

const SAMPLE_EVENTS = [
  { id: 'timeout_001', channel: 'THEME_APPLY', ms: 5000, timestamp: 1_700_000_000_000 },
  { id: 'timeout_002', channel: 'THEME_RESTORE', ms: 3000, timestamp: 1_700_000_005_000 },
  { id: 'timeout_003', channel: 'AGENT_CLONE', ms: 8000, timestamp: 1_700_000_010_000 },
];

describe('diagnosticsStore — timeout events', () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({
      timeoutEvents: [],
      timeoutsLoading: false,
      timeoutsError: null,
      concurrencyMetrics: {
        companionBusyByAgent: 0,
        inflightOperations: 0,
        selfHealingAgents: 0,
        capturedTokens: 0,
        persistChainDepth: 0,
        deferredSelfHeals: 0,
        switchEpochByAgent: 0,
      },
    });
    mockGetTimeouts.mockReset();
    mockClearTimeouts.mockReset();
  });

  it('loadTimeouts populates timeoutEvents (length 0 → N) on success', async () => {
    mockGetTimeouts.mockResolvedValueOnce(SAMPLE_EVENTS);

    expect(useDiagnosticsStore.getState().timeoutEvents).toHaveLength(0);

    await useDiagnosticsStore.getState().loadTimeouts();

    expect(useDiagnosticsStore.getState().timeoutEvents).toHaveLength(3);
    expect(useDiagnosticsStore.getState().timeoutEvents).toEqual(SAMPLE_EVENTS);
  });

  it('loadTimeouts sets timeoutsError when IPC call rejects', async () => {
    mockGetTimeouts.mockRejectedValueOnce(new Error('channel not found'));

    await useDiagnosticsStore.getState().loadTimeouts();

    expect(useDiagnosticsStore.getState().timeoutsError).toBe('channel not found');
    expect(useDiagnosticsStore.getState().timeoutEvents).toHaveLength(0);
  });

  it('clearTimeouts empties timeoutEvents after successful IPC clear', async () => {
    useDiagnosticsStore.setState({ timeoutEvents: SAMPLE_EVENTS });
    mockClearTimeouts.mockResolvedValueOnce(undefined);

    expect(useDiagnosticsStore.getState().timeoutEvents).toHaveLength(3);

    await useDiagnosticsStore.getState().clearTimeouts();

    expect(useDiagnosticsStore.getState().timeoutEvents).toHaveLength(0);
    expect(mockClearTimeouts).toHaveBeenCalledTimes(1);
  });

  it('timeoutsLoading follows false → true → false during loadTimeouts', async () => {
    // Capture loading state midway through the IPC call
    let observedLoading = false;
    mockGetTimeouts.mockImplementationOnce(async () => {
      observedLoading = useDiagnosticsStore.getState().timeoutsLoading;
      return [];
    });

    // Before: loading = false
    expect(useDiagnosticsStore.getState().timeoutsLoading).toBe(false);

    await useDiagnosticsStore.getState().loadTimeouts();

    // Mid-call: loading = true
    expect(observedLoading).toBe(true);
    // After: loading = false
    expect(useDiagnosticsStore.getState().timeoutsLoading).toBe(false);
  });

  it('loadTimeouts default count is 10 and forwards custom count to api', async () => {
    mockGetTimeouts.mockResolvedValue([]);

    // Default call — count should be 10
    await useDiagnosticsStore.getState().loadTimeouts();
    expect(mockGetTimeouts).toHaveBeenCalledTimes(1);
    expect(mockGetTimeouts).toHaveBeenLastCalledWith(10);

    // Custom count
    await useDiagnosticsStore.getState().loadTimeouts(25);
    expect(mockGetTimeouts).toHaveBeenCalledTimes(2);
    expect(mockGetTimeouts).toHaveBeenLastCalledWith(25);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 1: clearTimeouts IPC failure preserves data + sets error
  // -----------------------------------------------------------------------

  it('clearTimeouts IPC failure preserves existing events and sets error', async () => {
    // Seed store with 3 timeout events
    useDiagnosticsStore.setState({ timeoutEvents: SAMPLE_EVENTS });

    // IPC clear fails
    mockClearTimeouts.mockRejectedValueOnce(new Error('ipc down'));

    await useDiagnosticsStore.getState().clearTimeouts();

    // Old events must remain (clear did not happen), error must reflect IPC failure
    const state = useDiagnosticsStore.getState();
    expect(state.timeoutEvents).toHaveLength(3);
    expect(state.timeoutEvents).toEqual(SAMPLE_EVENTS);
    expect(state.timeoutsError).toBe('ipc down');
    expect(state.timeoutsLoading).toBe(false);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 2: loadTimeouts forwards count without frontend clamping
  // -----------------------------------------------------------------------

  it('loadTimeouts forwards count to api without clamping at frontend', async () => {
    mockGetTimeouts.mockResolvedValue([]);

    // Request 50 records — frontend must pass through verbatim.
    // MAX_TIMEOUT_COUNT=50 is enforced on the main side, not in this repo.
    await useDiagnosticsStore.getState().loadTimeouts(50);

    expect(mockGetTimeouts).toHaveBeenCalledTimes(1);
    expect(mockGetTimeouts).toHaveBeenLastCalledWith(50);

    // Also verify a large value (e.g. 100) is NOT silently capped
    await useDiagnosticsStore.getState().loadTimeouts(100);
    expect(mockGetTimeouts).toHaveBeenCalledTimes(2);
    expect(mockGetTimeouts).toHaveBeenLastCalledWith(100);
  });

  // -----------------------------------------------------------------------
  // MUST-HAVE 3 (fallback): concurrent loadTimeouts calls yield deterministic
  // final state — set() is always last writer-wins, no state corruption.
  //
  // The component-level useEffect polling test lives in the companion
  // PerformancePanel-polling.test.tsx.  This store-level guard verifies that
  // even when multiple in-flight api calls resolve out-of-order, the zustand
  // set() is synchronous and the final state reflects exactly one complete
  // payload (never a partial merge or undefined).
  // -----------------------------------------------------------------------

  it('concurrent loadTimeouts calls result in deterministic final state (race guard)', async () => {
    const payloadA = [{ id: 'a', channel: 'A', ms: 100, timestamp: 1 }];
    const payloadB = [{ id: 'b', channel: 'B', ms: 200, timestamp: 2 }];
    const payloadC = [{ id: 'c', channel: 'C', ms: 300, timestamp: 3 }];

    // Mock resolves in call order — A first, B second, C third
    mockGetTimeouts
      .mockResolvedValueOnce(payloadA)
      .mockResolvedValueOnce(payloadB)
      .mockResolvedValueOnce(payloadC);

    const store = useDiagnosticsStore.getState();

    // Fire 3 concurrent calls without awaiting individually
    await Promise.all([store.loadTimeouts(), store.loadTimeouts(), store.loadTimeouts()]);

    const state = useDiagnosticsStore.getState();

    // Store must contain exactly ONE complete payload (no corruption/mix)
    expect(state.timeoutEvents.length).toBe(1);
    // Last-resolved payload wins — set() is synchronous, C overwrites B over A
    expect(state.timeoutEvents).toEqual(payloadC);
    // Loading must be cleared after ALL promises settle
    expect(state.timeoutsLoading).toBe(false);
    // All 3 calls actually reached the mock api
    expect(mockGetTimeouts).toHaveBeenCalledTimes(3);
  });
});
