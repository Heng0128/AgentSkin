// SPDX-License-Identifier: MPL-2.0

/**
 * # Canvas Auto Palette Analyzer
 *
 * Analyzes image pixel data (from Canvas API) to automatically extract a
 * 14-token compatible theme palette. Determines brightness, dominant colors,
 * accent/focus, and safe zones.
 *
 * ## Algorithm
 *
 * 1. **Quantize**: Reduce 8-bit channels to 5-bit (32 levels) for a
 *    manageable color space.
 * 2. **Frequency map**: Count occurrences of each quantized color.
 * 3. **Dominant extraction**: Take the top N most frequent colors.
 * 4. **Merge**: Combine similar colors (RGB distance < threshold).
 * 5. **Classify**: Assign semantic roles based on luminance, saturation, hue.
 * 6. **WCAG enforcement**: Ensure foreground/background contrast >= 4.5.
 *
 * ## 14-Token Contract
 *
 * The output aligns with the project's 14-token theme system:
 * - `background` / `foreground` — page bg and primary text
 * - `primary` / `secondary` / `accent` — brand action colors
 * - `muted` — secondary text
 * - `border` / `card` / `popover` / `input` — surface hierarchy
 * - `ring` — focus indicator
 * - `destructive` / `success` / `warning` — semantic status colors
 *
 * Pure module — no DOM or Electron deps. Accepts raw RGBA pixel data
 * obtained from `canvas.getContext('2d').getImageData()`.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw pixel data from Canvas API (RGBA Uint8ClampedArray). */
export interface PixelData {
  /** RGBA pixel data, length = width * height * 4. */
  data: Uint8ClampedArray;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
}

/** 14-token theme palette output. */
export interface PaletteTheme {
  /** Detected color mode. */
  mode: 'light' | 'dark';
  /** Page background. */
  background: string;
  /** Primary text color. */
  foreground: string;
  /** Primary brand/action color. */
  primary: string;
  /** Secondary brand color. */
  secondary: string;
  /** Accent/highlight color. */
  accent: string;
  /** Muted/secondary text. */
  muted: string;
  /** Border color. */
  border: string;
  /** Card surface. */
  card: string;
  /** Popover/dropdown surface. */
  popover: string;
  /** Input field background. */
  input: string;
  /** Focus ring color. */
  ring: string;
  /** Destructive/danger color (red family). */
  destructive: string;
  /** Success color (green family). */
  success: string;
  /** Warning color (amber family). */
  warning: string;
}

