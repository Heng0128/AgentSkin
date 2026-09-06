// SPDX-License-Identifier: MPL-2.0

/**
 * AgentSkin Preload Bridge — unified entry point for renderer → main IPC.
 *
 * This file exposes a single `agentSkin` global on `window` via Electron's
 * contextBridge. It is a **composition shell**: all actual IPC methods live
 * in `preload/facets/*.facet.ts` (11 domain-specific facades), and this file
 * re-exposes them as a single flat object to preserve backward compatibility
 * with the existing renderer codebase (which accesses `window.agentSkin.applyTheme`,
 * `window.agentSkin.windowMinimize`, etc.). Once the renderer has been fully
 * migrated to domain-facade access patterns, this file can evolve into a
 * structured facade (see RFC 2026-09-01-injection-pipeline-bridge-and-cross-cutting).
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { analysis } from './preload/facets/analysis.facet';
import { community } from './preload/facets/community.facet';
import { core } from './preload/facets/core.facet';
import { diagnostics } from './preload/facets/diagnostics.facet';
import { electron } from './preload/facets/electron.facet';
import { injection } from './preload/facets/injection.facet';
import { misc } from './preload/facets/misc.facet';
import { settings } from './preload/facets/settings.facet';
import { studio } from './preload/facets/studio.facet';
import { wallpaper } from './preload/facets/wallpaper.facet';
import { windowControls } from './preload/facets/window.facet';
import { IpcChannel } from './shared/ipc-channels';

/**
 * Flat-composed AgentSkinApi — backward-compatible shape.
 *
 * All domain-facets are spread into a single object so renderers can access
 * `api.applyTheme(...)`, `api.windowMinimize()`, etc. without knowing which
 * facet owns the method. New code is encouraged to import facets directly via
 * `window.agentSkin.facets.<domain>.<method>()` once the structured exposure
 * is enabled (Phase B2).
 */
