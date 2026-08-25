// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { AppRegistryEntry, ThemeManifestWithApps } from './theme-compatibility';
import {
  DEFAULT_COMPATIBLE,
  DEFAULT_LAYOUT,
  LAYOUT_VARIABLES,
  ThemeCompatibilityChecker,
} from './theme-compatibility';

const REGISTRY: Record<string, AppRegistryEntry> = {
  traework: { id: 'traework', name: 'TRAE Work', acceptsGenericThemes: true },
  qoderwork: { id: 'qoderwork', name: 'QoderWork', acceptsGenericThemes: false },
  workbuddy: { id: 'workbuddy', name: 'WorkBuddy', acceptsGenericThemes: true },
};

function baseManifest(): ThemeManifestWithApps {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    author: null,
    description: null,
    supportedAgents: [],
    preview: null,
  };
}

describe('ThemeCompatibilityChecker', () => {
  const checker = new ThemeCompatibilityChecker(REGISTRY);

  it('returns compatible when manifest declares compat=true', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { traework: { compat: true } },
    };
    const result = checker.checkCompatibility(manifest, 'traework');
    expect(result.compatible).toBe(true);
    expect(result.source).toBe('manifest');
  });

  it('returns incompatible when manifest declares compat=false', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { workbuddy: { compat: false } },
    };
    const result = checker.checkCompatibility(manifest, 'workbuddy');
    expect(result.compatible).toBe(false);
    expect(result.source).toBe('manifest');
  });

  it('falls back to registry acceptsGenericThemes=true when manifest has no override', () => {
    const result = checker.checkCompatibility(baseManifest(), 'traework');
    expect(result.compatible).toBe(true);
    expect(result.source).toBe('registry');
  });

  it('falls back to registry acceptsGenericThemes=false when manifest has no override', () => {
    const result = checker.checkCompatibility(baseManifest(), 'qoderwork');
    expect(result.compatible).toBe(false);
    expect(result.source).toBe('registry');
  });

  it('uses global default when app is absent from both manifest and registry', () => {
    const result = checker.checkCompatibility(baseManifest(), 'unknown-app');
    expect(result.compatible).toBe(DEFAULT_COMPATIBLE);
    expect(result.source).toBe('default');
    expect(result.layout).toBe(DEFAULT_LAYOUT);
  });

  it('applies compact layout from manifest', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { traework: { compat: true, layout: 'compact' } },
    };
    const result = checker.checkCompatibility(manifest, 'traework');
    expect(result.layout).toBe('compact');
  });

  it('applies minimal layout from manifest', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { workbuddy: { layout: 'minimal' } },
    };
    const result = checker.checkCompatibility(manifest, 'workbuddy');
    expect(result.layout).toBe('minimal');
  });

  it('defaults to "default" layout when not specified', () => {
    const result = checker.checkCompatibility(baseManifest(), 'traework');
    expect(result.layout).toBe('default');
  });

  it('performs batch compatibility check', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { traework: { compat: false } },
    };
    const results = checker.checkBatchCompatibility(manifest, [
      'traework',
      'qoderwork',
      'workbuddy',
    ]);
    expect(results.traework.compatible).toBe(false);
    expect(results.traework.source).toBe('manifest');
    expect(results.qoderwork.compatible).toBe(false);
    expect(results.qoderwork.source).toBe('registry');
    expect(results.workbuddy.compatible).toBe(true);
    expect(results.workbuddy.source).toBe('registry');
  });

  it('filters compatible apps', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { traework: { compat: false } },
    };
    const compatible = checker.getCompatibleApps(manifest, ['traework', 'workbuddy']);
    expect(compatible).toEqual(['workbuddy']);
  });

  it('filters incompatible apps', () => {
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { workbuddy: { compat: false } },
    };
    const incompatible = checker.getIncompatibleApps(manifest, [
      'traework',
      'workbuddy',
      'qoderwork',
    ]);
    expect(incompatible).toContain('workbuddy');
    expect(incompatible).toContain('qoderwork');
    expect(incompatible).not.toContain('traework');
  });

  it('handles empty manifest apps object', () => {
    const manifest: ThemeManifestWithApps = { ...baseManifest(), apps: {} };
    const result = checker.checkCompatibility(manifest, 'traework');
    expect(result.source).toBe('registry');
    expect(result.compatible).toBe(true);
  });

  it('handles manifest with no apps field at all', () => {
    const manifest = baseManifest();
    expect(manifest.apps).toBeUndefined();
    const result = checker.checkCompatibility(manifest, 'workbuddy');
    expect(result.compatible).toBe(true);
    expect(result.source).toBe('registry');
  });

  it('returns correct CSS variable overrides per layout', () => {
    expect(checker.getLayoutVariables('default')).toEqual(LAYOUT_VARIABLES.default);
    expect(checker.getLayoutVariables('compact')).toEqual(LAYOUT_VARIABLES.compact);
    expect(checker.getLayoutVariables('minimal')).toEqual(LAYOUT_VARIABLES.minimal);
  });

  it('manifest compat override takes precedence over registry', () => {
    // qoderwork registry says false, but manifest says true
    const manifest: ThemeManifestWithApps = {
      ...baseManifest(),
      apps: { qoderwork: { compat: true } },
    };
    const result = checker.checkCompatibility(manifest, 'qoderwork');
    expect(result.compatible).toBe(true);
    expect(result.source).toBe('manifest');
  });
});
