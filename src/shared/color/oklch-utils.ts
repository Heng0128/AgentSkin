// SPDX-License-Identifier: MPL-2.0

/**
 * # OKLCH Color Space Utilities
 *
 * Perceptual color operations using the OKLCH color space (Ottoson 2020),
 * providing better perceptual uniformity than RGB/HSL for theme extraction.
 *
 * ## Why OKLCH
 *
 * Competing products (FujiwaraChoki/claude-theme, workbuddy-ambient-skin) use
 * OKLCH for palette extraction because:
 *   - Perceptual uniformity: equal numerical changes map to equal visual changes
 *   - Lightness (L) is decoupled from hue (H) and chroma (C)
 *   - Hue rotation preserves perceived brightness (unlike HSL)
 *   - WCAG contrast correlates strongly with OKLCH lightness difference
 *
 * ## Pipeline
 *
 * ```
 * sRGB [0-255] → linearize → LMS cube root → OKLab matrix → OKLCH (LCh)
 * ```
 *
 * Pure module — zero dependencies, no DOM/Electron APIs. Lives in the shared
 * color layer alongside `contrast-utils.ts` and `tonal-palette.ts`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** OKLCH color: L ∈ [0,1], C ∈ [0,∞), H ∈ [0,360). */
export interface Oklch {
  /** Perceptual lightness [0, 1]. */
  l: number;
  /** Chroma (colorfulness) [0, ~0.4] for sRGB gamut. */
  c: number;
  /** Hue angle in degrees [0, 360). */
  h: number;
}

/** RGB color as 8-bit channels [0, 255]. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// ---------------------------------------------------------------------------
// sRGB ↔ Linear RGB
// ---------------------------------------------------------------------------

/**
 * Expand a single sRGB channel [0, 1] to linear light [0, 1].
 *
 * sRGB gamma: c_lin = c_srgb / 12.92            if c_srgb ≤ 0.04045
 *             c_lin = ((c_srgb + 0.055) / 1.055)^2.4  otherwise
 */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Compress a single linear light channel [0, 1] to sRGB [0, 1].
 *
 * Inverse of `toLinear`.
 */
function toSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// Linear RGB ↔ OKLab
// ---------------------------------------------------------------------------

/**
 * Transformation matrix from linear sRGB to LMS (cone response space).
 *
 * From Ottoson's OKLab paper (Björn Ottoson, 2020). Column-major layout:
 * each inner array is a destination LMS component.
 */
const RGB_TO_LMS: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

/**
 * Transformation matrix from LMS′ (cube-rooted LMS) to OKLab.
 */
const LMS_PRIME_TO_OKLAB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

/**
 * Transformation matrix from OKLab to LMS′ (cube-rooted LMS).
 *
 * Inverse of `LMS_PRIME_TO_OKLAB`. First column is exactly 1.0 (per Ottoson's
 * original paper); using near-1.0 values from a numeric inverse introduces
 * floating-point noise that degrades round-trip accuracy at gamut corners.
 */
const _OKLAB_TO_LMS_PRIME: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.008958, -1.291485548],
];

/**
 * Transformation matrix from LMS to linear sRGB.
 *
 * Inverse of `RGB_TO_LMS`. Uses full double-precision coefficients from
 * Ottoson's reference implementation to minimize round-trip error at gamut
 * corners (pure red/blue/green).
 */
const LMS_TO_RGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/**
 * Full-precision matrix from OKLab to LMS′ (cube-rooted LMS).
 *
 * Exact 3×3 inverse of `LMS_PRIME_TO_OKLAB`, computed via Gaussian elimination
 * to minimize round-trip error at gamut corners. The published values
 * (e.g. −0.0089580000) are rounded and introduce ~0.018 error in s′ for
 * pure red; these full-precision values reduce that to <0.001.
 */
