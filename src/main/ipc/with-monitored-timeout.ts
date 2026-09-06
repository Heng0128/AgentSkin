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
 * - Records timeout events to `performanceLogger.logTimeout()` so the
 *   Diagnostics UI can surface which IPC channels time out and how often.
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
      performanceLogger.logTimeout({
        channel: reason.channel,
        ms: reason.ms,
        timestamp: Date.now(),
      });
    }
    throw reason; // continue propagating
  });
}
