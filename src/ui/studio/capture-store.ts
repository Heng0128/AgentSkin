// SPDX-License-Identifier: MPL-2.0

/**
 * # capture-store
 *
 * Studio capture / inspect / override state: tool overrides with undo/redo,
 * inspect mode, live DOM node, pinned selectors, pseudo states, scheme view,
 * palette application, and export.
 *
 * Extracted from the monolithic `studioStore.ts` as part of the
 * 5-store decomposition (P1-4 weight reduction).
 */

import { api } from '@/api/agentSkinClient';
import { mergeOverridesToSkinTokens } from '@/lib/palette';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useProjectStore } from '@/studio/project-store';
import type { ToolOverride } from '@/types/override';
import type { PreviewView } from '@/types/workspace';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import type { AgentId, HealthCheckReport, InspectedNode, ThemeVisualSnapshot } from '@shared/types';
import { AGENT_META } from '@shared/types';
import { create } from 'zustand';

/** Read current i18n message table (project-standard pattern). */
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
 * Makes the trust boundary explicit and drops a malformed `colors` entry.
 */
function asToolOverride(value: Record<string, unknown>): ToolOverride {
  const v: Record<string, unknown> = { ...value };
  if (v.colors !== undefined && (v.colors === null || typeof v.colors !== 'object')) {
    delete v.colors;
  }
  return v as ToolOverride;
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
 * Undo coalescing: rapid edits to the *same* override key within this window
 * collapse into a single undo step.
 */
const undoCoalesce = { key: null as keyof ToolOverride | null, at: 0 };
const UNDO_COALESCE_MS = 700;
const UNDO_LIMIT = 30;

/** Push the previous `toolOverrides` onto the undo stack (capped). */
function pushUndo(
  stack: (ToolOverride | null)[],
  prev: ToolOverride | null,
): (ToolOverride | null)[] {
  const next = [...stack, prev];
  return next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next;
}

export type ExportState = {
  loading: boolean;
  dir: string | null;
  error: string | null;
};

export interface CaptureState {
  // --- Preview / inspect ---
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

  // --- Capture controls ---
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  pseudoView: string | null;
  schemeView: 'light' | 'dark' | null;

  // --- Baseline (A/B compare mode) ---
  baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>;
  baselineLoadingMap: Partial<Record<AgentId, boolean>>;
  baselineErrorMap: Partial<Record<AgentId, string>>;

  // --- Export ---
  exportName: string;
  exportAuthor: string;
  exportState: ExportState;

  // --- DOM tree version (bumped on each captureDomTree completion) ---
  domTreeVersion: number;

  // --- IPC-subscribed analysis progress / health reports ---
  analysisProgress: { agent: string; step: string; progress: number } | null;
  healthReportByAgent: Record<string, HealthCheckReport>;
  setAnalysisProgress: (payload: { agent: string; step: string; progress: number }) => void;
  setHealthReport: (report: HealthCheckReport) => void;

  // --- Capture actions ---
  baselineSnapshot(): Promise<void>;
  restoreAgent(): Promise<void>;
  exportTheme(): Promise<void>;
  toggleInspect(): Promise<void>;

  // --- Override actions ---
  setOverride(key: keyof ToolOverride, value: string | number | boolean | undefined): void;
  resetOverrides(): void;
  undo(): void;
  redo(): void;
  applyPalette(palette: Record<string, string | undefined>, action: 'preview' | 'apply'): void;
  setOverrideColors(palette: Record<string, string>): void;
  setPaletteLoaded(palette: Record<string, string>): void;

  // --- Capture controls (selectors / pseudo) ---
  addPinnedSelector(): void;
  removePinnedSelector(sel: string): void;
  pinSelector(sel: string): void;
  togglePseudo(state: string): void;

  // --- Simple setters ---
  setPreviewView(v: PreviewView): void;
  setSearchQuery(v: string): void;
  setHoveredIdx(v: number | null): void;
  setInspectingIdx(v: number | null): void;
  setPseudoView(v: string | null): void;
  setSchemeView(v: 'light' | 'dark' | null): void;
  setCaptureSchemes(v: boolean): void;
  setCustomSelectorInput(v: string): void;
  setExportName(v: string): void;
  setExportAuthor(v: string): void;
  setInspectResult(node: InspectedNode | { error: string }): void;
}

export const useCaptureStore = create<CaptureState>()((set, get) => ({
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

  baselines: {},
  baselineLoadingMap: {},
  baselineErrorMap: {},

  exportName: '',
  exportAuthor: '',
  exportState: { loading: false, dir: null, error: null },

  domTreeVersion: 0,

  // --- IPC-subscribed analysis progress / health reports ---
  analysisProgress: null,
  healthReportByAgent: {},
  setAnalysisProgress: (payload) => set({ analysisProgress: payload }),
  setHealthReport: (report) =>
    set((s) => ({
      healthReportByAgent: { ...s.healthReportByAgent, [report.agentId]: report },
    })),

  // ------------------------------------------------------------------
  // Capture actions
  // ------------------------------------------------------------------

  baselineSnapshot: async () => {
    const showToast = useNotificationStore.getState().showToast;
    const project = useProjectStore.getState().getActiveProject();
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
      void useProjectStore.getState().saveActiveProject({ hasBaseline: true });
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
    const project = useProjectStore.getState().getActiveProject();
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
    const project = useProjectStore.getState().getActiveProject();
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
      void useProjectStore.getState().saveActiveProject({
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
      const project = useProjectStore.getState().getActiveProject();
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

  // ------------------------------------------------------------------
  // Override actions
  // ------------------------------------------------------------------

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
    const capturedActiveId = useProjectStore.getState().activeProjectId;
    void (async () => {
      try {
        const current = useProjectStore.getState().activeProjectId;
        if (current !== capturedActiveId) return;
        const currentProject = useProjectStore.getState().getActiveProject();
        if (!currentProject) return;
        await api.saveStudioProject({ ...currentProject, palette });
      } catch (e) {
        showToast(currentT().studioSaveFailed(toMessage(e)), 'destructive');
      }
    })();
  },

  // ------------------------------------------------------------------
  // Capture controls (selectors / pseudo)
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Simple setters
  // ------------------------------------------------------------------

  setPreviewView: (v) => set({ previewView: v }),
  setSearchQuery: (v) => set({ searchQuery: v }),
  setHoveredIdx: (v) => set({ hoveredIdx: v }),
  setInspectingIdx: (v) => set({ inspectingIdx: v }),
  setPseudoView: (v) => set({ pseudoView: v }),
  setSchemeView: (v) => set({ schemeView: v }),
  setCaptureSchemes: (v) => set({ captureSchemes: v }),
  setCustomSelectorInput: (v) => set({ customSelectorInput: v }),
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
