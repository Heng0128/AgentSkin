// SPDX-License-Identifier: MPL-2.0

/**
 * Theme color-contract guard.
 *
 * The 14-token theme contract is the single source of truth for which semantic
 * color keys a theme must declare. Previously this contract existed only as:
 *   - an offline CI script (`scripts/check-themes.mjs`)
 *   - a runtime `COLOR_KEYS` constant inside `theme-asset/ir/normalize.ts`
 *   - the authoritative `manifest-v2.schema.json` (which only *requires*
 *     `background` + `foreground`, leaving 12 tokens optional)
 *
 * That left a gap: a theme could be installed/applied with missing or
 * malformed tokens and only fail at render time (undefined `--agentskin-*`
 * CSS variables). This module is the **additive, runtime-safe** guard — a pure
 * validator plus the canonical key set — so the contract gap becomes
 * observable at install time without changing the (breaking) schema.
 *
 * It deliberately does NOT throw: callers decide how strict to be. The
 * existing schema stays the authoritative (breaking) contract and is out of
 * scope for this additive change.
 */

/**
 * Canonical 14 semantic color tokens every theme is expected to declare.
 *
 * Kept identical to `COLOR_KEYS` in `theme-asset/ir/normalize.ts` so the two
 * never drift. If the contract grows, update BOTH (or better, have normalize
 * re-export this list — left as a future refactor to avoid a cross-import
 * coupling in the IR layer).
 */
export const THEME_COLOR_KEYS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'muted',
  'surface',
  'surfaceElevated',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** Result of validating a theme's color map against the 14-token contract. */
export interface ThemeColorContractResult {
  /** Canonical tokens that are absent from the color map. */
  missing: string[];
  /** Canonical tokens present but whose value is not a valid color. */
  invalid: string[];
  /** Keys present that are NOT part of the canonical 14-token set. */
  unknown: string[];
}

/**
 * Accept the same loose color formats the rest of the pipeline accepts:
 * `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`, `rgb()` / `rgba()`, `hsl()` /
 * `hsla()`.
 */
function isValidColor(value: string): boolean {
  return (
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    /^rgba?\([^)]*\)$/.test(value) ||
    /^hsla?\([^)]*\)$/.test(value)
  );
}

/**
 * Validate a theme color map against the 14-token contract.
 *
 * Pure — performs no I/O and never throws. Callers use the result to emit a
 * warning (or, in a stricter future mode, reject the theme). Designed to be
 * callable at install time (`resolveColorSchemes`) and test time.
 *
 * @param colors A theme's color map (semantic key → color string). Accepts
 *   `Record<string, string>` so it works with both manifest colors and
 *   per-scheme color maps.
 */
export function validateThemeColors(colors: Record<string, string>): ThemeColorContractResult {
  const result: ThemeColorContractResult = { missing: [], invalid: [], unknown: [] };
  const known = new Set<string>(THEME_COLOR_KEYS);

  // Present keys: classify as invalid (bad format) or unknown (not canonical).
  for (const [key, value] of Object.entries(colors)) {
    if (!known.has(key)) {
      result.unknown.push(key);
      continue;
    }
    if (typeof value !== 'string' || !isValidColor(value)) {
      result.invalid.push(key);
    }
  }

  // Canonical keys that are absent.
  for (const key of THEME_COLOR_KEYS) {
    if (!(key in colors)) {
      result.missing.push(key);
    }
  }

  return result;
}

/** Convenience: does the color map satisfy the full 14-token contract? */
export function isThemeColorsComplete(colors: Record<string, string>): boolean {
  const r = validateThemeColors(colors);
  return r.missing.length === 0 && r.invalid.length === 0 && r.unknown.length === 0;
}
