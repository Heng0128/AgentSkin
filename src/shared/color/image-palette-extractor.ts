// SPDX-License-Identifier: MPL-2.0

/**
 * # Image Palette Extractor
 *
 * Extracts a 7-color palette from an image using hue-bucket analysis, then
 * maps it to AgentSkin's 14-token theme contract. This is the client-side
 * "image → theme" pipeline: the user uploads a picture, we pull the dominant
 * hues, and produce a usable theme draft without manual color picking.
 *
 * ## Algorithm
 *
 * 1. **Sample** — draw the image to a 48 px-wide canvas (aspect preserved)
 *    and read back the RGBA pixels via `getImageData()`.
 * 2. **Hue bucketing** — each pixel is converted to HSL and placed in one
 *    of 12 buckets: 6 hue sectors (60° each) × 2 saturation levels
 *    (low < 0.5, high >= 0.5). Bucket weight = Σ(saturation²), so vivid
 *    colors dominate over muted ones.
 * 3. **Primary / secondary / accent** — the highest-weight bucket is the
 *    primary color. Secondary is the next bucket whose hue is > 50° away
 *    from primary (guarantees visual distinction). Accent is the most
 *    saturated remaining bucket that is also > 50° from both; falls back
 *    to the complementary hue (primary + 180°).
 * 4. **Background / text / border** — derived from the image's global
 *    average color, pushed to a neutral lightness appropriate for the
 *    detected mode and tinted with the average hue. WCAG AA contrast
 *    (>= 4.5:1) between text and background is enforced.
 * 5. **Mode** — average luminance >= 0.5 → light, otherwise dark.
 *
 * ## Design
 *
 * The core algorithm (`extractPaletteFromPixels`) is a pure function over
 * raw RGBA data — no DOM, no Canvas — so it can be unit-tested in a node
 * environment. The Canvas / image-loading I/O is a thin async wrapper
 * (`extractPaletteFromImage`) that feeds pixel data into the pure core.
 *
 * Reuses color primitives from `contrast-utils.ts` and `tonal-palette.ts`
 * to stay consistent with the shared layer's existing conversions.
 *
 * Inspired by:
 *   - pywal's color extraction (histogram + saturation weighting)
 *   - Material You's hue-sector quantization
 *   - Color Thief's modified MMCQ approach
 */

import {
  contrastRatio,
  getContrastColor,
  hexToRgb,
  rgbToHex,
  wcagRelativeLuminance,
} from '../contrast-utils';
import { type HslColor, hexToHsl, hslToHex } from '../tonal-palette';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The 7-color palette extracted from an image. */
export interface ExtractedPalette {
  /** Primary brand / action color (highest-weight hue bucket). */
  primary: string;
  /** Secondary brand color (hue > 50° from primary). */
  secondary: string;
  /** Accent / highlight color (most saturated, distinct from primary & secondary). */
  accent: string;
  /** Page background color. */
  background: string;
  /** Primary text color. */
  text: string;
  /** Border color. */
  border: string;
  /** Detected color mode. */
  mode: 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of hue sectors (60° each). */
const HUE_SECTORS = 6;

/** Number of saturation levels (low / high). */
const SAT_LEVELS = 2;

/** Total hue buckets = HUE_SECTORS × SAT_LEVELS. */
const BUCKET_COUNT = HUE_SECTORS * SAT_LEVELS;

/** Width of each hue sector in degrees. */
const HUE_SECTOR_WIDTH = 360 / HUE_SECTORS;

/** Saturation threshold separating low from high level. */
const SAT_THRESHOLD = 0.5;

/** Minimum hue distance (degrees) between primary/secondary/accent. */
const MIN_HUE_DISTANCE = 50;

/** Target width for image sampling (aspect ratio preserved). */
const SAMPLE_WIDTH = 48;

/** Luminance threshold for light/dark mode classification. */
const LUMINANCE_MID = 0.5;

/** WCAG 2.1 AA contrast threshold for normal text. */
const WCAG_AA = 4.5;

// ---------------------------------------------------------------------------
// Hue bucket
// ---------------------------------------------------------------------------

/**
 * Accumulator for a single hue bucket. Hue is stored as sin/cos sums so the
 * circular mean can be computed without wraparound artifacts (e.g. the
 * average of 350° and 10° is 0°, not 180°).
 */
interface HueBucket {
  /** Total weight (Σ saturation²) in this bucket. */
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

/** Map an HSL color to its bucket index (0–11). */
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

/** Shortest distance between two hues on the color wheel (0–180). */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// Color helpers (local implementations using shared primitives)
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
  );
}

