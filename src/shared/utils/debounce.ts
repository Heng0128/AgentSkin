// SPDX-License-Identifier: MPL-2.0

/**
 * Debounce primitive for coalescing rapid successive calls into a single
 * trailing-edge execution after a quiet period.
 *
 * Designed for watcher-style scenarios (e.g. health-monitor drift detection)
 * where multiple CSS-variable update events fire in quick succession and
 * should be processed as one batch.
 *
 * @example
 * const debouncer = createDebounce<void>(300);
 *
 * // Rapid calls — only the last one executes after 300ms of quiet
 * debouncer.call(() => checkHealth());
 * debouncer.call(() => checkHealth());
 * debouncer.call(() => checkHealth()); // <-- this one runs
 */

/**
 * Debouncer interface — multiple calls reset the timer, trailing edge fires once.
 *
 * @typeparam T  Return type of the debounced function.
 */
export interface Debouncer<T> {
  /**
   * Schedule `fn` for execution. Resets the delay timer.
   * Returns a promise that resolves with `fn`'s result when it finally runs.
   * All pending promises resolve with the same result from the final execution.
   *
   * @param fn  The function to debounce. May be sync or async.
   */
  call(fn: () => T | Promise<T>): Promise<T>;

  /** Cancel any pending execution and reject all pending promises. */
  cancel(): void;

  /** Immediately execute the latest scheduled function (if any) and clear the timer. */
  flush(): Promise<T | undefined>;

  /** Whether an execution is currently scheduled but not yet fired. */
  isPending(): boolean;
}

interface PendingEntry<T> {
  fn: () => T | Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * Create a debouncer with the specified delay.
 *
 * The debouncer uses a **trailing-edge** strategy: the function only fires
 * after `delayMs` milliseconds of quiet. Every `call()` resets the timer.
 *
 * All `call()` invocations accumulate pending promises. When the timer fires,
 * the last-provided function is executed and ALL pending promises resolve with
 * its result (or reject with its error).
 *
 * @param delayMs  Quiet period in milliseconds before firing.
 * @returns A {@link Debouncer} instance.
 */
export function createDebounce<T>(delayMs: number): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending: PendingEntry<T>[] = [];

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function cancel(): void {
    clearTimer();
    const err = new Error('Debounce cancelled');
    for (const entry of pending) {
      entry.reject(err);
    }
    pending.length = 0;
  }

  async function flush(): Promise<T | undefined> {
    if (pending.length === 0) {
      return undefined;
    }
    clearTimer();
    // Take the last function to execute
    const lastEntry = pending[pending.length - 1];
    const { fn } = lastEntry;
    // Resolve all pending with the result
    const allEntries = [...pending];
    pending.length = 0;

    try {
      const result = await fn();
      for (const entry of allEntries) {
        entry.resolve(result);
      }
      return result;
    } catch (error) {
      for (const entry of allEntries) {
        entry.reject(error);
      }
      throw error;
    }
  }

  return {
    call(fn: () => T | Promise<T>): Promise<T> {
      clearTimer();

      return new Promise<T>((resolve, reject) => {
        pending.push({ fn, resolve, reject });

        timer = setTimeout(async () => {
          timer = null;
          if (pending.length === 0) return;
          const lastEntry = pending[pending.length - 1];
          const { fn: execFn } = lastEntry;
          const allEntries = [...pending];
          pending.length = 0;
          try {
            const result = await execFn();
            for (const entry of allEntries) {
              entry.resolve(result);
            }
          } catch (error) {
            for (const entry of allEntries) {
              entry.reject(error);
            }
          }
        }, delayMs);
      });
    },

    cancel,

    flush,

    isPending(): boolean {
      return timer !== null;
    },
  };
}
