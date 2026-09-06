// SPDX-License-Identifier: MPL-2.0

/**
 * # Color Quantizer — Dual-Path (sRGB / OKLCH) Median Cut
 *
 * Provides median-cut color quantization in two color spaces:
 *
 * - **sRGB path** — operates directly on R, G, B channels. This is the legacy
 *   behavior: fast, well-understood, but not perceptually uniform (equal
 *   numerical distances do not map to equal perceived differences).
 * - **OKLCH path** — converts to OKLab (Cartesian form of OKLCH), performs
 *   median cut on the L, a, b axes, then converts back to sRGB. Because OKLab
 *   is perceptually uniform, equal distances correspond to equal perceived
 *   differences, producing more natural palette extraction.
 *
 * The OKLCH path is the recommended default for image-based theme extraction
 * because it aligns with human perception: the dominant colors it finds are
 * the ones a human would name as "the main colors in this image".
 *
 * ## Algorithm: Median Cut
 *
 * 1. Start with one box containing all pixels.
 * 2. While the number of boxes < `colorCount`:
 *    a. Find the box with the largest range along any axis.
 *    b. Sort the pixels in that box along that axis.
 *    c. Split at the median into two child boxes.
 * 3. Average each box to obtain the representative color.
 *
 * The median cut is O(colorCount × n log n) and works well for the small
 * pixel counts typical of image-based theme extraction (images are sampled
 * down to ~48 px wide before processing).
 *
 * ## Design
 *
 * Pure module — zero external dependencies, no DOM/Electron APIs. Lives in
 * the shared color layer alongside `oklch-utils.ts`, `contrast-utils.ts`,
 * and `tonal-palette.ts`.
 *
 * The conversion functions (`rgbToOklch`, `oklchToRgb`) use the same
 * well-tested matrices from Björn Ottoson's OKLab paper (2020) that are also
 * used in `oklch-utils.ts`. They are reimplemented here with standalone
 * number-argument signatures to keep this module self-contained.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** RGB pixel as 8-bit channels [0, 255]. */
export interface RgbPixel {
  r: number;
  g: number;
  b: number;
}

/** Color space selector for the unified `quantize` entry point. */
export type ColorSpace = 'srgb' | 'oklch';

/** Internal 3D point used by the generic median cut engine. */
interface Vec3 {
  x: number;
  y: number;
  z: number;
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
// Linear RGB ↔ OKLab (Cartesian form of OKLCH)
// ---------------------------------------------------------------------------

/**
 * Transformation matrix from linear sRGB to LMS (cone response space).
 *
 * From Ottoson's OKLab paper (Björn Ottoson, 2020). Each inner array is a
 * destination LMS component.
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
 * Full-precision matrix from OKLab to LMS′ (cube-rooted LMS).
 *
 * Exact 3×3 inverse of `LMS_PRIME_TO_OKLAB`, computed via Gaussian elimination
 * to minimize round-trip error at gamut corners.
 */
const OKLAB_TO_LMS_PRIME: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.9999999984505197, 0.3963377921737678, 0.2158037580607588],
  [1.000000008881761, -0.1055613423236563, -0.06385417477170588],
  [1.000000054672411, -0.08948418209496574, -1.291485537864092],
];

/**
 * Transformation matrix from LMS to linear sRGB.
 *
 * Inverse of `RGB_TO_LMS`. Uses full double-precision coefficients from
 * Ottoson's reference implementation.
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

// ---------------------------------------------------------------------------
// Cube root (handles negative values for out-of-gamut colors)
// ---------------------------------------------------------------------------

/** Real cube root: preserves sign (unlike Math.pow which returns NaN for negatives). */
function cbrt(x: number): number {
  return Math.sign(x) * Math.abs(x) ** (1 / 3);
}

// ---------------------------------------------------------------------------
// Internal: RGB → OKLab (Cartesian, no trig — efficient for quantization)
// ---------------------------------------------------------------------------

