// SPDX-License-Identifier: MPL-2.0

/**
 * # derive-missing-tokens.mjs
 *
 * Auto-derives missing theme tokens from the partial set a theme author
 * provides, preserving the 14-token contract. Only fills in absent keys —
 * explicitly provided values are never overridden.
 *
 * Derivation rules (dark theme defaults; light theme inverts lightness shifts):
 *
 * | Missing token | Source          | Rule                                          |
 * |---------------|-----------------|-----------------------------------------------|
 * | accent        | background      | Complementary hue, high saturation            |
 * | secondary     | accent          | Desaturated (70% alpha)                       |
 * | surface       | background      | +8% white mix (dark) / -5% black (light)      |
 * | surfaceElevated | surface       | +6% white mix (dark) / -4% black (light)      |
 * | muted         | foreground      | 60% alpha                                     |
 * | border        | foreground      | 20% alpha                                     |
 * | codeBackground| surface         | -5% black (dark) / +5% white (light)          |
 * | codeForeground| foreground      | 85% alpha                                     |
 * | inputBackground | background    | +5% white mix (dark) / -5% black (light)      |
 * | buttonBackground | accent        | 10% alpha tint                                |
 * | buttonForeground | accent        | Same as accent                                |
 * | focusRing     | accent          | 40% alpha                                     |
 *
 * The `inference` field on the returned record marks each token as
 * 'provided', 'derived', or 'default' for auditability:
 *
 * ```ts
 * const result = deriveMissingTokens({ background, foreground });
 * // result.background === provided value   (result.inference.background === 'provided')
 * // result.accent === derived value        (result.inference.accent === 'derived')
 * ```
 */

import { hexToHsl, hslToHex, rgbToHex } from './color-theory.mjs';
import { alpha, parseColor, shade } from './theme-utils.mjs';
import { luminance } from './utils/color-utils.mjs';

/**
 * Convert a shade() rgb() output to hex so luminance() can parse it.
 * shade() returns "rgb(r, g, b)" — we need "#rrggbb" for downstream tools.
 *
 * @param {string} rgbStr - rgb() string from shade()
 * @returns {string} Hex color string
 */
function shadeToHex(rgbStr) {
  const c = parseColor(rgbStr);
  return rgbToHex([c.r, c.g, c.b]);
}

/**
 * Convert an alpha() rgba() output to 8-digit hex (#rrggbbaa) to match the
 * existing manifest convention (e.g. "#7C9CFF2e").
 *
 * @param {string} rgbaStr - rgba() string from alpha()
 * @returns {string} 8-digit hex color string
 */
function alphaToHex8(rgbaStr) {
  const c = parseColor(rgbaStr);
  const aa = Math.round(c.a * 255)
    .toString(16)
    .padStart(2, '0');
  return rgbToHex([c.r, c.g, c.b]) + aa;
}

/** The 13 manifest color keys that map to the 14-token contract. */
export const MANIFEST_COLOR_KEYS = [
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
];

/**
 * Derive a vivid accent from a background color by shifting hue ~30° and
 * boosting saturation. Ensures the accent contrasts with the background.
 *
 * @param {string} bgHex - Background hex color
 * @param {boolean} isLight - Whether the theme is light mode
 * @returns {string} Hex accent color
 */
function deriveAccentFromBg(bgHex, isLight) {
  const [h, s] = hexToHsl(bgHex);
  // Shift hue by ~30° for visual interest; if background is near-grayscale,
  // pick a default blue-purple hue (230°) that works on most backgrounds.
  const baseHue = s < 0.08 ? 230 : (h + 30) % 360;
  const sat = 0.65;
  const light = isLight ? 0.5 : 0.62;
  return hslToHex(baseHue, sat, light);
}

/**
 * Derive a secondary color from accent by reducing saturation.
 *
 * @param {string} accentHex - Accent hex color
 * @returns {string} Hex secondary color
 */
function deriveSecondaryFromAccent(accentHex) {
  const [h, s, l] = hexToHsl(accentHex);
  // Desaturate slightly and lighten a touch for a softer secondary.
  return hslToHex(h, Math.max(0.2, s * 0.6), Math.min(0.85, l + 0.08));
}