const OKLAB_TO_LMS_PRIME_FULL: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.9999999984505197, 0.3963377921737678, 0.2158037580607588],
  [1.000000008881761, -0.1055613423236563, -0.06385417477170588],
  [1.000000054672411, -0.08948418209496574, -1.291485537864092],
];

// ---------------------------------------------------------------------------
// Cube root (handles negative values for out-of-gamut colors)
// ---------------------------------------------------------------------------

/** Real cube root: preserves sign (unlike Math.pow which returns NaN for negatives). */
function cbrt(x: number): number {
  return Math.sign(x) * Math.abs(x) ** (1 / 3);
}

// ---------------------------------------------------------------------------
// Public API: RGB → OKLCH
// ---------------------------------------------------------------------------

/**
 * Convert an 8-bit sRGB color to OKLCH.
 *
 * @param rgb  Red, green, blue channels [0, 255].
 * @returns    OKLCH color with L ∈ [0,1], C ∈ [0,∞), H ∈ [0,360).
 *
 * @example
 * ```ts
 * rgbToOklch({ r: 255, g: 0, b: 0 }) // → { l: ~0.628, c: ~0.257, h: ~29.2 }
 * rgbToOklch({ r: 0, g: 0, b: 0 })   // → { l: 0, c: 0, h: 0 }
 * rgbToOklch({ r: 255, g: 255, b: 255 }) // → { l: 1, c: 0, h: 0 }
 * ```
 */
export function rgbToOklch(rgb: Rgb): Oklch {
  // Step 1: Normalize and linearize sRGB channels.
  // Clamp to [0, 1] first to avoid negative values from out-of-range inputs.
  const rs = Math.min(1, Math.max(0, rgb.r / 255));
  const gs = Math.min(1, Math.max(0, rgb.g / 255));
  const bs = Math.min(1, Math.max(0, rgb.b / 255));
  const rl = toLinear(rs);
  const gl = toLinear(gs);
  const bl = toLinear(bs);

  // Step 2: Convert linear RGB to LMS (cone response).
  const lLms = RGB_TO_LMS[0][0] * rl + RGB_TO_LMS[0][1] * gl + RGB_TO_LMS[0][2] * bl;
  const mLms = RGB_TO_LMS[1][0] * rl + RGB_TO_LMS[1][1] * gl + RGB_TO_LMS[1][2] * bl;
  const sLms = RGB_TO_LMS[2][0] * rl + RGB_TO_LMS[2][1] * gl + RGB_TO_LMS[2][2] * bl;

  // Step 3: Apply cube-root nonlinearity (perceptual uniformity).
  const lPrime = cbrt(lLms);
  const mPrime = cbrt(mLms);
  const sPrime = cbrt(sLms);

  // Step 4: Convert LMS′ to OKLab (perceptual opponent space).
  const lOk =
    LMS_PRIME_TO_OKLAB[0][0] * lPrime +
    LMS_PRIME_TO_OKLAB[0][1] * mPrime +
    LMS_PRIME_TO_OKLAB[0][2] * sPrime;
  const aOk =
    LMS_PRIME_TO_OKLAB[1][0] * lPrime +
    LMS_PRIME_TO_OKLAB[1][1] * mPrime +
    LMS_PRIME_TO_OKLAB[1][2] * sPrime;
  const bOk =
    LMS_PRIME_TO_OKLAB[2][0] * lPrime +
    LMS_PRIME_TO_OKLAB[2][1] * mPrime +
    LMS_PRIME_TO_OKLAB[2][2] * sPrime;

  // Step 5: Convert OKLab (Cartesian) to OKLCH (polar).
  const c = Math.sqrt(aOk * aOk + bOk * bOk);
  let h = (Math.atan2(bOk, aOk) * 180) / Math.PI;
  if (h < 0) h += 360;
  if (Number.isNaN(h)) h = 0; // achromatic (c=0) → hue undefined, default to 0

  return { l: lOk, c, h };
}

// ---------------------------------------------------------------------------
// Public API: OKLCH → RGB
// ---------------------------------------------------------------------------

