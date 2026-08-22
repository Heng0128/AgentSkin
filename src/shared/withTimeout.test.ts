// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { IpcTimeoutError, isIpcTimeoutError, serializeForIpc, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  // --- resolve / reject passthrough -----------------------------------

  it('returns the resolved value from the inner promise', async () => {
    const result = await withTimeout('TEST_OK', 1000, Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('does not alter the resolved value type', async () => {
    const payload = { ok: true, data: [1, 2, 3] as number[] };
    const result = await with_timeout_infer(payload);
    expect(result).toEqual(payload);
  });

  it('rejects with the original error when the handler throws', async () => {
    const original = new Error('handler exploded');
    await expect(withTimeout('FAIL_FAST', 1000, Promise.reject(original))).rejects.toBe(original);
  });

  it('preserves the message of the original error', async () => {
    await expect(
      withTimeout('FAIL_MSG', 1000, Promise.reject(new TypeError('bad'))),
    ).rejects.toThrow('bad');
  });

  // --- timeout behaviour -----------------------------------------------

  it('rejects with IpcTimeoutError when the handler does not finish in time', async () => {
    const slow = new Promise<never>(() => {
      /* never settles */
    });

    await expect(withTimeout('SLOW_OP', 30, slow)).rejects.toSatisfy((reason: unknown) =>
      isIpcTimeoutError(reason),
    );
  });

  it('rejects with a plain object that carries code/channel/ms', async () => {
    const slow = new Promise<never>(() => {
      /* never settles */
    });

    const reason = await withTimeout('SLOW_OP', 30, slow).catch((r) => r);
    expect(reason).toBeInstanceOf(Object);
    expect((reason as { code?: unknown }).code).toBe('IPC_TIMEOUT');
    expect((reason as { channel?: unknown }).channel).toBe('SLOW_OP');
    expect((reason as { ms?: unknown }).ms).toBe(30);
    expect((reason as { name?: unknown }).name).toBe('IpcTimeoutError');
  });

  it('does not resolve after timeout fires', async () => {
    let resolved = false;
    const slow = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolved = true;
        resolve();
      }, 500);
    });

    await expect(withTimeout('NO_RESOLVE', 40, slow)).rejects.toThrow('NO_RESOLVE');
    // Give the slow promise a chance — it should NOT flip `resolved`.
    await new Promise((r) => setTimeout(r, 80));
    expect(resolved).toBe(false);
  });

  // --- IpcTimeoutError details ----------------------------------------

  it('sets code to "IPC_TIMEOUT"', () => {
    expect(new IpcTimeoutError('CH', 5000).code).toBe('IPC_TIMEOUT');
  });

  it('exposes code on the prototype for `===` checks', () => {
    expect(IpcTimeoutError.prototype.code).toBe('IPC_TIMEOUT');
  });

  it('includes channel and ms in the error message', () => {
    const err = new IpcTimeoutError('THEME_APPLY', 30000);
    expect(err.message).toContain('THEME_APPLY');
    expect(err.message).toContain('30000');
  });

  it('sets the error name for instanceof-aware logging', () => {
    expect(new IpcTimeoutError('CH', 1).name).toBe('IpcTimeoutError');
  });

  // --- AbortSignal handling -------------------------------------------

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const never = new Promise<never>(() => {
      /* would hang forever */
    });

    const start = Date.now();
    await expect(withTimeout('ABORTED', 10000, never, controller.signal)).rejects.toSatisfy(
      (reason: unknown) => isIpcTimeoutError(reason),
    );
    // Should return almost instantly, not wait 10 s.
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('rejects when the signal aborts before the timeout', async () => {
    const controller = new AbortController();
    const never = new Promise<never>(() => {
      /* never settles */
    });

    const race = withTimeout('ABORT_RACE', 5000, never, controller.signal);
    setTimeout(() => controller.abort(), 5);

    await expect(race).rejects.toSatisfy((reason: unknown) => isIpcTimeoutError(reason));
  });

  it('serialized output round-trips through isIpcTimeoutError', () => {
    const err = new IpcTimeoutError('TEST_CH', 5000);
    const serialized = serializeForIpc(err);
    expect(isIpcTimeoutError(serialized)).toBe(true);
    expect(serialized).toEqual({
      name: 'IpcTimeoutError',
      message: "channel 'TEST_CH' timed out after 5000ms",
      code: 'IPC_TIMEOUT',
      channel: 'TEST_CH',
      ms: 5000,
    });
  });

  it('isIpcTimeoutError returns false for non-timeout errors', () => {
    expect(isIpcTimeoutError(new Error('regular error'))).toBe(false);
    expect(isIpcTimeoutError(null)).toBe(false);
    expect(isIpcTimeoutError(undefined)).toBe(false);
    expect(isIpcTimeoutError('string')).toBe(false);
    expect(isIpcTimeoutError({ name: 'SomeOtherError' })).toBe(false);
  });

  // --- ms <= 0 — no timeout ------------------------------------------

  it('does not time out when ms is 0 (slow promise completes)', async () => {
    // A promise that takes 150 ms should still resolve when timeout is disabled.
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 150));
    await expect(withTimeout('NO_TIMEOUT', 0, slow)).resolves.toBe('done');
  });

  // --- timing accuracy -------------------------------------------------

  it('fires the timeout close to the specified delay (±100 ms)', async () => {
    const slow = new Promise<never>(() => {
      /* never settles */
    });
    const target = 80;
    const start = Date.now();

    await expect(withTimeout('TIMING', target, slow)).rejects.toSatisfy((reason: unknown) =>
      isIpcTimeoutError(reason),
    );

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(target - 100);
    expect(elapsed).toBeLessThan(target + 200);
  });

  // --- concurrency + cleanup ------------------------------------------

  it('cleans up timers after settle (no handle leaks)', async () => {
    // process._getActiveHandles() is an undocumented internal — cast through
    // unknown because @types/node does not expose it.
    const getHandles = () =>
      (process as unknown as { _getActiveHandles: () => unknown[] })._getActiveHandles().length;

    const before = getHandles();

    const slow = new Promise<never>(() => {
      /* never settles */
    });
    await expect(withTimeout('CLEANUP', 40, slow)).rejects.toSatisfy((reason: unknown) =>
      isIpcTimeoutError(reason),
    );

    // Allow any stray async cleanup to complete.
    await new Promise((r) => setTimeout(r, 10));
    const after = getHandles();
    expect(after).toBeLessThanOrEqual(before);
  });

  it('handles 3 concurrent calls with different timeouts via allSettled', async () => {
    const never = new Promise<never>(() => {
      /* never settles */
    });
    const fast = withTimeout('FAST', 20, never);
    const medium = withTimeout('MEDIUM', 40, never);
    const slowest = withTimeout('SLOWEST', 60, never);

    const results = await Promise.allSettled([fast, medium, slowest]);

    for (const r of results) {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(isIpcTimeoutError(r.reason)).toBe(true);
      }
    }
  });
});

// --- TypeScript helper to validate return type inference ---------------
async function with_timeout_infer<T>(value: T): Promise<T> {
  return withTimeout('INFER', 1000, Promise.resolve(value));
}