// ---------------------------------------------------------------------------
// Core: extract palette from raw RGBA pixels (pure, no DOM)
// ---------------------------------------------------------------------------

/**
 * Extract a 7-color palette from raw RGBA pixel data.
 *
 * Pure function — no Canvas, no DOM. Accepts the same `Uint8ClampedArray`
 * that `CanvasRenderingContext2D.getImageData().data` produces, so it can be
 * unit-tested with synthetic pixel buffers.
 *
 * @param data   RGBA pixel data (length = width × height × 4).
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns       A complete `ExtractedPalette`.
 * @throws        If dimensions are invalid or no visible pixels exist.
 */
export function extractPaletteFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ExtractedPalette {
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

    rSum += r;
    gSum += g;
    bSum += b;

    totalLum += wcagRelativeLuminance(r, g, b);
    totalCount++;

    const hsl = rgbToHsl(r, g, b);
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

  // --- Global average color (used for fallback + background/text) -------
  const avgR = rSum / totalCount;
  const avgG = gSum / totalCount;
  const avgB = bSum / totalCount;
  const avgHsl = rgbToHsl(avgR, avgG, avgB);

  // --- Primary / secondary / accent -------------------------------------
  //
  // For greyscale images (all pixels have s ≈ 0) every bucket weight is 0
  // and `sorted` is empty. In that case we fall back to the image's average
  // color as primary and derive secondary / accent by hue rotation.
  let primaryHsl: HslColor;
  let secondary = '';
  let accent = '';

  if (sorted.length === 0) {
    // Greyscale fallback: use average color, rotate hue for variety.
    primaryHsl = avgHsl;
    secondary = hslToHex({ ...avgHsl, h: (avgHsl.h + 60) % 360, s: Math.max(avgHsl.s, 0.3) });
    accent = hslToHex({ ...avgHsl, h: (avgHsl.h + 180) % 360, s: Math.max(avgHsl.s, 0.4) });
  } else {
    primaryHsl = bucketColor(sorted[0].bucket);

    // Secondary: next bucket with hue distance > 50°.
    let secondaryFound = false;
    for (let i = 1; i < sorted.length; i++) {
      const c = bucketColor(sorted[i].bucket);
      if (hueDistance(c.h, primaryHsl.h) > MIN_HUE_DISTANCE) {
        secondary = hslToHex(c);
        secondaryFound = true;
        break;
      }
    }
    if (!secondaryFound) {
      // Fallback: analogous hue shift (+60°).
      secondary = hslToHex({ ...primaryHsl, h: (primaryHsl.h + 60) % 360 });
    }

    // Accent: most saturated remaining bucket > 50° from both.
    const secondaryHsl = hexToHsl(secondary);
    let bestSat = -1;
    let accentFound = false;
    for (let i = 1; i < sorted.length; i++) {
      const c = bucketColor(sorted[i].bucket);
      const distP = hueDistance(c.h, primaryHsl.h);
      const distS = hueDistance(c.h, secondaryHsl.h);
      if (distP > MIN_HUE_DISTANCE && distS > MIN_HUE_DISTANCE && c.s > bestSat) {
        bestSat = c.s;
        accent = hslToHex(c);
        accentFound = true;
      }
    }
    if (!accentFound) {
      // Fallback: complementary hue (+180°).
      accent = hslToHex({ ...primaryHsl, h: (primaryHsl.h + 180) % 360 });
    }
  }

  const primary = hslToHex(primaryHsl);

  // --- Background / text / border from global average -------------------

  // Background: neutral lightness tinted with the image's average hue.
  const bgL = mode === 'light' ? 0.95 : 0.1;
  const bgS = clamp(avgHsl.s * 0.15, 0, 0.12);
  const background = hslToHex({ h: avgHsl.h, s: bgS, l: bgL });

  // Text: opposite extreme from background, slight hue tint.
  const textL = mode === 'light' ? 0.12 : 0.92;
  const textS = clamp(avgHsl.s * 0.15, 0, 0.12);
  let text = hslToHex({ h: avgHsl.h, s: textS, l: textL });

  // Enforce WCAG AA contrast between text and background.
  if (contrastRatio(text, background) < WCAG_AA) {
    // Push text further toward the extreme until contrast is sufficient.
    text = hslToHex({ h: avgHsl.h, s: textS, l: mode === 'light' ? 0.04 : 0.98 });
  }

  // Border: subtle blend of background and text.
  const border = mixHex(background, text, mode === 'light' ? 0.15 : 0.2);

  return { primary, secondary, accent, background, text, border, mode };
}

