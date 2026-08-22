// SPDX-License-Identifier: MPL-2.0
//
// # extended-colors.mjs — semantic color block generator and WCAG/APCA contrast engine.
//
// Pure functions for computing relative luminance, WCAG 2.1 contrast ratios,
// simplified APCA contrast, auto on-color selection, and generating CSS custom
// property blocks from extended semantic color maps. No I/O — color in, numbers
// / CSS out.

import { luminance } from './utils/color-utils.mjs';

export { luminance } from './utils/color-utils.mjs';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a 6-digit hex string to [r, g, b] in 0-255. Returns null on invalid input. */
function parseHex(hex) {
  const raw = String(hex ?? '').trim();
  const m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!m) return null;
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

/**
 * Compute the WCAG 2.1 contrast ratio between two colors.
 *
 * Ratio ranges from 1 (identical) to 21 (#000 on #fff). The lighter color's
 * luminance is always placed in the numerator so order does not matter.
 *
 * @param {string} hex1 - First 6-digit hex color.
 * @param {string} hex2 - Second 6-digit hex color.
 * @returns {number} Contrast ratio, 1 – 21 (rounded to 2 decimal places).
 */
export function contrastRatio(hex1, hex2) {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

// ---------------------------------------------------------------------------
// APCA — simplified contrast (reference-grade only)
// ---------------------------------------------------------------------------

/**
 * Compute a simplified APCA contrast value (Lc).
 *
 * This is a deliberately reduced version of the full APCA algorithm:
 * it linearizes sRGB to Ys/Yt luminance, then applies the power-curve
 * approximation `|Ys^0.56 - Yt^0.57| * 1.25 * 100`. Intended for
 * reference-grade checks only — not for compliance decisions.
 *
 * @param {string} bgHex  - Background 6-digit hex color.
 * @param {string} textHex - Text 6-digit hex color.
 * @returns {number} Absolute Lc value, 0 – ~100 (rounded to 1 decimal).
 */
export function apcaContrast(bgHex, textHex) {
  const bg = parseHex(bgHex);
  const tx = parseHex(textHex);
  if (!bg || !tx) return 0;

  // Linearize each channel (sRGB → linear RGB), then weighted sum.
  const linearize = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const ys = 0.2126 * linearize(bg[0]) + 0.7152 * linearize(bg[1]) + 0.0722 * linearize(bg[2]);
  const yt = 0.2126 * linearize(tx[0]) + 0.7152 * linearize(tx[1]) + 0.0722 * linearize(tx[2]);

  const lc = Math.abs(ys ** 0.56 - yt ** 0.57) * 1.25 * 100;
  return Math.round(lc * 10) / 10;
}

// ---------------------------------------------------------------------------
// Auto on-color selection
// ---------------------------------------------------------------------------

/**
 * Pick black (#000000) or white (#ffffff) for readable text on a given background.
 *
 * Uses a perceptual luminance threshold of 0.45 — above it the background is
 * "light enough" that black text is more legible; at or below it, white wins.
 *
 * @param {string} bgHex - Background 6-digit hex color.
 * @returns {"#000000" | "#ffffff"} The chosen text color.
 */
export function autoOnColor(bgHex) {
  return luminance(bgHex) > 0.45 ? '#000000' : '#ffffff';
}

// ---------------------------------------------------------------------------
// WCAG compliance check
// ---------------------------------------------------------------------------

/**
 * Check WCAG 2.1 AA compliance for a foreground/background pair.
 *
 * AA thresholds (WCAG 1.4.3): 4.5:1 for normal text, 3:1 for large text /
 * UI components. This function reports the normal-text bars (4.5 and 7.0);
 * `passesAA` requires ≥ 4.5, `passesAAA` requires ≥ 7.0.
 *
 * @param {string} fgHex - Foreground (text) 6-digit hex color.
 * @param {string} bgHex - Background 6-digit hex color.
 * @returns {{ ratio: number, passesAA: boolean, passesAAA: boolean }}
 */
export function wcagCheck(fgHex, bgHex) {
  const ratio = contrastRatio(fgHex, bgHex);
  return {
    ratio,
    passesAA: ratio >= 4.5,
    passesAAA: ratio >= 7.0,
  };
}

// ---------------------------------------------------------------------------
// Extended semantic color block generator
// ---------------------------------------------------------------------------

/**
 * Generate a CSS custom-property block from a map of extended semantic colors.
 *
 * Each entry produces two variables:
 * - `--agentskin-ext-<name>` — the color itself
 * - `--agentskin-ext-on-<name>` — auto-selected black/white for readable on-color
 *
 * Keys are lowercased; values must be valid 6-digit hex strings. Invalid hex
 * values are silently skipped so one bad entry does not break the whole block.
 *
 * @param {Record<string, string>} ext - Map of semantic name → hex color.
 * @param {string} [host=':root'] - CSS host selector to scope variables under.
 * @returns {string} CSS declaration block.
 *
 * @example
 * extendedColorsBlock({ error: '#ef4444', success: '#22c55e' });
 * // => `:root {
 * //   --agentskin-ext-error: #ef4444;
 * //   --agentskin-ext-on-error: #ffffff;
 * //   --agentskin-ext-success: #22c55e;
 * //   --agentskin-ext-on-success: #ffffff;
 * // }`
 */
export function extendedColorsBlock(ext, host = ':root') {
  const entries = Object.entries(ext ?? {})
    .filter(([, v]) => parseHex(v) !== null)
    .map(([name, color]) => {
      const key = String(name).toLowerCase().trim();
      const onColor = autoOnColor(color);
      return [
        `  --agentskin-ext-${key}: ${color};`,
        `  --agentskin-ext-on-${key}: ${onColor};`,
      ].join('\n');
    });

  if (entries.length === 0) return '';

  return `${host} {\n${entries.join('\n')}\n}`;
}
