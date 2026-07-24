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

import { BrowserWindow } from 'electron';
import path from 'node:path';
import { brandingRoot, ctx } from './main-context';
import { IpcChannel } from '../shared/ipc-channels';

export interface WindowCreateOptions {
  /** Renderer dev server URL (vite dev), or null to load the built file. */
  rendererUrl?: string;
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
  ctx.mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'AgentSkin',
    icon: path.join(brandingRoot(), 'icon.png'),
    // Hidden title bar on both platforms so we can render a custom one with
    // extra functionality (import / restore-all / refresh / theme-mode toggle
    // + window controls). macOS keeps its native traffic-light buttons via
    // hiddenInset; Windows hides the frame entirely and we draw our own
    // minimize / maximize / close buttons.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  ctx.mainWindow.setMenuBarVisibility(false);

  // Close-to-tray: hide instead of close so background CDP injection keeps
  // running. The `isQuitting` flag is set by `before-quit` / tray "Quit".
  ctx.mainWindow.on('close', (event) => {
    if (!ctx.isQuitting) {
      event.preventDefault();
      ctx.mainWindow?.hide();
    }
  });

  ctx.mainWindow.once('ready-to-show', () => ctx.mainWindow?.show());
  ctx.mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Broadcast maximize/unmaximize so the title bar button can update its icon.
  ctx.mainWindow.on('maximize', () => ctx.mainWindow?.webContents.send(IpcChannel.WINDOW_MAXIMIZE_CHANGE, true));
  ctx.mainWindow.on('unmaximize', () => ctx.mainWindow?.webContents.send(IpcChannel.WINDOW_MAXIMIZE_CHANGE, false));

  if (options.rendererUrl) {
    await ctx.mainWindow.loadURL(options.rendererUrl);
  } else {
    await ctx.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}
