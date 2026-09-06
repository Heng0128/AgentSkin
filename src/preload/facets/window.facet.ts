// SPDX-License-Identifier: MPL-2.0

/**
 * Window facet — custom title bar controls + shell utilities.
 *
 * These methods are intentionally split from the injection-domain facades
 * because they operate on the AgentSkin desktop shell, not on agent windows.
 * Electron's BrowserWindow controls (minimize/maximize/close) are shell-level
 * concerns and should not be part of the injection engine API surface.
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';

function subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const windowControls = {
  /** Minimize the main application window. */
  minimize: () => ipcRenderer.send(IpcChannel.WINDOW_MINIMIZE),
  /** Toggle maximize/restore for the main application window. */
  toggleMaximize: () => ipcRenderer.invoke(IpcChannel.WINDOW_TOGGLE_MAXIMIZE),
  /** Close the main application window. */
  close: () => ipcRenderer.send(IpcChannel.WINDOW_CLOSE),
  /** Query whether the main window is currently maximized. */
  isMaximized: () => ipcRenderer.invoke(IpcChannel.WINDOW_IS_MAXIMIZED),
  /** Subscribe to maximize/restore state changes. */
  onMaximizeChange: (listener: (isMaximized: boolean) => void) =>
    subscribeEvent<boolean>(IpcChannel.WINDOW_MAXIMIZE_CHANGE, listener),

  // --- Shell utilities ---
  /** Reveal a file in the OS file explorer. */
  showInFolder: (itemPath: string) => ipcRenderer.invoke(IpcChannel.SHELL_SHOW_ITEM, itemPath),
};
