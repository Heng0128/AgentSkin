// SPDX-License-Identifier: MPL-2.0

/**
 * # Adaptive Theme Generator
 *
 * Given image analysis results (Top-5 dominant colors + mode), generate a
 * complete 14-token AgentSkin theme. Inspired by Codex Dream Skin's
 * `makeAdaptivePalette` logic, using HSL color-space offsets for harmony.
 *
 * Pure module — zero runtime dependencies, no I/O. Reuses `tonal-palette.ts`
 * for HSL conversion and `color-quantize.ts` for luminance + alpha blending.
 */

import { type HslColor, hexToHsl, hslToHex } from '../../shared/tonal-palette';
import { blendOver, luminanceOf, type Rgba, toHex } from './color-quantize';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single dominant color extracted from an image, sorted by weight (desc). */
export interface DominantColor {
  r: number;
  g: number;
  b: number;
}

/** Appearance mode for the generated theme. */
export type ThemeMode = 'light' | 'dark' | 'auto';

/** Input to the adaptive theme generator. */
export interface AdaptiveThemeInput {
  /** Top-5 dominant colors from image analysis, ordered by weight (highest first). */
  top5: DominantColor[];
  /** Desired appearance mode. */
  mode: ThemeMode;
}

/** Output: complete 14-token CSS variable map. */
export type ThemeTokens = Record<string, string>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 14 token names in the AgentSkin theme contract. */
export const TOKEN_NAMES = [
  '--agentskin-accent',
  '--agentskin-accent-alt',
  '--agentskin-secondary',
  '--agentskin-highlight',
  '--agentskin-background',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-border',
  '--agentskin-success',
  '--agentskin-warning',
  '--agentskin-error',
  '--agentskin-info',
] as const;

/** Hue offsets (degrees) for accent-alt, secondary, highlight. */
const ACCENT_ALT_OFFSET = 12;
const SECONDARY_OFFSET = -24;
const HIGHLIGHT_OFFSET = 24;

/** Semantic hue anchors (degrees). */
const SUCCESS_HUE = 145;
const WARNING_HUE = 35;
const ERROR_HUE = 5;
const INFO_HUE = 210;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a DominantColor to HSL. */
function rgbToHsl(c: DominantColor): HslColor {
  return hexToHsl(toHex(c));
}

/** Shift a hue by `delta` degrees, wrapping into [0, 360). */
function shiftHue(h: number, delta: number): number {
  return (((h + delta) % 360) + 360) % 360;
}

/** Create a hex color from HSL with clamped channels. */
function hsl(h: number, s: number, l: number): string {
  return hslToHex({ h, s, l });
}

/** Create an RGBA color from hex + alpha. */
function hexToRgba(hex: string, alpha: number): Rgba {
  const raw = hex.replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return { r, g, b, a: alpha };
}

// ---------------------------------------------------------------------------
// Core: generate adaptive theme
// ---------------------------------------------------------------------------

/**
 * Generate a complete 14-token theme from image analysis results.
 *
 * @param input  Top-5 dominant colors + appearance mode.
 * @returns      A `ThemeTokens` map with all 14 CSS variables.
 */
