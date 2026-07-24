// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeSeeder (P3.1)
 *
 * Bridges directory-based built-in themes (themes/<id>/) into the
 * ThemeLibrary so they appear in the catalog and UI immediately on boot.
 *
 * Flow:
 *   themes/cyber-neon/manifest.json → ThemePackageLoader.scan() →
 *   ThemeInstaller.installAll() → ThemeLibrary (via installFile) →
 *   ThemeCatalog.listThemes() → UI display
 *
 * This is a one-time seed during app startup. Once themes are installed
 * into the library, the normal ThemeLibrary lifecycle handles them.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { ThemeLibraryApi } from '../services/contracts';
import type { InstalledTheme } from '../../shared/types';
import { ThemePackageLoader } from './theme-package-loader';
import { ThemeInstaller, computeThemeContentHash } from './theme-installer';

/**
 * Seed built-in themes from the themes/ directory into the ThemeLibrary.
 *
 * `installedSnapshots` maps theme id → { version, contentHash } currently
 * persisted in the library. A shipped package is (re)installed when:
 *   - its id is not installed yet, or
 *   - its manifest version differs from the persisted copy, or
 *   - its CSS content hash differs (catches fixes shipped without a bump).
 *
 * Version + content-hash reseeding is what delivers fixed built-in themes
 * (e.g. white-island CSS overrides) to existing users, since the library
 * persists in userData across upgrades. The content hash ensures changes
 * are never silently dropped even if the manifest version was not bumped.
 */
export async function seedBuiltInThemes(
  library: ThemeLibraryApi,
  themesDir: string,
  installedSnapshots: Map<string, { version: string; contentHash?: string }>,
): Promise<InstalledTheme[]> {
  const loader = new ThemePackageLoader(themesDir);
  const installer = new ThemeInstaller(library);

  // Scan all theme packages in the directory
  const packages = await loader.scan();

  // Install new packages and refresh outdated built-in copies.
  // A theme needs reseed if version differs OR contentHash differs.
  const toInstall: typeof packages = [];
  for (const pkg of packages) {
    const snapshot = installedSnapshots.get(pkg.manifest.id);
    if (!snapshot) {
      toInstall.push(pkg); // not installed yet
      continue;
    }
    if (snapshot.version !== pkg.manifest.version) {
      toInstall.push(pkg); // version changed
      continue;
    }
    // contentHash check: if the installed copy has no hash (legacy), reseed
    // to populate it; otherwise compare against the new package's hash.
    if (snapshot.contentHash === undefined) {
      toInstall.push(pkg);
      continue;
    }
    const newHash = await computeThemeContentHash(pkg.manifest, pkg.packagePath);
    if (newHash !== snapshot.contentHash) {
      toInstall.push(pkg); // CSS content changed without version bump
    }
  }

  if (toInstall.length === 0) {
    return [];
  }

  // Install each package through the library
  return installer.installAll(toInstall);
}

/**
 * Built-in themes that were removed from the shipped bundle.
 *
 * The ThemeLibrary persists in userData, which the installer does not wipe,
 * so copies of these themes installed by an older version survive an upgrade.
 * Pruning them on boot keeps the catalog in sync with the themes we ship.
 */
export const REMOVED_BUILTIN_THEME_IDS = [
  'arctic-white', 'cyber-neon', 'sakura',
  // Terminal color themes removed in v2.2 (replaced by IP-specific anime themes)
  'blue', 'yellow', 'purple', 'red', 'pink', 'green',
  // IP themes removed in v2.2 (consolidation: arina was the only auto-mode
  // theme with no light/dark pair; miku-light overlapped with other light anime)
  'arina-hashimoto', 'miku-light',
];

/**
 * Delete any removed built-in themes that are still present in the library.
 * `installedIds` is the set of theme ids present before seeding.
 */
export async function pruneRemovedBuiltInThemes(
  library: ThemeLibraryApi,
  installedIds: Set<string>,
): Promise<void> {
  for (const id of REMOVED_BUILTIN_THEME_IDS) {
    if (installedIds.has(id)) {
      await library.delete(id);
    }
  }
}

/**
 * Get the built-in themes directory path.
 *
 * The `themes/<id>/` packages ship inside the app bundle:
 *   - dev:        <projectRoot>/themes
 *   - packaged:   <resources>/app.asar/themes   (asar-readable via fs patch)
 *
 * We resolve from `app.getAppPath()`, which points at the project root in dev
 * and at `app.asar` when packaged, so the same path works in both modes. A few
 * fallback candidates keep the seed working if packaging ever relocates them.
 */
export function getThemesDir(): string {
  const candidates = [
    path.join(app.getAppPath(), 'themes'),
    path.join(process.resourcesPath, 'app.asar', 'themes'),
    path.join(process.resourcesPath, 'themes'),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Try next candidate
    }
  }

  // Fallback: use the canonical (app-bundle) path. The seed will simply find
  // nothing to install if the bundle is misconfigured, rather than crashing.
  return candidates[0];
}
