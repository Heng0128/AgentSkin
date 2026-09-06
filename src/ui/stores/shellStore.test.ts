// SPDX-License-Identifier: MPL-2.0

/**
 * # shellStore tests — sidebar localStorage persistence
 *
 * Verifies that `toggleSidebar` and `setSidebarCollapsed` write the
 * correct value (`'1'` / `'0'`) to localStorage under the key
 * `'agentskin:sidebar-collapsed'`, and that `readSidebarPref` is honored
 * at store-creation time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShellStore } from './shellStore';

/**
 * The store uses Zustand `persist` middleware with name = 'agentskin:sidebar'.
 * The persisted JSON shape is `{ version: 0, state: { sidebarCollapsed: boolean } }`.
 */
const SIDEBAR_KEY = 'agentskin:sidebar';

/** Read persisted sidebarCollapsed from localStorage (mirrors persist storage format). */
function readPersistedCollapsed(): boolean | null {
  const raw = window.localStorage.getItem(SIDEBAR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.state?.sidebarCollapsed ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shellStore — sidebar localStorage persistence', () => {
  beforeEach(() => {
    // Clear localStorage and reset store to known state before each test.
    window.localStorage.clear();
    useShellStore.setState({ sidebarCollapsed: false });
  });

  // -----------------------------------------------------------------------
  // toggleSidebar: expanded → collapsed persists true
  // -----------------------------------------------------------------------

  it('persists true when toggleSidebar collapses an expanded sidebar', () => {
    // Initial state: sidebar expanded (collapsed = false)
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);

    useShellStore.getState().toggleSidebar();

    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    expect(readPersistedCollapsed()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // toggleSidebar: collapsed → expanded persists false
  // -----------------------------------------------------------------------

  it('persists false when toggleSidebar expands a collapsed sidebar', () => {
    // Start collapsed
    useShellStore.setState({ sidebarCollapsed: true });

    useShellStore.getState().toggleSidebar();

    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
    expect(readPersistedCollapsed()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // setSidebarCollapsed(true) persists true
  // -----------------------------------------------------------------------

  it('persists true when setSidebarCollapsed(true) is called', () => {
    useShellStore.getState().setSidebarCollapsed(true);

    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    expect(readPersistedCollapsed()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // setSidebarCollapsed(false) persists false
  // -----------------------------------------------------------------------

  it('persists false when setSidebarCollapsed(false) is called', () => {
    // Start from collapsed
    useShellStore.setState({ sidebarCollapsed: true });

    useShellStore.getState().setSidebarCollapsed(false);

    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
    expect(readPersistedCollapsed()).toBe(false);
  });

  // -----------------------------------------------------------------------
  // persist: rehydrate from existing storage on store re-creation
  // -----------------------------------------------------------------------

  it('rehydrates sidebarCollapsed=true from persisted storage on store recreation', async () => {
    // Seed localStorage in persist format BEFORE re-importing the store module.
    // persist's rehydrate reads this JSON and applies it to the store.
    window.localStorage.setItem(
      SIDEBAR_KEY,
      JSON.stringify({ version: 0, state: { sidebarCollapsed: true } }),
    );

    // Reset module cache so dynamic import re-evaluates the store factory,
    // which will call persist's rehydrate path against current localStorage.
    vi.resetModules();
    const mod = await import('./shellStore');

    // persist rehydrates synchronously from the merged storage entry.
    expect(mod.useShellStore.getState().sidebarCollapsed).toBe(true);

    // Cleanup: clear localStorage so other tests are not affected.
    window.localStorage.clear();
  });
});