/** Analysis intermediates (exposed for testing/debugging). */
export interface PaletteAnalysis {
  /** Detected color mode. */
  mode: 'light' | 'dark';
  /** Average luminance [0, 1]. */
  avgLuminance: number;
  /** Top dominant colors (hex), sorted by frequency. */
  dominantColors: string[];
  /** Brightest dominant color. */
  brightestColor: string;
  /** Darkest dominant color. */
  darkestColor: string;
  /** Most saturated dominant color. */
  mostSaturated: string;
  /** Foreground/background contrast ratio. */
  contrastRatio: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUANTIZE_SHIFT = 3; // 8-bit → 5-bit
const QUANTIZE_STEP = 1 << QUANTIZE_SHIFT; // 8
const QUANTIZE_CENTER = QUANTIZE_STEP >> 1; // 4
const MERGE_THRESHOLD = 32;
const WCAG_AA_THRESHOLD = 4.5;
const TOP_COLORS = 16;

// ---------------------------------------------------------------------------
// Color conversion helpers
// ---------------------------------------------------------------------------

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '').trim();
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const n = parseInt(expanded.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hNorm = ((h % 360) + 360) % 360;
  const sNorm = Math.min(1, Math.max(0, s));
  const lNorm = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hNorm < 60) [r, g, b] = [c, x, 0];
  else if (hNorm < 120) [r, g, b] = [x, c, 0];
  else if (hNorm < 180) [r, g, b] = [0, c, x];
  else if (hNorm < 240) [r, g, b] = [0, x, c];
  else if (hNorm < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/** Rec. 709 relative luminance. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** WCAG 2.1 contrast ratio between two hex colors (1.0 – 21.0). */
export function contrastRatio(hex1: string, hex2: string): number {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Linear interpolation between two hex colors. `ratio` 0 = hex1, 1 = hex2. */
export function mixColors(hex1: string, hex2: string, ratio: number): string {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  return rgbToHex(
    c1.r + (c2.r - c1.r) * ratio,
    c1.g + (c2.g - c1.g) * ratio,
    c1.b + (c2.b - c1.b) * ratio,
  );
}

/** Adjust lightness by a signed amount (positive = lighter, negative = darker). */
export function adjustLightness(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const rgb = hslToRgb(h, s, Math.min(1, Math.max(0, l + amount)));
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/** Scale saturation by a factor (0 = greyscale, 1 = unchanged, >1 = boosted). */
export function adjustSaturation(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const rgb = hslToRgb(h, Math.min(1, Math.max(0, s * factor)), l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

/** A color cluster after quantization: RGB + pixel count. */
export interface QuantizedColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

/** Build a frequency map of 5-bit quantized colors from raw pixel data. */
export function quantizePixels(pixelData: PixelData): Map<string, QuantizedColor> {
  const freq = new Map<string, QuantizedColor>();
  const { data, width, height } = pixelData;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels * 4; i += 4) {
    // Skip fully transparent pixels.
    if (data[i + 3] < 128) continue;

    // Quantize to 5-bit per channel, centered in bin.
    const qr = ((data[i] >> QUANTIZE_SHIFT) << QUANTIZE_SHIFT) | QUANTIZE_CENTER;
    const qg = ((data[i + 1] >> QUANTIZE_SHIFT) << QUANTIZE_SHIFT) | QUANTIZE_CENTER;
    const qb = ((data[i + 2] >> QUANTIZE_SHIFT) << QUANTIZE_SHIFT) | QUANTIZE_CENTER;

    const key = `${qr},${qg},${qb}`;
    const existing = freq.get(key);
    if (existing) {
      existing.count++;
    } else {
      freq.set(key, { r: qr, g: qg, b: qb, count: 1 });
    }
  }

  return freq;
}

// ---------------------------------------------------------------------------
// Dominant color extraction
// ---------------------------------------------------------------------------

/** Extract the top N most frequent colors from a quantized frequency map. */
export function extractDominantColors(
  freq: Map<string, QuantizedColor>,
  topN: number,
): QuantizedColor[] {
  return [...freq.values()].sort((a, b) => b.count - a.count).slice(0, topN);
}

/** Merge colors within a Euclidean RGB distance threshold. */
export function mergeSimilarColors(colors: QuantizedColor[], threshold: number): QuantizedColor[] {
  const merged: QuantizedColor[] = [];

  for (const color of colors) {
    let found = false;
    for (const m of merged) {
      const dist = Math.sqrt((color.r - m.r) ** 2 + (color.g - m.g) ** 2 + (color.b - m.b) ** 2);
      if (dist < threshold) {
        // Weighted average merge.
        const total = m.count + color.count;
        m.r = Math.round((m.r * m.count + color.r * color.count) / total);
        m.g = Math.round((m.g * m.count + color.g * color.count) / total);
        m.b = Math.round((m.b * m.count + color.b * color.count) / total);
        m.count = total;
        found = true;
        break;
      }
    }
    if (!found) {
      merged.push({ ...color });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

/** Determine light/dark mode from average luminance. */
export function detectMode(avgLuminance: number): 'light' | 'dark' {
  return avgLuminance >= 0.5 ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface ClassifiedColor {
  hex: string;
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  count: number;
}

/** Find a semantic color (destructive/success/warning) from clusters by hue range. */
function findSemanticColor(
  colors: ClassifiedColor[],
  type: 'destructive' | 'success' | 'warning',
): string | null {
  // Hue ranges: destructive = red (wraps 330–30), success = green (90–160), warning = amber (30–60).
  const ranges: Record<string, [number, number]> = {
    destructive: [330, 30],
    success: [90, 160],
    warning: [30, 60],
  };

  const [start, end] = ranges[type];

  const candidates = colors.filter((c) => {
    if (c.s < 0.2 || c.l < 0.1 || c.l > 0.9) return false;
    if (start > end) {
      // Wraps around 360° (e.g., 330–30 means 330–360 or 0–30).
      return c.h >= start || c.h <= end;
    }
    return c.h >= start && c.h <= end;
  });

  if (candidates.length === 0) return null;
  // Pick the most saturated candidate.
  return candidates.sort((a, b) => b.s - a.s)[0].hex;
}

/** Classify merged color clusters into the 14-token theme. */
export function classifyColors(clusters: QuantizedColor[], mode: 'light' | 'dark'): PaletteTheme {
  const colors: ClassifiedColor[] = clusters.map((c) => {
    const hsl = rgbToHsl(c.r, c.g, c.b);
    return {
      hex: rgbToHex(c.r, c.g, c.b),
      r: c.r,
      g: c.g,
      b: c.b,
      h: hsl.h,
      s: hsl.s,
      l: hsl.l,
      count: c.count,
    };
  });

  // Sort by luminance.
  const byLuminance = [...colors].sort((a, b) => a.l - b.l);
  const darkest = byLuminance[0];
  const brightest = byLuminance[byLuminance.length - 1];

  // Sort by saturation (excluding near-white/near-black).
  const bySaturation = [...colors].filter((c) => c.l > 0.1 && c.l < 0.95).sort((a, b) => b.s - a.s);
  const mostSaturated = bySaturation[0] ?? [...colors].sort((a, b) => b.s - a.s)[0];

  // Background and foreground from luminance extremes.
  const background = mode === 'light' ? brightest.hex : darkest.hex;
  const foreground = mode === 'light' ? darkest.hex : brightest.hex;

  // Accent: most saturated color.
  const accent = mostSaturated.hex;

  // Primary: accent.
  const primary = accent;

  // Secondary: accent with reduced saturation.
  const secondary = adjustSaturation(accent, 0.6);

  // Muted: foreground with reduced saturation.
  const muted = adjustSaturation(foreground, 0.3);

  // Border: blend of background and foreground.
  const border = mixColors(background, foreground, mode === 'light' ? 0.15 : 0.2);

  // Card: slightly different from background.
  const card = adjustLightness(background, mode === 'light' ? -0.03 : 0.03);

  // Popover: slightly more different from background.
  const popover = adjustLightness(background, mode === 'light' ? -0.05 : 0.05);

  // Input: slightly different from background.
  const inputBg = adjustLightness(background, mode === 'light' ? -0.015 : 0.015);

  // Ring: accent with adjusted lightness for visibility.
  const ring = adjustLightness(accent, mode === 'light' ? -0.1 : 0.15);

  // Semantic colors: find from clusters or use defaults.
  const destructive = findSemanticColor(colors, 'destructive') ?? '#EF4444';
  const success = findSemanticColor(colors, 'success') ?? '#22C55E';
  const warning = findSemanticColor(colors, 'warning') ?? '#F59E0B';

  return {
    mode,
    background,
    foreground,
    primary,
    secondary,
    accent,
    muted,
    border,
    card,
    popover,
    input: inputBg,
    ring,
    destructive,
    success,
    warning,
  };
}

// ---------------------------------------------------------------------------
// WCAG enforcement
// ---------------------------------------------------------------------------

/**
 * Ensure foreground/background contrast meets WCAG 2.1 AA (>= 4.5).
 *
 * Strategy: adjust the foreground towards the contrast extreme (black for
 * light mode, white for dark mode). If foreground alone cannot reach the
 * target (background is too close to mid-grey), also push the background
 * in the opposite direction.
 */
export function enforceWCAGAA(theme: PaletteTheme): PaletteTheme {
  const ratio = contrastRatio(theme.foreground, theme.background);
  if (ratio >= WCAG_AA_THRESHOLD) return theme;

  const adjusted: PaletteTheme = { ...theme };
  const direction = theme.mode === 'light' ? -1 : 1;
  let adjustedFg = theme.foreground;
  let adjustedBg = theme.background;

  // Phase 1: adjust foreground only.
  for (let i = 0; i < 50; i++) {
    const currentRatio = contrastRatio(adjustedFg, adjustedBg);
    if (currentRatio >= WCAG_AA_THRESHOLD) break;
    adjustedFg = adjustLightness(adjustedFg, direction * 0.02);
  }

  // Phase 2: if still insufficient, also push background the other way.
  if (contrastRatio(adjustedFg, adjustedBg) < WCAG_AA_THRESHOLD) {
    for (let i = 0; i < 50; i++) {
      const currentRatio = contrastRatio(adjustedFg, adjustedBg);
      if (currentRatio >= WCAG_AA_THRESHOLD) break;
      adjustedBg = adjustLightness(adjustedBg, -direction * 0.02);
    }
  }

  adjusted.foreground = adjustedFg;
  adjusted.background = adjustedBg;
  // Maintain muted hierarchy: slightly lighter/darker than foreground.
  adjusted.muted = adjustLightness(adjustedFg, direction * 0.15);
  // Re-derive surface tokens from the adjusted background.
  adjusted.border = mixColors(adjustedBg, adjustedFg, theme.mode === 'light' ? 0.15 : 0.2);
  adjusted.card = adjustLightness(adjustedBg, theme.mode === 'light' ? -0.03 : 0.03);
  adjusted.popover = adjustLightness(adjustedBg, theme.mode === 'light' ? -0.05 : 0.05);
  adjusted.input = adjustLightness(adjustedBg, theme.mode === 'light' ? -0.015 : 0.015);

  return adjusted;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze raw pixel data and produce a 14-token theme palette.
 *
 * @param pixelData  RGBA pixel data from Canvas `getImageData()`.
 * @returns          A complete `PaletteTheme` with WCAG AA compliance.
 */
export function analyzePalette(pixelData: PixelData): PaletteTheme {
  const freq = quantizePixels(pixelData);
  const dominant = extractDominantColors(freq, TOP_COLORS);
  const merged = mergeSimilarColors(dominant, MERGE_THRESHOLD);

  // Calculate average luminance for mode detection.
  let totalLum = 0;
  let totalCount = 0;
  for (const c of merged) {
    totalLum += relativeLuminance(c.r, c.g, c.b) * c.count;
    totalCount += c.count;
  }
  const avgLuminance = totalCount > 0 ? totalLum / totalCount : 0.5;
  const mode = detectMode(avgLuminance);

  const theme = classifyColors(merged, mode);
  return enforceWCAGAA(theme);
}

/**
 * Analyze pixel data and return both the theme and detailed analysis
 * intermediates (dominant colors, contrast ratio, etc.).
 */
export function analyzePaletteDetailed(pixelData: PixelData): {
  theme: PaletteTheme;
  analysis: PaletteAnalysis;
} {
  const freq = quantizePixels(pixelData);
  const dominant = extractDominantColors(freq, TOP_COLORS);
  const merged = mergeSimilarColors(dominant, MERGE_THRESHOLD);

  let totalLum = 0;
  let totalCount = 0;
  for (const c of merged) {
    totalLum += relativeLuminance(c.r, c.g, c.b) * c.count;
    totalCount += c.count;
  }
  const avgLuminance = totalCount > 0 ? totalLum / totalCount : 0.5;
  const mode = detectMode(avgLuminance);

  const theme = classifyColors(merged, mode);
  const finalTheme = enforceWCAGAA(theme);

  // Build analysis from merged clusters.
  const classified: ClassifiedColor[] = merged.map((c) => {
    const hsl = rgbToHsl(c.r, c.g, c.b);
    return {
      hex: rgbToHex(c.r, c.g, c.b),
      r: c.r,
      g: c.g,
      b: c.b,
      h: hsl.h,
      s: hsl.s,
      l: hsl.l,
      count: c.count,
    };
  });

  const byLum = [...classified].sort((a, b) => a.l - b.l);
  const bySat = [...classified].filter((c) => c.l > 0.1 && c.l < 0.95).sort((a, b) => b.s - a.s);

  const analysis: PaletteAnalysis = {
    mode,
    avgLuminance,
    dominantColors: merged.map((c) => rgbToHex(c.r, c.g, c.b)),
    brightestColor: byLum.length > 0 ? byLum[byLum.length - 1].hex : '#FFFFFF',
    darkestColor: byLum.length > 0 ? byLum[0].hex : '#000000',
    mostSaturated: bySat.length > 0 ? bySat[0].hex : '#3B82F6',
    contrastRatio: contrastRatio(finalTheme.foreground, finalTheme.background),
  };

  return { theme: finalTheme, analysis };
}
