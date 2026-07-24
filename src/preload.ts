// SPDX-License-Identifier: MPL-2.0

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppLocale } from './shared/i18n';
import { IpcChannel } from './shared/ipc-channels';
import type {
  AgentId,
  ApplyRequest,
  AgentSkinApi,
  FileImportConfirmRequest,
  FileImportResult,
  TrayApplyRequest,
  WallpaperAgentSetting,
  WallpaperSettings,
} from './shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: AgentSkinApi = {
  getBootstrap: () => ipcRenderer.invoke(IpcChannel.APP_BOOTSTRAP),
  setLocale: (locale: AppLocale) => ipcRenderer.invoke(IpcChannel.LOCALE_SET, locale),
  refreshStatus: () => ipcRenderer.invoke(IpcChannel.SYSTEM_STATUS),
  applyTheme: (request: ApplyRequest) => ipcRenderer.invoke(IpcChannel.THEME_APPLY, request),
  restoreApp: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.THEME_RESTORE, appId),
  importTheme: () => ipcRenderer.invoke(IpcChannel.THEME_IMPORT),
  importThemeFromPath: (path: string) => ipcRenderer.invoke(IpcChannel.THEME_IMPORT_PATH, path),
  importThemeBytes: (bytes: Uint8Array, suggestedId: string) =>
    ipcRenderer.invoke(IpcChannel.THEME_IMPORT_BYTES, bytes, suggestedId),
  openThemeFile: (path: string) => ipcRenderer.invoke(IpcChannel.THEME_OPEN_FILE, path),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  exportTheme: (themeId: string) => ipcRenderer.invoke(IpcChannel.THEME_EXPORT, themeId),
  deleteTheme: (themeId: string) => ipcRenderer.invoke(IpcChannel.THEME_DELETE, themeId),
  // --- Catalog (read-only product data layer) ---
  catalog: {
    agents: {
      list: () => ipcRenderer.invoke(IpcChannel.AGENT_LIST),
    },
    themes: {
      list: () => ipcRenderer.invoke(IpcChannel.THEME_LIST),
      get: (id: string) => ipcRenderer.invoke(IpcChannel.THEME_GET, id),
      search: (query: string) => ipcRenderer.invoke(IpcChannel.THEME_SEARCH, query),
      filter: (agentId: AgentId) => ipcRenderer.invoke(IpcChannel.THEME_FILTER, agentId),
    },
  },
  getSettings: () => ipcRenderer.invoke(IpcChannel.SETTINGS_GET),
  pickAppPath: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.SETTINGS_PICK_APP_PATH, appId),
  clearAppPath: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.SETTINGS_CLEAR_APP_PATH, appId),
  setAppPort: (appId: AgentId, port: number | null) => ipcRenderer.invoke(IpcChannel.SETTINGS_SET_APP_PORT, appId, port),
  listWallpapers: () => ipcRenderer.invoke(IpcChannel.WALLPAPER_LIST),
  setWallpaper: (wallpaper: Pick<WallpaperSettings, 'enabled' | 'id'>) => ipcRenderer.invoke(IpcChannel.WALLPAPER_SET, wallpaper),
  importWallpaper: () => ipcRenderer.invoke(IpcChannel.WALLPAPER_IMPORT),
  setAgentWallpaper: (appId: AgentId, setting: WallpaperAgentSetting) => ipcRenderer.invoke(IpcChannel.WALLPAPER_SET_AGENT, appId, setting),
  applyAgentWallpaper: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_AGENT, appId),
  deleteWallpaper: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_DELETE, id),
  applyWallpaperToAgent: (wallpaperId: string, agentId: AgentId) => ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_TO_AGENT, wallpaperId, agentId),
  removeWallpaperFromAgent: (agentId: AgentId) => ipcRenderer.invoke(IpcChannel.WALLPAPER_REMOVE_FROM_AGENT, agentId),
  weDetect: () => ipcRenderer.invoke(IpcChannel.WE_DETECT),
  showInFolder: (itemPath: string) => ipcRenderer.invoke(IpcChannel.SHELL_SHOW_ITEM, itemPath),
  onRuntimeLog: (listener) => subscribe<string>(IpcChannel.RUNTIME_LOG, listener),
  onFileImported: (listener) => subscribe<FileImportResult>(IpcChannel.FILE_IMPORTED, listener),
  onFileImportConfirm: (listener) => subscribe<FileImportConfirmRequest>(IpcChannel.FILE_IMPORT_CONFIRM, listener),
  onFileImportFailed: (listener) => subscribe<string>(IpcChannel.FILE_IMPORT_FAILED, listener),
  onTrayApply: (listener) => subscribe<TrayApplyRequest>(IpcChannel.TRAY_APPLY, listener),
  // --- Window controls (custom title bar) ---
  windowMinimize: () => ipcRenderer.send(IpcChannel.WINDOW_MINIMIZE),
  windowToggleMaximize: () => ipcRenderer.invoke(IpcChannel.WINDOW_TOGGLE_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IpcChannel.WINDOW_CLOSE),
  windowIsMaximized: () => ipcRenderer.invoke(IpcChannel.WINDOW_IS_MAXIMIZED),
  onWindowMaximizeChange: (listener) => subscribe<boolean>(IpcChannel.WINDOW_MAXIMIZE_CHANGE, listener),
};

contextBridge.exposeInMainWorld('agentSkin', api);
