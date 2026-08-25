// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for the single-instance lock + second-instance visual notification
 * in `src/main.ts`.
 *
 * Strategy: mock `electron` so we can control `requestSingleInstanceLock`,
 * capture `app.on('second-instance')` listeners, and spy on `dock.bounce` /
 * `flashFrame`. Mock the heavy transitive deps (`boot-sequence`, `window-manager`,
 * `theme/utils`, `wallpaper-injector`, `legacy/agentskin-core-runtime`) so that
 * importing `main.ts` does not pull in the entire application.
 *
 * The mutable `lockHeld` flag simulates the OS-level single-instance lock that
 * Electron manages across processes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------

/** Simulates the OS-level single-instance lock. `true` = held by another process. */
let lockHeld = false;

/** Captured listeners keyed by event name (populated by app.on). */
const appListeners: Record<string, (...args: unknown[]) => void> = {};

/** Mock window used as ctx.mainWindow — records flashFrame / show / focus. */
const mockMainWindow = {
  flashFrame: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  setOpacity: vi.fn(),
};

// ---------------------------------------------------------------------------
// Electron mock
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'AgentSkin'),
    setName: vi.fn(),
    getLocale: vi.fn(() => 'en-US'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/mock/app-path'),
    getPath: vi.fn((name: string) => `/mock/path/${name}`),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      appListeners[event] = listener;
    }),
    off: vi.fn(),
    // Return a pending promise so the heavy boot-flow inside .then() never
    // runs. The second-instance / single-instance logic all lives at module
    // top-level and registers correctly regardless.
    whenReady: vi.fn(() => new Promise(() => {})),
    requestSingleInstanceLock: vi.fn(() => {
      if (lockHeld) return false;
      lockHeld = true;
      return true;
    }),
    quit: vi.fn(() => {
      lockHeld = false;
    }),
    dock: {
      bounce: vi.fn(),
      setIcon: vi.fn(),
    },
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  net: {
    fetch: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => mockMainWindow),
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => true })),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock heavy transitive deps so importing main.ts stays lightweight
// ---------------------------------------------------------------------------

vi.mock('../../src/main/boot-sequence', () => ({
  runBootSequence: vi.fn().mockResolvedValue({ trayManager: {}, warnings: [] }),
}));

vi.mock('../../src/main/window-manager', () => ({
  createMainWindow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/main/wallpaper-injector', () => ({
  disposeAudioBroadcast: vi.fn(),
}));

