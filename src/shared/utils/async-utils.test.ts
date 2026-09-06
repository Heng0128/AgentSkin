// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { pLimit, TimeoutError, withOperationTimeout } from './async-utils';

describe('withOperationTimeout', () => {
  it('resolves with the value if promise settles before timeout', async () => {
    const result = await withOperationTimeout(Promise.resolve(42), 100, 'test');
    expect(result).toBe(42);
  });

  it('rejects with TimeoutError if promise does not settle in time', async () => {
    const slow = new Promise<void>((resolve) => setTimeout(resolve, 200));
    await expect(withOperationTimeout(slow, 10, 'slow-op')).rejects.toThrow(TimeoutError);
  });

  it('includes label and timeout in error message', async () => {
    const slow = new Promise<void>((resolve) => setTimeout(resolve, 200));
    await expect(withOperationTimeout(slow, 50, 'myOp')).rejects.toThrow(
      '[myOp] timed out after 50ms',
    );
  });

  it('passes through rejection from the original promise', async () => {
    const failing = Promise.reject(new Error('boom'));
    await expect(withOperationTimeout(failing, 100, 'fail')).rejects.toThrow('boom');
  });

  it('returns original promise when timeoutMs <= 0', async () => {
    // No timer should be set when timeoutMs is 0
    const result = await withOperationTimeout(Promise.resolve('ok'), 0, 'no-timeout');
    expect(result).toBe('ok');
  });

  it('clears the timer after early resolution', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    await withOperationTimeout(Promise.resolve('fast'), 5000, 'fast-op');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('pLimit', () => {
  it('runs all tasks and preserves order', async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)];
    const results = await pLimit(tasks, 2);
    expect(results).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;
    const makeTask = (n: number) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n;
    };
    await pLimit([makeTask(1), makeTask(2), makeTask(3), makeTask(4), makeTask(5)], 2);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('handles empty task array', async () => {
    const results = await pLimit([], 3);
    expect(results).toEqual([]);
  });

  it('defaults concurrency to 3', async () => {
    let running = 0;
    let maxRunning = 0;
    const makeTask = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };
    await pLimit([makeTask, makeTask, makeTask, makeTask, makeTask]);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it('uses concurrency of 1 when given invalid value', async () => {
    let running = 0;
    let maxRunning = 0;
    const makeTask = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return true;
    };
    await pLimit([makeTask, makeTask, makeTask], 0);
    expect(maxRunning).toBeLessThanOrEqual(1);
  });
});
