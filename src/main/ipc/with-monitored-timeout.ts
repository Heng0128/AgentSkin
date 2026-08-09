// SPDX-License-Identifier: MPL-2.0

/**
 * # withMonitoredTimeout
 *
 * Drop-in wrapper around {@link withTimeout} that records timeout events to the
 * PerformanceLogger before propagating the rejection. This gives the Diagnostics
 * UI visibility into which IPC channels are timing out and how often.
 *
 * ## Design
 *
 * - Delegates all timeout logic to `withTimeout()` (single source of truth).
 * - Uses optional-chain (`logTimeout?.()`) because `logTimeout` does not yet
 *   exist on `PerformanceLoggerApi` — avoids a hard dependency on the
 *   performance-logger refactor landing first.
 * - Re-throws the original reason so callers see no behaviour change.
 */

import { isIpcTimeoutError, withTimeout } from '../../shared/withTimeout';
import { performanceLogger } from '../services/performance';

/**
 * Wrap `promise` with a timeout and record timeout events to the performance logger.
 *
 * @param channel  IPC channel name — passed through to `withTimeout`.
 * @param ms       Timeout in milliseconds. Values `<= 0` disable the timeout.
 * @param promise  The actual asynchronous work (already invoked).
 * @param signal   Optional external abort signal.
 * @returns        A promise that resolves with `T` or rejects with a
 *                 {@link SerializedIpcTimeoutError} (or the original error).
 */
export function withMonitoredTimeout<T>(
  channel: string,
  ms: number,
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withTimeout(channel, ms, promise, signal).catch((reason) => {
    if (isIpcTimeoutError(reason)) {
      // `logTimeout` will be added to PerformanceLoggerApi in a follow-up.
      // Optional chaining keeps us compilable until then.
      (performanceLogger as { logTimeout?: (event: PerfTimeoutEvent) => void }).logTimeout?.({
        channel: reason.channel,
        ms: reason.ms,
        timestamp: Date.now(),
      });
    }
    throw reason; // continue propagating
  });
}

/** Minimal shape of a recorded timeout event. */
export interface PerfTimeoutEvent {
  channel: string;
  ms: number;
  timestamp: number;
}
