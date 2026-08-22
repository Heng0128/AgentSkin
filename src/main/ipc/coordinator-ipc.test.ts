// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

type HandlerFn = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, HandlerFn>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: HandlerFn) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  },
}));

/**
 * The coordinator's `onStatusChange` stores the listener so tests can fire
 * status-change events on demand, mimicking the real coordinator emitting.
 */
let storedListener: ((event: { appId: string; state: AppRunStateMock }) => void) | null = null;
const mockUnsub = vi.fn(() => {
  storedListener = null;
});

interface AppRunStateMock {
  running: boolean;
  pid: number;
  port: number | null;
  debugReady: boolean;
  updatedAt: number;
}

const mockGetSnapshot = vi.fn();
const mockGetState = vi.fn();

/**
 * Stable singleton mock — the real `getAppRunStateCoordinator` returns the same
 * instance on every call, so the mock must do the same. Creating a fresh object
 * per call would make assertions target a mock that was never invoked.
 */
const mockCoordinator = {
  onStatusChange: vi.fn((cb: (event: { appId: string; state: AppRunStateMock }) => void) => {
    storedListener = cb;
    return mockUnsub;
  }),
  getSnapshot: mockGetSnapshot,
  getState: mockGetState,
};

vi.mock('../services/app-run-state-coordinator', () => ({
  getAppRunStateCoordinator: vi.fn(() => mockCoordinator),
}));

vi.mock('./trusted-sender', () => ({
  assertTrustedSender: vi.fn(),
}));

vi.mock('./with-monitored-timeout', () => ({
  withMonitoredTimeout: vi.fn(
    (_channel: string, _ms: number, promise: Promise<unknown>) => promise,
  ),
}));

const { registerCoordinatorIpc, disposeCoordinatorIpc, configureCoordinatorIpc } = await import(
  './coordinator-ipc'
);

const { assertTrustedSender } = await import('./trusted-sender');
const { withMonitoredTimeout } = await import('./with-monitored-timeout');
const { getAppRunStateCoordinator } = await import('../services/app-run-state-coordinator');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleState: AppRunStateMock = {
  running: true,
  pid: 12345,
  port: 9222,
  debugReady: true,
  updatedAt: 1_700_000_000_000,
};

const mockSnapshotMap = new Map<string, AppRunStateMock>([['trae', sampleState]]);

const trustedEvent = { sender: { id: 1 }, senderFrame: { parent: null } };

/**
 * Creates a minimal BrowserWindow double with a spyable `webContents.send`
 * and `isDestroyed` methods.
 */
