// SPDX-License-Identifier: MPL-2.0

/**
 * Studio facet — Theme Studio workspace operations.
 *
 * Covers DOM snapshot (current/baseline), live DOM capture, inspect mode,
 * project CRUD, bundle management, visual-analysis theme extraction, and
 * the studio window launcher.
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type {
  AgentId,
  DomTreeNode,
  InspectedNode,
  StudioLiveDomCacheReadRequest,
  StudioLiveDomCacheWriteRequest,
  StudioProject,
  StudioSnapshotOptions,
  ThemeColorsFromImage,
  ThemeStudioExportRequest,
  ThemeVisualSnapshot,
  VisualAnalysisSummary,
} from '../../shared/types';

function subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const studio = {
  // --- Open the dedicated Theme Studio window ---
  openStudioWindow: () => ipcRenderer.invoke(IpcChannel.STUDIO_OPEN) as Promise<{ ok: boolean }>,

  // --- DOM snapshot (current + baseline) ---
  snapshotThemeDom: (agentId: AgentId, themeId?: string, options?: StudioSnapshotOptions) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_SNAPSHOT, {
      agentId,
      themeId,
      options,
    }) as Promise<ThemeVisualSnapshot>,
  snapshotBaseline: (agentId: AgentId, options?: StudioSnapshotOptions) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_SNAPSHOT_BASELINE, {
      agentId,
      options,
    }) as Promise<ThemeVisualSnapshot>,

  // --- Live DOM capture ---
  captureLiveDom: (agentId: AgentId) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_LIVE_DOM, { agentId }) as Promise<DomTreeNode>,
  writeLiveDomCache: (req: StudioLiveDomCacheWriteRequest) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_LIVE_DOM_CACHE_WRITE, req),
  readLiveDomCache: (req: StudioLiveDomCacheReadRequest) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_LIVE_DOM_CACHE_READ, req),

  // --- DOM inspect (DevTools-style element picker) ---
  startInspect: (agentId: AgentId) =>
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_INSPECT_START, { agentId }),
  stopInspect: () => ipcRenderer.invoke(IpcChannel.THEME_STUDIO_INSPECT_STOP),
  onInspectResult: (listener: (result: InspectedNode | { error: string }) => void) =>
    subscribeEvent(IpcChannel.THEME_STUDIO_INSPECT_RESULT, listener),

  // --- Studio export ---
  exportStudioTheme: (payload: ThemeStudioExportRequest) =>
    ipcRenderer.invoke(IpcChannel.THEME_STUDIO_EXPORT, payload),

  // --- Studio projects (file-backed, no installed-theme dependency) ---
  listStudioProjects: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_LIST) as Promise<StudioProject[]>,
  createStudioProject: (req: { name: string; author: string; agentId: AgentId }) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_CREATE, req) as Promise<StudioProject>,
  saveStudioProject: (project: StudioProject) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_SAVE, project) as Promise<StudioProject>,
  deleteStudioProject: (id: string) =>
    ipcRenderer.invoke(IpcChannel.STUDIO_PROJECT_DELETE, { id }) as Promise<{ ok: boolean }>,
  importStudioProject: () =>
    // TODO: type-guard — 待渐进式加固
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
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_SNAPSHOT_LOAD, {
      projectId,
      kind,
    }) as Promise<ThemeVisualSnapshot | null>,

  // --- Image → palette extraction ---
  extractThemeFromImage: (base64Data: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_IMAGE_EXTRACT_THEME, base64Data) as Promise<{
      palette: ThemeColorsFromImage;
      mode: 'light' | 'dark';
    }>,

  // --- Bundles (workspace-scoped) ---
  listBundles: () =>
    // TODO: type-guard — 待渐进式加固
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

  // --- Wallpaper picker (for studio workspace) ---
  listWallpapersForStudio: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_WALLPAPER_LIST) as Promise<
      Array<{
        id: string;
        name: string;
        type: 'scene' | 'video' | 'web' | 'preset';
        thumbUrl?: string;
      }>
    >,

  // --- Visual Analysis ---
  getVisualAnalysisTarget: (agentName: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_GET, agentName) as Promise<Record<
      string,
      unknown
    > | null>,
  listVisualAnalysisTargets: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_LIST) as Promise<string[]>,
  listVisualAnalysisSummaries: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY) as Promise<VisualAnalysisSummary[]>,
  detectVisualAnalysisAgent: (agentName: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_DETECT, agentName) as Promise<{
      running: boolean;
      port?: number;
      title?: string;
    }>,
  onVisualAnalysisProgress: (
    listener: (progress: { agent: string; step: string; progress: number }) => void,
  ) => subscribeEvent(IpcChannel.VISUAL_ANALYSIS_STATUS, listener),
  exportVisualAnalysisTheme: (agentName: string, themeData: Record<string, unknown>) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME, agentName, themeData) as Promise<{
      ok: boolean;
      path?: string;
    }>,

  // --- Studio theme templates ---
  listStudioTemplates: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_TEMPLATES_LIST) as Promise<
      Array<{
        id: string;
        name: string;
        mode: 'light' | 'dark';
        category: string;
        description: string;
      }>
    >,
  getStudioTemplate: (templateId: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.STUDIO_TEMPLATES_GET, templateId) as Promise<{
      id: string;
      name: string;
      mode: 'light' | 'dark';
      palette: Record<string, string>;
      overrides?: Record<string, number>;
    } | null>,

  // --- Theme asset engine (used by studio workspace) ---
  convertThemeAsset: (input: string, options: Record<string, unknown>) =>
    ipcRenderer.invoke(IpcChannel.THEME_ASSET_CONVERT, input, options) as Promise<{
      ok: boolean;
      adapter?: string;
      confidence?: number;
      tokens?: Record<string, string>;
      agentCss?: Record<string, string>;
      error?: string;
    }>,
  listThemeAdapters: () =>
    ipcRenderer.invoke(IpcChannel.THEME_ASSET_LIST_ADAPTERS) as Promise<
      Array<{
        id: string;
        name: string;
        extensions: string[];
        description: string;
      }>
    >,
};
