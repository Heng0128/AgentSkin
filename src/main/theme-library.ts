// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-library.ts — Backward-Compatibility Barrel
 *
 * This file re-exports the public API from the split modules under
 * `src/main/theme/`. Existing imports like
 * `import { ThemeLibrary, toInstalledTheme, inferModeFromColors, THEME_SCHEME, themeCoverUrl, themeIconUrl } from './theme-library'`
 * continue to work without changes.
 *
 * The actual implementation now lives in:
 *  - `theme/scheme.ts` — protocol scheme constants & URL builders
 *  - `theme/utils.ts` — data transformation utilities, color/mode inference, cover/icon cache, toInstalledTheme
 *  - `theme/store.ts` — ThemeLibrary class (CRUD over .agentskin-theme files + legacy migration)
 *
 * ## Why a barrel instead of deleting the file?
 *
 * `boot-sequence.ts` imports `ThemeLibrary` from `./theme-library`,
 * `agent-engine-service.ts` imports `inferModeFromColors` / `toInstalledTheme` / `ThemeEntry`,
 * `wallpaper-injector.ts` imports `ThemeEntry` (type),
 * and test files import `inferModeFromColors` / `ThemeLibrary` / `toInstalledTheme`.
 * The barrel avoids touching every consumer while the actual logic is cleanly
 * split into single-responsibility modules.
 */

export type { PackageInspection, ThemeEntry } from './services/contracts';
export { THEME_SCHEME, themeCoverUrl, themeIconUrl } from './theme/scheme';
export { ThemeLibrary } from './theme/store';
export { inferModeFromColors, toInstalledTheme } from './theme/utils';
