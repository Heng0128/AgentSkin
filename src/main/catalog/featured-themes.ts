// SPDX-License-Identifier: MPL-2.0

/**
 * # Featured Themes — dynamic catalog curation
 *
 * Provides featured-theme filtering and sorting for the theme catalog.
 * Themes can be marked as featured in two ways:
 *
 * 1. **Manifest-level**: Set `featured: true` in the theme's `manifest.json`.
 * 2. **Config-level**: List theme IDs in an external `featured-themes.json`
 *    file, allowing curation without modifying theme manifests or app updates.
 *
 * This dual-source approach is inspired by LingGlow's `catalog/v1/index.json`
 * featured metadata — it decouples recommendation curation from theme packages
 * and application releases.
 *
 * ## Config file format
 *
 * ```json
 * {
 *   "featured": ["theme-id-1", "theme-id-2"],
 *   "updatedAt": "2026-01-15T10:30:00Z"
 * }
 * ```
 */

import { readFile } from 'node:fs/promises';
import type { ThemeManifest } from './theme-manifest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the external featured-themes.json config file.
 */
export interface FeaturedThemesConfig {
  /** Theme IDs that should be featured. */
  featured: string[];
  /** ISO 8601 timestamp of when the list was last updated. */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------

/**
 * Filter themes marked as featured in their manifest, sorted by priority
 * (descending) then by name (ascending).
 *
 * @param allThemes  Array of all theme manifests
 * @returns Featured themes, sorted for display
 */
export function getFeaturedThemes(allThemes: ThemeManifest[]): ThemeManifest[] {
  return allThemes
    .filter((theme) => theme.featured === true)
    .sort((a, b) => {
      // Higher priority first
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      // Alphabetical by name as tiebreaker
      return a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load the featured themes list from an external JSON config file.
 *
 * Returns an empty array if the file does not exist or contains malformed
 * JSON — callers can safely fall back to manifest-level featured flags.
 *
 * @param configPath  Absolute or relative path to the config file
 * @returns Array of theme IDs listed as featured
 */
export async function loadFeaturedList(configPath: string): Promise<string[]> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isFeaturedConfig(parsed)) {
      return [];
    }
    return parsed.featured;
  } catch {
    // File not found, permission error, or malformed JSON — graceful fallback
    return [];
  }
}

// ---------------------------------------------------------------------------
// Combined application
// ---------------------------------------------------------------------------

/**
 * Apply both manifest-level and config-level featured markers to produce
 * the final sorted list of featured themes.
 *
 * A theme is featured if EITHER:
 * - Its manifest has `featured: true`, OR
 * - Its ID appears in the config file's `featured` array
 *
 * Config-listed themes that are not installed are silently skipped.
 * The result is sorted by priority (desc), then name (asc).
 *
 * @param themes      All installed theme manifests
 * @param configPath  Path to the featured-themes.json config file
 * @returns Sorted array of featured themes
 */
export async function applyFeaturedConfig(
  themes: ThemeManifest[],
  configPath: string,
): Promise<ThemeManifest[]> {
  const configIds = new Set(await loadFeaturedList(configPath));

  return themes
    .filter((theme) => theme.featured === true || configIds.has(theme.id))
    .sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.name.localeCompare(b.name);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Type guard for the FeaturedThemesConfig shape.
 */
function isFeaturedConfig(value: unknown): value is FeaturedThemesConfig {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.featured)) return false;
  // Ensure every entry is a string
  if (!obj.featured.every((id) => typeof id === 'string')) return false;
  if (obj.updatedAt !== undefined && typeof obj.updatedAt !== 'string') return false;
  return true;
}
