// SPDX-License-Identifier: MPL-2.0

/**
 * # workspaceStore
 *
 * Workspace layout state — single preview window, dock, inspector,
 * drawer, and workspace preset. Replaces the ad-hoc collapsed/state
 * booleans previously scattered across studioStore.
 *
 * Note: Studio is now single-window only. `window` holds the single
 * PreviewWindow record directly (no array, no activeWindowId).
 */

import { api } from '@/api/agentSkinClient';
import { WORKSPACE_PRESETS } from '@/stores/workspace-presets';
import type { ToolOverride, TweakSession } from '@/types/override';
import type {
  DockState,
  DrawerState,
  HistoryEntry,
  InspectorState,
  PreviewWindowState,
  TweakPreset,
  ViewMode,
} from '@/types/workspace';
import {
  DOCK_HEIGHT_DEFAULT,
  DOCK_HEIGHT_MAX,
  DOCK_HEIGHT_MIN,
  DRAWER_WIDTH_DEFAULT,
  INSPECTOR_WIDTH_DEFAULT,
} from '@/types/workspace';

import type { AgentId } from '@shared/types';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface WorkspaceState {
  // Always 'single' — Studio is single-window only
  viewMode: ViewMode;

  // Single preview window (no array — Studio is single-window only)
  window: PreviewWindowState;

  // Sub-panels
  dock: DockState;
  inspector: InspectorState;
  drawer: DrawerState;

  // Active workspace preset (null = user-customized)
  activePresetId: string;

  // --- Live tweak state ---
  /** Currently selected agent for live tweaking. null = nothing selected. */
  currentAgentId: AgentId | null;
  /** CDP port of the currently selected agent (null when no live connection). */
  currentPort: number | null;
  /** Live overrides being edited. These are pushed to the agent in real time. */
  currentOverrides: ToolOverride;
  /** True once the user has changed overrides but not yet saved / discarded. */
  dirty: boolean;
  /** Per-agent overrides cache, persisted across sessions. agentId → overrides. */
  overridesByAgent: Record<string, ToolOverride>;
  /** Most recent push error message (null = no error). UI shows banner when set. */
  pushError: string | null;
  /** Performance baseline: last push-to-agent duration in ms (null = not yet measured). */
  lastPushDurationMs: number | null;
  /** Performance baseline: rolling average push duration (null = insufficient samples). */
  avgPushDurationMs: number | null;

  // --- Undo / Redo history ---
  /** History stack for undo/redo. Empty array = no history. */
  history: HistoryEntry[];
  /** Current position in history. -1 = at initial state (nothing to undo). */
  historyIndex: number;

  // --- Named tweak presets ---
  /** User-saved tweak presets, persisted to localStorage. */
  tweakPresets: TweakPreset[];
  /** Currently active tweak preset id (null = unsaved / custom). */
  tweakPresetActiveId: string | null;

  // --- A/B compare ---
  /** True when the compare preset is active and the preview should split. */
  dualPreviewActive: boolean;

  // --- Raw CSS editing (CenterTabRaw) ---
  /** Discovered stylesheets for the current agent. Empty when not loaded. */
  rawSheets: Array<{
    styleSheetId: string;
    url: string;
    disabled: boolean;
    isInline: boolean;
    sourceURL: string;
    length: string;
    label: string;
  }>;
  /** Currently selected sheet index (into rawSheets). null = none selected. */
  rawSheetIndex: number | null;
  /** Current textarea content (may differ from original = dirty). */
  rawCss: string;
  /** Original CSS text at load time — compared against rawCss for dirty check. */
  rawCssOriginal: string;
  /** True when rawCss !== rawCssOriginal. */
  rawDirty: boolean;
  /** Error message to display in the raw editor (load/apply failure). */
  rawError: string | null;
  /** True while a list/load/apply operation is in flight. */
  rawLoading: boolean;

  // ---- actions ----

  setViewMode: (mode: ViewMode) => void;

  // single window
  /** Update the single preview window's scale. */
  setWindowScale: (scale: number) => void;

  // dock
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setDockHeight: (h: number) => void;
  setDockTab: (tab: DockState['activeTab']) => void;

  // inspector
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setInspectorWidth: (w: number) => void;
  setInspectorTab: (tab: InspectorState['activeTab']) => void;

  // drawer
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setDrawerWidth: (w: number) => void;
  setDrawerCollapsed: (collapsed: boolean) => void;

  // workspace preset
  applyPreset: (presetId: string) => void;

  // --- live tweak actions ---
  /** Select an agent for live tweaking (must be running with a CDP port). */
  selectAgent: (agentId: AgentId, port: number) => void;
  /**
   * Update a single override dimension. Pushes the full set to the running
   * agent in real time via the `workspace-tweak` CDP layer. Marks `dirty`.
   * Returns a promise (fire-and-forget from callers is fine via `void`).
   */
  updateOverride: (
    key: keyof ToolOverride,
    value: ToolOverride[keyof ToolOverride],
  ) => Promise<void>;
  /** Persist current overrides into customThemeCss. Returns true on success. */
  saveChanges: () => Promise<boolean>;
  /** Discard overrides and clear the tweak layer. Returns true on success. */
  discardChanges: () => Promise<boolean>;
  /** Clear the push error banner. */
  clearPushError: () => void;
  /** Test-only: reset the monotonic push token to 0 for deterministic test isolation. */
  testResetPushToken: () => void;
  /** Test-only: clear the push duration rolling buffer for deterministic test isolation. */
  testResetPushDurationHistory: () => void;

  // --- Undo / Redo actions ---
  /** Step back in history. Returns true if the undo was applied. */
  undo: () => Promise<boolean>;
  /** Step forward in history. Returns true if the redo was applied. */
  redo: () => Promise<boolean>;
  /** Whether undo is currently possible. */
  canUndo: () => boolean;
  /** Whether redo is currently possible. */
  canRedo: () => boolean;

  // --- Named tweak preset actions ---
  /** Save current overrides as a named preset. Returns true on success. */
  saveTweakPreset: (name: string) => Promise<boolean>;
  /** Load a tweak preset by id. Returns true on success. */
  loadTweakPreset: (id: string) => Promise<boolean>;
  /** Delete a tweak preset by id. Returns true on success. */
  deleteTweakPreset: (id: string) => Promise<boolean>;
  /** Rename a tweak preset. Returns true on success. */
  renameTweakPreset: (id: string, name: string) => Promise<boolean>;
  // --- export / import ---
  /** Serialize current overrides to a JSON string for cross-device sharing. */
  exportTweakConfig: () => string;
  /**
   * Import a tweak configuration from JSON. Validates schema, applies overrides,
   * and pushes a history entry. Returns ok + optional error message.
   */
  importTweakConfig: (json: string) => Promise<{ ok: boolean; error?: string }>;
  // --- A/B compare ---
  /** Set the A/B compare active flag (driven by applyPreset). */
  setDualPreviewActive: (active: boolean) => void;
  // --- inspect mode (element picking) ---
  /** Toggle inspect mode for element picking. */
  toggleInspectMode: () => void;
  // --- raw CSS editing actions ---
  /** Load the stylesheet list for the current agent. Returns the list (may be empty). */
  loadRawSheets: () => Promise<Array<{ styleSheetId: string; label: string }>>;
  /** Select a sheet by index and load its CSS text into the textarea. */
  selectRawSheet: (index: number) => Promise<void>;
  /** Update textarea content (marks dirty when it differs from original). */
  setRawCss: (css: string) => void;
  /** Apply the current rawCss through the workspace-tweak layer. Returns ok. */
  applyRawEdit: () => Promise<boolean>;
  /** Reset textarea to the original CSS text and clear the tweak layer. */
  resetRawEdit: () => Promise<boolean>;
  /** Clear the raw editor error banner. */
  clearRawError: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'workspace.overridesByAgent';
const STORAGE_VERSION_KEY = 'workspace.version';
const CURRENT_VERSION = 1;

const PRESET_STORAGE_KEY = 'workspace.tweakPresets';
const MAX_HISTORY = 20;
const MAX_PRESETS = 50;

interface StorageWrapper {
  _version: number;
  data: Record<string, ToolOverride>;
}

/**
 * Runtime type guard for a single ToolOverride value.
 * Since ToolOverride is a flat record of optional primitive fields, we
 * validate that the value is a non-null object (all fields are optional
 * so no individual field check is required at this layer).
 */
function isToolOverride(value: unknown): value is ToolOverride {
  return value !== null && typeof value === 'object';
}

/**
 * Resolve overrides from a history entry, falling back to an empty
 * ToolOverride when the entry fails the type guard. This prevents
 * malformed history data from silently corrupting the workspace state.
 */
function resolveOverrides(entry: HistoryEntry): ToolOverride {
  return isToolOverride(entry.overrides) ? entry.overrides : {};
}

/**
 * Runtime type guard for a Record<string, ToolOverride> map.
 * Validates every value in the record satisfies isToolOverride.
 */
function isValidOverrides(value: unknown): value is Record<string, ToolOverride> {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!isToolOverride(obj[key])) return false;
  }
  return true;
}

