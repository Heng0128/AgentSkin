// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper IPC
 *
 * Wallpaper-related IPC handlers: list/import/delete media, set global and
 * per-agent wallpaper preferences, and trigger immediate apply/remove on a
 * specific agent. Also handles Wallpaper Engine detection (`we:detect`).
 *
 * Extracted from the monolithic `registerIpc` in `main.ts` (H3).
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { getMainMessages } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import type {
  InstalledTheme,
  WallpaperAgentSetting,
  WallpaperInfo,
  WallpaperSettings,
} from '../../shared/types';
import { ThemeInstaller } from '../catalog/theme-installer';
import { ThemePackageLoader } from '../catalog/theme-package-loader';
import { type MainContext, notifyStatusChanged, sendLog, settingsDto } from '../main-context';
import { buildWallpaperTheme, removeWallpaperTheme } from '../theme/wallpaper-theme';
import { registerThemeWallpaperForInstalled } from '../wallpaper/theme-wallpaper';
import { assertAgentId, assertNonEmptyString } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

export function registerWallpaperIpc(deps: MainContext): void {
  /** Guard: wallpaper service may be null if its initialization failed during
   *  boot (degradable step). Returns an empty array for list operations so
   *  the UI shows "no wallpapers" instead of crashing. */
  const wp = (): NonNullable<MainContext['wallpapers']> => {
    if (!deps.wallpapers) throw new Error('Wallpaper service unavailable');
    return deps.wallpapers;
  };

  ipcMain.handle(IpcChannel.WALLPAPER_LIST, () => deps.wallpapers?.list() ?? []);

  ipcMain.handle(IpcChannel.WALLPAPER_SET, async (_event, next: unknown) => {
    const candidate = (next ?? {}) as Partial<WallpaperSettings>;
    await deps.settings.setWallpaper({
      enabled: candidate.enabled === true,
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : null,
      render: candidate.render,
    });
    notifyStatusChanged();
    return settingsDto(deps);
  });

  ipcMain.handle(IpcChannel.WALLPAPER_IMPORT, async (_event) => {
    const work = withMonitoredTimeout(
      IpcChannel.WALLPAPER_IMPORT,
      60000,
      (async () => {
        if (!deps.wallpapers) return [];
        const copy = getMainMessages();
        const result = await dialog.showOpenDialog({
          title: copy.wallpaperImportDialogTitle,
          filters: [
            {
              name: copy.wallpaperImportFilterAll,
              extensions: [
                'mp4',
                'webm',
                'mkv',
                'mov',
                'avi',
                'jpg',
                'jpeg',
                'png',
                'bmp',
                'webp',
                'gif',
              ],
            },
            {
              name: copy.wallpaperImportFilterVideo,
              extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi'],
            },
            {
              name: copy.wallpaperImportFilterImage,
              extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'],
            },
          ],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return deps.wallpapers.list();
        await deps.wallpapers.importMedia(result.filePaths[0]);
        notifyStatusChanged();
        return { ok: true as const, items: await deps.wallpapers.list() };
      })(),
    );
    return work.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sendLog(`[wallpaper] import failed: ${message}`);
      return { ok: false as const, error: message };
    });
  });

  ipcMain.handle(
    IpcChannel.WALLPAPER_DELETE,
    async (_event, id: unknown): Promise<WallpaperInfo[]> => {
      return withMonitoredTimeout(
        IpcChannel.WALLPAPER_DELETE,
        10000,
        (async () => {
          assertNonEmptyString(id, getMainMessages().invalidPath);
          await wp().deleteWallpaper(id);
          notifyStatusChanged();
          return wp().list();
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.WALLPAPER_SET_AGENT,
    async (_event, appId: unknown, setting: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.WALLPAPER_SET_AGENT,
        10000,
        (async () => {
          assertAgentId(appId);
          const s = (setting ?? {}) as Partial<WallpaperAgentSetting>;
          await deps.settings.setAgentWallpaper(appId, {
            enabled: s.enabled === true,
            id: typeof s.id === 'string' && s.id ? s.id : null,
            render: s.render,
          });
          notifyStatusChanged();
          return settingsDto(deps);
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.WALLPAPER_APPLY_AGENT,
    async (_event, appId: unknown, options?: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.WALLPAPER_APPLY_AGENT,
        30000,
        (async () => {
          assertAgentId(appId);
          const opts = (options ?? {}) as { restartExisting?: boolean };
          const result = await deps.core.applyAgentWallpaperNow(appId, {
            restartExisting: opts.restartExisting === true,
          });
          notifyStatusChanged();
          return result;
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.WALLPAPER_APPLY_TO_AGENT,
    async (_event, wallpaperId: unknown, appId: unknown, options?: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.WALLPAPER_APPLY_TO_AGENT,
        30000,
        (async () => {
          assertNonEmptyString(wallpaperId, getMainMessages().invalidPath);
          assertAgentId(appId);
          const opts = (options ?? {}) as { restartExisting?: boolean };
          const result = await deps.core.applyWallpaperToAgent(wallpaperId, appId, {
            restartExisting: opts.restartExisting === true,
          });
          notifyStatusChanged();
          return result;
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.WALLPAPER_REMOVE_FROM_AGENT, async (_event, appId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.WALLPAPER_REMOVE_FROM_AGENT,
      15000,
      (async () => {
        assertAgentId(appId);
        const result = await deps.core.removeWallpaperFromAgent(appId);
        notifyStatusChanged();
        return result;
      })(),
    );
  });

  ipcMain.handle(
    IpcChannel.WALLPAPER_VIDEO_URL,
    async (_event, id: unknown): Promise<string | null> => {
      assertNonEmptyString(id, getMainMessages().invalidPath);
      return deps.wallpapers?.videoUrlFor(id) ?? null;
    },
  );

  ipcMain.handle(
    IpcChannel.WALLPAPER_WEB_URL,
    async (_event, id: unknown): Promise<string | null> => {
      assertNonEmptyString(id, getMainMessages().invalidPath);
      return deps.wallpapers?.webUrlFor(id) ?? null;
    },
  );

  ipcMain.handle(
    IpcChannel.WALLPAPER_EXTRACT_THEME,
    async (_event, wallpaperId: unknown): Promise<InstalledTheme> => {
      return withMonitoredTimeout(
        IpcChannel.WALLPAPER_EXTRACT_THEME,
        30000,
        (async () => {
          assertNonEmptyString(wallpaperId, getMainMessages().invalidPath);
          if (!deps.wallpapers) throw new Error('Wallpaper service unavailable');
          const copy = getMainMessages();
          const previewPath = await deps.wallpapers.previewPathFor(wallpaperId);
          if (!previewPath) throw new Error(copy.wallpaperThemeNoPreview);
          // Title for the generated theme's display name (fall back to the id).
          const items = await deps.wallpapers.list();
          const title = items.find((w) => w.id === wallpaperId)?.title ?? wallpaperId;
          // Build the theme package under <userData>/wallpaper-themes (independent
          // of the built-in themes/ dir the seeder scans), install it into the
          // library (userData/themes) and return the installed theme so the
          // renderer can apply it immediately.
          const outRoot = path.join(deps.userDataRoot, 'wallpaper-themes');
          // 视频壁纸：把视频路径传入，使生成的主题捆绑 wallpaper.video（apply
          // 时自动注入）；非视频壁纸不捆绑。
          let videoPath: string | undefined;
          const info = await deps.wallpapers.mediaInfoFor(wallpaperId);
          if (info?.type === 'video') videoPath = info.path;
          const built = await buildWallpaperTheme({
            wallpaperId,
            title,
            previewPath,
            outRoot,
            videoPath,
          });
          await removeWallpaperTheme(outRoot, built.themeId);
          const loader = new ThemePackageLoader(outRoot);
          const pkg = await loader.load(built.themeId);
          const installer = new ThemeInstaller(deps.library);
          const installed = await installer.install(pkg, outRoot);
          // 主题自带视频壁纸 → 注册为 theme:<id>，使 UI/apply 可解析（pywal
          // 主题在 userData 下，boot 的 themesDir 路径拼接不适用）。
          await registerThemeWallpaperForInstalled(deps, installed, outRoot);
          notifyStatusChanged();
          return installed;
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.WE_DETECT, async (_event) => {
    return withMonitoredTimeout(
      IpcChannel.WE_DETECT,
      15000,
      (async () => {
        const installed = deps.wallpapers ? await deps.wallpapers.isInstalled() : false;
        const wallpaperCount = installed ? await deps.wallpapers!.count() : 0;
        return { installed, wallpaperCount };
      })(),
    );
  });
}
