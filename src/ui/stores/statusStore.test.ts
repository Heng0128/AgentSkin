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
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRefreshStatus, mockOnCoordinatorStatus, mockGetCoordinatorSnapshot } = vi.hoisted(
  () => ({
    mockRefreshStatus: vi.fn(),
    mockOnCoordinatorStatus: vi.fn(),
    mockGetCoordinatorSnapshot: vi.fn(),
  }),
);

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
