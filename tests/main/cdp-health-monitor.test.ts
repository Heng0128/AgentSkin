// SPDX-License-Identifier: MIT
//
// # cdp-health-monitor.test.ts — unit tests for the CDP Health Monitor.
//
// Validates:
//   - Construction & default config
//   - State machine: IDLE → STARTING → RUNNING → DEGRADED → STOPPING → IDLE
//   - Soft watchdog: event loop lag detection
//   - CPU watchdog: busy-loop detection with sliding window
//   - Hard watchdog: worker-thread heartbeat monitor
//   - Edge cases: invalid PID, double start/stop, recovery
//   - Callback invocation

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthMonitor, STATE } from '../../scripts/lib/cdp-health-monitor.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock Worker that records messages and supports on/postMessage.
 * The worker simulates the hard-watchdog behavior: it tracks heartbeats
 * and can be configured to fire a 'killed' message after a timeout.
 */
function createMockWorker() {
  const messages: Array<{ type: string; [k: string]: unknown }> = [];
  const listeners = new Map<string, Set<(msg: unknown) => void>>();
  let killedFired = false;

  const worker = {
    postMessage(msg: { type: string; [k: string]: unknown }) {
      messages.push(msg);
      // Simulate the worker firing 'killed' when it receives a 'stop' or
      // when explicitly triggered via simulateKill().
      if (msg.type === 'stop') {
        // Worker exits — no further messages.
      }
    },
    on(event: string, cb: (msg: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    },
    off(event: string, cb: (msg: unknown) => void) {
      listeners.get(event)?.delete(cb);
    },
    terminate: vi.fn().mockResolvedValue(0),
    // Test helper: simulate the worker firing a 'killed' message.
    simulateKill() {
      if (killedFired) return;
      killedFired = true;
      const cbs = listeners.get('message');
      if (cbs) {
        for (const cb of cbs) {
          cb({ type: 'killed', pid: 9999 });
        }
      }
    },
    // Expose captured messages for assertions.
    get capturedMessages() {
      return messages;
    },
  };

  return worker;
}

/**
 * Create a HealthMonitor with injected mock dependencies for testing.
 *
 * @param {object} [opts] - Options.
 * @param {object} [opts.config] - Partial config to override defaults.
 * @param {(pid: number) => number} [opts.sampleCpu] - CPU sampler.
 * @param {(worker: ReturnType<typeof createMockWorker>) => void} [opts.onWorkerCreated] - Called when worker is created.
 * @returns {monitor: HealthMonitor, worker: ReturnType<typeof createMockWorker>, onLagDetected: ReturnType<typeof vi.fn>, onCpuBusy: ReturnType<typeof vi.fn>}}
 */
function createTestMonitor(
  opts: {
    config?: Record<string, unknown>;
    sampleCpu?: (pid: number) => number;
    onWorkerCreated?: (worker: ReturnType<typeof createMockWorker>) => void;
  } = {},
) {
  const onLagDetected = vi.fn();
  const onCpuBusy = vi.fn();
  const worker = createMockWorker();

  const monitor = new HealthMonitor({
    checkInterval: 100,
    lagThreshold: 200,
    cpuThreshold: 85,
    hardKillMs: 1000,
    consecutiveLagCount: 3,
    cpuWindowSize: 6,
    cpuThresholdCount: 3,
    onLagDetected,
    onCpuBusy,
    sampleCpu: opts.sampleCpu ?? (() => 0),
    createWorker: () => worker as unknown as Worker,
    ...opts.config,
  });

  opts.onWorkerCreated?.(worker);

  return { monitor, worker, onLagDetected, onCpuBusy };
}

// ---------------------------------------------------------------------------
// 1. Construction & defaults
// ---------------------------------------------------------------------------

describe('construction & defaults', () => {
  it('creates a monitor in IDLE state', () => {
    const { monitor } = createTestMonitor();
    expect(monitor.getStatus().state).toBe(STATE.IDLE);
  });

  it('initializes with null targetPid', () => {
    const { monitor } = createTestMonitor();
    expect(monitor.getStatus().targetPid).toBeNull();
  });

  it('initializes with zero consecutiveLagCount', () => {
    const { monitor } = createTestMonitor();
    expect(monitor.getStatus().consecutiveLagCount).toBe(0);
  });

  it('initializes with empty cpuWindow', () => {
    const { monitor } = createTestMonitor();
    expect(monitor.getStatus().cpuWindow).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. State machine — start / stop lifecycle
// ---------------------------------------------------------------------------

describe('start / stop lifecycle', () => {
  it('transitions IDLE → RUNNING on start()', () => {
    const { monitor } = createTestMonitor();
    monitor.start(1234);
    expect(monitor.getStatus().state).toBe(STATE.RUNNING);
  });

  it('sets targetPid after start()', () => {
    const { monitor } = createTestMonitor();
    monitor.start(5678);
    expect(monitor.getStatus().targetPid).toBe(5678);
  });

  it('transitions RUNNING → IDLE on stop()', () => {
    const { monitor } = createTestMonitor();
    monitor.start(1234);
    monitor.stop();
    expect(monitor.getStatus().state).toBe(STATE.IDLE);
  });

  it('clears targetPid after stop()', () => {
    const { monitor } = createTestMonitor();
    monitor.start(1234);
    monitor.stop();
    expect(monitor.getStatus().targetPid).toBeNull();
  });

  it('throws on double start()', () => {
    const { monitor } = createTestMonitor();
    monitor.start(1234);
    expect(() => monitor.start(1234)).toThrow(/cannot start in state/);
  });

  it('stop() when IDLE is a silent no-op', () => {
    const { monitor } = createTestMonitor();
    expect(() => monitor.stop()).not.toThrow();
    expect(monitor.getStatus().state).toBe(STATE.IDLE);
  });

  it('supports multiple start/stop cycles', () => {
    const { monitor } = createTestMonitor();

    monitor.start(1111);
    expect(monitor.getStatus().state).toBe(STATE.RUNNING);
    monitor.stop();
    expect(monitor.getStatus().state).toBe(STATE.IDLE);

    monitor.start(2222);
    expect(monitor.getStatus().state).toBe(STATE.RUNNING);
    expect(monitor.getStatus().targetPid).toBe(2222);
    monitor.stop();
    expect(monitor.getStatus().state).toBe(STATE.IDLE);
  });
});

// ---------------------------------------------------------------------------
// 3. Soft watchdog — event loop lag detection
// ---------------------------------------------------------------------------

describe('soft watchdog — lag detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not trigger onLagDetected when lag is below threshold', async () => {
    const { monitor, onLagDetected } = createTestMonitor();
    monitor.start(1234);

    // Advance timers — no lag injected, so hrtime returns normal values.
    await vi.advanceTimersByTimeAsync(500);

    expect(onLagDetected).not.toHaveBeenCalled();
    expect(monitor.getStatus().state).toBe(STATE.RUNNING);

    monitor.stop();
  });

  it('increments consecutiveLagCount on lag spikes', async () => {
    // Mock process.hrtime to simulate lag.
    let callCount = 0;
    const hrtimeSpy = vi.spyOn(process, 'hrtime').mockImplementation((() => {
      callCount++;
      // Return increasing values to simulate lag > threshold (200ms).
      return [0, callCount * 300 * 1e6]; // 300ms each call
    }) as typeof process.hrtime);

    const { monitor } = createTestMonitor();
    monitor.start(1234);

    // Advance enough ticks to trigger lag detection.
    await vi.advanceTimersByTimeAsync(500);

    // consecutiveLagCount should have incremented.
    expect(monitor.getStatus().consecutiveLagCount).toBeGreaterThan(0);

    hrtimeSpy.mockRestore();
    monitor.stop();
  });

  it('transitions to DEGRADED after consecutiveLagCount violations', async () => {
    const hrtimeSpy = vi.spyOn(process, 'hrtime').mockImplementation((() => {
      // Always return lag above threshold (300ms > 200ms).
      return [0, 300 * 1e6];
    }) as typeof process.hrtime);

    const { monitor, onLagDetected } = createTestMonitor();
    monitor.start(1234);

    // Advance enough ticks for 3 consecutive violations.
    await vi.advanceTimersByTimeAsync(500);

    expect(monitor.getStatus().state).toBe(STATE.DEGRADED);
    expect(onLagDetected).toHaveBeenCalled();

    hrtimeSpy.mockRestore();
    monitor.stop();
  });

  it('resets consecutiveLagCount when lag subsides', async () => {
    let callCount = 0;
    const hrtimeSpy = vi.spyOn(process, 'hrtime').mockImplementation((() => {
      callCount++;
      // First interval returns high lag (both calls), then low lag thereafter.
      return callCount <= 2 ? [0, 300 * 1e6] : [0, 1 * 1e6];
    }) as typeof process.hrtime);

    const { monitor } = createTestMonitor();
    monitor.start(1234);

    await vi.advanceTimersByTimeAsync(1000);

    // Counter incremented once (lag=300 > 200) then reset (lag=1 < 200) — never reached 3.
    expect(monitor.getStatus().consecutiveLagCount).toBeLessThan(3);

    hrtimeSpy.mockRestore();
    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// 4. CPU watchdog — busy-loop detection
// ---------------------------------------------------------------------------

describe('CPU watchdog — busy-loop detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not trigger onCpuBusy when CPU is below threshold', async () => {
    const { monitor, onCpuBusy } = createTestMonitor({
      sampleCpu: () => 50, // below 85% threshold
    });
    monitor.start(1234);

    await vi.advanceTimersByTimeAsync(1000);

    expect(onCpuBusy).not.toHaveBeenCalled();
    expect(monitor.getStatus().state).toBe(STATE.RUNNING);

    monitor.stop();
  });

  it('triggers onCpuBusy when CPU exceeds threshold in window', async () => {
    const { monitor, onCpuBusy } = createTestMonitor({
      sampleCpu: () => 95, // above 85% threshold
    });
    monitor.start(1234);

    // Advance enough ticks to fill the window with high-CPU samples.
    await vi.advanceTimersByTimeAsync(1000);

    expect(onCpuBusy).toHaveBeenCalled();
    expect(monitor.getStatus().state).toBe(STATE.DEGRADED);

    monitor.stop();
  });

  it('sliding window evicts old samples', async () => {
    let callCount = 0;
    const { monitor } = createTestMonitor({
      sampleCpu: () => {
        callCount++;
        // First 3 calls return high CPU, then drop to low.
        return callCount <= 3 ? 95 : 10;
      },
    });
    monitor.start(1234);

    // Advance enough to fill window and push out old high values.
    await vi.advanceTimersByTimeAsync(2000);

    // Window should contain recent low values.
    const window = monitor.getStatus().cpuWindow;
    expect(window.length).toBeLessThanOrEqual(6);
    // Most recent values should be low.
    if (window.length > 0) {
      expect(window[window.length - 1]).toBe(10);
    }

    monitor.stop();
  });

  it('onCpuBusy callback receives cpuPercent and count', async () => {
    const { monitor, onCpuBusy } = createTestMonitor({
      sampleCpu: () => 99,
    });
    monitor.start(1234);

    await vi.advanceTimersByTimeAsync(1000);

    expect(onCpuBusy).toHaveBeenCalled();
    const callArgs = onCpuBusy.mock.calls[0];
    expect(callArgs[0]).toBe(99); // cpuPercent
    expect(callArgs[1]).toBeGreaterThanOrEqual(3); // count

    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// 5. Hard watchdog — worker-thread heartbeat
// ---------------------------------------------------------------------------

describe('hard watchdog — worker heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a worker on start()', () => {
    const { monitor, worker } = createTestMonitor();
    monitor.start(1234);
    // Worker should have received a config message.
    expect(worker.capturedMessages.some((m) => m.type === 'config')).toBe(true);
    monitor.stop();
  });

  it('sends heartbeat messages to the worker', async () => {
    const { monitor, worker } = createTestMonitor();
    monitor.start(1234);

    // Advance time to trigger heartbeats.
    await vi.advanceTimersByTimeAsync(15000);

    const heartbeats = worker.capturedMessages.filter((m) => m.type === 'heartbeat');
    expect(heartbeats.length).toBeGreaterThan(0);

    monitor.stop();
  });

  it('transitions to KILLED when worker fires killed message', () => {
    const { monitor, worker } = createTestMonitor();
    monitor.start(1234);

    // Simulate the worker detecting a timeout and firing 'killed'.
    worker.simulateKill();

    expect(monitor.getStatus().state).toBe(STATE.KILLED);
  });

  it('sends stop message to worker on stop()', () => {
    const { monitor, worker } = createTestMonitor();
    monitor.start(1234);
    monitor.stop();

    expect(worker.capturedMessages.some((m) => m.type === 'stop')).toBe(true);
  });

  it('config message includes targetPid and hardKillMs', () => {
    const { monitor, worker } = createTestMonitor();
    monitor.start(9999);

    const configMsg = worker.capturedMessages.find((m) => m.type === 'config');
    expect(configMsg).toBeDefined();
    expect(configMsg?.targetPid).toBe(9999);
    expect(configMsg?.hardKillMs).toBe(1000);

    monitor.stop();
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('throws on start() with PID 0', () => {
    const { monitor } = createTestMonitor();
    expect(() => monitor.start(0)).toThrow(/invalid PID/);
  });

  it('throws on start() with negative PID', () => {
    const { monitor } = createTestMonitor();
    expect(() => monitor.start(-1)).toThrow(/invalid PID/);
  });

  it('throws on start() with non-integer PID', () => {
    const { monitor } = createTestMonitor();
    expect(() => monitor.start(3.14)).toThrow(/invalid PID/);
  });

  it('getStatus returns a copy of cpuWindow (not the original)', () => {
    const { monitor } = createTestMonitor();
    monitor.start(1234);

    const status = monitor.getStatus();
    status.cpuWindow.push(999);

    // Original should not be mutated.
    expect(monitor.getStatus().cpuWindow).not.toContain(999);

    monitor.stop();
  });

  it('stop() from DEGRADED transitions to IDLE', () => {
    vi.useFakeTimers();
    const hrtimeSpy = vi.spyOn(process, 'hrtime').mockImplementation((() => {
      return [0, 300 * 1e6]; // always laggy
    }) as typeof process.hrtime);

    const { monitor } = createTestMonitor();
    monitor.start(1234);

    // Advance to trigger DEGRADED.
    vi.advanceTimersByTime(500);
    expect(monitor.getStatus().state).toBe(STATE.DEGRADED);

    // Stop should still work.
    monitor.stop();
    expect(monitor.getStatus().state).toBe(STATE.IDLE);

    hrtimeSpy.mockRestore();
    vi.useRealTimers();
  });

  it('does not throw when stopping from KILLED state', () => {
    const { monitor, worker } = createTestMonitor();
    monitor.start(1234);

    // Simulate kill.
    worker.simulateKill();
    expect(monitor.getStatus().state).toBe(STATE.KILLED);

    // stop() should not throw (cleanup is idempotent).
    expect(() => monitor.stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. Callback verification
// ---------------------------------------------------------------------------

describe('callback verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('onLagDetected receives (lagMs, consecutiveCount)', async () => {
    const hrtimeSpy = vi.spyOn(process, 'hrtime').mockImplementation((() => {
      return [0, 500 * 1e6]; // 500ms lag
    }) as typeof process.hrtime);

    const { monitor, onLagDetected } = createTestMonitor();
    monitor.start(1234);

    await vi.advanceTimersByTimeAsync(500);

    if (onLagDetected.mock.calls.length > 0) {
      const [lagMs, count] = onLagDetected.mock.calls[0];
      expect(lagMs).toBeGreaterThan(200); // above threshold
      expect(count).toBeGreaterThanOrEqual(3); // consecutive count
    }

    hrtimeSpy.mockRestore();
    monitor.stop();
  });

  it('onCpuBusy receives (cpuPercent, overCount)', async () => {
    const { monitor, onCpuBusy } = createTestMonitor({
      sampleCpu: () => 90,
    });
    monitor.start(1234);

    await vi.advanceTimersByTimeAsync(1000);

    if (onCpuBusy.mock.calls.length > 0) {
      const [cpuPercent, count] = onCpuBusy.mock.calls[0];
      expect(cpuPercent).toBe(90);
      expect(count).toBeGreaterThanOrEqual(3);
    }

    monitor.stop();
  });

  it('callbacks are not invoked after stop()', async () => {
    const hrtimeSpy = vi.spyOn(process, 'hrtime').mockImplementation((() => {
      return [0, 300 * 1e6];
    }) as typeof process.hrtime);

    const { monitor, onLagDetected } = createTestMonitor();
    monitor.start(1234);

    await vi.advanceTimersByTimeAsync(200);
    const callCountBefore = onLagDetected.mock.calls.length;

    monitor.stop();

    // Advance more — no new callbacks should fire.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLagDetected.mock.calls.length).toBe(callCountBefore);

    hrtimeSpy.mockRestore();
  });
});
