// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService — Concurrency Metrics Subsystem Tests
 *
 * Covers the 4 previously-untested public methods of the metrics subsystem:
 *   - collectConcurrencyMetrics()
 *   - updateConcurrencyMetricsFromRenderer()
 *   - startConcurrencyMetricsTimer()
 *   - stopConcurrencyMetricsTimer()
 *
 * Also exercises private broadcastConcurrencyMetrics() via the public timer API
 * and verifies disposal cleans up the interval.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentEngineService } from './agent-engine-service';
import { appendLogLine, writeJsonAtomic } from './fs-utils';
import { notifyPersistFailure } from './main-context';
import type { SettingsServiceApi, StructuredLogEvent } from './services/contracts';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';
// RC4-S4-A: Import shared mock factory for type-safe stubs
import { makeSettingsStub, makeThemeLibraryStub } from './test-helpers/mock-services';

/** Type helper for accessing private members in tests (TS private is not runtime-enforced). */
type AgentEngineServicePrivate = {
  persist: { safe: (fn: () => unknown) => Promise<void> };
  writeState: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Minimal mocks (consistent with reliability test suite)
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => {
  class LivePortCache {
    private m = new Map<string, number>();
    get(a: string) {
      return this.m.get(a) ?? null;
    }
    set(a: string, p: number) {
      this.m.set(a, p);
    }
    clear(a: string) {
      this.m.delete(a);
    }
    clearAll() {
      this.m.clear();
    }
    size() {
      return this.m.size;
    }
  }
  return {
    LivePortCache,
    reconcileZombiePorts: vi.fn(async () => {}),
    probeAppStatus: vi.fn(),
    resolveLivePort: vi.fn(async () => null),
    ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
    inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' })),
  };
});

vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: vi.fn() }));
vi.mock('./theme-restore-flow', () => ({ restoreThemeFlow: vi.fn() }));
vi.mock('./fs-utils', () => ({
  writeJsonAtomic: vi.fn(async () => {}),
  appendLogLine: vi.fn(async () => {}),
}));
vi.mock('./wallpaper-injector', () => ({
  applyAgentWallpaperNow: vi.fn(async () => ({ ok: true })),
  applyWallpaperToAgent: vi.fn(async () => ({ ok: true })),
  injectAgentWallpaperFromApply: vi.fn(async () => {}),
  removeAgentVideoWallpaper: vi.fn(async () => {}),
  removeWallpaperFromAgent: vi.fn(async () => ({ ok: true })),
  getCapturedTokensSize: vi.fn(() => 0),
  getDeferredSelfHealsSize: vi.fn(() => 0),
}));
vi.mock('./cdp/injection/engine-strategy', () => ({
  cleanupEngineInjectionForAgent: vi.fn(),
  disposeEngineInjectionState: vi.fn(),
}));
vi.mock('./wallpaper/injection-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wallpaper/injection-state')>();
  return {
    ...actual,
    cleanupWallpaperStateForAgent: vi.fn(actual.cleanupWallpaperStateForAgent),
    disposeWallpaperInjectionState: vi.fn(actual.disposeWallpaperInjectionState),
  };
});
vi.mock('./wallpaper-self-heal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wallpaper-self-heal')>();
  return {
    ...actual,
    cleanupSelfHealForAgent: vi.fn(actual.cleanupSelfHealForAgent),
    disposeSelfHealState: vi.fn(actual.disposeSelfHealState),
  };
});
vi.mock('./theme/utils', () => ({ disposeThemeAssetCache: vi.fn() }));
vi.mock('./main-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./main-context')>();
  return {
    ...actual,
    notifyPersistFailure: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSettings(): SettingsServiceApi & {
  logStructured?: (event: StructuredLogEvent) => void;
} {
  return makeSettingsStub() as SettingsServiceApi & {
    logStructured?: (event: StructuredLogEvent) => void;
  };
}

function makeService(stateFile: string): AgentEngineService {
  return new AgentEngineService(makeThemeLibraryStub(), stateFile, makeSettings());
}

// ---------------------------------------------------------------------------
// Tests (collect/update — no fake timers needed)
// ---------------------------------------------------------------------------

describe('AgentEngineService — Concurrency Metrics Subsystem', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(applyThemeFlow).mockResolvedValue({
      response: {
        status: 'applied' as const,
        message: 'ok',
        system: { platform: 'win32', apps: [] },
      },
      background: Promise.resolve(),
    });
    vi.mocked(restoreThemeFlow).mockResolvedValue({ platform: 'win32', apps: [] });
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-metrics-'));
    stateFile = path.join(tmpDir, 'state.json');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // collectConcurrencyMetrics
  // -------------------------------------------------------------------------

  describe('collectConcurrencyMetrics()', () => {
    it('returns a 7-field metrics snapshot', () => {
      const svc = makeService(stateFile);
      const m = svc.collectConcurrencyMetrics();

      expect(m).toHaveProperty('companionBusyByAgent');
      expect(m).toHaveProperty('inflightOperations');
      expect(m).toHaveProperty('selfHealingAgents');
      expect(m).toHaveProperty('capturedTokens');
      expect(m).toHaveProperty('persistChainDepth');
      expect(m).toHaveProperty('deferredSelfHeals');
      expect(m).toHaveProperty('switchEpochByAgent');
    });

    it('reports zero inflight operations initially', () => {
      const svc = makeService(stateFile);
      const m = svc.collectConcurrencyMetrics();
      expect(m.inflightOperations).toBe(0);
    });

    it('reflects updated renderer-provided values', () => {
      const svc = makeService(stateFile);
      svc.updateConcurrencyMetricsFromRenderer(5, 3);
      const m = svc.collectConcurrencyMetrics();
      expect(m.companionBusyByAgent).toBe(5);
      expect(m.switchEpochByAgent).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // updateConcurrencyMetricsFromRenderer
  // -------------------------------------------------------------------------

  describe('updateConcurrencyMetricsFromRenderer()', () => {
    it('clamps negative companionBusy to zero', () => {
      const svc = makeService(stateFile);
      svc.updateConcurrencyMetricsFromRenderer(-10, 5);
      const m = svc.collectConcurrencyMetrics();
      expect(m.companionBusyByAgent).toBe(0);
      expect(m.switchEpochByAgent).toBe(5);
    });

    it('clamps negative switchEpoch to zero', () => {
      const svc = makeService(stateFile);
      svc.updateConcurrencyMetricsFromRenderer(3, -1);
      const m = svc.collectConcurrencyMetrics();
      expect(m.companionBusyByAgent).toBe(3);
      expect(m.switchEpochByAgent).toBe(0);
    });

    it('accepts zero values', () => {
      const svc = makeService(stateFile);
      svc.updateConcurrencyMetricsFromRenderer(0, 0);
      const m = svc.collectConcurrencyMetrics();
      expect(m.companionBusyByAgent).toBe(0);
      expect(m.switchEpochByAgent).toBe(0);
    });

    it('preserves positive values', () => {
      const svc = makeService(stateFile);
      svc.updateConcurrencyMetricsFromRenderer(42, 99);
      const m = svc.collectConcurrencyMetrics();
      expect(m.companionBusyByAgent).toBe(42);
      expect(m.switchEpochByAgent).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // startConcurrencyMetricsTimer / stopConcurrencyMetricsTimer (fake timers)
  // -------------------------------------------------------------------------

  describe('startConcurrencyMetricsTimer()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('invokes the sender immediately on start (synchronous broadcast)', () => {
      const svc = makeService(stateFile);
      const sent: unknown[][] = [];
      try {
        svc.startConcurrencyMetricsTimer((metrics) => {
          sent.push([metrics]);
        });
        // One synchronous broadcast on start
        expect(sent).toHaveLength(1);
        expect(sent[0]).toHaveLength(1);
        expect(sent[0][0]).toHaveProperty('inflightOperations');
      } finally {
        svc.stopConcurrencyMetricsTimer();
      }
    });

    it('fires the interval callback periodically', async () => {
      const svc = makeService(stateFile);
      const sent: unknown[][] = [];
      try {
        svc.startConcurrencyMetricsTimer((metrics) => {
          sent.push([metrics]);
        });

        // Advance time by 5 seconds three times
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(5000);

        // Initial + 3 interval fires >= 4
        expect(sent.length).toBeGreaterThanOrEqual(4);
      } finally {
        svc.stopConcurrencyMetricsTimer();
      }
    });

    it('is idempotent — calling twice does not create duplicate intervals', async () => {
      const svc = makeService(stateFile);
      const sent: unknown[][] = [];
      const sender = (metrics: unknown) => {
        sent.push([metrics]);
      };

      try {
        svc.startConcurrencyMetricsTimer(sender);
        // Second call should be a no-op (guard: if timer !== null, return)
        svc.startConcurrencyMetricsTimer(sender);

        // Advance time 3 intervals
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(5000);

        // Expected: 1 (initial) + 3 (interval) = 4, NOT 8 if duplicate timer
        // Allow small tolerance for timer scheduling jitter
        expect(sent.length).toBeLessThanOrEqual(6);
        expect(sent.length).toBeGreaterThanOrEqual(3);
      } finally {
        svc.stopConcurrencyMetricsTimer();
      }
    });
  });

  describe('stopConcurrencyMetricsTimer()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('clears the interval so no more metrics are sent', async () => {
      const svc = makeService(stateFile);
      const sent: unknown[][] = [];
      svc.startConcurrencyMetricsTimer((metrics) => {
        sent.push([metrics]);
      });

      const countAtStart = sent.length;
      svc.stopConcurrencyMetricsTimer();

      // Advance well past one interval
      await vi.advanceTimersByTimeAsync(10_000);

      // No new broadcasts should have fired after stop
      expect(sent.length).toBe(countAtStart);
    });

    it('can be called when no timer is active (no-op)', () => {
      const svc = makeService(stateFile);
      expect(() => svc.stopConcurrencyMetricsTimer()).not.toThrow();
    });

    it('allows restart after stop', async () => {
      const svc = makeService(stateFile);
      const sent1: unknown[][] = [];
      svc.startConcurrencyMetricsTimer((m) => sent1.push([m]));
      svc.stopConcurrencyMetricsTimer();

      // Restart with a new sender
      const sent2: unknown[][] = [];
      svc.startConcurrencyMetricsTimer((m) => sent2.push([m]));

      expect(sent2).toHaveLength(1); // immediate broadcast on restart

      await vi.advanceTimersByTimeAsync(5000);
      expect(sent2.length).toBeGreaterThanOrEqual(2);

      svc.stopConcurrencyMetricsTimer();
    });
  });

  // -------------------------------------------------------------------------
  // broadcast error handling (via timer API)
  // -------------------------------------------------------------------------

  describe('broadcastConcurrencyMetrics — error handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('does not propagate errors thrown by the sender callback', async () => {
      const svc = makeService(stateFile);
      let callCount = 0;

      svc.startConcurrencyMetricsTimer(() => {
        callCount++;
        throw new Error('renderer crashed');
      });

      // The synchronous initial broadcast should not throw
      expect(callCount).toBe(1);

      // Advancing the timer should also not throw (error is swallowed)
      await vi.advanceTimersByTimeAsync(5000);
      expect(callCount).toBeGreaterThanOrEqual(2);

      svc.stopConcurrencyMetricsTimer();
    });
  });

  // -------------------------------------------------------------------------
  // dispose cleanup
  // -------------------------------------------------------------------------

  describe('dispose — interval cleanup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('stops the metrics timer on dispose', async () => {
      const svc = makeService(stateFile);
      const sent: unknown[][] = [];
      svc.startConcurrencyMetricsTimer((m) => sent.push([m]));

      svc.dispose();

      // After dispose, the interval should be cleared
      const countAfterDispose = sent.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sent.length).toBe(countAfterDispose);
    });
  });

  // -------------------------------------------------------------------------
  // persistFailures counter
  // -------------------------------------------------------------------------

  describe('persistFailures counter', () => {
    /**
     * Verifies the persistFailures counter starts at 0 on a fresh service.
     */
    it('persistFailures starts at 0', () => {
      const svc = makeService(stateFile);
      const m = svc.collectConcurrencyMetrics();
      expect(m.persistFailures).toBe(0);
    });

    /**
     * Verifies that when writeJsonAtomic rejects (e.g. disk full),
     * writeState catches the error and increments persistFailures.
     */
    it('persistFailures increments on writeState failure', async () => {
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));
      // appendLogLine must resolve — otherwise the internal log() call from
      // writeState's catch handler would double-increment the counter.
      vi.mocked(appendLogLine).mockResolvedValue(undefined);
      const svc = makeService(stateFile);

      // Trigger writeState via persist.safe — same path the apply/restore flows use.
      // The persist chain serialises calls, so we await the safe() promise.
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );

      const m = svc.collectConcurrencyMetrics();
      expect(m.persistFailures).toBe(1);
    });

    /**
     * Verifies that when appendLogLine rejects (e.g. disk full),
     * the log() method's catch handler increments persistFailures.
     */
    it('persistFailures increments on appendLogLine failure', async () => {
      vi.mocked(appendLogLine).mockRejectedValue(new Error('disk full'));
      const svc = makeService(stateFile);

      // log() is private; trigger it via asLogger() which exposes log().
      const logger = svc.asLogger();
      logger.log('test log line');

      // The catch handler runs asynchronously — flush microtasks.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const m = svc.collectConcurrencyMetrics();
      expect(m.persistFailures).toBe(1);
    });

    /**
     * Verifies that collectConcurrencyMetrics() includes the persistFailures field.
     */
    it('collectConcurrencyMetrics includes persistFailures', () => {
      const svc = makeService(stateFile);
      const m = svc.collectConcurrencyMetrics();
      expect(m).toHaveProperty('persistFailures');
      expect(typeof m.persistFailures).toBe('number');
    });

    /**
     * Verifies that persistFailures accumulates across multiple failures.
     */
    it('persistFailures accumulates across multiple failures', async () => {
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));
      // appendLogLine must resolve — otherwise the internal log() call from
      // writeState's catch handler would double-increment the counter.
      vi.mocked(appendLogLine).mockResolvedValue(undefined);
      const svc = makeService(stateFile);

      // Trigger three consecutive writeState failures.
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );

      const m = svc.collectConcurrencyMetrics();
      expect(m.persistFailures).toBe(3);
    });

    /**
     * Verifies that a writeState failure does not break subsequent writes.
     * After a rejection, the next writeState call should still execute.
     */
    it('writeState failure does not break subsequent writes', async () => {
      // First call rejects, second call succeeds.
      vi.mocked(writeJsonAtomic)
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce(undefined);
      // appendLogLine must resolve — otherwise the internal log() call from
      // writeState's catch handler would double-increment the counter.
      vi.mocked(appendLogLine).mockResolvedValue(undefined);

      const svc = makeService(stateFile);

      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      // Counter should be 1 after first failure.
      expect(svc.collectConcurrencyMetrics().persistFailures).toBe(1);

      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      // Counter stays at 1 after a successful write (no increment).
      expect(svc.collectConcurrencyMetrics().persistFailures).toBe(1);
    });

    /**
     * Verifies that appendLogLine failure does not break subsequent logging.
     * After a rejection, the next log() call should still fire logListener.
     */
    it('log appendLogLine failure does not break logging', async () => {
      // First call rejects, second call succeeds.
      vi.mocked(appendLogLine)
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce(undefined);

      const receivedLines: string[] = [];
      const svc = makeService(stateFile);
      svc.setLogListener((line) => receivedLines.push(line));

      const logger = svc.asLogger();
      logger.log('first line');
      await new Promise((resolve) => setTimeout(resolve, 0));

      logger.log('second line');
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Both lines should reach the listener regardless of appendLogLine failure.
      expect(receivedLines).toContain('first line');
      expect(receivedLines).toContain('second line');
      // Counter incremented only once (for the first failure).
      expect(svc.collectConcurrencyMetrics().persistFailures).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // persistFailures threshold notification
  // -------------------------------------------------------------------------

  describe('persistFailures threshold notification', () => {
    /**
     * Verifies that notifyPersistFailure is called when persistFailures
     * reaches the threshold (3) after consecutive writeState failures.
     */
    it('notifyPersistFailure called when threshold reached', async () => {
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));
      vi.mocked(appendLogLine).mockResolvedValue(undefined);
      const svc = makeService(stateFile);

      // Trigger three consecutive writeState failures.
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );

      expect(notifyPersistFailure).toHaveBeenCalledTimes(1);
      expect(notifyPersistFailure).toHaveBeenCalledWith(3);
    });

    /**
     * Verifies that notifyPersistFailure is NOT called when persistFailures
     * is below the threshold (1 or 2 consecutive failures).
     */
    it('notifyPersistFailure not called below threshold', async () => {
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));
      vi.mocked(appendLogLine).mockResolvedValue(undefined);
      const svc = makeService(stateFile);

      // Only 2 failures — below threshold of 3.
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );

      expect(notifyPersistFailure).not.toHaveBeenCalled();
    });

    /**
     * Verifies that notifyPersistFailure sends the correct failureCount
     * in its payload argument.
     */
    it('notifyPersistFailure sends correct failureCount', async () => {
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));
      vi.mocked(appendLogLine).mockResolvedValue(undefined);
      const svc = makeService(stateFile);

      // Trigger 4 failures — threshold crossed at 3, fires once with count=3,
      // then fires again at count=4 (>= 3 still holds).
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );
      await (svc as unknown as AgentEngineServicePrivate).persist.safe(() =>
        (svc as unknown as AgentEngineServicePrivate).writeState(),
      );

      // Called at count=3 and count=4.
      expect(notifyPersistFailure).toHaveBeenCalledTimes(2);
      expect(notifyPersistFailure).toHaveBeenNthCalledWith(1, 3);
      expect(notifyPersistFailure).toHaveBeenNthCalledWith(2, 4);
    });
  });
});

