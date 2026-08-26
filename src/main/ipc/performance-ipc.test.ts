// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for Performance IPC handlers.
 *
 * The handlers are registered once via `registerPerformanceIpc()` which
 * calls `ipcMain.handle()`. We capture those handlers in a Map by mocking
 * `electron`, then invoke them directly with controlled arguments to
 * verify clamping, default parameters, and Number.isFinite guards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import { IpcChannel } from '../../shared/ipc-channels';

// ---------------------------------------------------------------------------
// Mocks — capture handlers registered by registerPerformanceIpc()
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => createElectronMock(handlers));

// Mock function references declared outside the factory so tests can assert
// on call arguments after invocation.
const mockLog = vi.fn();
const mockGetRecent = vi.fn<(count: number) => unknown>();
const mockGetStats = vi.fn();
const mockGetHistory = vi.fn<(count: number) => unknown>();
const mockClear = vi.fn();
const mockLogTimeout = vi.fn();
const mockGetRecentTimeouts = vi.fn<(count: number) => unknown>();
const mockGetAllTimeouts = vi.fn();
const mockClearTimeouts = vi.fn();
const mockStartMemorySampler = vi.fn();
const mockStopMemorySampler = vi.fn();
const mockGetMemorySamples = vi.fn();
const mockGetLatestMemory = vi.fn();
const mockClearMemorySamples = vi.fn();
const mockSubscribeTrace = vi.fn();

// Full PerformanceLoggerApi mock — all 15 methods to prevent "is not a function"
// runtime errors if new IPC handlers are added.
vi.mock('../services/performance', () => ({
  performanceLogger: {
    log: (trace: unknown) => mockLog(trace),
    getRecent: (count: number) => mockGetRecent(count),
    getStats: () => mockGetStats(),
    getHistory: (count: number) => mockGetHistory(count),
    clear: () => mockClear(),
    logTimeout: (event: unknown) => mockLogTimeout(event),
    getRecentTimeouts: (count: number) => mockGetRecentTimeouts(count),
    getAllTimeouts: () => mockGetAllTimeouts(),
    clearTimeouts: () => mockClearTimeouts(),
    startMemorySampler: (intervalMs?: number) => mockStartMemorySampler(intervalMs),
    stopMemorySampler: () => mockStopMemorySampler(),
    getMemorySamples: () => mockGetMemorySamples(),
    getLatestMemory: () => mockGetLatestMemory(),
    clearMemorySamples: () => mockClearMemorySamples(),
    subscribeTrace: (listener: unknown) => mockSubscribeTrace(listener),
  },
}));

