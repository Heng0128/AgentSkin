// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme IPC
 *
 * All theme-related IPC handlers: catalog reads (list/get/search/filter),
 * apply/restore, and package import/export/delete. Extracted from the
 * monolithic `registerIpc` in `main.ts` (H3).
 *
 * `updateTrayMenu` is injected because apply/restore/import/delete all
 * mutate state that the tray menu reflects.
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { agentThemeExtension } from '../../legacy/agentskin-core-runtime';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { type ApplyRequest, isAgentId } from '../../shared/types';
import { isThemePackagePath } from '../file-open';
import { type MainContext, wrapCatalog } from '../main-context';

/**
 * Reject theme ids that could escape the library directory via path
 * traversal. The library layer (`isSafeThemeId`) already enforces a strict
 * `[a-z0-9][a-z0-9_-]*` shape, but IPC is the trust boundary — fail fast
 * here so malicious renderer input never reaches the filesystem layer.
 */
function isSafeThemeIdInput(id: string): boolean {
  return (
    !!id && !id.includes('..') && !path.isAbsolute(id) && !id.includes('/') && !id.includes('\\')
  );
}

// Maximum allowed theme package size for `theme:import-bytes` (prevents OOM
// attacks from malicious marketplace / cloud-catalog payloads).
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const THEME_PACKAGE_EXTENSIONS = [
  'agenttheme',
  'agentskin-theme',
  'codedrobe-theme',
  'codex-theme',
];

export function registerThemeIpc(deps: MainContext, updateTrayMenu: () => Promise<void>): void {
  // --- Catalog reads ---
  ipcMain.handle(IpcChannel.THEME_LIST, async () =>
    wrapCatalog(await deps.themeCatalog.listThemes()),
  );

  ipcMain.handle(IpcChannel.THEME_GET, (_event, id: unknown) => {
    if (typeof id !== 'string' || !isSafeThemeIdInput(id)) throw new Error('Invalid theme id.');
    return deps.themeCatalog.getTheme(id);
  });

  ipcMain.handle(IpcChannel.THEME_SEARCH, async (_event, query: unknown) => {
    if (typeof query !== 'string') throw new Error('Invalid search query.');
    return wrapCatalog(await deps.themeCatalog.searchThemes(query));
  });

  ipcMain.handle(IpcChannel.THEME_FILTER, async (_event, agentId: unknown) => {
    if (!isAgentId(agentId)) throw new Error('Invalid agent id.');
    return wrapCatalog(await deps.themeCatalog.filterByAgent(agentId));
  });

  // --- Apply / restore ---
  ipcMain.handle(IpcChannel.THEME_APPLY, async (_event, request: ApplyRequest) => {
    if (!request || !isAgentId(request.appId) || typeof request.themeId !== 'string') {
      throw new Error('Invalid apply request.');
    }
    const result = await deps.core.apply(request);
    void updateTrayMenu();
    return result;
  });

  ipcMain.handle(IpcChannel.THEME_RESTORE, async (_event, appId: unknown) => {
    if (!isAgentId(appId)) throw new Error('Invalid app id.');
    const result = await deps.core.restore(appId);
    void updateTrayMenu();
    return result;
  });

  // --- Package import / export / delete ---
  ipcMain.handle(IpcChannel.THEME_IMPORT, async () => {
    const copy = getMainMessages();
    const selection = await dialog.showOpenDialog(deps.mainWindow!, {
      title: copy.importDialogTitle,
      properties: ['openFile'],
      filters: [{ name: copy.themePackageFilter, extensions: THEME_PACKAGE_EXTENSIONS }],
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    const theme = await deps.library.importPackage(selection.filePaths[0]);
    void updateTrayMenu();
    return { canceled: false, path: selection.filePaths[0], theme };
  });

  // General capability for marketplace / cloud catalog / network theme downloads.
  // Intentionally NOT used for built-in theme seeding — that is owned by the
  // main-process ThemeSeeder on boot.
  ipcMain.handle(
    IpcChannel.THEME_IMPORT_BYTES,
    async (_event, bytes: unknown, suggestedId: unknown) => {
      if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) {
        throw new Error(getMainMessages().invalidPackage);
      }
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array);
      if (buffer.length > MAX_IMPORT_BYTES) {
        throw new Error(getMainMessages().packageTooLarge(MAX_IMPORT_BYTES / 1024 / 1024));
      }
      if (typeof suggestedId !== 'string') throw new Error(getMainMessages().invalidPackage);
      const theme = await deps.library.installBytes(buffer, suggestedId);
      void updateTrayMenu();
      return { theme, themes: await deps.library.summaries() };
    },
  );

  ipcMain.handle(IpcChannel.THEME_IMPORT_PATH, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !isThemePackagePath(filePath)) {
      throw new Error(getMainMessages().invalidPackage);
    }
    const theme = await deps.library.importPackage(filePath);
    void updateTrayMenu();
    return { theme, themes: await deps.library.summaries() };
  });

  ipcMain.handle(IpcChannel.THEME_OPEN_FILE, (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !isThemePackagePath(filePath)) {
      throw new Error(getMainMessages().invalidPackage);
    }
    deps.fileOpens.handlePath(filePath);
  });

  ipcMain.handle(IpcChannel.THEME_EXPORT, async (_event, themeId: unknown) => {
    if (typeof themeId !== 'string' || !isSafeThemeIdInput(themeId))
      throw new Error('Invalid theme id.');
    const copy = getMainMessages();
    const entry = await deps.library.find(themeId);
    const selection = await dialog.showSaveDialog(deps.mainWindow!, {
      title: copy.exportDialogTitle,
      defaultPath: `${entry.bundle.theme.id}-${entry.bundle.theme.version}${agentThemeExtension}`,
      filters: [{ name: copy.themePackageFilter, extensions: THEME_PACKAGE_EXTENSIONS }],
    });
    if (selection.canceled || !selection.filePath) return { canceled: true };
    await deps.library.exportPackage(themeId, selection.filePath);
    return { canceled: false, path: selection.filePath };
  });

  ipcMain.handle(IpcChannel.THEME_DELETE, async (_event, themeId: unknown) => {
    if (typeof themeId !== 'string' || !isSafeThemeIdInput(themeId))
      throw new Error('Invalid theme id.');
    const status = await deps.core.status();
    for (const appStatus of status.apps) {
      if (appStatus.activeThemeId === themeId) await deps.core.restore(appStatus.appId);
    }
    await deps.library.delete(themeId);
    void updateTrayMenu();
    return { themes: await deps.library.summaries(), status: await deps.core.status() };
  });
}
