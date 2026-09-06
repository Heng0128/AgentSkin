// SPDX-License-Identifier: MPL-2.0

/**
 * # image-theme-analyzer — Intelligent Color Extraction for Theme Generation
 *
 * Pure-TS engine that analyzes RGBA pixel data to extract a structured
 * color palette suitable for theme generation. Zero runtime dependencies,
 * all functions are pure and side-effect-free for easy testing.
 *
 * ## Pipeline
 *
 * 1. **Scaling** — downsample image to max 320×320 for fast analysis
 *    (preserves color distribution while keeping runtime bounded).
 * 2. **Hue bucketing** — each visible pixel is converted to HSL and
 *    accumulated into 12 buckets (6 hue sectors × 2 saturation levels).
 *    Weight = saturation², biasing the result toward vivid colors.
 * 3. **Palette assembly** — top-3 buckets become primary / secondary /
 *    accent, with lightness-aware mode detection and WCAG pre-check.
 *
 * ## Design
 *
 * The core function `extractThemePalette` operates on raw `Uint8ClampedArray`
 * RGBA data (same format as `CanvasRenderingContext2D.getImageData().data`).
 * There is no DOM, no Electron dependency. Callers decode file bytes → RGBA
 * and pass the result here.
 */

import { hexToRgb, wcagRelativeLuminance } from '../../shared/contrast-utils';
import { type HslColor, hexToHsl, hslToHex } from '../../shared/tonal-palette';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single extracted color with its role in the palette. */
export interface ExtractedColor {
  /** Hex color (#RRGGBB uppercase). */
  hex: string;
  /** RGB channels (0–255). */
  rgb: { r: number; g: number; b: number };
  /** HSL representation. */
  hsl: HslColor;
  /** Relative weight in the image [0, 1] (share of saturated pixels). */
  weight: number;
}

/** Raw RGBA pixel data for analysis. */
export interface PixelData {
  /** RGBA pixel buffer (length = width × height × 4). */
  data: Uint8ClampedArray;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
}

/** Structured palette extracted from an image. */
export interface ImageThemePalette {
  /** Dominant / primary color (highest weight). */
  primary: ExtractedColor;
  /** Secondary color (complementary or analogous). */
  secondary: ExtractedColor;
  /** Accent color (highest saturation, used for CTAs). */
  accent: ExtractedColor;
  /** Detected base mode. */
  mode: 'light' | 'dark';
  /** Average WCAG relative luminance [0, 1]. */
  luminance: number;
  /** Overall hue in degrees [0, 360). */
  dominantHue: number;
}

/** Options for the extraction pipeline. */
export interface ExtractOptions {
  /**
   * Maximum intermediate dimension for pixel sampling.
   * Larger = more accurate but slower. Default: 320.
   */
  maxSampleSize?: number;
  /**
   * Luminance threshold for mode classification.
   * Default: 0.549 (140/255).
   */
  luminanceThreshold?: number;
  /**
   * Alpha cutoff: pixels with alpha below this are skipped.
   * Default: 128.
   */
  alphaCutoff?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target intermediate size for sampling (320×320 = 102,400 pixels). */
const DEFAULT_MAX_SAMPLE = 320;

/** Luminance threshold default (140/255 ≈ 0.549). */
const DEFAULT_LUM_THRESHOLD = 140 / 255;

/** Hue sectors (60° each). */
const HUE_SECTORS = 6;

/** Saturation levels (low < 0.5, high >= 0.5). */
const SAT_LEVELS = 2;

/** Total hue buckets = HUE_SECTORS × SAT_LEVELS. */
const BUCKET_COUNT = HUE_SECTORS * SAT_LEVELS;

/** Width of each hue sector in degrees. */
const HUE_SECTOR_WIDTH = 360 / HUE_SECTORS;

/** Saturation threshold separating low from high level. */
const SAT_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Hue bucket internals
// ---------------------------------------------------------------------------

interface HueBucket {
  weight: number;
  sinSum: number;
  cosSum: number;
  sSum: number;
  lSum: number;
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

function bucketIndex(h: number, s: number): number {
  const sector = Math.min(HUE_SECTORS - 1, Math.floor(h / HUE_SECTOR_WIDTH));
  const level = s >= SAT_THRESHOLD ? 1 : 0;
  return sector + level * HUE_SECTORS;
}

function bucketHue(bucket: HueBucket): number {
  const h = (Math.atan2(bucket.sinSum, bucket.cosSum) * 180) / Math.PI;
  return ((h % 360) + 360) % 360;
}

function bucketHsl(bucket: HueBucket): HslColor {
  const weight = bucket.weight || 1;
  return {
    h: bucketHue(bucket),
    s: bucket.sSum / weight,
    l: bucket.lSum / weight,
  };
}

// ---------------------------------------------------------------------------
// RGB → HSL (inlined for per-pixel performance)
// ---------------------------------------------------------------------------

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
// Shortest hue distance (circular, 0–180)
// ---------------------------------------------------------------------------

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// Downscale: simple nearest-neighbor sampling for analysis
// ---------------------------------------------------------------------------

/**
 * Downscale RGBA pixel data to fit within maxDim on either axis.
 * Uses nearest-neighbor sampling (fast, preserves color distribution).
 *
 * Returns the sampled pixels as a flat Uint8ClampedArray.
 */
export function downscalePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxDim: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  if (width <= maxDim && height <= maxDim) {
    return { data, width, height };
  }

