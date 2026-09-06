// SPDX-License-Identifier: MPL-2.0

/**
 * # Window IPC
 *
 * Window-control IPC handlers backing the custom title bar
 * (minimize / toggle-maximize / close / is-maximized). Extracted from
 * `createWindow` in `main.ts` (H3).
 *
 * These handlers resolve the originating window via
 * `BrowserWindow.fromWebContents(event.sender)`, so they serve BOTH the main
 * window and the standalone Theme Studio window without any per-window
 * branching. The maximize/unmaximize *event* broadcasting still lives in
 * `createMainWindow` / `createStudioWindow` because it must be attached to
 * each window instance.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';

export function registerWindowIpc(): void {
  // Resolve the window that sent the control request so the same handlers
  // serve BOTH the main window and the standalone Theme Studio window. This
  // replaced the old `deps.mainWindow` hard-coding that silently controlled
  // the wrong window once the studio moved into its own BrowserWindow.
  const senderWindow = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender);

  ipcMain.on(IpcChannel.WINDOW_MINIMIZE, (event) => {
    senderWindow(event)?.minimize();
  });

  ipcMain.handle(IpcChannel.WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const win = senderWindow(event);
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });

  ipcMain.on(IpcChannel.WINDOW_CLOSE, (event) => {
    senderWindow(event)?.close();
  });

  ipcMain.handle(IpcChannel.WINDOW_IS_MAXIMIZED, (event) =>
    Boolean(senderWindow(event)?.isMaximized()),
  );
}
