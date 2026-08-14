// SPDX-License-Identifier: MPL-2.0

/**
 * # IPC Registration Aggregator
 *
 * Entry point for IPC handler registration. Replaces the monolithic
 * `registerIpc()` function in `main.ts` (H3). Each domain module owns its
 * own handlers; this file just calls them in order.
 *
 * `ctx` is forwarded to every module so handlers receive their dependencies
 * via parameter injection (no implicit singleton import), enabling unit
 * testing with mock contexts.
 *
 * `updateTrayMenu` is forwarded only to modules whose handlers mutate
 * tray-visible state (core: locale; theme: apply/restore/import/delete).
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';
import { createStudioWindow } from '../window-manager';
import { registerBundleIpc } from './bundle-ipc';
import { registerConcurrencyMetricsIpc } from './concurrency-metrics-ipc';
import { registerCoreIpc } from './core-ipc';
import { registerElectronIpc } from './electron-ipc';
import { registerEnvironmentIpc } from './environment-ipc';
import { registerPerformanceIpc } from './performance-ipc';
import { registerSettingsIpc } from './settings-ipc';
import { registerStudioIpc } from './studio-ipc';
import { registerStudioProjectIpc } from './studio-project-ipc';
import { registerStudioWorkspaceIpc } from './studio-workspace-ipc';
import { registerThemeIpc } from './theme-ipc';
import { registerVisualAnalyzerIpc } from './visual-analyzer-ipc';
import { registerWallpaperIpc } from './wallpaper-ipc';
import { registerWindowIpc } from './window-ipc';
import { withMonitoredTimeout } from './with-monitored-timeout';

export function registerIpc(ctx: MainContext, updateTrayMenu: () => Promise<void>): void {
  registerCoreIpc(ctx, updateTrayMenu);
  registerThemeIpc(ctx, updateTrayMenu);
  registerBundleIpc(ctx, updateTrayMenu);
  registerSettingsIpc(ctx);
  registerWallpaperIpc(ctx);
  registerPerformanceIpc();
  // Concurrency-metrics push (main → renderer via webContents.send every 5s)
  // + the renderer→main update path for renderer-side primitive sizes.
  registerConcurrencyMetricsIpc(ctx);
  registerWindowIpc();
  registerVisualAnalyzerIpc({
    getStatus: () => ctx.core.status(),
    emitStatus: (payload) => {
      // Push progress events to the main window. Both get and emit paths are
      // optional — `setImmediate`-driven initial pulse fires after the window
      // is fully initialized; if the window is not yet ready, the webContents
      // call simply no-ops.
      ctx.mainWindow?.webContents.send(IpcChannel.VISUAL_ANALYSIS_STATUS, payload);
    },
  });
  registerEnvironmentIpc(ctx);
  registerElectronIpc();

  // Open (or focus) the dedicated Theme Studio window on demand. The renderer
  // env exposes ELECTRON_RENDERER_URL in dev so we can point the studio window
  // at the vite dev server's `studio.html`; in prod we load the built file.
  //
  // The handler is async so that any exception from createStudioWindow propagates
  // back to the renderer via IPC rejection (instead of becoming an unhandled
  // rejection that silently swallows the error — the renderer would see "no
  // response" after a 30s timeout).
  ipcMain.handle(IpcChannel.STUDIO_OPEN, async () => {
    await withMonitoredTimeout(
      IpcChannel.STUDIO_OPEN,
      30000,
      createStudioWindow({ rendererUrl: process.env.ELECTRON_RENDERER_URL }),
    );
    return { ok: true };
  });

  const { stopAllInspects } = registerStudioIpc({
    applyTheme: (request) => ctx.core.apply(request),
    restoreApp: (appId) => ctx.core.restore(appId),
    getActiveThemeId: async (appId) => {
      const status = await ctx.core.status();
      const app = status.apps.find((a) => a.appId === appId);
      return app?.activeThemeId ?? null;
    },
    resolveLivePort: async (appId) => {
      const status = await ctx.core.status();
      const app = status.apps.find((a) => a.appId === appId);
      return app?.port ?? null;
    },
    getThemeName: async (themeId) => {
      const theme = await ctx.themeCatalog.getTheme(themeId);
      return theme?.name ?? null;
    },
    log: (line: string) => console.log(line),
    // Studio snapshot/inspect events are pushed back to whichever window
    // requested them. The studio now lives in its own window, so prefer
    // `studioWindow`; fall back to the main window for safety.
    push: (channel: string, payload: unknown) => {
      const target = ctx.studioWindow ?? ctx.mainWindow;
      target?.webContents.send(channel, payload);
    },
  });

  // Tear down any live CDP inspect session when the studio window closes —
  // otherwise the WebSocket stays open and the agent is left in
  // Overlay.inspectMode until the next start/stop cycle.
  ctx.onStudioWindowClosed = () => {
    void stopAllInspects();
  };

  // Studio "工程" (projects) — self-contained, file-backed, no installed themes.
  registerStudioProjectIpc();

  // Studio Workspace — image→theme extraction, wallpaper picker, bundle management.
  registerStudioWorkspaceIpc(ctx);
}
