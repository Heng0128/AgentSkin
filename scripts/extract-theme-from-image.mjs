// SPDX-License-Identifier: MPL-2.0
/**
 * # extract-theme-from-image.mjs
 *
 * Extracts a 14-token theme from an image using median-cut color quantization.
 * Supports BMP (via the shared oklch decoder) and PNG (Node.js zlib, zero deps).
 *
 * Usage:
 *   node scripts/extract-theme-from-image.mjs <image> [--output <file>] [--pretty]
 *
 * 14-token manifest:
 *   background, surface, text, muted, accent, border,
 *   primary, secondary, danger, warning, success, info,
 *   shadow, overlay
 *
 * Pipeline:
 *   1. Decode image → raw RGBA pixels (BMP or PNG).
 *   2. Subsample + frequency-map pixels.
 *   3. median-cut quantization → top-N dominant colors.
 *   4. Map dominant colors → 14-token theme contract.
 *   5. WCAG contrast safety pass (nudge text/bg if needed).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { decodeBmp } from './lib/oklch-extract.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 14 required tokens every theme manifest must declare. */
export const MANIFEST_TOKENS = [
  'background',
  'surface',
  'text',
  'muted',
  'accent',
  'border',
  'primary',
  'secondary',
  'danger',
  'warning',
  'success',
  'info',
  'shadow',
  'overlay',
];

/** Number of buckets the median-cut quantizer produces. */
const QUANTIZE_BUCKETS = 16;

/** Max pixels to sample from the source image (keeps quantization fast). */
const MAX_SAMPLES = 8000;

/** WCAG AA threshold for normal text. */
const WCAG_AA = 4.5;

// ---------------------------------------------------------------------------
// Color converters
// ---------------------------------------------------------------------------