  const scale = Math.min(maxDim / width, maxDim / height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  const out = new Uint8ClampedArray(newW * newH * 4);

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const srcY = Math.min(height - 1, Math.floor(y / scale));
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * newW + x) * 4;
      out[dstIdx] = data[srcIdx];
      out[dstIdx + 1] = data[srcIdx + 1];
      out[dstIdx + 2] = data[srcIdx + 2];
      out[dstIdx + 3] = data[srcIdx + 3];
    }
  }

  return { data: out, width: newW, height: newH };
}

// ---------------------------------------------------------------------------
// Core: extract theme palette from RGBA pixel data
// ---------------------------------------------------------------------------

/**
 * Extract a structured color theme palette from raw RGBA pixel data.
 *
 * Pure function — no DOM, no Electron, no side effects.
 *
 * @param data   RGBA pixel data (length = width × height × 4).
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @param opts   Optional configuration.
 * @returns       A structured `ImageThemePalette`.
 * @throws        If dimensions are invalid or no visible pixels exist.
 */
export function extractThemePalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  opts: ExtractOptions = {},
): ImageThemePalette {
  const maxSample = opts.maxSampleSize ?? DEFAULT_MAX_SAMPLE;
  const lumThreshold = opts.luminanceThreshold ?? DEFAULT_LUM_THRESHOLD;
  const alphaCutoff = opts.alphaCutoff ?? 128;

  if (width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive');
  }
  if (data.length < width * height * 4) {
    throw new Error('Pixel data length does not match dimensions');
  }

  // Step 1: downscale for bounded runtime.
  const scaled = downscalePixels(data, width, height, maxSample);

  // Step 2: hue bucketing.
  const buckets = createBuckets();
  let totalLum = 0;
  let totalCount = 0;

  const totalPixels = scaled.width * scaled.height;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const a = scaled.data[i + 3];
    if (a < alphaCutoff) continue;

    const r = scaled.data[i];
    const g = scaled.data[i + 1];
    const b = scaled.data[i + 2];

    totalLum += wcagRelativeLuminance(r, g, b);
    totalCount++;

    const hsl = rgbToHsl(r, g, b);
    const w = hsl.s * hsl.s; // saturation² weighting

    const idx = bucketIndex(hsl.h, hsl.s);
    const bucket = buckets[idx];
    bucket.weight += w;
    bucket.sinSum += Math.sin((hsl.h * Math.PI) / 180) * w;
    bucket.cosSum += Math.cos((hsl.h * Math.PI) / 180) * w;
    bucket.sSum += hsl.s * w;
    bucket.lSum += hsl.l * w;
    bucket.count++;
  }

  if (totalCount === 0) {
    throw new Error('Image contains no visible pixels');
  }

  const avgLum = totalLum / totalCount;
  const mode: 'light' | 'dark' = avgLum >= lumThreshold ? 'light' : 'dark';

  // Sort buckets by weight descending.
  const sorted = buckets
    .map((bucket, index) => ({ bucket, index }))
    .filter((x) => x.bucket.weight > 0)
    .sort((a, b) => b.bucket.weight - a.bucket.weight);

  if (sorted.length === 0) {
    // Greyscale image: fall back to neutral palette.
    const neutral = mode === 'light' ? '#808080' : '#A0A0A0';
    const hsl = hexToHsl(neutral);
    const rgb = hexToRgb(neutral)!;
    const color: ExtractedColor = { hex: neutral, rgb, hsl, weight: 1 };
    return {
      primary: color,
      secondary: color,
      accent: color,
      mode,
      luminance: avgLum,
      dominantHue: 0,
    };
  }

  // Primary: highest-weight bucket.
  const primaryBucket = sorted[0].bucket;
  const primaryHsl = bucketHsl(primaryBucket);
  const primaryHex = hslToHex(primaryHsl);
  const primaryRgb = hexToRgb(primaryHex)!;
  const primaryWeight = primaryBucket.weight / totalCount;

  // Secondary: pick the bucket with the largest hue distance from primary,
  // among remaining buckets. Fallback to analogous hue if none found.
  let secondaryHsl: HslColor;
  if (sorted.length > 1) {
    let bestDist = -1;
    let bestHsl = primaryHsl;
    for (let i = 1; i < sorted.length; i++) {
      const hsl = bucketHsl(sorted[i].bucket);
      const dist = hueDistance(primaryHsl.h, hsl.h);
      if (dist > bestDist) {
        bestDist = dist;
        bestHsl = hsl;
      }
    }
    // If all remaining are too close (< 20°), use analogous (+30°).
    if (bestDist < 20) {
      secondaryHsl = { ...primaryHsl, h: (primaryHsl.h + 30) % 360 };
    } else {
      secondaryHsl = bestHsl;
    }
  } else {
    // Only one bucket: analogous hue.
    secondaryHsl = { ...primaryHsl, h: (primaryHsl.h + 30) % 360 };
  }
  const secondaryHex = hslToHex(secondaryHsl);
  const secondaryRgb = hexToRgb(secondaryHex)!;
  const secondaryWeight = sorted.length > 1 ? sorted[1].bucket.weight / totalCount : 0;

  // Accent: highest-saturation bucket among all (not just top-3).
  let accentHsl = primaryHsl;
  let maxSat = primaryHsl.s;
  for (const { bucket } of sorted) {
    const hsl = bucketHsl(bucket);
    if (hsl.s > maxSat) {
      maxSat = hsl.s;
      accentHsl = hsl;
    }
  }
  const accentHex = hslToHex(accentHsl);
  const accentRgb = hexToRgb(accentHex)!;
  const accentWeight =
    sorted.find((x) => bucketHsl(x.bucket).h === accentHsl.h)?.bucket.weight ??
    primaryBucket.weight;
  const finalAccentWeight = accentWeight / totalCount;

  return {
    primary: { hex: primaryHex, rgb: primaryRgb, hsl: primaryHsl, weight: primaryWeight },
    secondary: { hex: secondaryHex, rgb: secondaryRgb, hsl: secondaryHsl, weight: secondaryWeight },
    accent: { hex: accentHex, rgb: accentRgb, hsl: accentHsl, weight: finalAccentWeight },
    mode,
    luminance: avgLum,
    dominantHue: primaryHsl.h,
  };
}

// ---------------------------------------------------------------------------
// Utility: compute overall image brightness (Rec.709)
// ---------------------------------------------------------------------------

/**
 * Compute the average brightness of an RGBA image (Rec.709 luma, 0–1).
 *
 * Skips fully-transparent pixels.
 */
export function computeImageBrightness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaCutoff = 128,
): number {
  let totalLum = 0;
  let count = 0;
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    if (data[i + 3] < alphaCutoff) continue;
    totalLum += wcagRelativeLuminance(data[i], data[i + 1], data[i + 2]);
    count++;
  }
  return count > 0 ? totalLum / count : 0;
}

/**
 * Validate raw image dimensions and pixel data without full analysis.
 *
 * Returns `null` if valid, or an error string if invalid.
 */
export function validateImageDimensions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  if (width <= 0 || height <= 0) {
    return 'Image dimensions must be positive';
  }
  if (width > 8192 || height > 8192) {
    return 'Image dimensions exceed maximum (8192×8192)';
  }
  if (data.length < width * height * 4) {
    return 'Pixel data length does not match dimensions';
  }
  return null;
}
