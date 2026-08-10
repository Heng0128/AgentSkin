// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Store — Theme Studio 共享状态（P1-4 减重）
 *
 * 收敛 ThemeStudioPage 的 30+ useState + 回调，让 Studio 四个面板
 * （Header / LeftRail / CenterPanel / RightInspector）直读 store，
 * 消除 40/33/20 个 props 的下传。
 *
 * 派生值（activeProject / baseline / colorSets / landmarkSearch 等）不存
 * store——由各组件基于原始状态 useMemo 派生，避免双份真相。
 */

import { api } from '@/api/agentSkinClient';
import { buildStudioPalette, mergeOverridesToSkinTokens } from '@/components/studio/palette';
import type { PreviewView } from '@/components/studio/StudioCenterPanel';
import type { ToolOverride } from '@/components/studio/Toolbox';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import { semanticColorsToPalette } from '@shared/theme-mapping';
import {
  AGENT_META,
  type AgentId,
  type InspectedNode,
  type StudioProject,
  type ThemeCatalogItem,
  type ThemeVisualSnapshot,
} from '@shared/types';
import { create } from 'zustand';

/** Read current i18n message table (project-standard pattern from installFlowStore / environmentStore). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

export type ExportState = {
  loading: boolean;
  dir: string | null;
  error: string | null;
};

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

  // --- Snapshot / baseline ---
  snapshot: ThemeVisualSnapshot | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
  snapshotThemeName: string;
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
  /** Reload the persisted current/baseline snapshots for the active project. */
  loadProjectSnapshots(): Promise<void>;
  /** Auto-capture the agent's native baseline once per agent (switching agents). */
  ensureBaseline(): Promise<void>;

  // --- Capture actions ---
  captureSnapshot(): Promise<void>;
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

/**
 * Module-level cache for `getActiveProject` reference stability.
 *
 * `projects.find()` returns the same object reference when the projects array
 * and activeProjectId are unchanged, but every `set()` call forces zustand
 * to re-run subscribed selectors. By tracking the inputs and short-circuiting
 * when they match, we guarantee a stable return identity, eliminating
 * re-renders in downstream consumers that subscribe via
 * `useStudioStore((s) => s.getActiveProject())`.
 */
let _projectsRef: StudioProject[] | undefined;
let _lastActiveId: string | null | undefined;
let _lastResult: StudioProject | null = null;

function tryAcquireLock(key: string): boolean {
  if (busyLocks.has(key)) return false;
  busyLocks.add(key);
  return true;
}

