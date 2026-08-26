// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # cdp-health-monitor.mjs — CDP Health Monitor & Three-Layer Watchdog
//
// Provides health monitoring for CDP target processes with three layers
// of protection inspired by Lumos-789/zcode-cdp:
//
//   1. Soft Watchdog  — event loop lag detection (setInterval + hrtime)
//   2. CPU Watchdog   — busy-loop detection (sliding-window CPU sampling)
//   3. Hard Watchdog  — worker-thread heartbeat monitor (SIGKILL on timeout)
//
// State machine:
//   IDLE → STARTING → RUNNING → DEGRADED → STOPPING → IDLE
//                        ↓
//                      KILLED
//
// The hard watchdog runs in an independent Worker thread, making it immune
// to main-thread stalls. If the main thread freezes, the worker will
// detect the missing heartbeat and forcefully terminate the target.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

// ---------------------------------------------------------------------------
// Types (JSDoc — consumed by IDEs / tsc --checkJs, not enforced at runtime)
// ---------------------------------------------------------------------------

/**
 * @typedef {'idle'|'starting'|'running'|'degraded'|'stopping'|'killed'} HealthState
 */

/**
 * @typedef {Object} HealthMonitorConfig
 * @property {number} [checkInterval=1000]    ms between health checks.
 * @property {number} [lagThreshold=2000]     ms of event loop lag to trigger warning.
 * @property {number} [cpuThreshold=85]       CPU % threshold for busy-loop detection.
 * @property {number} [hardKillMs=60000]      ms without heartbeat before SIGKILL.
 * @property {number} [consecutiveLagCount=3] consecutive lag readings before warning.
 * @property {number} [cpuWindowSize=6]       sliding window size (2 * cpuThresholdCount).
 * @property {number} [cpuThresholdCount=3]   min samples above threshold in window.
 * @property {(lagMs: number, count: number) => void} [onLagDetected]   callback when lag detected.
 * @property {(cpuPercent: number, count: number) => void} [onCpuBusy]  callback when CPU busy.
 * @property {(pid: number) => number} [sampleCpu]  injectable CPU sampler (for tests).
 * @property {(script: string, pid: number, killMs: number) => Worker} [createWorker]  injectable worker factory (for tests).
 */

/**
 * @typedef {Object} HealthStatus
 * @property {HealthState} state              Current state.
 * @property {number|null} targetPid          Monitored PID (null when idle).
 * @property {number} consecutiveLagCount     Current consecutive lag count.
 * @property {number[]} cpuWindow             Recent CPU samples.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All health monitor states. */
export const STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  KILLED: 'killed',
});

/** Default configuration values. */
const DEFAULTS = Object.freeze({
  checkInterval: 1000,
  lagThreshold: 2000,
  cpuThreshold: 85,
  hardKillMs: 60000,
  consecutiveLagCount: 3,
  cpuWindowSize: 6,
  cpuThresholdCount: 3,
});

/** Interval (ms) at which the main thread sends heartbeats to the worker. */
const HEARTBEAT_INTERVAL = 5000;

/**
 * Inline worker script for the hard watchdog.
 * The worker tracks the last heartbeat timestamp. If the elapsed time
 * exceeds hardKillMs, it sends SIGKILL to the target PID.
 *
 * The script requires no external dependencies — parentPort is a global
 * in the worker context, injected by Node.js automatically.
 */
