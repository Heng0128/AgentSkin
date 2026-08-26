// SPDX-License-Identifier: MPL-2.0

/**
 * # useStudioStore (facade)
 *
 * Compatibility layer that re-exports the four decomposed sub-stores as a
 * single unified `useStudioStore` hook. All existing consumers (components,
 * hooks, pages) that call `useStudioStore(selector)` continue to work
 * without modification.
 *
 * The facade merges state from all sub-stores into a single object for
 * selector-based reads, and exposes `getState()` / `setState()` for
 * imperative access (matching the original zustand store API).
 */

import { useMemo, useRef } from 'react';
import { api } from '@/api/agentSkinClient';
import type { StudioBundle } from '@/studio/bundle-store';
import { useBundleStore } from '@/studio/bundle-store';
import type { ExportState } from '@/studio/capture-store';
import { useCaptureStore } from '@/studio/capture-store';
import { useImageWallpaperStore } from '@/studio/image-wallpaper-store';
import { useProjectStore } from '@/studio/project-store';
import type { ToolOverride } from '@/types/override';
import type { PreviewView } from '@/types/workspace';

import type {
  AgentId,
  InspectedNode,
  StudioProject,
  ThemeCatalogItem,
  ThemeColorsFromImage,
  ThemeVisualSnapshot,
} from '@shared/types';
import type { HealthCheckReport } from '@shared/types/health-check';
import { useShallow } from 'zustand/react/shallow';

/**
 * Combined state data shape — mirrors the original monolithic StudioStoreState
 * data fields so that existing selectors continue to work.
 */
export interface CombinedStudioStateData {
  // --- project-store ---
  projects: StudioProject[];
  activeProjectId: string | null;
  creatingProject: boolean;
  newName: string;
  newAuthor: string;
  newAgent: AgentId;
  importing: boolean;
  editingId: string | null;
  editName: string;
  editAuthor: string;

  // --- bundle-store ---
  bundles: StudioBundle[];
  bundlesLoading: boolean;

  // --- capture-store ---
  previewView: PreviewView;
  inspectingIdx: number | null;
  searchQuery: string;
  hoveredIdx: number | null;
  toolOverrides: ToolOverride | null;
  undoStack: (ToolOverride | null)[];
  redoStack: (ToolOverride | null)[];
  inspectMode: boolean;
  liveNode: InspectedNode | null;
  liveError: string | null;
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  pseudoView: string | null;
  schemeView: 'light' | 'dark' | null;
  baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>;
  baselineLoadingMap: Partial<Record<AgentId, boolean>>;
  baselineErrorMap: Partial<Record<AgentId, string>>;
  exportName: string;
  exportAuthor: string;
  exportState: ExportState;
  domTreeVersion: number;

  // --- image-wallpaper-store ---
  imageToThemeStatus: 'idle' | 'extracting' | 'ready' | 'error';
  imageToThemeError: string | null;
  imageToThemeMode: 'light' | 'dark' | null;
  imageToThemePalette: ThemeColorsFromImage | null;
  imageToThemeAccent: string | null;
  wallpaperPreviewPalette: ThemeColorsFromImage | null;
  wallpaperPreviewLoading: boolean;
  wallpaperPreviewError: string | null;
  wallpaperApplyLoading: boolean;
  wallpaperApplyError: string | null;
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;

  // --- IPC-subscribed progress / health (kept in facade; domain-agnostic) ---
  analysisProgress: { agent: string; step: string; progress: number } | null;
  healthReportByAgent: Record<string, HealthCheckReport>;
}

/**
 * IPC subscription deduplication flags.
 * These are module-level booleans (not reactive state) used solely to prevent
 * duplicate subscriptions across HMR. The actual data lives in capture-store.
 */
let _analysisProgressSubscribed = false;
let _healthReportSubscribed = false;

