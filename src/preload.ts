// SPDX-License-Identifier: MPL-2.0

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppLocale } from './shared/i18n';
import { IpcChannel } from './shared/ipc-channels';
import type {
  AgentId,
  AgentSkinApi,
  ApplyRequest,
  ConcurrencyMetrics,
  FileImportConfirmRequest,
  FileImportResult,
  HealthCheckReport,
  InspectedNode,
  ScanProgressEvent,
  StudioProject,
  StudioSnapshotOptions,
  ThemeColorsFromImage,
  ThemeStudioExportRequest,
  ThemeVisualSnapshot,
  TrayApplyRequest,
  VisualAnalysisSummary,
  WallpaperAgentSetting,
  WallpaperSettings,
} from './shared/types';
import type { CssStyleSheetEvent } from './shared/types/css-event';
import type { EnvironmentPreset } from './shared/types/environment';
import type { LaunchRequest } from './shared/types/launch';
import type { ToolOverride, TweakSession } from './shared/types/override';
import type { SelectorProbeResult, SelectorValidationReport } from './shared/types/selector-probe';

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
  createBundle: (themeId: string) => ipcRenderer.invoke(IpcChannel.BUNDLE_CREATE, themeId),
  installBundle: () => ipcRenderer.invoke(IpcChannel.BUNDLE_INSTALL),
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
  setAppPort: (appId: AgentId, port: number | null) =>
    ipcRenderer.invoke(IpcChannel.SETTINGS_SET_APP_PORT, appId, port),
  getCustomThemeCss: () => ipcRenderer.invoke(IpcChannel.SETTINGS_GET_CUSTOM_CSS),
  setCustomThemeCss: (css: string) => ipcRenderer.invoke(IpcChannel.SETTINGS_SET_CUSTOM_CSS, css),
  listWallpapers: () => ipcRenderer.invoke(IpcChannel.WALLPAPER_LIST),
  extractThemeFromWallpaper: (wallpaperId: string) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_EXTRACT_THEME, wallpaperId),
  setWallpaper: (wallpaper: Pick<WallpaperSettings, 'enabled' | 'id'>) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_SET, wallpaper),
  importWallpaper: () => ipcRenderer.invoke(IpcChannel.WALLPAPER_IMPORT),
  setAgentWallpaper: (appId: AgentId, setting: WallpaperAgentSetting) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_SET_AGENT, appId, setting),
  applyAgentWallpaper: (appId: AgentId, options?: { restartExisting?: boolean }) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_AGENT, appId, options),
  deleteWallpaper: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_DELETE, id),
  applyWallpaperToAgent: (
    wallpaperId: string,
    agentId: AgentId,
    options?: { restartExisting?: boolean },
  ) => ipcRenderer.invoke(IpcChannel.WALLPAPER_APPLY_TO_AGENT, wallpaperId, agentId, options),
  removeWallpaperFromAgent: (agentId: AgentId) =>
    ipcRenderer.invoke(IpcChannel.WALLPAPER_REMOVE_FROM_AGENT, agentId),
  // --- Environment presets (main-process persisted, v2+) ---
  getEnvironmentPresets: () => ipcRenderer.invoke(IpcChannel.ENV_PRESET_GET),
  saveEnvironmentPresets: (presets: EnvironmentPreset[]) =>
    ipcRenderer.invoke(IpcChannel.ENV_PRESET_SET, presets),
  weDetect: () => ipcRenderer.invoke(IpcChannel.WE_DETECT),
  // --- Workspace live tweak (tweak-injector.ts) ---
  pushTweak: (session: TweakSession, overrides: ToolOverride) =>
    ipcRenderer.invoke(IpcChannel.WORKSPACE_TWEAK_PUSH, session, overrides) as Promise<boolean>,
  saveTweakAsCustomCss: (session: TweakSession, overrides: ToolOverride) =>
    ipcRenderer.invoke(IpcChannel.WORKSPACE_TWEAK_SAVE, session, overrides) as Promise<boolean>,
  resetTweak: (session: TweakSession) =>
    ipcRenderer.invoke(IpcChannel.WORKSPACE_TWEAK_RESET, session) as Promise<boolean>,
  // --- CSS source editor ---
  listStyleSheets: (port: number) =>
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
  onCssEvents: (listener) => subscribe<CssStyleSheetEvent>(IpcChannel.CSS_EVENTS, listener),
  wallpaperVideoUrl: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_VIDEO_URL, id),
  wallpaperWebUrl: (id: string) => ipcRenderer.invoke(IpcChannel.WALLPAPER_WEB_URL, id),
  showInFolder: (itemPath: string) => ipcRenderer.invoke(IpcChannel.SHELL_SHOW_ITEM, itemPath),
  onRuntimeLog: (listener) => subscribe<string>(IpcChannel.RUNTIME_LOG, listener),
  onFileImported: (listener) => subscribe<FileImportResult>(IpcChannel.FILE_IMPORTED, listener),
  onFileImportConfirm: (listener) =>
    subscribe<FileImportConfirmRequest>(IpcChannel.FILE_IMPORT_CONFIRM, listener),
  onFileImportFailed: (listener) => subscribe<string>(IpcChannel.FILE_IMPORT_FAILED, listener),
  onTrayApply: (listener) => subscribe<TrayApplyRequest>(IpcChannel.TRAY_APPLY, listener),
  onStatusChanged: (listener) => subscribe<void>(IpcChannel.STATUS_CHANGED, listener),
  onBootWarnings: (listener) => subscribe<string[]>(IpcChannel.BOOT_WARNINGS, listener),
  // --- Theme Studio: snapshot theme DOM for replica renderer ---
  snapshotThemeDom: (agentId: AgentId, themeId?: string, options?: StudioSnapshotOptions) =>
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_SNAPSHOT, {
      agentId,
      themeId,
      options,
    }) as Promise<ThemeVisualSnapshot>,
  // --- Theme Studio: capture the agent's native (un-themed) baseline ---
  snapshotBaseline: (agentId: AgentId, options?: StudioSnapshotOptions) =>
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_SNAPSHOT_BASELINE, {
      agentId,
      options,
    }) as Promise<ThemeVisualSnapshot>,
  // --- Theme Studio: export crafted theme package ---
  exportStudioTheme: (payload: ThemeStudioExportRequest) =>
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_EXPORT, payload),
  // --- Theme Studio: live inspect (DevTools-style element picker) ---
  startInspect: (agentId: AgentId) =>
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_INSPECT_START, { agentId }),
  stopInspect: () => ipcRenderer.invoke(IpcChannel.THEME_STUDIO_INSPECT_STOP),
  onInspectResult: (listener) =>
    subscribe<InspectedNode | { error: string }>(IpcChannel.THEME_STUDIO_INSPECT_RESULT, listener),
  // --- Open the dedicated Theme Studio window (main window sidebar) ---
  openStudioWindow: () => ipcRenderer.invoke(IpcChannel.STUDIO_OPEN) as Promise<{ ok: boolean }>,
  // --- Theme Studio projects (file-backed, no installed-theme dependency) ---
  listStudioProjects: () =>
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_LIST) as Promise<StudioProject[]>,
  createStudioProject: (req: { name: string; author: string; agentId: AgentId }) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_CREATE, req) as Promise<StudioProject>,
  saveStudioProject: (project: StudioProject) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_SAVE, project) as Promise<StudioProject>,
  deleteStudioProject: (id: string) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_DELETE, { id }) as Promise<{ ok: boolean }>,
  importStudioProject: () =>
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_IMPORT) as Promise<StudioProject | null>,
  saveStudioSnapshot: (
    projectId: string,
    snapshot: ThemeVisualSnapshot,
    kind?: 'current' | 'baseline',
  ) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_SNAPSHOT_SAVE, {
      projectId,
      snapshot,
      kind,
    }) as Promise<{ ok: boolean }>,
  loadStudioSnapshot: (projectId: string, kind?: 'current' | 'baseline') =>
    ipcRenderer.invoke(IpcChannel.STUDIO_SNAPSHOT_LOAD, {
      projectId,
      kind,
    }) as Promise<ThemeVisualSnapshot | null>,
  // --- Window controls (custom title bar) ---
  windowMinimize: () => ipcRenderer.send(IpcChannel.WINDOW_MINIMIZE),
  windowToggleMaximize: () => ipcRenderer.invoke(IpcChannel.WINDOW_TOGGLE_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IpcChannel.WINDOW_CLOSE),
  windowIsMaximized: () => ipcRenderer.invoke(IpcChannel.WINDOW_IS_MAXIMIZED),
  onWindowMaximizeChange: (listener) =>
    subscribe<boolean>(IpcChannel.WINDOW_MAXIMIZE_CHANGE, listener),
  // --- Visual Analysis ---
  getVisualAnalysisTarget: (agentName: string) =>
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_GET, agentName) as Promise<Record<
      string,
      unknown
    > | null>,
  listVisualAnalysisTargets: () =>
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_LIST) as Promise<string[]>,
  listVisualAnalysisSummaries: () =>
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY) as Promise<VisualAnalysisSummary[]>,
  detectVisualAnalysisAgent: (agentName: string) =>
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_DETECT, agentName) as Promise<{
      running: boolean;
      port?: number;
      title?: string;
    }>,
  onVisualAnalysisProgress: (listener) =>
    subscribe<{ agent: string; step: string; progress: number }>(
      IpcChannel.VISUAL_ANALYSIS_STATUS,
      listener,
    ),
  exportVisualAnalysisTheme: (agentName: string, themeData: Record<string, unknown>) =>
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME, agentName, themeData) as Promise<{
      ok: boolean;
      path?: string;
    }>,
  // --- Theme Studio: image → palette extraction ---
  extractThemeFromImage: (base64Data: string) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_IMAGE_EXTRACT_THEME, base64Data) as Promise<{
      palette: ThemeColorsFromImage;
      mode: 'light' | 'dark';
    }>,
  // --- Theme Studio: Bundles (workspace-scoped) ---
  listBundles: () =>
    ipcRenderer.invoke(IpcChannel.STUDIO_BUNDLE_LIST) as Promise<
      Array<{
        id: string;
        name: string;
        themeId?: string;
        hasWallpaper: boolean;
        createdAt: string;
      }>
    >,
  importBundle: () =>
    ipcRenderer.invoke(IpcChannel.STUDIO_BUNDLE_IMPORT) as Promise<{
      id: string;
      name: string;
    } | null>,
  installBundleById: (id: string) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_BUNDLE_INSTALL_BY_ID, id) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  deleteBundle: (id: string) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_BUNDLE_DELETE, id) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  // --- Theme Studio: Wallpaper picker ---
  listWallpapersForStudio: () =>
    ipcRenderer.invoke(IpcChannel.STUDIO_WALLPAPER_LIST) as Promise<
      Array<{
        id: string;
        name: string;
        type: 'scene' | 'video' | 'web' | 'preset';
        thumbUrl?: string;
      }>
    >,
  // --- Diagnostics: IPC timeout events ---
  getPerformanceTimeouts: (count?: number) =>
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_GET_TIMEOUTS, count) as Promise<
      Array<{ id: string; channel: string; ms: number; timestamp: number }>
    >,
  clearPerformanceTimeouts: () =>
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_CLEAR_TIMEOUTS) as Promise<{ ok: true }>,
  // --- Diagnostics: performance trace history ---
  getPerformanceHistory: (count?: number) =>
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_GET, count) as Promise<{
      recent: Array<{
        id: string;
        agentId: string;
        themeId?: string;
        finishedAt: string;
        duration: number;
        success: boolean;
        steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
        error?: string;
      }>;
      stats: {
        totalApplies: number;
        avgDurationMs: number;
        perAgentAvg: Record<string, number>;
        overflowCount: number;
      };
    }>,
  getPerformanceMemory: () =>
    ipcRenderer.invoke(IpcChannel.PERFORMANCE_GET_MEMORY) as Promise<
      Array<{ ts: number; heapUsed: number; rss: number; external: number }>
    >,
  onDiagnosticsConcurrencyMetrics: (listener) =>
    subscribe<ConcurrencyMetrics>(IpcChannel.DIAGNOSTICS_CONCURRENCY_METRICS, listener),
  // --- Secondary target injection trace ---
  // Per-target progress: { agent, targetId, targetType, title, success, error, elapsed }.
  onSecondaryInjectProgress: (listener) =>
    subscribe<{
      agent: string;
      targetId: string;
      targetType: string;
      title?: string;
      success: boolean;
      error?: string;
      elapsed: number;
    }>(IpcChannel.THEME_SECONDARY_INJECT_PROGRESS, listener),
  // Summary: { agent, injected, failed, total, duration }.
  onSecondaryInjectSummary: (listener) =>
    subscribe<{
      agent: string;
      injected: number;
      failed: number;
      total: number;
      duration: number;
    }>(IpcChannel.THEME_SECONDARY_INJECT_SUMMARY, listener),
  // --- Theme health check ---
  onThemeHealthReport: (listener) =>
    subscribe<HealthCheckReport>(IpcChannel.THEME_HEALTH_REPORT, listener),
  /** Fire-and-forget push of renderer-side primitive sizes so the main
   *  process can include them in the unified metrics broadcast. */
  sendRendererConcurrencyMetrics: (companionBusy: number, switchEpoch: number) =>
    ipcRenderer.send(IpcChannel.DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY, {
      companionBusy,
      switchEpoch,
    }),
  // --- Electron app discovery & launch ---
  scanElectronApps: (force?: boolean) => ipcRenderer.invoke(IpcChannel.ELECTRON_SCAN, force),
  launchElectronApp: (request: LaunchRequest) =>
    ipcRenderer.invoke(IpcChannel.ELECTRON_LAUNCH, request),
  onElectronStatus: (cb) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: Map<string, { pid: number; port: number | null }>,
    ) => cb(status);
    ipcRenderer.on(IpcChannel.ELECTRON_STATUS, handler);
    return () => ipcRenderer.off(IpcChannel.ELECTRON_STATUS, handler);
  },
  onElectronScanProgress: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, scanEvent: ScanProgressEvent) =>
      cb(scanEvent);
    ipcRenderer.on(IpcChannel.ELECTRON_SCAN_PROGRESS, handler);
    return () => ipcRenderer.off(IpcChannel.ELECTRON_SCAN_PROGRESS, handler);
  },
  // --- Selector probe (selector-validator.ts) ---
  probeSelector: (port: number, selector: string) =>
    ipcRenderer.invoke(IpcChannel.SELECTOR_PROBE, port, selector) as Promise<SelectorProbeResult>,
  validateSelectors: (port: number, agentId: string, selectors: string[]) =>
    ipcRenderer.invoke(
      IpcChannel.SELECTOR_VALIDATE,
      port,
      agentId,
      selectors,
    ) as Promise<SelectorValidationReport>,
};

contextBridge.exposeInMainWorld('agentSkin', api);

/**
 * Minimal subset used only by the splash screen. Exposed separately so the
 * splash window (which has no renderer bundle) can subscribe to progress
 * updates without pulling in the full AgentSkinApi surface.
 */
contextBridge.exposeInMainWorld('splashApi', {
  onSplashProgress: (
    listener: (payload: { label?: string; pct?: number }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { label?: string; pct?: number },
    ) => listener(payload);
    ipcRenderer.on(IpcChannel.SPLASH_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IpcChannel.SPLASH_PROGRESS, handler);
  },
});
