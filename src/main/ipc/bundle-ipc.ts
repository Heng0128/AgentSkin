// SPDX-License-Identifier: MPL-2.0

/**
 * # Bundle IPC — `.agentskin-bundle` 组合包（Theme + Wallpaper）
 *
 * bundle 是"目录包 + 壁纸视频"的 tar.gz 单文件容器：
 *
 *   - `bundle:create`：把某主题的目录包（pywal userData/wallpaper-themes
 *     或内置 themes/）打包为 .agentskin-bundle 供用户保存/分享。
 *   - `bundle:install`：选择 .agentskin-bundle 文件 → 解包到
 *     userData/bundles/<id>/ → loader 校验 → installer 装入 ThemeLibrary →
 *     注册捆绑的视频壁纸。
 *
 * `installBundleFromPath` 供文件打开分流（file-open.ts）复用，避免两套逻辑。
 */

import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import type { InstalledTheme } from '../../shared/types';
import { ThemeInstaller } from '../catalog/theme-installer';
import { ThemePackageLoader } from '../catalog/theme-package-loader';
import { extractTarGz, packDirToTarGz } from '../fs/tar-pack';
import { type MainContext, notifyStatusChanged } from '../main-context';
import { registerThemeWallpaperForInstalled } from '../wallpaper/theme-wallpaper';
import { assertNonEmptyString, assertSafeThemeId } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

export const BUNDLE_EXTENSION = '.agentskin-bundle';

/** bundle 解包/持久化根（userData/bundles/<themeId>/）。 */
export function bundlesDir(userDataRoot: string): string {
  return path.join(userDataRoot, 'bundles');
}

/** 候选目录包来源：pywal 区优先（含壁纸 video），其次内置 themes/。 */
function findPackageDir(userDataRoot: string, themeId: string): string | null {
  const candidates = [
    path.join(userDataRoot, 'wallpaper-themes', themeId),
    path.join(app.getAppPath(), 'themes', themeId),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/**
 * 安装一个 .agentskin-bundle 文件：解包 → 校验 → 装库 → 注册壁纸。
 * 返回安装的主题；失败抛错（由调用方 toast / 分流）。
 */
export async function installBundleFromPath(
  deps: MainContext,
  filePath: string,
): Promise<InstalledTheme> {
  const dir = bundlesDir(deps.userDataRoot);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-bundle-'));
  try {
    await extractTarGz(filePath, tmp);
    const names = await fs.readdir(tmp, { withFileTypes: true });
    // 解包根必须恰好一个主题目录（bundle 打包时以主题目录为 tar 根）。
    const themeDir = names.find((n) => n.isDirectory());
    if (!themeDir) throw new Error(getMainMessages().invalidBundle);
    const themeId = themeDir.name;
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(themeId)) {
      throw new Error(getMainMessages().invalidBundle);
    }
    const pkgRoot = path.join(dir, themeId);
    // 先清旧包，再整目录搬入（避免残留旧文件）。
    await fs.rm(pkgRoot, { recursive: true, force: true });
    await fs.rename(path.join(tmp, themeId), pkgRoot);

    const loader = new ThemePackageLoader(dir);
    const pkg = await loader.load(themeId);
    const installer = new ThemeInstaller(deps.library);
    const installed = await installer.install(pkg, dir);
    // 主题捆绑的视频壁纸 → 注册为 theme:<id>（运行期注册点）。
    await registerThemeWallpaperForInstalled(deps, installed, dir);
    return installed;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerBundleIpc(deps: MainContext, updateTrayMenu: () => Promise<void>): void {
  const copy = getMainMessages();

  ipcMain.handle(IpcChannel.BUNDLE_CREATE, async (_event, themeId) => {
    return withMonitoredTimeout(
      IpcChannel.BUNDLE_CREATE,
      60000,
      (async () => {
        assertSafeThemeId(themeId);
        const dir = findPackageDir(deps.userDataRoot, themeId);
        if (!dir) throw new Error(copy.bundleNoSource(themeId));
        const saveOpts = {
          title: copy.bundleExportDialogTitle,
          defaultPath: `${themeId}${BUNDLE_EXTENSION}`,
          filters: [{ name: copy.bundleFilter, extensions: ['agentskin-bundle'] }],
        };
        const selection = deps.mainWindow
          ? await dialog.showSaveDialog(deps.mainWindow, saveOpts)
          : await dialog.showSaveDialog(saveOpts);
        if (selection.canceled || !selection.filePath) return { canceled: true };
        await packDirToTarGz(dir, selection.filePath);
        return { canceled: false, path: selection.filePath };
      })(),
    );
  });

  ipcMain.handle(IpcChannel.BUNDLE_INSTALL, async () => {
    return withMonitoredTimeout(
      IpcChannel.BUNDLE_INSTALL,
      60000,
      (async () => {
        const selection = await dialog.showOpenDialog({
          title: copy.bundleInstallDialogTitle,
          properties: ['openFile'],
          filters: [{ name: copy.bundleFilter, extensions: ['agentskin-bundle'] }],
        });
        if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
        const theme = await installBundleFromPath(deps, selection.filePaths[0]);
        void updateTrayMenu();
        notifyStatusChanged();
        return { canceled: false, theme };
      })(),
    );
  });

  // 供 file-open 分流：bundle 扩展名走这里（断言在调用方已做）。
  ipcMain.handle(IpcChannel.BUNDLE_OPEN_FILE, async (_event, filePath) => {
    return withMonitoredTimeout(
      IpcChannel.BUNDLE_OPEN_FILE,
      60000,
      (async () => {
        assertNonEmptyString(filePath, copy.invalidBundle);
        if (typeof filePath !== 'string' || !filePath.endsWith(BUNDLE_EXTENSION)) {
          throw new Error(copy.invalidBundle);
        }
        const theme = await installBundleFromPath(deps, filePath);
        void updateTrayMenu();
        notifyStatusChanged();
        deps.mainWindow?.webContents.send(IpcChannel.FILE_IMPORTED, {
          theme,
          themes: await deps.library.summaries(),
        });
      })(),
    );
  });
}
