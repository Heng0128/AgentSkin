// SPDX-License-Identifier: MPL-2.0

/**
 * # PerformanceLogger
 *
 * In-memory singleton that stores completed {@link ThemeApplyTrace} records
 * in a ring buffer and computes aggregate statistics. Consumed by the
 * Diagnostics UI tab (renderer) via `performance:get` IPC.
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

/** Aggregate statistics derived from the stored trace history. */
export interface PerformanceStats {
  /** Number of completed apply operations currently stored. */
  totalApplies: number;
  /** Mean total duration (ms) across all stored traces. */
  avgDurationMs: number;
  /** Per-agent average duration (ms). Keyed by agent id. */
  perAgentAvg: Record<string, number>;
}

/** Response payload returned to the renderer. */
export interface PerformanceHistoryResponse {
  /** Most-recent-first traces, up to `count` entries. */
  recent: ThemeApplyTrace[];
  /** Aggregate statistics. */
  stats: PerformanceStats;
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
}

function createPerformanceLogger(): PerformanceLoggerApi {
  let buffer: ThemeApplyTrace[] = [];

  // --- IPC timeout ring buffer ---
  let timeouts: IpcTimeoutEvent[] = [];
  let timeoutSeq = 0;

  function getRecent(count: number): ThemeApplyTrace[] {
    const n = Math.max(0, Math.min(count, buffer.length));
    return buffer.slice(-n).reverse();
  }

  function getStats(): PerformanceStats {
    const totalApplies = buffer.length;

    if (totalApplies === 0) {
      return { totalApplies: 0, avgDurationMs: 0, perAgentAvg: {} };
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
    };
  }

  return {
    log(trace: ThemeApplyTrace): void {
      buffer.push(trace);
      if (buffer.length > MAX_HISTORY) {
        buffer.shift();
      }
    },
    getRecent,
    getStats,
    getHistory(count: number): PerformanceHistoryResponse {
      return { recent: getRecent(count), stats: getStats() };
    },
    clear(): void {
      buffer = [];
      timeouts = [];
      timeoutSeq = 0;
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
      return timeouts.slice(-count);
    },
    getAllTimeouts(): IpcTimeoutEvent[] {
      return [...timeouts];
    },
    clearTimeouts(): void {
      timeouts = [];
      timeoutSeq = 0;
    },
  };
}

/** Module-level singleton — one buffer for the process lifetime. */
export const performanceLogger: PerformanceLoggerApi = createPerformanceLogger();
