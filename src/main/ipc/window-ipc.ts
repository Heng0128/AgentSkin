// SPDX-License-Identifier: MPL-2.0

/**
 * # Window IPC
 *
 * Window-control IPC handlers backing the custom title bar
 * (minimize / toggle-maximize / close / is-maximized). Extracted from
 * `createWindow` in `main.ts` (H3).
 *
 * These handlers read `deps.mainWindow` lazily, so they can be registered
 * before the window is created (the optional chaining no-ops until a window
 * exists). The maximize/unmaximize *event* broadcasting still lives in
 * `createWindow` because it must be attached to each window instance.
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';

export function registerWindowIpc(deps: MainContext): void {
  ipcMain.on(IpcChannel.WINDOW_MINIMIZE, () => deps.mainWindow?.minimize());

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!deps.mainWindow) return false;
    if (deps.mainWindow.isMaximized()) {
      deps.mainWindow.unmaximize();
      return false;
    }
    deps.mainWindow.maximize();
    return true;
  });

  ipcMain.on(IpcChannel.WINDOW_CLOSE, () => deps.mainWindow?.close());

  ipcMain.handle(IpcChannel.WINDOW_IS_MAXIMIZED, () => Boolean(deps.mainWindow?.isMaximized()));
}
