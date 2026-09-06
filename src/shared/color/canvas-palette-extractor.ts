// SPDX-License-Identifier: MPL-2.0

/**
 * # Canvas Palette Extractor
 *
 * Extracts a 4-tone palette (accent / secondary / surface / text) from a
 * Canvas element using saturation-weighted HSL bucket quantization. This is
 * the general-purpose "Canvas -> 4-tone" pipeline that can run in both the
 * renderer process (HTMLCanvasElement) and the main process (OffscreenCanvas).
 *
 * ## Algorithm
 *
 * 1. **Filter** -- skip transparent pixels (alpha < 128), low-saturation
 *    pixels (s < 0.08, i.e. near-greyscale), and too-dark pixels
 *    (l < 0.04, i.e. near-black). This ensures only meaningful colors
 *    contribute to the palette.
 * 2. **Hue bucketing** -- each surviving pixel is converted to HSL and placed
 *    in one of 12 buckets: 6 hue sectors (60 degrees each) x 2 saturation
 *    levels (low < 0.5, high >= 0.5). Bucket weight = sum(saturation^2) so
 *    vivid colors dominate.
 * 3. **Accent** -- the highest-weight bucket's average color. This is the
 *    dominant brand/action color.
 * 4. **Secondary** -- the next bucket whose hue is > 50 degrees away from
 *    accent, guaranteeing visual distinction. Falls back to analogous (+60).
 * 5. **Surface** -- derived from the image's global average color, pushed to
 *    a neutral lightness appropriate for the detected mode and tinted with
 *    the average hue.
 * 6. **Text** -- opposite extreme from surface, with WCAG AA contrast
 *    (>= 4.5:1) enforced.
 * 7. **Mode** -- average luminance >= 0.5 -> light, otherwise dark.
 *
 * ## Design
 *
 * The core algorithm (`extractFromPixels`) is a pure function over raw RGBA
 * data -- no DOM, no Canvas -- so it can be unit-tested in a Node environment.
 * The Canvas I/O wrapper (`extractFromCanvas`) reads pixels from a Canvas
 * element and delegates to the pure core.
 *
 * Reuses color primitives from `contrast-utils.ts` and `tonal-palette.ts`
 * to stay consistent with the shared layer's existing conversions.
 *
 * Inspired by:
 *   - workbuddy-skin-studio's saturation-weighted HSL quantization
 *   - pywal's color extraction (histogram + saturation weighting)
 *   - Material You's hue-sector quantization
 */

