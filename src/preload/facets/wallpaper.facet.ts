// SPDX-License-Identifier: MPL-2.0

/**
 * Wallpaper facet — desktop + per-agent wallpaper management, environment presets,
 * Wallpaper Engine detection, and wallpaper-derived theme extraction (pywal-style).
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { isWallpaperInfo } from '../../shared/ipc-type-guards';
import type { AgentId, WallpaperAgentSetting, WallpaperSettings } from '../../shared/types';
import type { EnvironmentPreset } from '../../shared/types/environment';

export const wallpaper = {
  // --- Desktop wallpaper ---
  // RC-3: Runtime validation — the IPC handler may return unexpected shapes
  // across versions. Filter out invalid entries instead of passing bad data.
  listWallpapers: async () => {
    const result = await ipcRenderer.invoke(IpcChannel.WALLPAPER_LIST);
    if (Array.isArray(result)) {
      return result.filter(isWallpaperInfo);
    }
    return [];
  },
  setWallpaper: (wallpaper: Pick<WallpaperSettings, 'enabled' | 'id'>) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_SET, wallpaper),
  importWallpaper: () => ipcRenderer.invoke(IpcChannel.WALLPAPER_IMPORT),
  deleteWallpaper: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_DELETE, id),

  // --- Per-agent wallpaper ---
  setAgentWallpaper: (appId: AgentId, setting: WallpaperAgentSetting) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_SET_AGENT, appId, setting),
  applyAgentWallpaper: (appId: AgentId, options?: { restartExisting?: boolean }) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_AGENT, appId, options),
  applyWallpaperToAgent: (
    wallpaperId: string,
    agentId: AgentId,
    options?: { restartExisting?: boolean },
  ) => ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_TO_AGENT, wallpaperId, agentId, options),
  removeWallpaperFromAgent: (agentId: AgentId) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_REMOVE_FROM_AGENT, agentId),

  // --- Wallpaper-derived theme (pywal-style) ---
  extractThemeFromWallpaper: (wallpaperId: string) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_EXTRACT_THEME, wallpaperId),
  previewThemeFromWallpaper: (wallpaperId: string) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_PREVIEW_THEME, wallpaperId),
  applyThemeFromWallpaper: (wallpaperId: string, appId?: AgentId) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_THEME, wallpaperId, appId),

  // --- Wallpaper media URL resolution (loopback HTTP server) ---
  wallpaperVideoUrl: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_VIDEO_URL, id),
  wallpaperWebUrl: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_WEB_URL, id),
  wallpaperPreviewUrl: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_PREVIEW_URL, id),
  wallpaperStaticFrame: (pkgPath: string, previewPath?: string) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_STATIC_FRAME, pkgPath, previewPath),

  // --- Environment presets (main-process persisted, v2+) ---
  getEnvironmentPresets: () => ipcRenderer.invoke(IpcChannel.ENV_PRESET_GET),
  saveEnvironmentPresets: (presets: EnvironmentPreset[]) =>
    ipcRenderer.invoke(IpcChannel.ENV_PRESET_SET, presets),

  // --- Wallpaper Engine detection ---
  weDetect: () => ipcRenderer.invoke(IpcChannel.WE_DETECT),
};