/** Load per-agent overrides from localStorage. Returns empty map on any error. */
function loadOverridesByAgent(): Record<string, ToolOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // v1 format
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as StorageWrapper)._version === 1 &&
      isValidOverrides((parsed as StorageWrapper).data)
    ) {
      return (parsed as StorageWrapper).data;
    }
    // legacy format (no _version) — validate before returning
    if (isValidOverrides(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {}; // quota / parse error — degrade to in-session only
  }
}

/** Persist per-agent overrides to localStorage. Silently degrades on quota errors. */
function persistOverridesByAgent(map: Record<string, ToolOverride>): void {
  try {
    const wrapper: StorageWrapper = { _version: CURRENT_VERSION, data: map };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapper));
    localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_VERSION));
  } catch {
    // quota exceeded etc. — degrade gracefully, UI still works
  }
}

/**
 * Runtime type guard for a single TweakPreset value.
 * Validates required fields exist with correct types.
 */
function isTweakPreset(value: unknown): value is TweakPreset {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.name !== 'string') return false;
  if (typeof obj.agentId !== 'string') return false;
  if (!obj.overrides || typeof obj.overrides !== 'object') return false;
  if (typeof obj.createdAt !== 'string') return false;
  if (typeof obj.updatedAt !== 'string') return false;
  return true;
}

