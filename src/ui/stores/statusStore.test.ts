// SPDX-License-Identifier: MPL-2.0

/**
 * # statusStore tests — error state + clearError
 *
 * Verifies that the status-refresh lifecycle captures and exposes failures
 * correctly:
 * - `error` starts as null.
 * - `refreshStatus` populates `error` on failure.
 * - `refreshStatus` clears `error` on success.
 * - `clearError()` resets `error` to null.
 * - A failed-then-succeeded sequence ends with `error === null`.
 *
 * The `@/api/agentSkinClient` module is mocked so tests run without
 * Electron IPC connectivity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Type for coordinator status callback
// ---------------------------------------------------------------------------
type CoordinatorCallback = (payload: {
  appId: string;
  state: { running: boolean; port: number; debugReady: boolean };
}) => void;

// ---------------------------------------------------------------------------
// Hoisted mocks + callback ref (same hoisted scope — no TDZ issue)
// ---------------------------------------------------------------------------

const {
  mockRefreshStatus,
  mockOnCoordinatorStatus,
  mockGetCoordinatorSnapshot,
  coordinatorCallbackRef,
} = vi.hoisted(() => {
  const ref = { current: undefined as CoordinatorCallback | undefined };
  return {
    mockRefreshStatus: vi.fn(),
    mockOnCoordinatorStatus: vi.fn(((cb: CoordinatorCallback) => {
      ref.current = cb;
    }) as (cb: CoordinatorCallback) => void),
    mockGetCoordinatorSnapshot: vi.fn(),
    coordinatorCallbackRef: ref,
  };
});

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    refreshStatus: mockRefreshStatus,
    onCoordinatorStatus: mockOnCoordinatorStatus,
    getCoordinatorSnapshot: mockGetCoordinatorSnapshot,
  },
}));

// Import AFTER all mocks are in place
import { useStatusStore } from './statusStore';
import { resetStatusStore } from './test-helpers/reset-status-store';

const SAMPLE_STATUS = {
  platform: 'win32' as const,
  apps: [
    {
      appId: 'traework' as const,
      displayName: 'Trae',
      installed: true,
      running: true,
      debugReady: true,
      port: 9_222,
      activeThemeId: null,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('statusStore — error state & clearError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStatusStore();
  });

  // -- initial state -------------------------------------------------------

  it('initializes error as null', () => {
    expect(useStatusStore.getState().error).toBeNull();
  });

  // -- refreshStatus failure ------------------------------------------------

  it('sets error when refreshStatus fails', async () => {
    const error = new Error('ipc:refreshStatus timeout');
    mockRefreshStatus.mockRejectedValueOnce(error);

    await useStatusStore.getState().refreshStatus();

    expect(useStatusStore.getState().error).toBe('ipc:refreshStatus timeout');
    expect(useStatusStore.getState().status).toBeNull();
    expect(useStatusStore.getState().isRefreshing).toBe(false);
  });

  it('captures Error message correctly when Error instance is thrown', async () => {
    mockRefreshStatus.mockRejectedValueOnce(new Error('network failure'));

    await useStatusStore.getState().refreshStatus();

    expect(useStatusStore.getState().error).toBe('network failure');
  });

  it('stringifies non-Error thrown values into error message', async () => {
    mockRefreshStatus.mockRejectedValueOnce('raw string error');

    await useStatusStore.getState().refreshStatus();

    expect(useStatusStore.getState().error).toBe('raw string error');
  });

  // -- refreshStatus success ------------------------------------------------

  it('clears error when refreshStatus succeeds', async () => {
    mockRefreshStatus.mockResolvedValueOnce(SAMPLE_STATUS);
    mockGetCoordinatorSnapshot.mockResolvedValueOnce(new Map());

    await useStatusStore.getState().refreshStatus();

    expect(useStatusStore.getState().error).toBeNull();
    expect(useStatusStore.getState().status).toEqual(SAMPLE_STATUS);
    expect(useStatusStore.getState().lastStatusAt).not.toBeNull();
    expect(useStatusStore.getState().isRefreshing).toBe(false);
  });

  // -- clearError ----------------------------------------------------------

  it('clearError() resets a previously set error to null', async () => {
    // First, establish an error state via failed refresh.
    mockRefreshStatus.mockRejectedValueOnce(new Error('boom'));
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().error).not.toBeNull();

    // Now invoke clearError directly.
    useStatusStore.getState().clearError();

    expect(useStatusStore.getState().error).toBeNull();
  });

  it('clearError() is a no-op when error is already null', () => {
    expect(useStatusStore.getState().error).toBeNull();

    useStatusStore.getState().clearError();

    expect(useStatusStore.getState().error).toBeNull();
  });

  // -- failure then recovery sequence --------------------------------------

  it('recovers error to null after consecutive failures then a success', async () => {
    // Fail #1
    mockRefreshStatus.mockRejectedValueOnce(new Error('first failure'));
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().error).toBe('first failure');

    // Fail #2
    mockRefreshStatus.mockRejectedValueOnce(new Error('second failure'));
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().error).toBe('second failure');

    // Success
    mockRefreshStatus.mockResolvedValueOnce(SAMPLE_STATUS);
    mockGetCoordinatorSnapshot.mockResolvedValueOnce(new Map());
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().error).toBeNull();
    expect(useStatusStore.getState().status).toEqual(SAMPLE_STATUS);
  });

  // -- refreshStatus clears error on next attempt --------------------------

  it('next refreshStatus attempt clears the previous error before attempting', async () => {
    // Establish prior error.
    mockRefreshStatus.mockRejectedValueOnce(new Error('prior'));
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().error).toBe('prior');

    // Next attempt: success — error should end null.
    mockRefreshStatus.mockResolvedValueOnce(SAMPLE_STATUS);
    mockGetCoordinatorSnapshot.mockResolvedValueOnce(new Map());
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().error).toBeNull();
  });

  // -- isRefreshing lifecycle ----------------------------------------------

  it('isRefreshing is false after a rejected refresh settles', async () => {
    mockRefreshStatus.mockRejectedValueOnce(new Error('failed'));
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().isRefreshing).toBe(false);
  });

  it('isRefreshing is false after a successful refresh settles', async () => {
    mockRefreshStatus.mockResolvedValueOnce(SAMPLE_STATUS);
    mockGetCoordinatorSnapshot.mockResolvedValueOnce(new Map());
    await useStatusStore.getState().refreshStatus();
    expect(useStatusStore.getState().isRefreshing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RC5-A fix: onCoordinatorStatus subscription tests
// These verify the coordinator push subscription callback behavior, including
// the shallow-compare short-circuit that prevents no-op state updates.
// ---------------------------------------------------------------------------

describe('statusStore — onCoordinatorStatus subscription', () => {
  beforeEach(() => {
    // Note: NOT calling vi.clearAllMocks() here — it would clear the captured
    // coordinator callback registered at store creation time.
    mockRefreshStatus.mockReset();
    mockGetCoordinatorSnapshot.mockReset();
    resetStatusStore();
  });

  /** Get the coordinator status callback captured at store creation. */
  const getCoordinatorCallback = (): CoordinatorCallback => {
    const call = coordinatorCallbackRef.current;
    expect(call).toBeDefined();
    return call as CoordinatorCallback;
  };

  it('captured a coordinator status callback at store creation', () => {
    const callback = getCoordinatorCallback();
    expect(typeof callback).toBe('function');
  });

  it('updates status when coordinator pushes a runtime change', () => {
    // Seed current status
    useStatusStore.setState({
      status: {
        platform: 'win32' as const,
        apps: [
          {
            appId: 'traework' as const,
            displayName: 'Trae',
            installed: true,
            running: false,
            debugReady: false,
            port: 0,
            activeThemeId: null,
          },
        ],
      },
    });

    const callback = getCoordinatorCallback();
    callback({ appId: 'traework', state: { running: true, port: 9222, debugReady: true } });

    const status = useStatusStore.getState().status;
    expect(status?.apps[0].running).toBe(true);
    expect(status?.apps[0].port).toBe(9222);
    expect(status?.apps[0].debugReady).toBe(true);
    expect(useStatusStore.getState().lastStatusAt).not.toBeNull();
  });

  it('skips state update when coordinator pushes identical data (shallow-compare guard)', () => {
    // Seed current status with already-running state
    useStatusStore.setState({
      status: {
        platform: 'win32' as const,
        apps: [
          {
            appId: 'traework' as const,
            displayName: 'Trae',
            installed: true,
            running: true,
            debugReady: true,
            port: 9222,
            activeThemeId: null,
          },
        ],
      },
      lastStatusAt: 1000,
    });

    const callback = getCoordinatorCallback();
    // Push identical state — should be a no-op
    callback({ appId: 'traework', state: { running: true, port: 9222, debugReady: true } });

    // lastStatusAt should remain unchanged, confirming the short-circuit worked
    expect(useStatusStore.getState().lastStatusAt).toBe(1000);
  });

  it('ignores coordinator pushes when no status is loaded yet', () => {
    // status is null initially
    expect(useStatusStore.getState().status).toBeNull();

    const callback = getCoordinatorCallback();
    // Should not throw and should not modify state
    callback({ appId: 'traework', state: { running: true, port: 9222, debugReady: true } });

    expect(useStatusStore.getState().status).toBeNull();
  });
});