function createMockBrowserWindow(overrides: { destroyed?: boolean } = {}) {
  const send = vi.fn();
  return {
    webContents: { send },
    isDestroyed: vi.fn(() => overrides.destroyed ?? false),
  } as unknown as Parameters<typeof registerCoordinatorIpc>[0] & {
    webContents: { send: ReturnType<typeof vi.fn> };
    isDestroyed: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('coordinator-ipc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    storedListener = null;
    mockGetSnapshot.mockReset().mockReturnValue(mockSnapshotMap);
    mockGetState.mockReset();
    /**
     * Reset module-level state between tests. `disposeCoordinatorIpc` clears
     * the subscription and removes handlers so the next `registerCoordinatorIpc`
     * bypasses its early-return guard. `configureCoordinatorIpc(null)` resets
     * the window reference.
     *
     * `mockUnsub.mockReset()` runs AFTER disposal so that the unsubscribe-call
     * tally reflects only calls from the current test, not cleanup.
     */
    disposeCoordinatorIpc();
    configureCoordinatorIpc(null);
    // Re-establish mockUnsub's side-effect (cleared by mockReset) AFTER disposal.
    mockUnsub.mockReset();
    mockUnsub.mockImplementation(() => {
      storedListener = null;
    });
  });

  // -----------------------------------------------------------------------
  // 1. registerCoordinatorIpc() registration
  // -----------------------------------------------------------------------
  describe('registerCoordinatorIpc()', () => {
    it('registers the COORDINATOR_SNAPSHOT handler', () => {
      registerCoordinatorIpc();
      expect(handlers.has(IpcChannel.COORDINATOR_SNAPSHOT)).toBe(true);
    });

    it('registers the COORDINATOR_QUERY handler', () => {
      registerCoordinatorIpc();
      expect(handlers.has(IpcChannel.COORDINATOR_QUERY)).toBe(true);
    });

    it('subscribes to onStatusChange exactly once', () => {
      registerCoordinatorIpc();
      expect(getAppRunStateCoordinator().onStatusChange).toHaveBeenCalledOnce();
    });

    it('prevents double subscription on second call (guard)', () => {
      registerCoordinatorIpc();
      registerCoordinatorIpc();
      // `onStatusChange` must be called only once — the early-return guard blocks the second registration.
      expect(getAppRunStateCoordinator().onStatusChange).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // 2. COORDINATOR_SNAPSHOT handler
  // -----------------------------------------------------------------------
  describe('COORDINATOR_SNAPSHOT handler', () => {
    it('returns the coordinator snapshot', async () => {
      registerCoordinatorIpc();
      mockGetSnapshot.mockReturnValue(mockSnapshotMap);

      const handler = handlers.get(IpcChannel.COORDINATOR_SNAPSHOT)!;
      const result = await handler(trustedEvent);

      expect(mockGetSnapshot).toHaveBeenCalledOnce();
      expect(result).toBe(mockSnapshotMap);
    });

    it('wraps the snapshot call with withMonitoredTimeout', async () => {
      registerCoordinatorIpc();
      mockGetSnapshot.mockReturnValue(mockSnapshotMap);

      const handler = handlers.get(IpcChannel.COORDINATOR_SNAPSHOT)!;
      await handler(trustedEvent);

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.COORDINATOR_SNAPSHOT,
        5_000,
        expect.any(Promise),
      );
    });

    it('calls assertTrustedSender before processing', async () => {
      registerCoordinatorIpc();
      mockGetSnapshot.mockReturnValue(mockSnapshotMap);

      const handler = handlers.get(IpcChannel.COORDINATOR_SNAPSHOT)!;
      await handler(trustedEvent);

      expect(assertTrustedSender).toHaveBeenCalledWith(trustedEvent);
    });
  });

  // -----------------------------------------------------------------------
  // 3. COORDINATOR_QUERY handler
  // -----------------------------------------------------------------------
  describe('COORDINATOR_QUERY handler', () => {
    it('returns the state for a single app', async () => {
      registerCoordinatorIpc();
      mockGetState.mockReturnValueOnce(sampleState);

      const handler = handlers.get(IpcChannel.COORDINATOR_QUERY)!;
      const result = await handler(trustedEvent, 'trae');

      expect(mockGetState).toHaveBeenCalledWith('trae');
      expect(result).toEqual(sampleState);
    });

    it('returns null for an unknown appId', async () => {
      registerCoordinatorIpc();
      mockGetState.mockReturnValueOnce(null);

      const handler = handlers.get(IpcChannel.COORDINATOR_QUERY)!;
      const result = await handler(trustedEvent, 'nonexistent');

      expect(mockGetState).toHaveBeenCalledWith('nonexistent');
      expect(result).toBeNull();
    });

    it('wraps the query call with withMonitoredTimeout', async () => {
      registerCoordinatorIpc();
      mockGetState.mockReturnValueOnce(sampleState);

      const handler = handlers.get(IpcChannel.COORDINATOR_QUERY)!;
      await handler(trustedEvent, 'trae');

      expect(withMonitoredTimeout).toHaveBeenCalledWith(
        IpcChannel.COORDINATOR_QUERY,
        5_000,
        expect.any(Promise),
      );
    });

    it('calls assertTrustedSender before processing', async () => {
      registerCoordinatorIpc();
      mockGetState.mockReturnValueOnce(sampleState);

      const handler = handlers.get(IpcChannel.COORDINATOR_QUERY)!;
      await handler(trustedEvent, 'trae');

      expect(assertTrustedSender).toHaveBeenCalledWith(trustedEvent);
    });
  });

  // -----------------------------------------------------------------------
  // 4. pushCoordinatorStatus() — tested via onStatusChange subscription
  // -----------------------------------------------------------------------
  describe('status push (via onStatusChange subscription)', () => {
    it('pushes status to the renderer when the main window exists', () => {
      const win = createMockBrowserWindow();
      registerCoordinatorIpc(win);

      // Simulate the coordinator emitting a status change.
      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win.webContents.send).toHaveBeenCalledWith(IpcChannel.COORDINATOR_STATUS, {
        appId: 'trae',
        state: sampleState,
      });
    });

    it('silently no-ops when the main window is destroyed', () => {
      const win = createMockBrowserWindow({ destroyed: true });
      registerCoordinatorIpc(win);

      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('silently no-ops when the main window is null', () => {
      // No window injected — pushCoordinatorStatus must not throw.
      registerCoordinatorIpc(null);

      expect(() => {
        storedListener?.({ appId: 'trae', state: sampleState });
      }).not.toThrow();
    });

    it('pushes exactly once per status change (no duplicate push)', () => {
      const win = createMockBrowserWindow();
      registerCoordinatorIpc(win);
      // A second call should be a no-op (early-return guard).
      registerCoordinatorIpc(win);

      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win.webContents.send).toHaveBeenCalledOnce();
    });

    it('pushes subsequent status changes after re-subscription flows through configureCoordinatorIpc', () => {
      const win = createMockBrowserWindow();
      // `configureCoordinatorIpc` alone does NOT register; only sets mainWindow.
      configureCoordinatorIpc(win);
      registerCoordinatorIpc();

      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win.webContents.send).toHaveBeenCalledWith(IpcChannel.COORDINATOR_STATUS, {
        appId: 'trae',
        state: sampleState,
      });
    });
  });

  // -----------------------------------------------------------------------
  // 5. disposeCoordinatorIpc() cleanup
  // -----------------------------------------------------------------------
  describe('disposeCoordinatorIpc()', () => {
    it('invokes the onStatusChange unsubscribe function', () => {
      registerCoordinatorIpc();
      disposeCoordinatorIpc();
      expect(mockUnsub).toHaveBeenCalledOnce();
    });

    it('removes the COORDINATOR_SNAPSHOT handler', () => {
      registerCoordinatorIpc();
      disposeCoordinatorIpc();
      expect(handlers.has(IpcChannel.COORDINATOR_SNAPSHOT)).toBe(false);
    });

    it('removes the COORDINATOR_QUERY handler', () => {
      registerCoordinatorIpc();
      disposeCoordinatorIpc();
      expect(handlers.has(IpcChannel.COORDINATOR_QUERY)).toBe(false);
    });

    it('does not push after disposal', () => {
      const win = createMockBrowserWindow();
      registerCoordinatorIpc(win);
      disposeCoordinatorIpc();

      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('allows re-registration after disposal (guard cleared)', () => {
      registerCoordinatorIpc();
      disposeCoordinatorIpc();
      vi.clearAllMocks();
      handlers.clear();

      registerCoordinatorIpc();

      // Should have registered again (handlers exist).
      expect(handlers.has(IpcChannel.COORDINATOR_SNAPSHOT)).toBe(true);
      expect(handlers.has(IpcChannel.COORDINATOR_QUERY)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 6. configureCoordinatorIpc() configuration
  // -----------------------------------------------------------------------
  describe('configureCoordinatorIpc()', () => {
    it('sets the main window reference for status push', () => {
      const win = createMockBrowserWindow();
      configureCoordinatorIpc(win);
      registerCoordinatorIpc();

      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win.webContents.send).toHaveBeenCalledWith(IpcChannel.COORDINATOR_STATUS, {
        appId: 'trae',
        state: sampleState,
      });
    });

    it('accepts null to clear the window reference', () => {
      const win = createMockBrowserWindow();
      configureCoordinatorIpc(win);
      registerCoordinatorIpc();
      configureCoordinatorIpc(null);

      storedListener?.({ appId: 'trae', state: sampleState });

      // After null-ing the window, push should no-op.
      expect(win.webContents.send).not.toHaveBeenCalled();
    });

    it('overwrites a previous window reference when called again', () => {
      const win1 = createMockBrowserWindow();
      const win2 = createMockBrowserWindow();
      configureCoordinatorIpc(win1);
      registerCoordinatorIpc();
      configureCoordinatorIpc(win2);

      storedListener?.({ appId: 'trae', state: sampleState });

      expect(win1.webContents.send).not.toHaveBeenCalled();
      expect(win2.webContents.send).toHaveBeenCalledWith(IpcChannel.COORDINATOR_STATUS, {
        appId: 'trae',
        state: sampleState,
      });
    });
  });
});
