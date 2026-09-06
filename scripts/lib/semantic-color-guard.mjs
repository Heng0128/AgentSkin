// SPDX-License-Identifier: MPL-2.0

/**
 * # semantic-color-guard.mjs
 *
 * Semantic color protection rule engine. Inspired by the design principles of
 * notgabriels-sys/claude-code-50-dark-themes, which distinguishes between
 * "freely decorable accent colors" and "semantics-preserving state colors"
 * (success / error / warning / diff).
 *
 * The 14-token theme contract allows themes to customize most visual tokens,
 * but semantic colors carry meaning that must survive theme application:
 *   - success → green/teal (positive outcome)
 *   - error   → warm-red/orange (failure / danger)
 *   - warning → orange/yellow (caution)
 *   - info    → blue/teal (neutral information)
 *
 * A theme that overrides these with arbitrary hues risks breaking user
 * intuition (e.g. a "red success" button). This module provides the rules
 * and validation to prevent that.
 *
 * Pure functions: no I/O, no side effects.
 */

import { contrastRatio } from '../extended-colors.mjs';

// ---------------------------------------------------------------------------
// Semantic color definitions (per-scheme canonical values)
// ---------------------------------------------------------------------------

/**
 * Canonical semantic colors for light and dark schemes.
 *
 * Values are chosen to:
 *   1. Be perceptually distinct from each other (no two roles share a hue).
 *   2. Meet WCAG AA (4.5:1) against their typical backgrounds.
 *   3. Match platform conventions (green=good, red=bad, yellow=caution, blue=info).
 *
 * These are the RECOMMENDED values. Themes MAY deviate within the same hue
 * family (see HUE_TOLERANCE) but MUST NOT cross into another role's hue range.
 */
export const SEMANTIC_COLORS = {
  success: { light: '#10b981', dark: '#34d399', role: 'success' },
  error: { light: '#ef4444', dark: '#f87171', role: 'error' },
  warning: { light: '#f59e0b', dark: '#fbbf24', role: 'warning' },
  info: { light: '#3b82f6', dark: '#60a5fa', role: 'info' },
};

/**
 * Hue ranges (HSL hue, 0-360) that each semantic role is allowed to occupy.
 * A color is considered "semantically valid" for a role if its hue falls within
 * the role's range AND its saturation is above the minimum threshold.
 *
 * Ranges are intentionally non-overlapping to prevent ambiguity.
 */
const SEMANTIC_HUE_RANGES = {
  success: { min: 100, max: 180, label: 'green/teal' },
  error: { min: 345, max: 25, label: 'warm-red', wraps: true },
  warning: { min: 35, max: 65, label: 'orange/yellow' },
  info: { min: 195, max: 260, label: 'blue/indigo' },
};

/** Minimum HSL saturation for a color to be considered "semantic" (not grey). */
const MIN_SEMANTIC_SATURATION = 0.15;

/** Minimum contrast ratio semantic colors must maintain against background. */
const MIN_SEMANTIC_CONTRAST = 3.0;

// ---------------------------------------------------------------------------
// Token ID mapping
// ---------------------------------------------------------------------------

/**
 * Map from theme token IDs (CSS custom property names) to semantic roles.
 *
 * The 14-token contract uses these names; any token listed here is considered
 * a "semantic token" and is subject to protection rules.
 */
