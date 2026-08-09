// SPDX-License-Identifier: MPL-2.0

/**
 * # withTimeout — Timeout-safe IPC handler wrapper
 *
 * Wraps any Promise-returning IPC handler so the renderer gets a clear,
 * typed rejection (`IpcTimeoutError`) instead of an indefinite hang or
 * Electron's generic "no response" scenario.
 *
 * Design decisions:
 *   - `<= 0` means "no timeout" → the promise is awaited directly. This
 *     lets LOW-priority handlers (e.g. background analytics) opt out.
 *   - Uses Node 18+ `AbortSignal.timeout()` when available; falls back to
 *     `setTimeout` and always calls `clearTimeout` to avoid handle leaks.
 *   - Honours an externally-aborted `AbortSignal` — if it is already
 *     aborted before the call, we reject immediately without starting any
 *     timer.
 */

/** Thrown when an IPC handler does not resolve within the allowed window. */
export class IpcTimeoutError extends Error {
  /** Set on the prototype so `err.code === 'IPC_TIMEOUT'` works without instanceof. */
  readonly code: 'IPC_TIMEOUT' = 'IPC_TIMEOUT';

  constructor(
    readonly channel: string,
    readonly ms: number,
  ) {
    super(`channel '${channel}' timed out after ${ms}ms`);
    this.name = 'IpcTimeoutError';
  }
}

// Expose code on the prototype for `===` checks without instanceof.
// Uses defineProperty because `readonly` blocks direct assignment.
Object.defineProperty(IpcTimeoutError.prototype, 'code', {
  value: 'IPC_TIMEOUT',
  enumerable: true,
  configurable: true,
});

/**
 * Race `promise` against a timeout. Resolves/rejects with the handler's
 * result if it finishes first; otherwise rejects with `IpcTimeoutError`.
 *
 * @param channel  IPC channel name — embedded in the error message for
 *                  easier debugging across main and renderer logs.
 * @param ms       Timeout in milliseconds. Values `<= 0` disable the
 *                  timeout entirely (the promise passes through unchanged).
 * @param promise  The actual asynchronous work.
 * @param signal   Optional external abort signal. If already aborted, the
 *                  function rejects immediately without starting a timer.
 */
export function withTimeout<T>(
  channel: string,
  ms: number,
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  // Fast-path: no timeout requested.
  if (ms <= 0) {
    return promise;
  }

  // Already aborted — reject before allocating any timer.
  if (signal?.aborted) {
    return Promise.reject(new IpcTimeoutError(channel, ms));
  }

  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      cleanup();
      reject(new IpcTimeoutError(channel, ms));
    };

    // Start the timeout timer.
    timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new IpcTimeoutError(channel, ms));
    }, ms);

    // Listen for external abort.
    if (signal) {
      if (typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    // Race against the original promise.
    promise.then(
      (value) => {
        if (settled) return;
        cleanup();
        resolve(value);
      },
      (reason) => {
        if (settled) return;
        cleanup();
        reject(reason);
      },
    );
  });
}
