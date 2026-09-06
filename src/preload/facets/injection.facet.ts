// SPDX-License-Identifier: MPL-2.0

/**
 * Injection facet — theme apply/restore/import/export/delete, catalog (read-only
 * product data layer), bundles, and Quick Apply.
 *
 * This is the primary domain for the injection pipeline: applying a theme to an
 * agent, restoring the native look, importing from the clipboard/filesystem, and
 * managing installation bundles.
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type {
  AgentId,
  ApplyRequest,
  QuickApplyProgress,
  QuickApplyRequest,
  QuickApplyResult,
  RegenResult,
} from '../../shared/types';

function subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const injection = {
  applyTheme: (request: ApplyRequest) => ipcRenderer.invoke(IpcChannel.THEME_APPLY, request),
  restoreApp: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.THEME_RESTORE, appId),
  importTheme: () => ipcRenderer.invoke(IpcChannel.THEME_IMPORT),
  importThemeFromPath: (path: string) => ipcRenderer.invoke(IpcChannel.THEME_IMPORT_PATH, path),
  importThemeBytes: (bytes: Uint8Array, suggestedId: string) =>
    ipcRenderer.invoke(IpcChannel.THEME_IMPORT_BYTES, bytes, suggestedId),
  openThemeFile: (path: string) => ipcRenderer.invoke(IpcChannel.THEME_OPEN_FILE, path),
  exportTheme: (themeId: string) => ipcRenderer.invoke(IpcChannel.THEME_EXPORT, themeId),
  deleteTheme: (themeId: string) => ipcRenderer.invoke(IpcChannel.THEME_DELETE, themeId),
  createBundle: (themeId: string) => ipcRenderer.invoke(IpcChannel.BUNDLE_CREATE, themeId),
  installBundle: () => ipcRenderer.invoke(IpcChannel.BUNDLE_INSTALL),

  /** Theme Usage Frequency Tracking — LRU-sorted theme ids for quick-switch. */
  themeUsageGet: (appId: AgentId, allThemes: string[], limit?: number) =>
    ipcRenderer.invoke(IpcChannel.THEME_USAGE_GET, appId, allThemes, limit) as Promise<string[]>,
  onThemeUsageChanged: (listener: () => void) =>
    subscribeEvent<void>(IpcChannel.THEME_USAGE_CHANGED, listener),

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

  // --- Quick Apply ---
  /** Submit an image for instant theme extraction + apply. */
  quickApplySubmit: (req: QuickApplyRequest) =>
    ipcRenderer.invoke(IpcChannel.QUICK_APPLY_SUBMIT, req) as Promise<QuickApplyResult>,
  /** Undo the last quick-apply by restoring the target agent to its native look. */
  quickApplyUndo: (appId: AgentId) =>
    ipcRenderer.invoke(IpcChannel.QUICK_APPLY_UNDO, appId) as Promise<{
      success: boolean;
      error?: string;
    }>,
  /** Subscribe to quick-apply pipeline progress events. */
  onQuickApplyProgress: (listener: (progress: QuickApplyProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: QuickApplyProgress) =>
      listener(payload);
    ipcRenderer.on(IpcChannel.QUICK_APPLY_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IpcChannel.QUICK_APPLY_PROGRESS, handler);
  },

  // --- Theme manual regen / engine injection failure ---
  triggerManualRegen: (agentId: AgentId, themeId: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.THEME_MANUAL_REGEN, agentId, themeId) as Promise<RegenResult>,
  onThemeEngineInjectFailure: (
    listener: (payload: { agent: string; themeId: string; message: string }) => void,
  ) => subscribeEvent(IpcChannel.THEME_ENGINE_INJECT_FAILURE, listener),
  onThemeBackgroundTaskFailure: (
    listener: (payload: { agent: string; themeId: string; message: string }) => void,
  ) => subscribeEvent(IpcChannel.THEME_BACKGROUND_TASK_FAILURE, listener),
};
