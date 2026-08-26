// SPDX-License-Identifier: MPL-2.0

/**
 * # useShallow Equality Tests (RC4-step7)
 *
 * Verifies that useShallow prevents reference-change-induced re-renders
 * when the selected fields haven't actually changed. Uses renderHook + act
 * to simulate store updates.
 *
 * Note: useShallow is a React hook (internally uses useRef), so it must be
 * called inside a renderHook callback — never at the top level of a test.
 */

import { useWorkspaceStore } from '@/stores/workspaceStore';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useShallow } from 'zustand/react/shallow';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useShallow', () => {
  it('does not trigger re-render when selected field is unchanged after store update', () => {
    // RC1-step3 fix verification: selector that only picks `dock.open`
    const { result } = renderHook(() =>
      useWorkspaceStore(
        useShallow((s: ReturnType<typeof useWorkspaceStore.getState>) => ({
          dockOpen: s.dock.open,
        })),
      ),
    );

    // Initial value
    expect(result.current.dockOpen).toBe(true);

    // Change an UNRELATED field (inspector tab) — should NOT change dock.open
    act(() => {
      useWorkspaceStore.getState().setInspectorTab('element');
    });

    // The selected dockOpen value should be unchanged
    expect(result.current.dockOpen).toBe(true);
  });

  it('returns the same object reference when selected fields are unchanged', () => {
    // Selector that picks dock state via useShallow
    const { result, rerender } = renderHook(() =>
      useWorkspaceStore(
        useShallow((s: ReturnType<typeof useWorkspaceStore.getState>) => ({
          dock: s.dock,
        })),
      ),
    );
    const firstRef = result.current;

    // Change unrelated field
    act(() => {
      useWorkspaceStore.getState().setRawCss('test');
    });

    rerender();
    const secondRef = result.current;

    // useShallow should return the same object reference since dock didn't change
    expect(secondRef).toBe(firstRef);
  });

  it('returns a new reference when a selected field changes', () => {
    const { result, rerender } = renderHook(() =>
      useWorkspaceStore(
        useShallow((s: ReturnType<typeof useWorkspaceStore.getState>) => ({
          dockOpen: s.dock.open,
        })),
      ),
    );
    const firstRef = result.current;

    // Change the selected field
    act(() => {
      useWorkspaceStore.getState().setDockOpen(false);
    });

    rerender();
    const secondRef = result.current;

    // Should be a new reference with updated value
    expect(secondRef).not.toBe(firstRef);
    expect(secondRef.dockOpen).toBe(false);
  });

  it('prevents re-render cascade from full-store subscription pattern', () => {
    // This simulates the RC1-step3 fix: components that previously used
    // useWorkspaceStore() (full subscription) now use useShallow selectors.
    // Verify that the selector approach doesn't re-render on unrelated changes.
    const { result, rerender } = renderHook(() =>
      useWorkspaceStore(
        useShallow((s: ReturnType<typeof useWorkspaceStore.getState>) => ({
          dock: s.dock,
          inspector: s.inspector,
          drawer: s.drawer,
        })),
      ),
    );
    const initialRef = result.current;

    // Change a field NOT in the selector (rawCss)
    act(() => {
      useWorkspaceStore.getState().setRawCss('some-value');
    });

    rerender();

    // The selector result should be the same reference
    expect(result.current).toBe(initialRef);
  });

  it('maintains referential stability across multiple store reads with same values', () => {
    const { result, rerender } = renderHook(() =>
      useWorkspaceStore(
        useShallow((s: ReturnType<typeof useWorkspaceStore.getState>) => ({
          dockOpen: s.dock.open,
          inspectorOpen: s.inspector.open,
        })),
      ),
    );

    const ref1 = result.current;

    // Rerender without any store change
    rerender();
    const ref2 = result.current;

    // Same values → same reference (useShallow guarantees this)
    expect(ref2).toBe(ref1);
  });

  it('returns a new reference when shallow comparison detects change', () => {
    // Ensure deterministic starting state: dock.open = true
    act(() => {
      useWorkspaceStore.getState().setDockOpen(true);
    });

    const { result, rerender } = renderHook(() =>
      useWorkspaceStore(
        useShallow((s: ReturnType<typeof useWorkspaceStore.getState>) => ({
          dockOpen: s.dock.open,
        })),
      ),
    );

    const ref1 = result.current;
    expect(ref1.dockOpen).toBe(true);

    // Change the dock.open value
    act(() => {
      useWorkspaceStore.getState().setDockOpen(false);
    });

    rerender();
    const ref2 = result.current;

    // Value changed → new reference
    expect(ref2).not.toBe(ref1);
    expect(ref2.dockOpen).toBe(false);
  });
});
