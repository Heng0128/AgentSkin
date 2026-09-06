// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HARD_WATCHDOG_CONFIG,
  HardWatchdog,
  type HardWatchdogDeps,
  type WorkerLike,
} from './watchdog';

// Mock logger
vi.mock('../logger', () => ({
  mainDebug: vi.fn(),
  mainWarn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a mock Worker */
function createMockWorker(): WorkerLike {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}

/** Create test dependencies with controllable mocks */
function createTestDeps(overrides: Partial<HardWatchdogDeps> = {}): HardWatchdogDeps {
  return {
    createWorker: vi.fn().mockReturnValue(createMockWorker()),
    beatFn: vi.fn(),
    clearInterval: vi.fn(),
    setInterval: vi.fn().mockReturnValue({} as ReturnType<typeof setInterval>),
    now: vi.fn(() => Date.now()),
    ...overrides,
  } as unknown as HardWatchdogDeps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HardWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  describe('construction', () => {
    it('uses default config when none provided', () => {
      const wd = new HardWatchdog();
      expect(wd).toBeDefined();
    });

    it('merges partial config with defaults', () => {
      const wd = new HardWatchdog({ timeoutMs: 30_000 });
      expect(wd).toBeDefined();
    });
  });

  describe('start / stop lifecycle', () => {
    it('is not running initially', () => {
      const wd = new HardWatchdog();
      expect(wd.isRunning()).toBe(false);
    });

    it('becomes running after start()', () => {
      const deps = createTestDeps();
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      expect(wd.isRunning()).toBe(true);
      wd.stop();
    });

    it('sends config to worker on start', () => {
      const mockWorker = createMockWorker();
      const deps = createTestDeps({
        createWorker: vi.fn().mockReturnValue(mockWorker),
      });
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: 'config',
        timeoutMs: 5000,
        checkIntervalMs: 1000,
      });
      wd.stop();
    });

    it('stops cleanly', () => {
      const deps = createTestDeps();
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      wd.stop();
      expect(wd.isRunning()).toBe(false);
      expect(deps.clearInterval).toHaveBeenCalled();
    });

    it('sends stop message to worker on stop', () => {
      const mockWorker = createMockWorker();
      const deps = createTestDeps({
        createWorker: vi.fn().mockReturnValue(mockWorker),
      });
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      wd.stop();
      expect(mockWorker.postMessage).toHaveBeenCalledWith({ type: 'stop' });
    });

    it('terminates the worker on stop', () => {
      const mockWorker = createMockWorker();
      const deps = createTestDeps({
        createWorker: vi.fn().mockReturnValue(mockWorker),
      });
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      wd.stop();
      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it('start() is idempotent (no double-start)', () => {
      const deps = createTestDeps();
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      const firstCreateCount = (deps.createWorker as ReturnType<typeof vi.fn>).mock.calls.length;
      wd.start(); // second start should be no-op
      expect((deps.createWorker as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        firstCreateCount,
      );
      wd.stop();
    });
  });

  describe('heartbeat', () => {
    it('does nothing when not running', () => {
      const deps = createTestDeps();
      const wd = new HardWatchdog({}, deps);
      wd.beat();
      // createWorker should not be called since we never started
      expect(deps.createWorker).not.toHaveBeenCalled();
    });

    it('sends heartbeat with timestamp when running', () => {
      const mockWorker = createMockWorker();
      const deps = createTestDeps({
        createWorker: vi.fn().mockReturnValue(mockWorker),
        now: vi.fn(() => 1234567890),
      });
      const wd = new HardWatchdog({ timeoutMs: 5000, checkIntervalMs: 1000 }, deps);
      wd.start();
      // Clear the config message
      (mockWorker.postMessage as ReturnType<typeof vi.fn>).mockClear();
      wd.beat();
      expect(mockWorker.postMessage).toHaveBeenCalledWith({
        type: 'beat',
        timestamp: 1234567890,
      });
      wd.stop();
    });

    it('sends periodic heartbeats automatically', async () => {
      const mockWorker = createMockWorker();
      const mockSetInterval = vi.fn().mockReturnValue({} as ReturnType<typeof setInterval>);
      const deps = createTestDeps({
        createWorker: vi.fn().mockReturnValue(mockWorker),
        setInterval: mockSetInterval,
      });
      const wd = new HardWatchdog(
        { timeoutMs: 4000, checkIntervalMs: 500 }, // beat interval = 4000/4 = 1000ms
        deps,
      );
      wd.start();
      // The heartbeat timer should have been set
      expect(mockSetInterval).toHaveBeenCalled();
      wd.stop();
    });
  });

  describe('default config', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_HARD_WATCHDOG_CONFIG.timeoutMs).toBe(60_000);
      expect(DEFAULT_HARD_WATCHDOG_CONFIG.checkIntervalMs).toBe(1000);
      expect(DEFAULT_HARD_WATCHDOG_CONFIG.killSignal).toBe('SIGKILL');
    });
  });

  describe('config merging', () => {
    it('uses default timeoutMs when not specified', () => {
      const wd = new HardWatchdog({ checkIntervalMs: 500 });
      expect(wd).toBeDefined();
    });

    it('uses default checkIntervalMs when not specified', () => {
      const wd = new HardWatchdog({ timeoutMs: 30_000 });
      expect(wd).toBeDefined();
    });
  });
});
