// SPDX-License-Identifier: MPL-2.0

/**
 * # workspace-presets
 *
 * Canonical workspace preset definitions — single source of truth for
 * WORKSPACE_PRESETS, WorkspacePreset, and WorkspacePresetId types.
 *
 * Each preset seeds the workspace with a specific view mode and optional
 * dock / inspector / drawer configuration overrides.
 *
 * Consumed by workspaceStore.applyPreset() and WorkspaceSwitcher.
 *
 * Note: Studio is now single-window only, so viewMode is always 'single'.
 */

import type { DockState, DrawerState, InspectorState, ViewMode } from '@/types/workspace';

export interface WorkspacePreset {
  id: string;
  label: string;
  viewMode: ViewMode;
  dock?: Partial<DockState>;
  inspector?: Partial<InspectorState>;
  drawer?: Partial<DrawerState>;
}

/**
 * Preset identifier. The five built-in presets cover the canonical
 * workspace layouts — each seeds dock / inspector / drawer differently.
 */
export type WorkspacePresetId = 'default' | 'compare' | 'multi-agent' | 'generator' | 'focus';

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  {
    id: 'default',
    label: 'Default',
    viewMode: 'single',
    dock: { open: true, height: 320 },
    inspector: { collapsed: true, width: 260 },
    drawer: { collapsed: false, width: 280 },
  },
  {
    id: 'compare',
    label: 'Compare',
    viewMode: 'single',
    dock: { open: true, height: 320 },
    inspector: { collapsed: false, width: 300 },
    drawer: { collapsed: false, width: 300 },
  },
  {
    id: 'multi-agent',
    label: 'Multi-Agent',
    viewMode: 'single',
    dock: { open: true, height: 280 },
    inspector: { collapsed: false, width: 240 },
    drawer: { collapsed: true, width: 240 },
  },
  {
    id: 'generator',
    label: 'Generator',
    viewMode: 'single',
    dock: { open: false, height: 0 },
    inspector: { collapsed: false, width: 320 },
    drawer: { collapsed: false, width: 340 },
  },
  {
    id: 'focus',
    label: 'Focus',
    viewMode: 'single',
    dock: { open: false, height: 0 },
    inspector: { collapsed: true, width: 0 },
    drawer: { collapsed: true, width: 0 },
  },
];