/** Minimal shape needed from project-store for combined state. */
interface ProjectStatePick {
  projects: StudioProject[];
  activeProjectId: string | null;
  creatingProject: boolean;
  projectForm: { name: string; author: string; agentId: AgentId };
  importing: boolean;
  editing: { id: string; name: string; author: string } | null;
}

/** Minimal shape needed from bundle-store for combined state. */
interface BundleStatePick {
  bundles: StudioBundle[];
  bundlesLoading: boolean;
}

/** Minimal shape needed from capture-store for combined state. */
interface CaptureStatePick {
  previewView: PreviewView;
  inspectingIdx: number | null;
  searchQuery: string;
  hoveredIdx: number | null;
  toolOverrides: ToolOverride | null;
  undoStack: (ToolOverride | null)[];
  redoStack: (ToolOverride | null)[];
  inspectMode: boolean;
  liveNode: InspectedNode | null;
  liveError: string | null;
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  pseudoView: string | null;
  schemeView: 'light' | 'dark' | null;
  baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>;
  baselineLoadingMap: Partial<Record<AgentId, boolean>>;
  baselineErrorMap: Partial<Record<AgentId, string>>;
  exportName: string;
  exportAuthor: string;
  exportState: ExportState;
  domTreeVersion: number;
  analysisProgress: { agent: string; step: string; progress: number } | null;
  healthReportByAgent: Record<string, import('@shared/types').HealthCheckReport>;
}

/** Minimal shape needed from image-wallpaper-store for combined state. */
interface ImageWallpaperStatePick {
  imageToTheme: {
    status: 'idle' | 'extracting' | 'ready' | 'error';
    error: string | null;
    mode: 'light' | 'dark' | null;
    palette: ThemeColorsFromImage | null;
    accent: string | null;
  };
  wallpaperPreview: {
    palette: ThemeColorsFromImage | null;
    loading: boolean;
    error: string | null;
  };
  wallpaperApply: { loading: boolean; error: string | null };
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;
}

/** Build the combined state snapshot from explicit sub-store states (for use inside the hook). */
function buildCombinedState(
  project: ProjectStatePick,
  bundle: BundleStatePick,
  capture: CaptureStatePick,
  iw: ImageWallpaperStatePick,
): CombinedStudioStateData {
  return {
    // project-store
    projects: project.projects,
    activeProjectId: project.activeProjectId,
    creatingProject: project.creatingProject,
    newName: project.projectForm.name,
    newAuthor: project.projectForm.author,
    newAgent: project.projectForm.agentId,
    importing: project.importing,
    editingId: project.editing?.id ?? null,
    editName: project.editing?.name ?? '',
    editAuthor: project.editing?.author ?? '',

    // bundle-store
    bundles: bundle.bundles,
    bundlesLoading: bundle.bundlesLoading,

    // capture-store
    previewView: capture.previewView,
    inspectingIdx: capture.inspectingIdx,
    searchQuery: capture.searchQuery,
    hoveredIdx: capture.hoveredIdx,
    toolOverrides: capture.toolOverrides,
    undoStack: capture.undoStack,
    redoStack: capture.redoStack,
    inspectMode: capture.inspectMode,
    liveNode: capture.liveNode,
    liveError: capture.liveError,
    pinnedSelectors: capture.pinnedSelectors,
    pseudoStates: capture.pseudoStates,
    captureSchemes: capture.captureSchemes,
    customSelectorInput: capture.customSelectorInput,
    pseudoView: capture.pseudoView,
    schemeView: capture.schemeView,
    baselines: capture.baselines,
    baselineLoadingMap: capture.baselineLoadingMap,
    baselineErrorMap: capture.baselineErrorMap,
    exportName: capture.exportName,
    exportAuthor: capture.exportAuthor,
    exportState: capture.exportState,
    domTreeVersion: capture.domTreeVersion,

    // image-wallpaper-store
    imageToThemeStatus: iw.imageToTheme.status,
    imageToThemeError: iw.imageToTheme.error,
    imageToThemeMode: iw.imageToTheme.mode,
    imageToThemePalette: iw.imageToTheme.palette,
    imageToThemeAccent: iw.imageToTheme.accent,
    wallpaperPreviewPalette: iw.wallpaperPreview.palette,
    wallpaperPreviewLoading: iw.wallpaperPreview.loading,
    wallpaperPreviewError: iw.wallpaperPreview.error,
    wallpaperApplyLoading: iw.wallpaperApply.loading,
    wallpaperApplyError: iw.wallpaperApply.error,
    installedThemes: iw.installedThemes,
    themeLibraryOpen: iw.themeLibraryOpen,

    // IPC-subscribed (stored in capture-store)
    analysisProgress: capture.analysisProgress,
    healthReportByAgent: capture.healthReportByAgent,
  };
}

