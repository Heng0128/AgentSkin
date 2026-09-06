// SPDX-License-Identifier: MPL-2.0

/**
 * # watchdog — CDP Injection Process Guardian
 *
 * Detects and recovers from agent crashes that would otherwise leave orphaned
 * processes leaking resources. Consolidates the previous watchdog and hard-watchdog
 * modules.
 *
 * Two watchdog strategies:
 *   1. **Soft watchdog** (Watchdog class) — Three-layer escalation: CPU lag
 *      detection → orphan timeout → force-kill. Uses main-thread timers.
 *   2. **Hard watchdog** (HardWatchdog class) — Worker-thread heartbeat monitor
 *      immune to main-thread busy-loops. Spawns a worker that force-kills the
 *      process if heartbeats stop arriving.
 */

import { mainDebug, mainWarn } from '../logger';

// =============================================================================
// Section 1: Soft Watchdog (Three-Layer Escalation)
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WatchdogConfig {
  /** Layer 1: CPU sampling interval (ms). */
  cpuCheckIntervalMs: number;
  /** Layer 1: CPU usage threshold (percentage, 0-100). */
  cpuThresholdPercent: number;
  /** Layer 1: consecutive over-threshold samples before soft alert fires. */
  cpuConsecutiveThreshold: number;
  /** Layer 2: time (ms) an orphan may outlive its parent before escalation. */
  orphanTimeoutMs: number;
  /** Layer 3: signal sent to force-kill the orphan. */
  killSignal: NodeJS.Signals;
}

export type WatchdogLayer = 'idle' | 'soft' | 'orphan' | 'killed';

export interface WatchdogStatus {
  pid: number;
  layer: WatchdogLayer;
  /** Number of consecutive CPU over-threshold samples (Layer 1). */
  cpuOverCount: number;
  /** Whether the parent process was detected as dead (Layer 2). */
  parentDead: boolean;
  /** Timestamp (ms) when the parent was first observed dead. */
  orphanSince: number | null;
}

/** Side-effecting operations, injected for testability. */
export interface WatchdogDeps {
  /** Returns CPU usage percentage (0-100) for the given pid, or null if unknown. */
  getCpuUsage: (pid: number) => Promise<number | null>;
  /** Returns true if the given pid is still alive. */
  isProcessAlive: (pid: number) => boolean;
  /** Send a signal to the target pid. */
  sendSignal: (pid: number, signal: NodeJS.Signals) => void;
  /** Clean up resources associated with the target pid. */
  cleanupResources: (pid: number) => Promise<void>;
  /** Sleep helper (overridable for tests). */
  sleep: (ms: number) => Promise<void>;
  /** Current time provider (overridable for tests). */
  now: () => number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  cpuCheckIntervalMs: 2000,
  cpuThresholdPercent: 80,
  cpuConsecutiveThreshold: 3,
  orphanTimeoutMs: 10_000,
  killSignal: 'SIGKILL',
};

const SOFT_WATCHDOG_SCOPE = 'watchdog';

// ---------------------------------------------------------------------------
// Internal state per watched pid
// ---------------------------------------------------------------------------

interface WatchEntry {
  pid: number;
  ppid: number;
  config: WatchdogConfig;
  deps: WatchdogDeps;
  status: WatchdogStatus;
  cpuTimer: ReturnType<typeof setInterval> | null;
  orphanTimer: ReturnType<typeof setTimeout> | null;
  /** Set to true when the entry is being torn down (guards against races). */
  disposed: boolean;
}

// ---------------------------------------------------------------------------
// Default production dependencies
// ---------------------------------------------------------------------------

let lastCpuSample: NodeJS.CpuUsage | null = null;
let lastCpuSampleTime = 0;

async function defaultGetCpuUsage(_pid: number): Promise<number | null> {
  try {
    const now = Date.now();
    const usage = process.cpuUsage();

    if (lastCpuSample !== null && lastCpuSampleTime > 0) {
      const elapsedMs = now - lastCpuSampleTime;
      if (elapsedMs > 0) {
        const userDeltaMs = (usage.user - lastCpuSample.user) / 1000;
        const systemDeltaMs = (usage.system - lastCpuSample.system) / 1000;
        const totalDeltaMs = userDeltaMs + systemDeltaMs;
        const cpuPercent = (totalDeltaMs / elapsedMs) * 100;
        lastCpuSample = usage;
        lastCpuSampleTime = now;
        return Math.max(0, cpuPercent);
      }
    }

    // First call or zero elapsed — store baseline, return null (no delta yet).
    lastCpuSample = usage;
    lastCpuSampleTime = now;
    return null;
  } catch {
    return null;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultSendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already dead — ignore
  }
}