const WORKER_SCRIPT = `
const { parentPort } = require('node:worker_threads');
let lastHeartbeat = Date.now();
let hardKillMs = 60000;
let targetPid = 0;

parentPort.on('message', (msg) => {
  if (msg.type === 'heartbeat') lastHeartbeat = Date.now();
  if (msg.type === 'config') {
    hardKillMs = msg.hardKillMs;
    targetPid = msg.targetPid;
  }
  if (msg.type === 'stop') process.exit(0);
});

setInterval(() => {
  if (targetPid > 0 && Date.now() - lastHeartbeat > hardKillMs) {
    try { process.kill(targetPid, 'SIGKILL'); } catch { /* already dead */ }
    parentPort.postMessage({ type: 'killed', pid: targetPid });
    process.exit(0);
  }
}, 1000);
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Default CPU sampler. Attempts to read the target process CPU usage.
 *
 * On Linux: reads /proc/[pid]/stat for utime+stime.
 * On macOS / others: falls back to `ps -p <pid> -o %cpu`.
 * Returns 0 when the process cannot be sampled.
 *
 * @param {number} pid - Target process ID.
 * @returns {number} Approximate CPU usage percentage (0–100).
 */
function defaultSampleCpu(pid) {
  // Linux: /proc/[pid]/stat — fields 14 (utime) and 15 (stime) are clock ticks.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.split(' ');
    const utime = Number(fields[13]) || 0;
    const stime = Number(fields[14]) || 0;
    const totalTicks = utime + stime;
    // Rough approximation: assume 100 ticks/sec, convert to percentage of one core.
    return Math.min(Math.max(totalTicks / 100, 0), 100);
  } catch {
    // Not Linux or process gone — try ps.
  }

  try {
    const out = execSync(`ps -p ${pid} -o %cpu`, { encoding: 'utf8', timeout: 2000 });
    const lines = out.trim().split('\n');
    if (lines.length >= 2) {
      return Math.min(Math.max(Number(lines[1].trim()), 0), 100);
    }
  } catch {
    // ps unavailable or process gone.
  }

  return 0;
}

/**
 * Default worker factory. Creates a Worker thread running the hard-watchdog
 * script with eval mode enabled.
 *
 * @param {string} script - Worker script source.
 * @param {number} _pid   - Target PID (unused in the script; passed via postMessage).
 * @param {number} _killMs - Kill timeout (passed via postMessage).
 * @returns {Worker} The created worker thread.
 */
function defaultCreateWorker(script, _pid, _killMs) {
  return new Worker(script, { eval: true });
}

// ---------------------------------------------------------------------------
// HealthMonitor
// ---------------------------------------------------------------------------

/**
 * CDP Health Monitor with three-layer watchdog protection.
 *
 * Monitors a target process and provides escalating responses:
 *   - Lag detection warns via callback before the system becomes unresponsive.
 *   - CPU busy detection catches runaway loops that consume all cores.
 *   - The hard watchdog is the last resort: if the main thread completely
 *     freezes, the worker kills the target PID to prevent zombie processes.
 *
 * All timing functions are injectable for testing.
 */
export class HealthMonitor {
  /** @type {Required<HealthMonitorConfig>} */
  #config;

  /** @type {HealthState} */
  #state = STATE.IDLE;

  /** @type {number|null} */
  #targetPid = null;

  /** @type {ReturnType<typeof setInterval>[]} */
  #timers = [];

  /** @type {Worker|null} */
  #worker = null;

  /** @type {number} */
  #consecutiveLagCount = 0;

  /** @type {number[]} */
  #cpuWindow = [];

  /** @type {(pid: number) => number} */
  #sampleCpu;

  /** @type {(script: string, pid: number, killMs: number) => Worker} */
  #createWorker;

  /**
   * Create a new HealthMonitor.
   *
   * @param {HealthMonitorConfig} [config] - Configuration options.
   */
  constructor(config = {}) {
    this.#config = { ...DEFAULTS, ...config };
    this.#sampleCpu = config.sampleCpu ?? defaultSampleCpu;
    this.#createWorker = config.createWorker ?? defaultCreateWorker;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Start monitoring the target process.
   *
   * Transitions: IDLE → STARTING → RUNNING.
   *
   * @param {number} targetPid - PID of the process to monitor.
   * @throws {Error} If already running or pid is invalid.
   */
  start(targetPid) {
    if (this.#state !== STATE.IDLE) {
      throw new Error(`HealthMonitor: cannot start in state "${this.#state}"`);
    }
    if (!Number.isInteger(targetPid) || targetPid <= 0) {
      throw new Error(`HealthMonitor: invalid PID ${targetPid}`);
    }

    this.#state = STATE.STARTING;
    this.#targetPid = targetPid;
    this.#consecutiveLagCount = 0;
    this.#cpuWindow = [];

    this.#startSoftWatchdog();
    this.#startCpuWatchdog();
    this.#startHardWatchdog();

    this.#state = STATE.RUNNING;
  }

  /**
   * Stop monitoring and tear down all timers and the worker thread.
   *
   * Transitions: RUNNING|DEGRADED → STOPPING → IDLE.
   * Calling stop() when already IDLE is a silent no-op.
   */
  stop() {
    if (this.#state === STATE.IDLE) return;

    this.#state = STATE.STOPPING;
    this.#cleanup();
    this.#targetPid = null;
    this.#state = STATE.IDLE;
  }

  /**
   * Get the current health status snapshot.
   *
   * @returns {HealthStatus} Current state and metrics.
   */
  getStatus() {
    return {
      state: this.#state,
      targetPid: this.#targetPid,
      consecutiveLagCount: this.#consecutiveLagCount,
      cpuWindow: [...this.#cpuWindow],
    };
  }

  // -----------------------------------------------------------------------
  // Soft Watchdog — event loop lag detection
  // -----------------------------------------------------------------------

  /**
   * Start the soft watchdog timer.
   *
   * Each tick schedules a setImmediate callback and measures how long it
   * actually takes to fire. If the delay exceeds lagThreshold, the
   * consecutive counter increments. After consecutiveLagCount consecutive
   * violations, the state transitions to DEGRADED and onLagDetected fires.
   */
  #startSoftWatchdog() {
    const interval = setInterval(() => {
      const start = process.hrtime();
      setImmediate(() => {
        const [sec, nano] = process.hrtime(start);
        const lagMs = sec * 1000 + nano / 1e6;

        if (lagMs > this.#config.lagThreshold) {
          this.#consecutiveLagCount++;
          if (this.#consecutiveLagCount >= this.#config.consecutiveLagCount) {
            this.#transitionToDegraded();
            this.#config.onLagDetected?.(lagMs, this.#consecutiveLagCount);
          }
        } else {
          this.#consecutiveLagCount = 0;
        }
      });
    }, this.#config.checkInterval);

    this.#timers.push(interval);
  }

  // -----------------------------------------------------------------------
  // CPU Watchdog — busy-loop detection
  // -----------------------------------------------------------------------

  /**
   * Start the CPU watchdog timer.
   *
   * Each tick samples the target process CPU usage and appends it to a
   * sliding window. If cpuThresholdCount or more samples in the window
   * exceed cpuThreshold, the state transitions to DEGRADED and onCpuBusy fires.
   */
  #startCpuWatchdog() {
    const interval = setInterval(() => {
      if (this.#targetPid === null) return;

      const cpu = this.#sampleCpu(this.#targetPid);
      this.#cpuWindow.push(cpu);

      // Maintain sliding window size.
      while (this.#cpuWindow.length > this.#config.cpuWindowSize) {
        this.#cpuWindow.shift();
      }

      // Count samples exceeding threshold.
      if (this.#cpuWindow.length >= this.#config.cpuThresholdCount) {
        const overCount = this.#cpuWindow.filter((v) => v >= this.#config.cpuThreshold).length;
        if (overCount >= this.#config.cpuThresholdCount) {
          this.#transitionToDegraded();
          this.#config.onCpuBusy?.(cpu, overCount);
        }
      }
    }, this.#config.checkInterval);

    this.#timers.push(interval);
  }

  // -----------------------------------------------------------------------
  // Hard Watchdog — worker-thread heartbeat monitor
  // -----------------------------------------------------------------------

  /**
   * Start the hard watchdog worker thread and heartbeat sender.
   *
   * The worker independently monitors the last heartbeat. If hardKillMs
   * pass without a heartbeat, the worker sends SIGKILL to the target PID
   * and posts a 'killed' message back to the main thread.
   */
  #startHardWatchdog() {
    this.#worker = this.#createWorker(WORKER_SCRIPT, this.#targetPid ?? 0, this.#config.hardKillMs);

    this.#worker.on('message', (msg) => {
      if (msg?.type === 'killed') {
        this.#state = STATE.KILLED;
        this.#cleanup();
      }
    });

    // Configure the worker with target PID and kill timeout.
    this.#worker.postMessage({
      type: 'config',
      hardKillMs: this.#config.hardKillMs,
      targetPid: this.#targetPid,
    });

    // Send heartbeats at regular intervals.
    const heartbeat = setInterval(() => {
      this.#worker?.postMessage({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL);

    this.#timers.push(heartbeat);
  }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  /**
   * Transition from RUNNING to DEGRADED.
   * No-op if already DEGRADED or KILLED.
   */
  #transitionToDegraded() {
    if (this.#state === STATE.RUNNING) {
      this.#state = STATE.DEGRADED;
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Clear all timers and terminate the worker thread.
   */
  #cleanup() {
    for (const timer of this.#timers) {
      clearInterval(timer);
    }
    this.#timers = [];

    if (this.#worker) {
      this.#worker.postMessage({ type: 'stop' });
      this.#worker = null;
    }
  }
}

export default HealthMonitor;