/** Build the combined state snapshot from all sub-stores (for imperative access). */
function getCombinedState(): CombinedStudioStateData {
  return buildCombinedState(
    useProjectStore.getState(),
    useBundleStore.getState(),
    useCaptureStore.getState(),
    useImageWallpaperStore.getState(),
  );
}

/**
 * Facade hook: subscribes to all sub-stores and returns either the full
 * combined state or a selected slice.
 *
 * @example
 *   // Full state (no selector)
 *   const state = useStudioStore();
 *
 *   // Selector mode (only re-renders when the selected value changes)
 *   const activeProject = useStudioStore((s) => s.getActiveProject());
 */
export function useStudioStore(): CombinedStudioStore;
export function useStudioStore<T>(selector: (state: CombinedStudioStore) => T): T;
export function useStudioStore<T>(
  selector?: (state: CombinedStudioStore) => T,
): T | CombinedStudioStore {
  // Subscribe to sub-stores with useShallow to avoid re-renders when unrelated
  // fields change. Each subscription selects only the fields consumed by
  // getCombinedState(), preventing full re-renders on every sub-store update.
  const projectState = useProjectStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      creatingProject: s.creatingProject,
      projectForm: s.projectForm,
      importing: s.importing,
      editing: s.editing,
    })),
  );
  const bundleState = useBundleStore(
    useShallow((s) => ({
      bundles: s.bundles,
      bundlesLoading: s.bundlesLoading,
    })),
  );
  const captureState = useCaptureStore(
    useShallow((s) => ({
      previewView: s.previewView,
      inspectingIdx: s.inspectingIdx,
      searchQuery: s.searchQuery,
      hoveredIdx: s.hoveredIdx,
      toolOverrides: s.toolOverrides,
      undoStack: s.undoStack,
      redoStack: s.redoStack,
      inspectMode: s.inspectMode,
      liveNode: s.liveNode,
      liveError: s.liveError,
      pinnedSelectors: s.pinnedSelectors,
      pseudoStates: s.pseudoStates,
      captureSchemes: s.captureSchemes,
      customSelectorInput: s.customSelectorInput,
      pseudoView: s.pseudoView,
      schemeView: s.schemeView,
      baselines: s.baselines,
      baselineLoadingMap: s.baselineLoadingMap,
      baselineErrorMap: s.baselineErrorMap,
      exportName: s.exportName,
      exportAuthor: s.exportAuthor,
      exportState: s.exportState,
      domTreeVersion: s.domTreeVersion,
      analysisProgress: s.analysisProgress,
      healthReportByAgent: s.healthReportByAgent,
    })),
  );
  const iwState = useImageWallpaperStore(
    useShallow((s) => ({
      imageToTheme: s.imageToTheme,
      wallpaperPreview: s.wallpaperPreview,
      wallpaperApply: s.wallpaperApply,
      installedThemes: s.installedThemes,
      themeLibraryOpen: s.themeLibraryOpen,
    })),
  );

  // Memoize the combined state to maintain a stable reference across renders.
  // Without memoization, every render creates a new object, causing consumers
  // using React.memo or shallow comparison to re-render unnecessarily.
  const combined = useMemo(
    () => buildCombinedState(projectState, bundleState, captureState, iwState),
    [projectState, bundleState, captureState, iwState],
  );
  // RC2-A fix: Cache actions in a ref to keep a stable reference across renders.
  // Actions are static functions that never change identity — caching them in a ref
  // prevents useMemo from re-creating the result object on every render.
  //
  // RC1-step5: The ref is updated during render to always hold the latest actions.
  // This is the standard React pattern for keeping a ref in sync with the latest
  // value. Since getState() is now cached (RC1-step1), it returns the same
  // reference when no sub-store has changed, so the useMemo below remains stable.
  const actionsRef = useRef(useStudioStore.getState());
  actionsRef.current = useStudioStore.getState();
  const result = useMemo(() => ({ ...actionsRef.current, ...combined }), [combined]);
  return selector ? selector(result) : result;
}

