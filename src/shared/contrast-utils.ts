// SPDX-License-Identifier: MPL-2.0

/**
 * # Contrast Utils — WCAG 2.1 Runtime Contrast Fallback
 *
 * Provides WCAG 2.1 relative luminance and contrast ratio calculations,
 * plus a CSS override generator that ensures text remains readable on
 * complex backgrounds. The override is only produced when the contrast
 * ratio falls below the AA threshold (4.5:1).
 *
 * ## CSS Variables
 *
 *   - `--agentskin-readable-text` — a high-contrast text color computed to
 *     meet WCAG AA against the detected background.
 *   - `--agentskin-readable-shadow` — a subtle text shadow that further
 *     improves legibility on busy/gradient backgrounds.
 *
 * ## Design
 *
 * The fallback is intentionally non-destructive: it only emits CSS when
 * the measured contrast is insufficient, and the override is expressed
 * as CSS custom properties so the 14-token contract stays untouched.
 *
 * Pure module — no DOM or Electron deps. Can be imported by both the
 * main process and the engine runtime (via inlined equivalent).
 */

/** WCAG 2.1 AA contrast threshold for normal text. */
export const WCAG_AA_THRESHOLD = 4.5;

/** WCAG 2.1 AAA contrast threshold for normal text. */
export const WCAG_AAA_THRESHOLD = 7.0;

/** WCAG 2.1 AA contrast threshold for large text (18pt+ or 14pt bold). */
export const WCAG_AA_LARGE_THRESHOLD = 3.0;

// ---------------------------------------------------------------------------
// Color conversion
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string into an `{ r, g, b }` object (0–255).
 *
 * Accepts `#rgb` and `#rrggbb` forms (case-insensitive). Returns null on
 * invalid input.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/**
 * Convert r, g, b channel values (0-255) to a `#rrggbb` string.
 * Channels are clamped to [0, 255] and rounded.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------------------------------------------------------------------------
// WCAG 2.1 relative luminance
// ---------------------------------------------------------------------------

/**
 * Compute WCAG 2.1 relative luminance for RGB channels (0–255).
 *
 * Each sRGB channel is linearized (gamma-expanded) then combined with the
 * luminance weights (0.2126 R + 0.7152 G + 0.0722 B).
 *
 * @param r  Red channel [0, 255]
 * @param g  Green channel [0, 255]
 * @param b  Blue channel [0, 255]
 * @returns  Relative luminance [0, 1]
 */
export function wcagRelativeLuminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r / 255, g / 255, b / 255].map((s) =>
    s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Compute WCAG 2.1 relative luminance from a hex color string.
 *
 * @param hex  Hex color string (e.g. "#1a1a2e").
 * @returns    Relative luminance [0, 1], or 0.5 for invalid input.
 */
export function wcagLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  return wcagRelativeLuminance(rgb.r, rgb.g, rgb.b);
}

// ---------------------------------------------------------------------------
// Contrast ratio
// ---------------------------------------------------------------------------

/**
 * Compute WCAG 2.1 contrast ratio between two hex colors.
 *
 * Result ranges from 1.0 (identical colors) to 21.0 (black on white).
 * Order-independent: `contrastRatio(a, b) === contrastRatio(b, a)`.
 *
 * @param hex1  First hex color.
 * @param hex2  Second hex color.
 * @returns     Contrast ratio [1, 21].
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return 1.0;
  const l1 = wcagRelativeLuminance(c1.r, c1.g, c1.b);
  const l2 = wcagRelativeLuminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Readable text color computation
// ---------------------------------------------------------------------------

/**
 * Determine whether black (`#000000`) or white (`#ffffff`) text will have
 * better contrast against the given background color.
 *
 * Uses WCAG 2.1 relative luminance with a 0.5 threshold.
 *
 * @param bgHex  Background hex color.
 * @returns      `#000000` or `#ffffff`.
 */
