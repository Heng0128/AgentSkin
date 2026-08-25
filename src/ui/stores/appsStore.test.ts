// SPDX-License-Identifier: MPL-2.0

/**
 * # appsStore — unit tests
 *
 * Covers the core paths of the application-launcher store:
 * - Module-level side-effects (getCoordinatorSnapshot hydration, status subscription)
 * - scan(): normal flow, concurrent-scan guard, error handling, scanning flag
 * - launch(): double-launch guard, needs-restart dialog, failure notification, IPC error
 * - addCustomApp(): dedupe, whitelist registration, custom-app merge
 * - refreshStatus(): sync from coordinator snapshot
 * - toggleHidden(): hidden-apps toggle
 * - forceRestartLaunch(): resolve from scanResult and re-launch
 *
 * Mocks follow the vi.hoisted pattern from the project's existing tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockScanElectronApps,
  mockLaunchElectronApp,
  mockOnElectronScanProgress,
  mockRegisterCustomExe,
  mockOnCoordinatorStatus,
  mockGetCoordinatorSnapshot,
  mockApplyScanEvent,
  mockDedupeByProductName,
  mockSha256Hex16,
  mockSetLaunchRestartPrompt,
  mockNotificationFail,
} = vi.hoisted(() => ({
  // Default implementations active at module-import time so the store's
  // module-level side effects (getCoordinatorSnapshot + onCoordinatorStatus)
  // don't crash with "Cannot read properties of undefined (reading 'then')".
  mockScanElectronApps: vi.fn(),
  mockLaunchElectronApp: vi.fn(),
  mockOnElectronScanProgress: vi.fn().mockReturnValue(vi.fn()),
  mockRegisterCustomExe: vi.fn().mockResolvedValue(true),
  mockOnCoordinatorStatus: vi.fn().mockReturnValue(vi.fn()),
  mockGetCoordinatorSnapshot: vi.fn().mockResolvedValue(new Map()),
  mockApplyScanEvent: vi.fn(),
  mockDedupeByProductName: vi.fn(),
  mockSha256Hex16: vi.fn(),
  mockSetLaunchRestartPrompt: vi.fn(),
  mockNotificationFail: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    scanElectronApps: mockScanElectronApps,
    launchElectronApp: mockLaunchElectronApp,
    onElectronScanProgress: mockOnElectronScanProgress,
    registerCustomExe: mockRegisterCustomExe,
    onCoordinatorStatus: mockOnCoordinatorStatus,
    getCoordinatorSnapshot: mockGetCoordinatorSnapshot,
  },
}));

vi.mock('@/lib/app-dedupe', () => ({
  applyScanEvent: mockApplyScanEvent,
  dedupeByProductName: mockDedupeByProductName,
}));

vi.mock('@/lib/hash', () => ({
  sha256Hex16: mockSha256Hex16,
}));

vi.mock('@/stores/dialogStore', () => ({
  useDialogStore: {
    getState: vi.fn(() => ({
      setLaunchRestartPrompt: mockSetLaunchRestartPrompt,
    })),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      fail: mockNotificationFail,
    })),
  },
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: vi.fn(() => ({
      settings: null,
    })),
  },
}));

// Import AFTER all mocks are in place
import type { AppRunState, ScannedApp } from '@shared/types';
import { useAppsStore } from './appsStore';
import { resetAppsStore } from './test-helpers/store-test-utils';

// ---------------------------------------------------------------------------
// Capture module-load state BEFORE any beforeEach clears mock call history
// ---------------------------------------------------------------------------

const getCoordinatorSnapshotCalledAtImport = mockGetCoordinatorSnapshot.mock.calls.length > 0;
const onCoordinatorStatusCalledAtImport = mockOnCoordinatorStatus.mock.calls.length > 0;
const onCoordinatorStatusCallbackAtImport = mockOnCoordinatorStatus.mock.calls[0]?.[0] as
  | ((event: { appId: string; state: AppRunState }) => void)
  | undefined;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_APP: ScannedApp = {
  id: 'abc123def4567890',
  exePath: 'C:\\Apps\\MyApp\\myapp.exe',
  productName: 'MyApp',
  companyName: 'TestCorp',
  adapterMatch: null,
  source: 'filesystem',
};

const MOCK_ADAPTED_APP: ScannedApp = {
  id: 'traework-hash12345',
  exePath: 'C:\\Apps\\TRAE\\trae.exe',
  productName: 'TRAE Work',
  companyName: 'ByteDance',
  adapterMatch: 'traework',
  source: 'agent',
};

const MOCK_SCAN_RESULT = {
  adapted: [MOCK_ADAPTED_APP],
  other: [MOCK_APP],
};

const MOCK_RUN_STATE: AppRunState = {
  running: true,
  pid: 12345,
  port: 9222,
  debugReady: true,
  updatedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('appsStore', () => {
  // -- setup & teardown ----------------------------------------------------

  beforeEach(() => {
    vi.clearAllMocks();
    resetAppsStore();

    // Default mock implementations
    mockGetCoordinatorSnapshot.mockResolvedValue(new Map());
    mockOnCoordinatorStatus.mockReturnValue(vi.fn());
    mockOnElectronScanProgress.mockReturnValue(vi.fn());
    mockDedupeByProductName.mockImplementation((apps: ScannedApp[]) => apps);
    mockApplyScanEvent.mockImplementation(
      (prev: unknown, event: { op: string; app?: ScannedApp }) => {
        // Simple mock implementation that mimics real applyScanEvent for add/update
        const base = (prev as { adapted: ScannedApp[]; other: ScannedApp[] }) ?? {
          adapted: [],
          other: [],
        };
        if (event.op === 'icon') return base;
        if (!event.app) return base;
        const bucket: 'adapted' | 'other' = event.app.adapterMatch ? 'adapted' : 'other';
        if (event.op === 'update') {
          return {
            ...base,
            [bucket]: base[bucket].map((e) => (e.id === event.app!.id ? event.app! : e)),
          };
        }
        // add
        if (base[bucket].some((e) => e.id === event.app!.id)) return base;
        return { ...base, [bucket]: [...base[bucket], event.app!] };
      },
    );
    mockSha256Hex16.mockResolvedValue('custom-hash-1234');
    mockRegisterCustomExe.mockResolvedValue(true);
  });

  // =========================================================================
  // Initialization — module-level side effects
  // =========================================================================

  describe('initialization', () => {
    it('calls getCoordinatorSnapshot on module load', () => {
      // The module-level side-effect fires at import time
      expect(getCoordinatorSnapshotCalledAtImport).toBe(true);
    });

    it('subscribes to coordinator status on module load', () => {
      // The module-level side-effect fires at import time
      expect(onCoordinatorStatusCalledAtImport).toBe(true);
    });

    it('passes a callback to onCoordinatorStatus at module load', () => {
      expect(onCoordinatorStatusCallbackAtImport).toBeInstanceOf(Function);
    });

    it('initial state has null scanResult, false scanning, null scanError', () => {
      // Reset to verify the create() return shape
      const state = useAppsStore.getState();
      expect(state.scanResult).toBeNull();
      expect(state.scanning).toBe(false);
      expect(state.scanError).toBeNull();
    });
  });

  // =========================================================================
  // scan()
  // =========================================================================

  describe('scan()', () => {
    it('performs normal scan: sets scanning, calls API, updates result, clears scanning', async () => {
      let scanProgressCallback: ((event: unknown) => void) | null = null;
      mockOnElectronScanProgress.mockImplementation((cb: (event: unknown) => void) => {
        scanProgressCallback = cb;
        return vi.fn();
      });
      mockScanElectronApps.mockResolvedValueOnce(MOCK_SCAN_RESULT);

      // Stream an event before scan completes
      const scanPromise = useAppsStore.getState().scan(true);
      expect(useAppsStore.getState().scanning).toBe(true);

      // Simulate a streamed event arriving
      scanProgressCallback!({ op: 'add', app: MOCK_APP });

      await scanPromise;

      expect(mockScanElectronApps).toHaveBeenCalledWith(true);
      expect(useAppsStore.getState().scanning).toBe(false);
      expect(useAppsStore.getState().scanResult).not.toBeNull();
      expect(useAppsStore.getState().scanResult?.other).toHaveLength(1);
      expect(useAppsStore.getState().scanResult?.adapted).toHaveLength(1);
    });

    it('guards against concurrent scans (second call returns immediately)', async () => {
      let resolveFirstScan: (() => void) | null = null;
      mockScanElectronApps.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstScan = () => resolve(MOCK_SCAN_RESULT);
          }),
      );

      const firstCall = useAppsStore.getState().scan();
      expect(useAppsStore.getState().scanning).toBe(true);

      // Second call should be a no-op
      await useAppsStore.getState().scan();
      expect(mockScanElectronApps).toHaveBeenCalledTimes(1);

      // Resolve the first scan
      resolveFirstScan!();
      await firstCall;
      expect(useAppsStore.getState().scanning).toBe(false);
    });

    it('sets scanError when scan fails', async () => {
      mockScanElectronApps.mockRejectedValueOnce(new Error('scanner IPC timeout'));

      await useAppsStore.getState().scan();

      expect(useAppsStore.getState().scanning).toBe(false);
      expect(useAppsStore.getState().scanError).toBe('scanner IPC timeout');
    });

    it('sets scanError to stringified message for non-Error throws', async () => {
      mockScanElectronApps.mockRejectedValueOnce('raw failure string');

      await useAppsStore.getState().scan();

      expect(useAppsStore.getState().scanError).toBe('raw failure string');
    });

    it('clears scanError at the start of a new scan', async () => {
      // First scan: fails
      mockScanElectronApps.mockRejectedValueOnce(new Error('first failure'));
      await useAppsStore.getState().scan();
      expect(useAppsStore.getState().scanError).not.toBeNull();

      // Second scan: succeeds
      mockScanElectronApps.mockResolvedValueOnce(MOCK_SCAN_RESULT);
      await useAppsStore.getState().scan();
      expect(useAppsStore.getState().scanError).toBeNull();
    });
  });

  // =========================================================================
  // launch()
  // =========================================================================

  describe('launch()', () => {
    it('launches app successfully and clears launchingApps', async () => {
      mockLaunchElectronApp.mockResolvedValueOnce({
        ok: true,
        state: 'launched',
        pid: 12345,
        port: 9222,
        message: 'OK',
      });

      await useAppsStore.getState().launch(MOCK_APP);

      expect(mockLaunchElectronApp).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: MOCK_APP.id,
          exePath: MOCK_APP.exePath,
          adapted: false,
          forceRestart: false,
        }),
      );
      expect(useAppsStore.getState().launchingApps.has(MOCK_APP.id)).toBe(false);
    });

    it('guards against double-launch (second call returns immediately)', async () => {
      let resolveLaunch: (() => void) | null = null;
      mockLaunchElectronApp.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLaunch = () =>
              resolve({ ok: true, state: 'launched', pid: 1, port: 9222, message: 'OK' });
          }),
      );

      const firstCall = useAppsStore.getState().launch(MOCK_APP);
      expect(useAppsStore.getState().launchingApps.has(MOCK_APP.id)).toBe(true);

      // Second call: should be no-op
      await useAppsStore.getState().launch(MOCK_APP);
      expect(mockLaunchElectronApp).toHaveBeenCalledTimes(1);

      resolveLaunch!();
      await firstCall;
    });

    it('triggers needs-restart dialog when result.state is needs-restart', async () => {
      mockLaunchElectronApp.mockResolvedValueOnce({
        ok: false,
        state: 'needs-restart',
        port: null,
        message: 'Debug port not available without restart',
      });

      await useAppsStore.getState().launch(MOCK_APP);

      expect(mockSetLaunchRestartPrompt).toHaveBeenCalledWith({
        appId: MOCK_APP.id,
        name: MOCK_APP.productName,
        message: 'Debug port not available without restart',
      });
    });

    it('calls notificationStore.fail when launch result is not ok', async () => {
      mockLaunchElectronApp.mockResolvedValueOnce({
        ok: false,
        state: 'failed',
        port: null,
        message: 'Executable not found',
      });

      await useAppsStore.getState().launch(MOCK_APP);

      expect(mockNotificationFail).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Executable not found'),
        }),
      );
    });

    it('calls notificationStore.fail when launch IPC throws', async () => {
      mockLaunchElectronApp.mockRejectedValueOnce(new Error('IPC channel timeout'));

      await useAppsStore.getState().launch(MOCK_APP);

      expect(mockNotificationFail).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Launch failed'),
        }),
      );
      // launchingApps should be cleared even on error
      expect(useAppsStore.getState().launchingApps.has(MOCK_APP.id)).toBe(false);
    });

    it('clears launchingApps in finally block after successful launch', async () => {
      mockLaunchElectronApp.mockResolvedValueOnce({
        ok: true,
        state: 'running',
        pid: 999,
        port: 9222,
        message: 'OK',
      });

      await useAppsStore.getState().launch(MOCK_APP);
      expect(useAppsStore.getState().launchingApps.size).toBe(0);
    });
  });

  // =========================================================================
  // addCustomApp()
  // =========================================================================

  describe('addCustomApp()', () => {
    it('adds a custom app to scanResult.other and registers it', async () => {
      const exePath = 'C:\\Custom\\app.exe';
      const result = await useAppsStore.getState().addCustomApp(exePath);

      expect(result).not.toBeNull();
      expect(result?.exePath).toBe(exePath);
      expect(result?.adapterMatch).toBeNull();
      expect(result?.productName).toBe('app');
      expect(mockSha256Hex16).toHaveBeenCalledWith(exePath);
      expect(mockRegisterCustomExe).toHaveBeenCalledWith(exePath);

      const other = useAppsStore.getState().scanResult?.other;
      expect(other).toHaveLength(1);
      expect(other?.[0]?.exePath).toBe(exePath);
    });

    it('deduplicates by exePath — second call returns existing app without re-adding', async () => {
      const exePath = 'C:\\Custom\\dedupe-test.exe';

      const first = await useAppsStore.getState().addCustomApp(exePath);
      const second = await useAppsStore.getState().addCustomApp(exePath);

      // Only one entry in scanResult.other
      expect(useAppsStore.getState().scanResult?.other).toHaveLength(1);
      // Both calls return the same app reference
      expect(first?.id).toBe(second?.id);
      // registerCustomExe only called once
      expect(mockRegisterCustomExe).toHaveBeenCalledTimes(1);
    });

    it('returns null on dedupe when no scanResult exists', async () => {
      // This scenario shouldn't happen in practice but tests the defensive path
      const exePath = 'C:\\Custom\\null-test.exe';

      // First add succeeds
      await useAppsStore.getState().addCustomApp(exePath);
      // Manually remove from scanResult to simulate the edge case
      useAppsStore.setState({ scanResult: null });

      // Second call should returns null because scanResult is null,
      // can't find the existing by exePath
      // NOTE: customExePaths has the path, so dedupe triggers, but find()
      // on null scanResult returns undefined -> returns null
      const result = await useAppsStore.getState().addCustomApp(exePath);
      expect(result).toBeNull();
    });

    it('handles registerCustomExe failure gracefully (still returns app)', async () => {
      const exePath = 'C:\\Custom\\fail-register.exe';
      mockRegisterCustomExe.mockRejectedValueOnce(new Error('registry write failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await useAppsStore.getState().addCustomApp(exePath);

      expect(result).not.toBeNull();
      expect(result?.exePath).toBe(exePath);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[appsStore] addCustomApp: registerCustomExe failed —',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // refreshStatus()
  // =========================================================================

  describe('refreshStatus()', () => {
    it('syncs runningApps from coordinator snapshot', async () => {
      const snapshot = new Map<string, AppRunState>([['app-1', MOCK_RUN_STATE]]);
      mockGetCoordinatorSnapshot.mockResolvedValueOnce(snapshot);

      await useAppsStore.getState().refreshStatus();

      expect(useAppsStore.getState().runningApps.get('app-1')).toEqual(MOCK_RUN_STATE);
    });

    it('handles refreshStatus failure without throwing', async () => {
      mockGetCoordinatorSnapshot.mockRejectedValueOnce(new Error('coordinator unreachable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await expect(useAppsStore.getState().refreshStatus()).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // toggleHidden()
  // =========================================================================

  describe('toggleHidden()', () => {
    it('adds app to hiddenApps when not hidden', () => {
      useAppsStore.getState().toggleHidden('app-to-hide');

      expect(useAppsStore.getState().hiddenApps.has('app-to-hide')).toBe(true);
    });

    it('removes app from hiddenApps when already hidden', () => {
      useAppsStore.setState({ hiddenApps: new Set(['app-to-unhide']) });

      useAppsStore.getState().toggleHidden('app-to-unhide');

      expect(useAppsStore.getState().hiddenApps.has('app-to-unhide')).toBe(false);
    });

    it('toggles hidden state correctly across multiple calls', () => {
      useAppsStore.getState().toggleHidden('app-1');
      useAppsStore.getState().toggleHidden('app-1');
      useAppsStore.getState().toggleHidden('app-1');

      // Toggled 3 times: on -> off -> on
      expect(useAppsStore.getState().hiddenApps.has('app-1')).toBe(true);
    });
  });

  // =========================================================================
  // forceRestartLaunch()
  // =========================================================================

  describe('forceRestartLaunch()', () => {
    it('finds app from scanResult and launches with forceRestart', async () => {
      // Setup: scanResult has the app
      useAppsStore.setState({
        scanResult: MOCK_SCAN_RESULT,
      });
      mockLaunchElectronApp.mockResolvedValueOnce({
        ok: true,
        state: 'launched',
        pid: 777,
        port: 9222,
        message: 'OK',
      });

      await useAppsStore.getState().forceRestartLaunch(MOCK_APP.id);

      // Dialog should be closed
      expect(mockSetLaunchRestartPrompt).toHaveBeenCalledWith(null);
      // Launch should be called with forceRestart: true
      expect(mockLaunchElectronApp).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: MOCK_APP.id,
          forceRestart: true,
        }),
      );
    });

    it('handles app not found in scanResult (no-op)', async () => {
      useAppsStore.setState({
        scanResult: { adapted: [], other: [] },
      });

      await useAppsStore.getState().forceRestartLaunch('nonexistent-id');

      expect(mockSetLaunchRestartPrompt).toHaveBeenCalledWith(null);
      expect(mockLaunchElectronApp).not.toHaveBeenCalled();
    });

    it('handles null scanResult (no-op)', async () => {
      useAppsStore.setState({ scanResult: null });

      await useAppsStore.getState().forceRestartLaunch('any-id');

      expect(mockSetLaunchRestartPrompt).toHaveBeenCalledWith(null);
      expect(mockLaunchElectronApp).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Coordinator subscription
  // =========================================================================

  describe('onCoordinatorStatus subscription', () => {
    it('updates runningApps when coordinator pushes a running state', () => {
      // Use the captured subscription callback from module load
      const statusCallback = onCoordinatorStatusCallbackAtImport;
      expect(statusCallback).toBeInstanceOf(Function);

      // Simulate coordinator push
      statusCallback!({ appId: 'running-app', state: MOCK_RUN_STATE });

      expect(useAppsStore.getState().runningApps.get('running-app')).toEqual(MOCK_RUN_STATE);
    });

    it('removes app from runningApps when coordinator pushes a stopped state', () => {
      // First set a running app
      useAppsStore.setState({
        runningApps: new Map([['stopped-app', MOCK_RUN_STATE]]),
      });

      const statusCallback = onCoordinatorStatusCallbackAtImport;
      expect(statusCallback).toBeInstanceOf(Function);

      // Simulate coordinator push: app stopped
      statusCallback!({
        appId: 'stopped-app',
        state: { running: false, pid: 0, port: null, debugReady: false, updatedAt: Date.now() },
      });

      expect(useAppsStore.getState().runningApps.has('stopped-app')).toBe(false);
    });
  });
});
