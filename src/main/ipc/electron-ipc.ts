// SPDX-License-Identifier: MPL-2.0

/**
 * # Electron IPC
 *
 * IPC handlers for the application quick-launcher feature: scanning locally
 * installed Electron applications and launching a selected one. Extracted from
 * the monolithic `registerIpc` in `main.ts` (H3).
 *
 * The two handlers are intentionally thin — all scanning and launch logic
 * lives in `electron-scanner.ts` and `electron-launcher.ts` respectively,
 * keeping this module focused on IPC boundary concerns (timeout, channel
 * registration).
 *
 * Both handlers are self-contained: they pull service functions directly
 * rather than depending on a {@link MainContext} singleton, mirroring the
 * pattern used by other standalone IPC modules (e.g. `bundle-ipc.ts`).
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { type LaunchRequest, launchApp } from '../services/electron-launcher';
import { scanElectronApps } from '../services/electron-scanner';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Bounded timeout for the scan operation — prevents a slow registry sweep
 *  from blocking the renderer indefinitely. */
const SCAN_TIMEOUT_MS = 15_000;

/** Bounded timeout for the launch operation — longer than spawn because the
 *  handler may wait for CDP port discovery after spawning the child. */
const LAUNCH_TIMEOUT_MS = 30_000;

export function registerElectronIpc(): void {
  ipcMain.handle(IpcChannel.ELECTRON_SCAN, async () => {
    return withMonitoredTimeout(
      IpcChannel.ELECTRON_SCAN,
      SCAN_TIMEOUT_MS,
      scanElectronApps({ useCache: true }),
    );
  });

  ipcMain.handle(IpcChannel.ELECTRON_LAUNCH, async (_event, request: LaunchRequest) => {
    return withMonitoredTimeout(IpcChannel.ELECTRON_LAUNCH, LAUNCH_TIMEOUT_MS, launchApp(request));
  });
}