export function getContrastColor(bgHex: string): string {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return '#ffffff';
  const lum = wcagRelativeLuminance(rgb.r, rgb.g, rgb.b);
  return lum > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Compute a text color that meets the specified WCAG contrast threshold
 * against the given background.
 *
 * Strategy: determine which extreme (black or white) can achieve the target
 * ratio, then binary-search for the boundary grey lightness. This produces
 * the most subtle override that still guarantees legibility.
 *
 * The direction is chosen by comparing the maximum achievable contrast of
 * black text vs white text against the background:
 *   - Black contrast = (bgLum + 0.05) / 0.05
 *   - White contrast = 1.05 / (bgLum + 0.05)
 *
 * Whichever extreme can reach the target with the least headroom wins,
 * keeping the override color closer to mid-grey.
 *
 * @param bgHex     Background hex color.
 * @param targetRatio  Desired minimum contrast ratio (default WCAG_AA_THRESHOLD).
 * @returns         Hex color string that meets the target ratio.
 */
export function computeReadableTextColor(
  bgHex: string,
  targetRatio: number = WCAG_AA_THRESHOLD,
): string {
  const bgRgb = hexToRgb(bgHex);
  if (!bgRgb) return '#ffffff';

  const bgLum = wcagRelativeLuminance(bgRgb.r, bgRgb.g, bgRgb.b);

  // Maximum achievable contrast for each extreme.
  const blackContrast = (bgLum + 0.05) / 0.05;
  const whiteContrast = 1.05 / (bgLum + 0.05);

  // Determine search direction: true = search for dark text, false = light text.
  let searchDark: boolean;
  if (blackContrast >= targetRatio && whiteContrast >= targetRatio) {
    // Both work — pick the one with less headroom (more subtle result).
    searchDark = blackContrast <= whiteContrast;
  } else if (blackContrast >= targetRatio) {
    searchDark = true;
  } else if (whiteContrast >= targetRatio) {
    searchDark = false;
  } else {
    // Neither can achieve the target — fall back to the better extreme.
    searchDark = blackContrast >= whiteContrast;
  }

  // Binary-search for the boundary lightness where ratio === targetRatio.
  let lo = 0.0;
  let hi = 1.0;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const v = Math.round(mid * 255);
    const lum = wcagRelativeLuminance(v, v, v);
    const lighter = Math.max(lum, bgLum);
    const darker = Math.min(lum, bgLum);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    if (searchDark) {
      // Dark text: ratio decreases as lightness increases.
      if (ratio >= targetRatio) {
        lo = mid; // passes — try lighter (more subtle)
      } else {
        hi = mid; // fails — need darker
      }
    } else {
      // Light text: ratio increases as lightness increases.
      if (ratio >= targetRatio) {
        hi = mid; // passes — try darker (more subtle)
      } else {
        lo = mid; // fails — need lighter
      }
    }
  }

  const finalLightness = searchDark ? lo : hi;
  const v = Math.min(255, Math.max(0, Math.round(finalLightness * 255)));
  return rgbToHex(v, v, v);
}

/** Minimal HSL→RGB for grey tones (s=0). */
function _hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (s === 0) {
    r = g = b = l;
  } else if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// ---------------------------------------------------------------------------
// CSS override generation
// ---------------------------------------------------------------------------

/**
 * Result of evaluating whether a contrast override is needed.
 */
export interface ContrastFallbackResult {
  /** True when the contrast ratio meets the threshold (no override needed). */
  pass: boolean;
  /** Measured contrast ratio. */
  ratio: number;
  /** CSS override string (empty when `pass` is true). */
  css: string;
}

/**
 * Evaluate background/text contrast and generate a CSS override if needed.
 *
 * When the contrast ratio between `bgHex` and `textHex` is below the
 * threshold, produces a `:root {}` rule that sets:
 *   - `--agentskin-readable-text` to a computed high-contrast color.
 *   - `--agentskin-readable-shadow` to a subtle shadow for busy backgrounds.
 *
 * When the contrast is adequate, returns an empty CSS string so callers
 * can skip injecting the override entirely.
 *
 * @param bgHex      Background hex color.
 * @param textHex    Foreground (text) hex color.
 * @param threshold  Minimum contrast ratio (default WCAG_AA_THRESHOLD).
 * @returns          A `ContrastFallbackResult` with the verdict and CSS.
 */
export function evaluateContrastFallback(
  bgHex: string,
  textHex: string,
  threshold: number = WCAG_AA_THRESHOLD,
): ContrastFallbackResult {
  const ratio = contrastRatio(bgHex, textHex);

  if (ratio >= threshold) {
    return { pass: true, ratio, css: '' };
  }

  const readableText = computeReadableTextColor(bgHex, threshold);
  // Shadow: use the opposite luminance of the readable text for a subtle halo.
  const textLum = wcagLuminance(readableText);
  const shadowColor = textLum > 0.5 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';

  const css = `:root {
  --agentskin-readable-text: ${readableText};
  --agentskin-readable-shadow: 0 0 3px ${shadowColor};
}`.trim();

  return { pass: false, ratio, css };
}

/**
 * Parse a CSS `rgb()` or `rgba()` string into a hex color.
 *
 * Handles: `rgb(r, g, b)` and `rgba(r, g, b, a)` with space-separated
 * or comma-separated values. Returns null on parse failure.
 *
 * @param css  CSS color string like "rgba(26, 26, 46, 1)".
 * @returns    Hex color string or null.
 */
export function parseCssColor(css: string): string | null {
  const trimmed = css.trim();
  // Match rgb() / rgba() with comma or space separators.
  const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(trimmed);
  if (match) {
    return rgbToHex(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  // Match #hex directly.
  if (trimmed.startsWith('#')) {
    return hexToRgb(trimmed) ? trimmed : null;
  }
  return null;
}

/**
 * Convenience: evaluate contrast from CSS color strings (handles both
 * `hex` and `rgb()` / `rgba()` forms).
 *
 * @param bgCss    Background CSS color.
 * @param textCss  Text CSS color.
 * @param threshold  Minimum contrast ratio.
 * @returns        A `ContrastFallbackResult`.
 */
export function evaluateContrastFallbackFromCss(
  bgCss: string,
  textCss: string,
  threshold: number = WCAG_AA_THRESHOLD,
): ContrastFallbackResult {
  const bgHex = parseCssColor(bgCss);
  const textHex = parseCssColor(textCss);
  if (!bgHex || !textHex) {
    return { pass: true, ratio: 1.0, css: '' };
  }
  return evaluateContrastFallback(bgHex, textHex, threshold);
}
