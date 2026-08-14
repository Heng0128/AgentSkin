// SPDX-License-Identifier: MPL-2.0

/**
 * # PerformanceLogger
 *
 * In-memory singleton that stores completed {@link ThemeApplyTrace} records
 * in a ring buffer and computes aggregate statistics. Consumed by the
 * Diagnostics UI tab (renderer) via `performance:get` IPC.
 *
 * It also runs an optional low-frequency main-process memory sampler
 * (`startMemorySampler`/`stopMemorySampler`) that keeps a bounded ring of
 * `process.memoryUsage()` snapshots (heapUsed/rss/external) for trend
 * analysis, exposed to the renderer via `performance:get-memory` IPC.
 *
 * ## Design
 *
 * - Ring buffer of capacity `MAX_HISTORY` (default 50) — oldest entries are
 *   overwritten once full, so memory stays bounded regardless of how long
 *   the app runs.
 *   - Non-blocking writes (`log()` is synchronous and returns void).
 *   - Read methods return defensive copies so the UI can never mutate
 *     internal state.
 *
 * ## Statistics
 *
 * `getStats()` computes:
 *   - `totalApplies`: total completed traces in the buffer.
 *   - `avgDurationMs`: mean total duration across all traces.
 *   - `perAgentAvg`: per-agent average duration (only includes agents
 *     with at least one completed apply).
 *
 * ## Lifetime
 *
 * This module exports a stateful object (`performanceLogger`) that the
 * theme-apply flow feeds via `log()` and the IPC handler reads via
 * `getRecent()`/`getStats()`. The module-level singleton is intentional
 * (a single buffer for the process lifetime) — tests call `clear()` to
 * reset state between cases.
 */

import type { IpcTimeoutEvent, ThemeApplyTrace } from './types';

/** Maximum number of completed traces retained in memory. */
const MAX_HISTORY = 50;

/** Maximum number of IPC timeout events retained in the ring buffer. */
const MAX_TIMEOUTS = 20;

/** Maximum number of main-process memory samples retained (1h @ 30s). */
const MEM_SAMPLE_MAX = 120;

/** Aggregate statistics derived from the stored trace history. */
export interface PerformanceStats {
  /** Number of completed apply operations currently stored. */
  totalApplies: number;
  /** Mean total duration (ms) across all stored traces. */
  avgDurationMs: number;
  /** Per-agent average duration (ms). Keyed by agent id. */
  perAgentAvg: Record<string, number>;
  /** Total number of traces discarded due to ring buffer overflow.
   *  A non-zero value indicates the buffer capacity (MAX_HISTORY) is
   *  being exceeded and older records are being silently dropped. */
  overflowCount: number;
}

/** Response payload returned to the renderer. */
export interface PerformanceHistoryResponse {
  /** Most-recent-first traces, up to `count` entries. */
  recent: ThemeApplyTrace[];
  /** Aggregate statistics. */
  stats: PerformanceStats;
}

/** A single main-process memory sample (all values in bytes). */
export interface MemorySample {
  /** Epoch milliseconds when the sample was taken. */
  ts: number;
  /** `process.memoryUsage().heapUsed`. */
  heapUsed: number;
  /** `process.memoryUsage().rss`. */
  rss: number;
  /** `process.memoryUsage().external`. */
  external: number;
}

/** Stateful handle to the performance ring buffer. */
export interface PerformanceLoggerApi {
  log(trace: ThemeApplyTrace): void;
  getRecent(count: number): ThemeApplyTrace[];
  getStats(): PerformanceStats;
  getHistory(count: number): PerformanceHistoryResponse;
  clear(): void;
  /** Record an IPC handler timeout event into the ring buffer. */
  logTimeout(event: Omit<IpcTimeoutEvent, 'id'>): void;
  /** Return the most recent `count` timeout events (default 10). */
  getRecentTimeouts(count?: number): IpcTimeoutEvent[];
  /** Return all stored timeout events in chronological order. */
  getAllTimeouts(): IpcTimeoutEvent[];
  /** Clear all timeout events and reset the sequence counter. */
  clearTimeouts(): void;
  /** Begin periodic main-process memory sampling. Idempotent: calling again
   *  restarts the timer with the new interval. */
  startMemorySampler(intervalMs?: number): void;
  /** Stop periodic memory sampling. Idempotent: safe to call when not running. */
  stopMemorySampler(): void;
  /** Return a defensive copy of all retained memory samples (oldest first). */
  getMemorySamples(): MemorySample[];
  /** Return the most recent memory sample, or null if none taken yet. */
  getLatestMemory(): MemorySample | null;
  /** Clear all retained memory samples (does not stop the sampler). */
  clearMemorySamples(): void;
}

