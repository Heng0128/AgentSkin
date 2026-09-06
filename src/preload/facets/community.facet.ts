// SPDX-License-Identifier: MPL-2.0

/**
 * Community facet — community theme gallery + download (DreamSkin integration).
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type {
  CommunitySourceId,
  CommunitySourceProbeResult,
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  DownloadProgress,
  InstallationRecord,
  InstallResult,
} from '../../shared/types';

function _subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const community = {
  listCommunityThemes: (params?: CommunityThemeListParams) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.COMMUNITY_THEME_LIST, params) as Promise<
      { success: true; data: CommunityThemeListResult } | { success: false; error: string }
    >,
  getCommunityTheme: (themeId: string, sourceId?: CommunitySourceId) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.COMMUNITY_THEME_GET, themeId, sourceId) as Promise<
      { success: true; data: CommunityThemeDetail } | { success: false; error: string }
    >,
  downloadCommunityTheme: (themeId: string, sourceId?: CommunitySourceId) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.COMMUNITY_THEME_DOWNLOAD, themeId, sourceId) as Promise<
      { success: true; data: InstallResult } | { success: false; data: InstallResult }
    >,
  cancelCommunityDownload: (themeId: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.COMMUNITY_DOWNLOAD_CANCEL, themeId) as Promise<{
      success: boolean;
      error?: string;
    }>,
  onCommunityDownloadProgress: (listener: (progress: DownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DownloadProgress) =>
      listener(payload);
    ipcRenderer.on(IpcChannel.COMMUNITY_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IpcChannel.COMMUNITY_DOWNLOAD_PROGRESS, handler);
  },
  probeCommunitySource: (sourceId: CommunitySourceId) =>
    ipcRenderer.invoke(
      IpcChannel.COMMUNITY_SOURCE_PROBE,
      sourceId,
    ) as Promise<CommunitySourceProbeResult>,
  loadCommunityInstallLog: () =>
    ipcRenderer.invoke(IpcChannel.COMMUNITY_INSTALL_LOG_GET) as Promise<
      { success: true; data: InstallationRecord[] } | { success: false; error: string }
    >,
  saveCommunityInstallLog: (records: InstallationRecord[]) =>
    ipcRenderer.invoke(IpcChannel.COMMUNITY_INSTALL_LOG_SAVE, records) as Promise<{
      success: boolean;
    }>,

  // CodeDrobe source 复用主 IPC handler（通过 sourceId 参数路由）
};