/**
 * Derive missing theme tokens from a partial set. Only absent keys are filled;
 * provided values are preserved verbatim.
 *
 * @param {Record<string, string>} partial - Partial theme colors (must include
 *   at least `background` and `foreground`).
 * @returns {Record<string, string> & { inference: Record<string, string> }}
 *   Complete colors object with all 13 keys plus an `inference` map marking each
 *   token as 'provided', 'derived', or 'default'.
 * @throws {Error} If `background` or `foreground` is missing.
 */
export function deriveMissingTokens(partial) {
  if (!partial || typeof partial !== 'object') {
    throw new Error('deriveMissingTokens: expected a colors object');
  }
  if (!partial.background) {
    throw new Error('deriveMissingTokens: colors.background is required');
  }
  if (!partial.foreground) {
    throw new Error('deriveMissingTokens: colors.foreground is required');
  }

  const isLight = luminance(partial.background) >= 0.5;
  const provided = new Set(
    Object.keys(partial).filter((k) => typeof partial[k] === 'string' && partial[k].length > 0),
  );

  // Start with provided values; we'll fill in missing ones.
  const result = { ...partial };
  const inference = {};

  // Mark provided tokens.
  for (const key of provided) {
    inference[key] = 'provided';
  }

  // --- accent: derive from background if missing ---
  if (!provided.has('accent')) {
    result.accent = deriveAccentFromBg(partial.background, isLight);
    inference.accent = 'derived';
  }
  const accent = result.accent;

  // --- secondary: derive from accent if missing ---
  if (!provided.has('secondary')) {
    result.secondary = deriveSecondaryFromAccent(accent);
    inference.secondary = 'derived';
  }

  // --- surface: derive from background if missing ---
  if (!provided.has('surface')) {
    result.surface = isLight
      ? shadeToHex(shade(partial.background, 'black', 0.05))
      : shadeToHex(shade(partial.background, 'white', 0.08));
    inference.surface = 'derived';
  }
  const surface = result.surface;

  // --- surfaceElevated: derive from surface if missing ---
  if (!provided.has('surfaceElevated')) {
    result.surfaceElevated = isLight
      ? shadeToHex(shade(surface, 'black', 0.04))
      : shadeToHex(shade(surface, 'white', 0.06));
    inference.surfaceElevated = 'derived';
  }

  // --- muted: derive from foreground (60% alpha) if missing ---
  if (!provided.has('muted')) {
    result.muted = alphaToHex8(alpha(partial.foreground, 0.6));
    inference.muted = 'derived';
  }

  // --- border: derive from foreground (20% alpha) if missing ---
  if (!provided.has('border')) {
    result.border = alphaToHex8(alpha(partial.foreground, 0.2));
    inference.border = 'derived';
  }

  // --- codeBackground: derive from surface if missing ---
  if (!provided.has('codeBackground')) {
    result.codeBackground = isLight
      ? shadeToHex(shade(surface, 'white', 0.05))
      : shadeToHex(shade(surface, 'black', 0.05));
    inference.codeBackground = 'derived';
  }

  // --- codeForeground: derive from foreground (85% alpha) if missing ---
  if (!provided.has('codeForeground')) {
    result.codeForeground = alphaToHex8(alpha(partial.foreground, 0.85));
    inference.codeForeground = 'derived';
  }

  // --- inputBackground: derive from background (+5% brightness) if missing ---
  if (!provided.has('inputBackground')) {
    result.inputBackground = isLight
      ? shadeToHex(shade(partial.background, 'black', 0.05))
      : shadeToHex(shade(partial.background, 'white', 0.05));
    inference.inputBackground = 'derived';
  }

  // --- buttonBackground: derive from accent (10% alpha tint) if missing ---
  if (!provided.has('buttonBackground')) {
    result.buttonBackground = alphaToHex8(alpha(accent, 0.1));
    inference.buttonBackground = 'derived';
  }

  // --- buttonForeground: derive from accent (same) if missing ---
  if (!provided.has('buttonForeground')) {
    result.buttonForeground = accent;
    inference.buttonForeground = 'derived';
  }

  // --- focusRing: derive from accent (40% alpha) if missing ---
  if (!provided.has('focusRing')) {
    result.focusRing = alphaToHex8(alpha(accent, 0.4));
    inference.focusRing = 'derived';
  }

  // Attach inference metadata for auditability.
  result.inference = inference;

  return result;
}
