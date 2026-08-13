/**
 * Workspace types — preview window, dock, view mode, workspace layout state.
 *
 * These are consumed by workspaceStore.ts and the new Stage / Dock /
 * Inspector / TopBar components.
 */

import type { AgentId } from '@shared/types';

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export type ViewMode = 'single' | 'dual' | 'triple' | 'quad' | 'focus';

export const VIEW_MODES: ViewMode[] = ['single', 'dual', 'triple', 'quad', 'focus'];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  single: 'Single',
  dual: 'Compare',
  triple: 'Triple',
  quad: 'Quad',
  focus: 'Focus',
};

/** Number of preview windows required by each view mode. */
export const VIEW_MODE_WINDOW_COUNT: Record<ViewMode, number> = {
  single: 1,
  dual: 2,
  triple: 3,
  quad: 4,
  focus: 3,
};

// ---------------------------------------------------------------------------
// Preview view (theme vs generator)
// ---------------------------------------------------------------------------

/** What the center stage is currently displaying — snapshot replica or palette generator. */
export type PreviewView = 'theme' | 'generator';

// ---------------------------------------------------------------------------
// Preview Window
// ---------------------------------------------------------------------------

export interface PreviewWindowState {
  /** Stable unique id (uuid or nanoid). */
  id: string;

  /** Agent being rendered in this window. */
  agentId: AgentId;

  /** Current zoom scale (0.25 – 2.0). */
  scale: number;

  /** Currently selected landmark index within this window's snapshot. */
  selectedLandmarkIdx: number | null;

  /** Whether inspect (element-picking) mode is active in this window. */
  inspectMode: boolean;
}

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------

export type DockTabId = 'fx' | 'export';

export interface DockState {
  open: boolean;
  height: number; // px, mutable via drag
  activeTab: DockTabId;
  collapsed: boolean; // true = tab-bar only (h = 32px)
}

export const DOCK_TABS: { id: DockTabId; label: string }[] = [
  { id: 'fx', label: 'FX' },
  { id: 'export', label: 'Export' },
];

export const DOCK_HEIGHT_MIN = 0;
export const DOCK_HEIGHT_MAX = 320;
export const DOCK_HEIGHT_DEFAULT = 260;
export const DOCK_HEIGHT_COLLAPSED = 32;

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export type InspectorTabId = 'landmarks' | 'computed' | 'cascade' | 'fingerprint' | 'profile';

export const INSPECTOR_TABS: { id: InspectorTabId; label: string }[] = [
  { id: 'landmarks', label: 'Landmarks' },
  { id: 'computed', label: 'Computed' },
  { id: 'cascade', label: 'Cascade' },
  { id: 'fingerprint', label: 'Fingerprint' },
  { id: 'profile', label: 'Profile' },
];

export interface InspectorState {
  open: boolean;
  width: number; // px, mutable via drag
  activeTab: InspectorTabId;
  collapsed: boolean;
}

export const INSPECTOR_WIDTH_MIN = 4;
export const INSPECTOR_WIDTH_MAX = 400;
export const INSPECTOR_WIDTH_DEFAULT = 240;

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export type DrawerSectionId = 'resources' | 'projects' | 'agents';

export interface DrawerState {
  open: boolean;
  width: number;
  collapsed: boolean; // true = 48px icon rail
}

export const DRAWER_WIDTH_MIN = 48;
export const DRAWER_WIDTH_MAX = 360;
export const DRAWER_WIDTH_DEFAULT = 200;

// ---------------------------------------------------------------------------
// Workspace layout (preset)
// ---------------------------------------------------------------------------

export type WorkspacePresetId = 'default' | 'compare' | 'multi' | 'focus' | 'export';

export interface WorkspaceLayout {
  presetId: WorkspacePresetId;
  name: string;
  viewMode: ViewMode;
  dockOpen: boolean;
  dockTab: DockTabId;
  drawerCollapsed: boolean;
  inspectorCollapsed: boolean;
}

export const WORKSPACE_PRESETS: WorkspaceLayout[] = [
  {
    presetId: 'default',
    name: 'Default',
    viewMode: 'single',
    dockOpen: true,
    dockTab: 'fx',
    drawerCollapsed: false,
    inspectorCollapsed: false,
  },
  {
    presetId: 'compare',
    name: 'Compare',
    viewMode: 'dual',
    dockOpen: true,
    dockTab: 'fx',
    drawerCollapsed: false,
    inspectorCollapsed: false,
  },
  {
    presetId: 'multi',
    name: 'Multi-Agent',
    viewMode: 'triple',
    dockOpen: true,
    dockTab: 'fx',
    drawerCollapsed: true,
    inspectorCollapsed: false,
  },
  {
    presetId: 'focus',
    name: 'Focus',
    viewMode: 'focus',
    dockOpen: false,
    dockTab: 'fx',
    drawerCollapsed: true,
    inspectorCollapsed: true,
  },
  {
    presetId: 'export',
    name: 'Export Ready',
    viewMode: 'single',
    dockOpen: true,
    dockTab: 'export',
    drawerCollapsed: false,
    inspectorCollapsed: false,
  },
];

// ---------------------------------------------------------------------------
// messageBus: postMessage protocol between iframe windows
// ---------------------------------------------------------------------------

export type WsMessage =
  | { type: 'STYLE_VAR'; key: string; value: string }
  | { type: 'HIGHLIGHT'; selector: string }
  | { type: 'PICK_MODE'; enabled: boolean }
  | { type: 'SCROLL_SYNC'; selector: string }
  | { type: 'READY' }; // iframe announces it's listening

// ---------------------------------------------------------------------------
// Dock slider / select / toggle config
// ---------------------------------------------------------------------------

export interface DockSliderConfig {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** When true the override for this key is active (drives reset button visibility). */
  isOverridden: boolean;
}

export interface DockSelectConfig {
  id: string;
  label: string;
  value: string;
  options: { label: string; value: string }[];
  isOverridden: boolean;
}

export interface DockToggleConfig {
  id: string;
  label: string;
  checked: boolean;
  isOverridden: boolean;
}

export interface DockColorRowConfig {
  id: string;
  label: string;
  value: string; // hex
  isOverridden: boolean;
}

export interface DockTextConfig {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  isOverridden: boolean;
}

export type DockControlConfig =
  | DockSliderConfig
  | DockSelectConfig
  | DockToggleConfig
  | DockColorRowConfig
  | DockTextConfig;