// ---------------------------------------------------------------------------
// RGB → HSL (direct, avoids hex string roundtrip in the pixel loop)
// ---------------------------------------------------------------------------

/**
 * Convert 8-bit RGB channels to HSL. Same algorithm as `tonal-palette.ts`
 * and `palette-analyzer.ts` but inlined here to avoid the overhead of
 * `rgbToHex` → `hexToHsl` string roundtrips inside the per-pixel loop.
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
// Canvas / image-loading I/O wrapper (browser-only)
// ---------------------------------------------------------------------------

/**
 * Extract a palette from an image source (URL, HTMLImageElement, or
 * ImageBitmap). Loads the image, draws it to a 48 px-wide canvas, reads
 * back the pixels, and delegates to {@link extractPaletteFromPixels}.
 *
 * @param source  Image URL string, `HTMLImageElement`, or `ImageBitmap`.
 * @returns       A promise resolving to the extracted palette.
 * @throws        If the image fails to load or Canvas is unavailable.
 */
export async function extractPaletteFromImage(
  source: ImageBitmap | HTMLImageElement | string,
): Promise<ExtractedPalette> {
  const drawable = typeof source === 'string' ? await loadImageFromUrl(source) : source;
  const { width: srcW, height: srcH } = getSourceDimensions(drawable);

  if (srcW === 0 || srcH === 0) {
    throw new Error('Image has zero dimensions');
  }

  const width = SAMPLE_WIDTH;
  const height = Math.max(1, Math.round((srcH / srcW) * width));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available in this environment');
  }

  ctx.drawImage(drawable, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  return extractPaletteFromPixels(imageData.data, width, height);
}

/** Load an image from a URL string, resolving when it finishes loading. */
function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image from URL: ${url}`));
    img.src = url;
  });
}

/** Get the intrinsic dimensions of an ImageBitmap or HTMLImageElement. */
function getSourceDimensions(source: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  const img = source as HTMLImageElement;
  return { width: img.naturalWidth, height: img.naturalHeight };
}

// ---------------------------------------------------------------------------
// Token mapping
// ---------------------------------------------------------------------------

/**
 * Map a 7-color extracted palette to AgentSkin's 14-token theme record.
 *
 * The output keys align with `ThemeColorsFromImage` in `types/theme.ts`.
 * Tokens not directly present in the 7-color palette are derived:
 *   - `accentMuted` — desaturated primary
 *   - `muted` — desaturated text
 *   - `surface` / `surfaceElevated` — background shifted ±lightness
 *   - `codeBackground` / `codeForeground` — darker/lighter variants
 *   - `inputBackground` — background shifted slightly
 *   - `buttonBackground` / `buttonForeground` — primary + its contrast color
 *   - `focusRing` — the accent color
 *
 * @param palette  The 7-color palette from `extractPaletteFromPixels`.
 * @returns        A record of 14+ CSS variable values keyed by token name.
 */
export function mapToTokens(palette: ExtractedPalette): Record<string, string> {
  const { primary, secondary, accent, background, text, border, mode } = palette;
  const direction = mode === 'light' ? -1 : 1;

  return {
    // Direct mappings.
    accent: primary,
    secondary,
    background,
    foreground: text,
    border,
    focusRing: accent,

    // Derived: muted variants.
    accentMuted: adjustSaturation(primary, 0.5),
    muted: adjustSaturation(text, 0.35),

    // Derived: surface hierarchy.
    surface: adjustLightness(background, direction * 0.02),
    surfaceElevated: adjustLightness(background, direction * 0.04),

    // Derived: code block colors.
    codeBackground: adjustLightness(background, direction * 0.06),
    codeForeground: adjustLightness(text, -direction * 0.1),

    // Derived: input field.
    inputBackground: adjustLightness(background, direction * 0.03),

    // Derived: button colors.
    buttonBackground: primary,
    // getContrastColor returns lowercase (#000000 / #ffffff); normalize to
    // uppercase for consistency with the rest of the token set.
    buttonForeground: getContrastColor(primary).toUpperCase(),
  };
}
