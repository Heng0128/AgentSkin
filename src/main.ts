// SPDX-License-Identifier: MPL-2.0

/**
 * # Main Entry Point
 *
 * Slim bootstrap for the AgentSkin main process. Owns only:
 *   - privileged-protocol scheme registration (must run before app ready)
 *   - single-instance lock + second-instance / open-file routing
 *   - top-level app event handlers (activate / before-quit / window-all-closed)
 *
 * All initialization logic lives in `main/boot-sequence.ts`; IPC handlers in
 * `main/ipc/*`; tray in `main/tray-manager.ts`; window lifecycle in
 * `main/window-manager.ts`; shared state in `main/main-context.ts`.
 */

import { app, dialog, protocol } from 'electron';
import { WALLPAPER_SCHEME } from './main/wallpaper-service';
import { getMainMessages } from './shared/i18n';
import { IpcChannel } from './shared/ipc-channels';
import { toMessage } from './shared/errors';
import type { AgentId } from './shared/types';
import { ctx } from './main/main-context';
import { runBootSequence } from './main/boot-sequence';
import { createMainWindow } from './main/window-manager';
import { extractThemeFilesFromArgv } from './main/file-open';

// Register the wallpaper streaming scheme before the app is ready so the
// sandboxed renderer can load <video> sources via agentskin-wallpaper://.
protocol.registerSchemesAsPrivileged([
  {
    scheme: WALLPAPER_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false },
  },
]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', (_event, argv) => {
  ctx.mainWindow?.show();
  ctx.mainWindow?.focus();
  for (const filePath of extractThemeFilesFromArgv(argv)) ctx.fileOpens.handlePath(filePath);
});

// macOS file associations arrive via open-file (may fire before ready).
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  ctx.fileOpens.handlePath(filePath);
});

app.whenReady()
  .then(() => runBootSequence({
    createWindow: () => createMainWindow({ rendererUrl: process.env.ELECTRON_RENDERER_URL }),
    onQuit,
    onApplyRequest: requestTrayApply,
  }))
  .catch((error) => {
    dialog.showErrorBox(getMainMessages().startupErrorTitle, toMessage(error));
    app.quit();
  });

function onQuit(): void {
  ctx.isQuitting = true;
  app.quit();
}

/**
 * Forward a tray-initiated apply to the renderer, which runs its normal apply
 * flow (including the restart-confirmation dialog when the app is running).
 * The window is surfaced so the resulting toast / dialog is visible.
 */
function requestTrayApply(themeId: string, themeName: string, appId: AgentId): void {
  ctx.mainWindow?.show();
  ctx.mainWindow?.focus();
  ctx.mainWindow?.webContents.send(IpcChannel.TRAY_APPLY, { themeId, themeName, appId });
}

app.on('activate', () => {
  if (ctx.mainWindow) ctx.mainWindow.show();
  else void createMainWindow({ rendererUrl: process.env.ELECTRON_RENDERER_URL });
});

app.on('before-quit', () => {
  ctx.isQuitting = true;
});

app.on('window-all-closed', () => {
  // Keep the manager alive in the tray so route changes can be reinjected.
});
