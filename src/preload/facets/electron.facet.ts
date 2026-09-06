// SPDX-License-Identifier: MPL-2.0

/**
 * Electron facet — app discovery, launch, and scan progress.
 *
 * Bridges the scanner/electron-launcher services that detect and launch
 * Electron-based AI agents (traework, qoderwork, workbuddy, ...).
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ScanProgressEvent } from '../../shared/types';
import type { LaunchRequest } from '../../shared/types/launch';

export const electron = {
  /** Trigger (or re-trigger) the Electron app scan. */
  scanElectronApps: (force?: boolean) => ipcRenderer.invoke(IpcChannel.ELECTRON_SCAN, force),
  /** Launch a specific Electron app via the agent launcher. */
  launchElectronApp: (request: LaunchRequest) =>
    ipcRenderer.invoke(IpcChannel.ELECTRON_LAUNCH, request),
  /** Register a custom executable path as an agent. */
  registerCustomExe: (exePath: string) =>
    ipcRenderer.invoke(IpcChannel.ELECTRON_REGISTER_CUSTOM_EXE, exePath),

  /** Subscribe to scan progress events (push from main). */
  onElectronScanProgress: (cb: (scanEvent: ScanProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, scanEvent: ScanProgressEvent) =>
      cb(scanEvent);
    ipcRenderer.on(IpcChannel.ELECTRON_SCAN_PROGRESS, handler);
    return () => ipcRenderer.off(IpcChannel.ELECTRON_SCAN_PROGRESS, handler);
  },
};
