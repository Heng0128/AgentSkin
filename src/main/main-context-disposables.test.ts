// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 不 import main.ts（顶层会 boot electron）。只 import main-context。
import { ctx, drainDisposables, registerDisposable } from './main-context';

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
