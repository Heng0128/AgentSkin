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

import { app, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { AGENT_IDS } from '../../shared/types';
import type { ScanProgressEvent } from '../../shared/types/agent';
import type { MainContext } from '../main-context';
import {
  type LaunchRequest,
  launchApp,
  registerAllowedExePaths,
} from '../services/electron-launcher';
import { scanElectronApps } from '../services/electron-scanner';
import { assertTrustedSender } from './trusted-sender';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Bounded timeout for the scan operation — prevents a slow registry sweep
 *  from blocking the renderer indefinitely. */
const SCAN_TIMEOUT_MS = 30_000;

/** Bounded timeout for the launch operation — longer than spawn because the
 *  handler may wait for CDP port discovery after spawning the child. */
const LAUNCH_TIMEOUT_MS = 30_000;

/**
 * Collect the user-configured manual install paths from per-agent `appPath`
 * overrides. These feed the scanner's L3 filesystem sweep so a user can point the
 * launcher at a non-standard install location that L1/L2 would otherwise miss.
 * Paths are deduped case-insensitively on Windows (the only supported platform).
 */
function collectExtraDirs(settings: Pick<MainContext, 'settings'>['settings']): string[] {
  const seen = new Set<string>();
  const extraDirs: string[] = [];
  for (const id of AGENT_IDS) {
    const appPath = settings.overridesFor(id).appPath;
    if (!appPath) continue;
    const key = process.platform === 'win32' ? appPath.toLowerCase() : appPath;
    if (seen.has(key)) continue;
    seen.add(key);
    extraDirs.push(appPath);
  }
  return extraDirs;
}

export function registerElectronIpc(deps: Pick<MainContext, 'settings'>): void {
  // Seed the launch whitelist with user-configured manual install paths up
  // front, so a launch request can be validated even before the first scan.
  registerAllowedExePaths(collectExtraDirs(deps.settings));

  ipcMain.handle(IpcChannel.ELECTRON_SCAN, async (event, force?: boolean) => {
    const sender = event.sender;
    // Route a scan progress event back to the requesting renderer, guarded
    // against a window that died mid-scan (GPU crash / closed window).
    const send = (scanEvent: ScanProgressEvent) => {
      if (sender && !sender.isDestroyed()) {
        sender.send(IpcChannel.ELECTRON_SCAN_PROGRESS, scanEvent);
      }
    };
    const result = await withMonitoredTimeout(
      IpcChannel.ELECTRON_SCAN,
      SCAN_TIMEOUT_MS,
      scanElectronApps({
        // `force` bypasses the in-process cache so a manual "rescan" actually
        // re-walks the filesystem instead of replaying the last result.
        useCache: !force,
        // Fold in user-set manual install paths so they participate in the L3
        // filesystem sweep (per-agent `appPath` overrides from settings).
        extraDirs: collectExtraDirs(deps.settings),
        // Stream identity-merged progress (add/update) so the launcher shows
        // tiles appearing one product at a time instead of a final pop.
        onApp: send,
        // Wire the Electron userData root so the scanner can read the
        // persisted cross-session cache on a cold start and write a fresh one
        // after each successful scan. Stale (uninstalled) apps are pruned by
        // existence validation inside the scanner.
        userDataPath: app.getPath('userData'),
      }),
    );
    // Icons are now enriched inside the scanner (`enrichIcons`) — the result
    // arriving here already carries icons, and both the in-memory + persisted
    // caches were written with the enriched result. No IPC-layer work needed.
    // Seed the launch whitelist from every scanned app so `ELECTRON_LAUNCH`
    // can validate the requested exePath against known-good targets.
    registerAllowedExePaths([...result.adapted, ...result.other].map((a) => a.exePath));
    return result;
  });

  ipcMain.handle(IpcChannel.ELECTRON_LAUNCH, async (event, request: LaunchRequest) => {
    assertTrustedSender(event);
    return withMonitoredTimeout(IpcChannel.ELECTRON_LAUNCH, LAUNCH_TIMEOUT_MS, launchApp(request));
  });
}
