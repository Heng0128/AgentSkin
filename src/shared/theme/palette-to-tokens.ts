// SPDX-License-Identifier: MPL-2.0

/**
 * # Palette to Tokens -- 4-Color to 14-Token Mapping
 *
 * Maps a 4-tone palette (accent / secondary / surface / text) to AgentSkin's
 * 14-token theme contract using color-mix() derivation rules. This is the
 * "4-tone -> 14-token" stage of the client-side Canvas color extraction
 * pipeline: the Canvas produces 4 tones, this module expands them to the
 * full set of CSS variables that AgentSkin's injection engine expects.
 *
 * ## 14-Token Contract
 *
 * The output keys align with `ThemeManifestColors` in `types/theme.ts`:
 *
 * | Token | Source |
 * |-------|--------|
 * | `accent` | direct from 4-tone accent |
 * | `secondary` | direct from 4-tone secondary |
 * | `background` | alias of surface |
 * | `foreground` | alias of text |
 * | `surface` | direct from 4-tone surface |
 * | `surfaceElevated` | surface shifted +lightness (color-mix with white/black) |
 * | `border` | color-mix(surface, text, 15-20%) |
 * | `muted` | color-mix(text, surface, 65%) -- desaturated text |
 * | `accentMuted` | color-mix(accent, surface, 50%) -- desaturated accent |
 * | `codeBackground` | surface shifted -lightness (color-mix with black/white) |
 * | `codeForeground` | text shifted +lightness |
 * | `inputBackground` | surface shifted slightly |
 * | `buttonBackground` | accent |
 * | `buttonForeground` | contrast color of accent (#000000 / #FFFFFF) |
 * | `focusRing` | accent |
 *
 * ## Derivation Rules
 *
 * All derived tokens use color-mix() equivalent operations:
 *   - **Lightness shift** -- `adjustLightness(hex, delta)` approximates
 *     `color-mix(in hsl, hex, white delta%)` for positive delta or
 *     `color-mix(in hsl, hex, black |delta|%)` for negative delta.
 *   - **Desaturation** -- `adjustSaturation(hex, factor)` approximates
 *     `color-mix(in hsl, hex, grey)` where factor controls the mix ratio.
 *   - **Blend** -- `mixHex(hex1, hex2, ratio)` approximates
 *     `color-mix(in srgb, hex1, hex2 ratio%)`.
 *
 * The `direction` variable encodes the lightness shift direction:
 *   - Light mode: surface is already light, so "elevated" means darker (direction = -1).
 *   - Dark mode: surface is already dark, so "elevated" means lighter (direction = +1).
 *
 * ## Design
 *
 * Pure function -- no DOM, no Electron deps. Lives in the shared layer
 * so both the main process and renderer can import it. Reuses color
 * primitives from `contrast-utils.ts` and `tonal-palette.ts`.
 */

import type { Tone4Palette } from '../color/canvas-palette-extractor';
import { getContrastColor, hexToRgb, rgbToHex } from '../contrast-utils';
import { hexToHsl, hslToHex } from '../tonal-palette';

// ---------------------------------------------------------------------------
// Color helpers (color-mix equivalents)
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Adjust lightness by a signed delta (positive = lighter).
 * Equivalent to `color-mix(in hsl, hex, white delta%)` for positive delta.
 */
function adjustLightness(hex: string, delta: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: clamp(hsl.l + delta, 0, 1) });
}

/**
 * Scale saturation by a factor (0 = greyscale, 1 = unchanged).
 * Equivalent to `color-mix(in hsl, hex, hsl(h, 0%, l))`.
 */
function adjustSaturation(hex: string, factor: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, s: clamp(hsl.s * factor, 0, 1) });
}

/**
 * Linear interpolation between two hex colors (ratio 0 = hex1, 1 = hex2).
 * Equivalent to `color-mix(in srgb, hex1, hex2 ratio%)`.
 *
 * Returns uppercase hex to stay consistent with `hslToHex` convention.
 */
function mixHex(hex1: string, hex2: string, ratio: number): string {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return hex1;
  return rgbToHex(
    c1.r + (c2.r - c1.r) * ratio,
    c1.g + (c2.g - c1.g) * ratio,
    c1.b + (c2.b - c1.b) * ratio,
  ).toUpperCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a 4-tone extracted palette to AgentSkin's 14-token theme record.
 *
 * The output keys align with `ThemeManifestColors` in `types/theme.ts`.
 * Tokens not directly present in the 4-tone palette are derived using
 * color-mix() equivalent operations (see module docs for the full table).
 *
 * @param palette  The 4-tone palette from `extractFromPixels` / `extractFromCanvas`.
 * @returns        A record of 14+ CSS variable values keyed by token name.
 */
export function map4To14Colors(palette: Tone4Palette): Record<string, string> {
  const { accent, secondary, surface, text, mode } = palette;
  const direction = mode === 'light' ? -1 : 1;

  return {
    // --- Direct mappings ---
    accent,
    secondary,
    background: surface,
    foreground: text,

    // --- Aliases for compatibility with 14-token contract ---
    surface,
    focusRing: accent,

    // --- Derived: border (color-mix of surface and text) ---
    border: mixHex(surface, text, mode === 'light' ? 0.15 : 0.2),

    // --- Derived: muted variants (desaturated) ---
    accentMuted: adjustSaturation(accent, 0.5),
    muted: adjustSaturation(text, 0.35),

    // --- Derived: surface hierarchy (lightness shift) ---
    surfaceElevated: adjustLightness(surface, direction * 0.04),

    // --- Derived: code block colors ---
    codeBackground: adjustLightness(surface, direction * 0.06),
    codeForeground: adjustLightness(text, -direction * 0.1),

    // --- Derived: input field ---
    inputBackground: adjustLightness(surface, direction * 0.03),

    // --- Derived: button colors ---
    buttonBackground: accent,
    // getContrastColor returns lowercase (#000000 / #ffffff); normalize to
    // uppercase for consistency with the rest of the token set.
    buttonForeground: getContrastColor(accent).toUpperCase(),
  };
}