/**
 * Convert an 8-bit sRGB pixel to OKLab (Cartesian form of OKLCH).
 *
 * OKLab is the Cartesian representation of the same perceptual space that
 * OKLCH expresses in polar coordinates (L, C, H). Using Cartesian (L, a, b)
 * avoids the circular-hue problem during median cut splitting.
 *
 * @param r  Red channel [0, 255].
 * @param g  Green channel [0, 255].
 * @param b  Blue channel [0, 255].
 * @returns  OKLab coordinates { l, a, b }.
 */
function rgbToOklab(r: number, g: number, b: number): Vec3 {
  // Normalize and linearize.
  const rs = Math.min(1, Math.max(0, r / 255));
  const gs = Math.min(1, Math.max(0, g / 255));
  const bs = Math.min(1, Math.max(0, b / 255));
  const rl = toLinear(rs);
  const gl = toLinear(gs);
  const bl = toLinear(bs);

  // Linear RGB → LMS.
  const lLms = RGB_TO_LMS[0][0] * rl + RGB_TO_LMS[0][1] * gl + RGB_TO_LMS[0][2] * bl;
  const mLms = RGB_TO_LMS[1][0] * rl + RGB_TO_LMS[1][1] * gl + RGB_TO_LMS[1][2] * bl;
  const sLms = RGB_TO_LMS[2][0] * rl + RGB_TO_LMS[2][1] * gl + RGB_TO_LMS[2][2] * bl;

  // Cube-root nonlinearity.
  const lPrime = cbrt(lLms);
  const mPrime = cbrt(mLms);
  const sPrime = cbrt(sLms);

  // LMS′ → OKLab.
  return {
    x:
      LMS_PRIME_TO_OKLAB[0][0] * lPrime +
      LMS_PRIME_TO_OKLAB[0][1] * mPrime +
      LMS_PRIME_TO_OKLAB[0][2] * sPrime,
    y:
      LMS_PRIME_TO_OKLAB[1][0] * lPrime +
      LMS_PRIME_TO_OKLAB[1][1] * mPrime +
      LMS_PRIME_TO_OKLAB[1][2] * sPrime,
    z:
      LMS_PRIME_TO_OKLAB[2][0] * lPrime +
      LMS_PRIME_TO_OKLAB[2][1] * mPrime +
      LMS_PRIME_TO_OKLAB[2][2] * sPrime,
  };
}

/**
 * Convert OKLab coordinates back to an 8-bit sRGB pixel.
 *
 * @param l  OKLab L (perceptual lightness).
 * @param a  OKLab a (green–red opponent).
 * @param b  OKLab b (blue–yellow opponent).
 * @returns  Clamped RGB channels [0, 255].
 */
function oklabToRgb(l: number, a: number, b: number): RgbPixel {
  // OKLab → LMS′.
  const lPrime =
    OKLAB_TO_LMS_PRIME[0][0] * l + OKLAB_TO_LMS_PRIME[0][1] * a + OKLAB_TO_LMS_PRIME[0][2] * b;
  const mPrime =
    OKLAB_TO_LMS_PRIME[1][0] * l + OKLAB_TO_LMS_PRIME[1][1] * a + OKLAB_TO_LMS_PRIME[1][2] * b;
  const sPrime =
    OKLAB_TO_LMS_PRIME[2][0] * l + OKLAB_TO_LMS_PRIME[2][1] * a + OKLAB_TO_LMS_PRIME[2][2] * b;

  // LMS′ → LMS (reverse cube root = cube).
  const lLms = lPrime * lPrime * lPrime;
  const mLms = mPrime * mPrime * mPrime;
  const sLms = sPrime * sPrime * sPrime;

  // LMS → linear RGB.
  const rl = LMS_TO_RGB[0][0] * lLms + LMS_TO_RGB[0][1] * mLms + LMS_TO_RGB[0][2] * sLms;
  const gl = LMS_TO_RGB[1][0] * lLms + LMS_TO_RGB[1][1] * mLms + LMS_TO_RGB[1][2] * sLms;
  const bl = LMS_TO_RGB[2][0] * lLms + LMS_TO_RGB[2][1] * mLms + LMS_TO_RGB[2][2] * sLms;

  // Linear → sRGB + quantize.
  return {
    r: Math.min(255, Math.max(0, Math.round(toSrgb(rl) * 255))),
    g: Math.min(255, Math.max(0, Math.round(toSrgb(gl) * 255))),
    b: Math.min(255, Math.max(0, Math.round(toSrgb(bl) * 255))),
  };
}

