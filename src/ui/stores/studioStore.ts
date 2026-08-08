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
import { buildStudioPalette } from '@/components/studio/palette';
import type { PreviewView } from '@/components/studio/StudioCenterPanel';
import type { ToolOverride } from '@/components/studio/Toolbox';
import { useNotificationStore } from '@/stores/notificationStore';

import { toMessage } from '@shared/errors';
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
const inspectBusy = { current: false };
const autoBaselineBusy = { current: false };

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
    return projects.find((p) => p.id === activeProjectId) ?? null;
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
      showToast(`加载工程列表失败：${toMessage(e)}`, 'destructive');
    }
  },

  selectProject: (id) => {
    if (get().activeProjectId === id) return;
    set({ activeProjectId: id });
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
      showToast(`创建工程失败：${toMessage(e)}`, 'destructive');
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
        showToast(`已导入工程「${p.name}」`);
        void get().loadProjectSnapshots();
      }
    } catch (err) {
      showToast(`导入失败：${toMessage(err)}`, 'destructive');
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
      showToast(`删除工程失败：${toMessage(err)}`, 'destructive');
    }
  },

  renameProject: async (p, name, author) => {
    const showToast = useNotificationStore.getState().showToast;
    const next: StudioProject = {
      ...p,
      name: name.trim() || p.name,
      author: author.trim(),
      updatedAt: new Date().toISOString(),
    };
    set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? next : x)) }));
    try {
      await api.saveStudioProject(next);
      showToast('已保存工程信息');
    } catch {
      showToast('保存失败', 'destructive');
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
      showToast(`保存失败：${toMessage(e)}`, 'destructive');
    }
  },

  changeAgent: async (agentId) => {
    const { saveActiveProject, previewView, inspectMode } = get();
    void saveActiveProject({ agentId });
    set({ snapshot: null, inspectingIdx: null });
    if (previewView === 'generator') set({ previewView: 'theme' });
    if (inspectMode || inspectBusy.current) {
      inspectBusy.current = true;
      try {
        await api.stopInspect();
      } catch {
        /* ignore */
      } finally {
        inspectBusy.current = false;
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
        showToast('该主题不包含可加载的调色板', 'destructive');
        return;
      }
      const palette = semanticColorsToPalette(item.colors);
      if (Object.keys(palette).length === 0) {
        showToast('该主题不包含可加载的调色板', 'destructive');
        return;
      }
      const next = { ...project, palette, updatedAt: new Date().toISOString() };
      set((s) => ({ projects: s.projects.map((p) => (p.id === next.id ? next : p)) }));
      try {
        await api.saveStudioProject(next);
      } catch (e) {
        showToast(`保存失败：${toMessage(e)}`, 'destructive');
      }
      showToast(`已从「${item.name}」加载调色板`);
    } catch {
      showToast('加载主题调色板失败', 'destructive');
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
    if (autoBaselineBusy.current) return;
    autoBaselineBusy.current = true;
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
      autoBaselineBusy.current = false;
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
      showToast('主题快照失败', 'destructive');
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
      showToast('基线快照失败', 'destructive');
    }
  },

  restoreAgent: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    try {
      await api.restoreApp(project.agentId);
      showToast(`已恢复 ${AGENT_META[project.agentId].displayName} 原生界面`);
    } catch {
      showToast('恢复失败', 'destructive');
    }
  },

  exportTheme: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = get().getActiveProject();
    if (!project) return;
    const { snapshot, toolOverrides, exportName, exportAuthor } = get();
    set({ exportState: { loading: true, dir: null, error: null } });
    try {
      const root = snapshot != null ? buildStudioPalette(snapshot) : undefined;
      const payload = {
        meta: {
          name: exportName.trim() || project.name,
          author: exportAuthor.trim() || project.author || 'AgentSkin Studio',
        },
        agentId: project.agentId,
        root: root as Record<string, string> | undefined,
        signature: (toolOverrides ?? undefined) as unknown as Record<string, unknown> | undefined,
      };
      const res = await api.exportStudioTheme(payload);
      set({ exportState: { loading: false, dir: res.packageDir, error: null } });
      void get().saveActiveProject({
        hasSnapshot: true,
        exportedDir: res.packageDir,
        palette: root,
        signature: payload.signature,
        overrides: (toolOverrides ?? undefined) as Record<string, unknown> | undefined,
      });
      showToast('主题包已导出');
    } catch (err) {
      const msg = toMessage(err);
      set({ exportState: { loading: false, dir: null, error: msg } });
      showToast('导出失败', 'destructive');
    }
  },

  toggleInspect: async () => {
    const showToast = useNotificationStore.getState().showToast;
    if (inspectBusy.current) return;
    inspectBusy.current = true;
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
        showToast('进入检查模式失败', 'destructive');
        return;
      }
      try {
        await api.startInspect(project.agentId);
        set({ inspectMode: true, liveNode: null, liveError: null });
      } catch {
        showToast('进入检查模式失败', 'destructive');
      }
    } finally {
      inspectBusy.current = false;
    }
  },

  setOverride: (key, value) => {
    set((s) => {
      const next: Partial<ToolOverride> = { ...(s.toolOverrides ?? {}) };
      if (value === undefined || value === '') {
        delete next[key];
      } else {
        (next as Record<keyof ToolOverride, string | number | boolean | undefined>)[key] = value;
      }
      return { toolOverrides: Object.keys(next).length ? (next as ToolOverride) : null };
    });
  },

  resetOverrides: () => set({ toolOverrides: null }),

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
      toolOverrides: { ...(s.toolOverrides ?? {}), ...palette } as ToolOverride,
      previewView: action === 'apply' ? 'theme' : s.previewView,
    }));
  },

  setOverrideColors: (palette) =>
    set((s) => ({
      toolOverrides: { ...(s.toolOverrides ?? {}), colors: palette } as ToolOverride,
    })),

  setPaletteLoaded: (palette) => {
    const showToast = useNotificationStore.getState().showToast;
    set((s) => ({
      toolOverrides: { ...(s.toolOverrides ?? {}), colors: palette } as ToolOverride,
    }));
    const project = get().getActiveProject();
    if (project) {
      void (async () => {
        try {
          await api.saveStudioProject({ ...project, palette });
        } catch (e) {
          showToast(`保存失败：${toMessage(e)}`, 'destructive');
        }
      })();
    }
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
