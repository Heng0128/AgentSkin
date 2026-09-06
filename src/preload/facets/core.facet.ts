// SPDX-License-Identifier: MPL-2.0

/**
 * Core facet — bootstrap, locale, theme mode, status polling, event bus.
 *
 * This facet handles the foundational lifecycle methods that don't belong to
 * any specific injection domain: bootstrapping, locale/theme-mode settings,
 * status refresh, and the common fan-out subscription channel.
 */

import { ipcRenderer } from 'electron';
import type { AppLocale } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ThemeHotReloadPayload } from '../../shared/types/theme';

function subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const core = {
  getBootstrap: () => ipcRenderer.invoke(IpcChannel.APP_BOOTSTRAP),
  setLocale: (locale: AppLocale) => ipcRenderer.invoke(IpcChannel.LOCALE_SET, locale),
  setThemeMode: (mode: 'dark' | 'light' | 'system') =>
    ipcRenderer.invoke(IpcChannel.THEME_MODE_SET, mode),
  refreshStatus: () => ipcRenderer.invoke(IpcChannel.SYSTEM_STATUS),

  /** Fire-and-forget push of renderer-side primitive sizes so the main
   *  process can include them in the unified metrics broadcast. */
  sendRendererConcurrencyMetrics: (companionBusy: number, switchEpoch: number) =>
    ipcRenderer.send(IpcChannel.DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY, {
      companionBusy,
      switchEpoch,
    }),

  /** Subscribe to main-process status changes (apply/restore complete, agent launch/exit). */
  onStatusChanged: (listener: () => void) =>
    subscribeEvent<void>(IpcChannel.STATUS_CHANGED, listener),

  /** Subscribe to boot warnings (degraded steps during startup). */
  onBootWarnings: (listener: (warnings: string[]) => void) =>
    subscribeEvent<string[]>(IpcChannel.BOOT_WARNINGS, listener),

  /** Subscribe to runtime log lines pushed from main. */
  onRuntimeLog: (listener: (log: string) => void) =>
    subscribeEvent<string>(IpcChannel.RUNTIME_LOG, listener),

  /** Subscribe to file import completion events. */
  onFileImported: (listener: (result: import('../../shared/types').FileImportResult) => void) =>
    subscribeEvent(IpcChannel.FILE_IMPORTED, listener),

  /** Subscribe to file import confirmation requests (main → renderer → user confirm). */
  onFileImportConfirm: (
    listener: (req: import('../../shared/types').FileImportConfirmRequest) => void,
  ) => subscribeEvent(IpcChannel.FILE_IMPORT_CONFIRM, listener),

  /** Subscribe to file import failure events. */
  onFileImportFailed: (listener: (message: string) => void) =>
    subscribeEvent<string>(IpcChannel.FILE_IMPORT_FAILED, listener),

  /** Subscribe to tray apply requests. */
  onTrayApply: (listener: (req: import('../../shared/types').TrayApplyRequest) => void) =>
    subscribeEvent(IpcChannel.TRAY_APPLY, listener),

  /** Subscribe to theme hot-reload payloads (post-apply state fan-out). */
  onThemeHotReload: (listener: (payload: ThemeHotReloadPayload) => void) =>
    subscribeEvent(IpcChannel.THEME_HOT_RELOAD, listener),

  /** Subscribe to deep link events. */
  onDeepLink: (listener: (event: import('../../main/deep-link-handler').DeepLinkEvent) => void) =>
    subscribeEvent(IpcChannel.DEEP_LINK, listener),

  /** Subscribe to coordinator status changes (app launch/exit events). */
  onCoordinatorStatus: (
    cb: (event: { appId: string; state: import('../../shared/types').AppRunState }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: { appId: string; state: import('../../shared/types').AppRunState },
    ) => cb(event);
    ipcRenderer.on(IpcChannel.COORDINATOR_STATUS, handler);
    return () => ipcRenderer.off(IpcChannel.COORDINATOR_STATUS, handler);
  },

  getCoordinatorSnapshot: () => ipcRenderer.invoke(IpcChannel.COORDINATOR_SNAPSHOT),
  queryCoordinatorState: (appId: string) => ipcRenderer.invoke(IpcChannel.COORDINATOR_QUERY, appId),
};
