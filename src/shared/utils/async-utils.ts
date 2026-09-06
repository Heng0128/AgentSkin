// SPDX-License-Identifier: MPL-2.0
/**
 * Async utility functions for timeout control and concurrency limiting.
 *
 * Provides zero-dependency primitives for:
 * - withTimeout: Wrap a promise with a timeout that rejects if not settled in time.
 * - pLimit: Run async tasks with a concurrency cap (FIFO queue).
 */

/**
 * Error thrown when `withTimeout` expires before the wrapped promise settles.
 */
export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`[${label}] timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Wrap a promise with a timeout.
 *
 * Returns a new promise that:
 * - Resolves/rejects with the original promise if it settles before `timeoutMs`.
 * - Rejects with `TimeoutError` if the timeout fires first.
 *
 * This is the generic async variant. For IPC channel timeouts, see
 * `withTimeout` in the parent `shared/` directory (which supports AbortSignal).
 *
 * @param promise   The promise to wrap.
 * @param timeoutMs  Maximum time to wait (ms).
 * @param label     Human-readable label for error messages.
 * @returns Promise that settles within `timeoutMs`.
 *
 * @example
 * const result = await withOperationTimeout(fetchData(), 5000, 'fetchData');
 */
export function withOperationTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation',
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run async tasks with a concurrency limit (FIFO ordering).
 *
 * Tasks are started in order until `concurrency` are in flight.
 * When one completes, the next queued task begins.
 *
 * @param tasks        Array of thunks that return promises.
 * @param concurrency  Maximum number of concurrent tasks (default 3).
 * @returns Promise resolving to array of results (preserves input order).
 *
 * @example
 * const results = await pLimit(urls.map(url => () => fetch(url)), 4);
 */
export async function pLimit<T>(tasks: Array<() => Promise<T>>, concurrency = 3): Promise<T[]> {
  if (concurrency <= 0) concurrency = 1;
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
