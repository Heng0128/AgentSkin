// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  adjustLightness,
  adjustSaturation,
  analyzePalette,
  classifyColors,
  contrastRatio,
  detectMode,
  extractDominantColors,
  hexToRgb,
  hslToRgb,
  mergeSimilarColors,
  mixColors,
  type PixelData,
  type QuantizedColor,
  quantizePixels,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
} from './palette-analyzer';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a PixelData from a flat RGBA array. */
function makePixelData(rgba: number[], width: number, height: number): PixelData {
  return { data: new Uint8ClampedArray(rgba), width, height };
}

/** Create a solid-color image. */
function solidColor(r: number, g: number, b: number, size = 4): PixelData {
  const rgba: number[] = [];
  for (let i = 0; i < size * size; i++) {
    rgba.push(r, g, b, 255);
  }
  return makePixelData(rgba, size, size);
}

/** Create a two-color image (left half color1, right half color2). */
function twoColor(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  size = 4,
): PixelData {
  const rgba: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isLeft = x < size / 2;
      rgba.push(isLeft ? r1 : r2, isLeft ? g1 : g2, isLeft ? b1 : b2, 255);
    }
  }
  return makePixelData(rgba, size, size);
}

// ---------------------------------------------------------------------------
// Color conversion roundtrip
// ---------------------------------------------------------------------------

