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
 * Canonical 13 manifest color keys every theme must declare.
 *
 * These are the semantic keys that a theme's `manifest.colors` must provide.
 * The 14th CSS token (`selection`) is derived from `accent` via `color-mix`
 * at CSS generation time, so it is NOT declared in the manifest.
 *
 * This is the single source of truth for the 14-token contract. Other modules
 * (normalize.ts, theme-utils.mjs, community-color-bridge.ts) should align
 * with this list.
 */
export const MANIFEST_COLOR_KEYS = [
  'background',
  'surface',
  'surfaceElevated',
  'foreground',
  'muted',
  'accent',
  'secondary',
  'border',
  'codeBackground',
  'codeForeground',
  'focusRing',
  'buttonBackground',
  'inputBackground',
] as const;

/**
 * The 14th CSS token — derived from accent via color-mix at CSS generation.
 * Not declared in the manifest.
 */
export const DERIVED_CSS_TOKENS = ['selection'] as const;

/**
 * Color keys that `manifest-v2.schema.json` explicitly permits in
 * `colors`, but which fall OUTSIDE the 14-token contract.
 *
 * `validateThemeColors` is deliberately strict — it only accepts
 * {@link MANIFEST_COLOR_KEYS} and reports everything else as `unknown`
 * (that behaviour is pinned by its unit tests). That strictness is correct
 * for the validator, but wrong at the *call site*: a schema-legal key such
 * as `buttonForeground` is not a defect, so reporting it as a contract
 * violation is a false positive.
 *
 * Callers that surface `unknown` to humans must filter this set out first.
 *
 * Mirrors `colors.properties` in `src/main/catalog/manifest-v2.schema.json`.
 * Object-valued schema properties (`extended`, `_wcag`) are intentionally
 * excluded — they are not colors.
 *
 * TODO(RFC): `buttonForeground` is a first-class token everywhere else
 * (schema, types, generators, `--agentskin-button-fg`, WCAG check W7 in
 * THEME_SPEC.md). Promoting it into the 14-token contract changes the core
 * data model and therefore requires an RFC per AGENTS.md §8.
 */
export const SCHEMA_ALLOWED_NON_CONTRACT_COLOR_KEYS = [
  'primary', // v1 compat alias for accent
  'text', // v1 compat alias for foreground
  'buttonForeground',
  'selection', // derived at CSS generation time
] as const;

/**
 * All 14 CSS tokens (13 manifest + 1 derived).
 *
 * @deprecated Use MANIFEST_COLOR_KEYS for manifest validation, or
 *   DERIVED_CSS_TOKENS for the derived set. This constant exists for
 *   backward compatibility with CSS-level checks.
 */
export const THEME_COLOR_KEYS = [...MANIFEST_COLOR_KEYS, ...DERIVED_CSS_TOKENS] as const;

export type ManifestColorKey = (typeof MANIFEST_COLOR_KEYS)[number];
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
 * Validate a theme's manifest colors against the 13-key contract.
 *
 * Pure — performs no I/O and never throws. Callers use the result to emit a
 * warning (or, in a stricter future mode, reject the theme). Designed to be
 * callable at install time (`resolveColorSchemes`) and test time.
 *
 * Only validates the 13 manifest keys. The 14th token (`selection`) is
 * derived from `accent` at CSS generation time and is NOT expected in the
 * manifest, so it is not checked here.
 *
 * @param colors A theme's manifest color map (semantic key → color string).
 */
export function validateThemeColors(colors: Record<string, string>): ThemeColorContractResult {
  const result: ThemeColorContractResult = { missing: [], invalid: [], unknown: [] };
  const known = new Set<string>(MANIFEST_COLOR_KEYS);

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
  for (const key of MANIFEST_COLOR_KEYS) {
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
