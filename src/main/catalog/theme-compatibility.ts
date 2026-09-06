// SPDX-License-Identifier: MPL-2.0

/**
 * Theme compatibility resolver.
 *
 * Brings the dream-work-theme "registry default + manifest explicit override"
 * compatibility model into AgentSkin. The resolution cascade is:
 *
 *   manifest.apps[appId].compat  >  registry[appId].acceptsGenericThemes  >  true
 *
 * Pure functions + a registry-bound checker class. No I/O, no side effects.
 */

import type { ThemeManifest } from '../../shared/types/theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUPPORTED_LAYOUT_VARIANTS = ['default', 'compact', 'minimal'] as const;

export type LayoutVariant = (typeof SUPPORTED_LAYOUT_VARIANTS)[number];

export const DEFAULT_COMPATIBLE = true;
export const DEFAULT_LAYOUT: LayoutVariant = 'default';

/** CSS variable overrides per layout variant (applied on top of base theme). */
export const LAYOUT_VARIABLES: Record<LayoutVariant, Record<string, string>> = {
  default: {},
  compact: {
    '--agentskin-spacing-scale': '0.75',
    '--agentskin-radius-scale': '0.8',
  },
  minimal: {
    '--agentskin-spacing-scale': '0.5',
    '--agentskin-radius-scale': '0',
    '--agentskin-decorative-opacity': '0',
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeAppCompatDeclaration {
  compat?: boolean;
  layout?: LayoutVariant;
}

/** ThemeManifest extended with optional per-app compatibility overrides. */
export interface ThemeManifestWithApps extends ThemeManifest {
  apps?: Record<string, ThemeAppCompatDeclaration>;
}

export interface CompatibilityResult {
  compatible: boolean;
  layout: LayoutVariant;
  source: 'manifest' | 'registry' | 'default';
}

export interface AppRegistryEntry {
  id: string;
  name: string;
  acceptsGenericThemes: boolean;
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export class ThemeCompatibilityChecker {
  constructor(private readonly registry: Record<string, AppRegistryEntry>) {}

  /**
   * Resolve compatibility for a single app.
   * Priority: manifest explicit > registry default > global default (true).
   */
  checkCompatibility(manifest: ThemeManifestWithApps, appId: string): CompatibilityResult {
    const appDecl = manifest.apps?.[appId];

    if (appDecl?.compat !== undefined) {
      return {
        compatible: appDecl.compat,
        layout: appDecl.layout ?? DEFAULT_LAYOUT,
        source: 'manifest',
      };
    }

    const registryEntry = this.registry[appId];
    if (registryEntry) {
      return {
        compatible: registryEntry.acceptsGenericThemes,
        layout: appDecl?.layout ?? DEFAULT_LAYOUT,
        source: 'registry',
      };
    }

    return {
      compatible: DEFAULT_COMPATIBLE,
      layout: appDecl?.layout ?? DEFAULT_LAYOUT,
      source: 'default',
    };
  }

  /** Check compatibility for a list of apps. */
  checkBatchCompatibility(
    manifest: ThemeManifestWithApps,
    appIds: string[],
  ): Record<string, CompatibilityResult> {
    const result: Record<string, CompatibilityResult> = {};
    for (const appId of appIds) {
      result[appId] = this.checkCompatibility(manifest, appId);
    }
    return result;
  }

  /** Filter appIds to only those that are compatible. */
  getCompatibleApps(manifest: ThemeManifestWithApps, appIds: string[]): string[] {
    return appIds.filter((appId) => this.checkCompatibility(manifest, appId).compatible);
  }

  /** Filter appIds to only those that are incompatible. */
  getIncompatibleApps(manifest: ThemeManifestWithApps, appIds: string[]): string[] {
    return appIds.filter((appId) => !this.checkCompatibility(manifest, appId).compatible);
  }

  /** Return CSS variable overrides for a given layout variant. */
  getLayoutVariables(layout: LayoutVariant): Record<string, string> {
    return LAYOUT_VARIABLES[layout] ?? LAYOUT_VARIABLES[DEFAULT_LAYOUT];
  }
}