/** Parse a hex string ("#rrggbb") into [r, g, b] (0-255). */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Format [r, g, b] (0-255) as "#rrggbb". */
export function rgbToHex(r, g, b) {
  const c = (v) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Convert [r, g, b] (0-255) → [h (0-360), s (0-1), l (0-1)]. */
export function rgbToHsl(r, g, b) {
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

/** Convert [h (0-360), s (0-1), l (0-1)] → "#rrggbb". */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// ---------------------------------------------------------------------------
// Perceptual metrics (ported from src/main/profile/color-quantize.ts)
// ---------------------------------------------------------------------------

/** WCAG 2.1 relative luminance (0-1). */
export function relativeLuminance(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.1 contrast ratio between two RGB triples (1-21). */
export function contrastRatio(r1, g1, b1, r2, g2, b2) {
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// median-cut quantization (ported from src/main/profile/color-quantize.ts)
// ---------------------------------------------------------------------------

/**
 * median-cut clustering. Splits the RGB color space along the widest channel
 * at the median until `bucketCount` buckets are reached. Each output bucket
 * carries the arithmetic mean color and total weight.
 *
 * @param {Array<{r: number, g: number, b: number, weight?: number}>} colors
 * @param {number} bucketCount
 * @returns {Array<{color: {r: number, g: number, b: number}, weight: number}>}
 */
export function medianCut(colors, bucketCount) {
  if (colors.length === 0) return [];
  const target = Math.max(1, Math.min(bucketCount, colors.length));
  const buckets = [colors];
  while (buckets.length < target) {
    let splitIdx = -1;
    let splitRange = -1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const range = _channelRange(buckets[i]);
      if (range > splitRange) {
        splitRange = range;
        splitIdx = i;
      }
    }
    if (splitIdx === -1 || splitRange < 0.001) break;
    const bucket = buckets[splitIdx];
    const channel = _widestChannel(bucket);
    bucket.sort((x, y) => x[channel] - y[channel]);
    const mid = Math.max(1, Math.min(bucket.length - 1, Math.floor(bucket.length / 2)));
    buckets.splice(splitIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }
  return buckets.map((bucket) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (const c of bucket) {
      const weight = c.weight ?? 1;
      r += c.r * weight;
      g += c.g * weight;
      b += c.b * weight;
      w += weight;
    }
    return {
      color:
        w > 0
          ? { r: Math.round(r / w), g: Math.round(g / w), b: Math.round(b / w) }
          : { r: 0, g: 0, b: 0 },
      weight: w,
    };
  });
}

function _channelRange(colors) {
  let min = 255;
  let max = 0;
  for (const c of colors) {
    min = Math.min(min, c.r, c.g, c.b);
    max = Math.max(max, c.r, c.g, c.b);
  }
  return max - min;
}

function _widestChannel(colors) {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const c of colors) {
    minR = Math.min(minR, c.r);
    maxR = Math.max(maxR, c.r);
    minG = Math.min(minG, c.g);
    maxG = Math.max(maxG, c.g);
    minB = Math.min(minB, c.b);
    maxB = Math.max(maxB, c.b);
  }
  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;
  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= bRange) return 'g';
  return 'b';
}

// ---------------------------------------------------------------------------
// PNG decoder (8-bit RGB/RGBA, non-interlaced, using Node.js zlib)
// ---------------------------------------------------------------------------

/**
 * Decode an 8-bit-per-channel non-interlaced PNG (color type 2 = RGB,
 * color type 6 = RGBA) into { width, height, pixels: Buffer(RGBA) }.
 *
 * Uses Node.js built-in zlib for IDAT decompression — zero external deps.
 */
export function decodePng(buf) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== signature[i]) throw new Error('Not a PNG file');
  }

  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (off < buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const dataStart = off + 8;

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }

    off = dataStart + length + 4; // skip data + CRC
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported PNG color type: ${colorType} (only RGB/RGBA)`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);

  // PNG filter reconstruction.
  let prevRow = Buffer.alloc(stride);
  let rawOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff++];
    const row = Buffer.from(raw.subarray(rawOff, rawOff + stride));
    rawOff += stride;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0; // left
      const b = prevRow[x]; // up
      const c = x >= channels ? prevRow[x - channels] : 0; // up-left
      let val = row[x];
      switch (filter) {
        case 0:
          break; // None
        case 1:
          val = (val + a) & 0xff;
          break; // Sub
        case 2:
          val = (val + b) & 0xff;
          break; // Up
        case 3:
          val = (val + ((a + b) >> 1)) & 0xff;
          break; // Average
        case 4:
          val = (val + _paeth(a, b, c)) & 0xff;
          break; // Paeth
        default:
          throw new Error(`Unknown PNG filter: ${filter}`);
      }
      row[x] = val;
    }

    // Expand row to RGBA.
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      pixels[dst] = row[src];
      pixels[dst + 1] = row[src + 1];
      pixels[dst + 2] = row[src + 2];
      pixels[dst + 3] = channels === 4 ? row[src + 3] : 255;
    }
    prevRow = row;
  }

  return { width, height, pixels };
}

function _paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ---------------------------------------------------------------------------
// Pixel sampling + frequency map
// ---------------------------------------------------------------------------

/**
 * Subsample an RGBA pixel buffer and build a frequency-weighted color list.
 * Quantizes each channel to 4 bits (12-bit color) to collapse near-duplicates.
 */
export function samplePixels(pixels, width, height, maxSamples = MAX_SAMPLES) {
  const totalPx = width * height;
  const stride = Math.max(1, Math.floor(Math.sqrt(totalPx / maxSamples)));
  const freq = new Map();

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 128) continue; // skip transparent
      // Quantize to 4 bits/channel → dedup near-identical colors.
      const key = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4);
      const entry = freq.get(key);
      if (entry) {
        entry.weight++;
      } else {
        freq.set(key, { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], weight: 1 });
      }
    }
  }

  return [...freq.values()];
}

// ---------------------------------------------------------------------------
// Token mapping
// ---------------------------------------------------------------------------

/**
 * Determine dark/light mode from average pixel luminance.
 * Returns "dark" if avgL < 0.5, else "light".
 */
export function detectMode(avgL) {
  return avgL < 0.5 ? 'dark' : 'light';
}

/**
 * Map a quantized palette (sorted by weight desc) + mode to the 14-token manifest.
 *
 * Strategy:
 *   - accent     → most saturated palette color
 *   - primary    → same as accent (brand identity)
 *   - secondary  → hue-shifted accent (+30°) for variety
 *   - background → very dark (dark mode) / very light (light mode) tinted by dominant hue
 *   - surface    → slightly lifted from background
 *   - text       → near-white (dark) / near-black (light), tinted by dominant hue
 *   - muted      → mid-lightness, desaturated version of text
 *   - border     → accent at low alpha
 *   - danger/warning/success/info → fixed semantic hues, mode-adjusted lightness
 *   - shadow     → black at 30% alpha
 *   - overlay    → black at 50% alpha (dark) / white at 50% (light)
 *
 * @param {Array<{color: {r: number, g: number, b: number}, weight: number}>} palette
 * @param {'dark' | 'light'} mode
 * @param {object} [opts]
 * @param {number} [opts.dominantHue] - hijack hue from source image (degrees)
 * @returns {Record<string, string>} 14-token manifest
 */
export function mapToTokens(palette, mode, opts = {}) {
  const dark = mode === 'dark';

  // --- Accent: most saturated color ---
  const bySaturation = [...palette].sort((a, b) => {
    const sa = rgbToHsl(a.color.r, a.color.g, a.color.b)[1];
    const sb = rgbToHsl(b.color.r, b.color.g, b.color.b)[1];
    return sb - sa;
  });
  const accentSrc = bySaturation[0]?.color ?? { r: 100, g: 160, b: 255 };
  const [accentH, accentS, accentL] = rgbToHsl(accentSrc.r, accentSrc.g, accentSrc.b);
  const accentLuminance = dark
    ? Math.min(0.72, Math.max(0.5, accentL + 0.1))
    : Math.max(0.4, Math.min(0.55, accentL));
  const accentHex = hslToHex(accentH, Math.max(0.4, accentS), accentLuminance);

  // --- Secondary: hue-shifted accent ---
  const secondaryHue = (accentH + 30) % 360;
  const secondaryHex = hslToHex(secondaryHue, Math.max(0.3, accentS * 0.8), accentLuminance);

  // --- Dominant hue fallback ---
  const dominantHue = opts.dominantHue ?? accentH;

  // --- Background ---
  const bgL = dark ? 0.08 : 0.97;
  const bgS = dark ? 0.12 : 0.08;
  const bgHex = hslToHex(dominantHue, bgS, bgL);
  const bgRgb = hexToRgb(bgHex);

  // --- Surface ---
  const surfaceL = dark ? bgL + 0.06 : bgL - 0.05;
  const surfaceHex = hslToHex(dominantHue, bgS, Math.max(0, Math.min(1, surfaceL)));

  // --- Text ---
  const textL = dark ? 0.92 : 0.12;
  const textS = dark ? 0.05 : 0.08;
  const textHex = hslToHex(dominantHue, textS, textL);
  const textRgb = hexToRgb(textHex);

  // --- Muted ---
  const mutedL = dark ? 0.6 : 0.45;
  const mutedHex = hslToHex(dominantHue, textS * 0.5, mutedL);

  // --- Border (accent at ~15% alpha) ---
  const borderAlpha = '26';
  const borderHex = accentHex + borderAlpha;

  // --- Semantic hues (fixed brand semantics, mode-adjusted lightness) ---
  const semL = dark ? 0.6 : 0.45;
  const dangerHex = hslToHex(5, 0.7, semL);
  const warningHex = hslToHex(35, 0.75, semL);
  const successHex = hslToHex(145, 0.6, semL);
  const infoHex = hslToHex(210, 0.65, semL);

  // --- Shadow & overlay ---
  const shadowHex = 'rgba(0, 0, 0, 0.30)';
  const overlayHex = dark ? 'rgba(0, 0, 0, 0.50)' : 'rgba(255, 255, 255, 0.50)';

  // --- WCAG safety pass: ensure text/bg contrast ---
  let finalText = textHex;
  if (textRgb && bgRgb) {
    const cr = contrastRatio(textRgb[0], textRgb[1], textRgb[2], bgRgb[0], bgRgb[1], bgRgb[2]);
    if (cr < WCAG_AA) {
      // Nudge text toward pure white/black.
      const adjustedL = dark ? 0.98 : 0.02;
      finalText = hslToHex(dominantHue, 0.02, adjustedL);
    }
  }

  return {
    background: bgHex,
    surface: surfaceHex,
    text: finalText,
    muted: mutedHex,
    accent: accentHex,
    border: borderHex,
    primary: accentHex,
    secondary: secondaryHex,
    danger: dangerHex,
    warning: warningHex,
    success: successHex,
    info: infoHex,
    shadow: shadowHex,
    overlay: overlayHex,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Full pipeline: pixels → 14-token manifest.
 *
 * @param {Buffer} pixels - RGBA pixel buffer
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number} [opts.maxSamples]
 * @param {number} [opts.buckets]
 * @returns {{ mode: string, tokens: Record<string, string>, meta: object }}
 */
export function extractFromPixels(pixels, width, height, opts = {}) {
  const sampled = samplePixels(pixels, width, height, opts.maxSamples);
  const quantized = medianCut(sampled, opts.buckets ?? QUANTIZE_BUCKETS);
  // Sort by weight descending (most dominant first).
  quantized.sort((a, b) => b.weight - a.weight);

  const avgL =
    sampled.reduce((sum, c) => sum + relativeLuminance(c.r, c.g, c.b) * c.weight, 0) /
    sampled.reduce((sum, c) => sum + c.weight, 0);
  const mode = detectMode(avgL);

  // Compute dominant hue from the top-weighted palette entry that has chroma.
  const dominant =
    quantized.find((q) => rgbToHsl(q.color.r, q.color.g, q.color.b)[1] > 0.1) ?? quantized[0];
  const dominantHue = dominant
    ? rgbToHsl(dominant.color.r, dominant.color.g, dominant.color.b)[0]
    : 220;

  const tokens = mapToTokens(quantized, mode, { dominantHue });

  return {
    mode,
    tokens,
    meta: {
      width,
      height,
      avgL: Number(avgL.toFixed(4)),
      paletteSize: quantized.length,
      dominantHue: Number(dominantHue.toFixed(1)),
    },
  };
}

/**
 * Decode an image buffer (BMP or PNG) and extract a 14-token theme.
 *
 * @param {Buffer} buf
 * @param {'bmp' | 'png'} [format]
 * @returns {{ mode: string, tokens: Record<string, string>, meta: object }}
 */
export function extractTheme(buf, format) {
  const fmt = format ?? _detectFormat(buf);
  let decoded;
  if (fmt === 'bmp') {
    decoded = decodeBmp(buf);
  } else if (fmt === 'png') {
    decoded = decodePng(buf);
  } else {
    throw new Error(`Unsupported image format: ${fmt}. Use BMP or PNG.`);
  }
  return extractFromPixels(decoded.pixels, decoded.width, decoded.height);
}

/** Sniff format from file signature. */
function _detectFormat(buf) {
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  throw new Error('Unknown image signature. Provide --format or use BMP/PNG.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cli() {
  const args = process.argv.slice(2);
  let imagePath = null;
  let outputPath = null;
  let pretty = false;
  let format = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pretty') {
      pretty = true;
    } else if (a === '--output' || a === '--out' || a === '-o') {
      outputPath = args[++i];
    } else if (a === '--format') {
      format = args[++i];
    } else if (!a.startsWith('-')) {
      imagePath = a;
    }
  }

  if (!imagePath) {
    console.error(
      'Usage: node scripts/extract-theme-from-image.mjs <image> [--output <file>] [--pretty] [--format bmp|png]',
    );
    console.error('');
    console.error('Options:');
    console.error('  --output, --out, -o  Write JSON to file instead of stdout');
    console.error('  --pretty              Pretty-print JSON output');
    console.error('  --format bmp|png      Override auto-detected format');
    process.exit(1);
  }

  const fullPath = resolve(imagePath);
  let buf;
  try {
    buf = readFileSync(fullPath);
  } catch (e) {
    console.error(`Error reading file: ${fullPath} — ${e.message}`);
    process.exit(2);
  }

  let result;
  try {
    result = extractTheme(buf, format);
  } catch (e) {
    console.error(`Extraction failed: ${e.message}`);
    process.exit(3);
  }

  const json = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);

  if (outputPath) {
    writeFileSync(resolve(outputPath), `${json}\n`, 'utf-8');
    console.error(`Theme written to ${resolve(outputPath)}`);
  } else {
    console.log(json);
  }
}

// Run CLI only when invoked directly (not when imported for tests).
const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  cli();
}
