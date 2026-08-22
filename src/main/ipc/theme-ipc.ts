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

import { dialog, ipcMain } from 'electron';
import { MAX_THEME_PACKAGE_BYTES as MAX_IMPORT_BYTES } from '../../../src/engine/src/theme/package.mjs';
import { agentThemeExtension } from '../../legacy/agentskin-core-runtime';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { type ApplyRequest, isAgentId } from '../../shared/types';
import { isThemePackagePath } from '../file-open';
import { type MainContext, notifyStatusChanged, sendLog, wrapCatalog } from '../main-context';
import type { RegenResult } from '../theme-asset/fingerprint';
import { regenerateTheme } from '../theme-asset/fingerprint';
import { assertAgentId, assertNonEmptyString, assertSafeThemeId } from './ipc-validators';
import { assertTrustedSender } from './trusted-sender';
import { withMonitoredTimeout } from './with-monitored-timeout';

// Single source of truth for max theme package size — shared with the engine layer.
const THEME_PACKAGE_EXTENSIONS = ['agenttheme', 'agentskin-theme', 'codex-theme'];

export function registerThemeIpc(deps: MainContext, updateTrayMenu: () => Promise<void>): void {
  // --- Catalog reads ---
  ipcMain.handle(IpcChannel.THEME_LIST, async () =>
    wrapCatalog(await deps.themeCatalog.listThemes()),
  );

  ipcMain.handle(IpcChannel.THEME_GET, (_event, id: unknown) => {
    assertSafeThemeId(id);
    return deps.themeCatalog.getTheme(id);
  });

  ipcMain.handle(IpcChannel.THEME_SEARCH, async (_event, query: unknown) => {
    assertNonEmptyString(query, getMainMessages().invalidSearchQuery);
    return wrapCatalog(await deps.themeCatalog.searchThemes(query));
  });

  ipcMain.handle(IpcChannel.THEME_FILTER, async (_event, agentId: unknown) => {
    assertAgentId(agentId);
    return wrapCatalog(await deps.themeCatalog.filterByAgent(agentId));
  });

  // --- Apply / restore ---
  ipcMain.handle(IpcChannel.THEME_APPLY, async (_event, request: ApplyRequest) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_APPLY,
      30000,
      (async () => {
        if (!request || !isAgentId(request.appId) || typeof request.themeId !== 'string') {
          throw new Error(getMainMessages().invalidApplyRequest);
        }
        const result = await deps.core.apply(request);
        void updateTrayMenu();
        notifyStatusChanged();
        return result;
      })(),
    );
  });

  ipcMain.handle(IpcChannel.THEME_RESTORE, async (_event, appId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_RESTORE,
      30000,
      (async () => {
        assertAgentId(appId);
        const result = await deps.core.restore(appId);
        void updateTrayMenu();
        notifyStatusChanged();
        return result;
      })(),
    );
  });

  // --- Package import / export / delete ---
  ipcMain.handle(IpcChannel.THEME_IMPORT, async () => {
    return withMonitoredTimeout(
      IpcChannel.THEME_IMPORT,
      30000,
      (async () => {
        const copy = getMainMessages();
        const opts = {
          title: copy.importDialogTitle,
          properties: ['openFile' as const],
          filters: [{ name: copy.themePackageFilter, extensions: THEME_PACKAGE_EXTENSIONS }],
        };
        const selection = deps.mainWindow
          ? await dialog.showOpenDialog(deps.mainWindow, opts)
          : await dialog.showOpenDialog(opts);
        if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
        const theme = await deps.library.importPackage(selection.filePaths[0]);
        void updateTrayMenu();
        notifyStatusChanged();
        return { canceled: false, path: selection.filePaths[0], theme };
      })(),
    );
  });

  // General capability for marketplace / cloud catalog / network theme downloads.
  // Intentionally NOT used for built-in theme seeding — that is owned by the
  // main-process ThemeSeeder on boot.
  ipcMain.handle(
    IpcChannel.THEME_IMPORT_BYTES,
    async (_event, bytes: unknown, suggestedId: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.THEME_IMPORT_BYTES,
        15000,
        (async () => {
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
          notifyStatusChanged();
          return { theme, themes: await deps.library.summaries() };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.THEME_IMPORT_PATH, async (event, filePath: unknown) => {
    assertTrustedSender(event);
    return withMonitoredTimeout(
      IpcChannel.THEME_IMPORT_PATH,
      30000,
      (async () => {
        if (typeof filePath !== 'string' || !isThemePackagePath(filePath)) {
          throw new Error(getMainMessages().invalidPackage);
        }
        const theme = await deps.library.importPackage(filePath);
        void updateTrayMenu();
        notifyStatusChanged();
        return { theme, themes: await deps.library.summaries() };
      })(),
    );
  });

  ipcMain.handle(IpcChannel.THEME_OPEN_FILE, (event, filePath: unknown) => {
    assertTrustedSender(event);
    if (typeof filePath !== 'string' || !isThemePackagePath(filePath)) {
      throw new Error(getMainMessages().invalidPackage);
    }
    deps.fileOpens.handlePath(filePath);
  });

  ipcMain.handle(IpcChannel.THEME_EXPORT, async (_event, themeId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_EXPORT,
      30000,
      (async () => {
        assertSafeThemeId(themeId);
        const copy = getMainMessages();
        const entry = await deps.library.find(themeId);
        const saveOpts = {
          title: copy.exportDialogTitle,
          defaultPath: `${entry.bundle.theme.id}-${entry.bundle.theme.version}${agentThemeExtension}`,
          filters: [{ name: copy.themePackageFilter, extensions: THEME_PACKAGE_EXTENSIONS }],
        };
        const selection = deps.mainWindow
          ? await dialog.showSaveDialog(deps.mainWindow, saveOpts)
          : await dialog.showSaveDialog(saveOpts);
        if (selection.canceled || !selection.filePath) return { canceled: true };
        await deps.library.exportPackage(themeId, selection.filePath);
        return { canceled: false, path: selection.filePath };
      })(),
    );
  });

  ipcMain.handle(IpcChannel.THEME_DELETE, async (_event, themeId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.THEME_DELETE,
      60000,
      (async () => {
        assertSafeThemeId(themeId);
        const status = await deps.core.status();
        const restoreFailures: string[] = [];
        for (const appStatus of status.apps) {
          if (appStatus.activeThemeId === themeId) {
            try {
              await deps.core.restore(appStatus.appId);
            } catch (error) {
              // A single restore failure must not abort the entire delete
              // operation. Log and continue so the remaining agents still get
              // restored and the theme is removed from the library.
              const reason = (error as Error)?.message ?? String(error);
              restoreFailures.push(`${appStatus.appId}: ${reason}`);
            }
          }
        }
        if (restoreFailures.length > 0) {
          sendLog(
            `[theme] delete ${themeId}: ${restoreFailures.length} restore(s) failed: ${restoreFailures.join('; ')}`,
          );
        }
        await deps.library.delete(themeId);
        void updateTrayMenu();
        notifyStatusChanged();
        return {
          themes: await deps.library.summaries(),
          status: await deps.core.status(),
          ...(restoreFailures.length > 0 ? { restoreFailures } : {}),
        };
      })(),
    );
  });

  // --- P3 Self-Healing manual regen ---
  // User-triggered regen from Diagnostics UI. Executes the regen thunk
  // synchronously and returns the result so the UI can show feedback.
  ipcMain.handle(
    IpcChannel.THEME_MANUAL_REGEN,
    async (_event, agentId: unknown, themeId: unknown): Promise<RegenResult> => {
      return withMonitoredTimeout(
        IpcChannel.THEME_MANUAL_REGEN,
        15000,
        (async () => {
          assertAgentId(agentId);
          assertSafeThemeId(themeId);
          // Note: manual regen requires colors from the installed theme.
          // For now, the thunk will fail gracefully if colors are unavailable.
          // TODO: Pass colors from the Diagnostics UI or look up from library.
          const thunk = regenerateTheme(agentId, themeId);
          return await thunk();
        })(),
      );
    },
  );
}
