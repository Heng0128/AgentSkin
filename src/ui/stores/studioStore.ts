// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Store — Studio 共享状态（P1-4 减重）
 *
 * 收敛 ThemeStudioPage 的 30+ useState + 回调，让 Studio 四个面板
 * （Header / LeftRail / CenterPanel / RightInspector）直读 store，
 * 消除 40/33/20 个 props 的下传。
 *
 * 派生值（activeProject / baseline / colorSets / landmarkSearch 等）不存
 * store——由各组件基于原始状态 useMemo 派生，避免双份真相。
 */

import { api } from '@/api/agentSkinClient';
import { mergeOverridesToSkinTokens } from '@/lib/palette';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import type { ToolOverride } from '@/types/override';
import type { PreviewView } from '@/types/workspace';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import { semanticColorsToPalette } from '@shared/theme-mapping';
import {
  AGENT_META,
  type AgentId,
  type InspectedNode,
  type StudioProject,
  type ThemeCatalogItem,
  type ThemeColorsFromImage,
  type ThemeVisualSnapshot,
} from '@shared/types';
import type { HealthCheckReport } from '@shared/types/health-check';
import { create } from 'zustand';

/** Read current i18n message table (project-standard pattern from installFlowStore / environmentStore). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

/** Serialize ToolOverride to a plain record for export payload. */
function serializeToolOverride(
  overrides: ToolOverride | null,
): Record<string, unknown> | undefined {
  if (!overrides) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(overrides) as (keyof ToolOverride)[]) {
    if (overrides[k] !== undefined) out[k] = overrides[k];
  }
  return out;
}

/**
 * Narrow a partial override record to {@link ToolOverride}.
 *
 * Replaces the scattered `as ToolOverride` casts (which silently bypassed type
 * checking at several sites). ToolOverride is a fully-optional interface, so any
 * plain string-keyed record is structurally valid; this helper makes the trust
 * boundary explicit and drops a malformed `colors` entry (which would otherwise
 * corrupt export token merging) instead of trusting it blindly.
 */
function asToolOverride(value: Record<string, unknown>): ToolOverride {
  const v: Record<string, unknown> = { ...value };
  if (v.colors !== undefined && (v.colors === null || typeof v.colors !== 'object')) {
    delete v.colors;
  }
  return v as ToolOverride;
}

export type ExportState = {
  loading: boolean;
  dir: string | null;
  error: string | null;
};

/** A workspace-scoped installed bundle summary (theme + optional wallpaper). */
export interface StudioBundle {
  id: string;
  name: string;
  themeId?: string;
  hasWallpaper: boolean;
  createdAt: string;
}

interface StudioStoreState {
  // --- Projects ---
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

  // --- Installed-theme library linkage ---
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;

  // --- Bundles (workspace-scoped) ---
  bundles: StudioBundle[];
  bundlesLoading: boolean;

  // --- Baseline (A/B compare mode) ---
  baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>;
  baselineLoadingMap: Partial<Record<AgentId, boolean>>;
  baselineErrorMap: Partial<Record<AgentId, string>>;

  // --- Preview / inspect ---
  previewView: PreviewView;
  inspectingIdx: number | null;
  searchQuery: string;
  hoveredIdx: number | null;
  toolOverrides: ToolOverride | null;
  /** Per-edit undo stack for `toolOverrides` (most recent first). May contain null representing a "cleared to default" state. */
  undoStack: (ToolOverride | null)[];
  inspectMode: boolean;
  liveNode: InspectedNode | null;
  liveError: string | null;

  // --- Capture controls ---
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  pseudoView: string | null;
  schemeView: 'light' | 'dark' | null;

  // --- Image → Theme (pywal-style extraction) ---
  /** Lifecycle: idle → extracting → ready | error. */
  imageToThemeStatus: 'idle' | 'extracting' | 'ready' | 'error';
  imageToThemeError: string | null;
  /** Recommended mode from the extraction engine. */
  imageToThemeMode: 'light' | 'dark' | null;
  /** Raw 14-token palette (engine output). Null until extraction succeeds. */
  imageToThemePalette: ThemeColorsFromImage | null;
  /** User-tweaked accent (hex). Falls back to palette.accent when null. */
  imageToThemeAccent: string | null;

