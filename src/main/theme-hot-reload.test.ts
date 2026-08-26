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
  } as unknown as Electron.BrowserWindow;
}

import type { ThemeHotReloadPayload } from '../shared/types/theme';
// Import AFTER mock setup
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

describe('theme-hot-reload — notifyThemeHotReload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPendingHotReloads();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingHotReloads();
  });

  it('sends payload to mainWindow after debounce window', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const payload = makePayload();

    notifyThemeHotReload(deps, payload);

    // Not sent immediately (debounce)
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('theme:hot-reload', payload);
  });

  it('sends payload to both mainWindow and studioWindow', () => {
    const mainWindow = createMockWindow();
    const studioWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow };
    const payload = makePayload();

    notifyThemeHotReload(deps, payload);
    vi.advanceTimersByTime(50);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('theme:hot-reload', payload);
    expect(studioWindow.webContents.send).toHaveBeenCalledWith('theme:hot-reload', payload);
  });

  it('coalesces rapid successive calls for the same agent into one push', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };

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
  });

  it('does NOT coalesce calls for different agents', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };

    notifyThemeHotReload(deps, makePayload({ agentId: 'traework' }));
    notifyThemeHotReload(deps, makePayload({ agentId: 'qoderwork' }));

    vi.advanceTimersByTime(50);

    // Two pushes — one per agent
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(2);
  });

  it('skips destroyed windows without throwing', () => {
    const mainWindow = createMockWindow(true); // destroyed
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
    const payload = makePayload();

    notifyThemeHotReload(deps, payload);
    vi.advanceTimersByTime(50);

    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
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
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingHotReloads();
  });

  it('immediately pushes pending payload bypassing debounce', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };
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
  });

  it('is a no-op when no pending payload exists for the agent', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };

    flushThemeHotReload(deps, 'traework');

    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });
});

describe('theme-hot-reload — clearPendingHotReloads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearPendingHotReloads();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearPendingHotReloads();
  });

  it('clears all pending payloads without pushing them', () => {
    const mainWindow = createMockWindow();
    const deps: HotReloadNotifierDeps = { mainWindow, studioWindow: null };

    notifyThemeHotReload(deps, makePayload({ agentId: 'traework' }));
    notifyThemeHotReload(deps, makePayload({ agentId: 'qoderwork' }));

    clearPendingHotReloads();
    vi.advanceTimersByTime(50);

    // Nothing was pushed
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });
});