/**
 * Convert an OKLCH color back to 8-bit sRGB.
 *
 * Clamps the result to [0, 255]. Out-of-gamut colors (high chroma) will be
 * clipped; callers that need gamut mapping should pre-check with `isInGamut()`.
 *
 * @param oklch  OKLCH color (L ∈ [0,1], C ≥ 0, H ∈ [0,360)).
 * @returns      Clamped RGB channels [0, 255].
 *
 * @example
 * ```ts
 * oklchToRgb({ l: 0.7, c: 0.15, h: 120 })
 * // → { r: ~87, g: ~196, b: ~106 }
 * ```
 */
export function oklchToRgb(oklch: Oklch): Rgb {
  const l = oklch.l;
  const c = Math.max(0, oklch.c);
  const hRad = (oklch.h * Math.PI) / 180;

  // Step 1: Polar → Cartesian (OKLab).
  const aOk = c * Math.cos(hRad);
  const bOk = c * Math.sin(hRad);

  // Step 2: OKLab → LMS′ (use full-precision inverse matrix).
  const lPrime =
    OKLAB_TO_LMS_PRIME_FULL[0][0] * l +
    OKLAB_TO_LMS_PRIME_FULL[0][1] * aOk +
    OKLAB_TO_LMS_PRIME_FULL[0][2] * bOk;
  const mPrime =
    OKLAB_TO_LMS_PRIME_FULL[1][0] * l +
    OKLAB_TO_LMS_PRIME_FULL[1][1] * aOk +
    OKLAB_TO_LMS_PRIME_FULL[1][2] * bOk;
  const sPrime =
    OKLAB_TO_LMS_PRIME_FULL[2][0] * l +
    OKLAB_TO_LMS_PRIME_FULL[2][1] * aOk +
    OKLAB_TO_LMS_PRIME_FULL[2][2] * bOk;

  // Step 3: LMS′ → LMS (reverse cube root = cube).
  const lLms = lPrime * lPrime * lPrime;
  const mLms = mPrime * mPrime * mPrime;
  const sLms = sPrime * sPrime * sPrime;

  // Step 4: LMS → linear RGB.
  const rl = LMS_TO_RGB[0][0] * lLms + LMS_TO_RGB[0][1] * mLms + LMS_TO_RGB[0][2] * sLms;
  const gl = LMS_TO_RGB[1][0] * lLms + LMS_TO_RGB[1][1] * mLms + LMS_TO_RGB[1][2] * sLms;
  const bl = LMS_TO_RGB[2][0] * lLms + LMS_TO_RGB[2][1] * mLms + LMS_TO_RGB[2][2] * sLms;

  // Step 5: Linear → sRGB + compress + quantize.
  const r = Math.min(255, Math.max(0, Math.round(toSrgb(rl) * 255)));
  const g = Math.min(255, Math.max(0, Math.round(toSrgb(gl) * 255)));
  const b = Math.min(255, Math.max(0, Math.round(toSrgb(bl) * 255)));

  return { r, g, b };
}

// ---------------------------------------------------------------------------
// Perceptual lightness
// ---------------------------------------------------------------------------

/**
 * Compute the OKLCH perceptual lightness (L) for an 8-bit sRGB color.
 *
 * This correlates with human brightness perception far better than the
 * WCAG relative luminance formula. Two colors with the same OKLCH L value
 * will appear equally bright to a human observer regardless of hue.
 *
 * @param rgb  8-bit RGB channels [0, 255].
 * @returns    Perceptual lightness [0, 1].
 */
export function oklchLightness(rgb: Rgb): number {
  return rgbToOklch(rgb).l;
}

// ---------------------------------------------------------------------------
// Perceptual contrast (WCAG approximation via OKLCH lightness)
// ---------------------------------------------------------------------------

