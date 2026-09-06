// SPDX-License-Identifier: MPL-2.0
/**
 * # extract-theme-from-image.test.mjs
 *
 * Unit tests for the image-to-theme extraction pipeline.
 * Covers color utilities, median-cut quantization, mode detection,
 * 14-token mapping, and WCAG contrast enforcement.
 */

import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  detectMode,
  extractFromPixels,
  hexToRgb,
  hslToHex,
  mapToTokens,
  medianCut,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
} from './extract-theme-from-image.mjs';
import { createTestBmp, decodeBmp } from './lib/oklch-extract.mjs';

// ---------------------------------------------------------------------------
// Color converter utilities
// ---------------------------------------------------------------------------

describe('hexToRgb', () => {
  it('parses 6-digit hex correctly', () => {
    expect(hexToRgb('#ff8800')).toEqual([255, 136, 0]);
  });

  it('parses black and white', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgb('#zzz')).toBeNull();
    expect(hexToRgb('nope')).toBeNull();
  });
});

describe('rgbToHex', () => {
  it('formats RGB values as #rrggbb', () => {
    expect(rgbToHex(255, 136, 0)).toBe('#ff8800');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
  });

  it('clamps out-of-range values', () => {
    expect(rgbToHex(-10, 300, 128)).toBe('#00ff80');
  });
});

describe('rgbToHsl', () => {
  it('red has hue ≈ 0', () => {
    const [h, s, l] = rgbToHsl(255, 0, 0);
    expect(h).toBeCloseTo(0, 0);
    expect(s).toBeCloseTo(1, 1);
    expect(l).toBeCloseTo(0.5, 1);
  });

  it('white has zero saturation', () => {
    const [, s] = rgbToHsl(255, 255, 255);
    expect(s).toBeCloseTo(0, 5);
  });
});

describe('hslToHex', () => {
  it('round-trips with rgbToHsl for vivid colors', () => {
    const hex = '#4a90d9';
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    const restored = hslToHex(h, s, l);
    // Allow ±2 per channel due to quantization.
    const [r2, g2, b2] = hexToRgb(restored);
    expect(Math.abs(r - r2)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - g2)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - b2)).toBeLessThanOrEqual(2);
  });

  it('pure red → #ff0000', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
  });
});

// ---------------------------------------------------------------------------
// Perceptual metrics
// ---------------------------------------------------------------------------

describe('relativeLuminance', () => {
  it('black = 0', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
  });

  it('white = 1', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it('gray is between 0 and 1', () => {
    const l = relativeLuminance(128, 128, 128);
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(1);
  });
});

