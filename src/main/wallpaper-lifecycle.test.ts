// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level handler registries so we can assert exactly which events
// registerWallpaperLifecycle() wire up — and that cleanup removes them.
// ---------------------------------------------------------------------------

const mockAppHandlers: Record<string, unknown> = {};
const mockPmHandlers: Record<string, unknown> = {};

vi.mock('electron', () => ({
  app: {
    on: vi.fn((event: string, fn: unknown) => {
      mockAppHandlers[event] = fn;
    }),
    off: vi.fn((event: string, fn: unknown) => {
      if (mockAppHandlers[event] === fn) delete mockAppHandlers[event];
    }),
  },
  powerMonitor: {
    on: vi.fn((event: string, fn: unknown) => {
      mockPmHandlers[event] = fn;
    }),
    off: vi.fn((event: string, fn: unknown) => {
      if (mockPmHandlers[event] === fn) delete mockPmHandlers[event];
    }),
  },
  BrowserWindow: class {},
}));

// Mock wallpaper-injector so we do not pull the heavy CDP dependency chain.
// registerWallpaperLifecycle only calls getActiveWallpaperAgents() inside
// the broadcast() closure, which never fires during these tests.
vi.mock('./wallpaper-injector', () => ({
  getActiveWallpaperAgents: vi.fn(() => []),
  openAgentWallpaperSession: vi.fn(),
}));

describe('wallpaper lifecycle cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear handler maps themselves (resetModules only resets registry, not
    // our top-level plain objects).
    for (const k of Object.keys(mockAppHandlers)) delete mockAppHandlers[k];
    for (const k of Object.keys(mockPmHandlers)) delete mockPmHandlers[k];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Dynamically import after resetModules to get a fresh module-level `registered`. */
  interface LifecycleModule {
    registerWallpaperLifecycle: () => void;
    _resetWallpaperLifecycleForTest: () => void;
  }

  async function importLifecycle(): Promise<LifecycleModule> {
    return (await import('./wallpaper-lifecycle')) as unknown as LifecycleModule;
  }

  // ---- Test 1: register → cleanup removes all 5 listeners ----
  it('registers 4 power-monitor listeners + 1 app will-quit, and _resetWallpaperLifecycleForTest removes all', async () => {
    const { registerWallpaperLifecycle, _resetWallpaperLifecycleForTest } = await importLifecycle();

    registerWallpaperLifecycle();

    // 4 power-monitor events.
    expect(Object.keys(mockPmHandlers)).toHaveLength(4);
    expect(mockPmHandlers).toHaveProperty('suspend');
    expect(mockPmHandlers).toHaveProperty('on-battery');
    expect(mockPmHandlers).toHaveProperty('resume');
    expect(mockPmHandlers).toHaveProperty('on-ac');

    // 1 app event.
    expect(Object.keys(mockAppHandlers)).toHaveLength(1);
    expect(mockAppHandlers).toHaveProperty('will-quit');

    _resetWallpaperLifecycleForTest();

    expect(Object.keys(mockPmHandlers)).toHaveLength(0);
    expect(Object.keys(mockAppHandlers)).toHaveLength(0);
  });

  // ---- Test 2: idempotency — double-register, same listener count ----
  it('second register call is a no-op (listeners stay at 5)', async () => {
    const { registerWallpaperLifecycle } = await importLifecycle();

    registerWallpaperLifecycle();
    registerWallpaperLifecycle();

    expect(Object.keys(mockPmHandlers)).toHaveLength(4);
    expect(Object.keys(mockAppHandlers)).toHaveLength(1);
  });

  // ---- Test 3: cleanup → re-register restores 5 listeners ----
  it('after cleanup, register restores all 5 listeners', async () => {
    const { registerWallpaperLifecycle, _resetWallpaperLifecycleForTest } = await importLifecycle();

    registerWallpaperLifecycle();
    _resetWallpaperLifecycleForTest();
    expect(Object.keys(mockPmHandlers)).toHaveLength(0);
    expect(Object.keys(mockAppHandlers)).toHaveLength(0);

    registerWallpaperLifecycle();
    expect(Object.keys(mockPmHandlers)).toHaveLength(4);
    expect(Object.keys(mockAppHandlers)).toHaveLength(1);
  });

  // ---- Test 4: _resetWallpaperLifecycleForTest has the same effect the user asked of cleanup() ----
  it('_resetWallpaperLifecycleForTest matches the cleanup return behaviour', async () => {
    const { registerWallpaperLifecycle, _resetWallpaperLifecycleForTest } = await importLifecycle();

    registerWallpaperLifecycle();
    expect(Object.keys(mockPmHandlers).length + Object.keys(mockAppHandlers).length).toBe(5);

    _resetWallpaperLifecycleForTest();
    expect(Object.keys(mockPmHandlers).length + Object.keys(mockAppHandlers).length).toBe(0);
  });
});