function createPerformanceLogger(): PerformanceLoggerApi {
  let buffer: ThemeApplyTrace[] = [];
  let traceOverflowCount = 0;
  let overflowWarned = false;

  // --- IPC timeout ring buffer ---
  let timeouts: IpcTimeoutEvent[] = [];
  let timeoutSeq = 0;

  // --- Main-process memory trend ring buffer ---
  let memSamples: MemorySample[] = [];
  let memoryTimer: ReturnType<typeof setInterval> | undefined;

  function sampleMemory(): void {
    const usage = process.memoryUsage();
    memSamples.push({
      ts: Date.now(),
      heapUsed: usage.heapUsed,
      rss: usage.rss,
      external: usage.external,
    });
    if (memSamples.length > MEM_SAMPLE_MAX) {
      memSamples = memSamples.slice(-MEM_SAMPLE_MAX);
    }
  }

  function getRecent(count: number): ThemeApplyTrace[] {
    const n = Math.max(0, Math.min(count, buffer.length));
    return buffer.slice(-n).reverse();
  }

  function getStats(): PerformanceStats {
    const totalApplies = buffer.length;

    if (totalApplies === 0) {
      return {
        totalApplies: 0,
        avgDurationMs: 0,
        perAgentAvg: {},
        overflowCount: traceOverflowCount,
      };
    }

    let totalSum = 0;
    const agentBuckets: Record<string, { sum: number; count: number }> = {};

    for (const tr of buffer) {
      totalSum += tr.duration;
      let bucket = agentBuckets[tr.agentId];
      if (!bucket) {
        bucket = { sum: 0, count: 0 };
        agentBuckets[tr.agentId] = bucket;
      }
      bucket.sum += tr.duration;
      bucket.count += 1;
    }

    const perAgentAvg: Record<string, number> = {};
    for (const [agentId, { sum: agentSum, count: agentCount }] of Object.entries(agentBuckets)) {
      perAgentAvg[agentId] = Math.round(agentSum / agentCount);
    }

    return {
      totalApplies,
      avgDurationMs: Math.round(totalSum / totalApplies),
      perAgentAvg,
      overflowCount: traceOverflowCount,
    };
  }

  return {
    log(trace: ThemeApplyTrace): void {
      buffer.push(trace);
      if (buffer.length > MAX_HISTORY) {
        buffer.shift();
        traceOverflowCount += 1;
        if (!overflowWarned) {
          overflowWarned = true;
          console.warn(
            `[PerformanceLogger] ring buffer overflow: MAX_HISTORY=${MAX_HISTORY} exceeded, ` +
              'oldest trace discarded. Increase MAX_HISTORY or persist traces to disk ' +
              'if historical data retention is required.',
          );
        }
      }
    },
    getRecent,
    getStats,
    getHistory(count: number): PerformanceHistoryResponse {
      return { recent: getRecent(count), stats: getStats() };
    },
    clear(): void {
      buffer = [];
      traceOverflowCount = 0;
      overflowWarned = false;
      timeouts = [];
      timeoutSeq = 0;
      memSamples = [];
      // Halt the memory sampler timer to prevent post-clear interval leaks.
      if (memoryTimer !== undefined) {
        clearInterval(memoryTimer);
        memoryTimer = undefined;
      }
    },
    logTimeout(event: Omit<IpcTimeoutEvent, 'id'>): void {
      timeoutSeq += 1;
      timeouts.push({
        id: `timeout_${String(timeoutSeq).padStart(3, '0')}`,
        ...event,
      });
      if (timeouts.length > MAX_TIMEOUTS) {
        timeouts = timeouts.slice(-MAX_TIMEOUTS);
      }
    },
    getRecentTimeouts(count = 10): IpcTimeoutEvent[] {
      const n = Math.max(0, Math.min(count, timeouts.length));
      return timeouts.slice(-n);
    },
    getAllTimeouts(): IpcTimeoutEvent[] {
      return [...timeouts];
    },
    clearTimeouts(): void {
      timeouts = [];
      timeoutSeq = 0;
    },
    startMemorySampler(intervalMs = 30_000): void {
      // Restart cleanly if already running (idempotent).
      if (memoryTimer !== undefined) clearInterval(memoryTimer);
      sampleMemory(); // capture an immediate baseline sample
      memoryTimer = setInterval(sampleMemory, intervalMs);
      // Don't keep the event loop alive solely for sampling.
      if (typeof memoryTimer.unref === 'function') memoryTimer.unref();
    },
    stopMemorySampler(): void {
      if (memoryTimer !== undefined) {
        clearInterval(memoryTimer);
        memoryTimer = undefined;
      }
    },
    getMemorySamples(): MemorySample[] {
      return [...memSamples];
    },
    getLatestMemory(): MemorySample | null {
      return memSamples.length > 0 ? memSamples[memSamples.length - 1]! : null;
    },
    clearMemorySamples(): void {
      memSamples = [];
    },
  };
}

/** Module-level singleton — one buffer for the process lifetime. */
export const performanceLogger: PerformanceLoggerApi = createPerformanceLogger();