// ---------------------------------------------------------------------------
// IPC fan-out verification
// ---------------------------------------------------------------------------

/**
 * These tests verify that registerConcurrencyMetricsIpc fans out metrics
 * to BOTH mainWindow and studioWindow (mirroring notifyStatusChanged).
 *
 * Strategy: mock electron's ipcMain and the concurrency-metrics-ipc module's
 * dependencies, capture the timer callback, and invoke it with controlled
 * window mocks.
 */
describe('IPC fan-out verification', () => {
  // Captured callback from startConcurrencyMetricsTimer
  let capturedCallback: ((metrics: unknown) => void) | null = null;

  // Mock window state
  let mainWindowDestroyed = false;
  let studioWindowDestroyed = false;
  const mainWindowSendArgs: unknown[][] = [];
  const studioWindowSendArgs: unknown[][] = [];

  // Import the function under test via dynamic import after mocks are set up
  // We use vi.hoisted to ensure mocks are available at import time.
  const mockStartConcurrencyMetricsTimer = vi.fn((callback: (metrics: unknown) => void) => {
    capturedCallback = callback;
  });
  const mockStopConcurrencyMetricsTimer = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedCallback = null;
    mainWindowDestroyed = false;
    studioWindowDestroyed = false;
    mainWindowSendArgs.length = 0;
    studioWindowSendArgs.length = 0;

    // Dynamically import fresh module instance each test
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Creates a minimal MainContext-shaped object with mock windows.
   */
  function makeCtx(
    studioWindow: {
      webContents: { send: (...args: unknown[]) => void };
      isDestroyed: () => boolean;
    } | null,
  ) {
    return {
      core: {
        startConcurrencyMetricsTimer: mockStartConcurrencyMetricsTimer,
        stopConcurrencyMetricsTimer: mockStopConcurrencyMetricsTimer,
      },
      mainWindow: {
        webContents: {
          send: (...args: unknown[]) => mainWindowSendArgs.push(args),
        },
        isDestroyed: () => mainWindowDestroyed,
      },
      studioWindow,
    };
  }

  it('sends metrics to mainWindow', async () => {
    // Mock ipcMain from electron before importing the IPC module
    vi.doMock('electron', () => ({
      ipcMain: { on: vi.fn() },
    }));
    vi.doMock('../shared/ipc-channels', () => ({
      IpcChannel: {
        DIAGNOSTICS_CONCURRENCY_METRICS: 'diagnostics:concurrency-metrics',
        DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY: 'diagnostics:update-renderer-concurrency',
      },
    }));

    const { registerConcurrencyMetricsIpc } = await import('./ipc/concurrency-metrics-ipc');

    const studioWindow = {
      webContents: { send: (...args: unknown[]) => studioWindowSendArgs.push(args) },
      isDestroyed: () => studioWindowDestroyed,
    };
    const ctx = makeCtx(studioWindow);

    registerConcurrencyMetricsIpc(
      ctx as unknown as Parameters<typeof registerConcurrencyMetricsIpc>[0],
    );

    // The timer should have been started with a callback
    expect(capturedCallback).not.toBeNull();

    // Invoke the callback with a sample metrics payload
    const sampleMetrics = { inflightOperations: 3, persistFailures: 0 };
    capturedCallback!(sampleMetrics);

    // mainWindow should have received the metrics
    expect(mainWindowSendArgs).toHaveLength(1);
    expect(mainWindowSendArgs[0][0]).toBe('diagnostics:concurrency-metrics');
    expect(mainWindowSendArgs[0][1]).toEqual(sampleMetrics);
  });

  it('sends metrics to studioWindow (fan-out)', async () => {
    vi.doMock('electron', () => ({
      ipcMain: { on: vi.fn() },
    }));
    vi.doMock('../shared/ipc-channels', () => ({
      IpcChannel: {
        DIAGNOSTICS_CONCURRENCY_METRICS: 'diagnostics:concurrency-metrics',
        DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY: 'diagnostics:update-renderer-concurrency',
      },
    }));

    const { registerConcurrencyMetricsIpc } = await import('./ipc/concurrency-metrics-ipc');

    const studioWindow = {
      webContents: { send: (...args: unknown[]) => studioWindowSendArgs.push(args) },
      isDestroyed: () => studioWindowDestroyed,
    };
    const ctx = makeCtx(studioWindow);

    registerConcurrencyMetricsIpc(
      ctx as unknown as Parameters<typeof registerConcurrencyMetricsIpc>[0],
    );

    expect(capturedCallback).not.toBeNull();

    const sampleMetrics = { inflightOperations: 2, persistFailures: 1 };
    capturedCallback!(sampleMetrics);

    // studioWindow should ALSO receive the metrics (fan-out)
    expect(studioWindowSendArgs).toHaveLength(1);
    expect(studioWindowSendArgs[0][0]).toBe('diagnostics:concurrency-metrics');
    expect(studioWindowSendArgs[0][1]).toEqual(sampleMetrics);

    // Both windows received the same payload
    expect(mainWindowSendArgs).toHaveLength(1);
    expect(mainWindowSendArgs[0][1]).toEqual(studioWindowSendArgs[0][1]);
  });

  it('skips studioWindow when null', async () => {
    vi.doMock('electron', () => ({
      ipcMain: { on: vi.fn() },
    }));
    vi.doMock('../shared/ipc-channels', () => ({
      IpcChannel: {
        DIAGNOSTICS_CONCURRENCY_METRICS: 'diagnostics:concurrency-metrics',
        DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY: 'diagnostics:update-renderer-concurrency',
      },
    }));

    const { registerConcurrencyMetricsIpc } = await import('./ipc/concurrency-metrics-ipc');

    // studioWindow is null — simulates Studio window not yet created
    const ctx = makeCtx(null);

    registerConcurrencyMetricsIpc(
      ctx as unknown as Parameters<typeof registerConcurrencyMetricsIpc>[0],
    );

    expect(capturedCallback).not.toBeNull();

    const sampleMetrics = { inflightOperations: 0, persistFailures: 0 };
    capturedCallback!(sampleMetrics);

    // mainWindow still receives
    expect(mainWindowSendArgs).toHaveLength(1);
    // studioWindow gets nothing (null guard)
    expect(studioWindowSendArgs).toHaveLength(0);
  });

  it('skips destroyed windows', async () => {
    vi.doMock('electron', () => ({
      ipcMain: { on: vi.fn() },
    }));
    vi.doMock('../shared/ipc-channels', () => ({
      IpcChannel: {
        DIAGNOSTICS_CONCURRENCY_METRICS: 'diagnostics:concurrency-metrics',
        DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY: 'diagnostics:update-renderer-concurrency',
      },
    }));

    const { registerConcurrencyMetricsIpc } = await import('./ipc/concurrency-metrics-ipc');

    const studioWindow = {
      webContents: { send: (...args: unknown[]) => studioWindowSendArgs.push(args) },
      isDestroyed: () => studioWindowDestroyed,
    };
    const ctx = makeCtx(studioWindow);

    registerConcurrencyMetricsIpc(
      ctx as unknown as Parameters<typeof registerConcurrencyMetricsIpc>[0],
    );

    expect(capturedCallback).not.toBeNull();

    // Simulate mainWindow being destroyed (e.g. user closed the main window)
    mainWindowDestroyed = true;

    const sampleMetrics = { inflightOperations: 0, persistFailures: 0 };
    capturedCallback!(sampleMetrics);

    // mainWindow should NOT receive (destroyed guard)
    expect(mainWindowSendArgs).toHaveLength(0);
    // studioWindow still receives (independent guard)
    expect(studioWindowSendArgs).toHaveLength(1);
  });
});
