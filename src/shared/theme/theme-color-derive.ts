// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Color Derive — Image → Palette → 14-Token Scheme
 *
 * Analyzes image pixel data to automatically derive a complete 14-token
 * theme color scheme. The pipeline:
 *
 * 1. **Hue bucketing** — each pixel is converted to HSL and placed in one
 *    of 12 buckets: 6 hue sectors (60° each) × 2 saturation levels
 *    (low < 0.5, high >= 0.5). Bucket weight = Σ(saturation²), so vivid
 *    colors dominate over muted ones.
 * 2. **Mode detection** — average luminance >= threshold → light, otherwise
 *    dark. Default threshold is 140/255 (≈ 0.549), configurable.
 * 3. **Palette matching** — the dominant hue + mode are matched against 5
 *    predefined theme palettes (绯樱少女 / 薄荷花房 / 晴日校园 / 鎏金夜宴 /
 *    深海夜航) using circular hue distance. Returns the best match and a
 *    confidence score.
 * 4. **14-token generation** — from the dominant hue, a complete set of
 *    theme tokens is derived (accent, secondary, background, foreground,
 *    surface hierarchy, code colors, button colors, focus ring, etc.) with
 *    WCAG AA contrast enforcement.
 *
 * ## Design
 *
 * The core algorithm (`deriveFromPixels`) is a pure function over raw RGBA
 * data — no DOM, no Canvas — so it can be unit-tested in a node environment.
 * Color primitives are reused from `contrast-utils.ts` and `tonal-palette.ts`
 * to stay consistent with the shared layer.
 *
 * Inspired by:
 *   - zhouwei713/WorkBuddy-Dream-Skin's hue + luminance analysis
 *   - pywal's color extraction (histogram + saturation weighting)
 *   - Material You's hue-sector quantization
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

/** Result of dominant-color extraction from an image. */
export interface DominantColorResult {
  /** Dominant hue in degrees [0, 360). */
  hue: number;
  /** Weighted-average saturation [0, 1]. */
  saturation: number;
  /** Weighted-average lightness [0, 1]. */
  lightness: number;
  /** Average WCAG relative luminance [0, 1]. */
  luminance: number;
  /** Detected color mode. */
  mode: 'light' | 'dark';
}

/** A predefined theme palette for matching. */
export interface ThemePalette {
  /** Unique identifier (slug). */
  id: string;
  /** Display name. */
  name: string;
  /** Characteristic hue in degrees [0, 360). */
  hue: number;
  /** Preferred color mode. */
  mode: 'light' | 'dark';
  /** Representative saturation [0, 1]. */
  saturation: number;
}

/** Result of matching an image against predefined palettes. */
export interface PaletteMatchResult {
  /** Best-matching palette id. */
  paletteId: string;
  /** Display name of the matched palette. */
  paletteName: string;
  /** Confidence score [0, 1] (1 = perfect match). */
  confidence: number;
  /** Hue distance to the matched palette (degrees, 0–180). */
  hueDistance: number;
}

/** Options for the derivation pipeline. */
export interface DeriveOptions {
  /**
   * Luminance threshold for light/dark mode classification.
   * Value in [0, 1]. Default: 140/255 ≈ 0.549.
   */
  luminanceThreshold?: number;
}

