// SPDX-License-Identifier: MPL-2.0

/**
 * # workspaceStore
 *
 * Workspace layout state — view mode, preview windows, dock, inspector,
 * drawer, and workspace presets. Replaces the ad-hoc collapsed/state
 * booleans previously scattered across studioStore.
 */

import { api } from '@/api/agentSkinClient';
import { WORKSPACE_PRESETS } from '@/stores/workspace-presets';
import type { ToolOverride, TweakSession } from '@/types/override';
import type {
  DockState,
  DrawerState,
  InspectorState,
  PreviewWindowState,
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
  // Current view mode (single / dual / triple / quad / focus)
  viewMode: ViewMode;

  // Preview windows (length depends on viewMode)
  windows: PreviewWindowState[];
  activeWindowId: string | null;

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

  // ---- actions ----

  setViewMode: (mode: ViewMode) => void;

  // window management
  addWindow: (win: PreviewWindowState) => void;
  removeWindow: (id: string) => void;
  setActiveWindow: (id: string) => void;
  updateWindow: (id: string, patch: Partial<PreviewWindowState>) => void;

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
   */
  updateOverride: (key: keyof ToolOverride, value: ToolOverride[keyof ToolOverride]) => void;
  /** Persist current overrides into customThemeCss. Returns true on success. */
  saveChanges: () => Promise<boolean>;
  /** Discard overrides and clear the tweak layer. Returns true on success. */
  discardChanges: () => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWindow(id: string, agentId: AgentId): PreviewWindowState {
  return {
    id,
    agentId,
    scale: 1,
    selectedLandmarkIdx: null,
    inspectMode: false,
  };
}

function windowsForMode(mode: ViewMode, agentId: AgentId): PreviewWindowState[] {
  const count =
    mode === 'single'
      ? 1
      : mode === 'dual'
        ? 2
        : mode === 'triple'
          ? 3
          : mode === 'quad'
            ? 4
            : /* focus */ 3;

  return Array.from({ length: count }, (_, i) => makeWindow(`win-${Date.now()}-${i}`, agentId));
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const DEFAULT_AGENT: AgentId = 'codex';

const initialWindows = windowsForMode('single', DEFAULT_AGENT);

const initialState: Omit<
  WorkspaceState,
  | 'setViewMode'
  | 'addWindow'
  | 'removeWindow'
  | 'setActiveWindow'
  | 'updateWindow'
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
> = {
  viewMode: 'single',
  windows: initialWindows,
  activeWindowId: initialWindows[0]?.id ?? null,

  dock: {
    open: true,
    height: DOCK_HEIGHT_DEFAULT,
    activeTab: 'fx',
    collapsed: false,
  },

  inspector: {
    open: true,
    width: INSPECTOR_WIDTH_DEFAULT,
    activeTab: 'landmarks',
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
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...initialState,

  setViewMode: (mode) => {
    const { activeWindowId, windows } = get();
    const agentId = windows.find((w) => w.id === activeWindowId)?.agentId ?? DEFAULT_AGENT;
    const next = windowsForMode(mode, agentId);
    set({
      viewMode: mode,
      windows: next,
      activeWindowId: next[0]?.id ?? null,
    });
  },

  addWindow: (win) => set((s) => ({ windows: [...s.windows, win] })),

  removeWindow: (id) =>
    set((s) => {
      const next = s.windows.filter((w) => w.id !== id);
      const nextActive = s.activeWindowId === id ? (next[0]?.id ?? null) : s.activeWindowId;
      return { windows: next, activeWindowId: nextActive };
    }),

  setActiveWindow: (id) => set({ activeWindowId: id }),

  updateWindow: (id, patch) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
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

  // workspace preset
  applyPreset: (presetId) => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    const { windows } = get();
    const agentId = windows[0]?.agentId ?? DEFAULT_AGENT;
    const nextWindows = windowsForMode(preset.viewMode, agentId);
    const currentDock = get().dock;
    const currentInspector = get().inspector;
    const currentDrawer = get().drawer;

    set({
      viewMode: preset.viewMode,
      windows: nextWindows,
      activeWindowId: nextWindows[0]?.id ?? null,
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
    });
  },

  // --- live tweak actions ---

  selectAgent: (agentId, port) =>
    set({
      currentAgentId: agentId,
      currentPort: port,
      currentOverrides: {},
      dirty: false,
    }),

  updateOverride: (key, value) =>
    set((s) => {
      const next: ToolOverride = { ...s.currentOverrides, [key]: value };
      // Fire-and-forget the real-time push. The main process caches the CSS
      // layer independently, so a failed push (agent restarting, port flap)
      // does not block the UI from reflecting the intended state.
      const session: TweakSession = {
        agentId: s.currentAgentId ?? ('codex' as AgentId),
        port: s.currentPort ?? 0,
        overrides: next,
        dirty: true,
      };
      void api.pushTweak(session, next);
      return { currentOverrides: next, dirty: true };
    }),

  saveChanges: async () => {
    const { currentAgentId, currentPort, currentOverrides } = get();
    const session: TweakSession = {
      agentId: currentAgentId ?? ('codex' as AgentId),
      port: currentPort ?? 0,
      overrides: currentOverrides,
      dirty: true,
    };
    const ok = await api.saveTweakAsCustomCss(session, currentOverrides);
    if (ok) set({ dirty: false });
    return ok;
  },

  discardChanges: async () => {
    const { currentAgentId, currentPort } = get();
    const session: TweakSession = {
      agentId: currentAgentId ?? ('codex' as AgentId),
      port: currentPort ?? 0,
      overrides: {},
      dirty: false,
    };
    const ok = await api.resetTweak(session);
    if (ok) set({ currentOverrides: {}, dirty: false });
    return ok;
  },
}));