async function defaultCleanupResources(_pid: number): Promise<void> {
  // No-op in production; platform-specific cleanup can be injected by the caller.
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultNow(): number {
  return Date.now();
}

export const DEFAULT_WATCHDOG_DEPS: WatchdogDeps = {
  getCpuUsage: defaultGetCpuUsage,
  isProcessAlive: defaultIsProcessAlive,
  sendSignal: defaultSendSignal,
  cleanupResources: defaultCleanupResources,
  sleep: defaultSleep,
  now: defaultNow,
};

// ---------------------------------------------------------------------------
// Watchdog class
// ---------------------------------------------------------------------------

export class Watchdog {
  private readonly entries = new Map<number, WatchEntry>();
  private readonly baseDeps: WatchdogDeps;

  /** @param baseDeps — override production side-effects (per-call deps take precedence). */
  constructor(baseDeps: Partial<WatchdogDeps> = {}) {
    this.baseDeps = { ...DEFAULT_WATCHDOG_DEPS, ...baseDeps };
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Begin monitoring `pid`. If `ppid` is provided, orphan detection watches
   * that parent; otherwise the current process's parent is used.
   */
  watch(pid: number, config: Partial<WatchdogConfig> = {}, ppid?: number): void {
    if (pid <= 0) {
      mainWarn(SOFT_WATCHDOG_SCOPE, `watch() called with invalid pid=${pid} — ignored`);
      return;
    }
    const fullConfig: WatchdogConfig = { ...DEFAULT_WATCHDOG_CONFIG, ...config };
    const existing = this.entries.get(pid);
    if (existing) {
      // Refresh config, keep running timers.
      existing.config = fullConfig;
      if (ppid !== undefined) existing.ppid = ppid;
      return;
    }
    const entry: WatchEntry = {
      pid,
      ppid: ppid ?? process.ppid,
      config: fullConfig,
      deps: this.baseDeps,
      status: {
        pid,
        layer: 'idle',
        cpuOverCount: 0,
        parentDead: false,
        orphanSince: null,
      },
      cpuTimer: null,
      orphanTimer: null,
      disposed: false,
    };
    this.entries.set(pid, entry);
    this.startCpuMonitor(entry);
  }

  /** Stop monitoring `pid` and tear down its timers. Idempotent. */
  unwatch(pid: number): void {
    const entry = this.entries.get(pid);
    if (!entry) return;
    this.teardown(entry);
    this.entries.delete(pid);
  }

  /** Return a snapshot of the current status for `pid`, or undefined if not watched. */
  getStatus(pid: number): WatchdogStatus | undefined {
    const entry = this.entries.get(pid);
    if (!entry) return undefined;
    return { ...entry.status };
  }

  /** Manually trigger the full cleanup pipeline for `pid`: force-kill → cleanup → teardown. */
  async cleanup(pid: number): Promise<void> {
    const entry = this.entries.get(pid);
    if (!entry) return;
    await this.forceKill(entry);
    this.teardown(entry);
    this.entries.delete(pid);
  }

  /** Stop all monitors and clean up every watched process. */
  async stopAll(): Promise<void> {
    const pids = Array.from(this.entries.keys());
    for (const pid of pids) {
      await this.cleanup(pid);
    }
  }

  // -- Layer 1: CPU lag detection ------------------------------------------

  private startCpuMonitor(entry: WatchEntry): void {
    if (entry.cpuTimer) clearInterval(entry.cpuTimer);
    entry.cpuTimer = setInterval(() => {
      void this.checkCpu(entry);
    }, entry.config.cpuCheckIntervalMs);
  }

  private async checkCpu(entry: WatchEntry): Promise<void> {
    if (entry.disposed) return;
    const { pid, config, deps } = entry;
    const usage = await deps.getCpuUsage(pid);
    if (usage === null) return; // cannot measure — skip this cycle
    if (usage > config.cpuThresholdPercent) {
      entry.status.cpuOverCount++;
      if (entry.status.cpuOverCount >= config.cpuConsecutiveThreshold) {
        entry.status.layer = 'soft';
        mainWarn(
          SOFT_WATCHDOG_SCOPE,
          `Layer 1 (soft): pid=${pid} CPU ${usage}% > ${config.cpuThresholdPercent}% ` +
            `for ${entry.status.cpuOverCount} consecutive samples`,
        );
      }
    } else {
      entry.status.cpuOverCount = 0;
      if (entry.status.layer === 'soft') entry.status.layer = 'idle';
    }
  }

  // -- Layer 2: Orphan timeout ---------------------------------------------

  /**
   * Check whether the parent process is still alive. Called by the consumer
   * on its own schedule, or internally via a background poll.
   */
  checkParent(entry: WatchEntry): void {
    if (entry.disposed) return;
    const { ppid, deps } = entry;
    if (deps.isProcessAlive(ppid)) {
      // Parent alive — reset orphan state if previously flagged.
      if (entry.status.parentDead) {
        entry.status.parentDead = false;
        entry.status.orphanSince = null;
        if (entry.status.layer === 'orphan') entry.status.layer = 'idle';
        if (entry.orphanTimer) {
          clearTimeout(entry.orphanTimer);
          entry.orphanTimer = null;
        }
      }
      return;
    }
    // Parent dead.
    if (!entry.status.parentDead) {
      entry.status.parentDead = true;
      entry.status.orphanSince = deps.now();
      entry.status.layer = 'orphan';
      mainWarn(
        SOFT_WATCHDOG_SCOPE,
        `Layer 2 (orphan): pid=${entry.pid} parent=${ppid} died — orphan timeout started`,
      );
    }
    if (entry.orphanTimer) return; // already counting down
    entry.orphanTimer = setTimeout(() => {
      void this.handleOrphanTimeout(entry);
    }, entry.config.orphanTimeoutMs);
  }

  private async handleOrphanTimeout(entry: WatchEntry): Promise<void> {
    if (entry.disposed) return;
    entry.orphanTimer = null;
    // Re-check: parent may have been resurrected (e.g. new init re-parented).
    if (entry.deps.isProcessAlive(entry.ppid)) {
      entry.status.parentDead = false;
      entry.status.orphanSince = null;
      if (entry.status.layer === 'orphan') entry.status.layer = 'idle';
      return;
    }
    mainWarn(
      SOFT_WATCHDOG_SCOPE,
      `Layer 2 (orphan): pid=${entry.pid} outlived parent by ${entry.config.orphanTimeoutMs}ms — escalating to Layer 3`,
    );
    await this.forceKill(entry);
  }

  // -- Layer 3: Force kill --------------------------------------------------

  private async forceKill(entry: WatchEntry): Promise<void> {
    if (entry.disposed) return;
    const { pid, config, deps } = entry;
    entry.status.layer = 'killed';
    try {
      deps.sendSignal(pid, config.killSignal);
    } catch (error) {
      mainWarn(
        SOFT_WATCHDOG_SCOPE,
        `Layer 3 (hard): sendSignal pid=${pid} failed: ${String(error)}`,
      );
    }
    try {
      await deps.cleanupResources(pid);
    } catch (error) {
      mainWarn(
        SOFT_WATCHDOG_SCOPE,
        `Layer 3 (hard): cleanupResources pid=${pid} failed: ${String(error)}`,
      );
    }
    mainWarn(
      SOFT_WATCHDOG_SCOPE,
      `Layer 3 (hard): pid=${pid} terminated with ${config.killSignal}`,
    );
  }

  // -- Teardown -------------------------------------------------------------

  private teardown(entry: WatchEntry): void {
    entry.disposed = true;
    if (entry.cpuTimer) {
      clearInterval(entry.cpuTimer);
      entry.cpuTimer = null;
    }
    if (entry.orphanTimer) {
      clearTimeout(entry.orphanTimer);
      entry.orphanTimer = null;
    }
  }
}

// =============================================================================
// Section 2: Hard Watchdog (Worker Thread Heartbeat)
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HardWatchdogConfig {
  /**
   * Time (ms) after which the worker kills the process if no heartbeat
   * is received. Default: 60_000 (60 seconds).
   */
  timeoutMs: number;
  /**
   * How often (ms) the worker checks the last heartbeat timestamp.
   * Default: 1_000 (1 second).
   */
  checkIntervalMs: number;
  /**
   * Signal sent to the process when the watchdog fires. Default: 'SIGKILL'.
   */
  killSignal: NodeJS.Signals;
}

export const DEFAULT_HARD_WATCHDOG_CONFIG: HardWatchdogConfig = {
  timeoutMs: 60_000,
  checkIntervalMs: 1_000,
  killSignal: 'SIGKILL',
};

/**
 * Side-effecting operations injected for testability.
 */
export interface HardWatchdogDeps {
  /** Create a new Worker thread with the given source code. */
  createWorker: (source: string) => WorkerLike;
  /** Send a heartbeat (overridable for tests). */
  beatFn: () => void;
  /** Clear an interval timer. */
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
  /** Set a recurring interval timer. */
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Current timestamp provider. */
  now: () => number;
}

/**
 * Minimal Worker interface — only what we use.
 */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
}

// ---------------------------------------------------------------------------
// Worker thread source
// ---------------------------------------------------------------------------

/**
 * Worker thread source code as a string. The worker:
 * 1. Receives heartbeat timestamps via postMessage
 * 2. Periodically checks if the last heartbeat is within timeout
 * 3. If timeout exceeded, kills the process
 */
function createWorkerSource(): string {
  return `
    const { parentPort } = require('node:worker_threads');

    let lastBeat = Date.now();
    let timeoutMs = 60000;
    let checkIntervalMs = 1000;
    let checkTimer = null;

    function check() {
      const now = Date.now();
      if (now - lastBeat > timeoutMs) {
        // Main thread is stuck — kill the process
        process.kill(process.pid, 'SIGKILL');
      }
    }

    parentPort.on('message', (msg) => {
      if (msg.type === 'beat') {
        lastBeat = msg.timestamp;
      } else if (msg.type === 'config') {
        timeoutMs = msg.timeoutMs;
        checkIntervalMs = msg.checkIntervalMs;
        if (checkTimer) clearInterval(checkTimer);
        checkTimer = setInterval(check, checkIntervalMs);
        // Don't let the worker keep the process alive
        checkTimer.unref();
      } else if (msg.type === 'stop') {
        if (checkTimer) clearInterval(checkTimer);
        checkTimer = null;
      }
    });
  `;
}

// ---------------------------------------------------------------------------
// Default production dependencies
// ---------------------------------------------------------------------------

function defaultCreateWorker(source: string): WorkerLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Worker } = require('node:worker_threads') as typeof import('node:worker_threads');
  return new Worker(source, { eval: true });
}