/**
 * Extended combined state that includes derived helpers and actions.
 * This is what selectors actually receive.
 */
export interface CombinedStudioState extends CombinedStudioStore {}

export interface CombinedStudioStore {
  // State (same as CombinedStudioState)
  projects: StudioProject[];
  activeProjectId: string | null;
  creatingProject: boolean;
  newName: string;
  newAuthor: string;
  newAgent: AgentId;
  importing: boolean;
  editingId: string | null;
  editName: string;
  editAuthor: string;
  bundles: StudioBundle[];
  bundlesLoading: boolean;
  previewView: PreviewView;
  inspectingIdx: number | null;
  searchQuery: string;
  hoveredIdx: number | null;
  toolOverrides: ToolOverride | null;
  undoStack: (ToolOverride | null)[];
  redoStack: (ToolOverride | null)[];
  inspectMode: boolean;
  liveNode: InspectedNode | null;
  liveError: string | null;
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  pseudoView: string | null;
  schemeView: 'light' | 'dark' | null;
  baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>;
  baselineLoadingMap: Partial<Record<AgentId, boolean>>;
  baselineErrorMap: Partial<Record<AgentId, string>>;
  exportName: string;
  exportAuthor: string;
  exportState: ExportState;
  domTreeVersion: number;
  imageToThemeStatus: 'idle' | 'extracting' | 'ready' | 'error';
  imageToThemeError: string | null;
  imageToThemeMode: 'light' | 'dark' | null;
  imageToThemePalette: ThemeColorsFromImage | null;
  imageToThemeAccent: string | null;
  wallpaperPreviewPalette: ThemeColorsFromImage | null;
  wallpaperPreviewLoading: boolean;
  wallpaperPreviewError: string | null;
  wallpaperApplyLoading: boolean;
  wallpaperApplyError: string | null;
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;

  // --- IPC-subscribed progress / health ---
  analysisProgress: { agent: string; step: string; progress: number } | null;
  healthReportByAgent: Record<string, HealthCheckReport>;
  initAnalysisProgressSubscription(): void;
  initHealthReportSubscription(): void;

  // Derived helpers
  getActiveProject(): StudioProject | null;

  // Project actions
  refreshProjects(): Promise<void>;
  createProject(): Promise<void>;
  importProject(): Promise<void>;
  deleteProject(id: string): Promise<void>;
  renameProject(p: StudioProject, name: string, author: string): Promise<void>;
  saveActiveProject(patch: Partial<StudioProject>): Promise<void>;
  selectProject(id: string | null): void;
  changeAgent(agentId: AgentId): Promise<void>;
  refreshThemeLibrary(): Promise<void>;
  loadThemeIntoProject(themeId: string): Promise<void>;
  refreshBundles(): Promise<void>;
  importAndInstallBundle(): Promise<string | null>;
  installBundle(id: string): Promise<void>;
  deleteBundle(id: string): Promise<void>;

