// SPDX-License-Identifier: MPL-2.0

/**
 * # color-utils.mjs — Shared color utility functions.
 *
 * Single source of truth for luminance and hex-parsing helpers previously
 * duplicated across scripts/build-theme-package.mjs, scripts/theme-utils.mjs,
 * and scripts/extended-colors.mjs (Step 0 extraction).
 *
 * Pure functions: no I/O, no side effects.
 */

/**
 * Parse a hex color string into [r, g, b] components (0–255).
 *
 * Accepts 3/4/6/8-digit forms (#rgb, #rgba, #rrggbb, #rrggbbaa):
 *   - 3-digit (#rgb) is expanded to 6-digit (#rrggbb).
 *   - 4-digit (#rgba) is expanded to 8-digit, alpha stripped.
 *   - 8-digit (#rrggbbaa) has alpha stripped to 6-digit.
 *
 * @param {string} hex - Hex color string (e.g. "#7C9CFF" or "#7C9CFF60").
 * @returns {[number, number, number] | null} RGB tuple, or null on invalid input.
 */
export function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Compute the relative luminance of a color per WCAG 2.1 (§1.4.3).
 *
 * Each sRGB channel is linearized (gamma-expanded) then combined with the
 * luminance weights (0.2126 R + 0.7152 G + 0.0722 B).
 *
 * Behavior matches the previous copies in theme-utils.mjs (L101-107) and
 * extended-colors.mjs (L39-47) which were byte-ident WCAG implementations.
 * The earlier build-theme-package.mjs copy used a simplified linear formula
 * (no gamma); this WCAG version is strictly more correct and preserves the
 * dark/light classification at the 0.5 threshold because sRGB linearization
 * is monotonic.
 *
 * @param {string} hex - Hex color string (e.g. "#1a1a2e").
 * @returns {number} Relative luminance, 0 (black) – 1 (white).
 */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