// ---------------------------------------------------------------------------
// Public API: RGB → OKLCH / OKLCH → RGB (standalone number-argument signatures)
// ---------------------------------------------------------------------------

/**
 * Convert an 8-bit sRGB color to OKLCH.
 *
 * @param r  Red channel [0, 255].
 * @param g  Green channel [0, 255].
 * @param b  Blue channel [0, 255].
 * @returns  OKLCH color with L ∈ [0, 1], C ∈ [0, ∞), H ∈ [0, 360).
 *
 * @example
 * ```ts
 * rgbToOklch(255, 0, 0) // → { l: ~0.628, c: ~0.257, h: ~29.2 }
 * rgbToOklch(0, 0, 0)   // → { l: 0, c: 0, h: 0 }
 * ```
 */
export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const oklab = rgbToOklab(r, g, b);
  const c = Math.sqrt(oklab.y * oklab.y + oklab.z * oklab.z);
  let h = (Math.atan2(oklab.z, oklab.y) * 180) / Math.PI;
  if (h < 0) h += 360;
  if (Number.isNaN(h)) h = 0; // achromatic → hue undefined, default to 0
  return { l: oklab.x, c, h };
}

/**
 * Convert an OKLCH color back to 8-bit sRGB.
 *
 * Clamps the result to [0, 255]. Out-of-gamut colors (high chroma) will be
 * clipped.
 *
 * @param l  Perceptual lightness [0, 1].
 * @param c  Chroma [0, ~0.4] for sRGB gamut.
 * @param h  Hue angle in degrees [0, 360).
 * @returns  Clamped RGB channels [0, 255].
 *
 * @example
 * ```ts
 * oklchToRgb(0.7, 0.15, 120) // → { r: ~87, g: ~196, b: ~106 }
 * ```
 */
export function oklchToRgb(l: number, c: number, h: number): RgbPixel {
  const clampedC = Math.max(0, c);
  const hRad = (h * Math.PI) / 180;
  const aOk = clampedC * Math.cos(hRad);
  const bOk = clampedC * Math.sin(hRad);
  return oklabToRgb(l, aOk, bOk);
}

// ---------------------------------------------------------------------------
// Quantization: Median Cut
// ---------------------------------------------------------------------------

/**
 * Quantize a list of pixels to a target number of representative colors using
 * the median cut algorithm.
 *
 * @param pixels      Input pixels to quantize.
 * @param colorCount  Number of colors to reduce to (≥ 1).
 * @param colorSpace  Color space for distance computation: 'srgb' or 'oklch'.
 * @returns           Array of representative colors (length ≤ colorCount).
 */
export function quantize(
  pixels: RgbPixel[],
  colorCount: number,
  colorSpace: ColorSpace = 'srgb',
): RgbPixel[] {
  if (colorSpace === 'oklch') {
    return quantizeOklch(pixels, colorCount);
  }
  return quantizeSrgb(pixels, colorCount);
}

/**
 * Quantize in sRGB space (legacy path).
 *
 * Operates directly on R, G, B channels. Fast but not perceptually uniform.
 *
 * @param pixels      Input pixels to quantize.
 * @param colorCount  Number of colors to reduce to (≥ 1).
 * @returns           Array of representative colors as 8-bit sRGB.
 */
export function quantizeSrgb(pixels: RgbPixel[], colorCount: number): RgbPixel[] {
  return medianCut(pixels, colorCount, 'srgb');
}