vi.mock('../../src/main/theme/utils', () => ({
  themeCoverPathForScheme: vi.fn(() => null),
  themeHeroPathForScheme: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// main-context mock — provides a controllable ctx with our mockMainWindow
// ---------------------------------------------------------------------------

vi.mock('../../src/main/main-context', () => {
  const ctx = {
    mainWindow: null as typeof mockMainWindow | null,
    splashWindow: null,
    studioWindow: null,
    onStudioWindowClosed: null,
    disposables: [] as Array<() => void>,
    tray: null,
    isQuitting: false,
    bootComplete: false,
    wallpapers: null,
    fileOpens: { handlePath: vi.fn() },
    locale: 'en',
    userDataRoot: '/mock/path/userData',
  };
  return {
    ctx,
    drainDisposables: vi.fn(),
    registerDisposable: vi.fn(),
    sendLog: vi.fn(),
    brandingRoot: vi.fn(() => '/mock/branding'),
  };
});

/**
 * Dynamically import main.ts after resetting modules so each test gets a
 * fresh module-level `hasSingleInstanceLock` evaluation.
 */
async function importMainFresh(): Promise<void> {
  vi.resetModules();
  await import('../../src/main.ts');
}

describe('single-instance lock + second-instance notification', () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    lockHeld = false;
    for (const key of Object.keys(appListeners)) delete appListeners[key];
    // Restoreable platform descriptor.
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    // Default to darwin macOS.
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  /** Override process.platform for the duration of a test. */
  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
      writable: true,
    });
  }

  /** Get the mock ctx so we can set mainWindow before firing second-instance. */
  async function getCtx() {
    const mod = await import('../../src/main/main-context');
    return mod.ctx;
  }

  // -------------------------------------------------------------------------
  // Test 1 — Single instance starts normally (lock acquired)
  // -------------------------------------------------------------------------
  it('acquires the lock on first launch and does NOT call app.quit()', async () => {
    await importMainFresh();

    const electronMock = await import('electron');
    expect(electronMock.app.requestSingleInstanceLock).toHaveBeenCalled();
    expect(electronMock.app.quit).not.toHaveBeenCalled();
    // The second-instance listener was registered.
    expect(appListeners['second-instance']).toBeDefined();
    expect(typeof appListeners['second-instance']).toBe('function');
  });

  // -------------------------------------------------------------------------
  // Test 2 — Second instance exits immediately when lock is held
  // -------------------------------------------------------------------------
  it('calls app.quit() when the lock is already held (second instance)', async () => {
    const electronMock = await import('electron');

    // First instance acquires the lock.
    await importMainFresh();
    expect(electronMock.app.quit).not.toHaveBeenCalled();

    // Second instance: lock is still held. A fresh import simulates a new process.
    await importMainFresh();
    expect(electronMock.app.quit).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3 — macOS dock bounce on second-instance
  // -------------------------------------------------------------------------
  it('bounces the dock icon on macOS when a second instance is launched', async () => {
    setPlatform('darwin');
    await importMainFresh();

    const electronMock = await import('electron');
    // The first instance should not bounce its own dock on startup.
    expect(electronMock.app.dock?.bounce).not.toHaveBeenCalled();

    // Provide a mainWindow so the handler enters the window branch.
    const ctx = await getCtx();
    ctx.mainWindow = mockMainWindow;

    // Simulate a second instance arriving — fire the captured listener.
    const handler = appListeners['second-instance'];
    expect(handler).toBeDefined();
    handler!(undefined, process.argv);

    // macOS path: dock.bounce must be called with 'informational'.
    expect(electronMock.app.dock?.bounce).toHaveBeenCalledWith('informational');
    // flashFrame is also called (cross-platform window attention grab).
    expect(mockMainWindow.flashFrame).toHaveBeenCalledWith(true);
  });

  // -------------------------------------------------------------------------
  // Test 4 — Windows flashFrame on second-instance
  // -------------------------------------------------------------------------
  it('calls flashFrame(true) on the main window on Windows when a second instance is launched', async () => {
    setPlatform('win32');
    await importMainFresh();

    // Provide a mainWindow so the handler enters the window branch.
    const ctx = await getCtx();
    ctx.mainWindow = mockMainWindow;

    const handler = appListeners['second-instance'];
    expect(handler).toBeDefined();
    handler!(undefined, process.argv);

    // Windows path: flashFrame must fire even though dock API is absent.
    expect(mockMainWindow.flashFrame).toHaveBeenCalledWith(true);
    // dock.bounce should NOT be called on Windows.
    const electronMock = await import('electron');
    expect(electronMock.app.dock?.bounce).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5 — Lock released after quit allows re-acquisition
  // -------------------------------------------------------------------------
  it('releases the lock after app.quit() so a new instance can start', async () => {
    setPlatform('darwin');
    const electronMock = await import('electron');

    // First instance starts.
    await importMainFresh();
    expect(electronMock.app.quit).not.toHaveBeenCalled();

    // Second instance fails to acquire lock → triggers quit (which releases the lock).
    await importMainFresh();
    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);

    // Lock has been released by quit. Another import (third "process") should
    // now acquire it cleanly.
    vi.clearAllMocks();
    for (const key of Object.keys(appListeners)) delete appListeners[key];
    await importMainFresh();
    expect(electronMock.app.quit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6 — Concurrent start: only first survives
  // -------------------------------------------------------------------------
  it('survives concurrent launches — exactly one instance keeps running', async () => {
    setPlatform('darwin');
    const electronMock = await import('electron');

    // Launch two "processes" in rapid succession without releasing the lock.
    await importMainFresh();
    await importMainFresh();

    // The first import never calls quit; the second (and any subsequent) does.
    // Total quit calls must equal the number of secondary launches (1 here).
    expect(electronMock.app.quit).toHaveBeenCalledTimes(1);
  });
});
