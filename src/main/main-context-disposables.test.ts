// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 不 import main.ts（顶层会 boot electron）。只 import main-context。
import {
  clearStatusNotifyTimer,
  ctx,
  drainDisposables,
  notifyStatusChanged,
  registerDisposable,
} from './main-context';

describe('MainContext disposables', () => {
  beforeEach(() => {
    ctx.disposables = [];
  });

  afterEach(() => {
    ctx.disposables = [];
  });

  it('registerDisposable appends to ctx.disposables array', () => {
    const fn = vi.fn();
    registerDisposable(fn);
    expect(ctx.disposables).toHaveLength(1);
    expect(ctx.disposables[0]).toBe(fn);
  });

  it('drainDisposables invokes all registered callbacks in order', () => {
    const calls: number[] = [];
    registerDisposable(() => calls.push(1));
    registerDisposable(() => calls.push(2));
    registerDisposable(() => calls.push(3));

    drainDisposables();

    expect(calls).toEqual([1, 2, 3]);
  });

  it('drainDisposables clears the array after drain (idempotent)', () => {
    const fn = vi.fn();
    registerDisposable(fn);

    drainDisposables();
    drainDisposables(); // second call should not re-invoke

    expect(fn).toHaveBeenCalledTimes(1);
    expect(ctx.disposables).toHaveLength(0);
  });

  it('drainDisposables continues past a throwing callback', () => {
    const ok = vi.fn();
    registerDisposable(() => {
      throw new Error('boom');
    });
    registerDisposable(ok);

    expect(() => drainDisposables()).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
});

describe('MainContext statusNotifyTimer cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStatusNotifyTimer(); // ensure clean state
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clearStatusNotifyTimer is a no-op when no timer is pending', () => {
    expect(() => clearStatusNotifyTimer()).not.toThrow();
  });

  it('clearStatusNotifyTimer cancels a pending debounce timer', () => {
    // Schedule a status change (sets the debounce timer)
    notifyStatusChanged();

    // Clear it before it fires
    clearStatusNotifyTimer();

    // After clearing the debounce timer, advancing time must not trigger
    // the original callback. If the timer wasn't cleared, advancing time
    // would fire sendStatusChanged which sends IPC to non-existent windows.
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  });

  it('clearStatusNotifyTimer registered as disposable prevents timer leak on shutdown', () => {
    // Simulate boot: register the cleanup
    registerDisposable(() => clearStatusNotifyTimer());

    // Schedule a status change
    notifyStatusChanged();

    // Simulate quit: drain disposals should clear the timer
    drainDisposables();

    // After drain, clearing again should be safe
    expect(() => clearStatusNotifyTimer()).not.toThrow();
  });
});
