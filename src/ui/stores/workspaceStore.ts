// SPDX-License-Identifier: MPL-2.0

/**
 * # workspaceStore
 *
 * Workspace layout state — view mode, preview windows, dock, inspector,
 * drawer, and workspace presets. Replaces the ad-hoc collapsed/state
 * booleans previously scattered across studioStore.
 */

import { WORKSPACE_PRESETS } from '@/stores/workspace-presets';
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
}));
