// SPDX-License-Identifier: MPL-2.0

/**
 * Settings facet — desktop settings persistence, app path picker, port management,
 * custom CSS, markdown styles, live DOM refresh interval, and CSS source editor.
 *
 * The CSS source editor (listStyleSheets / getStyleSheetText / applyRawCssEdit)
 * is co-located here because it operates on the same underlying settings store
 * (custom CSS overrides persist in desktop-settings.json).
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId, DesktopSettings, SystemStatus } from '../../shared/types';
import type { MarkdownStyles } from '../../shared/types/markdown';

export const settings = {
  getSettings: () => ipcRenderer.invoke(IpcChannel.SETTINGS_GET) as Promise<DesktopSettings>,
  pickAppPath: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.SETTINGS_PICK_APP_PATH, appId),
  clearAppPath: (appId: AgentId) => ipcRenderer.invoke(IpcChannel.SETTINGS_CLEAR_APP_PATH, appId),
  setAppPort: (appId: AgentId, port: number | null) =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_SET_APP_PORT, appId, port),

  // --- Custom theme CSS ---
  getCustomThemeCss: () =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_GET_CUSTOM_CSS) as Promise<string>,
  setCustomThemeCss: (css: string) => ipcRenderer.invoke(IpcChannel.SETTINGS_SET_CUSTOM_CSS, css),

  // --- Live DOM refresh interval ---
  setLiveDomRefreshInterval: (interval: number) =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_SET_LIVE_DOM_REFRESH_INTERVAL, interval),

  // --- Markdown styles ---
  getMarkdownStyles: () =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_GET_MARKDOWN_STYLES) as Promise<MarkdownStyles>,
  saveMarkdownStyles: (styles: MarkdownStyles) =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_SET_MARKDOWN_STYLES, styles) as Promise<{
      settings: DesktopSettings;
      status: SystemStatus;
    }>,

  // --- CSS source editor ---
  listStyleSheets: (port: number) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.CSS_LIST, port) as Promise<
      Array<{
        styleSheetId: string;
        url: string;
        disabled: boolean;
        isInline: boolean;
        sourceURL: string;
        length: string;
        label: string;
      }>
    >,
  getStyleSheetText: (port: number, styleSheetId: string) =>
    ipcRenderer.invoke(IpcChannel.CSS_GET_TEXT, port, styleSheetId) as Promise<string>,
  applyRawCssEdit: (port: number, agentId: AgentId, css: string) =>
    ipcRenderer.invoke(IpcChannel.CSS_APPLY_EDIT, port, agentId, css) as Promise<{
      ok: boolean;
      error?: string;
    }>,
};
