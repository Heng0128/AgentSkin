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

import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { InstalledTheme } from '../../shared/types';
import type { ThemeLibraryApi } from '../services/contracts';
import { computeThemeContentHash, ThemeInstaller } from './theme-installer';
import { ThemePackageLoader } from './theme-package-loader';

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

  // Scan all theme packages in the directory.
  // Filter out themes in REMOVED_BUILTIN_THEME_IDS: their directories can
  // still be present in the bundle (older builds shipped them, or they linger
  // in a dev working tree) even though they are no longer part of the shipped
  // set. Without this filter, seedBuiltInThemes would RE-INSTALL every removed
  // theme on every boot — and because pruning runs after seeding, the prune
  // would have nothing to remove. The catalog then regrows to the full old set
  // (e.g. 77 themes) instead of staying at the single kept theme. Filtering
  // here means the seeder only ever (re)installs themes we actually ship.
  const removedIds = new Set(REMOVED_BUILTIN_THEME_IDS);
  const packages = (await loader.scan()).filter((pkg) => !removedIds.has(pkg.manifest.id));

  // Phase 1: Quick filter — separate packages that definitely need install
  // (missing, version-changed, or no contentHash) from those that need a
  // hash comparison. This is pure Map lookups, no I/O.
  const toInstall: typeof packages = [];
  const needsHashCheck: { pkg: (typeof packages)[0]; expectedHash: string }[] = [];

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
    needsHashCheck.push({ pkg, expectedHash: snapshot.contentHash });
  }

  // Phase 2: Compute content hashes in parallel — reading CSS files for each
  // theme is I/O-bound, so parallelizing eliminates the sequential wait when
  // many themes have matching versions (the common case after initial install).
  if (needsHashCheck.length > 0) {
    const hashes = await Promise.all(
      needsHashCheck.map(({ pkg }) => computeThemeContentHash(pkg.manifest, pkg.packagePath)),
    );
    for (let i = 0; i < needsHashCheck.length; i++) {
      if (hashes[i] !== needsHashCheck[i].expectedHash) {
        toInstall.push(needsHashCheck[i].pkg); // CSS content changed without version bump
      }
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
  'arctic-white',
  'cyber-neon',
  'sakura',
  // Terminal color themes removed in v2.2 (replaced by IP-specific anime themes)
  'blue',
  'yellow',
  'purple',
  'red',
  'pink',
  'green',
  // IP themes removed in v2.2 (consolidation: arina was the only auto-mode
  // theme with no light/dark pair; miku-light overlapped with other light anime)
  'arina-hashimoto',
  'miku-light',
  // All built-in themes removed in favor of a single bundled theme
  // (naruto-tobi, 火影 · 带土). The ThemeLibrary persists in userData, so
  // copies installed by an older version must be pruned on boot.
  'arctic-rose',
  'attack-on-titan',
  'autumn-harvest',
  'bioshock-infinite',
  'bleach-ichigo',
  'catppuccin-mocha',
  'chainsaw-man',
  'cherry-blossom',
  'corporate-blue',
  'cowboy-bebop',
  'crimson-tide',
  'cyberpunk-2077',
  'cyberpunk-neon',
  'dark-souls',
  'death-note',
  'deep-ocean',
  'deepspace-dawn',
  'deepspace-star',
  'demon-slayer',
  'digital-lavender',
  'dracula-pro',
  'dragonball-goku',
  'earth-sage',
  'elden-ring',
  'emerald-dream',
  'evangelion',
  'everforest',
  'final-fantasy',
  'frieren-snow',
  'fullmetal-alchemist',
  'gear5-rising',
  'genshin-dawn',
  'genshin-night',
  'genshin-raiden',
  'god-of-war',
  'golden-hour',
  'gothic-void-crusade',
  'gruvbox-warm',
  'hades-realm',
  'hatsune-miku',
  'hollow-knight',
  'hunter-hunter',
  'ice-blue',
  'ink-wash',
  'jujutsu-gojo',
  'kanagawa',
  'kitsune-pink',
  'league-of-legends',
  'manga-sketch',
  'mass-effect-n7',
  'midnight-aurora',
  'minecraft-blocks',
  'minimal-light',
  'monokai-pro',
  'my-hero-academia',
  'naruto-hokage',
  'naruto-itachi',
  'naruto-sasuke',
  'night-owl',
  'nord-aurora',
  'one-dark-pro',
  'one-punch-man',
  'onepiece-zoro',
  'overwatch-hero',
  'pastel-dream',
  'persona5',
  'poimandres',
  'pokemon-pikachu',
  'portal-science',
  'rose-pine',
  'royal-purple',
  'sailor-moon',
  'shadow-dragon',
  'sleepy-cloud',
  'solar-forge',
  'solarized-dark',
  'spy-family',
  'stardew-valley',
  'steampunk-brass',
  'studio-ghibli',
  'summer-breeze',
  'sunset-glow',
  'sword-art-online',
  'synthwave-84',
  'terminal-green',
  'the-witcher',
  'tokyo-night',
  'valorant-agent',
  'vaporwave',
  'winter-frost',
  'wuthering-echo',
  'wuthering-tide',
  'zelda-breath',
  // The single legacy bundled theme (naruto-tobi, 火影 · 带土) was replaced
  // by the v2.3 built-in set (nordic-minimal / deepspace-nebula /
  // sakura-pastel). Prune copies installed by older versions on upgrade.
  'naruto-tobi',
  // v2.4 portfolio reset: the entire 15-theme built-in set was removed in
  // favor of a re-planned promotion-style taxonomy (docs/theme-category-plan.md).
  // Their theme packages are deleted from themes/; registering the ids here
  // prunes any copies lingering in per-user ThemeLibrary on upgrade.
  'amber-dusk',
  'aurora-violet',
  'bamboo-mist',
  'cyber-rose',
  'deepspace-nebula',
  'forest-pine',
  'glacier-white',
  'graphite-code',
  'midnight-jazz',
  'nordic-minimal',
  'ocean-tide',
  'rose-quartz',
  'sakura-noir',
  'sakura-pastel',
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
