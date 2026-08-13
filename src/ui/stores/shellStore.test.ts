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

const SIDEBAR_KEY = 'agentskin:sidebar-collapsed';

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
  // toggleSidebar: expanded → collapsed writes '1'
  // -----------------------------------------------------------------------

  it("writes '1' to localStorage when toggleSidebar collapses an expanded sidebar", () => {
    // Initial state: sidebar expanded (collapsed = false)
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);

    useShellStore.getState().toggleSidebar();

    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('1');
  });

  // -----------------------------------------------------------------------
  // toggleSidebar: collapsed → expanded writes '0'
  // -----------------------------------------------------------------------

  it("writes '0' to localStorage when toggleSidebar expands a collapsed sidebar", () => {
    // Start collapsed
    useShellStore.setState({ sidebarCollapsed: true });
    window.localStorage.setItem(SIDEBAR_KEY, '1');

    useShellStore.getState().toggleSidebar();

    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('0');
  });

  // -----------------------------------------------------------------------
  // setSidebarCollapsed(true) writes '1'
  // -----------------------------------------------------------------------

  it("writes '1' to localStorage when setSidebarCollapsed(true) is called", () => {
    useShellStore.getState().setSidebarCollapsed(true);

    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('1');
  });

  // -----------------------------------------------------------------------
  // setSidebarCollapsed(false) writes '0'
  // -----------------------------------------------------------------------

  it("writes '0' to localStorage when setSidebarCollapsed(false) is called", () => {
    // Start from collapsed
    useShellStore.setState({ sidebarCollapsed: true });
    window.localStorage.setItem(SIDEBAR_KEY, '1');

    useShellStore.getState().setSidebarCollapsed(false);

    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('0');
  });

  // -----------------------------------------------------------------------
  // readSidebarPref: initial '1' → sidebarCollapsed true
  // -----------------------------------------------------------------------

  it("initializes sidebarCollapsed to true when localStorage already has '1'", async () => {
    // Set localStorage before store creation so readSidebarPref picks it up.
    window.localStorage.setItem(SIDEBAR_KEY, '1');

    // Reset module cache so a dynamic import re-evaluates the store factory,
    // which calls readSidebarPref() against current localStorage.
    vi.resetModules();
    const mod = await import('./shellStore');

    expect(mod.useShellStore.getState().sidebarCollapsed).toBe(true);
  });
});
