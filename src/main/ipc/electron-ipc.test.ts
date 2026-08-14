// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ElectronScanResult, LaunchResult } from '../../shared/types/agent';

// ---------------------------------------------------------------------------
// Mocks — must precede the dynamic import that pulls in the module under test
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../services/electron-scanner', () => ({
  scanElectronApps: vi.fn(),
  getCachedScan: vi.fn(),
  invalidateScanCache: vi.fn(),
}));

vi.mock('../services/electron-launcher', () => ({
  launchApp: vi.fn(),
  getRunningApps: vi.fn(),
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
// Tests
// ---------------------------------------------------------------------------

describe('electron-ipc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerElectronIpc();
  });

  describe('ELECTRON_SCAN', () => {
    it('invokes scanElectronApps with cache enabled and returns the result', async () => {
      vi.mocked(scanElectronApps).mockResolvedValue(sampleScanResult);

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      const result = await handler({});

      expect(scanElectronApps).toHaveBeenCalledOnce();
      expect(scanElectronApps).toHaveBeenCalledWith({ useCache: true });
      expect(result).toEqual(sampleScanResult);
    });

    it('propagates scanner errors to the renderer', async () => {
      vi.mocked(scanElectronApps).mockRejectedValue(new Error('registry access denied'));

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      await expect(handler({})).rejects.toThrow('registry access denied');
    });

    it('rejects with IpcTimeoutError when the scan hangs', async () => {
      // Never-settling promise triggers the withMonitoredTimeout 15s ceiling.
      vi.mocked(scanElectronApps).mockReturnValue(new Promise(() => {}));

      const handler = handlers.get(IpcChannel.ELECTRON_SCAN)!;
      const caught = await handler({}).catch((e: unknown) => e);

      expect(caught).toHaveProperty('name', 'IpcTimeoutError');
      expect(caught).toHaveProperty('channel', IpcChannel.ELECTRON_SCAN);
      expect(caught).toHaveProperty('ms', 15000);
    }, 25_000); // scan timeout is 15s; 25s lets it fire before vitest kills
  });

  describe('ELECTRON_LAUNCH', () => {
    it('forwards the LaunchRequest to launchApp and returns the result', async () => {
      vi.mocked(launchApp).mockResolvedValue(sampleLaunchResult);

      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      const result = await handler({}, sampleLaunchRequest);

      expect(launchApp).toHaveBeenCalledOnce();
      expect(launchApp).toHaveBeenCalledWith(sampleLaunchRequest);
      expect(result).toEqual(sampleLaunchResult);
    });

    it('propagates launch errors to the renderer', async () => {
      vi.mocked(launchApp).mockRejectedValue(new Error('spawn ENOENT'));

      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      await expect(handler({}, sampleLaunchRequest)).rejects.toThrow('spawn ENOENT');
    });

    it('rejects with IpcTimeoutError when launch hangs', async () => {
      // Never-settling promise triggers the withMonitoredTimeout 30s ceiling.
      vi.mocked(launchApp).mockReturnValue(new Promise(() => {}));

      const handler = handlers.get(IpcChannel.ELECTRON_LAUNCH)!;
      const caught = await handler({}, sampleLaunchRequest).catch((e: unknown) => e);

      expect(caught).toHaveProperty('name', 'IpcTimeoutError');
      expect(caught).toHaveProperty('channel', IpcChannel.ELECTRON_LAUNCH);
      expect(caught).toHaveProperty('ms', 30000);
    }, 40_000); // launch timeout is 30s; 40s lets it fire before vitest kills
  });
});