/**
 * Compute a perceptual contrast ratio between two sRGB colors using OKLCH
 * lightness difference, normalized to the WCAG 2.1 [1, 21] range.
 *
 * This is NOT a replacement for `contrastRatio()` from `contrast-utils.ts` (which
 * uses the official WCAG formula). It is a fast approximation that correlates
 * well with WCAG contrast because OKLCH L is approximately CIE perceptual lightness.
 *
 * Formula: contrast = (L1 + 0.05) / (L2 + 0.05) where L1 > L2.
 *
 * This matches the WCAG structure but uses OKLCH L instead of WCAG luminance.
 *
 * @param rgb1  First sRGB color.
 * @param rgb2  Second sRGB color.
 * @returns     Perceptual contrast ratio [1, ~21].
 */
export function oklchContrast(rgb1: Rgb, rgb2: Rgb): number {
  const l1 = rgbToOklch(rgb1).l;
  const l2 = rgbToOklch(rgb2).l;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Compute the official WCAG 2.1 contrast ratio between two sRGB colors,
 * using OKLCH for perceptual sorting (lighter/darker) but WCAG luminance
 * for the actual ratio. This gives correct WCAG values while leveraging
 * OKLCH for consistent lightness ordering.
 *
 * @param rgb1  First sRGB color [0-255].
 * @param rgb2  Second sRGB color [0-255].
 * @returns     WCAG 2.1 contrast ratio [1, 21].
 */
export function oklchWcagContrast(rgb1: Rgb, rgb2: Rgb): number {
  // Linearize each channel and compute WCAG luminance.
  const lum = (rgb: Rgb): number => {
    const [lr, lg, lb] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((s) =>
      s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };

  const l1 = lum(rgb1);
  const l2 = lum(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Hue rotation
// ---------------------------------------------------------------------------

/**
 * Rotate the hue of an OKLCH color by a given number of degrees.
 *
 * Preserves perceptual lightness and chroma — the result will look
 * equally bright and saturated, just a different hue. This is the key
 * advantage over HSL hue rotation, which can produce visibly brighter
 * or darker results (e.g. rotating HSL hue from blue to yellow makes it
 * much brighter in HSL but not in OKLCH).
 *
 * @param oklch    Input OKLCH color.
 * @param degrees  Degrees to rotate (positive = counter-clockwise).
 * @returns        New OKLCH color with rotated hue.
 *
 * @example
 * ```ts
 * const red = rgbToOklch({ r: 255, g: 0, b: 0 });
 * // red.h ≈ 29°
 * const green = rotateHue(red, 120);
 * // green.h ≈ 149° (visually similar brightness)
 * ```
 */
export function rotateHue(oklch: Oklch, degrees: number): Oklch {
  let newH = (oklch.h + degrees) % 360;
  if (newH < 0) newH += 360;
  return { l: oklch.l, c: oklch.c, h: newH };
}

/**
 * Convert RGB → OKLCH, rotate hue, then convert back to RGB.
 *
 * Convenience wrapper around `rgbToOklch → rotateHue → oklchToRgb`.
 *
 * @param rgb      Input 8-bit sRGB color.
 * @param degrees  Degrees to rotate.
 * @returns        Rotated color as 8-bit sRGB.
 */
export function rotateRgbHue(rgb: Rgb, degrees: number): Rgb {
  return oklchToRgb(rotateHue(rgbToOklch(rgb), degrees));
}

// ---------------------------------------------------------------------------
// Gamut check
// ---------------------------------------------------------------------------

/**
 * Check whether an OKLCH color falls within the sRGB gamut.
 *
 * Returns true if `oklchToRgb(color)` round-trips back to the same color
 * within a tolerance of ±2 levels per channel. Useful for detecting when
 * high-chroma OKLCH colors will produce out-of-gamut clipping.
 *
 * @param oklch  OKLCH color to test.
 * @returns      True if the color is reproducible in sRGB.
 */
export function isInGamut(oklch: Oklch): boolean {
  const rgb = oklchToRgb(oklch);
  const roundTrip = rgbToOklch(rgb);
  const dl = Math.abs(roundTrip.l - oklch.l);
  const dc = Math.abs(roundTrip.c - oklch.c);
  // Hue is meaningless for near-achromatic colors; skip hue check when C < 0.001.
  const dh = oklch.c < 0.001 ? 0 : hueDistance(roundTrip.h, oklch.h);
  return dl < 0.02 && dc < 0.02 && dh < 5;
}

/** Shortest hue distance (0–180) accounting for circular wrap. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// Hex helpers (shortcut for integration with existing hex-based pipeline)
// ---------------------------------------------------------------------------

/**
 * Parse a #rrggbb hex string to Rgb. Returns null on invalid input.
 */
export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/**
 * Format Rgb channels as a #rrggbb lowercase hex string.
 */
export function formatHex(rgb: Rgb): string {
  const ch = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(rgb.r)}${ch(rgb.g)}${ch(rgb.b)}`;
}

/**
 * Convert a hex string directly to OKLCH. Returns null on invalid input.
 */
export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToOklch(rgb) : null;
}

/**
 * Convert OKLCH directly to a #rrggbb hex string.
 */
export function oklchToHex(oklch: Oklch): string {
  return formatHex(oklchToRgb(oklch));
}

// ---------------------------------------------------------------------------
// Palette generation: harmonious color schemes
// ---------------------------------------------------------------------------

/**
 * Generate a complementary color (opposite hue, 180° rotation).
 */
export function complementary(oklch: Oklch): Oklch {
  return rotateHue(oklch, 180);
}

/**
 * Generate an analogous color scheme (±30° hue shifts).
 *
 * Returns [−30°, original, +30°] in that order.
 */
export function analogous(oklch: Oklch): [Oklch, Oklch, Oklch] {
  return [rotateHue(oklch, -30), { ...oklch }, rotateHue(oklch, 30)];
}

/**
 * Generate a triadic color scheme (120° apart).
 *
 * Returns [original, +120°, +240°] in that order.
 */
export function triadic(oklch: Oklch): [Oklch, Oklch, Oklch] {
  return [{ ...oklch }, rotateHue(oklch, 120), rotateHue(oklch, 240)];
}

/**
 * Generate a split-complementary scheme (original, +150°, −150°).
 *
 * Returns [original, +150°, +210°] (i.e. ±150° from original).
 */
export function splitComplementary(oklch: Oklch): [Oklch, Oklch, Oklch] {
  return [{ ...oklch }, rotateHue(oklch, 150), rotateHue(oklch, 210)];
}

/**
 * Generate a monochromatic scale by varying lightness.
 *
 * Produces `steps` colors from the same hue/chroma, evenly spaced in
 * OKLCH lightness from 0.1 to 0.95.
 *
 * @param oklch  Base color (hue and chroma are preserved).
 * @param steps  Number of lightness steps (default: 5).
 * @returns      Array of OKLCH colors ordered darkest → lightest.
 */
export function monochromatic(oklch: Oklch, steps = 5): Oklch[] {
  const result: Oklch[] = [];
  const clampedSteps = Math.max(2, Math.min(20, steps));
  for (let i = 0; i < clampedSteps; i++) {
    const t = clampedSteps === 1 ? 0.5 : i / (clampedSteps - 1);
    const l = 0.1 + t * 0.85; // range [0.1, 0.95]
    result.push({ l, c: oklch.c, h: oklch.h });
  }
  return result;
}

/**
 * Sort an array of sRGB colors by perceptual lightness (darkest first).
 *
 * Uses OKLCH L, which sorts more naturally than WCAG luminance because it
 * properly weights all three channels according to perceived brightness.
 *
 * @param colors  Array of 8-bit sRGB colors.
 * @returns       New array sorted by ascending OKLCH lightness.
 */
export function sortByLightness(colors: Rgb[]): Rgb[] {
  return [...colors].sort((a, b) => rgbToOklch(a).l - rgbToOklch(b).l);
}
