// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-hot-reload tests
 *
 * Unit tests for the hot-reload notification service: coalescing semantics,
 * fan-out to both windows, destroyed-window safety, and flush/clear lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock BrowserWindow
// ---------------------------------------------------------------------------

function createMockWindow(destroyed = false): Electron.BrowserWindow {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: {
      send: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Electron.BrowserWindow;
}

import type { ThemeHotReloadPayload } from '../shared/types/theme';
// Import AFTER mock setup
import { IpcEventBus } from './ipc/ipc-event-bus';
import {
  clearPendingHotReloads,
  flushThemeHotReload,
  type HotReloadNotifierDeps,
  notifyThemeHotReload,
} from './theme-hot-reload';

function makePayload(overrides: Partial<ThemeHotReloadPayload> = {}): ThemeHotReloadPayload {
  return {
    agentId: 'traework',
    themeId: 'cyber-neon',
    schemeId: null,
    mode: 'dark',
    reloadKind: 'theme-switch',
    wallpaperId: null,
    palette: { accent: '#7C9CFF', background: '#0a0a10' },
    fastPath: true,
    themeVersion: '1.0.0',
    ...overrides,
  };
}

/**
 * Register a deps object's windows with IpcEventBus so the refactored
 * pushToRenderers() can broadcast to them. Returns an unregister cleanup.
 */
function registerDepsWindows(deps: HotReloadNotifierDeps): () => void {
  const windows: Electron.BrowserWindow[] = [];
  if (deps.mainWindow) {
    IpcEventBus.addWindow(deps.mainWindow);
    windows.push(deps.mainWindow);
  }
  if (deps.studioWindow) {
    IpcEventBus.addWindow(deps.studioWindow);
    windows.push(deps.studioWindow);
  }
  return () => {
    for (const w of windows) {
      IpcEventBus.removeWindow(w);
    }
  };
}

describe('theme-hot-reload — notifyThemeHotReload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPendingHotReloads();
    IpcEventBus.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingHotReloads();
    IpcEventBus.clear();
  });

  it('sends payload to mainWindow after debounce window', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);
    const payload = makePayload();

    notifyThemeHotReload(deps, payload);

    // Not sent immediately (debounce)
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('theme:hot-reload', payload);
    unregister();
  });

  it('sends payload to both mainWindow and studioWindow', () => {
    const mainWindow = createMockWindow();
    const studioWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow };
    const unregister = registerDepsWindows(deps);
    const payload = makePayload();

    notifyThemeHotReload(deps, payload);
    vi.advanceTimersByTime(50);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('theme:hot-reload', payload);
    expect(studioWindow.webContents.send).toHaveBeenCalledWith('theme:hot-reload', payload);
    unregister();
  });

  it('coalesces rapid successive calls for the same agent into one push', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);

    notifyThemeHotReload(deps, makePayload({ themeId: 'theme-a' }));
    notifyThemeHotReload(deps, makePayload({ themeId: 'theme-b' }));
    notifyThemeHotReload(deps, makePayload({ themeId: 'theme-c' }));

    vi.advanceTimersByTime(50);

    // Only one push with the latest payload
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'theme:hot-reload',
      expect.objectContaining({ themeId: 'theme-c' }),
    );
    unregister();
  });

  it('does NOT coalesce calls for different agents', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);

    notifyThemeHotReload(deps, makePayload({ agentId: 'traework' }));
    notifyThemeHotReload(deps, makePayload({ agentId: 'qoderwork' }));

    vi.advanceTimersByTime(50);

    // Two pushes — one per agent
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(2);
    unregister();
  });

  it('skips destroyed windows without throwing', () => {
    const mainWindow = createMockWindow(true); // destroyed
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);
    const payload = makePayload();

    notifyThemeHotReload(deps, payload);
    vi.advanceTimersByTime(50);

    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    unregister();
  });

  it('handles null windows gracefully', () => {
    const deps: HotReloadNotifierDeps = { mainWindow: null, studioWindow: null };
    const payload = makePayload();

    // Should not throw
    expect(() => {
      notifyThemeHotReload(deps, payload);
      vi.advanceTimersByTime(50);
    }).not.toThrow();
  });
});

describe('theme-hot-reload — flushThemeHotReload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPendingHotReloads();
    IpcEventBus.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingHotReloads();
    IpcEventBus.clear();
  });

  it('immediately pushes pending payload bypassing debounce', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);
    const payload = makePayload({ themeId: 'flush-test' });

    notifyThemeHotReload(deps, payload);
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();

    flushThemeHotReload(deps, 'traework');

    // Pushed immediately without waiting for debounce
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'theme:hot-reload',
      expect.objectContaining({ themeId: 'flush-test' }),
    );
    unregister();
  });

  it('is a no-op when no pending payload exists for the agent', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);

    flushThemeHotReload(deps, 'traework');

    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    unregister();
  });
});

describe('theme-hot-reload — clearPendingHotReloads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPendingHotReloads();
    IpcEventBus.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingHotReloads();
    IpcEventBus.clear();
  });

  it('clears all pending payloads without pushing them', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const unregister = registerDepsWindows(deps);

    notifyThemeHotReload(deps, makePayload({ agentId: 'traework' }));
    notifyThemeHotReload(deps, makePayload({ agentId: 'qoderwork' }));

    clearPendingHotReloads();
    vi.advanceTimersByTime(50);

    // Nothing was pushed
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    unregister();
  });
});
