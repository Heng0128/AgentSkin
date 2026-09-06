// SPDX-License-Identifier: MPL-2.0

/**
 * # image-to-theme.mjs
 *
 * Generates a complete 14-token theme配色方案 from an image or a list of
 * user-provided colors. Supports PNG/BMP image decoding (zero external deps,
 * reuses the project's existing decoders) and a `--colors` mode for direct
 * color input (useful for testing or brand-color-driven generation).
 *
 * Usage:
 *   node scripts/image-to-theme.mjs --image <path> [--output <file>] [--pretty]
 *   node scripts/image-to-theme.mjs --colors <hex1,hex2,...> [--output <file>] [--pretty]
 *
 * 14-token output contract:
 *   accent, background, surface, text, border, muted, primary, secondary,
 *   success, warning, error, info, shadow, overlay
 *
 * Pipeline:
 *   1. Obtain a color palette (from image quantization or --colors input).
 *   2. Grid-based Canvas sampling for spatially balanced color extraction.
 *   3. Detect dark/light scheme from average WCAG luminance.
 *   4. Map palette → 14-token theme with dominant-hue tinting.
 *   5. WCAG 2.1 AA contrast auto-validation and iterative adjustment.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hexToHsl, hexToRgb, hslToHex } from './color-theory.mjs';
import { decodePng, medianCut, samplePixels } from './extract-theme-from-image.mjs';
import { decodeBmp } from './lib/oklch-extract.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 14 semantic color tokens every generated theme declares. */
export const MANIFEST_TOKENS = [
  'accent',
  'background',
  'surface',
  'text',
  'border',
  'muted',
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'info',
  'shadow',
  'overlay',
];

/** Number of buckets the median-cut quantizer produces. */
const QUANTIZE_BUCKETS = 16;

/** Max pixels to sample from the source image. */
const MAX_SAMPLES = 8000;

/** WCAG AA threshold for normal text. */
const WCAG_AA = 4.5;

/** WCAG AAA threshold for normal text. */
const WCAG_AAA = 7.0;

/** WCAG AA threshold for large text (18pt+ or 14pt bold+). */
const WCAG_AA_LARGE = 3.0;

/** Grid cells per axis for Canvas-style spatial sampling. */
const GRID_CELLS = 8;

/** Maximum iterations for contrast auto-adjustment. */
const MAX_ADJUST_ITERATIONS = 20;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments into a structured options object.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ imagePath: string|null, outputPath: string|null, colors: string[], pretty: boolean }}
 */
export function parseArgs(argv) {
  let imagePath = null;
  let outputPath = null;
  const colors = [];
  let pretty = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--image' || a === '-i') {
      imagePath = argv[++i];
    } else if (a === '--output' || a === '--out' || a === '-o') {
      outputPath = argv[++i];
    } else if (a === '--colors' || a === '-c') {
      const value = argv[++i];
      if (value) {
        for (const c of value.split(',')) {
          const trimmed = c.trim();
          if (trimmed) colors.push(trimmed);
        }
      }
    } else if (a === '--pretty' || a === '-p') {
      pretty = true;
    }
  }

  return { imagePath, outputPath, colors, pretty };
}

