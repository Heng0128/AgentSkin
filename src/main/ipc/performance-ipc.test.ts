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
import type { PerformanceHistoryResponse } from '../services/performance';

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

// ---------------------------------------------------------------------------
// REQ-G-004: dispose() behavior
// ---------------------------------------------------------------------------

describe('performance-ipc — dispose behavior (REQ-G-004)', () => {
  it('should call unsubscribe when dispose is called', async () => {
    const unsubscribe = vi.fn();
    mockSubscribeTrace.mockReturnValue(unsubscribe);
    const { dispose } = await reRegisterWithDispose();
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('should be idempotent when dispose is called multiple times', async () => {
    const unsubscribe = vi.fn();
    mockSubscribeTrace.mockReturnValue(unsubscribe);
    const { dispose } = await reRegisterWithDispose();
    dispose();
    dispose();
    dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    // No exception should be thrown on repeated calls.
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

/**
 * Re-register handlers and return the dispose function from
 * registerPerformanceIpc(). Used to verify REQ-G-004 unsubscribe behavior.
 */
async function reRegisterWithDispose(): Promise<{ dispose: () => void }> {
  const mod = await import('./performance-ipc');
  return mod.registerPerformanceIpc({ mainWindow: null, studioWindow: null } as never);
}

// ---------------------------------------------------------------------------
// Data loop verification — ensure IPC-returned structures match renderer contract
// ---------------------------------------------------------------------------

describe('performance-ipc — data loop verification', () => {
  beforeEach(() => {
    handlers.clear();
    mockGetHistory.mockReset();
    mockGetStats.mockReset();
    mockGetRecentTimeouts.mockReset();
  });

  it('PERFORMANCE_GET returns full PerformanceHistoryResponse structure', async () => {
    const historyResponse = {
      recent: [
        {
          id: 'trace-1',
          agentId: 'doubao',
          themeId: 'midnight',
          finishedAt: 1000,
          duration: 250,
          success: true,
          steps: [
            { name: 'connectCdp', duration: 80, success: true },
            { name: 'injectCss', duration: 170, success: true },
          ],
        },
      ],
      stats: {
        totalApplies: 5,
        avgDurationMs: 200,
        perAgentAvg: { doubao: 200 },
        overflowCount: 0,
      },
    };
    mockGetHistory.mockReturnValue(historyResponse);
    await reRegister();

    const result = invoke(IpcChannel.PERFORMANCE_GET, 10) as PerformanceHistoryResponse;

    // Renderer contract: recent[] and stats must both exist.
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0]!.steps[0]!).toEqual({
      name: 'connectCdp',
      duration: 80,
      success: true,
    });
    expect(result.stats.totalApplies).toBe(5);
    expect(result.stats.overflowCount).toBe(0);
  });

  it('PERFORMANCE_GET propagates step errors to renderer', async () => {
    const historyResponse = {
      recent: [
        {
          id: 'trace-fail',
          agentId: 'workbuddy',
          finishedAt: 2000,
          duration: 50,
          success: false,
          steps: [{ name: 'connectCdp', duration: 50, success: false, error: 'WebSocket timeout' }],
          error: 'WebSocket timeout',
        },
      ],
      stats: {
        totalApplies: 1,
        avgDurationMs: 50,
        perAgentAvg: { workbuddy: 50 },
        overflowCount: 0,
      },
    };
    mockGetHistory.mockReturnValue(historyResponse);
    await reRegister();

    const result = invoke(IpcChannel.PERFORMANCE_GET, 10) as PerformanceHistoryResponse;
    expect(result.recent[0]!.success).toBe(false);
    expect(result.recent[0]!.steps[0]!.error).toBe('WebSocket timeout');
    expect(result.recent[0]!.error).toBe('WebSocket timeout');
  });

  it('PERFORMANCE_GET handles empty history gracefully', async () => {
    const historyResponse = {
      recent: [],
      stats: { totalApplies: 0, avgDurationMs: 0, perAgentAvg: {}, overflowCount: 0 },
    };
    mockGetHistory.mockReturnValue(historyResponse);
    await reRegister();

    const result = invoke(IpcChannel.PERFORMANCE_GET, 10) as PerformanceHistoryResponse;
    expect(result.recent).toEqual([]);
    expect(result.stats.totalApplies).toBe(0);
  });

  it('PERFORMANCE_GET includes overflowCount in stats (data not silently lost)', async () => {
    const historyResponse = {
      recent: [],
      stats: { totalApplies: 100, avgDurationMs: 150, perAgentAvg: {}, overflowCount: 50 },
    };
    mockGetHistory.mockReturnValue(historyResponse);
    await reRegister();

    const result = invoke(IpcChannel.PERFORMANCE_GET, 10) as PerformanceHistoryResponse;
    expect(result.stats.overflowCount).toBe(50);
  });

  it('subscribeTrace fan-out delivers trace to main window', async () => {
    const listeners: Array<(trace: unknown) => void> = [];
    mockSubscribeTrace.mockImplementation((listener: (trace: unknown) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    });

    const sendSpy = vi.fn();
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: sendSpy },
    };

    const mod = await import('./performance-ipc');
    mod.registerPerformanceIpc({
      mainWindow: mockWindow as never,
      studioWindow: null,
    } as never);

    // Simulate a trace being logged — the listener should fan-out.
    const sampleTrace = { id: 't1', agentId: 'doubao', duration: 100 };
    for (const listener of listeners) {
      listener(sampleTrace);
    }

    expect(sendSpy).toHaveBeenCalledWith(IpcChannel.PERFORMANCE_NEW_TRACE, sampleTrace);
  });
});
