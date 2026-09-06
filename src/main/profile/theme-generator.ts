// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-generator — Extracted Palette → 14-Token Theme Mapping
 *
 * Maps an `ImageThemePalette` (from `image-theme-analyzer.ts`) to AgentSkin's
 * 14-token theme contract (`ThemeManifestColors`). Handles:
 *
 *   - Mode-aware background / foreground assignment
 *   - WCAG AA contrast enforcement (≥ 4.5:1 for normal text)
 *   - Surface hierarchy derivation (background → surface → elevated)
 *   - Desaturated variants (muted, accentMuted)
 *   - Code block / input / button / border tokens
 *
 * ## Design
 *
 * Pure functions only — no DOM, no Electron. Both main process and renderer
 * can import this module. Reuses color primitives from the shared layer.
 */

import {
  computeReadableTextColor,
  contrastRatio,
  getContrastColor,
  hexToRgb,
  rgbToHex,
} from '../../shared/contrast-utils';
import { hexToHsl, hslToHex } from '../../shared/tonal-palette';
import type { ImageThemePalette } from './image-theme-analyzer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The complete 14-token theme that can be written to a theme manifest.
 * Keys match `ThemeManifestColors` in `types/theme.ts`.
 */
export interface ThemeTokens {
  accent: string;
  secondary: string;
  background: string;
  foreground: string;
  muted: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  codeBackground: string;
  codeForeground: string;
  inputBackground: string;
  buttonBackground: string;
  buttonForeground: string;
  focusRing: string;
}

/** Result of generating tokens, including contrast diagnostics. */
export interface ThemeGenerationResult {
  /** The 14-token theme. */
  tokens: ThemeTokens;
  /** Computed contrast ratios for diagnostics. */
  contrast: {
    /** foreground vs background. */
    textOnBackground: number;
    /** buttonForeground vs buttonBackground. */
    textOnButton: number;
    /** accent vs surface. */
    accentOnSurface: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WCAG 2.1 AA contrast threshold for normal text. */
const WCAG_AA = 4.5;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Adjust lightness by a signed delta (positive = lighter). */
function adjustLightness(hex: string, delta: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: clamp(hsl.l + delta, 0, 1) });
}

/** Scale saturation by a factor (0 = greyscale, 1 = unchanged). */
function adjustSaturation(hex: string, factor: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, s: clamp(hsl.s * factor, 0, 1) });
}

/** Linear interpolation between two hex colors (ratio 0 = hex1, 1 = hex2). */
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
// WCAG enforcement
// ---------------------------------------------------------------------------

/**
 * Ensure the foreground has WCAG AA contrast against the background.
 * If contrast is insufficient, nudge the foreground lightness toward the
 * extreme (black or white) until the threshold is met.
 */
function enforceContrast(
  foreground: string,
  background: string,
  mode: 'light' | 'dark',
  target = WCAG_AA,
): string {
  if (contrastRatio(foreground, background) >= target) {
    return foreground;
  }

  const fgHsl = hexToHsl(foreground);
  // Try pushing toward black (dark mode) or white (light mode).
  const extremeL = mode === 'light' ? 0.04 : 0.96;

  // Binary-search the lightness shift needed.
  let lo = 0;
  let hi = Math.abs(extremeL - fgHsl.l);
  const sign = extremeL > fgHsl.l ? 1 : -1;

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const testL = clamp(fgHsl.l + sign * mid, 0, 1);
    const candidate = hslToHex({ ...fgHsl, l: testL });
    if (contrastRatio(candidate, background) >= target) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return hslToHex({ ...fgHsl, l: clamp(fgHsl.l + sign * hi, 0, 1) });
}

// ---------------------------------------------------------------------------
// Core: generate 14 tokens from palette
// ---------------------------------------------------------------------------

/**
 * Generate a complete 14-token theme from an extracted image palette.
 *
 * @param palette  The structured palette from `extractThemePalette`.
 * @returns        A `ThemeGenerationResult` with tokens and contrast info.
 */
