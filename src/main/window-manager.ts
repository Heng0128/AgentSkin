// SPDX-License-Identifier: MPL-2.0

/**
 * # Window Manager
 *
 * Extracted from `main.ts`. Owns the main {@link BrowserWindow} lifecycle:
 * construction, renderer URL resolution, window control event broadcasting,
 * and the close-to-tray behavior.
 *
 * The window-control *IPC handlers* (window:minimize / toggle-maximize / etc.)
 * live in `main/ipc/window-ipc.ts` — they read `ctx.mainWindow` lazily so they
 * can be registered before the window exists. This module only owns the
 * window instance itself and its non-IPC event hooks.
 *
 * `isQuittingRef` is injected so the close handler can check the quitting
 * flag without importing `ctx` directly (the quitting flag is set by
 * `before-quit` in `main.ts`).
 */

import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { IpcChannel } from '../shared/ipc-channels';
import { setTrustedSenderId } from './ipc/trusted-sender';
import { readThemeModePreferenceSync } from './locale-preferences';
import { brandingRoot, ctx } from './main-context';

// ============================================================================
// K-01 / K-02 helpers
// ============================================================================

/**
 * Resolve the window backgroundColor from the persisted theme mode.
 * Light mode uses a soft white (#fafafa); dark mode keeps the original #09090b.
 */
function resolveBackgroundColor(): string {
  const userDataRoot = ctx.userDataRoot;
  if (!userDataRoot) return '#09090b';
  return readThemeModePreferenceSync(userDataRoot) === 'light' ? '#fafafa' : '#09090b';
}

/**
 * K-02: DPI-aware window sizing.
 *
 * Base design size targets 1x displays. On hi-dpi (scaleFactor > 1) we scale
 * the dimensions up so the window occupies the same physical size. The result
 * is capped at 90% of the primary display's workArea so it never overflows.
 */
function resolveWindowSize(base: {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}) {
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor || 1;
  const { width: workW, height: workH } = screen.getPrimaryDisplay().workArea;

  const scaled =
    scaleFactor > 1
      ? {
          width: Math.round(base.width * scaleFactor),
          height: Math.round(base.height * scaleFactor),
          minWidth: Math.round(base.minWidth * scaleFactor),
          minHeight: Math.round(base.minHeight * scaleFactor),
        }
      : base;

  const maxW = Math.round(workW * 0.9);
  const maxH = Math.round(workH * 0.9);

  return {
    width: Math.min(scaled.width, maxW),
    height: Math.min(scaled.height, maxH),
    minWidth: Math.min(scaled.minWidth, maxW),
    minHeight: Math.min(scaled.minHeight, maxH),
  };
}

// ============================================================================

/**
 * Create (or focus, if already open) the dedicated Theme Studio window.
 *
 * Unlike the main window, the studio window is a plain utility window:
 *   - it does NOT close-to-tray (closing it destroys it; `ctx.studioWindow`
 *     is nulled on the `closed` event so it can be reopened cleanly)
 *   - its maximize/unmaximize events broadcast `WINDOW_MAXIMIZE_CHANGE` to
 *     its own webContents so its title bar reflects the maximized state
 *   - it shares the same preload bridge and loads `studio.html`
 *
 * Idempotent: if a live studio window already exists we just surface/focus it
 * instead of stacking duplicates.
 */
