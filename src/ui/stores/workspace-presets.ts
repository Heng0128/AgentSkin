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
 * Preset identifier. Currently only 'default' exists as Studio is
 * single-window only. Retained for backward compatibility.
 */
export type WorkspacePresetId = 'default';

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  { id: 'default', label: 'Default', viewMode: 'single' },
  { id: 'compare', label: 'Compare', viewMode: 'single' },
  { id: 'multi-agent', label: 'Multi-Agent', viewMode: 'single' },
  { id: 'generator', label: 'Generator', viewMode: 'single' },
  { id: 'focus', label: 'Focus (PR)', viewMode: 'single' },
];