export function generateThemeTokens(palette: ImageThemePalette): ThemeGenerationResult {
  const { mode, primary, secondary, accent } = palette;
  const direction = mode === 'light' ? -1 : 1;

  // --- Accent: use the extracted accent color, ensure balanced lightness ---
  const accentHsl = accent.hsl;
  const balancedAccentL = mode === 'light' ? 0.55 : 0.6;
  const accentHex = hslToHex({
    h: accentHsl.h,
    s: clamp(accentHsl.s, 0.3, 0.85),
    l: balancedAccentL,
  });

  // --- Secondary: analogous hue from extracted secondary ---
  const secondaryHsl = secondary.hsl;
  const secondaryHex = hslToHex({
    h: secondaryHsl.h,
    s: clamp(secondaryHsl.s * 0.7, 0.15, 0.55),
    l: balancedAccentL,
  });

  // --- Background: extreme lightness, slight hue tint from primary ---
  const bgL = mode === 'light' ? 0.97 : 0.08;
  const bgS = clamp(primary.hsl.s * 0.08, 0, 0.08);
  const background = hslToHex({ h: primary.hsl.h, s: bgS, l: bgL });

  // --- Foreground: opposite extreme, slight hue tint ---
  const fgL = mode === 'light' ? 0.12 : 0.92;
  const fgS = clamp(primary.hsl.s * 0.06, 0, 0.06);
  const rawForeground = hslToHex({ h: primary.hsl.h, s: fgS, l: fgL });
  const foreground = enforceContrast(rawForeground, background, mode);

  // --- Muted: desaturated foreground ---
  const muted = adjustSaturation(foreground, 0.35);

  // --- Surface hierarchy ---
  const surface = adjustLightness(background, direction * 0.02);
  const surfaceElevated = adjustLightness(background, direction * 0.04);

  // --- Border: blend of background and foreground ---
  const border = mixHex(background, foreground, mode === 'light' ? 0.12 : 0.18);

  // --- Code block colors ---
  const codeBackground = adjustLightness(background, direction * 0.05);
  const codeForeground = adjustLightness(foreground, -direction * 0.08);

  // --- Input background ---
  const inputBackground = adjustLightness(background, direction * 0.025);

  // --- Button colors ---
  const buttonBackground = accentHex;
  // Pick the better contrast of black/white, then enforce WCAG AA.
  const simpleButtonFg = getContrastColor(accentHex).toUpperCase();
  const buttonFgContrast = contrastRatio(simpleButtonFg, buttonBackground);
  const buttonForeground =
    buttonFgContrast >= WCAG_AA
      ? simpleButtonFg
      : computeReadableTextColor(accentHex, WCAG_AA).toUpperCase();

  // --- Focus ring: accent at slightly different lightness ---
  const focusRing = adjustLightness(accentHex, direction * 0.1);

  const tokens: ThemeTokens = {
    accent: accentHex,
    secondary: secondaryHex,
    background,
    foreground,
    muted,
    surface,
    surfaceElevated,
    border,
    codeBackground,
    codeForeground,
    inputBackground,
    buttonBackground,
    buttonForeground,
    focusRing,
  };

  return {
    tokens,
    contrast: {
      textOnBackground: Math.round(contrastRatio(foreground, background) * 100) / 100,
      textOnButton: Math.round(contrastRatio(buttonForeground, buttonBackground) * 100) / 100,
      accentOnSurface: Math.round(contrastRatio(accentHex, surface) * 100) / 100,
    },
  };
}

/**
 * Validate that all tokens in a theme meet WCAG AA contrast requirements.
 *
 * Checks:
 *   - foreground vs background ≥ 4.5
 *   - buttonForeground vs buttonBackground ≥ 4.5
 *   - muted vs background ≥ 3.0 (large text threshold)
 *
 * @param tokens  The 14-token theme to validate.
 * @returns       An array of issues (empty if all pass).
 */
export function validateThemeContrast(tokens: ThemeTokens): string[] {
  const issues: string[] = [];

  if (contrastRatio(tokens.foreground, tokens.background) < WCAG_AA) {
    issues.push(
      `foreground/background contrast ${contrastRatio(tokens.foreground, tokens.background).toFixed(2)} < ${WCAG_AA}`,
    );
  }

  if (contrastRatio(tokens.buttonForeground, tokens.buttonBackground) < WCAG_AA) {
    issues.push(
      `button text contrast ${contrastRatio(tokens.buttonForeground, tokens.buttonBackground).toFixed(2)} < ${WCAG_AA}`,
    );
  }

  // Muted text only needs to pass large-text threshold (3.0).
  if (contrastRatio(tokens.muted, tokens.background) < 3.0) {
    issues.push(
      `muted/background contrast ${contrastRatio(tokens.muted, tokens.background).toFixed(2)} < 3.0`,
    );
  }

  return issues;
}