  // Capture actions
  baselineSnapshot(): Promise<void>;
  restoreAgent(): Promise<void>;
  exportTheme(): Promise<void>;
  toggleInspect(): Promise<void>;
  setOverride(key: keyof ToolOverride, value: string | number | boolean | undefined): void;
  resetOverrides(): void;
  undo(): void;
  redo(): void;
  addPinnedSelector(): void;
  removePinnedSelector(sel: string): void;
  togglePseudo(state: string): void;
  applyPalette(palette: Record<string, string | undefined>, action: 'preview' | 'apply'): void;
  setOverrideColors(palette: Record<string, string>): void;
  setPaletteLoaded(palette: Record<string, string>): void;
  pinSelector(sel: string): void;
  extractImageFromImage(base64Data: string): Promise<void>;
  applyWallpaperExtractedPalette(wallpaperId: string): Promise<void>;
  applyImageToTheme(): void;
  clearImageToTheme(): void;
  setImageAccent(hex: string): void;
  previewWallpaperTheme(wallpaperId: string): void;
  applyWallpaperTheme(wallpaperId: string): Promise<boolean>;
  clearWallpaperPreview(): void;

  // Simple setters
  setCreatingProject(v: boolean): void;
  setNewName(v: string): void;
  setNewAuthor(v: string): void;
  setNewAgent(v: AgentId): void;
  setEditingId(v: string | null): void;
  setEditName(v: string): void;
  setEditAuthor(v: string): void;
  setThemeLibraryOpen(v: boolean): void;
  setCustomSelectorInput(v: string): void;
  setPreviewView(v: PreviewView): void;
  setSearchQuery(v: string): void;
  setHoveredIdx(v: number | null): void;
  setInspectingIdx(v: number | null): void;
  setPseudoView(v: string | null): void;
  setSchemeView(v: 'light' | 'dark' | null): void;
  setCaptureSchemes(v: boolean): void;
  setExportName(v: string): void;
  setExportAuthor(v: string): void;
  setInspectResult(node: InspectedNode | { error: string }): void;
}

// ------------------------------------------------------------------
// getState / setState (imperative API for non-React consumers & tests)
// ------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getState() reference stability cache
// ---------------------------------------------------------------------------
// RC1-step1: Cache the previous combined state and only return a new reference
// when one of the four sub-store states actually changes (by reference).
// Without this, every getState() call creates a new object + new action closures,
// breaking referential equality for consumers that compare prev/next state.
let _cachedState: CombinedStudioStore | null = null;
let _cachedProjectVersion: object | null = null;
let _cachedBundleVersion: object | null = null;
let _cachedCaptureVersion: object | null = null;
let _cachedIwVersion: object | null = null;

/**
 * Imperative state access — mirrors zustand's `useStore.getState()`.
 * Returns the full combined state with all actions bound.
 *
 * RC1-step1: Returns a cached reference when no sub-store has changed since
 * the last call, preventing unnecessary re-renders in subscribers that rely
 * on referential equality (e.g. React.memo, useEffect deps).
 */
