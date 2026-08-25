// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ElectronScanResult, LaunchResult } from '../../shared/types/agent';
import type { MainContext } from '../main-context';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers, {
  app: {
    getPath: vi.fn((name: string) => `\\mock\\userData\\${name}`),
  },
}));

vi.mock('../services/electron-scanner', () => ({
  scanElectronApps: vi.fn(),
  getCachedScan: vi.fn(),
  invalidateScanCache: vi.fn(),
}));

vi.mock('../services/electron-launcher', () => ({
  launchApp: vi.fn(),
  registerAllowedExePaths: vi.fn(),
}));

vi.mock('../services/performance', () => ({
  performanceLogger: {
    logTimeout: vi.fn(),
    log: vi.fn(),
  },
}));

const { registerElectronIpc } = await import('./electron-ipc');
const { scanElectronApps } = await import('../services/electron-scanner');
const { launchApp } = await import('../services/electron-launcher');
const { setTrustedSenderId } = await import('./trusted-sender');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleScanResult: ElectronScanResult = {
  adapted: [
    {
      id: 'abc123',
      exePath: 'C:\\App\\traework.exe',
      productName: 'TRAE Work',
      companyName: 'ByteDance',
      adapterMatch: 'traework',
      version: '1.2.3',
    },
  ],
  other: [],
};

const sampleLaunchResult: LaunchResult = {
  ok: true,
  pid: 12345,
  port: 9222,
  state: 'launched',
  message: 'App launched with CDP on port 9222',
};

const sampleLaunchRequest = {
  appId: 'abc123',
  exePath: 'C:\\App\\traework.exe',
  adapted: true,
  preferredPort: 9222,
  adapterId: 'traework',
};

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const overridesFor = vi.fn<() => { appPath: string | null; port: number | null }>(() => ({
  appPath: null,
  port: null,
}));
// The handler only reads `settings.overridesFor`; the full `SettingsServiceApi`
// surface is irrelevant to this test, so the mock narrows the context shape.
const deps = { settings: { overridesFor } } as unknown as Pick<MainContext, 'settings'>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('electron-ipc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    setTrustedSenderId(1);
    registerElectronIpc(deps);
  });

  describe('ELECTRON_SCAN', () => {
    it('invokes scanElectronApps with cache enabled and returns the result', async () => {
      vi.mocked(scanElectronApps).mockResolvedValue(sampleScanResult);

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      const result = await handler({});

      expect(scanElectronApps).toHaveBeenCalledOnce();
      expect(scanElectronApps).toHaveBeenCalledWith({
        useCache: true,
        extraDirs: [],
        onApp: expect.any(Function),
        userDataPath: expect.any(String),
      });
      expect(result).toEqual(sampleScanResult);
    });

    it('forwards per-agent appPath overrides into extraDirs', async () => {
      vi.mocked(scanElectronApps).mockResolvedValue(sampleScanResult);
      vi.mocked(overridesFor).mockReturnValueOnce({ appPath: 'C:\\Custom\\App', port: null });

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      await handler({});

      expect(scanElectronApps).toHaveBeenCalledOnce();
      expect(scanElectronApps).toHaveBeenCalledWith({
        useCache: true,
        extraDirs: ['C:\\Custom\\App'],
        onApp: expect.any(Function),
        userDataPath: expect.any(String),
      });
    });

    it('propagates scanner errors to the renderer', async () => {
      vi.mocked(scanElectronApps).mockRejectedValue(new Error('registry access denied'));

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      await expect(handler({})).rejects.toThrow('registry access denied');
    });

    it('streams identity-merged add/update events to the requesting renderer', async () => {
      const other = {
        id: 'q1',
        exePath: 'C:\\App\\quark.exe',
        productName: 'Quark',
        companyName: '',
        adapterMatch: null,
        version: '7.0.5.931',
      };
      vi.mocked(scanElectronApps).mockImplementation((options) => {
        options?.onApp?.({ op: 'add', app: other });
        return Promise.resolve({ ...sampleScanResult, other: [other] });
      });
      const sender = { isDestroyed: () => false, send: vi.fn() };

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      await handler({ sender });

      expect(sender.send).toHaveBeenCalledWith(IpcChannel.ELECTRON_SCAN_PROGRESS, {
        op: 'add',
        app: other,
      });
    });

    it('rejects with IpcTimeoutError when the scan hangs', async () => {
      // Never-settling promise triggers the withMonitoredTimeout 30s ceiling.
      vi.mocked(scanElectronApps).mockReturnValue(new Promise(() => {}));

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      const caught = await handler({}).catch((e: unknown) => e);

      expect(caught).toHaveProperty('name', 'IpcTimeoutError');
      expect(caught).toHaveProperty('channel', IpcChannel.ELECTRON_SCAN);
      expect((caught as { ms: number }).ms).toBe(30000);
    }, 40_000); // scan timeout is 30s; 40s lets it fire before vitest kills
  });

  describe('ELECTRON_LAUNCH', () => {
    const trustedEvent = { sender: { id: 1 }, senderFrame: { isMainFrame: () => true } };

    it('forwards the LaunchRequest to launchApp and returns the result', async () => {
      vi.mocked(launchApp).mockResolvedValue(sampleLaunchResult);

      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      const result = await handler(trustedEvent, sampleLaunchRequest);

      expect(launchApp).toHaveBeenCalledOnce();
      expect(launchApp).toHaveBeenCalledWith(sampleLaunchRequest);
      expect(result).toEqual(sampleLaunchResult);
    });

    it('propagates launch errors to the renderer', async () => {
      vi.mocked(launchApp).mockRejectedValue(new Error('spawn ENOENT'));

      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      await expect(handler(trustedEvent, sampleLaunchRequest)).rejects.toThrow('spawn ENOENT');
    });

    it('rejects with IpcTimeoutError when launch hangs', async () => {
      // Never-settling promise triggers the withMonitoredTimeout 30s ceiling.
      vi.mocked(launchApp).mockReturnValue(new Promise(() => {}));

      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      const caught = await handler(trustedEvent, sampleLaunchRequest).catch((e: unknown) => e);

      expect(caught).toHaveProperty('name', 'IpcTimeoutError');
      expect(caught).toHaveProperty('channel', IpcChannel.ELECTRON_LAUNCH);
      expect((caught as { ms: number }).ms).toBe(30000);
    }, 40_000); // launch timeout is 30s; 40s lets it fire before vitest kills

    it('rejects calls from an untrusted sender (G5)', async () => {
      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      await expect(handler({ sender: { id: 999 } }, sampleLaunchRequest)).rejects.toThrow(
        'Untrusted IPC sender',
      );
      expect(launchApp).not.toHaveBeenCalled();
    });
  });
});