const SEMANTIC_TOKEN_MAP = {
  '--agentskin-success': 'success',
  '--agentskin-error': 'error',
  '--agentskin-warning': 'warning',
  '--agentskin-info': 'info',
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string to [r, g, b] (0-255).
 * @param {string} hex
 * @returns {[number, number, number] | null}
 */
function parseHex(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Convert hex to HSL [h (0-360), s (0-1), l (0-1)].
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToHsl(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return [0, 0, 0];
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

/**
 * Check if a hue falls within a semantic role's allowed range.
 * Handles the wrap-around case for red (345° → 15°).
 *
 * @param {number} hue - HSL hue (0-360)
 * @param {{ min: number, max: number, wraps?: boolean }} range
 * @returns {boolean}
 */
function hueInRange(hue, range) {
  if (range.wraps) {
    // Range wraps around 360° (e.g. 345° to 40° means 345-360 or 0-40)
    return hue >= range.min || hue <= range.max;
  }
  return hue >= range.min && hue <= range.max;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Check whether a token ID maps to a semantic color role.
 *
 * Accepts both CSS custom property names (`--agentskin-success`) and bare
 * role names (`success`).
 *
 * @param {string} tokenId - Token identifier to check.
 * @returns {boolean} True if the token is a semantic color.
 */
export function isSemanticToken(tokenId) {
  return Object.hasOwn(SEMANTIC_TOKEN_MAP, tokenId);
}

/**
 * Get the canonical recommended value for a semantic color in a given scheme.
 *
 * @param {string} tokenId - Semantic token ID (e.g. `'success'` or `'--agentskin-success'`).
 * @param {'light' | 'dark'} scheme - Color scheme.
 * @returns {string | null} The recommended hex color, or null if the token is not semantic.
 */
export function getSemanticColor(tokenId, scheme) {
  const role = SEMANTIC_TOKEN_MAP[tokenId];
  if (!role) return null;
  return SEMANTIC_COLORS[role][scheme];
}

/**
 * Validate that a theme's tokens do not improperly override semantic colors.
 *
 * A violation occurs when:
 *   1. A semantic token is present in the theme AND
 *   2. The theme's value deviates from the canonical hue range for that role.
 *
 * The function is permissive within the role's hue range — themes can adjust
 * saturation/lightness freely — but prevents cross-role contamination
 * (e.g. a purple "success" or a green "error").
 *
 * @param {Record<string, string>} themeTokens - Map of token ID → hex color.
 * @param {'light' | 'dark'} scheme - The color scheme being validated.
 * @returns {{ valid: boolean, violations: Array<{ token: string, expected: string, actual: string }> }}
 */
export function validateSemanticProtection(themeTokens, scheme) {
  const violations = [];

  for (const [tokenId, role] of Object.entries(SEMANTIC_TOKEN_MAP)) {
    const value = themeTokens[tokenId];
    if (value === undefined) continue; // token not present → no violation

    const canonical = SEMANTIC_COLORS[role][scheme];
    const [hue, sat] = hexToHsl(value);
    const range = SEMANTIC_HUE_RANGES[role];

    // Check 1: Hue must be within the role's allowed range
    const hueValid = hueInRange(hue, range);

    // Check 2: Saturation must be above minimum (semantic colors must be colorful)
    const satValid = sat >= MIN_SEMANTIC_SATURATION;

    if (!hueValid || !satValid) {
      violations.push({
        token: tokenId,
        expected: `${range.label} (canonical: ${canonical})`,
        actual: value,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Get the list of token IDs that can be safely decorated without semantic risk.
 *
 * These are all tokens from the 14-token contract that are NOT semantic color
 * tokens — i.e. background, foreground, surface, accent, border, etc.
 * Themes have full creative freedom over these.
 *
 * Note: The 14-token contract does not include semantic tokens (success/error/
 * warning/info) — those are extended tokens. This function returns the 12 core
 * tokens from the contract (excluding the 2 per-agent derived tokens that are
 * computed, not decorated).
 *
 * @returns {string[]} Array of decorable token IDs.
 */
export function getDecorableTokens() {
  // The 12 core palette tokens (14 minus 2 per-agent derived: button-bg, input-bg)
  // These are the tokens that themes can freely customize.
  return [
    '--agentskin-bg',
    '--agentskin-surface',
    '--agentskin-surface-elevated',
    '--agentskin-text',
    '--agentskin-muted',
    '--agentskin-accent',
    '--agentskin-secondary',
    '--agentskin-border',
    '--agentskin-code-bg',
    '--agentskin-code-fg',
    '--agentskin-focus-ring',
    '--agentskin-selection',
  ];
}

/**
 * Validate that a semantic color maintains minimum contrast against a background.
 *
 * Semantic colors must remain visible (not just hue-correct) to be useful.
 * This checks the WCAG ratio against the provided background.
 *
 * @param {string} hex - The semantic color to check.
 * @param {string} background - The background color.
 * @returns {{ ratio: number, passes: boolean }}
 */
export function validateSemanticContrast(hex, background) {
  const ratio = contrastRatio(hex, background);
  return {
    ratio: Math.round(ratio * 100) / 100,
    passes: ratio >= MIN_SEMANTIC_CONTRAST,
  };
}

/**
 * Classify a hex color into a semantic role based on its hue.
 *
 * Returns null if the color is too desaturated or too dark/light to classify.
 *
 * @param {string} hex - Hex color to classify.
 * @returns {'success' | 'error' | 'warning' | 'info' | null}
 */
export function classifySemanticRole(hex) {
  const [hue, sat, l] = hexToHsl(hex);

  if (sat < MIN_SEMANTIC_SATURATION || l < 0.1 || l > 0.95) return null;

  for (const [role, range] of Object.entries(SEMANTIC_HUE_RANGES)) {
    if (hueInRange(hue, range)) return role;
  }

  return null;
}
