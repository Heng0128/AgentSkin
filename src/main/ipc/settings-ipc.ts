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
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { sanitizeCSS } from '../../shared/safe-css';
import type { SettingsUpdateResult } from '../../shared/types';
import { type MainContext, notifyStatusChanged, settingsDto } from '../main-context';
import { assertAgentId, assertPortOrNull } from './ipc-validators';
import { assertTrustedSender } from './trusted-sender';
import { withMonitoredTimeout } from './with-monitored-timeout';

export function registerSettingsIpc(deps: MainContext): void {
  ipcMain.handle(IpcChannel.SETTINGS_GET, () => settingsDto(deps));

  ipcMain.handle(
    IpcChannel.SETTINGS_PICK_APP_PATH,
    async (_event, appId: unknown): Promise<SettingsUpdateResult & { canceled: boolean }> => {
      return withMonitoredTimeout(
        IpcChannel.SETTINGS_PICK_APP_PATH,
        30000,
        (async () => {
          assertAgentId(appId);
          const copy = getMainMessages();
          const opts: Electron.OpenDialogOptions = {
            title: copy.pickAppDialogTitle(appId),
            properties: ['openFile'],
            filters:
              process.platform === 'win32'
                ? [{ name: 'Programs', extensions: ['exe'] }]
                : [{ name: 'Applications', extensions: ['app'] }],
          };
          // Guard against null mainWindow (e.g. renderer holds stale reference after window destroyed).
          const selection = deps.mainWindow
            ? await dialog.showOpenDialog(deps.mainWindow, opts)
            : await dialog.showOpenDialog(opts);
          if (selection.canceled || !selection.filePaths[0]) {
            return {
              canceled: true,
              settings: settingsDto(deps),
              status: await deps.core.status(),
            };
          }
          await deps.settings.setAppPath(appId, selection.filePaths[0]);
          notifyStatusChanged();
          return { canceled: false, settings: settingsDto(deps), status: await deps.core.status() };
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.SETTINGS_CLEAR_APP_PATH,
    async (_event, appId: unknown): Promise<SettingsUpdateResult> => {
      return withMonitoredTimeout(
        IpcChannel.SETTINGS_CLEAR_APP_PATH,
        30000,
        (async () => {
          assertAgentId(appId);
          await deps.settings.setAppPath(appId, null);
          notifyStatusChanged();
          return { settings: settingsDto(deps), status: await deps.core.status() };
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.SETTINGS_SET_APP_PORT,
    async (_event, appId: unknown, port: unknown): Promise<SettingsUpdateResult> => {
      return withMonitoredTimeout(
        IpcChannel.SETTINGS_SET_APP_PORT,
        30000,
        (async () => {
          assertAgentId(appId);
          assertPortOrNull(port);
          await deps.settings.setAppPort(appId, port as number | null);
          notifyStatusChanged();
          return { settings: settingsDto(deps), status: await deps.core.status() };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.SETTINGS_GET_CUSTOM_CSS, () => deps.settings.customThemeCss());

  ipcMain.handle(
    IpcChannel.SETTINGS_SET_LIVE_DOM_REFRESH_INTERVAL,
    async (_event, interval: unknown): Promise<SettingsUpdateResult> => {
      return withMonitoredTimeout(
        IpcChannel.SETTINGS_SET_LIVE_DOM_REFRESH_INTERVAL,
        15000,
        (async () => {
          if (
            typeof interval !== 'number' ||
            !Number.isFinite(interval) ||
            interval < 0 ||
            !Number.isInteger(interval)
          ) {
            throw new Error(getMainMessages().invalidLiveDomRefreshInterval);
          }
          await deps.settings.setLiveDomRefreshInterval(interval);
          notifyStatusChanged();
          return { settings: settingsDto(deps), status: await deps.core.status() };
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.SETTINGS_SET_CUSTOM_CSS,
    async (event, css: unknown): Promise<SettingsUpdateResult> => {
      assertTrustedSender(event);
      return withMonitoredTimeout(
        IpcChannel.SETTINGS_SET_CUSTOM_CSS,
        15000,
        (async () => {
          if (typeof css !== 'string' || css.length > 256 * 1024) {
            throw new Error(getMainMessages().invalidCustomCss);
          }
          // Sanitize before persisting so the stored value (and everything
          // downstream in the CDP injection path) only ever holds clean CSS.
          // Mirrors the sanitization already applied on the tweak + Studio
          // RealDomPreview paths — this was the one integration gap.
          const { clean } = sanitizeCSS(css);
          await deps.settings.setCustomThemeCss(clean);
          notifyStatusChanged();
          return { settings: settingsDto(deps), status: await deps.core.status() };
        })(),
      );
    },
  );
}
