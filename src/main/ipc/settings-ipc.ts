// SPDX-License-Identifier: MPL-2.0

/**
 * # Settings IPC
 *
 * Settings-related IPC handlers: get current settings, pick/clear app
 * install path, and set explicit CDP port override. Extracted from the
 * monolithic `registerIpc` in `main.ts` (H3).
 *
 * These handlers don't refresh the tray menu (settings changes don't affect
 * tray-visible state), so no `updateTrayMenu` dep is needed.
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import { dialog, ipcMain } from 'electron';
import { settingsDto, type MainContext } from '../main-context';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { isAgentId, type SettingsUpdateResult } from '../../shared/types';

export function registerSettingsIpc(deps: MainContext): void {
  ipcMain.handle(IpcChannel.SETTINGS_GET, () => settingsDto(deps));

  ipcMain.handle(
    IpcChannel.SETTINGS_PICK_APP_PATH,
    async (_event, appId: unknown): Promise<SettingsUpdateResult & { canceled: boolean }> => {
      if (!isAgentId(appId)) throw new Error('Invalid app id.');
      const copy = getMainMessages();
      const selection = await dialog.showOpenDialog(deps.mainWindow!, {
        title: copy.pickAppDialogTitle(appId),
        properties: ['openFile'],
        filters: process.platform === 'win32'
          ? [{ name: 'Programs', extensions: ['exe'] }]
          : [{ name: 'Applications', extensions: ['app'] }],
      });
      if (selection.canceled || !selection.filePaths[0]) {
        return { canceled: true, settings: settingsDto(deps), status: await deps.core.status() };
      }
      await deps.settings.setAppPath(appId, selection.filePaths[0]);
      return { canceled: false, settings: settingsDto(deps), status: await deps.core.status() };
    },
  );

  ipcMain.handle(IpcChannel.SETTINGS_CLEAR_APP_PATH, async (_event, appId: unknown): Promise<SettingsUpdateResult> => {
    if (!isAgentId(appId)) throw new Error('Invalid app id.');
    await deps.settings.setAppPath(appId, null);
    return { settings: settingsDto(deps), status: await deps.core.status() };
  });

  ipcMain.handle(IpcChannel.SETTINGS_SET_APP_PORT, async (_event, appId: unknown, port: unknown): Promise<SettingsUpdateResult> => {
    if (!isAgentId(appId)) throw new Error('Invalid app id.');
    if (port !== null && (!Number.isInteger(port) || (port as number) < 1024 || (port as number) > 65535)) {
      throw new Error('INVALID_PORT');
    }
    await deps.settings.setAppPort(appId, port as number | null);
    return { settings: settingsDto(deps), status: await deps.core.status() };
  });
}
