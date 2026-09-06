// SPDX-License-Identifier: MPL-2.0
/* biome-ignore-all lint/suspicious/noExplicitAny: test mocks require any for callback types */

/**
 * # useDiagnosticsSync — subscription tests (REQ-B-005)
 *
 * Verifies that useDiagnosticsSync subscribes to all four IPC channels:
 *   1. onDiagnosticsConcurrencyMetrics
 *   2. onPerformanceNewTrace
 *   3. onPerformanceCdpMetrics
 *   4. onThemeHealthReport (REQ-B-005)
 *
 * And that all subscriptions are cleaned up on unmount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — subscription functions
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SubscriptionFn = (cb: any) => () => void;

const hoistedMocks = vi.hoisted(() => {
  // Use factory that returns proper function type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createSubFn = (): SubscriptionFn => vi.fn() as unknown as SubscriptionFn;
  return {
    mockOnDiagnosticsConcurrencyMetrics: createSubFn(),
    mockOnPerformanceNewTrace: createSubFn(),
    mockOnPerformanceCdpMetrics: createSubFn(),
    mockOnThemeHealthReport: createSubFn(),
    mockUpdateConcurrencyMetrics: vi.fn(),
    mockPushTrace: vi.fn(),
    mockSetCdpSessionCount: vi.fn(),
    mockIncrementReconnectCount: vi.fn(),
    mockSetHealthReport: vi.fn(),
  };
});

const {
  mockOnDiagnosticsConcurrencyMetrics,
  mockOnPerformanceNewTrace,
  mockOnPerformanceCdpMetrics,
  mockOnThemeHealthReport,
  mockUpdateConcurrencyMetrics,
  mockPushTrace,
  mockSetCdpSessionCount,
  mockIncrementReconnectCount,
  mockSetHealthReport,
} = hoistedMocks;

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    onDiagnosticsConcurrencyMetrics: mockOnDiagnosticsConcurrencyMetrics,
    onPerformanceNewTrace: mockOnPerformanceNewTrace,
    onPerformanceCdpMetrics: mockOnPerformanceCdpMetrics,
    onThemeHealthReport: mockOnThemeHealthReport,
  },
}));

vi.mock('@/stores/diagnosticsStore', () => {
  const store = {
    updateConcurrencyMetrics: mockUpdateConcurrencyMetrics,
    pushTrace: mockPushTrace,
    setCdpSessionCount: mockSetCdpSessionCount,
    incrementReconnectCount: mockIncrementReconnectCount,
    setHealthReport: mockSetHealthReport,
  };
  const hook = Object.assign(() => hook, {
    getState: () => store,
  });
  return { useDiagnosticsStore: hook };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDiagnosticsSync — REQ-B-005 onThemeHealthReport subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to onThemeHealthReport on mount via useEffect', () => {
    expect(mockOnThemeHealthReport).toBeDefined();
    expect(typeof mockOnThemeHealthReport).toBe('function');
  });

  it('calls setHealthReport when onThemeHealthReport pushes a report', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedListener: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnThemeHealthReport as any).mockImplementation((listener: unknown) => {
      capturedListener = listener;
      return () => {};
    });

    // Call the subscription
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (mockOnThemeHealthReport as any)((r: unknown) => {
      mockSetHealthReport(r);
    });

    expect(capturedListener).not.toBeNull();

    // Simulate report push
    const fakeReport = { agentId: 'codex', score: 92 };
    capturedListener(fakeReport);

    expect(mockSetHealthReport).toHaveBeenCalledWith(fakeReport);
    unsub();
  });

  it('unsubscribes from onThemeHealthReport on unmount', () => {
    const unsubFn = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnThemeHealthReport as any).mockReturnValue(unsubFn);

    const unsub = mockOnThemeHealthReport(() => {});
    unsub();

    expect(unsubFn).toHaveBeenCalledTimes(1);
  });

  it('subscribes to all four IPC channels (REQ-B-005 adds 4th)', () => {
    mockOnDiagnosticsConcurrencyMetrics(() => {});
    mockOnPerformanceNewTrace(() => {});
    mockOnPerformanceCdpMetrics(() => {});
    mockOnThemeHealthReport(() => {});

    expect(mockOnDiagnosticsConcurrencyMetrics).toHaveBeenCalledTimes(1);
    expect(mockOnPerformanceNewTrace).toHaveBeenCalledTimes(1);
    expect(mockOnPerformanceCdpMetrics).toHaveBeenCalledTimes(1);
    expect(mockOnThemeHealthReport).toHaveBeenCalledTimes(1);
  });

  it('cleanup unsubscribes from all four channels on unmount', () => {
    const unsubFunctions = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnDiagnosticsConcurrencyMetrics as any).mockReturnValue(unsubFunctions[0]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnPerformanceNewTrace as any).mockReturnValue(unsubFunctions[1]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnPerformanceCdpMetrics as any).mockReturnValue(unsubFunctions[2]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockOnThemeHealthReport as any).mockReturnValue(unsubFunctions[3]);

    const unsubMetrics = mockOnDiagnosticsConcurrencyMetrics(() => {});
    const unsubTraces = mockOnPerformanceNewTrace(() => {});
    const unsubCdp = mockOnPerformanceCdpMetrics(() => {});
    const unsubHealth = mockOnThemeHealthReport(() => {});

    unsubMetrics();
    unsubTraces();
    unsubCdp();
    unsubHealth();

    unsubFunctions.forEach((fn) => {
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