function releaseLock(key: string): void {
  busyLocks.delete(key);
}

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

  snapshot: null,
  snapshotLoading: false,
  snapshotError: null,
  snapshotThemeName: '',
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

  exportName: '',
  exportAuthor: '',
  exportState: { loading: false, dir: null, error: null },

  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    if (projects === _projectsRef && activeProjectId === _lastActiveId) {
      return _lastResult;
    }
    _projectsRef = projects;
    _lastActiveId = activeProjectId;
    _lastResult = projects.find((p) => p.id === activeProjectId) ?? null;
    return _lastResult;
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
    void get().loadProjectSnapshots();
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
      void get().loadProjectSnapshots();
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
        void get().loadProjectSnapshots();
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
      void get().loadProjectSnapshots();
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
    const { saveActiveProject, previewView, inspectMode } = get();
    void saveActiveProject({ agentId });
    undoCoalesce.key = null;
    set({ snapshot: null, inspectingIdx: null, undoStack: [], redoStack: [] });
    if (previewView === 'generator') set({ previewView: 'theme' });
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

  loadProjectSnapshots: async () => {
    const project = get().getActiveProject();
    if (!project) {
      set({
        snapshot: null,
        snapshotLoading: false,
        snapshotError: null,
        snapshotThemeName: '',
        baselines: {},
        baselineLoadingMap: {},
        baselineErrorMap: {},
      });
      return;
    }
    const capturedId = project.id;
    const { id, agentId, name, author } = project;
    set((s) => ({
      snapshot: null,
      snapshotLoading: true,
      snapshotError: null,
      baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: true },
      baselineErrorMap: {},
      // Keep export name/author in sync with the active project.
      exportName: name,
      exportAuthor: author || '',
    }));
    try {
      const [snap, base] = await Promise.all([
        api.loadStudioSnapshot(id, 'current'),
        api.loadStudioSnapshot(id, 'baseline'),
      ]);
      if (get().activeProjectId !== capturedId) return;
      set((s) => ({
        snapshot: snap,
        snapshotLoading: false,
        snapshotError: null,
        snapshotThemeName: snap?.themeName ?? '',
        baselines: base && agentId ? { ...s.baselines, [agentId]: base } : s.baselines,
        baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: false },
      }));
    } catch {
      set((s) => ({
        snapshot: null,
        snapshotLoading: false,
        snapshotError: null,
        snapshotThemeName: '',
        baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: false },
      }));
    }
  },

  ensureBaseline: async () => {
    const project = get().getActiveProject();
    if (!project) return;
    const { agentId, id: projectId } = project;
    const { baselines, pseudoStates, captureSchemes } = get();
    if (baselines[agentId]) return;
    if (busyLocks.has('baseline')) return;
    busyLocks.add('baseline');
    set((s) => ({
      baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: true },
      baselineErrorMap: { ...s.baselineErrorMap, [agentId]: '' },
      previewView: 'theme',
    }));
    try {
      const snap = await api.snapshotBaseline(agentId, { pseudoStates, captureSchemes });
      set((s) => ({ baselines: { ...s.baselines, [agentId]: snap } }));
      try {
        await api.saveStudioSnapshot(projectId, snap, 'baseline');
      } catch (e) {
        set((s) => ({
          baselineErrorMap: { ...s.baselineErrorMap, [agentId]: `基线保存失败：${toMessage(e)}` },
        }));
      }
    } catch (e) {
      set((s) => ({
        baselineErrorMap: { ...s.baselineErrorMap, [agentId]: `基线抓取失败：${toMessage(e)}` },
      }));
    } finally {
      set((s) => ({ baselineLoadingMap: { ...s.baselineLoadingMap, [agentId]: false } }));
      releaseLock('baseline');
    }
  },

  // ------------------------------------------------------------------
  // Capture actions
  // ------------------------------------------------------------------

  captureSnapshot: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    const { agentId, id: projectId, name } = project;
    const { pinnedSelectors, pseudoStates, captureSchemes } = get();
    const liveName = name;
    set({
      snapshot: null,
      snapshotLoading: true,
      snapshotError: null,
      snapshotThemeName: liveName,
    });
    try {
      const snap = await api.snapshotThemeDom(agentId, undefined, {
        extraSelectors: pinnedSelectors,
        pseudoStates,
        captureSchemes,
      });
      set({
        snapshot: snap,
        snapshotLoading: false,
        snapshotError: null,
        snapshotThemeName: liveName,
        inspectingIdx: 0,
        pseudoView: null,
        schemeView: null,
      });
      await api.saveStudioSnapshot(projectId, snap);
      void get().saveActiveProject({ hasSnapshot: true });
    } catch (err) {
      const msg = toMessage(err);
      set({
        snapshot: null,
        snapshotLoading: false,
        snapshotError: `Snapshot failed: ${msg}`,
        snapshotThemeName: liveName,
      });
      showToast(currentT().studioSnapshotFailed, 'destructive');
    }
  },

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
    const { snapshot, toolOverrides, exportName, exportAuthor } = get();
    set({ exportState: { loading: true, dir: null, error: null } });
    try {
      const merged =
        snapshot != null
          ? mergeOverridesToSkinTokens(buildStudioPalette(snapshot), toolOverrides)
          : undefined;
      const payload = {
        meta: {
          name: exportName.trim() || project.name,
          author: exportAuthor.trim() || project.author || 'AgentSkin Studio',
        },
        agentId: project.agentId,
        root: merged as Record<string, string> | undefined,
        signature: (toolOverrides ?? undefined) as unknown as Record<string, unknown> | undefined,
      };
      const res = await api.exportStudioTheme(payload);
      set({ exportState: { loading: false, dir: res.packageDir, error: null } });
      void get().saveActiveProject({
        hasSnapshot: true,
        exportedDir: res.packageDir,
        palette: merged,
        signature: payload.signature,
        overrides: (toolOverrides ?? undefined) as Record<string, unknown> | undefined,
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
      const next: Partial<ToolOverride> = { ...(prev ?? {}) };
      if (value === undefined || value === '') {
        delete next[key];
      } else {
        (next as Record<keyof ToolOverride, string | number | boolean | undefined>)[key] = value;
      }
      const toolOverrides = Object.keys(next).length ? (next as ToolOverride) : null;
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
      toolOverrides: { ...(s.toolOverrides ?? {}), ...palette } as ToolOverride,
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
      toolOverrides: {
        ...(s.toolOverrides ?? {}),
        accent: palette.accent,
        background: palette.background,
        foreground: palette.foreground,
        surface: palette.surface,
        colors: palette,
      } as ToolOverride,
      previewView: 'theme',
    })),

  setPaletteLoaded: (palette) => {
    const showToast = useNotificationStore.getState().showToast;
    set((s) => ({
      // Same mapping as setOverrideColors: role fields drive the live preview,
      // `colors` preserves the full palette for export.
      undoStack: pushUndo(s.undoStack, s.toolOverrides),
      redoStack: [],
      toolOverrides: {
        ...(s.toolOverrides ?? {}),
        accent: palette.accent,
        background: palette.background,
        foreground: palette.foreground,
        surface: palette.surface,
        colors: palette,
      } as ToolOverride,
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
