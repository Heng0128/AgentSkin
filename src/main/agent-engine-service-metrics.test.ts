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
import type { SettingsServiceApi, StructuredLogEvent } from './services/contracts';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';

// ---------------------------------------------------------------------------
// Minimal mocks (consistent with reliability test suite)
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => ({
  reconcileZombiePorts: vi.fn(async () => {}),
  probeAppStatus: vi.fn(),
  resolveLivePort: vi.fn(async () => null),
  ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
  inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' })),
}));

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSettings(): SettingsServiceApi & {
  logStructured?: (event: StructuredLogEvent) => void;
} {
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: null })),
    wallpaper: vi.fn(() => ({ enabled: false, id: null, render: null })),
    agentWallpaper: vi.fn(() => ({ enabled: false })),
    toDto: vi.fn(() => ({})),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
  } as unknown as SettingsServiceApi & { logStructured?: (event: StructuredLogEvent) => void };
}

function makeService(stateFile: string): AgentEngineService {
  // biome-ignore lint/suspicious/noExplicitAny: test stub — production always provides a real ThemeLibraryApi
  return new AgentEngineService({} as any, stateFile, makeSettings());
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
      await svc.persist.safe(() => svc.writeState());

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
      await svc.persist.safe(() => svc.writeState());
      await svc.persist.safe(() => svc.writeState());
      await svc.persist.safe(() => svc.writeState());

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

      await svc.persist.safe(() => svc.writeState());
      // Counter should be 1 after first failure.
      expect(svc.collectConcurrencyMetrics().persistFailures).toBe(1);

      await svc.persist.safe(() => svc.writeState());
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
});