useStudioStore.getState = (): CombinedStudioStore => {
  // Read raw sub-store states (zustand returns same ref until setState is called)
  const projectSnap = useProjectStore.getState();
  const bundleSnap = useBundleStore.getState();
  const captureSnap = useCaptureStore.getState();
  const iwSnap = useImageWallpaperStore.getState();

  // If none of the four sub-stores changed their root reference, return cached.
  if (
    _cachedState &&
    _cachedProjectVersion === projectSnap &&
    _cachedBundleVersion === bundleSnap &&
    _cachedCaptureVersion === captureSnap &&
    _cachedIwVersion === iwSnap
  ) {
    return _cachedState;
  }

  // Cache miss — rebuild and store version markers.
  _cachedProjectVersion = projectSnap;
  _cachedBundleVersion = bundleSnap;
  _cachedCaptureVersion = captureSnap;
  _cachedIwVersion = iwSnap;

  const state = getCombinedState();
  _cachedState = {
    ...state,
    // Derived helpers — RC1-step2: use the stable-reference variant so that
    // getState().getActiveProject() returns a cached reference when the
    // active project's identity (id + updatedAt) hasn't changed.
    getActiveProject: () => useProjectStore.getState().getActiveProjectStable(),

    // Project actions
    refreshProjects: () => useProjectStore.getState().refreshProjects(),
    createProject: () => useProjectStore.getState().createProject(),
    importProject: () => useProjectStore.getState().importProject(),
    deleteProject: (id) => useProjectStore.getState().deleteProject(id),
    renameProject: (p, name, author) => useProjectStore.getState().renameProject(p, name, author),
    saveActiveProject: (patch) => useProjectStore.getState().saveActiveProject(patch),
    selectProject: (id) => useProjectStore.getState().selectProject(id),
    changeAgent: async (agentId) => {
      // Delegate to project store's saveActiveProject + capture store reset
      const project = useProjectStore.getState().getActiveProject();
      if (project) {
        void useProjectStore.getState().saveActiveProject({ agentId });
      }
      useCaptureStore.getState().resetOverrides();
      useCaptureStore.setState({
        inspectingIdx: null,
        undoStack: [],
        redoStack: [],
      });
    },
    refreshThemeLibrary: () => useImageWallpaperStore.getState().refreshThemeLibrary(),
    loadThemeIntoProject: (themeId) =>
      useImageWallpaperStore.getState().loadThemeIntoProject(themeId),
    refreshBundles: () => useBundleStore.getState().refreshBundles(),
    importAndInstallBundle: () => useBundleStore.getState().importAndInstallBundle(),
    installBundle: (id) => useBundleStore.getState().installBundle(id),
    deleteBundle: (id) => useBundleStore.getState().deleteBundle(id),

    // Capture actions
    baselineSnapshot: () => useCaptureStore.getState().baselineSnapshot(),
    restoreAgent: () => useCaptureStore.getState().restoreAgent(),
    exportTheme: () => useCaptureStore.getState().exportTheme(),
    toggleInspect: () => useCaptureStore.getState().toggleInspect(),
    setOverride: (key, value) => useCaptureStore.getState().setOverride(key, value),
    resetOverrides: () => useCaptureStore.getState().resetOverrides(),
    undo: () => useCaptureStore.getState().undo(),
    redo: () => useCaptureStore.getState().redo(),
    addPinnedSelector: () => useCaptureStore.getState().addPinnedSelector(),
    removePinnedSelector: (sel) => useCaptureStore.getState().removePinnedSelector(sel),
    togglePseudo: (state) => useCaptureStore.getState().togglePseudo(state),
    applyPalette: (palette, action) => useCaptureStore.getState().applyPalette(palette, action),
    setOverrideColors: (palette) => useCaptureStore.getState().setOverrideColors(palette),
    setPaletteLoaded: (palette) => useCaptureStore.getState().setPaletteLoaded(palette),
    pinSelector: (sel) => useCaptureStore.getState().pinSelector(sel),
    extractImageFromImage: (base64Data) =>
      useImageWallpaperStore.getState().extractImageFromImage(base64Data),
    applyWallpaperExtractedPalette: (wallpaperId) =>
      useImageWallpaperStore.getState().applyWallpaperExtractedPalette(wallpaperId),
    applyImageToTheme: () => useImageWallpaperStore.getState().applyImageToTheme(),
    clearImageToTheme: () => useImageWallpaperStore.getState().clearImageToTheme(),
    setImageAccent: (hex) => useImageWallpaperStore.getState().setImageAccent(hex),
    previewWallpaperTheme: (wallpaperId) =>
      useImageWallpaperStore.getState().previewWallpaperTheme(wallpaperId),
    applyWallpaperTheme: (wallpaperId) =>
      useImageWallpaperStore.getState().applyWallpaperTheme(wallpaperId),
    clearWallpaperPreview: () => useImageWallpaperStore.getState().clearWallpaperPreview(),

    // Simple setters
    setCreatingProject: (v) => useProjectStore.getState().setCreatingProject(v),
    setNewName: (v) => useProjectStore.getState().setProjectName(v),
    setNewAuthor: (v) => useProjectStore.getState().setProjectAuthor(v),
    setNewAgent: (v) => useProjectStore.getState().setProjectAgent(v),
    setEditingId: (v) => {
      if (v) useProjectStore.getState().startEditing(v);
      else useProjectStore.getState().cancelEditing();
    },
    setEditName: (v) => useProjectStore.getState().updateEditingField('name', v),
    setEditAuthor: (v) => useProjectStore.getState().updateEditingField('author', v),
    setThemeLibraryOpen: (v) => useImageWallpaperStore.getState().setThemeLibraryOpen(v),
    setCustomSelectorInput: (v) => useCaptureStore.getState().setCustomSelectorInput(v),
    setPreviewView: (v) => useCaptureStore.getState().setPreviewView(v),
    setSearchQuery: (v) => useCaptureStore.getState().setSearchQuery(v),
    setHoveredIdx: (v) => useCaptureStore.getState().setHoveredIdx(v),
    setInspectingIdx: (v) => useCaptureStore.getState().setInspectingIdx(v),
    setPseudoView: (v) => useCaptureStore.getState().setPseudoView(v),
    setSchemeView: (v) => useCaptureStore.getState().setSchemeView(v),
    setCaptureSchemes: (v) => useCaptureStore.getState().setCaptureSchemes(v),
    setExportName: (v) => useCaptureStore.getState().setExportName(v),
    setExportAuthor: (v) => useCaptureStore.getState().setExportAuthor(v),
    setInspectResult: (node) => useCaptureStore.getState().setInspectResult(node),

    // --- IPC-subscribed progress / health ---
    initAnalysisProgressSubscription: () => {
      if (_analysisProgressSubscribed) return;
      _analysisProgressSubscribed = true;
      api.onVisualAnalysisProgress((payload) => {
        // Store in capture-store (semantic owner) to trigger React re-render
        useCaptureStore.getState().setAnalysisProgress(payload);
      });
    },
    initHealthReportSubscription: () => {
      if (_healthReportSubscribed) return;
      _healthReportSubscribed = true;
      api.onThemeHealthReport((report) => {
        // Store in capture-store (semantic owner) to trigger React re-render
        useCaptureStore.getState().setHealthReport(report);
      });
    },
  };
  return _cachedState;
};