import { contrastRatio, wcagRelativeLuminance } from '../contrast-utils';
import { type HslColor, hslToHex } from '../tonal-palette';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 4-tone palette extracted from a Canvas for AgentSkin theming. */
export interface Tone4Palette {
  /** Primary brand / action color (highest-weight hue bucket). */
  accent: string;
  /** Secondary brand color (hue > 50 degrees from accent). */
  secondary: string;
  /** Page surface color (neutral, derived from global average). */
  surface: string;
  /** Primary text color (opposite extreme from surface). */
  text: string;
  /** Detected color mode. */
  mode: 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of hue sectors (60 degrees each). */
const HUE_SECTORS = 6;

/** Number of saturation levels (low / high). */
const SAT_LEVELS = 2;

/** Total hue buckets = HUE_SECTORS x SAT_LEVELS. */
const BUCKET_COUNT = HUE_SECTORS * SAT_LEVELS;

/** Width of each hue sector in degrees. */
const HUE_SECTOR_WIDTH = 360 / HUE_SECTORS;

/** Saturation threshold separating low from high level. */
const SAT_THRESHOLD = 0.5;

/** Minimum saturation for a pixel to be considered (filters greyscale). */
const MIN_SATURATION = 0.08;

/** Minimum lightness for a pixel to be considered (filters near-black). */
const MIN_LIGHTNESS = 0.04;

/** Minimum hue distance (degrees) between accent and secondary. */
const MIN_HUE_DISTANCE = 50;

/** Luminance threshold for light/dark mode classification. */
const LUMINANCE_MID = 0.5;

/** WCAG 2.1 AA contrast threshold for normal text. */
const WCAG_AA = 4.5;

// ---------------------------------------------------------------------------
// Hue bucket internals
// ---------------------------------------------------------------------------

/**
 * Accumulator for a single hue bucket. Hue is stored as sin/cos sums so the
 * circular mean can be computed without wraparound artifacts (e.g. the
 * average of 350 degrees and 10 degrees is 0, not 180).
 */
interface HueBucket {
  /** Total weight (sum saturation^2) in this bucket. */
  weight: number;
  /** Weighted sum of sin(hue). */
  sinSum: number;
  /** Weighted sum of cos(hue). */
  cosSum: number;
  /** Weighted sum of saturation. */
  sSum: number;
  /** Weighted sum of lightness. */
  lSum: number;
  /** Number of pixels in this bucket. */
  count: number;
}

function createBuckets(): HueBucket[] {
  return Array.from({ length: BUCKET_COUNT }, () => ({
    weight: 0,
    sinSum: 0,
    cosSum: 0,
    sSum: 0,
    lSum: 0,
    count: 0,
  }));
}

/** Map an HSL color to its bucket index (0-11). */
function bucketIndex(h: number, s: number): number {
  const sector = Math.min(HUE_SECTORS - 1, Math.floor(h / HUE_SECTOR_WIDTH));
  const level = s >= SAT_THRESHOLD ? 1 : 0;
  return sector + level * HUE_SECTORS;
}

/** Compute the circular-mean hue of a bucket in degrees [0, 360). */
function bucketHue(bucket: HueBucket): number {
  const h = (Math.atan2(bucket.sinSum, bucket.cosSum) * 180) / Math.PI;
  return ((h % 360) + 360) % 360;
}

/** Compute the weighted-average HSL color of a bucket. */
function bucketColor(bucket: HueBucket): HslColor {
  const weight = bucket.weight || 1;
  return {
    h: bucketHue(bucket),
    s: bucket.sSum / weight,
    l: bucket.lSum / weight,
  };
}

// ---------------------------------------------------------------------------
// Hue helpers
// ---------------------------------------------------------------------------

/** Shortest distance between two hues on the color wheel (0-180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------
// RGB -> HSL (inlined for per-pixel performance)
// ---------------------------------------------------------------------------

/**
 * Convert 8-bit RGB channels to HSL. Same algorithm as `tonal-palette.ts`
 * but inlined to avoid hex string roundtrips inside the pixel loop.
 */
function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

// ---------------------------------------------------------------------------
// Core: extract 4-tone palette from raw RGBA pixels (pure, no DOM)
// ---------------------------------------------------------------------------

/**
 * Extract a 4-tone palette from raw RGBA pixel data.
 *
 * Pure function -- no Canvas, no DOM. Accepts the same `Uint8ClampedArray`
 * that `CanvasRenderingContext2D.getImageData().data` produces, so it can be
 * unit-tested with synthetic pixel buffers.
 *
 * @param data   RGBA pixel data (length = width x height x 4).
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns       A complete `Tone4Palette`.
 * @throws        If dimensions are invalid or no visible pixels exist.
 */
export function extractFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Tone4Palette {
  if (width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive');
  }
  if (data.length < width * height * 4) {
    throw new Error('Pixel data length does not match dimensions');
  }

  const buckets = createBuckets();
  let totalLum = 0;
  let totalCount = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;

  const totalPixels = width * height;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // skip transparent pixels

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const hsl = rgbToHsl(r, g, b);

    // Filter: skip low-saturation (greyscale) and too-dark (near-black) pixels.
    // Still count them for global average / luminance.
    if (hsl.s < MIN_SATURATION || hsl.l < MIN_LIGHTNESS) {
      totalLum += wcagRelativeLuminance(r, g, b);
      totalCount++;
      rSum += r;
      gSum += g;
      bSum += b;
      continue;
    }

    totalLum += wcagRelativeLuminance(r, g, b);
    totalCount++;
    rSum += r;
    gSum += g;
    bSum += b;

    const weight = hsl.s * hsl.s; // saturation-squared weighting

    const idx = bucketIndex(hsl.h, hsl.s);
    const bucket = buckets[idx];
    bucket.weight += weight;
    bucket.sinSum += Math.sin((hsl.h * Math.PI) / 180) * weight;
    bucket.cosSum += Math.cos((hsl.h * Math.PI) / 180) * weight;
    bucket.sSum += hsl.s * weight;
    bucket.lSum += hsl.l * weight;
    bucket.count++;
  }