const api = {
  // --- Core ---
  getBootstrap: core.getBootstrap,
  setLocale: core.setLocale,
  setThemeMode: core.setThemeMode,
  refreshStatus: core.refreshStatus,
  sendRendererConcurrencyMetrics: core.sendRendererConcurrencyMetrics,
  onStatusChanged: core.onStatusChanged,
  onBootWarnings: core.onBootWarnings,
  onRuntimeLog: core.onRuntimeLog,
  onFileImported: core.onFileImported,
  onFileImportConfirm: core.onFileImportConfirm,
  onFileImportFailed: core.onFileImportFailed,
  onTrayApply: core.onTrayApply,
  onThemeHotReload: core.onThemeHotReload,
  onDeepLink: core.onDeepLink,
  onCoordinatorStatus: core.onCoordinatorStatus,
  getCoordinatorSnapshot: core.getCoordinatorSnapshot,
  queryCoordinatorState: core.queryCoordinatorState,

  // --- Injection ---
  applyTheme: injection.applyTheme,
  restoreApp: injection.restoreApp,
  importTheme: injection.importTheme,
  importThemeFromPath: injection.importThemeFromPath,
  importThemeBytes: injection.importThemeBytes,
  openThemeFile: injection.openThemeFile,
  exportTheme: injection.exportTheme,
  deleteTheme: injection.deleteTheme,
  createBundle: injection.createBundle,
  installBundle: injection.installBundle,
  themeUsageGet: injection.themeUsageGet,
  onThemeUsageChanged: injection.onThemeUsageChanged,
  catalog: injection.catalog,
  quickApplySubmit: injection.quickApplySubmit,
  quickApplyUndo: injection.quickApplyUndo,
  onQuickApplyProgress: injection.onQuickApplyProgress,
  triggerManualRegen: injection.triggerManualRegen,
  onThemeEngineInjectFailure: injection.onThemeEngineInjectFailure,
  onThemeBackgroundTaskFailure: injection.onThemeBackgroundTaskFailure,

  // --- Wallpaper ---
  listWallpapers: wallpaper.listWallpapers,
  setWallpaper: wallpaper.setWallpaper,
  importWallpaper: wallpaper.importWallpaper,
  deleteWallpaper: wallpaper.deleteWallpaper,
  setAgentWallpaper: wallpaper.setAgentWallpaper,
  applyAgentWallpaper: wallpaper.applyAgentWallpaper,
  applyWallpaperToAgent: wallpaper.applyWallpaperToAgent,
  removeWallpaperFromAgent: wallpaper.removeWallpaperFromAgent,
  extractThemeFromWallpaper: wallpaper.extractThemeFromWallpaper,
  previewThemeFromWallpaper: wallpaper.previewThemeFromWallpaper,
  applyThemeFromWallpaper: wallpaper.applyThemeFromWallpaper,
  wallpaperVideoUrl: wallpaper.wallpaperVideoUrl,
  wallpaperWebUrl: wallpaper.wallpaperWebUrl,
  wallpaperPreviewUrl: wallpaper.wallpaperPreviewUrl,
  wallpaperStaticFrame: wallpaper.wallpaperStaticFrame,
  getEnvironmentPresets: wallpaper.getEnvironmentPresets,
  saveEnvironmentPresets: wallpaper.saveEnvironmentPresets,
  weDetect: wallpaper.weDetect,

  // --- Settings ---
  getSettings: settings.getSettings,
  pickAppPath: settings.pickAppPath,
  clearAppPath: settings.clearAppPath,
  setAppPort: settings.setAppPort,
  getCustomThemeCss: settings.getCustomThemeCss,
  setCustomThemeCss: settings.setCustomThemeCss,
  setLiveDomRefreshInterval: settings.setLiveDomRefreshInterval,
  getMarkdownStyles: settings.getMarkdownStyles,
  saveMarkdownStyles: settings.saveMarkdownStyles,
  listStyleSheets: settings.listStyleSheets,
  getStyleSheetText: settings.getStyleSheetText,
  applyRawCssEdit: settings.applyRawCssEdit,

  // --- Studio ---
  openStudioWindow: studio.openStudioWindow,
  snapshotThemeDom: studio.snapshotThemeDom,
  snapshotBaseline: studio.snapshotBaseline,
  captureLiveDom: studio.captureLiveDom,
  writeLiveDomCache: studio.writeLiveDomCache,
  readLiveDomCache: studio.readLiveDomCache,
  startInspect: studio.startInspect,
  stopInspect: studio.stopInspect,
  onInspectResult: studio.onInspectResult,
  exportStudioTheme: studio.exportStudioTheme,
  listStudioProjects: studio.listStudioProjects,
  createStudioProject: studio.createStudioProject,
  saveStudioProject: studio.saveStudioProject,
  deleteStudioProject: studio.deleteStudioProject,
  importStudioProject: studio.importStudioProject,
  saveStudioSnapshot: studio.saveStudioSnapshot,
  loadStudioSnapshot: studio.loadStudioSnapshot,
  extractThemeFromImage: studio.extractThemeFromImage,
  listBundles: studio.listBundles,
  importBundle: studio.importBundle,
  installBundleById: studio.installBundleById,
  deleteBundle: studio.deleteBundle,
  listWallpapersForStudio: studio.listWallpapersForStudio,
  getVisualAnalysisTarget: studio.getVisualAnalysisTarget,
  listVisualAnalysisTargets: studio.listVisualAnalysisTargets,
  listVisualAnalysisSummaries: studio.listVisualAnalysisSummaries,
  detectVisualAnalysisAgent: studio.detectVisualAnalysisAgent,
  onVisualAnalysisProgress: studio.onVisualAnalysisProgress,
  exportVisualAnalysisTheme: studio.exportVisualAnalysisTheme,
  listStudioTemplates: studio.listStudioTemplates,
  getStudioTemplate: studio.getStudioTemplate,
  convertThemeAsset: studio.convertThemeAsset,
  listThemeAdapters: studio.listThemeAdapters,

  // --- Window controls (custom title bar + shell utilities) ---
  windowMinimize: windowControls.minimize,
  windowToggleMaximize: windowControls.toggleMaximize,
  windowClose: windowControls.close,
  windowIsMaximized: windowControls.isMaximized,
  onWindowMaximizeChange: windowControls.onMaximizeChange,
  showInFolder: windowControls.showInFolder,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  // --- Electron app discovery & launch ---
  scanElectronApps: electron.scanElectronApps,
  launchElectronApp: electron.launchElectronApp,
  registerCustomExe: electron.registerCustomExe,
  onElectronScanProgress: electron.onElectronScanProgress,

  // --- Community Theme (DreamSkin + CodeDrobe, routed by sourceId) ---
  listCommunityThemes: community.listCommunityThemes,
  getCommunityTheme: community.getCommunityTheme,
  downloadCommunityTheme: community.downloadCommunityTheme,
  cancelCommunityDownload: community.cancelCommunityDownload,
  onCommunityDownloadProgress: community.onCommunityDownloadProgress,
  probeCommunitySource: community.probeCommunitySource,
  loadCommunityInstallLog: community.loadCommunityInstallLog,
  saveCommunityInstallLog: community.saveCommunityInstallLog,

  // --- Diagnostics ---
  getPerformanceTimeouts: diagnostics.getPerformanceTimeouts,
  clearPerformanceTimeouts: diagnostics.clearPerformanceTimeouts,
  getPerformanceHistory: diagnostics.getPerformanceHistory,
  getPerformanceMemory: diagnostics.getPerformanceMemory,
  onDiagnosticsConcurrencyMetrics: diagnostics.onDiagnosticsConcurrencyMetrics,
  onPerformanceNewTrace: diagnostics.onPerformanceNewTrace,
  onPersistFailureWarning: diagnostics.onPersistFailureWarning,
  onPerformanceCdpMetrics: diagnostics.onPerformanceCdpMetrics,
  onSecondaryInjectProgress: diagnostics.onSecondaryInjectProgress,
  onSecondaryInjectSummary: diagnostics.onSecondaryInjectSummary,
  onThemeHealthReport: diagnostics.onThemeHealthReport,
  onThemeDriftStatus: diagnostics.onThemeDriftStatus,

  // --- Analysis (native profile, treatment, transforms, overrides, selector probe, ASAR) ---
  buildNativeProfile: analysis.buildNativeProfile,
  onNativeProfileReady: analysis.onNativeProfileReady,
  classifyComponents: analysis.classifyComponents,
  generateTreatmentCss: analysis.generateTreatmentCss,
  upsertLedgerEntry: analysis.upsertLedgerEntry,
  toggleLedgerEntry: analysis.toggleLedgerEntry,
  setLedgerActionEnabled: analysis.setLedgerActionEnabled,
  getLedgerCss: analysis.getLedgerCss,
  getLedgerState: analysis.getLedgerState,
  addToWhitelist: analysis.addToWhitelist,
  addToBlacklist: analysis.addToBlacklist,
  confirmTreatment: analysis.confirmTreatment,
  getOverrideMetrics: analysis.getOverrideMetrics,
  probeSelector: analysis.probeSelector,
  validateSelectors: analysis.validateSelectors,
  discoverAsar: analysis.discoverAsar,
  extractAsar: analysis.extractAsar,
  scanAsar: analysis.scanAsar,
  readAsarFile: analysis.readAsarFile,
  jointAnalysis: analysis.jointAnalysis,

  // --- Misc (pet, MCP, tweak) ---
  petShow: misc.petShow,
  petHide: misc.petHide,
  petMove: misc.petMove,
  petSet: misc.petSet,
  getMcpStatus: misc.getMcpStatus,
  startMcp: misc.startMcp,
  stopMcp: misc.stopMcp,
  pushTweak: misc.pushTweak,
  saveTweakAsCustomCss: misc.saveTweakAsCustomCss,
  resetTweak: misc.resetTweak,

  /**
   * Facade accessors (Phase B2: opt-in, Phase B3: default).
   *
   * Renderers can migrate to `window.agentSkin.facets.injection.applyTheme(...)`
   * to get better type inference, tree-shaking, and domain isolation. The flat
   * keys above remain for backward compatibility until Phase B4.
   */
  facets: {
    core,
    injection,
    wallpaper,
    settings,
    studio,
    window: windowControls,
    diagnostics,
    electron,
    community,
    misc,
    analysis,
  },
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
