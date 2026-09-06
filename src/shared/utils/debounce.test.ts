// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { createDebounce } from './debounce';

describe('createDebounce', () => {
  it('does not execute immediately (trailing edge)', () => {
    const fn = vi.fn(() => 'result');
    const debouncer = createDebounce<string>(50);

    debouncer.call(fn);

    // Should not have executed yet
    expect(fn).not.toHaveBeenCalled();
    expect(debouncer.isPending()).toBe(true);
  });

  it('executes after delay with trailing edge', async () => {
    const fn = vi.fn(() => 'done');
    const debouncer = createDebounce<string>(20);

    const promise = debouncer.call(fn);
    expect(fn).not.toHaveBeenCalled();

    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple rapid calls into a single execution', async () => {
    const fn = vi.fn(() => 'batched');
    const debouncer = createDebounce<string>(30);

    // Rapid calls — timer resets each time
    const p1 = debouncer.call(fn);
    const p2 = debouncer.call(fn);
    const p3 = debouncer.call(fn);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    // All three promises resolve with the same result
    expect(r1).toBe('batched');
    expect(r2).toBe('batched');
    expect(r3).toBe('batched');
    // Only one actual execution
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses the last provided function for execution', async () => {
    const fn1 = vi.fn(() => 'first');
    const fn2 = vi.fn(() => 'second');
    const debouncer = createDebounce<string>(20);

    const p1 = debouncer.call(fn1);
    const p2 = debouncer.call(fn2);

    const [r1, r2] = await Promise.all([p1, p2]);

    // fn1 should never have been called — debounced away
    expect(fn1).not.toHaveBeenCalled();
    // fn2 is the last one, so it runs
    expect(fn2).toHaveBeenCalledTimes(1);
    // But both promises resolve with fn2's result
    expect(r1).toBe('second');
    expect(r2).toBe('second');
  });

  it('supports async functions', async () => {
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'async-result';
    });
    const debouncer = createDebounce<string>(15);

    const result = await debouncer.call(fn);
    expect(result).toBe('async-result');
  });

  it('propagates errors to all pending promises', async () => {
    const fn = vi.fn(() => {
      throw new Error('boom');
    });
    const debouncer = createDebounce<never>(15);

    const p1 = debouncer.call(fn);
    const p2 = debouncer.call(fn);

    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');
  });

  it('cancel() rejects pending promises and clears the timer', async () => {
    const fn = vi.fn(() => 'should-not-run');
    const debouncer = createDebounce<string>(100);

    const promise = debouncer.call(fn);
    expect(debouncer.isPending()).toBe(true);

    debouncer.cancel();

    expect(debouncer.isPending()).toBe(false);
    await expect(promise).rejects.toThrow('Debounce cancelled');
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush() immediately executes the latest function', async () => {
    const fn = vi.fn(() => 'flushed');
    const debouncer = createDebounce<string>(500);

    const promise = debouncer.call(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(debouncer.isPending()).toBe(true);

    const result = await debouncer.flush();

    expect(result).toBe('flushed');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(debouncer.isPending()).toBe(false);
    // The original promise also resolves
    await expect(promise).resolves.toBe('flushed');
  });

  it('flush() returns undefined when nothing is pending', async () => {
    const debouncer = createDebounce<string>(50);
    const result = await debouncer.flush();
    expect(result).toBeUndefined();
  });

  it('isPending() is false after execution completes', async () => {
    const debouncer = createDebounce<string>(10);
    const promise = debouncer.call(() => 'done');
    expect(debouncer.isPending()).toBe(true);
    await promise;
    expect(debouncer.isPending()).toBe(false);
  });

  it('allows a new cycle after previous execution completes', async () => {
    const debouncer = createDebounce<number>(10);

    const r1 = await debouncer.call(() => 1);
    expect(r1).toBe(1);

    const r2 = await debouncer.call(() => 2);
    expect(r2).toBe(2);
  });

  it('handles a new call after cancel()', async () => {
    const debouncer = createDebounce<string>(10);

    const p1 = debouncer.call(() => 'first');
    debouncer.cancel();
    await expect(p1).rejects.toThrow('Debounce cancelled');

    // Can start a new cycle
    const p2 = debouncer.call(() => 'second');
    await expect(p2).resolves.toBe('second');
  });
});
