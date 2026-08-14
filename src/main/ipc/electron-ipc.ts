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
import type { ElectronScanResult } from '../../shared/types/agent';
import { extractAppIcon } from '../services/app-icon';
import { type LaunchRequest, launchApp } from '../services/electron-launcher';
import { scanElectronApps } from '../services/electron-scanner';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Bounded timeout for the scan operation — prevents a slow registry sweep
 *  from blocking the renderer indefinitely. */
const SCAN_TIMEOUT_MS = 30_000;

/** Bounded timeout for the launch operation — longer than spawn because the
 *  handler may wait for CDP port discovery after spawning the child. */
const LAUNCH_TIMEOUT_MS = 30_000;

/**
 * Attach real app icons (data URLs) to unadapted apps. Adapted apps already
 * render their bundled brand logo on the renderer side (`AppMark`), so we skip
 * the exe-icon extraction for them. Icons resolve in parallel and any failure
 * degrades to the renderer's letter placeholder.
 */
async function attachIcons(result: ElectronScanResult): Promise<ElectronScanResult> {
  const adapted = result.adapted;
  const otherWithIcons = await Promise.all(
    result.other.map(async (app) => {
      const iconPath = await extractAppIcon(app.exePath);
      return iconPath ? { ...app, iconPath } : app;
    }),
  );
  return { adapted, other: otherWithIcons };
}

export function registerElectronIpc(): void {
  ipcMain.handle(IpcChannel.ELECTRON_SCAN, async (event, force?: boolean) => {
    const sender = event.sender;
    const result = await withMonitoredTimeout(
      IpcChannel.ELECTRON_SCAN,
      SCAN_TIMEOUT_MS,
      scanElectronApps({
        // `force` bypasses the in-process cache so a manual "rescan" actually
        // re-walks the filesystem instead of replaying the last result.
        useCache: !force,
        // Stream each newly-discovered app to the renderer so the launcher can
        // show tiles appearing in real time instead of one final pop.
        onApp: (app) => {
          if (sender && !sender.isDestroyed()) {
            sender.send(IpcChannel.ELECTRON_SCAN_PROGRESS, app);
          }
        },
      }),
    );
    // Icon extraction runs outside the scan timeout budget — it is a cosmetic
    // enrichment and should never fail the whole scan.
    return attachIcons(result);
  });

  ipcMain.handle(IpcChannel.ELECTRON_LAUNCH, async (_event, request: LaunchRequest) => {
    return withMonitoredTimeout(IpcChannel.ELECTRON_LAUNCH, LAUNCH_TIMEOUT_MS, launchApp(request));
  });
}