// ---------------------------------------------------------------------------
// Color format validation
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a well-formed hex color (#rgb, #rrggbb, #rrggbbaa).
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidHex(value) {
  if (typeof value !== 'string') return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

/**
 * Normalize any valid hex input to 6-digit #rrggbb.
 *
 * @param {string} hex
 * @returns {string} 6-digit hex color
 */
export function normalizeHex(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length === 8) h = h.slice(0, 6);
  return `#${h.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast calculation
// ---------------------------------------------------------------------------

/**
 * Compute the WCAG 2.1 relative luminance of a hex color (0-1).
 *
 * Each sRGB channel is linearized (gamma-expanded) then combined with the
 * luminance weights (0.2126 R + 0.7152 G + 0.0722 B).
 *
 * @param {string} hex - Hex color string (e.g. "#1a1a2e").
 * @returns {number} Relative luminance, 0 (black) – 1 (white).
 */
export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Compute the WCAG 2.1 contrast ratio between two hex colors (1 to 21).
 *
 * @param {string} hexA - First hex color.
 * @param {string} hexB - Second hex color.
 * @returns {number} Contrast ratio (1 = identical, 21 = max contrast).
 */
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine the WCAG conformance level for a given contrast ratio.
 *
 * @param {number} ratio - WCAG contrast ratio.
 * @returns {'AAA' | 'AA' | 'AA Large' | 'Fail'} Conformance level.
 */
export function wcagLevel(ratio) {
  if (ratio >= WCAG_AAA) return 'AAA';
  if (ratio >= WCAG_AA) return 'AA';
  if (ratio >= WCAG_AA_LARGE) return 'AA Large';
  return 'Fail';
}

// ---------------------------------------------------------------------------
// Scheme detection
// ---------------------------------------------------------------------------

/**
 * Detect dark/light scheme from the average luminance of a palette.
 *
 * @param {Array<{color: {r: number, g: number, b: number}, weight: number}>} palette
 * @returns {'dark' | 'light'}
 */
export function detectScheme(palette) {
  if (palette.length === 0) return 'dark';
  const totalWeight = palette.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 'dark';
  const avgL =
    palette.reduce((s, c) => {
      const [r, g, b] = [c.color.r, c.color.g, c.color.b];
      const f = (v) => {
        const sv = v / 255;
        return sv <= 0.03928 ? sv / 12.92 : ((sv + 0.055) / 1.055) ** 2.4;
      };
      return s + (0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)) * c.weight;
    }, 0) / totalWeight;
  return avgL < 0.5 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// Dominant hue extraction
// ---------------------------------------------------------------------------

/**
 * Find the dominant hue from the palette entry with the highest saturation
 * that also carries meaningful weight. Falls back to 220 (blue) if none.
 *
 * @param {Array<{color: {r: number, g: number, b: number}, weight: number}>} palette
 * @returns {number} Hue in degrees (0-360)
 */
export function findDominantHue(palette) {
  // Sort by saturation descending.
  const sorted = [...palette].sort((a, b) => {
    const sa = rgbToHslCompat(a.color.r, a.color.g, a.color.b)[1];
    const sb = rgbToHslCompat(b.color.r, b.color.g, b.color.b)[1];
    return sb - sa;
  });
  const dominant =
    sorted.find((q) => {
      const hsl = rgbToHslCompat(q.color.r, q.color.g, q.color.b);
      return hsl[1] > 0.1;
    }) ?? sorted[0];
  if (!dominant) return 220;
  return rgbToHslCompat(dominant.color.r, dominant.color.g, dominant.color.b)[0];
}

/** Lightweight rgb→hsl returning [h, s, l] without hex round-trip. */
function rgbToHslCompat(r, g, b) {
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
  return [h, s, l];
}

// ---------------------------------------------------------------------------
// Enhanced Canvas-style spatial sampling
// ---------------------------------------------------------------------------

/**
 * Grid-based spatial sampling that divides the image into a uniform grid and
 * collects the average color from each cell. This mimics how a Canvas
 * `getImageData` approach would sample — giving spatially balanced coverage
 * rather than simple stride-based subsampling which can miss regions.
 *
 * @param {Buffer} pixels - RGBA pixel buffer
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} [cellsPerAxis=GRID_CELLS] - Grid resolution per axis
 * @returns {Array<{r: number, g: number, b: number, weight: number}>} Weighted color list
 */
export function samplePixelGrid(pixels, width, height, cellsPerAxis = GRID_CELLS) {
  const cellW = Math.max(1, Math.floor(width / cellsPerAxis));
  const cellH = Math.max(1, Math.floor(height / cellsPerAxis));
  const colors = [];

  for (let gy = 0; gy < cellsPerAxis; gy++) {
    for (let gx = 0; gx < cellsPerAxis; gx++) {
      // Sample the center of each grid cell.
      const cx = Math.min(width - 1, gx * cellW + Math.floor(cellW / 2));
      const cy = Math.min(height - 1, gy * cellH + Math.floor(cellH / 2));
      const i = (cy * width + cx) * 4;

      // Skip fully transparent pixels.
      if (pixels[i + 3] < 128) continue;

      colors.push({
        r: pixels[i],
        g: pixels[i + 1],
        b: pixels[i + 2],
        weight: 1,
      });
    }
  }

  return colors;
}

/**
 * Hybrid sampling: combines grid-based spatial sampling with frequency-weighted
 * stride sampling for comprehensive color extraction. The grid ensures spatial
 * coverage while the frequency map captures dominant colors.
 *
 * @param {Buffer} pixels - RGBA pixel buffer
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} [maxSamples=MAX_SAMPLES] - Max total samples
 * @returns {Array<{r: number, g: number, b: number, weight: number}>} Weighted color list
 */
export function samplePixelHybrid(pixels, width, height, maxSamples = MAX_SAMPLES) {
  // Phase 1: Grid sampling for spatial coverage.
  const gridColors = samplePixelGrid(pixels, width, height, GRID_CELLS);

  // Phase 2: Frequency-weighted stride sampling for dominant colors.
  const strideColors = samplePixels(pixels, width, height, maxSamples);

  // Merge: grid colors get weight 1 each, stride colors keep their frequency weight.
  // Use a Map keyed by quantized color to deduplicate.
  const merged = new Map();

  for (const c of gridColors) {
    const key = ((c.r >> 4) << 8) | ((c.g >> 4) << 4) | (c.b >> 4);
    const existing = merged.get(key);
    if (existing) {
      existing.weight += 1;
    } else {
      merged.set(key, { r: c.r, g: c.g, b: c.b, weight: 1 });
    }
  }

  for (const c of strideColors) {
    const key = ((c.r >> 4) << 8) | ((c.g >> 4) << 4) | (c.b >> 4);
    const existing = merged.get(key);
    if (existing) {
      existing.weight += c.weight;
    } else {
      merged.set(key, { r: c.r, g: c.g, b: c.b, weight: c.weight });
    }
  }

  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// Token mapping
// ---------------------------------------------------------------------------

/**
 * Map a quantized palette + scheme to the 14-token theme contract.
 *
 * Strategy:
 *   - accent     → most saturated palette color, mode-adjusted lightness
 *   - primary    → same as accent (brand identity)
 *   - secondary  → hue-shifted accent (+30°)
 *   - background → very dark (dark) / very light (light), tinted by dominant hue
 *   - surface    → slightly lifted from background
 *   - text       → near-white (dark) / near-black (light), tinted by dominant hue
 *   - muted      → mid-lightness, desaturated version of text
 *   - border     → accent at ~15% alpha (8-digit hex)
 *   - success/warning/error/info → fixed semantic hues, mode-adjusted lightness
 *   - shadow     → black at 30% alpha
 *   - overlay    → black at 50% alpha (dark) / white at 50% (light)
 *
 * @param {Array<{color: {r: number, g: number, b: number}, weight: number}>} palette
 * @param {'dark' | 'light'} scheme
 * @param {number} dominantHue - degrees (0-360)
 * @returns {Record<string, string>} 14-token theme
 */
export function mapToTokens(palette, scheme, dominantHue) {
  const dark = scheme === 'dark';

  // --- Accent: most saturated color ---
  const bySaturation = [...palette].sort((a, b) => {
    const sa = rgbToHslCompat(a.color.r, a.color.g, a.color.b)[1];
    const sb = rgbToHslCompat(b.color.r, b.color.g, b.color.b)[1];
    return sb - sa;
  });
  const accentSrc = bySaturation[0]?.color ?? { r: 100, g: 160, b: 255 };
  const [accentH, accentS, accentL] = rgbToHslCompat(accentSrc.r, accentSrc.g, accentSrc.b);
  const accentLuminance = dark
    ? Math.min(0.72, Math.max(0.5, accentL + 0.1))
    : Math.max(0.4, Math.min(0.55, accentL));
  const accentHex = hslToHex(accentH, Math.max(0.4, accentS), accentLuminance);

  // --- Secondary: hue-shifted accent ---
  const secondaryHue = (accentH + 30) % 360;
  const secondaryHex = hslToHex(secondaryHue, Math.max(0.3, accentS * 0.8), accentLuminance);

  // --- Background ---
  const bgL = dark ? 0.08 : 0.97;
  const bgS = dark ? 0.12 : 0.08;
  const bgHex = hslToHex(dominantHue, bgS, bgL);

  // --- Surface ---
  const surfaceL = dark ? bgL + 0.06 : bgL - 0.05;
  const surfaceHex = hslToHex(dominantHue, bgS, Math.max(0, Math.min(1, surfaceL)));

  // --- Text ---
  const textL = dark ? 0.92 : 0.12;
  const textS = dark ? 0.05 : 0.08;
  const textHex = hslToHex(dominantHue, textS, textL);

  // --- Muted ---
  const mutedL = dark ? 0.6 : 0.45;
  const mutedHex = hslToHex(dominantHue, textS * 0.5, mutedL);

  // --- Border (accent at ~15% alpha → 8-digit hex) ---
  const borderHex = `${accentHex}26`;

  // --- Semantic hues (fixed brand semantics, mode-adjusted lightness) ---
  const semL = dark ? 0.6 : 0.45;
  const errorHex = hslToHex(5, 0.7, semL);
  const warningHex = hslToHex(35, 0.75, semL);
  const successHex = hslToHex(145, 0.6, semL);
  const infoHex = hslToHex(210, 0.65, semL);

  // --- Shadow ---
  const shadowHex = 'rgba(0, 0, 0, 0.30)';

  // --- Overlay ---
  const overlayHex = dark ? 'rgba(0, 0, 0, 0.50)' : 'rgba(255, 255, 255, 0.50)';

  return {
    accent: accentHex,
    background: bgHex,
    surface: surfaceHex,
    text: textHex,
    border: borderHex,
    muted: mutedHex,
    primary: accentHex,
    secondary: secondaryHex,
    success: successHex,
    warning: warningHex,
    error: errorHex,
    info: infoHex,
    shadow: shadowHex,
    overlay: overlayHex,
  };
}

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast auto-adjustment
// ---------------------------------------------------------------------------

/**
 * Iteratively adjust a text color to meet the target WCAG contrast ratio
 * against a background. Uses binary-search-like lightness nudging.
 *
 * @param {string} bgHex - Background hex color.
 * @param {string} textHex - Initial text hex color.
 * @param {number} targetRatio - Target WCAG ratio (default WCAG_AA = 4.5).
 * @param {number} dominantHue - Hue to preserve during adjustment.
 * @param {'dark' | 'light'} scheme - Color scheme direction.
 * @param {number} [maxIter=MAX_ADJUST_ITERATIONS] - Max adjustment iterations.
 * @returns {{ hex: string, ratio: number, iterations: number }} Adjusted color + metadata.
 */
export function adjustContrast(
  bgHex,
  textHex,
  targetRatio,
  dominantHue,
  scheme,
  maxIter = MAX_ADJUST_ITERATIONS,
) {
  const dark = scheme === 'dark';
  const bgLum = relativeLuminance(bgHex);

  // Parse initial text HSL.
  const [_h, s] = hexToHsl(textHex);
  let lo = dark ? 0.5 : 0.0;
  let hi = dark ? 1.0 : 0.5;
  let bestHex = textHex;
  let bestRatio = contrastRatio(bgHex, textHex);

  if (bestRatio >= targetRatio) {
    return { hex: bestHex, ratio: Number(bestRatio.toFixed(2)), iterations: 0 };
  }

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const candidate = hslToHex(dominantHue, Math.max(0.02, s * 0.3), mid);
    const ratio = contrastRatio(bgHex, candidate);

    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestHex = candidate;
    }

    if (ratio >= targetRatio) {
      return { hex: candidate, ratio: Number(ratio.toFixed(2)), iterations: i + 1 };
    }

    // Adjust search range: if background is dark, we need lighter text.
    if (dark) {
      if (mid > bgLum) lo = mid;
      else hi = mid;
    } else {
      if (mid < bgLum) hi = mid;
      else lo = mid;
    }
  }

  return { hex: bestHex, ratio: Number(bestRatio.toFixed(2)), iterations: maxIter };
}

/**
 * Ensure text/background contrast meets WCAG AA (4.5:1). If not, iteratively
 * adjust the text color using binary-search lightness nudging.
 *
 * @param {Record<string, string>} tokens
 * @param {'dark' | 'light'} scheme
 * @param {number} dominantHue
 * @returns {Record<string, string>} Adjusted tokens
 */
export function ensureWcagContrast(tokens, scheme, dominantHue) {
  const bgLum = relativeLuminance(tokens.background);
  const textLum = relativeLuminance(tokens.text);
  const lighter = Math.max(bgLum, textLum);
  const darker = Math.min(bgLum, textLum);
  const cr = (lighter + 0.05) / (darker + 0.05);

  if (cr >= WCAG_AA) {
    return tokens;
  }

  // Use iterative adjustment for precise contrast.
  const result = adjustContrast(tokens.background, tokens.text, WCAG_AA, dominantHue, scheme);
  return { ...tokens, text: result.hex };
}

// ---------------------------------------------------------------------------
// Contrast report generation
// ---------------------------------------------------------------------------

/**
 * Generate a full WCAG contrast report for all critical token pairs.
 *
 * @param {Record<string, string>} tokens - Theme tokens.
 * @returns {Array<{ pair: string, ratio: number, level: string, passes: boolean }>} Contrast report entries.
 */
export function generateContrastReport(tokens) {
  const pairs = [
    { a: 'text', b: 'background', label: 'text/background', threshold: WCAG_AA },
    { a: 'text', b: 'surface', label: 'text/surface', threshold: WCAG_AA },
    { a: 'muted', b: 'background', label: 'muted/background', threshold: WCAG_AA_LARGE },
    { a: 'accent', b: 'background', label: 'accent/background', threshold: WCAG_AA_LARGE },
    { a: 'primary', b: 'background', label: 'primary/background', threshold: WCAG_AA_LARGE },
  ];

  return pairs.map(({ a, b, label, threshold }) => {
    const ratio = contrastRatio(tokens[a], tokens[b]);
    return {
      pair: label,
      ratio: Number(ratio.toFixed(2)),
      level: wcagLevel(ratio),
      passes: ratio >= threshold,
    };
  });
}

// ---------------------------------------------------------------------------
// Image decoding
// ---------------------------------------------------------------------------

/**
 * Decode an image buffer (BMP or PNG) into raw RGBA pixels.
 *
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, pixels: Buffer }}
 */
export function decodeImage(buf) {
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return decodeBmp(buf);
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return decodePng(buf);
  }
  throw new Error('Unknown image signature. Use BMP or PNG.');
}

// ---------------------------------------------------------------------------
// Pipeline orchestration
// ---------------------------------------------------------------------------

/**
 * Full pipeline from raw pixels → 14-token theme.
 *
 * Uses hybrid sampling (grid + frequency) for balanced color extraction.
 *
 * @param {Buffer} pixels - RGBA pixel buffer
 * @param {number} width
 * @param {number} height
 * @returns {{ scheme: string, tokens: Record<string, string>, meta: object }}
 */
export function extractFromPixels(pixels, width, height) {
  const sampled = samplePixelHybrid(pixels, width, height, MAX_SAMPLES);
  const quantized = medianCut(sampled, QUANTIZE_BUCKETS);
  quantized.sort((a, b) => b.weight - a.weight);

  const scheme = detectScheme(quantized);
  const dominantHue = findDominantHue(quantized);

  let tokens = mapToTokens(quantized, scheme, dominantHue);
  tokens = ensureWcagContrast(tokens, scheme, dominantHue);

  const contrastReport = generateContrastReport(tokens);

  return {
    scheme,
    tokens,
    meta: {
      source: 'image',
      imagePath: null,
      extractedAt: new Date().toISOString(),
      width,
      height,
      paletteSize: quantized.length,
      dominantHue: Number(dominantHue.toFixed(1)),
      contrastReport,
    },
  };
}

/**
 * Generate a theme from a list of user-provided hex colors.
 *
 * @param {string[]} colors - Array of hex color strings
 * @returns {{ scheme: string, tokens: Record<string, string>, meta: object }}
 */
export function generateFromColors(colors) {
  const palette = colors.map((hex) => {
    const normalized = normalizeHex(hex);
    const rgb = hexToRgb(normalized);
    if (!rgb) throw new Error(`Invalid hex color: ${hex}`);
    return { color: { r: rgb[0], g: rgb[1], b: rgb[2] }, weight: 1 };
  });

  const scheme = detectScheme(palette);
  const dominantHue = findDominantHue(palette);

  let tokens = mapToTokens(palette, scheme, dominantHue);
  tokens = ensureWcagContrast(tokens, scheme, dominantHue);

  const contrastReport = generateContrastReport(tokens);

  return {
    scheme,
    tokens,
    meta: {
      source: 'colors',
      imagePath: null,
      extractedAt: new Date().toISOString(),
      paletteSize: palette.length,
      dominantHue: Number(dominantHue.toFixed(1)),
      contrastReport,
    },
  };
}

/**
 * Generate a theme from an image file.
 *
 * @param {string} imagePath - Path to the image file
 * @returns {{ scheme: string, tokens: Record<string, string>, meta: object }}
 */
export function generateFromImage(imagePath) {
  const buf = readFileSync(resolve(imagePath));
  const { width, height, pixels } = decodeImage(buf);
  const result = extractFromPixels(pixels, width, height);
  result.meta.imagePath = imagePath;
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cli() {
  const { imagePath, outputPath, colors, pretty } = parseArgs(process.argv.slice(2));

  if (!imagePath && colors.length === 0) {
    console.error('Usage:');
    console.error('  node scripts/image-to-theme.mjs --image <path> [--output <file>] [--pretty]');
    console.error(
      '  node scripts/image-to-theme.mjs --colors <hex1,hex2,...> [--output <file>] [--pretty]',
    );
    console.error('');
    console.error('Options:');
    console.error('  --image, -i <path>     Input image (BMP or PNG)');
    console.error('  --colors, -c <colors>  Comma-separated hex colors (e.g. "#1a1a2e,#4a90d9")');
    console.error('  --output, -o <file>    Write JSON to file instead of stdout');
    console.error('  --pretty, -p           Pretty-print JSON output');
    process.exit(1);
  }

  let result;
  try {
    if (imagePath) {
      result = generateFromImage(imagePath);
    } else {
      result = generateFromColors(colors);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(2);
  }

  const json = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);

  if (outputPath) {
    writeFileSync(resolve(outputPath), `${json}\n`, 'utf-8');
    console.error(`Theme written to ${resolve(outputPath)}`);
  } else {
    console.log(json);
  }
}

// Run CLI only when invoked directly.
const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  cli();
}