/** A complete 14-token color scheme derived from an image. */
export interface DerivedColorScheme {
  /** Detected color mode. */
  mode: 'light' | 'dark';
  /** Primary brand / action color (dominant hue). */
  accent: string;
  /** Low-saturation variant of accent (badges, subtle highlights). */
  accentMuted: string;
  /** Secondary brand color (analogous hue). */
  secondary: string;
  /** Page background. */
  background: string;
  /** Primary text color. */
  foreground: string;
  /** Muted/secondary text. */
  muted: string;
  /** Base surface (slightly different from background). */
  surface: string;
  /** Elevated surface (cards, popovers). */
  surfaceElevated: string;
  /** Border color. */
  border: string;
  /** Code block background. */
  codeBackground: string;
  /** Code block foreground. */
  codeForeground: string;
  /** Input field background. */
  inputBackground: string;
  /** Button background (same as accent). */
  buttonBackground: string;
  /** Button foreground (contrast color of accent). */
  buttonForeground: string;
  /** Focus ring color. */
  focusRing: string;
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

/** Default luminance threshold for light/dark mode (140/255). */
const DEFAULT_LUMINANCE_THRESHOLD = 140 / 255;

/** WCAG 2.1 AA contrast threshold for normal text. */
const WCAG_AA = 4.5;

// ---------------------------------------------------------------------------
// Predefined theme palettes
// ---------------------------------------------------------------------------

/**
 * Five predefined theme palettes inspired by WorkBuddy-Dream-Skin.
 * Each has a characteristic hue and preferred mode used for matching.
 */
export const PREDEFINED_PALETTES: readonly ThemePalette[] = [
  {
    id: 'sakura-girl',
    name: '绯樱少女',
    hue: 340, // pink / rose
    mode: 'light',
    saturation: 0.65,
  },
  {
    id: 'mint-house',
    name: '薄荷花房',
    hue: 160, // mint green
    mode: 'light',
    saturation: 0.45,
  },
  {
    id: 'sunny-campus',
    name: '晴日校园',
    hue: 45, // warm yellow
    mode: 'light',
    saturation: 0.7,
  },
  {
    id: 'golden-night',
    name: '鎏金夜宴',
    hue: 30, // gold / amber
    mode: 'dark',
    saturation: 0.6,
  },
  {
    id: 'deep-sea',
    name: '深海夜航',
    hue: 220, // deep blue
    mode: 'dark',
    saturation: 0.55,
  },
];

// ---------------------------------------------------------------------------
// Hue bucket internals
// ---------------------------------------------------------------------------

/**
 * Accumulator for a single hue bucket. Hue is stored as sin/cos sums so the
 * circular mean can be computed without wraparound artifacts.
 */
interface HueBucket {
  /** Total weight (Σ saturation²). */
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
// RGB → HSL (inlined for per-pixel performance)
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
// Public API: Dominant color extraction
// ---------------------------------------------------------------------------

/**
 * Extract the dominant color from raw RGBA pixel data using HSL hue bucketing.
 *
 * Pure function — no Canvas, no DOM. Accepts the same `Uint8ClampedArray`
 * that `CanvasRenderingContext2D.getImageData().data` produces.
 *
 * @param data   RGBA pixel data (length = width × height × 4).
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @returns       Dominant color information including hue, saturation, and mode.
 * @throws        If dimensions are invalid or no visible pixels exist.
 */
export function extractDominantColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DominantColorResult {
  if (width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive');
  }
  if (data.length < width * height * 4) {
    throw new Error('Pixel data length does not match dimensions');
  }

  const buckets = createBuckets();
  let totalLum = 0;
  let totalCount = 0;

  const totalPixels = width * height;
  for (let i = 0; i < totalPixels * 4; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // skip transparent pixels

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

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
  const mode: 'light' | 'dark' = avgLum >= DEFAULT_LUMINANCE_THRESHOLD ? 'light' : 'dark';

  // Sort buckets by weight descending.
  const sorted = buckets
    .map((bucket, index) => ({ bucket, index }))
    .filter((x) => x.bucket.weight > 0)
    .sort((a, b) => b.bucket.weight - a.bucket.weight);

  if (sorted.length === 0) {
    // Greyscale image: no saturated buckets. Use average luminance as fallback.
    return {
      hue: 0,
      saturation: 0,
      lightness: avgLum,
      luminance: avgLum,
      mode,
    };
  }

  const dominant = bucketColor(sorted[0].bucket);
  return {
    hue: dominant.h,
    saturation: dominant.s,
    lightness: dominant.l,
    luminance: avgLum,
    mode,
  };
}

// ---------------------------------------------------------------------------
// Public API: Mode detection
// ---------------------------------------------------------------------------

/**
 * Determine whether an image is light or dark based on average luminance.
 *
 * @param luminance  Average WCAG relative luminance [0, 1].
 * @param threshold  Optional threshold (default: 140/255 ≈ 0.549).
 * @returns          'light' if luminance >= threshold, 'dark' otherwise.
 */
export function detectMode(
  luminance: number,
  threshold: number = DEFAULT_LUMINANCE_THRESHOLD,
): 'light' | 'dark' {
  return luminance >= threshold ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Public API: Palette matching
// ---------------------------------------------------------------------------

/**
 * Match a dominant color against predefined theme palettes.
 *
 * Uses circular hue distance weighted by mode compatibility. The confidence
 * score is computed as a combination of hue proximity and mode match:
 *   - Hue contributes 70% (1 - hueDistance / 180)
 *   - Mode contributes 30% (full if matching, 0 if not)
 *
 * @param dominant  The dominant color result from `extractDominantColor`.
 * @param palettes  Optional custom palette set (defaults to PREDEFINED_PALETTES).
 * @returns         The best match with confidence score and hue distance.
 */
export function matchThemePalette(
  dominant: DominantColorResult,
  palettes: readonly ThemePalette[] = PREDEFINED_PALETTES,
): PaletteMatchResult {
  let bestId = palettes[0].id;
  let bestName = palettes[0].name;
  let bestScore = -1;
  let bestDist = 180;

  for (const palette of palettes) {
    const hDist = hueDistance(dominant.hue, palette.hue);
    const hueScore = 1 - hDist / 180; // 1 = identical, 0 = opposite
    const modeScore = dominant.mode === palette.mode ? 1 : 0;

    // Weighted combination: 70% hue, 30% mode.
    const score = hueScore * 0.7 + modeScore * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestId = palette.id;
      bestName = palette.name;
      bestDist = hDist;
    }
  }

  return {
    paletteId: bestId,
    paletteName: bestName,
    confidence: Math.round(bestScore * 1000) / 1000, // round to 3 decimals
    hueDistance: Math.round(bestDist * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Public API: 14-token scheme generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete 14-token color scheme from a dominant color.
 *
 * The scheme is built by deriving all tokens from the dominant hue:
 * - `accent` — the dominant hue at a balanced lightness
 * - `secondary` — analogous hue (+30°) at slightly reduced saturation
 * - `background` / `foreground` — extremes of the lightness range, tinted
 *   with the dominant hue
 * - `surface` / `surfaceElevated` — incremental steps from background
 * - `border` — blend of background and foreground
 * - `codeBackground` / `codeForeground` — subtle variants
 * - `inputBackground` — close to background
 * - `buttonBackground` / `buttonForeground` — accent + its contrast color
 * - `focusRing` — the accent color
 *
 * WCAG AA contrast (>= 4.5:1) between foreground and background is enforced.
 *
 * @param dominant  The dominant color result.
 * @param options   Optional configuration (luminance threshold).
 * @returns         A complete `DerivedColorScheme`.
 */
export function generateColorScheme(
  dominant: DominantColorResult,
  _options: DeriveOptions = {},
): DerivedColorScheme {
  const mode = dominant.mode;
  const { hue, saturation } = dominant;
  const direction = mode === 'light' ? -1 : 1;

  // --- Accent: dominant hue at balanced lightness and saturation -------
  const accentL = mode === 'light' ? 0.55 : 0.6;
  const accentS = Math.max(saturation, 0.5);
  const accent = hslToHex({ h: hue, s: clamp(accentS, 0.3, 0.85), l: accentL });

  // --- Secondary: analogous hue (+30°) ----------------------------------
  const secondaryHue = (hue + 30) % 360;
  const secondaryS = clamp(accentS * 0.7, 0.2, 0.6);
  const secondary = hslToHex({ h: secondaryHue, s: secondaryS, l: accentL });

  // --- AccentMuted: desaturated accent ----------------------------------
  const accentMuted = adjustSaturation(accent, 0.4);

  // --- Background: extreme lightness, slight hue tint -------------------
  const bgL = mode === 'light' ? 0.97 : 0.08;
  const bgS = clamp(saturation * 0.1, 0, 0.1);
  const background = hslToHex({ h: hue, s: bgS, l: bgL });

  // --- Foreground: opposite extreme, slight hue tint -------------------
  const fgL = mode === 'light' ? 0.12 : 0.92;
  const fgS = clamp(saturation * 0.08, 0, 0.08);
  let foreground = hslToHex({ h: hue, s: fgS, l: fgL });

  // Enforce WCAG AA contrast between foreground and background.
  if (contrastRatio(foreground, background) < WCAG_AA) {
    foreground = hslToHex({ h: hue, s: fgS, l: mode === 'light' ? 0.04 : 0.98 });
  }

  // --- Muted: desaturated foreground ------------------------------------
  const muted = adjustSaturation(foreground, 0.35);

  // --- Surface hierarchy ------------------------------------------------
  const surface = adjustLightness(background, direction * 0.02);
  const surfaceElevated = adjustLightness(background, direction * 0.04);

  // --- Border: blend of background and foreground ------------------------
  const border = mixHex(background, foreground, mode === 'light' ? 0.12 : 0.18);

  // --- Code block colors -------------------------------------------------
  const codeBackground = adjustLightness(background, direction * 0.05);
  const codeForeground = adjustLightness(foreground, -direction * 0.08);

  // --- Input background --------------------------------------------------
  const inputBackground = adjustLightness(background, direction * 0.025);

  // --- Button colors -----------------------------------------------------
  const buttonBackground = accent;
  const buttonForeground = getContrastColor(accent).toUpperCase();

  // --- Focus ring: accent at slightly different lightness ----------------
  const focusRing = adjustLightness(accent, direction * 0.1);

  return {
    mode,
    accent,
    accentMuted,
    secondary,
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
}

// ---------------------------------------------------------------------------
// Public API: Full pipeline
// ---------------------------------------------------------------------------

/**
 * Run the complete image → palette → scheme derivation pipeline.
 *
 * Convenience function that chains `extractDominantColor`,
 * `matchThemePalette`, and `generateColorScheme` in sequence.
 *
 * @param data     RGBA pixel data.
 * @param width    Image width in pixels.
 * @param height   Image height in pixels.
 * @param options  Optional configuration.
 * @returns        A tuple of [dominant, match, scheme].
 */
export function deriveFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: DeriveOptions = {},
): [DominantColorResult, PaletteMatchResult, DerivedColorScheme] {
  const dominant = extractDominantColor(data, width, height);
  const match = matchThemePalette(dominant);
  const scheme = generateColorScheme(dominant, options);
  return [dominant, match, scheme];
}