/**
 * Imperative state mutation — mirrors zustand's `useStore.setState()`.
 * Merges the partial state into the appropriate sub-store.
 *
 * Handles both flat keys (backward compat) and maps them to the nested
 * sub-store state structures.
 */
useStudioStore.setState = (partial: Partial<CombinedStudioStore>): void => {
  const p = partial as Record<string, unknown>;

  // --- Project-store fields ---
  const projectPatch: Record<string, unknown> = {};
  if ('projects' in p) projectPatch.projects = p.projects;
  if ('activeProjectId' in p) projectPatch.activeProjectId = p.activeProjectId;
  if ('creatingProject' in p) projectPatch.creatingProject = p.creatingProject;
  if ('importing' in p) projectPatch.importing = p.importing;
  if (Object.keys(projectPatch).length > 0) useProjectStore.setState(projectPatch);

  // --- Bundle-store fields ---
  const bundlePatch: Record<string, unknown> = {};
  if ('bundles' in p) bundlePatch.bundles = p.bundles;
  if ('bundlesLoading' in p) bundlePatch.bundlesLoading = p.bundlesLoading;
  if (Object.keys(bundlePatch).length > 0) useBundleStore.setState(bundlePatch);

  // --- Capture-store fields ---
  const capturePatch: Record<string, unknown> = {};
  const captureKeys = [
    'previewView',
    'inspectingIdx',
    'searchQuery',
    'hoveredIdx',
    'toolOverrides',
    'undoStack',
    'redoStack',
    'inspectMode',
    'liveNode',
    'liveError',
    'pinnedSelectors',
    'pseudoStates',
    'captureSchemes',
    'customSelectorInput',
    'pseudoView',
    'schemeView',
    'baselines',
    'baselineLoadingMap',
    'baselineErrorMap',
    'exportName',
    'exportAuthor',
    'exportState',
    'domTreeVersion',
  ];
  for (const key of captureKeys) {
    if (key in p) capturePatch[key] = p[key];
  }
  if (Object.keys(capturePatch).length > 0) useCaptureStore.setState(capturePatch);

  // --- Image-wallpaper-store fields ---
  // Map flat keys (imageToThemeStatus, imageToThemePalette, etc.) to nested imageToTheme
  const iw = useImageWallpaperStore.getState();
  const iwPatch: Record<string, unknown> = {};
  const imageToThemePatch: Record<string, unknown> = {};
  if ('imageToThemeStatus' in p) imageToThemePatch.status = p.imageToThemeStatus;
  if ('imageToThemeError' in p) imageToThemePatch.error = p.imageToThemeError;
  if ('imageToThemeMode' in p) imageToThemePatch.mode = p.imageToThemeMode;
  if ('imageToThemePalette' in p) imageToThemePatch.palette = p.imageToThemePalette;
  if ('imageToThemeAccent' in p) imageToThemePatch.accent = p.imageToThemeAccent;
  if (Object.keys(imageToThemePatch).length > 0) {
    iwPatch.imageToTheme = { ...iw.imageToTheme, ...imageToThemePatch };
  }

  // Map flat wallpaperPreview keys
  const wpPatch: Record<string, unknown> = {};
  if ('wallpaperPreviewPalette' in p) wpPatch.palette = p.wallpaperPreviewPalette;
  if ('wallpaperPreviewLoading' in p) wpPatch.loading = p.wallpaperPreviewLoading;
  if ('wallpaperPreviewError' in p) wpPatch.error = p.wallpaperPreviewError;
  if (Object.keys(wpPatch).length > 0) {
    iwPatch.wallpaperPreview = { ...iw.wallpaperPreview, ...wpPatch };
  }

  // Map flat wallpaperApply keys
  const waPatch: Record<string, unknown> = {};
  if ('wallpaperApplyLoading' in p) waPatch.loading = p.wallpaperApplyLoading;
  if ('wallpaperApplyError' in p) waPatch.error = p.wallpaperApplyError;
  if (Object.keys(waPatch).length > 0) {
    iwPatch.wallpaperApply = { ...iw.wallpaperApply, ...waPatch };
  }

  if ('installedThemes' in p) iwPatch.installedThemes = p.installedThemes;
  if ('themeLibraryOpen' in p) iwPatch.themeLibraryOpen = p.themeLibraryOpen;
  if (Object.keys(iwPatch).length > 0) useImageWallpaperStore.setState(iwPatch);
};

// Subscribe passthrough (zustand compatibility)
useStudioStore.subscribe = (
  listener: (state: CombinedStudioStore, prevState: CombinedStudioStore) => void,
): (() => void) => {
  // RC5-3: Use a ref-like object to track prevCombined per subscriber.
  // Each subscribe() call gets its own independent ref, avoiding cross-subscriber
  // contamination and ensuring prevState !== currentState.
  const prevRef = { current: useStudioStore.getState() };
  const notify = () => {
    const current = useStudioStore.getState();
    listener(current, prevRef.current);
    prevRef.current = current;
  };
  // Subscribe to all sub-stores and re-emit combined state.
  const unsubs = [
    useProjectStore.subscribe(notify),
    useBundleStore.subscribe(notify),
    useCaptureStore.subscribe(notify),
    useImageWallpaperStore.subscribe(notify),
  ];
  return () => {
    for (const fn of unsubs) fn();
  };
};

// Re-export the original useActiveProject convenience selector
export function useActiveProject(): StudioProject | null {
  return useProjectStore((s) => s.getActiveProject());
}