  if (totalCount === 0) {
    throw new Error('Image contains no visible pixels');
  }

  const avgLum = totalLum / totalCount;
  const mode: 'light' | 'dark' = avgLum >= LUMINANCE_MID ? 'light' : 'dark';

  // Sort buckets by weight descending.
  const sorted = buckets
    .map((bucket, index) => ({ bucket, index }))
    .filter((x) => x.bucket.weight > 0)
    .sort((a, b) => b.bucket.weight - a.bucket.weight);

  // --- Global average color (used for fallback + surface) -------------
  const avgR = rSum / totalCount;
  const avgG = gSum / totalCount;
  const avgB = bSum / totalCount;
  const avgHsl = rgbToHsl(avgR, avgG, avgB);

  // --- Accent / secondary ----------------------------------------------
  //
  // For greyscale images (all pixels filtered out) every bucket weight is 0
  // and `sorted` is empty. In that case we fall back to the image's average
  // color as accent and derive secondary by hue rotation.
  let accentHsl: HslColor;
  let secondary = '';

  if (sorted.length === 0) {
    // Greyscale fallback: use average color, rotate hue for variety.
    accentHsl = avgHsl;
    secondary = hslToHex({ ...avgHsl, h: (avgHsl.h + 60) % 360, s: Math.max(avgHsl.s, 0.3) });
  } else {
    accentHsl = bucketColor(sorted[0].bucket);

    // Secondary: next bucket with hue distance > 50 degrees.
    let secondaryFound = false;
    for (let i = 1; i < sorted.length; i++) {
      const c = bucketColor(sorted[i].bucket);
      if (hueDistance(c.h, accentHsl.h) > MIN_HUE_DISTANCE) {
        secondary = hslToHex(c);
        secondaryFound = true;
        break;
      }
    }
    if (!secondaryFound) {
      // Fallback: analogous hue shift (+60 degrees).
      secondary = hslToHex({ ...accentHsl, h: (accentHsl.h + 60) % 360 });
    }
  }

  const accent = hslToHex(accentHsl);

  // --- Surface / text from global average -----------------------------

  // Surface: neutral lightness tinted with the image's average hue.
  const surfaceL = mode === 'light' ? 0.95 : 0.08;
  const surfaceS = clamp(avgHsl.s * 0.12, 0, 0.1);
  const surface = hslToHex({ h: avgHsl.h, s: surfaceS, l: surfaceL });

  // Text: opposite extreme from surface, slight hue tint.
  const textL = mode === 'light' ? 0.12 : 0.92;
  const textS = clamp(avgHsl.s * 0.12, 0, 0.1);
  let text = hslToHex({ h: avgHsl.h, s: textS, l: textL });

  // Enforce WCAG AA contrast between text and surface.
  if (contrastRatio(text, surface) < WCAG_AA) {
    text = hslToHex({ h: avgHsl.h, s: textS, l: mode === 'light' ? 0.04 : 0.98 });
  }

  return { accent, secondary, surface, text, mode };
}

// ---------------------------------------------------------------------------
// Canvas I/O wrapper (browser / OffscreenCanvas)
// ---------------------------------------------------------------------------

/**
 * Extract a 4-tone palette from a Canvas element.
 *
 * Reads pixels from the given `HTMLCanvasElement` or `OffscreenCanvas` via
 * `getImageData()` and delegates to the pure {@link extractFromPixels} core.
 *
 * @param canvas  An `HTMLCanvasElement` or `OffscreenCanvas` with drawn content.
 * @returns       A complete `Tone4Palette`.
 * @throws        If the canvas has zero dimensions or context is unavailable.
 */
export function extractFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Tone4Palette {
  const width = canvas.width;
  const height = canvas.height;

  if (width === 0 || height === 0) {
    throw new Error('Canvas has zero dimensions');
  }

  // Both HTMLCanvasElement and OffscreenCanvas support getContext('2d').
  // The return types differ (CanvasRenderingContext2D vs OffscreenCanvasRenderingContext2D)
  // but both have getImageData(), so we normalize via type assertion.
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D | null;
  if (!ctx) {
    throw new Error('Canvas 2D context is not available in this environment');
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  return extractFromPixels(imageData.data, width, height);
}
