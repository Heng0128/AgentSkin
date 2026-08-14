// SPDX-License-Identifier: MPL-2.0

/**
 * # workspace-presets
 *
 * Canonical workspace preset definitions. Each preset seeds the workspace
 * with a specific view mode and optional dock / inspector / drawer
 * configuration overrides.
 *
 * Consumed by workspaceStore.applyPreset().
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

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  { id: 'default', label: 'Default', viewMode: 'single' },
  { id: 'compare', label: 'Compare', viewMode: 'dual' },
  { id: 'multi-agent', label: 'Multi-Agent', viewMode: 'triple' },
  { id: 'generator', label: 'Generator', viewMode: 'quad' },
  { id: 'focus', label: 'Focus (PR)', viewMode: 'focus' },
];