  // --- Wallpaper → Theme live preview (pywal-style Studio linkage) ---
  /** Preview palette derived from the currently selected wallpaper. Null when
   *  no wallpaper has been picked or derivation returned nothing. */
  wallpaperPreviewPalette: ThemeColorsFromImage | null;
  /** True while a wallpaper preview request is in-flight. */
  wallpaperPreviewLoading: boolean;
  /** Error message from the last failed preview attempt (null = no error). */
  wallpaperPreviewError: string | null;
  /** True while a wallpaper→theme apply request is in-flight. */
  wallpaperApplyLoading: boolean;
  /** Error message from the last failed apply attempt (null = no error). */
  wallpaperApplyError: string | null;

  // --- Export ---
  exportName: string;
  exportAuthor: string;
  exportState: ExportState;

  // --- Derived helpers (memoized per call site via getActiveProject) ---
  getActiveProject(): StudioProject | null;

  // --- Project actions ---
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
  /** Refresh installed bundles list from disk. */
  refreshBundles(): Promise<void>;
  /** Open file dialog, import and install a .agentskin-bundle. Returns the imported bundle id. */
  importAndInstallBundle(): Promise<string | null>;
  /** Install an already-stored bundle by id. Applies both theme and wallpaper. */
  installBundle(id: string): Promise<void>;
  /** Delete a bundle by id. */
  deleteBundle(id: string): Promise<void>;
  // --- Capture actions ---
  baselineSnapshot(): Promise<void>;
  restoreAgent(): Promise<void>;
  exportTheme(): Promise<void>;
  toggleInspect(): Promise<void>;
  setOverride(key: keyof ToolOverride, value: string | number | boolean | undefined): void;
  resetOverrides(): void;
  /** Undo the last `toolOverrides` edit. No-op when the stack is empty. */
  undo(): void;
  /** Redo the last undone `toolOverrides` edit. No-op when the stack is empty. */
  redo(): void;
  /** Per-edit redo stack for `toolOverrides` (most recent first). */
  redoStack: (ToolOverride | null)[];
  addPinnedSelector(): void;
  removePinnedSelector(sel: string): void;
  togglePseudo(state: string): void;
  applyPalette(palette: Record<string, string | undefined>, action: 'preview' | 'apply'): void;
  /** Merge a palette into the `colors` override without persisting (image→theme). */
  setOverrideColors(palette: Record<string, string>): void;
  setPaletteLoaded(palette: Record<string, string>): void;
  /** Add a fully-qualified selector (e.g. from live inspect) to pinned selectors. */
  pinSelector(sel: string): void;
  /** Decode + extract a 14-token palette from an uploaded image (IPC). */
  extractImageFromImage(base64Data: string): Promise<void>;
  /**
   * Bridge wallpaper → Studio: extract a palette from a wallpaper via the
   * public WALLPAPER_EXTRACT_THEME channel and fold it into the active
   * project's `toolOverrides` (live theme preview). Resilient: surfaces a
   * toast on failure rather than throwing.
   */
  applyWallpaperExtractedPalette(wallpaperId: string): Promise<void>;
  /** Commit the (possibly accent-tweaked) palette into toolOverrides + persist + switch to 'theme'. */
  applyImageToTheme(): void;
  /** Reset all image→theme state to idle. */
  clearImageToTheme(): void;
  /** Override the accent within the extracted palette (live preview only). */
  setImageAccent(hex: string): void;

  // --- Wallpaper → Theme live preview (pywal-style Studio linkage) ---
  /**
   * Preview a wallpaper's derived palette (debounced 150ms). Lightweight —
   * does NOT install or apply; stores the result in `wallpaperPreviewPalette`
   * for the Studio preview pane. No-op when wallpaperId is empty.
   */
  previewWallpaperTheme(wallpaperId: string): void;
  /**
   * Build + install + apply a wallpaper-derived theme to the active project's
   * agent. Returns true on success, surfaces a toast on failure.
   */
  applyWallpaperTheme(wallpaperId: string): Promise<boolean>;
  /** Clear the cached wallpaper preview palette + error state. */
  clearWallpaperPreview(): void;

  // --- Visual analysis progress ---
  /** Current visual-analysis progress (from main process via IPC). Null when idle. */
  analysisProgress: { agent: string; step: string; progress: number } | null;
  /** Guard flag so initAnalysisProgressSubscription is idempotent across HMR. */
  _analysisProgressSubscribed: boolean;
  /** Subscribe to visual-analysis progress events from main process. Idempotent. */
  initAnalysisProgressSubscription(): void;