// Import triggers registerPerformanceIpc() which populates `handlers`.
await import('./performance-ipc');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Three fixed memory samples returned by the mocked getMemorySamples(). */
const SAMPLES = [
  { ts: 1, heapUsed: 10, rss: 20, external: 30 },
  { ts: 2, heapUsed: 11, rss: 21, external: 31 },
  { ts: 3, heapUsed: 12, rss: 22, external: 32 },
];

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({} as Electron.IpcMainInvokeEvent, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('performance-ipc — clamp behavior', () => {
  beforeEach(() => {
    handlers.clear();
    mockLog.mockReset();
    mockGetRecent.mockReset();
    mockGetStats.mockReset();
    mockGetHistory.mockReset();
    mockClear.mockReset();
    mockLogTimeout.mockReset();
    mockGetRecentTimeouts.mockReset();
    mockGetAllTimeouts.mockReset();
    mockClearTimeouts.mockReset();
    mockStartMemorySampler.mockReset();
    mockStopMemorySampler.mockReset();
    mockGetMemorySamples.mockReset();
    mockGetLatestMemory.mockReset();
    mockClearMemorySamples.mockReset();
    mockSubscribeTrace.mockReset();
    mockGetMemorySamples.mockReturnValue([...SAMPLES]);
    // Re-register handlers after each clear (registerPerformanceIpc runs once
    // at import time, but handlers Map is cleared in beforeEach).
    // Re-import is not needed — we just re-register by calling the function.
    // However, since the module was already evaluated, we need to re-run
    // registration. We do this by re-importing with cache busting.
    vi.resetModules();
  });

  describe('PERFORMANCE_GET', () => {
    it('default (undefined count) resolves to 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET);
      expect(mockGetHistory).toHaveBeenCalledWith(10);
    });

    it('count=5 passes through within range', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, 5);
      expect(mockGetHistory).toHaveBeenCalledWith(5);
    });

    it('count=999 clamps to MAX_COUNT (50)', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, 999);
      expect(mockGetHistory).toHaveBeenCalledWith(50);
    });

    it('count=0 floors to 1', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, 0);
      expect(mockGetHistory).toHaveBeenCalledWith(1);
    });

    it('count=-5 floors to 1', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, -5);
      expect(mockGetHistory).toHaveBeenCalledWith(1);
    });

    it('count=NaN resolves to fallback 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, NaN);
      expect(mockGetHistory).toHaveBeenCalledWith(10);
    });

    it('count=Infinity resolves to fallback 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, Infinity);
      expect(mockGetHistory).toHaveBeenCalledWith(10);
    });

    it('count="string" resolves to fallback 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, 'string');
      expect(mockGetHistory).toHaveBeenCalledWith(10);
    });

    it('count=null resolves to fallback 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET, null);
      expect(mockGetHistory).toHaveBeenCalledWith(10);
    });
  });

  describe('PERFORMANCE_GET_TIMEOUTS', () => {
    it('default (undefined count) resolves to 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET_TIMEOUTS);
      expect(mockGetRecentTimeouts).toHaveBeenCalledWith(10);
    });

    it('count=3 passes through within range', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET_TIMEOUTS, 3);
      expect(mockGetRecentTimeouts).toHaveBeenCalledWith(3);
    });

    it('count=100 clamps to MAX_COUNT (50)', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET_TIMEOUTS, 100);
      expect(mockGetRecentTimeouts).toHaveBeenCalledWith(50);
    });

    it('count=NaN resolves to fallback 10', async () => {
      await reRegister();
      invoke(IpcChannel.PERFORMANCE_GET_TIMEOUTS, NaN);
      expect(mockGetRecentTimeouts).toHaveBeenCalledWith(10);
    });
  });

  describe('PERFORMANCE_CLEAR_TIMEOUTS', () => {
    it('calls clearTimeouts and returns { ok: true }', async () => {
      await reRegister();
      const result = invoke(IpcChannel.PERFORMANCE_CLEAR_TIMEOUTS);
      expect(mockClearTimeouts).toHaveBeenCalledOnce();
      expect(result).toEqual({ ok: true });
    });
  });

  describe('PERFORMANCE_GET_MEMORY', () => {
    it('count=2 returns last 2 samples', async () => {
      await reRegister();
      const result = invoke(IpcChannel.PERFORMANCE_GET_MEMORY, 2) as { ts: number }[];
      expect(result).toHaveLength(2);
      expect(result[0]!.ts).toBe(2);
      expect(result[1]!.ts).toBe(3);
    });

    it('count=0 returns all samples', async () => {
      await reRegister();
      const result = invoke(IpcChannel.PERFORMANCE_GET_MEMORY, 0) as { ts: number }[];
      expect(result).toHaveLength(3);
    });

    it('default (undefined) returns all samples', async () => {
      await reRegister();
      const result = invoke(IpcChannel.PERFORMANCE_GET_MEMORY) as { ts: number }[];
      expect(result).toHaveLength(3);
    });

    it('count=NaN resolves to fallback (all samples)', async () => {
      await reRegister();
      const result = invoke(IpcChannel.PERFORMANCE_GET_MEMORY, NaN) as { ts: number }[];
      expect(result).toHaveLength(3);
    });

    it('count >> sample count returns all', async () => {
      await reRegister();
      const result = invoke(IpcChannel.PERFORMANCE_GET_MEMORY, 999) as { ts: number }[];
      expect(result).toHaveLength(3);
    });
  });
});

/**
 * Re-register handlers after vi.resetModules() invalidates the module cache.
 * Each call to registerPerformanceIpc() adds entries to the `handlers` Map.
 */
async function reRegister(): Promise<void> {
  const mod = await import('./performance-ipc');
  // Pass a minimal ctx stub; the push subscription is a no-op when
  // mainWindow/studioWindow are null (no crash, no send).
  mod.registerPerformanceIpc({ mainWindow: null, studioWindow: null } as never);
}
