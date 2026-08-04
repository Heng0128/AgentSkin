// SPDX-License-Identifier: MPL-2.0

/**
 * # Core IPC
 *
 * Cross-cutting IPC handlers that don't belong to a single domain:
 * app bootstrap, locale, system status, agent list, and shell integration.
 * Extracted from the monolithic `registerIpc` in `main.ts` (H3).
 *
 * `updateTrayMenu` is injected because `locale:set` and `app:bootstrap`
 * can change menu-visible state (locale labels, file-open sink wiring).
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import { app, ipcMain, shell } from 'electron';
import { getMainMessages, isAppLocale, setMainLocale } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { saveLocalePreference } from '../locale-preferences';
import { handleThemeFileOpen, type MainContext, wrapCatalog } from '../main-context';
import { assertNonEmptyString } from './ipc-validators';

export function registerCoreIpc(deps: MainContext, updateTrayMenu: () => Promise<void>): void {
  ipcMain.handle(IpcChannel.APP_BOOTSTRAP, async () => {
    deps.fileOpens.setSink((filePath) => void handleThemeFileOpen(deps, filePath, updateTrayMenu));
    // Bootstrap returns ONLY fast data (locale + version). Status and themes
    // are fetched separately via refreshStatus()/catalog — including them here
    // blocked the UI on agent detection (CDP probing for all 4 agents), which
    // takes seconds and left the environment list blank until detection finished.
    return {
      themes: [],
      status: { apps: [], platform: process.platform === 'win32' ? 'win32' : 'darwin' },
      locale: deps.locale,
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle(IpcChannel.LOCALE_SET, async (_event, nextLocale: unknown) => {
    if (!isAppLocale(nextLocale)) throw new Error(getMainMessages().invalidLocale);
    deps.locale = nextLocale;
    setMainLocale(deps.locale);
    await saveLocalePreference(deps.userDataRoot, deps.locale);
    void updateTrayMenu();
  });

  ipcMain.handle(IpcChannel.SYSTEM_STATUS, () => deps.core.status());

  ipcMain.handle(IpcChannel.AGENT_LIST, async () => {
    const items = deps.agentCatalog.listAgents();
    const sysStatus = await deps.core.status();
    const merged = items.map((item) => {
      if (!item.supported) return item;
      const appStatus = sysStatus.apps.find((a) => a.appId === item.id);
      return {
        ...item,
        status: {
          installed: appStatus?.installed ?? false,
          running: appStatus?.running ?? false,
          debugReady: appStatus?.debugReady ?? false,
        },
      };
    });
    return wrapCatalog(merged);
  });

  ipcMain.handle(IpcChannel.SHELL_SHOW_ITEM, (_event, itemPath: unknown) => {
    assertNonEmptyString(itemPath, getMainMessages().invalidPath);
    return shell.showItemInFolder(itemPath);
  });
}