export const DEFAULT_HARD_WATCHDOG_DEPS: HardWatchdogDeps = {
  createWorker: defaultCreateWorker,
  beatFn: () => {},
  clearInterval: (timer) => clearInterval(timer),
  setInterval: (fn, ms) => setInterval(fn, ms),
  now: () => Date.now(),
};

// ---------------------------------------------------------------------------
// HardWatchdog class
// ---------------------------------------------------------------------------

export class HardWatchdog {
  private readonly config: HardWatchdogConfig;
  private readonly deps: HardWatchdogDeps;
  private worker: WorkerLike | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<HardWatchdogConfig> = {}, deps: Partial<HardWatchdogDeps> = {}) {
    this.config = { ...DEFAULT_HARD_WATCHDOG_CONFIG, ...config };
    this.deps = { ...DEFAULT_HARD_WATCHDOG_DEPS, ...deps };
  }

  /**
   * Start the hard watchdog. Spawns a worker thread and begins sending
   * periodic heartbeats.
   */
  start(): void {
    if (this.worker) return; // already running

    const source = createWorkerSource();
    this.worker = this.deps.createWorker(source);

    // Send config to worker
    this.worker.postMessage({
      type: 'config',
      timeoutMs: this.config.timeoutMs,
      checkIntervalMs: this.config.checkIntervalMs,
    });

    // Start sending heartbeats (every timeoutMs / 4 to ensure we beat
    // the timeout even with some jitter)
    const beatInterval = Math.max(1000, Math.floor(this.config.timeoutMs / 4));
    this.heartbeatTimer = this.deps.setInterval(() => {
      this.beat();
    }, beatInterval);
    // Don't let the heartbeat timer keep the process alive
    if (
      typeof this.heartbeatTimer === 'object' &&
      this.heartbeatTimer &&
      'unref' in this.heartbeatTimer
    ) {
      (this.heartbeatTimer as NodeJS.Timeout).unref();
    }

    mainDebug(
      'hard-watchdog',
      `started (timeout=${this.config.timeoutMs}ms, beat=${beatInterval}ms)`,
    );
  }

  /**
   * Send a heartbeat to the worker thread. Call this periodically from
   * your main loop to indicate the process is still alive and responsive.
   */
  beat(): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'beat', timestamp: this.deps.now() });
  }

  /**
   * Stop the hard watchdog. Terminates the worker thread and clears timers.
   */
  stop(): void {
    if (this.heartbeatTimer) {
      this.deps.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      void this.worker.terminate();
      this.worker = null;
    }
    mainDebug('hard-watchdog', 'stopped');
  }

  /**
   * Returns true if the watchdog is currently running.
   */
  isRunning(): boolean {
    return this.worker !== null;
  }
}
