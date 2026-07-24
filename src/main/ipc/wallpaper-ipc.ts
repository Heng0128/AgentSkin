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

import { dialog, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import {
  isAgentId,
  type WallpaperAgentSetting,
  type WallpaperInfo,
  type WallpaperSettings,
} from '../../shared/types';
import { type MainContext, settingsDto } from '../main-context';

export function registerWallpaperIpc(deps: MainContext): void {
  ipcMain.handle(IpcChannel.WALLPAPER_LIST, () => deps.wallpapers.list());

  ipcMain.handle(IpcChannel.WALLPAPER_SET, async (_event, next: unknown) => {
    const candidate = (next ?? {}) as Partial<WallpaperSettings>;
    await deps.settings.setWallpaper({
      enabled: candidate.enabled === true,
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : null,
    });
    return settingsDto(deps);
  });

  ipcMain.handle(IpcChannel.WALLPAPER_IMPORT, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Wallpaper',
      filters: [
        {
          name: 'Images & Videos',
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
        { name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi'] },
        { name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return deps.wallpapers.list();
    await deps.wallpapers.importMedia(result.filePaths[0]);
    return deps.wallpapers.list();
  });

  ipcMain.handle(
    IpcChannel.WALLPAPER_DELETE,
    async (_event, id: unknown): Promise<WallpaperInfo[]> => {
      if (typeof id !== 'string' || !id) return deps.wallpapers.list();
      await deps.wallpapers.deleteWallpaper(id);
      return deps.wallpapers.list();
    },
  );

  ipcMain.handle(
    IpcChannel.WALLPAPER_SET_AGENT,
    async (_event, appId: unknown, setting: unknown) => {
      if (!isAgentId(appId)) throw new Error('INVALID_AGENT_ID');
      const s = (setting ?? {}) as Partial<WallpaperAgentSetting>;
      await deps.settings.setAgentWallpaper(appId, {
        enabled: s.enabled === true,
        id: typeof s.id === 'string' && s.id ? s.id : null,
      });
      return settingsDto(deps);
    },
  );

  ipcMain.handle(IpcChannel.WALLPAPER_APPLY_AGENT, async (_event, appId: unknown) => {
    if (!isAgentId(appId)) return { ok: false, reason: 'invalid-agent-id' };
    return deps.core.applyAgentWallpaperNow(appId);
  });

  ipcMain.handle(
    IpcChannel.WALLPAPER_APPLY_TO_AGENT,
    async (_event, wallpaperId: unknown, appId: unknown) => {
      if (typeof wallpaperId !== 'string' || !wallpaperId)
        return { ok: false, reason: 'invalid-wallpaper-id' };
      if (!isAgentId(appId)) return { ok: false, reason: 'invalid-agent-id' };
      return deps.core.applyWallpaperToAgent(wallpaperId, appId);
    },
  );

  ipcMain.handle(IpcChannel.WALLPAPER_REMOVE_FROM_AGENT, async (_event, appId: unknown) => {
    if (!isAgentId(appId)) return { ok: false };
    return deps.core.removeWallpaperFromAgent(appId);
  });

  ipcMain.handle(IpcChannel.WE_DETECT, async () => {
    const installed = await deps.wallpapers.isInstalled();
    const wallpaperCount = installed ? await deps.wallpapers.count() : 0;
    return { installed, wallpaperCount };
  });
}