export function generateAdaptiveTheme(input: AdaptiveThemeInput): ThemeTokens {
  const { top5, mode } = input;
  const dark = mode === 'dark';
  const effectiveDark = mode === 'auto' ? isDarkFromColors(top5) : dark;

  // --- Accent family (from dominant colors or hue-shifted variants) ---
  const accentHsl = rgbToHsl(top5[0]);
  const accent = hsl(accentHsl.h, accentHsl.s, effectiveDark ? 0.62 : 0.5);

  const accentAltHsl =
    top5.length > 1
      ? rgbToHsl(top5[1])
      : { h: shiftHue(accentHsl.h, ACCENT_ALT_OFFSET), s: accentHsl.s, l: accentHsl.l };
  const accentAlt = hsl(accentAltHsl.h, accentAltHsl.s, effectiveDark ? 0.58 : 0.46);

  const secondaryHsl =
    top5.length > 2
      ? rgbToHsl(top5[2])
      : { h: shiftHue(accentHsl.h, SECONDARY_OFFSET), s: accentHsl.s * 0.85, l: accentHsl.l };
  const secondary = hsl(secondaryHsl.h, secondaryHsl.s, effectiveDark ? 0.52 : 0.42);

  const highlightHsl =
    top5.length > 3
      ? rgbToHsl(top5[3])
      : { h: shiftHue(accentHsl.h, HIGHLIGHT_OFFSET), s: accentHsl.s * 0.9, l: accentHsl.l };
  const highlight = hsl(highlightHsl.h, highlightHsl.s, effectiveDark ? 0.66 : 0.54);

  // --- Background / surface / text (mode-dependent) ---
  const bgL = effectiveDark ? 0.07 : 0.97;
  const bgS = effectiveDark ? 0.08 : 0.06;
  const bgHue = accentHsl.h;
  const background = hsl(bgHue, bgS, bgL);

  const surfaceL = effectiveDark ? 0.12 : 0.94;
  const surface = hsl(bgHue, bgS + 0.01, surfaceL);

  const surfaceElevatedL = effectiveDark ? 0.16 : 0.99;
  const surfaceElevated = hsl(bgHue, bgS + 0.01, surfaceElevatedL);

  const textL = effectiveDark ? 0.92 : 0.12;
  const text = hsl(bgHue, effectiveDark ? 0.06 : 0.08, textL);

  // --- Muted: text at 60% opacity over background ---
  const mutedRgba = blendOver(hexToRgba(text, 0.6), hexToRgba(background, 1));
  const muted = toHex(mutedRgba);

  // --- Border: accent at 24% alpha over background ---
  const borderRgba = blendOver(hexToRgba(accent, 0.24), hexToRgba(background, 1));
  const border = toHex(borderRgba);

  // --- Semantic colors (hue-shifted from accent family) ---
  const success = hsl(SUCCESS_HUE, 0.55, effectiveDark ? 0.55 : 0.45);
  const warning = hsl(WARNING_HUE, 0.7, effectiveDark ? 0.6 : 0.52);
  const error = hsl(ERROR_HUE, 0.65, effectiveDark ? 0.55 : 0.5);
  const info = hsl(INFO_HUE, 0.6, effectiveDark ? 0.6 : 0.55);

  return {
    '--agentskin-accent': accent,
    '--agentskin-accent-alt': accentAlt,
    '--agentskin-secondary': secondary,
    '--agentskin-highlight': highlight,
    '--agentskin-background': background,
    '--agentskin-surface': surface,
    '--agentskin-surface-elevated': surfaceElevated,
    '--agentskin-text': text,
    '--agentskin-muted': muted,
    '--agentskin-border': border,
    '--agentskin-success': success,
    '--agentskin-warning': warning,
    '--agentskin-error': error,
    '--agentskin-info': info,
  };
}

// ---------------------------------------------------------------------------
// Auto-mode helper
// ---------------------------------------------------------------------------

/**
 * Determine if the image is predominantly dark based on the weighted
 * luminance of its dominant colors. Uses Rec. 709 weights (same as
 * `color-quantize.luminanceOf`).
 */
function isDarkFromColors(colors: DominantColor[]): boolean {
  if (colors.length === 0) return true;
  // Weight: first color counts most (50%), then descending.
  const weights = [0.5, 0.25, 0.15, 0.07, 0.03];
  let weightedLum = 0;
  let totalWeight = 0;
  for (let i = 0; i < Math.min(colors.length, weights.length); i++) {
    const c = colors[i];
    const lum = luminanceOf({ r: c.r, g: c.g, b: c.b, a: 1 });
    weightedLum += lum * weights[i];
    totalWeight += weights[i];
  }
  const avgLum = totalWeight > 0 ? weightedLum / totalWeight : 0.5;
  return avgLum < 0.4;
}