/**
 * Quantize in OKLCH space (perceptual path).
 *
 * Converts to OKLab (Cartesian form of OKLCH), performs median cut on the
 * L, a, b axes, then converts back to sRGB. Produces more perceptually
 * uniform results than the sRGB path.
 *
 * @param pixels      Input pixels to quantize.
 * @param colorCount  Number of colors to reduce to (≥ 1).
 * @returns           Array of representative colors as 8-bit sRGB.
 */
export function quantizeOklch(pixels: RgbPixel[], colorCount: number): RgbPixel[] {
  return medianCut(pixels, colorCount, 'oklch');
}

// ---------------------------------------------------------------------------
// Internal: generic median cut engine
// ---------------------------------------------------------------------------

/**
 * Generic median cut implementation that operates on 3D points.
 *
 * @param pixels      Input pixels.
 * @param colorCount  Target number of colors.
 * @param space       'srgb' for direct RGB, 'oklch' for OKLab.
 * @returns           Representative colors as 8-bit sRGB.
 */
function medianCut(pixels: RgbPixel[], colorCount: number, space: ColorSpace): RgbPixel[] {
  if (pixels.length === 0) return [];
  const target = Math.max(1, Math.min(colorCount, pixels.length));

  // Convert to working-space points.
  const points: Vec3[] = pixels.map((p) => {
    if (space === 'oklch') {
      return rgbToOklab(p.r, p.g, p.b);
    }
    return { x: p.r, y: p.g, z: p.b };
  });

  // Start with one box containing all points.
  const boxes: Vec3[][] = [points];

  while (boxes.length < target) {
    // Find the box with the largest range along any axis.
    let bestBoxIdx = -1;
    let bestRange = 0;
    let bestAxis = 0;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue; // cannot split a single-pixel box

      for (let axis = 0; axis < 3; axis++) {
        const range = boxRange(box, axis);
        if (range > bestRange) {
          bestRange = range;
          bestBoxIdx = i;
          bestAxis = axis;
        }
      }
    }

    // If no box can be split (all single-pixel or zero-range), stop early.
    if (bestBoxIdx === -1) break;

    // Sort the chosen box along the chosen axis and split at the median.
    const box = boxes[bestBoxIdx];
    box.sort((a, b) => getAxis(a, bestAxis) - getAxis(b, bestAxis));
    const median = Math.floor(box.length / 2);
    const left = box.slice(0, median);
    const right = box.slice(median);

    // Replace the original box with its two children.
    boxes.splice(bestBoxIdx, 1, left, right);
  }

  // Average each box to get the representative color.
  return boxes.map((box) => averageBox(box, space));
}

/**
 * Compute the range (max − min) of a box along a given axis.
 *
 * @param box   Array of 3D points.
 * @param axis  Axis index (0 = x/L, 1 = y/a, 2 = z/b).
 * @returns     Range along the axis.
 */
function boxRange(box: Vec3[], axis: number): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of box) {
    const v = getAxis(p, axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/**
 * Get the value of a Vec3 along a given axis.
 *
 * @param p     3D point.
 * @param axis  Axis index (0 = x, 1 = y, 2 = z).
 * @returns     Coordinate value.
 */
function getAxis(p: Vec3, axis: number): number {
  return axis === 0 ? p.x : axis === 1 ? p.y : p.z;
}

/**
 * Compute the average color of a box and convert back to 8-bit sRGB.
 *
 * @param box   Array of 3D points in working space.
 * @param space 'srgb' or 'oklch' — determines how to convert back to RGB.
 * @returns     Average color as 8-bit sRGB.
 */
function averageBox(box: Vec3[], space: ColorSpace): RgbPixel {
  if (box.length === 0) return { r: 0, g: 0, b: 0 };

  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of box) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  const n = box.length;
  const avg = { x: sx / n, y: sy / n, z: sz / n };

  if (space === 'oklch') {
    return oklabToRgb(avg.x, avg.y, avg.z);
  }
  // sRGB path: coordinates are already R, G, B.
  return {
    r: Math.min(255, Math.max(0, Math.round(avg.x))),
    g: Math.min(255, Math.max(0, Math.round(avg.y))),
    b: Math.min(255, Math.max(0, Math.round(avg.z))),
  };
}