describe('contrastRatio', () => {
  it('black/white = 21', () => {
    expect(contrastRatio(0, 0, 0, 255, 255, 255)).toBeCloseTo(21, 0);
  });

  it('same color = 1', () => {
    expect(contrastRatio(100, 100, 100, 100, 100, 100)).toBeCloseTo(1, 5);
  });

  it('ratio is always >= 1', () => {
    const cr = contrastRatio(50, 100, 200, 200, 150, 80);
    expect(cr).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// median-cut quantization
// ---------------------------------------------------------------------------

describe('medianCut', () => {
  it('returns empty for empty input', () => {
    expect(medianCut([], 4)).toEqual([]);
  });

  it('returns single bucket for single color', () => {
    const result = medianCut([{ r: 100, g: 150, b: 200 }], 4);
    expect(result).toHaveLength(1);
    expect(result[0].color).toEqual({ r: 100, g: 150, b: 200 });
  });

  it('produces at most bucketCount buckets', () => {
    const colors = [];
    for (let i = 0; i < 100; i++) {
      colors.push({ r: i * 2, g: i * 3, b: i });
    }
    const result = medianCut(colors, 8);
    expect(result.length).toBeLessThanOrEqual(8);
    expect(result.length).toBeGreaterThan(0);
  });

  it('weights affect the average color', () => {
    const colors = [
      { r: 255, g: 0, b: 0, weight: 9 },
      { r: 0, g: 0, b: 255, weight: 1 },
    ];
    const result = medianCut(colors, 1);
    expect(result).toHaveLength(1);
    // Weighted average should be close to red.
    expect(result[0].color.r).toBeGreaterThan(result[0].color.b);
  });

  it('handles pre-defined color arrays (mixed warm/cool)', () => {
    const colors = [
      { r: 200, g: 50, b: 50, weight: 5 }, // red
      { r: 50, g: 200, b: 50, weight: 3 }, // green
      { r: 50, g: 50, b: 200, weight: 2 }, // blue
      { r: 200, g: 200, b: 50, weight: 4 }, // yellow
    ];
    const result = medianCut(colors, 4);
    expect(result.length).toBeLessThanOrEqual(4);
    // Each bucket should have a valid color.
    for (const bucket of result) {
      expect(bucket.color.r).toBeGreaterThanOrEqual(0);
      expect(bucket.color.r).toBeLessThanOrEqual(255);
      expect(bucket.weight).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

describe('detectMode', () => {
  it('returns "dark" for avgL < 0.5', () => {
    expect(detectMode(0.3)).toBe('dark');
    expect(detectMode(0.49)).toBe('dark');
  });

  it('returns "light" for avgL >= 0.5', () => {
    expect(detectMode(0.5)).toBe('light');
    expect(detectMode(0.8)).toBe('light');
  });

  it('boundary at exactly 0.5 is light', () => {
    expect(detectMode(0.5)).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// Token mapping
// ---------------------------------------------------------------------------

describe('mapToTokens', () => {
  /** Build a mock palette (sorted by weight desc). */
  function mockPalette() {
    return [
      { color: { r: 30, g: 30, b: 40 }, weight: 50 }, // dark blue-gray
      { color: { r: 74, g: 144, b: 217 }, weight: 30 }, // vivid blue (accent)
      { color: { r: 100, g: 100, b: 110 }, weight: 20 }, // gray
    ];
  }

  it('produces exactly 14 tokens', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    expect(Object.keys(tokens)).toHaveLength(14);
  });

  it('includes all required token keys', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    const required = [
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
    for (const key of required) {
      expect(tokens, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it('dark mode background is dark (luminance < 0.2)', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    const [r, g, b] = hexToRgb(tokens.background);
    expect(relativeLuminance(r, g, b)).toBeLessThan(0.2);
  });

  it('light mode background is light (luminance > 0.8)', () => {
    const tokens = mapToTokens(mockPalette(), 'light');
    const [r, g, b] = hexToRgb(tokens.background);
    expect(relativeLuminance(r, g, b)).toBeGreaterThan(0.8);
  });

  it('dark mode text is light (luminance > 0.7)', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    const [r, g, b] = hexToRgb(tokens.text);
    expect(relativeLuminance(r, g, b)).toBeGreaterThan(0.7);
  });

  it('light mode text is dark (luminance < 0.3)', () => {
    const tokens = mapToTokens(mockPalette(), 'light');
    const [r, g, b] = hexToRgb(tokens.text);
    expect(relativeLuminance(r, g, b)).toBeLessThan(0.3);
  });

  it('accent and primary are identical', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    expect(tokens.primary).toBe(tokens.accent);
  });

  it('text/bg contrast meets WCAG AA (>= 4.5)', () => {
    for (const mode of ['dark', 'light']) {
      const tokens = mapToTokens(mockPalette(), mode);
      const [tr, tg, tb] = hexToRgb(tokens.text);
      const [br, bg, bb] = hexToRgb(tokens.background);
      const cr = contrastRatio(tr, tg, tb, br, bg, bb);
      expect(cr, `${mode} text/bg contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('surface is between background and white in dark mode', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    const [br, bg, bb] = hexToRgb(tokens.background);
    const [sr, sg, sb] = hexToRgb(tokens.surface);
    const bgL = relativeLuminance(br, bg, bb);
    const surfL = relativeLuminance(sr, sg, sb);
    expect(surfL).toBeGreaterThan(bgL);
  });

  it('semantic colors are valid hex strings', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    for (const key of ['danger', 'warning', 'success', 'info']) {
      expect(tokens[key], `${key} should be hex`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('secondary differs from accent (hue-shifted)', () => {
    const tokens = mapToTokens(mockPalette(), 'dark');
    expect(tokens.secondary).not.toBe(tokens.accent);
  });
});

// ---------------------------------------------------------------------------
// End-to-end pipeline (uses synthetic BMP)
// ---------------------------------------------------------------------------

describe('extractFromPixels', () => {
  /** Create an RGBA pixel buffer for a solid-color image. */
  function solidPixels(width, height, r, g, b) {
    const buf = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = 255;
    }
    return buf;
  }

  it('detects dark mode for a dark image', () => {
    const pixels = solidPixels(16, 16, 20, 20, 30);
    const result = extractFromPixels(pixels, 16, 16);
    expect(result.mode).toBe('dark');
  });

  it('detects light mode for a light image', () => {
    const pixels = solidPixels(16, 16, 240, 240, 245);
    const result = extractFromPixels(pixels, 16, 16);
    expect(result.mode).toBe('light');
  });

  it('produces 14 tokens from a synthetic BMP', () => {
    // Build a synthetic BMP via the shared test helper, then decode it.
    const bmp = createTestBmp(8, 8, (i) => {
      // Gradient from dark to vivid blue.
      const t = i / 64;
      return [Math.round(t * 50), Math.round(t * 80), Math.round(100 + t * 155)];
    });
    // Decode the BMP to raw RGBA pixels for the pipeline.
    const { width, height, pixels } = decodeBmp(bmp);
    const result = extractFromPixels(pixels, width, height);
    expect(Object.keys(result.tokens)).toHaveLength(14);
  });

  it('meta contains width, height, avgL, and paletteSize', () => {
    const pixels = solidPixels(10, 10, 100, 150, 200);
    const result = extractFromPixels(pixels, 10, 10);
    expect(result.meta.width).toBe(10);
    expect(result.meta.height).toBe(10);
    expect(typeof result.meta.avgL).toBe('number');
    expect(typeof result.meta.paletteSize).toBe('number');
  });
});