export async function createStudioWindow(options: WindowCreateOptions = {}): Promise<void> {
  if (ctx.studioWindow && !ctx.studioWindow.isDestroyed()) {
    ctx.studioWindow.show();
    ctx.studioWindow.focus();
    return;
  }

  const size = resolveWindowSize({ width: 1340, height: 860, minWidth: 980, minHeight: 680 });
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    show: false,
    title: 'AgentSkin Studio',
    icon: path.join(brandingRoot(), 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: resolveBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ctx.studioWindow = win;
  win.setMenuBarVisibility(false);

  // Plain close (no close-to-tray): clear the ref so a later open recreates it.
  // Also run the injected cleanup hook (stops any live CDP inspect session that
  // would otherwise leak past the window's lifetime).
  win.on('closed', () => {
    if (ctx.studioWindow === win) ctx.studioWindow = null;
    ctx.onStudioWindowClosed?.();
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Broadcast maximize/unmaximize to the studio window's own title bar.
  win.on('maximize', () => win.webContents.send(IpcChannel.WINDOW_MAXIMIZE_CHANGE, true));
  win.on('unmaximize', () => win.webContents.send(IpcChannel.WINDOW_MAXIMIZE_CHANGE, false));

  if (options.rendererUrl) {
    const base = options.rendererUrl.replace(/\/+$/, '');
    await win.loadURL(`${base}/studio.html`);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/studio.html'));
  }
}

export interface WindowCreateOptions {
  /** Renderer dev server URL (vite dev), or null to load the built file. */
  rendererUrl?: string;
  /**
   * Optional handler invoked on `ready-to-show`. When provided, it replaces
   * the default `ready-to-show → show()` behavior so the caller (the boot
   * splash transition in `main.ts`) owns the single show/transition path.
   * This avoids the main window being shown twice — once here and again in
   * `fadeOutSplash` — which made the always-on-top splash linger on top of
   * the already-visible main window. When omitted, the window shows itself
   * as soon as it is ready to paint (non-boot paths, e.g. `activate`).
   */
  onReadyToShow?: () => void;
}

/**
 * Create and show the main browser window. Attaches:
 *   - close-to-tray (hide instead of close unless quitting)
 *   - ready-to-show (show once first paint completes)
 *   - setWindowOpenHandler (deny all popups)
 *   - maximize/unmaximize broadcast (for the custom title bar)
 *
 * The window is stored on `ctx.mainWindow` so IPC handlers and the tray
 * manager can reach it.
 */
export async function createMainWindow(options: WindowCreateOptions = {}): Promise<void> {
  // Main window uses a slightly smaller base size than studio; apply the
  // same DPI-aware scaling for consistency.
  const size = resolveWindowSize({ width: 1220, height: 800, minWidth: 980, minHeight: 680 });

  ctx.mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    show: false,
    title: 'AgentSkin',
    icon: path.join(brandingRoot(), 'icon.png'),
    // Hidden title bar on both platforms so we can render a custom one with
    // extra functionality (import / restore-all / refresh / theme-mode toggle
    // + window controls). macOS keeps its native traffic-light buttons via
    // hiddenInset; Windows hides the frame entirely and we draw our own
    // minimize / maximize / close buttons.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: resolveBackgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ctx.mainWindow.setMenuBarVisibility(false);

  // Record the trusted main window's webContents id so high-sensitivity IPC
  // handlers can reject calls from embedded webview/iframe content (G5).
  setTrustedSenderId(ctx.mainWindow.webContents.id);

  // Close-to-tray: hide instead of close so background CDP injection keeps
  // running. The `isQuitting` flag is set by `before-quit` / tray "Quit".
  ctx.mainWindow.on('close', (event) => {
    if (!ctx.isQuitting) {
      event.preventDefault();
      ctx.mainWindow?.hide();
    }
  });

  ctx.mainWindow.once('ready-to-show', () => {
    if (options.onReadyToShow) {
      // Boot path: the caller coordinates the splash fade-out + main window
      // fade-in as a single transition. Do NOT also call show() here or the
      // main window appears in full before the splash has been dismissed.
      options.onReadyToShow();
    } else {
      // Non-boot path (e.g. recreated on `activate`): no splash to wait for,
      // show as soon as the first paint is ready.
      ctx.mainWindow?.show();
    }
  });
  ctx.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Broadcast maximize/unmaximize so the title bar button can update its icon.
  ctx.mainWindow.on('maximize', () =>
    ctx.mainWindow?.webContents.send(IpcChannel.WINDOW_MAXIMIZE_CHANGE, true),
  );
  ctx.mainWindow.on('unmaximize', () =>
    ctx.mainWindow?.webContents.send(IpcChannel.WINDOW_MAXIMIZE_CHANGE, false),
  );

  const wc = ctx.mainWindow.webContents;
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[debug] did-fail-load', code, desc, url);
  });
  wc.on('console-message', (_event, level, message, lineNumber, sourceId) => {
    console.error(`[debug:renderer] ${level} ${sourceId}:${lineNumber} ${message}`);
  });
  wc.on('render-process-gone', (_e, details) => {
    console.error('[debug] render-process-gone', details);
  });

  if (options.rendererUrl) {
    await ctx.mainWindow.loadURL(options.rendererUrl);
  } else {
    await ctx.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}