  // --- Theme health check ---
  /** Per-agent latest theme health-check report pushed from the main process.
   *  Keyed by agentId so switching agents preserves each report independently. */
  healthReportByAgent: Record<string, HealthCheckReport>;
  /** Guard flag so initHealthReportSubscription is idempotent across HMR. */
  _healthReportSubscribed: boolean;
  /** Subscribe to theme health-check reports from main process. Idempotent. */
  initHealthReportSubscription(): void;

  // --- Simple setters (form fields, UI flags) ---
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

/** Async-lock guards: module-scoped (single studio window), not reactive state. */
const busyLocks = new Set<string>();

function tryAcquireLock(key: string): boolean {
  if (busyLocks.has(key)) return false;
  busyLocks.add(key);
  return true;
}

function releaseLock(key: string): void {
  busyLocks.delete(key);
}

/**
 * Wallpaper→theme preview debounce: 150ms coalescing so sliding the wallpaper
 * picker across many entries doesn't fire a burst of IPC calls. Each new
 * call cancels the previous pending timer. Module-scoped (single Studio window).
 */
let wallpaperPreviewTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Undo coalescing: rapid edits to the *same* override key within this window
 * (e.g. dragging a slider) collapse into a single undo step, so "undo" reverts
 * the whole gesture rather than one pixel of a drag.
 */
const undoCoalesce = { key: null as keyof ToolOverride | null, at: 0 };
const UNDO_COALESCE_MS = 700;
const UNDO_LIMIT = 30;

/** Push the previous `toolOverrides` onto the undo stack (capped). `prev` may be null (cleared state). */
function pushUndo(
  stack: (ToolOverride | null)[],
  prev: ToolOverride | null,
): (ToolOverride | null)[] {
  const next = [...stack, prev];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

export const useStudioStore = create<StudioStoreState>()((set, get) => ({
  projects: [],
  activeProjectId: null,
  creatingProject: false,
  newName: '',
  newAuthor: '',
  newAgent: 'traework',
  importing: false,
  editingId: null,
  editName: '',
  editAuthor: '',

  installedThemes: [],
  themeLibraryOpen: false,

  // --- Bundles (workspace-scoped) ---
  bundles: [],
  bundlesLoading: false,

  baselines: {},
  baselineLoadingMap: {},
  baselineErrorMap: {},

  previewView: 'theme',
  inspectingIdx: null,
  searchQuery: '',
  hoveredIdx: null,
  toolOverrides: null,
  undoStack: [],
  redoStack: [],
  inspectMode: false,
  liveNode: null,
  liveError: null,

  pinnedSelectors: [],
  pseudoStates: [],
  captureSchemes: false,
  customSelectorInput: '',
  pseudoView: null,
  schemeView: null,

  imageToThemeStatus: 'idle',
  imageToThemeError: null,
  imageToThemeMode: null,
  imageToThemePalette: null,
  imageToThemeAccent: null,

  // --- Wallpaper → Theme live preview ---
  wallpaperPreviewPalette: null,
  wallpaperPreviewLoading: false,
  wallpaperPreviewError: null,
  wallpaperApplyLoading: false,
  wallpaperApplyError: null,

  exportName: '',
  exportAuthor: '',
  exportState: { loading: false, dir: null, error: null },

  // --- Visual analysis progress ---
  analysisProgress: null,
  _analysisProgressSubscribed: false,

  // --- Theme health check ---
  healthReportByAgent: {},
  _healthReportSubscribed: false,

  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    // `projects.find` returns the same element reference while the array and
    // activeProjectId are unchanged, so consumers subscribing via
    // `useStudioStore((s) => s.getActiveProject())` still get a stable result
    // identity without a manual module-level cache (which was prone to racing
    // with direct setState in tests / HMR).
    return projects.find((p) => p.id === activeProjectId) ?? null;
  },

  // ------------------------------------------------------------------
  // Visual analysis progress subscription
  // ------------------------------------------------------------------
  // Idempotent: guarded by _analysisProgressSubscribed flag so HMR / repeated
  // init calls don't accumulate listeners.
  initAnalysisProgressSubscription: () => {
    if (get()._analysisProgressSubscribed) return;
    set({ _analysisProgressSubscribed: true });
    api.onVisualAnalysisProgress((payload) => {
      set({ analysisProgress: payload });
    });
  },

  // ------------------------------------------------------------------
  // Theme health check subscription
  // ------------------------------------------------------------------
  // Idempotent: guarded by _healthReportSubscribed flag so HMR / repeated
  // init calls don't accumulate listeners.
  initHealthReportSubscription: () => {
    if (get()._healthReportSubscribed) return;
    set({ _healthReportSubscribed: true });
    api.onThemeHealthReport((report) => {
      set((s) => ({
        healthReportByAgent: {
          ...s.healthReportByAgent,
          [report.agentId]: report,
        },
      }));
    });
  },

  // ------------------------------------------------------------------
  // Project actions
  // ------------------------------------------------------------------

  refreshProjects: async () => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      const list = await api.listStudioProjects();
      set({ projects: list, activeProjectId: get().activeProjectId ?? list[0]?.id ?? null });
    } catch (e) {
      showToast(currentT().studioLoadProjectsFailed(toMessage(e)), 'destructive');
    }
  },

  selectProject: (id) => {
    if (get().activeProjectId === id) return;
    undoCoalesce.key = null;
    set({
      activeProjectId: id,
      undoStack: [],
      redoStack: [],
      pinnedSelectors: [],
      pseudoStates: [],
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      inspectingIdx: null,
    });
  },

  createProject: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const { newName, newAuthor, newAgent } = get();
    const name = newName.trim() || '未命名工程';
    try {
      const p = await api.createStudioProject({
        name,
        author: newAuthor.trim(),
        agentId: newAgent,
      });
      set((s) => ({
        projects: [p, ...s.projects],
        activeProjectId: p.id,
        newName: '',
        newAuthor: '',
        creatingProject: false,
      }));
    } catch (e) {
      showToast(currentT().studioCreateProjectFailed(toMessage(e)), 'destructive');
    }
  },

