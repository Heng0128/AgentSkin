// SPDX-License-Identifier: MPL-2.0

/**
 * Theme identifier validation — single source of truth for the
 * "safe id" rule used by ThemeLibrary, ThemePackageLoader, and the engine.
 *
 * The rule: lowercase/uppercase ASCII alphanumeric, must start alphanumeric,
 * may contain `_` and `-` after the first character. No whitespace, no path
 * separators, no extension suffixes.
 *
 * The engine (src/engine/src/theme/*.mjs) keeps its own copy because engine
 * is a standalone .mjs artifact that cannot import from src/shared; this
 * module covers the AgentSkin application layer.
 */

export const SAFE_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/i;

/** Whether `id` matches the safe-theme-id rule. */
export function isSafeThemeId(id: string): boolean {
  return SAFE_ID_REGEX.test(id);
}