/**
 * Runtime type guard for a TweakPreset[] array.
 * Filters out any entries that fail isTweakPreset validation.
 */
function isValidTweakPresets(value: unknown): value is TweakPreset[] {
  return Array.isArray(value) && value.every(isTweakPreset);
}

/** Load tweak presets from localStorage. Returns empty array on any error. */
function loadTweakPresets(): TweakPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (isValidTweakPresets(parsed)) return parsed;
    return [];
  } catch {
    return []; // quota / parse error — degrade to in-session only
  }
}

/** Persist tweak presets to localStorage. Silently degrades on quota errors. */
function persistTweakPresets(presets: TweakPreset[]): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // quota exceeded etc. — degrade gracefully, UI still works
  }
}

/**
 * Get the current agent ID or set an error and return null.
 * Replaces the unsafe `'codex' as AgentId` fallback pattern that silently
 * masked "no agent selected" conditions.
 *
 * Accepts `get`/`set` from the zustand create callback — this helper is
 * defined at module scope so it cannot close over the store's own set/get.
 */
function requireAgentId(
  get: () => WorkspaceState,
  set: (partial: Partial<WorkspaceState>) => void,
): AgentId | null {
  const id = get().currentAgentId;
  if (!id) {
    set({ pushError: 'no_agent_selected' });
    return null;
  }
  return id;
}

/** Monotonic token — incremented on each updateOverride call to discard stale push receipts. */
let pushToken = 0;

/** Rolling buffer of recent push durations (ms) for baseline averaging. */
const PUSH_DURATION_HISTORY: number[] = [];
const MAX_PUSH_HISTORY = 20;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// In test environments (VITEST=true), bypass debounce for deterministic testing.
const IS_TEST = process.env.VITEST === 'true';
const DEBOUNCE_MS = IS_TEST ? 0 : 150;