  importProject: async () => {
    const showToast = useNotificationStore.getState().showToast;
    set({ importing: true });
    try {
      const p = await api.importStudioProject();
      if (p) {
        set((s) => ({
          projects: [p, ...s.projects.filter((x) => x.id !== p.id)],
          activeProjectId: p.id,
        }));
        showToast(currentT().studioImportProjectSuccess(p.name));
      }
    } catch (err) {
      showToast(currentT().studioImportProjectFailed(toMessage(err)), 'destructive');
    } finally {
      set({ importing: false });
    }
  },

  deleteProject: async (id) => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      await api.deleteStudioProject(id);
      set((s) => {
        const next = s.projects.filter((p) => p.id !== id);
        return {
          projects: next,
          activeProjectId: s.activeProjectId === id ? (next[0]?.id ?? null) : s.activeProjectId,
        };
      });
    } catch (err) {
      showToast(currentT().studioDeleteProjectFailed(toMessage(err)), 'destructive');
    }
  },

  renameProject: async (p, name, author) => {
    const showToast = useNotificationStore.getState().showToast;
    // Snapshot rollback baseline before optimistic update.
    const nameOut = name.trim() || p.name;
    const authorOut = author.trim();
    const prevName = p.name;
    const prevAuthor = p.author;
    const next: StudioProject = {
      ...p,
      name: nameOut,
      author: authorOut,
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? next : x)) }));
    try {
      await api.saveStudioProject(next);
      showToast(currentT().studioProjectInfoSaved);
    } catch (e) {
      // Roll back optimistic mutation so the UI stays in sync with disk.
      set((s) => ({
        projects: s.projects.map((x) =>
          x.id === p.id ? { ...x, name: prevName, author: prevAuthor } : x,
        ),
      }));
      showToast(currentT().studioRenameFailed(toMessage(e)), 'destructive');
    } finally {
      set({ editingId: null });
    }
  },

  saveActiveProject: async (patch) => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    const next = { ...project, ...patch, updatedAt: new Date().toISOString() };
    set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }));
    try {
      await api.saveStudioProject(next);
    } catch (e) {
      showToast(currentT().studioSaveFailed(toMessage(e)), 'destructive');
    }
  },

  changeAgent: async (agentId) => {
    const { saveActiveProject, inspectMode } = get();
    void saveActiveProject({ agentId });
    undoCoalesce.key = null;
    set({ inspectingIdx: null, undoStack: [], redoStack: [] });
    if (inspectMode || busyLocks.has('inspect')) {
      busyLocks.add('inspect');
      try {
        await api.stopInspect();
      } catch {
        /* ignore */
      } finally {
        releaseLock('inspect');
        set({ inspectMode: false, liveNode: null, liveError: null });
      }
    }
  },

  refreshThemeLibrary: async () => {
    try {
      set({ installedThemes: (await api.catalog.themes.list()).items });
    } catch {
      /* ignore — library linkage is best-effort */
    }
  },

  loadThemeIntoProject: async (themeId) => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    try {
      const item = await api.catalog.themes.get(themeId);
      if (!item?.colors) {
        showToast(currentT().studioNoPalette, 'destructive');
        return;
      }
      const palette = semanticColorsToPalette(item.colors);
      if (Object.keys(palette).length === 0) {
        showToast(currentT().studioNoPalette, 'destructive');
        return;
      }
      const next = { ...project, palette, updatedAt: new Date().toISOString() };
      set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }));
      try {
        await api.saveStudioProject(next);
      } catch (e) {
        showToast(currentT().studioSaveFailed(toMessage(e)), 'destructive');
      }
      showToast(currentT().studioPaletteLoaded(item.name));
    } catch {
      showToast(currentT().studioLoadPaletteFailed, 'destructive');
    }
  },

  // ------------------------------------------------------------------
  // Bundle actions
  // ------------------------------------------------------------------

  refreshBundles: async () => {
    const showToast = useNotificationStore.getState().showToast;
    set({ bundlesLoading: true });
    try {
      const list = await api.listBundles();
      set({ bundles: list, bundlesLoading: false });
    } catch (e) {
      set({ bundlesLoading: false });
      showToast(currentT().studioBundleRefreshFailed(toMessage(e)), 'destructive');
    }
  },

  importAndInstallBundle: async () => {
    const showToast = useNotificationStore.getState().showToast;
    set({ bundlesLoading: true });
    try {
      const result = await api.importBundle();
      if (!result) {
        set({ bundlesLoading: false });
        return null;
      }
      // listBundles returns summaries; install wants id.
      await get().installBundle(result.id);
      await get().refreshBundles();
      showToast(currentT().studioBundleImportedInstalled(result.name));
      return result.id;
    } catch (e) {
      set({ bundlesLoading: false });
      showToast(currentT().studioBundleImportInstallFailed(toMessage(e)), 'destructive');
      return null;
    }
  },

  installBundle: async (id) => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      const res = await api.installBundleById(id);
      if (!res.ok) {
        showToast(
          currentT().studioBundleInstallFailedDetail(
            res.error ?? currentT().studioBundleUnknownError,
          ),
          'destructive',
        );
      } else {
        showToast(currentT().studioBundleInstalledDone);
      }
    } catch (e) {
      showToast(currentT().studioBundleInstallFailedDetail(toMessage(e)), 'destructive');
    }
  },

  deleteBundle: async (id) => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      const res = await api.deleteBundle(id);
      if (!res.ok) {
        showToast(
          currentT().studioBundleDeleteFailedDetail(
            res.error ?? currentT().studioBundleUnknownError,
          ),
          'destructive',
        );
        return;
      }
      set((s) => ({ bundles: s.bundles.filter((b) => b.id !== id) }));
      showToast(currentT().studioBundleDeletedDone);
    } catch (e) {
      showToast(currentT().studioBundleDeleteFailedDetail(toMessage(e)), 'destructive');
    }
  },

  // ------------------------------------------------------------------
  // Capture actions
  // ------------------------------------------------------------------

  baselineSnapshot: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    const { agentId, id: projectId } = project;
    const { pinnedSelectors, pseudoStates, captureSchemes } = get();
    set((s) => ({
      baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: true },
      baselineErrorMap: { ...s.baselineErrorMap, [agentId]: '' },
      previewView: 'theme',
    }));
    try {
      const snap = await api.snapshotBaseline(agentId, {
        extraSelectors: pinnedSelectors,
        pseudoStates,
        captureSchemes,
      });
      set((s) => ({
        baselines: { ...s.baselines, [agentId]: snap },
        baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: false },
      }));
      void get().saveActiveProject({ hasBaseline: true });
      await api.saveStudioSnapshot(projectId, snap, 'baseline');
    } catch (err) {
      const msg = toMessage(err);
      set((s) => ({
        baselineErrorMap: { ...s.baselineErrorMap, [agentId]: `基线抓取失败：${msg}` },
        baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: false },
      }));
      showToast(currentT().studioBaselineFailed, 'destructive');
    }
  },

  restoreAgent: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    try {
      await api.restoreApp(project.agentId);
      showToast(currentT().studioAgentRestored(AGENT_META[project.agentId].displayName));
    } catch {
      showToast(currentT().studioRestoreFailed, 'destructive');
    }
  },

  exportTheme: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    const { toolOverrides, exportName, exportAuthor } = get();
    if (!toolOverrides) return;
    set({ exportState: { loading: true, dir: null, error: null } });
    try {
      const merged = mergeOverridesToSkinTokens({}, toolOverrides);
      const payload = {
        meta: {
          name: exportName.trim() || project.name,
          author: exportAuthor.trim() || project.author || 'AgentSkin Studio',
        },
        agentId: project.agentId,
        root: merged as Record<string, string> | undefined,
        signature: serializeToolOverride(toolOverrides),
      };
      const res = await api.exportStudioTheme(payload);
      set({ exportState: { loading: false, dir: res.packageDir, error: null } });
      void get().saveActiveProject({
        exportedDir: res.packageDir,
        palette: merged,
        signature: payload.signature,
        overrides: serializeToolOverride(toolOverrides),
      });
      showToast(currentT().studioExportDone);
    } catch (err) {
      const msg = toMessage(err);
      set({ exportState: { loading: false, dir: null, error: msg } });
      showToast(currentT().studioExportFailed, 'destructive');
    }
  },

  toggleInspect: async () => {
    const showToast = useNotificationStore.getState().showToast;
    if (!tryAcquireLock('inspect')) return;
    try {
      if (get().inspectMode) {
        try {
          await api.stopInspect();
        } catch {
          /* ignore */
        }
        set({ inspectMode: false });
        return;
      }
      const project = get().getActiveProject();
      if (!project) {
        showToast(currentT().studioEnterInspectFailed, 'destructive');
        return;
      }
      try {
        await api.startInspect(project.agentId);
        set({ inspectMode: true, liveNode: null, liveError: null });
      } catch {
        showToast(currentT().studioEnterInspectFailed, 'destructive');
      }
    } finally {
      releaseLock('inspect');
    }
  },

  setOverride: (key, value) => {
    set((s) => {
      const prev = s.toolOverrides;
      const now = Date.now();
      const coalesce = undoCoalesce.key === key && now - undoCoalesce.at < UNDO_COALESCE_MS;
      undoCoalesce.key = key;
      undoCoalesce.at = now;
      const next: Record<string, unknown> = { ...(prev ?? {}) };
      if (value === undefined || value === '') {
        delete next[key];
      } else {
        next[key] = value;
      }
      const toolOverrides = Object.keys(next).length ? asToolOverride(next) : null;
      return {
        toolOverrides,
        undoStack: coalesce ? s.undoStack : pushUndo(s.undoStack, prev),
        redoStack: [],
      };
    });
  },

  resetOverrides: () =>
    set((s) => ({
      undoStack: pushUndo(s.undoStack, s.toolOverrides),
      redoStack: [],
      toolOverrides: null,
    })),

  undo: () => {
    set((s) => {
      if (s.undoStack.length === 0) return {};
      const stack = s.undoStack.slice();
      const prev = stack.pop()!;
      undoCoalesce.key = null;
      return {
        toolOverrides: prev ?? null,
        undoStack: stack,
        redoStack: [...s.redoStack, s.toolOverrides],
      };
    });
  },

  redo: () => {
    set((s) => {
      if (s.redoStack.length === 0) return {};
      const stack = s.redoStack.slice();
      const next = stack.pop()!;
      undoCoalesce.key = null;
      return {
        toolOverrides: next ?? null,
        redoStack: stack,
        undoStack: [...s.undoStack, s.toolOverrides],
      };
    });
  },

  addPinnedSelector: () => {
    const v = get().customSelectorInput.trim();
    if (!v) return;
    set((s) => ({
      pinnedSelectors: s.pinnedSelectors.includes(v)
        ? s.pinnedSelectors
        : [...s.pinnedSelectors, v],
      customSelectorInput: '',
    }));
  },

  removePinnedSelector: (sel) =>
    set((s) => ({ pinnedSelectors: s.pinnedSelectors.filter((x) => x !== sel) })),

  pinSelector: (sel) =>
    set((s) => ({
      pinnedSelectors: s.pinnedSelectors.includes(sel)
        ? s.pinnedSelectors
        : [...s.pinnedSelectors, sel],
    })),

  togglePseudo: (state) =>
    set((s) => ({
      pseudoStates: s.pseudoStates.includes(state)
        ? s.pseudoStates.filter((x) => x !== state)
        : [...s.pseudoStates, state],
    })),

  applyPalette: (palette, action) => {
    set((s) => ({
      undoStack: pushUndo(s.undoStack, s.toolOverrides),
      redoStack: [],
      toolOverrides: asToolOverride({ ...(s.toolOverrides ?? {}), ...palette }),
      previewView: action === 'apply' ? 'theme' : s.previewView,
    }));
  },

  setOverrideColors: (palette) =>
    set((s) => ({
      // Map the semantic palette onto the four role fields the live preview
      // (RealDomPreview) actually consumes, and keep the full palette in
      // `colors` so export can bake the complete 14-token set.
      undoStack: pushUndo(s.undoStack, s.toolOverrides),
      redoStack: [],
      toolOverrides: asToolOverride({
        ...(s.toolOverrides ?? {}),
        accent: palette.accent,
        background: palette.background,
        foreground: palette.foreground,
        surface: palette.surface,
        colors: palette,
      }),
      previewView: 'theme',
    })),

  setPaletteLoaded: (palette) => {
    const showToast = useNotificationStore.getState().showToast;
    set((s) => ({
      // Same mapping as setOverrideColors: role fields drive the live preview,
      // `colors` preserves the full palette for export.
      undoStack: pushUndo(s.undoStack, s.toolOverrides),
      redoStack: [],
      toolOverrides: asToolOverride({
        ...(s.toolOverrides ?? {}),
        accent: palette.accent,
        background: palette.background,
        foreground: palette.foreground,
        surface: palette.surface,
        colors: palette,
      }),
      previewView: 'theme',
    }));
    const capturedActiveId = get().activeProjectId;
    void (async () => {
      try {
        const current = get().activeProjectId;
        if (current !== capturedActiveId) return; // user switched away, abort save
        const currentProject = get().getActiveProject();
        if (!currentProject) return;
        await api.saveStudioProject({ ...currentProject, palette });
      } catch (e) {
        showToast(currentT().studioSaveFailed(toMessage(e)), 'destructive');
      }
    })();
  },

  // ------------------------------------------------------------------
  // Image → Theme actions
  // ------------------------------------------------------------------

  extractImageFromImage: async (base64Data) => {
    if (!tryAcquireLock('image-extract')) return;
    set({ imageToThemeStatus: 'extracting', imageToThemeError: null });
    try {
      const { palette, mode } = await api.extractThemeFromImage(base64Data);
      set({
        imageToThemeStatus: 'ready',
        imageToThemePalette: palette,
        imageToThemeMode: mode,
        imageToThemeAccent: null,
      });
    } catch (_e) {
      set({
        imageToThemeStatus: 'error',
        imageToThemeError: currentT().studioImageToThemeErrorExtractFailed,
      });
    } finally {
      releaseLock('image-extract');
    }
  },

  applyWallpaperExtractedPalette: async (wallpaperId) => {
    const showToast = useNotificationStore.getState().showToast;
    if (!tryAcquireLock('wallpaper-extract')) return;
    try {
      // Returns the freshly-installed theme (pywal-style). Its `colors` is the
      // semantic palette we can fold into the active project's toolOverrides.
      const installed = await api.extractThemeFromWallpaper(wallpaperId);
      const palette = installed?.colors;
      if (!palette || Object.keys(palette).length === 0) {
        showToast(currentT().studioNoPalette, 'destructive');
        return;
      }
      get().setPaletteLoaded(palette);
      set({ previewView: 'theme' });
    } catch (e) {
      showToast(
        `${currentT().studioImageToThemeErrorExtractFailed}：${toMessage(e)}`,
        'destructive',
      );
    } finally {
      releaseLock('wallpaper-extract');
    }
  },

  applyImageToTheme: () => {
    const { imageToThemePalette, imageToThemeAccent } = get();
    if (!imageToThemePalette) return;
    const finalPalette = imageToThemeAccent
      ? { ...imageToThemePalette, accent: imageToThemeAccent }
      : imageToThemePalette;
    // ThemeColorsFromImage is structurally Record<string, string> (mode is a
    // string subtype); cast at the boundary since setPaletteLoaded's param is
    // intentionally wide to also accept semanticColorsToPalette() output.
    get().setPaletteLoaded(finalPalette as unknown as Record<string, string>);
    set({
      imageToThemeStatus: 'idle',
      imageToThemePalette: null,
      imageToThemeAccent: null,
      imageToThemeMode: null,
      imageToThemeError: null,
    });
  },

  clearImageToTheme: () =>
    set({
      imageToThemeStatus: 'idle',
      imageToThemeError: null,
      imageToThemePalette: null,
      imageToThemeAccent: null,
      imageToThemeMode: null,
    }),

  setImageAccent: (hex) => set({ imageToThemeAccent: hex }),

  // ------------------------------------------------------------------
  // Wallpaper → Theme live preview (pywal-style Studio linkage)
  // ------------------------------------------------------------------

  previewWallpaperTheme: (wallpaperId) => {
    if (!wallpaperId) return;
    // Cancel any pending preview so rapid picks coalesce into a single call.
    if (wallpaperPreviewTimer) clearTimeout(wallpaperPreviewTimer);
    wallpaperPreviewTimer = setTimeout(async () => {
      wallpaperPreviewTimer = null;
      set({ wallpaperPreviewLoading: true, wallpaperPreviewError: null });
      try {
        const palette = await api.previewThemeFromWallpaper(wallpaperId);
        // Guard: ignore stale results if the user already cleared or switched.
        if (!get().wallpaperPreviewLoading) return;
        set({
          wallpaperPreviewPalette: palette,
          wallpaperPreviewLoading: false,
          wallpaperPreviewError: null,
        });
      } catch (e) {
        set({
          wallpaperPreviewPalette: null,
          wallpaperPreviewLoading: false,
          wallpaperPreviewError: toMessage(e),
        });
      }
    }, 150);
  },

  applyWallpaperTheme: async (wallpaperId) => {
    const showToast = useNotificationStore.getState().showToast;
    if (!wallpaperId) return false;
    // Coalesce: fire a preview only when no apply is already running.
    if (get().wallpaperApplyLoading) return false;
    const project = get().getActiveProject();
    if (!project) {
      showToast(currentT().studioNoActiveProject, 'destructive');
      return false;
    }
    set({ wallpaperApplyLoading: true, wallpaperApplyError: null });
    try {
      const installed = await api.applyThemeFromWallpaper(wallpaperId, project.agentId);
      set({ wallpaperApplyLoading: false, wallpaperApplyError: null });
      showToast(currentT().studioWallpaperThemeApplied(installed.displayName));
      return true;
    } catch (e) {
      const msg = toMessage(e);
      set({ wallpaperApplyLoading: false, wallpaperApplyError: msg });
      showToast(currentT().studioWallpaperThemeApplyFailed(msg), 'destructive');
      return false;
    }
  },

  clearWallpaperPreview: () => {
    if (wallpaperPreviewTimer) {
      clearTimeout(wallpaperPreviewTimer);
      wallpaperPreviewTimer = null;
    }
    set({
      wallpaperPreviewPalette: null,
      wallpaperPreviewLoading: false,
      wallpaperPreviewError: null,
    });
  },

  // ------------------------------------------------------------------
  // Simple setters
  // ------------------------------------------------------------------

  setCreatingProject: (v) => set({ creatingProject: v }),
  setNewName: (v) => set({ newName: v }),
  setNewAuthor: (v) => set({ newAuthor: v }),
  setNewAgent: (v) => set({ newAgent: v }),
  setEditingId: (v) => set({ editingId: v }),
  setEditName: (v) => set({ editName: v }),
  setEditAuthor: (v) => set({ editAuthor: v }),
  setThemeLibraryOpen: (v) => set({ themeLibraryOpen: v }),
  setCustomSelectorInput: (v) => set({ customSelectorInput: v }),
  setPreviewView: (v) => set({ previewView: v }),
  setSearchQuery: (v) => set({ searchQuery: v }),
  setHoveredIdx: (v) => set({ hoveredIdx: v }),
  setInspectingIdx: (v) => set({ inspectingIdx: v }),
  setPseudoView: (v) => set({ pseudoView: v }),
  setSchemeView: (v) => set({ schemeView: v }),
  setCaptureSchemes: (v) => set({ captureSchemes: v }),
  setExportName: (v) => set({ exportName: v }),
  setExportAuthor: (v) => set({ exportAuthor: v }),
  setInspectResult: (node) => {
    if ('error' in node) {
      set({ liveError: node.error });
      return;
    }
    set({ liveNode: node, liveError: null });
  },
}));

// ---------------------------------------------------------------------------
// Small convenience selectors (keep components' subscription surface small)
// ---------------------------------------------------------------------------

/** 当前 active project（null 表示无工程）。组件内 useMemo 后稳定引用。 */
export function useActiveProject(): StudioProject | null {
  return useStudioStore((s) => s.getActiveProject());
}
