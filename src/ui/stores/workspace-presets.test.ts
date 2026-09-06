// SPDX-License-Identifier: MPL-2.0

/**
 * # workspace-presets tests
 *
 * Validates that the five workspace presets are behaviourally distinct
 * and conform to the contracts expected by WorkspaceSwitcher and
 * workspaceStore.applyPreset().
 */

import { WORKSPACE_PRESETS, type WorkspacePreset } from '@/stores/workspace-presets';

import { describe, expect, it } from 'vitest';

describe('workspace presets', () => {
  it('contains exactly 5 presets', () => {
    expect(WORKSPACE_PRESETS).toHaveLength(5);
  });

  it('every preset has a unique id', () => {
    const ids = WORKSPACE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has a unique label', () => {
    const labels = WORKSPACE_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("all presets use viewMode 'single'", () => {
    for (const p of WORKSPACE_PRESETS) {
      expect(p.viewMode).toBe('single');
    }
  });

  it('all 5 presets have distinct dock/inspector/drawer configurations', () => {
    const signatures = WORKSPACE_PRESETS.map((p) =>
      JSON.stringify({
        dockOpen: p.dock?.open,
        dockHeight: p.dock?.height,
        inspectorCollapsed: p.inspector?.collapsed,
        inspectorWidth: p.inspector?.width,
        drawerCollapsed: p.drawer?.collapsed,
        drawerWidth: p.drawer?.width,
      }),
    );
    expect(new Set(signatures).size).toBe(5);
  });

  describe('default preset', () => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === 'default') as WorkspacePreset;

    it('opens dock and drawer', () => {
      expect(preset.dock?.open).toBe(true);
      expect(preset.drawer?.collapsed).toBe(false);
    });

    it('collapses inspector', () => {
      expect(preset.inspector?.collapsed).toBe(true);
    });
  });

  describe('focus preset', () => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === 'focus') as WorkspacePreset;

    it('collapses everything', () => {
      expect(preset.dock?.open).toBe(false);
      expect(preset.inspector?.collapsed).toBe(true);
      expect(preset.drawer?.collapsed).toBe(true);
    });

    it('sets all widths to zero', () => {
      expect(preset.dock?.height).toBe(0);
      expect(preset.inspector?.width).toBe(0);
      expect(preset.drawer?.width).toBe(0);
    });
  });

  describe('generator preset', () => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === 'generator') as WorkspacePreset;

    it('opens inspector and drawer with wide widths', () => {
      expect(preset.inspector?.collapsed).toBe(false);
      expect(preset.drawer?.collapsed).toBe(false);
      expect(preset.inspector?.width).toBeGreaterThan(300);
      expect(preset.drawer?.width).toBeGreaterThan(300);
    });

    it('closes dock', () => {
      expect(preset.dock?.open).toBe(false);
    });
  });

  describe('compare preset', () => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === 'compare') as WorkspacePreset;

    it('opens all three panels', () => {
      expect(preset.dock?.open).toBe(true);
      expect(preset.inspector?.collapsed).toBe(false);
      expect(preset.drawer?.collapsed).toBe(false);
    });
  });

  describe('multi-agent preset', () => {
    const preset = WORKSPACE_PRESETS.find((p) => p.id === 'multi-agent') as WorkspacePreset;

    it('opens dock and inspector but collapses drawer', () => {
      expect(preset.dock?.open).toBe(true);
      expect(preset.inspector?.collapsed).toBe(false);
      expect(preset.drawer?.collapsed).toBe(true);
    });
  });
});