function makeWindow(id: string, agentId: AgentId): PreviewWindowState {
  return {
    id,
    agentId,
    scale: 1,
    selectedLandmarkIdx: null,
    inspectMode: false,
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const DEFAULT_AGENT: AgentId = 'codex';

const initialWindow = makeWindow('w1', DEFAULT_AGENT);

const initialState: Omit<
  WorkspaceState,
  | 'setViewMode'
  | 'setWindowScale'
  | 'setDockOpen'
  | 'toggleDock'
  | 'setDockHeight'
  | 'setDockTab'
  | 'setInspectorOpen'
  | 'toggleInspector'
  | 'setInspectorWidth'
  | 'setInspectorTab'
  | 'setDrawerOpen'
  | 'toggleDrawer'
  | 'setDrawerWidth'
  | 'setDrawerCollapsed'
  | 'applyPreset'
  | 'selectAgent'
  | 'updateOverride'
  | 'saveChanges'
  | 'discardChanges'
  | 'clearPushError'
  | 'testResetPushToken'
  | 'testResetPushDurationHistory'
  | 'undo'
  | 'redo'
  | 'canUndo'
  | 'canRedo'
  | 'saveTweakPreset'
  | 'loadTweakPreset'
  | 'deleteTweakPreset'
  | 'renameTweakPreset'
  | 'exportTweakConfig'
  | 'importTweakConfig'
  | 'setDualPreviewActive'
  | 'toggleInspectMode'
  | 'loadRawSheets'
  | 'selectRawSheet'
  | 'setRawCss'
  | 'applyRawEdit'
  | 'resetRawEdit'
  | 'clearRawError'
> = {
  viewMode: 'single',
  window: initialWindow,

  dock: {
    open: true,
    height: DOCK_HEIGHT_DEFAULT,
    activeTab: 'fx',
    collapsed: false,
  },

  inspector: {
    open: true,
    width: INSPECTOR_WIDTH_DEFAULT,
    activeTab: 'profile',
    collapsed: false,
  },

  drawer: {
    open: true,
    width: DRAWER_WIDTH_DEFAULT,
    collapsed: false,
  },

  activePresetId: 'default',

  // --- live tweak defaults ---
  currentAgentId: null,
  currentPort: null,
  currentOverrides: {},
  dirty: false,
  overridesByAgent: loadOverridesByAgent(),
  pushError: null,
  // --- performance baseline defaults ---
  lastPushDurationMs: null,
  avgPushDurationMs: null,

  // --- undo/redo defaults ---
  history: [],
  historyIndex: -1,

  // --- named tweak preset defaults ---
  tweakPresets: loadTweakPresets(),
  tweakPresetActiveId: null,

  // --- A/B compare defaults ---
  dualPreviewActive: false,

  // --- raw CSS editing defaults ---
  rawSheets: [],
  rawSheetIndex: null,
  rawCss: '',
  rawCssOriginal: '',
  rawDirty: false,
  rawError: null,
  rawLoading: false,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...initialState,

  setViewMode: (mode) => {
    // Single-window only — ignore any non-'single' value
    if (mode !== 'single') return;
    set({ viewMode: mode });
  },

  // single window

  setWindowScale: (scale) =>
    set((s) => ({
      window: { ...s.window, scale: Math.max(0.25, Math.min(2.0, scale)) },
    })),

  // dock
  setDockOpen: (open) =>
    set((s) => ({
      dock: {
        ...s.dock,
        open,
        collapsed: !open,
        height: open ? DOCK_HEIGHT_DEFAULT : 0,
      },
    })),

  toggleDock: () => get().setDockOpen(!get().dock.open),

  setDockHeight: (h) =>
    set((s) => ({
      dock: {
        ...s.dock,
        height: Math.max(DOCK_HEIGHT_MIN, Math.min(DOCK_HEIGHT_MAX, h)),
      },
    })),

  setDockTab: (tab) => set((s) => ({ dock: { ...s.dock, activeTab: tab } })),

  // inspector
  setInspectorOpen: (open) =>
    set((s) => ({ inspector: { ...s.inspector, open, collapsed: !open } })),

  toggleInspector: () => get().setInspectorOpen(!get().inspector.open),

  setInspectorWidth: (w) =>
    set((s) => ({
      inspector: {
        ...s.inspector,
        width: Math.max(4, Math.min(400, w)),
        collapsed: w < 30,
      },
    })),

  setInspectorTab: (tab) => set((s) => ({ inspector: { ...s.inspector, activeTab: tab } })),

  // drawer
  setDrawerOpen: (open) => set((s) => ({ drawer: { ...s.drawer, open, collapsed: !open } })),

  toggleDrawer: () => get().setDrawerOpen(!get().drawer.open),

  setDrawerWidth: (w) =>
    set((s) => ({
      drawer: {
        ...s.drawer,
        width: Math.max(48, Math.min(360, w)),
        collapsed: w < 80,
      },
    })),

  setDrawerCollapsed: (collapsed) => set((s) => ({ drawer: { ...s.drawer, collapsed } })),

  // workspace preset — only applies dock/inspector/drawer config (no window count change)
  applyPreset: (presetId) => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    const currentDock = get().dock;
    const currentInspector = get().inspector;
    const currentDrawer = get().drawer;

    set({
      activePresetId: presetId,
      dock: {
        ...currentDock,
        ...preset.dock,
        height:
          preset.dock?.open !== undefined
            ? preset.dock.open
              ? (preset.dock.height ?? DOCK_HEIGHT_DEFAULT)
              : 0
            : (preset.dock?.height ?? currentDock.height),
        collapsed:
          preset.dock?.open !== undefined
            ? !preset.dock.open
            : (preset.dock?.collapsed ?? currentDock.collapsed),
      },
      inspector: {
        ...currentInspector,
        ...preset.inspector,
        open:
          preset.inspector?.open ??
          (preset.inspector?.collapsed !== undefined
            ? !preset.inspector.collapsed
            : currentInspector.open),
        width: preset.inspector?.width ?? currentInspector.width,
      },
      drawer: {
        ...currentDrawer,
        ...preset.drawer,
        open:
          preset.drawer?.open ??
          (preset.drawer?.collapsed !== undefined ? !preset.drawer.collapsed : currentDrawer.open),
        width: preset.drawer?.width ?? currentDrawer.width,
      },
      // A/B compare: enabled only when the preset declares dualPreview.
      dualPreviewActive: preset.dualPreview === true,
    });
  },

  // --- live tweak actions ---

  selectAgent: (agentId, port) =>
    set((s) => ({
      currentAgentId: agentId,
      currentPort: port,
      currentOverrides: s.overridesByAgent[agentId] ?? {},
      dirty: false,
      pushError: null,
      // Reset history when switching agents (different agent = different edit context).
      history: [],
      historyIndex: -1,
    })),

  updateOverride: async (key, value) => {
    const s = get();
    const next: ToolOverride = { ...s.currentOverrides, [key]: value };
    const agentId = requireAgentId(get, set);
    if (!agentId) return;

    // Optimistic update: UI reflects intent immediately.
    const overridesByAgent = { ...s.overridesByAgent, [agentId]: next };
    persistOverridesByAgent(overridesByAgent);

    // Record history: discard redo tail, push new entry, trim to MAX_HISTORY.
    const historyEntry: HistoryEntry = { overrides: { ...next }, timestamp: Date.now() };
    const newHistory = [...s.history.slice(0, s.historyIndex + 1), historyEntry];
    if (newHistory.length > MAX_HISTORY) {
      newHistory.splice(0, newHistory.length - MAX_HISTORY);
    }
    const newIndex = newHistory.length - 1;

    set({
      currentOverrides: next,
      overridesByAgent,
      dirty: true,
      pushError: null,
      history: newHistory,
      historyIndex: newIndex,
    });

    // Push: debounced in production (150ms), immediate in tests.
    const session: TweakSession = {
      agentId,
      port: s.currentPort ?? 0,
      overrides: next,
      dirty: true,
    };
    if (IS_TEST) {
      // Synchronous push for deterministic tests.
      await pushToAgent(session, next);
    } else {
      // Debounced push: 150ms window collapses multiple changes into one push.
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void pushToAgent(session, next);
      }, DEBOUNCE_MS);
    }
  },

  saveChanges: async () => {
    // Debounce flush: push any pending debounce before saving.
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const { currentPort, currentOverrides } = get();
    const agentId = requireAgentId(get, set);
    if (!agentId) return false;
    const session: TweakSession = {
      agentId,
      port: currentPort ?? 0,
      overrides: currentOverrides,
      dirty: true,
    };
    const ok = await api.saveTweakAsCustomCss(session, currentOverrides);
    if (ok) {
      // Sync persisted value so selectAgent restores the saved state.
      const overridesByAgent = {
        ...get().overridesByAgent,
        [session.agentId]: currentOverrides,
      };
      persistOverridesByAgent(overridesByAgent);
      set({ dirty: false, overridesByAgent, pushError: null });
    }
    return ok;
  },

  discardChanges: async () => {
    // Debounce flush: cancel any pending debounce before resetting.
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const { currentPort } = get();
    const agentId = requireAgentId(get, set);
    if (!agentId) return false;
    const session: TweakSession = {
      agentId,
      port: currentPort ?? 0,
      overrides: {},
      dirty: false,
    };
    const ok = await api.resetTweak(session);
    if (ok) {
      const overridesByAgent = { ...get().overridesByAgent };
      delete overridesByAgent[agentId];
      persistOverridesByAgent(overridesByAgent);
      set({ currentOverrides: {}, dirty: false, overridesByAgent });
    }
    return ok;
  },

  clearPushError: () => set({ pushError: null }),

  // R4: 模块级 PUSH_DURATION_HISTORY 在 store reset 时不再泄漏
  // — testResetPushDurationHistory 清理滚动缓冲，确保测试隔离。
  testResetPushToken: () => {
    pushToken = 0;
  },
  testResetPushDurationHistory: () => {
    PUSH_DURATION_HISTORY.length = 0;
  },

  // --- undo / redo actions ---

  undo: async () => {
    const { historyIndex, history } = get();
    if (historyIndex <= 0) return false;
    const agentId = requireAgentId(get, set);
    if (!agentId) return false;
    const nextIndex = historyIndex - 1;
    const entry = history[nextIndex];
    const overrides = resolveOverrides(entry);
    // Apply the overrides from the previous history entry (without pushing to history).
    const overridesByAgent = {
      ...get().overridesByAgent,
      [agentId]: overrides,
    };
    persistOverridesByAgent(overridesByAgent);
    set({
      currentOverrides: overrides,
      historyIndex: nextIndex,
      overridesByAgent,
      dirty: true,
      pushError: null,
    });
    // Push the undone state to the agent (debounced in production).
    await pushToAgent(
      {
        agentId,
        port: get().currentPort ?? 0,
        overrides,
        dirty: true,
      },
      overrides,
    );
    return true;
  },

  redo: async () => {
    const { historyIndex, history } = get();
    if (historyIndex >= history.length - 1) return false;
    const agentId = requireAgentId(get, set);
    if (!agentId) return false;
    const nextIndex = historyIndex + 1;
    const entry = history[nextIndex];
    const overrides = resolveOverrides(entry);
    const overridesByAgent = {
      ...get().overridesByAgent,
      [agentId]: overrides,
    };
    persistOverridesByAgent(overridesByAgent);
    set({
      currentOverrides: overrides,
      historyIndex: nextIndex,
      overridesByAgent,
      dirty: true,
      pushError: null,
    });
    await pushToAgent(
      {
        agentId,
        port: get().currentPort ?? 0,
        overrides,
        dirty: true,
      },
      overrides,
    );
    return true;
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  // --- named tweak preset actions ---

  saveTweakPreset: async (name: string) => {
    if (!name.trim()) return false;
    const { currentOverrides, tweakPresets } = get();
    const agentId = requireAgentId(get, set);
    if (!agentId) return false;
    const now = new Date().toISOString();
    const preset: TweakPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      agentId,
      overrides: { ...currentOverrides },
      createdAt: now,
      updatedAt: now,
    };
    // LRU: trim to MAX_PRESETS by dropping oldest.
    const trimmed = [...tweakPresets, preset].slice(-MAX_PRESETS);
    persistTweakPresets(trimmed);
    set({ tweakPresets: trimmed, tweakPresetActiveId: preset.id });
    return true;
  },

  loadTweakPreset: async (id: string) => {
    const preset = get().tweakPresets.find((p) => p.id === id);
    if (!preset) return false;
    const agentId = requireAgentId(get, set);
    if (!agentId) return false;
    const overrides = preset.overrides as ToolOverride;
    const overridesByAgent = {
      ...get().overridesByAgent,
      [agentId]: overrides,
    };
    persistOverridesByAgent(overridesByAgent);
    // Load into current state and push a history entry.
    set({
      currentOverrides: overrides,
      overridesByAgent,
      dirty: true,
      tweakPresetActiveId: id,
      pushError: null,
    });
    // Push to agent.
    await pushToAgent(
      {
        agentId,
        port: get().currentPort ?? 0,
        overrides,
        dirty: true,
      },
      overrides,
    );
    return true;
  },

  deleteTweakPreset: async (id: string) => {
    const { tweakPresets, tweakPresetActiveId } = get();
    const filtered = tweakPresets.filter((p) => p.id !== id);
    if (filtered.length === tweakPresets.length) return false;
    persistTweakPresets(filtered);
    set({
      tweakPresets: filtered,
      tweakPresetActiveId: tweakPresetActiveId === id ? null : tweakPresetActiveId,
    });
    return true;
  },

  renameTweakPreset: async (id: string, name: string) => {
    if (!name.trim()) return false;
    const { tweakPresets } = get();
    const idx = tweakPresets.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    const updated = [...tweakPresets];
    updated[idx] = { ...updated[idx], name: name.trim(), updatedAt: new Date().toISOString() };
    persistTweakPresets(updated);
    set({ tweakPresets: updated });
    return true;
  },

  // --- export / import ---

  exportTweakConfig: () => {
    const { currentOverrides, currentAgentId } = get();
    return JSON.stringify(
      {
        version: 1,
        agentId: currentAgentId,
        exportedAt: new Date().toISOString(),
        overrides: currentOverrides,
      },
      null,
      2,
    );
  },

  importTweakConfig: async (json: string) => {
    // JSON Schema validation: must be an object with an `overrides` field.
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'not_an_object' };
    }
    const obj = parsed as Record<string, unknown>;
    if (!('overrides' in obj) || !obj.overrides || typeof obj.overrides !== 'object') {
      return { ok: false, error: 'missing_overrides' };
    }
    const overrides = obj.overrides as ToolOverride;
    // Apply overrides and push to history (same code path as updateOverride).
    const agentId = requireAgentId(get, set);
    if (!agentId) return { ok: false, error: 'no_agent_selected' };
    const overridesByAgent = { ...get().overridesByAgent, [agentId]: overrides };
    persistOverridesByAgent(overridesByAgent);
    const historyEntry: HistoryEntry = { overrides: { ...overrides }, timestamp: Date.now() };
    const newHistory = [...get().history.slice(0, get().historyIndex + 1), historyEntry];
    if (newHistory.length > MAX_HISTORY) {
      newHistory.splice(0, newHistory.length - MAX_HISTORY);
    }
    const newIndex = newHistory.length - 1;
    set({
      currentOverrides: overrides,
      overridesByAgent,
      dirty: true,
      pushError: null,
      tweakPresetActiveId: null,
      history: newHistory,
      historyIndex: newIndex,
    });
    // Push to agent.
    await pushToAgent(
      {
        agentId,
        port: get().currentPort ?? 0,
        overrides,
        dirty: true,
      },
      overrides,
    );
    return { ok: true };
  },

  // --- A/B compare ---

  setDualPreviewActive: (active) => set({ dualPreviewActive: active }),

  // --- inspect mode (element picking) ---

  toggleInspectMode: () =>
    set((s) => ({
      window: { ...s.window, inspectMode: !s.window.inspectMode },
    })),

  // --- raw CSS editing actions ---

  loadRawSheets: async () => {
    const { currentPort } = get();
    if (!currentPort) {
      set({ rawError: 'no_agent_selected', rawSheets: [], rawSheetIndex: null });
      return [];
    }
    set({ rawLoading: true, rawError: null });
    try {
      const sheets = await api.listStyleSheets(currentPort);
      set({ rawSheets: sheets, rawLoading: false });
      return sheets.map((s) => ({ styleSheetId: s.styleSheetId, label: s.label }));
    } catch (error) {
      set({
        rawLoading: false,
        rawError: error instanceof Error ? error.message : 'load_failed',
        rawSheets: [],
        rawSheetIndex: null,
      });
      return [];
    }
  },

  selectRawSheet: async (index: number) => {
    const { rawSheets, currentPort } = get();
    if (!currentPort) {
      set({ rawError: 'no_agent_selected' });
      return;
    }
    if (index < 0 || index >= rawSheets.length) {
      set({ rawError: 'invalid_sheet_index' });
      return;
    }
    const sheet = rawSheets[index];
    set({
      rawLoading: true,
      rawError: null,
      rawSheetIndex: index,
      rawCss: '',
      rawCssOriginal: '',
      rawDirty: false,
    });
    try {
      const text = await api.getStyleSheetText(currentPort, sheet.styleSheetId);
      set({ rawCss: text, rawCssOriginal: text, rawLoading: false, rawDirty: false });
    } catch (error) {
      set({
        rawLoading: false,
        rawError: error instanceof Error ? error.message : 'load_text_failed',
      });
    }
  },

  setRawCss: (css: string) => {
    const { rawCssOriginal } = get();
    set({ rawCss: css, rawDirty: css !== rawCssOriginal });
  },

  applyRawEdit: async () => {
    const { currentPort, currentAgentId, rawCss } = get();
    if (!currentPort || !currentAgentId) {
      set({ rawError: 'no_agent_selected' });
      return false;
    }
    set({ rawLoading: true, rawError: null });
    try {
      const result = await api.applyRawCssEdit(currentPort, currentAgentId, rawCss);
      if (result.ok) {
        set({ rawLoading: false, rawCssOriginal: rawCss, rawDirty: false });
        return true;
      }
      set({ rawLoading: false, rawError: result.error ?? 'apply_failed' });
      return false;
    } catch (error) {
      set({
        rawLoading: false,
        rawError: error instanceof Error ? error.message : 'apply_failed',
      });
      return false;
    }
  },

  resetRawEdit: async () => {
    const { currentPort, currentAgentId, rawCssOriginal } = get();
    set({ rawCss: rawCssOriginal, rawDirty: false });
    // Clear the tweak layer if an agent is connected.
    if (currentPort && currentAgentId) {
      try {
        await api.applyRawCssEdit(currentPort, currentAgentId, '');
      } catch {
        // best-effort clear
      }
    }
    return true;
  },

  clearRawError: () => set({ rawError: null }),
}));

