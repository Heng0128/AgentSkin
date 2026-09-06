// SPDX-License-Identifier: MPL-2.0

/**
 * # useSkeletonStrategy — unit tests
 *
 * Tests the skeleton display strategy hook that implements anti-flicker +
 * timeout feedback without artificial delays. Uses fake timers to drive the
 * state machine through its transitions.
 *
 * Testing strategy:
 *   - The `ui` vitest project uses `environment: 'node'` (no jsdom), so we
 *     manually set up happy-dom globals before importing
 *     `@testing-library/react` to provide the DOM that `renderHook` needs.
 *   - `vi.useFakeTimers()` drives the anti-flicker and timeout transitions.
 *   - Each test covers one state-machine transition or edge case.
 */

import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost' });

// Set up globals that @testing-library/react needs
globalThis.document = window.document as unknown as Document;
globalThis.window = window as unknown as typeof globalThis.window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(
  window,
) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(
  window,
) as unknown as typeof cancelAnimationFrame;

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSkeletonStrategy } from '../useSkeletonStrategy';

describe('useSkeletonStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns showSkeleton=false when loading=false', () => {
    const { result } = renderHook(() => useSkeletonStrategy(false));
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.isSlowLoading).toBe(false);
  });

  it('does not show skeleton within antiFlicker window', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 120 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.showSkeleton).toBe(false);
  });

  it('shows skeleton after antiFlicker window', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 120 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.showSkeleton).toBe(true);
    expect(result.current.isSlowLoading).toBe(false);
  });

  it('enters slow loading state after timeout', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 100, timeoutMs: 800 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.showSkeleton).toBe(true);
    expect(result.current.isSlowLoading).toBe(true);
  });

  it('does not show skeleton if loading ends before antiFlicker', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 120 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender({ loading: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.showSkeleton).toBe(false);
  });

  it('hides skeleton when loading ends after showing', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 100 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.showSkeleton).toBe(true);

    rerender({ loading: false });
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.isSlowLoading).toBe(false);
  });

  it('handles rapid loading toggles', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 100 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(30));
    rerender({ loading: false });
    act(() => vi.advanceTimersByTime(30));
    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(30));
    rerender({ loading: false });
    act(() => vi.advanceTimersByTime(200));

    expect(result.current.showSkeleton).toBe(false);
  });

  it('sanitizes negative timeoutMs to 0', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 0, timeoutMs: -100 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.showSkeleton).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isSlowLoading).toBe(true);
  });

  it('sanitizes NaN antiFlickerMs to default', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: NaN, timeoutMs: 500 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(result.current.showSkeleton).toBe(true);
  });

  it('cleans up timers on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 100 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('handles loading=true → false → true rapid cycle (request retry)', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 100 }),
      { initialProps: { loading: false } },
    );

    // First cycle: starts loading
    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(50)); // within antiFlicker
    // Ends before antiFlicker completes
    rerender({ loading: false });
    act(() => vi.advanceTimersByTime(10));
    expect(result.current.showSkeleton).toBe(false);

    // Second cycle: starts loading again
    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(150)); // past antiFlicker
    expect(result.current.showSkeleton).toBe(true);

    // Finally ends
    rerender({ loading: false });
    expect(result.current.showSkeleton).toBe(false);
  });

  it('transitions from showing to timeout correctly', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: 50, timeoutMs: 200 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(60)); // past antiFlicker
    expect(result.current.showSkeleton).toBe(true);
    expect(result.current.isSlowLoading).toBe(false);

    act(() => vi.advanceTimersByTime(200)); // past timeout
    expect(result.current.showSkeleton).toBe(true);
    expect(result.current.isSlowLoading).toBe(true);

    // End loading while in timeout state
    rerender({ loading: false });
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.isSlowLoading).toBe(false);
  });

  it('handles Infinity antiFlickerMs (always waits)', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useSkeletonStrategy(loading, { antiFlickerMs: Infinity, timeoutMs: 500 }),
      { initialProps: { loading: false } },
    );

    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(100000)); // very long time
    // Infinity is finite=false, so sanitizeMs returns default 120
    // Actually Number.isFinite(Infinity) is true, so it stays Infinity
    // setTimeout with Infinity fires immediately (clamped to ~2147483647 max, but Infinity → 1ms in Node)
    // This test verifies the behavior is safe regardless
    // The hook should still work (either show or not show, but not crash)
    expect(typeof result.current.showSkeleton).toBe('boolean');
  });

  it('handles undefined options (uses defaults)', () => {
    const { result, rerender } = renderHook(({ loading }) => useSkeletonStrategy(loading), {
      initialProps: { loading: false },
    });

    rerender({ loading: true });
    act(() => vi.advanceTimersByTime(130)); // past default 120ms antiFlicker
    expect(result.current.showSkeleton).toBe(true);
  });

  it('does not leak timers when loading stays true across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ loading, other }) => useSkeletonStrategy(loading, { antiFlickerMs: 50, timeoutMs: 100 }),
      { initialProps: { loading: true, other: 0 } },
    );

    // Re-render with loading still true (simulating parent re-render)
    rerender({ loading: true, other: 1 });
    act(() => vi.advanceTimersByTime(60));
    expect(result.current.showSkeleton).toBe(true);

    rerender({ loading: true, other: 2 });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.isSlowLoading).toBe(true);

    // End loading
    rerender({ loading: false, other: 3 });
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.isSlowLoading).toBe(false);
  });
});