describe('color conversion', () => {
  it('hexToRgb parses #3B82F6 correctly', () => {
    const { r, g, b } = hexToRgb('#3B82F6');
    expect(r).toBe(0x3b);
    expect(g).toBe(0x82);
    expect(b).toBe(0xf6);
  });

  it('rgbToHex formats back to uppercase hex', () => {
    expect(rgbToHex(0x3b, 0x82, 0xf6)).toBe('#3B82F6');
  });

  it('rgbToHsl → hslToRgb roundtrips within tolerance', () => {
    const hsl = rgbToHsl(255, 69, 58); // #FF453A
    const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    expect(Math.abs(rgb.r - 255)).toBeLessThan(3);
    expect(Math.abs(rgb.g - 69)).toBeLessThan(3);
    expect(Math.abs(rgb.b - 58)).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

describe('quantizePixels', () => {
  it('counts a single solid color as one cluster', () => {
    const pd = solidColor(128, 64, 200, 8);
    const freq = quantizePixels(pd);
    expect(freq.size).toBe(1);
    const [entry] = [...freq.values()];
    expect(entry.count).toBe(64); // 8×8
  });

  it('skips fully transparent pixels', () => {
    const rgba: number[] = [];
    for (let i = 0; i < 16; i++) {
      rgba.push(255, 0, 0, 0); // all transparent
    }
    const pd = makePixelData(rgba, 4, 4);
    const freq = quantizePixels(pd);
    expect(freq.size).toBe(0);
  });

  it('quantizes similar colors into the same bin', () => {
    // Colors within the same 5-bit bin (step=8, center=4).
    // 128 >> 3 = 16, 16 << 3 = 128, 128 | 4 = 132
    // 130 >> 3 = 16, 16 << 3 = 128, 128 | 4 = 132  ← same bin
    // 200 >> 3 = 25, 25 << 3 = 200, 200 | 4 = 204
    // 202 >> 3 = 25, 25 << 3 = 200, 200 | 4 = 204  ← same bin
    const rgba: number[] = [];
    for (let i = 0; i < 16; i++) {
      rgba.push(128, 64, 200, 255);
    }
    // Add slight variations within the same bin.
    for (let i = 0; i < 16; i++) {
      rgba.push(130, 66, 202, 255);
    }
    const pd = makePixelData(rgba, 8, 4);
    const freq = quantizePixels(pd);
    // Both should quantize to the same bin.
    expect(freq.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Dominant color extraction
// ---------------------------------------------------------------------------

describe('extractDominantColors', () => {
  it('returns colors sorted by frequency descending', () => {
    const pd = twoColor(255, 0, 0, 0, 0, 255, 8); // 32 red, 32 blue
    const freq = quantizePixels(pd);
    const dominant = extractDominantColors(freq, 4);
    expect(dominant.length).toBeGreaterThanOrEqual(2);
    // Both should have equal count (32 each).
    expect(dominant[0].count).toBe(32);
    expect(dominant[1].count).toBe(32);
  });

  it('limits results to topN', () => {
    const pd = solidColor(100, 100, 100, 4);
    const freq = quantizePixels(pd);
    const dominant = extractDominantColors(freq, 1);
    expect(dominant.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Merge similar colors
// ---------------------------------------------------------------------------

describe('mergeSimilarColors', () => {
  it('merges colors within the distance threshold', () => {
    const colors: QuantizedColor[] = [
      { r: 128, g: 64, b: 200, count: 10 },
      { r: 130, g: 66, b: 198, count: 8 }, // very close to first
      { r: 10, g: 10, b: 10, count: 5 },
    ];
    const merged = mergeSimilarColors(colors, 32);
    expect(merged.length).toBe(2);
  });

  it('keeps distant colors separate', () => {
    const colors: QuantizedColor[] = [
      { r: 255, g: 0, b: 0, count: 10 },
      { r: 0, g: 255, b: 0, count: 10 },
      { r: 0, g: 0, b: 255, count: 10 },
    ];
    const merged = mergeSimilarColors(colors, 32);
    expect(merged.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

describe('detectMode', () => {
  it('returns light for avgLuminance >= 0.5', () => {
    expect(detectMode(0.6)).toBe('light');
    expect(detectMode(0.5)).toBe('light');
  });

  it('returns dark for avgLuminance < 0.5', () => {
    expect(detectMode(0.4)).toBe('dark');
    expect(detectMode(0.1)).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Contrast ratio
// ---------------------------------------------------------------------------

describe('contrastRatio', () => {
  it('returns 21.0 for black on white', () => {
    const ratio = contrastRatio('#000000', '#FFFFFF');
    expect(ratio).toBeCloseTo(21.0, 1);
  });

  it('returns 1.0 for identical colors', () => {
    const ratio = contrastRatio('#808080', '#808080');
    expect(ratio).toBeCloseTo(1.0, 2);
  });

  it('is symmetric (order independent)', () => {
    const a = contrastRatio('#FF0000', '#FFFFFF');
    const b = contrastRatio('#FFFFFF', '#FF0000');
    expect(a).toBeCloseTo(b, 5);
  });
});

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

describe('mixColors', () => {
  it('returns hex1 at ratio 0', () => {
    expect(mixColors('#FF0000', '#0000FF', 0)).toBe('#FF0000');
  });

  it('returns hex2 at ratio 1', () => {
    expect(mixColors('#FF0000', '#0000FF', 1)).toBe('#0000FF');
  });

  it('produces a midpoint blend', () => {
    const mid = mixColors('#000000', '#FFFFFF', 0.5);
    const { r, g, b } = hexToRgb(mid);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135);
    expect(g).toBeGreaterThan(120);
    expect(g).toBeLessThan(135);
    expect(b).toBeGreaterThan(120);
    expect(b).toBeLessThan(135);
  });
});

describe('adjustLightness', () => {
  it('lightens a dark color', () => {
    const lighter = adjustLightness('#000000', 0.5);
    const { l } = rgbToHsl(...(Object.values(hexToRgb(lighter)) as [number, number, number]));
    expect(l).toBeGreaterThan(0.4);
  });

  it('darkens a light color', () => {
    const darker = adjustLightness('#FFFFFF', -0.5);
    const { l } = rgbToHsl(...(Object.values(hexToRgb(darker)) as [number, number, number]));
    expect(l).toBeLessThan(0.6);
  });
});

describe('adjustSaturation', () => {
  it('desaturates a saturated color', () => {
    const desat = adjustSaturation('#FF0000', 0.0);
    const { s } = rgbToHsl(...(Object.values(hexToRgb(desat)) as [number, number, number]));
    expect(s).toBeCloseTo(0, 1);
  });

  it('preserves saturation at factor 1', () => {
    const orig = rgbToHsl(255, 0, 0);
    const same = adjustSaturation('#FF0000', 1);
    const { s } = rgbToHsl(...(Object.values(hexToRgb(same)) as [number, number, number]));
    expect(s).toBeCloseTo(orig.s, 1);
  });
});

// ---------------------------------------------------------------------------
// classifyColors
// ---------------------------------------------------------------------------

describe('classifyColors', () => {
  it('assigns background to brightest cluster in light mode', () => {
    const clusters: QuantizedColor[] = [
      { r: 250, g: 250, b: 250, count: 50 }, // near-white
      { r: 30, g: 30, b: 30, count: 30 }, // near-black
      { r: 59, g: 130, b: 246, count: 20 }, // blue accent
    ];
    const theme = classifyColors(clusters, 'light');
    expect(theme.mode).toBe('light');
    expect(theme.background).toBe('#FAFAFA');
    expect(theme.foreground).toBe('#1E1E1E');
  });

  it('assigns background to darkest cluster in dark mode', () => {
    const clusters: QuantizedColor[] = [
      { r: 10, g: 10, b: 10, count: 50 }, // near-black
      { r: 240, g: 240, b: 240, count: 30 }, // near-white
      { r: 59, g: 130, b: 246, count: 20 }, // blue accent
    ];
    const theme = classifyColors(clusters, 'dark');
    expect(theme.mode).toBe('dark');
    expect(theme.background).toBe('#0A0A0A');
    expect(theme.foreground).toBe('#F0F0F0');
  });

  it('picks the most saturated color as accent', () => {
    const clusters: QuantizedColor[] = [
      { r: 200, g: 200, b: 200, count: 40 }, // grey
      { r: 50, g: 50, b: 50, count: 30 }, // dark grey
      { r: 220, g: 20, b: 60, count: 10 }, // crimson (most saturated)
    ];
    const theme = classifyColors(clusters, 'light');
    expect(theme.accent).toBe('#DC143C');
  });
});

// ---------------------------------------------------------------------------
// analyzePalette (integration)
// ---------------------------------------------------------------------------

describe('analyzePalette', () => {
  it('returns all 14 required tokens', () => {
    const pd = twoColor(240, 240, 240, 30, 30, 30, 8);
    const theme = analyzePalette(pd);
    const required: (keyof typeof theme)[] = [
      'mode',
      'background',
      'foreground',
      'primary',
      'secondary',
      'accent',
      'muted',
      'border',
      'card',
      'popover',
      'input',
      'ring',
      'destructive',
      'success',
      'warning',
    ];
    for (const key of required) {
      expect(theme[key], `token "${key}" should be defined`).toBeDefined();
    }
  });

  it('detects light mode for a bright image', () => {
    const pd = solidColor(240, 240, 240, 8);
    const theme = analyzePalette(pd);
    expect(theme.mode).toBe('light');
  });

  it('detects dark mode for a dark image', () => {
    const pd = solidColor(20, 20, 20, 8);
    const theme = analyzePalette(pd);
    expect(theme.mode).toBe('dark');
  });

  it('enforces WCAG AA contrast between foreground and background', () => {
    // Create a low-contrast image (both colors close in luminance).
    // After quantization: (100,100,100)→(100) and (130,130,130)→(132).
    const pd = twoColor(100, 100, 100, 130, 130, 130, 8);
    const theme = analyzePalette(pd);
    const ratio = contrastRatio(theme.foreground, theme.background);
    // WCAG AA enforcement should push foreground/background apart
    // to reach at least 4.5:1 even from a low-contrast source.
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('generates valid hex color strings for all tokens', () => {
    const pd = twoColor(200, 200, 200, 50, 50, 50, 8);
    const theme = analyzePalette(pd);
    const hexPattern = /^#[0-9A-F]{6}$/;
    for (const [key, value] of Object.entries(theme)) {
      if (key === 'mode') continue;
      expect(value, `token "${key}" should be valid hex`).toMatch(hexPattern);
    }
  });

  it('produces a complete theme from a multi-color image', () => {
    // Simulate a wallpaper-like image with sky, ground, and accent.
    const rgba: number[] = [];
    const size = 16;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (y < size * 0.6) {
          // Sky — light blue.
          rgba.push(135, 206, 235, 255);
        } else if (y < size * 0.8) {
          // Grass — green.
          rgba.push(34, 139, 34, 255);
        } else {
          // Accent — warm amber.
          rgba.push(255, 165, 0, 255);
        }
      }
    }
    const pd = makePixelData(rgba, size, size);
    const theme = analyzePalette(pd);

    expect(theme.mode).toBe('light');
    expect(theme.background).toBeTruthy();
    expect(theme.foreground).toBeTruthy();
    expect(theme.accent).toBeTruthy();
    // Semantic colors should be present.
    expect(theme.destructive).toMatch(/^#[0-9A-F]{6}$/);
    expect(theme.success).toMatch(/^#[0-9A-F]{6}$/);
    expect(theme.warning).toMatch(/^#[0-9A-F]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// relativeLuminance
// ---------------------------------------------------------------------------

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it('returns a mid value for grey', () => {
    // Rec.709 relative luminance for grey(128) = 128/255 ≈ 0.502
    const lum = relativeLuminance(128, 128, 128);
    expect(lum).toBeGreaterThan(0.45);
    expect(lum).toBeLessThan(0.55);
  });
});