/** Push overrides to the running agent (extracted for debounce reuse). */
async function pushToAgent(session: TweakSession, overrides: ToolOverride): Promise<void> {
  const token = ++pushToken;
  // Performance baseline: mark push start. Uses performance.now() for sub-ms
  // precision without the overhead of performance.mark()/measure() lookups.
  const pushStart = performance.now();
  try {
    const ok = await api.pushTweak(session, overrides);
    if (token !== pushToken) return;
    recordPushDuration(performance.now() - pushStart);
    if (!ok) useWorkspaceStore.setState({ pushError: 'push_failed' });
  } catch (err) {
    if (token !== pushToken) return;
    recordPushDuration(performance.now() - pushStart);
    useWorkspaceStore.setState({
      pushError: err instanceof Error ? err.message : 'push_error',
    });
  }
}

/**
 * Record a push duration into the rolling buffer and update the store's
 * baseline metrics. Called from pushToAgent after each push completes.
 */
function recordPushDuration(durationMs: number): void {
  PUSH_DURATION_HISTORY.push(durationMs);
  if (PUSH_DURATION_HISTORY.length > MAX_PUSH_HISTORY) {
    PUSH_DURATION_HISTORY.shift();
  }
  const avg = PUSH_DURATION_HISTORY.reduce((a, b) => a + b, 0) / PUSH_DURATION_HISTORY.length;
  useWorkspaceStore.setState({
    lastPushDurationMs: Math.round(durationMs * 100) / 100,
    avgPushDurationMs: Math.round(avg * 100) / 100,
  });
}
