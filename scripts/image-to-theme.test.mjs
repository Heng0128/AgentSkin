// SPDX-License-Identifier: MPL-2.0
/**
 * # image-to-theme.test.mjs
 *
 * Unit tests for the image-to-theme generation pipeline.
 * Covers argument parsing, color validation, scheme detection, token mapping,
 * WCAG 2.1 contrast calculation, auto-adjustment, grid sampling, contrast report
 * generation, and both --colors and --image input modes.
 */

import { describe, expect, it } from 'vitest';
import {
  adjustContrast,
  contrastRatio,
  detectScheme,
  ensureWcagContrast,
  findDominantHue,
  generateContrastReport,
  generateFromColors,
  isValidHex,
  MANIFEST_TOKENS,
  mapToTokens,
  normalizeHex,
  parseArgs,
  relativeLuminance,
  samplePixelGrid,
  samplePixelHybrid,
  wcagLevel,
} from './image-to-theme.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert a value is a valid hex color string (#rrggbb). */
function assertValidHex(value, label) {
  expect(typeof value, `${label} should be a string`).toBe('string');
  expect(value, `${label} should match #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
}

/** Assert all 14 manifest tokens are present and valid. */
function assertAllTokensPresent(tokens, label) {
  for (const key of MANIFEST_TOKENS) {
    expect(tokens, `${label}: missing key "${key}"`).toHaveProperty(key);
    expect(typeof tokens[key], `${label}.${key} should be a string`).toBe('string');
    expect(tokens[key].length, `${label}.${key} should not be empty`).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses --image argument', () => {
    const result = parseArgs(['--image', 'photo.png']);
    expect(result.imagePath).toBe('photo.png');
    expect(result.colors).toEqual([]);
  });

  it('parses --colors argument as comma-separated list', () => {
    const result = parseArgs(['--colors', '#1a1a2e,#4a90d9,#e0e0e0']);
    expect(result.colors).toEqual(['#1a1a2e', '#4a90d9', '#e0e0e0']);
  });

  it('parses --output and --pretty flags', () => {
    const result = parseArgs(['--colors', '#000', '--output', 'out.json', '--pretty']);
    expect(result.outputPath).toBe('out.json');
    expect(result.pretty).toBe(true);
  });

  it('parses short flags (-i, -c, -o, -p)', () => {
    const result = parseArgs(['-i', 'img.png', '-c', '#fff', '-o', 'f.json', '-p']);
    expect(result.imagePath).toBe('img.png');
    expect(result.colors).toEqual(['#fff']);
    expect(result.outputPath).toBe('f.json');
    expect(result.pretty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidHex / normalizeHex
// ---------------------------------------------------------------------------

describe('isValidHex', () => {
  it('accepts 6-digit hex', () => {
    expect(isValidHex('#ff8800')).toBe(true);
    expect(isValidHex('#000000')).toBe(true);
    expect(isValidHex('#ffffff')).toBe(true);
  });

  it('accepts 3-digit hex', () => {
    expect(isValidHex('#f80')).toBe(true);
    expect(isValidHex('#000')).toBe(true);
  });

  it('accepts 8-digit hex (with alpha)', () => {
    expect(isValidHex('#ff880080')).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(isValidHex('ff8800')).toBe(false);
    expect(isValidHex('#zzz')).toBe(false);
    expect(isValidHex('#ff')).toBe(false);
    expect(isValidHex('')).toBe(false);
    expect(isValidHex(null)).toBe(false);
  });
});

describe('normalizeHex', () => {
  it('expands 3-digit hex to 6-digit', () => {
    expect(normalizeHex('#f80')).toBe('#ff8800');
  });

  it('strips alpha from 8-digit hex', () => {
    expect(normalizeHex('#ff880080')).toBe('#ff8800');
  });

  it('lowercases hex', () => {
    expect(normalizeHex('#FF8800')).toBe('#ff8800');
  });
});

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast calculation
// ---------------------------------------------------------------------------

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('returns ~0.2126 for pure red', () => {
    // Red: R=255, G=0, B=0 → 0.2126 * 1.0 = 0.2126
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 3);
  });

  it('returns ~0.7152 for pure green', () => {
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 3);
  });

  it('returns ~0.0722 for pure blue', () => {
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 3);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black vs white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#7c9cff', '#7c9cff')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const a = '#1a1a2e';
    const b = '#4a90d9';
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 5);
  });

  it('returns correct ratio for known pair', () => {
    // WCAG example: #777777 on #ffffff ≈ 4.48
    const ratio = contrastRatio('#777777', '#ffffff');
    expect(ratio).toBeGreaterThan(4.4);
    expect(ratio).toBeLessThan(4.6);
  });
});

describe('wcagLevel', () => {
  it('returns AAA for ratio >= 7', () => {
    expect(wcagLevel(7.0)).toBe('AAA');
    expect(wcagLevel(21)).toBe('AAA');
  });

  it('returns AA for ratio >= 4.5', () => {
    expect(wcagLevel(4.5)).toBe('AA');
    expect(wcagLevel(6.9)).toBe('AA');
  });

  it('returns AA Large for ratio >= 3.0', () => {
    expect(wcagLevel(3.0)).toBe('AA Large');
    expect(wcagLevel(4.4)).toBe('AA Large');
  });

  it('returns Fail for ratio < 3', () => {
    expect(wcagLevel(2.9)).toBe('Fail');
    expect(wcagLevel(1.0)).toBe('Fail');
  });
});

// ---------------------------------------------------------------------------
// detectScheme
// ---------------------------------------------------------------------------

describe('detectScheme', () => {
  it('returns "dark" for dark palette', () => {
    const palette = [
      { color: { r: 20, g: 20, b: 30 }, weight: 5 },
      { color: { r: 40, g: 40, b: 50 }, weight: 3 },
    ];
    expect(detectScheme(palette)).toBe('dark');
  });

  it('returns "light" for light palette', () => {
    const palette = [
      { color: { r: 240, g: 240, b: 245 }, weight: 5 },
      { color: { r: 220, g: 220, b: 230 }, weight: 3 },
    ];
    expect(detectScheme(palette)).toBe('light');
  });

  it('returns "dark" for empty palette', () => {
    expect(detectScheme([])).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// findDominantHue
// ---------------------------------------------------------------------------

describe('findDominantHue', () => {
  it('finds the most saturated color hue', () => {
    const palette = [
      { color: { r: 100, g: 100, b: 100 }, weight: 5 }, // gray (low sat)
      { color: { r: 74, g: 144, b: 217 }, weight: 3 }, // vivid blue (high sat)
    ];
    const hue = findDominantHue(palette);
    // Blue has hue ~210.
    expect(hue).toBeGreaterThan(200);
    expect(hue).toBeLessThan(220);
  });

  it('returns fallback 220 for empty palette', () => {
    expect(findDominantHue([])).toBe(220);
  });
});

// ---------------------------------------------------------------------------
// samplePixelGrid
// ---------------------------------------------------------------------------

describe('samplePixelGrid', () => {
  it('returns grid-sampled colors from a uniform buffer', () => {
    // Create a 16x16 RGBA buffer with all pixels set to a known color.
    const width = 16;
    const height = 16;
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = 100;
      pixels[i * 4 + 1] = 150;
      pixels[i * 4 + 2] = 200;
      pixels[i * 4 + 3] = 255;
    }
    const result = samplePixelGrid(pixels, width, height, 4);
    // 4x4 grid = 16 cells, all should return the same color.
    expect(result).toHaveLength(16);
    for (const c of result) {
      expect(c.r).toBe(100);
      expect(c.g).toBe(150);
      expect(c.b).toBe(200);
      expect(c.weight).toBe(1);
    }
  });

  it('skips transparent pixels', () => {
    const width = 8;
    const height = 8;
    const pixels = Buffer.alloc(width * height * 4);
    // All pixels have alpha = 0 (transparent).
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4 + 3] = 0;
    }
    const result = samplePixelGrid(pixels, width, height, 4);
    expect(result).toHaveLength(0);
  });

  it('handles non-uniform image dimensions', () => {
    const width = 10;
    const height = 6;
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = 255;
      pixels[i * 4 + 1] = 0;
      pixels[i * 4 + 2] = 0;
      pixels[i * 4 + 3] = 255;
    }
    // 3x3 grid on a 10x6 image.
    const result = samplePixelGrid(pixels, width, height, 3);
    // Should return up to 9 colors (some cells might be empty if image is small).
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// samplePixelHybrid
// ---------------------------------------------------------------------------

describe('samplePixelHybrid', () => {
  it('combines grid and stride sampling without duplicates', () => {
    const width = 32;
    const height = 32;
    const pixels = Buffer.alloc(width * height * 4);
    // Fill with two distinct quadrants.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (x < 16) {
          pixels[i] = 255;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
        } else {
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 255;
        }
        pixels[i + 3] = 255;
      }
    }
    const result = samplePixelHybrid(pixels, width, height, 1000);
    // Should return at least 2 distinct colors (red and blue).
    expect(result.length).toBeGreaterThanOrEqual(2);
    // All results should have weight >= 1.
    for (const c of result) {
      expect(c.weight).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns non-empty result for opaque image', () => {
    const width = 16;
    const height = 16;
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = 128;
      pixels[i * 4 + 1] = 128;
      pixels[i * 4 + 2] = 128;
      pixels[i * 4 + 3] = 255;
    }
    const result = samplePixelHybrid(pixels, width, height, 500);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// mapToTokens
// ---------------------------------------------------------------------------

describe('mapToTokens', () => {
  function mockPalette() {
    return [
      { color: { r: 30, g: 30, b: 40 }, weight: 50 }, // dark blue-gray
      { color: { r: 74, g: 144, b: 217 }, weight: 30 }, // vivid blue (accent)
      { color: { r: 100, g: 100, b: 110 }, weight: 20 }, // gray
    ];
  }

  it('produces exactly 14 tokens', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    expect(Object.keys(tokens)).toHaveLength(14);
  });

  it('includes all required token keys', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    for (const key of MANIFEST_TOKENS) {
      expect(tokens, `missing key: ${key}`).toHaveProperty(key);
    }
  });

  it('dark mode background is dark (luminance < 0.2)', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    assertValidHex(tokens.background, 'background');
    const bg = tokens.background;
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const lum = 0.2126 * (r / 255) ** 2.2 + 0.7152 * (g / 255) ** 2.2 + 0.0722 * (b / 255) ** 2.2;
    expect(lum).toBeLessThan(0.2);
  });

  it('light mode background is light (luminance > 0.8)', () => {
    const tokens = mapToTokens(mockPalette(), 'light', 210);
    assertValidHex(tokens.background, 'background');
    const bg = tokens.background;
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const lum = 0.299 * (r / 255) + 0.587 * (g / 255) + 0.114 * (b / 255);
    expect(lum).toBeGreaterThan(0.8);
  });

  it('accent and primary are identical', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    expect(tokens.primary).toBe(tokens.accent);
  });

  it('secondary differs from accent (hue-shifted)', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    expect(tokens.secondary).not.toBe(tokens.accent);
  });

  it('semantic colors are valid hex strings', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    for (const key of ['error', 'warning', 'success', 'info']) {
      assertValidHex(tokens[key], key);
    }
  });

  it('border is 8-digit hex (with alpha)', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    expect(tokens.border).toMatch(/^#[0-9a-f]{8}$/);
  });

  it('overlay is rgba format', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    expect(tokens.overlay).toMatch(/^rgba?\(.+\)$/);
  });

  it('dark overlay is dark rgba', () => {
    const tokens = mapToTokens(mockPalette(), 'dark', 210);
    expect(tokens.overlay).toBe('rgba(0, 0, 0, 0.50)');
  });

  it('light overlay is light rgba', () => {
    const tokens = mapToTokens(mockPalette(), 'light', 210);
    expect(tokens.overlay).toBe('rgba(255, 255, 255, 0.50)');
  });
});

// ---------------------------------------------------------------------------
// adjustContrast (iterative auto-adjustment)
// ---------------------------------------------------------------------------

describe('adjustContrast', () => {
  it('returns immediately when contrast already meets target', () => {
    const result = adjustContrast('#000000', '#ffffff', 4.5, 210, 'dark');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    expect(result.iterations).toBe(0);
  });

  it('adjusts dark text on dark background toward white', () => {
    // Very dark text on dark background — contrast will be poor.
    const result = adjustContrast('#1a1a2e', '#111111', 4.5, 210, 'dark');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    expect(result.hex).not.toBe('#111111');
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('adjusts light text on light background toward black', () => {
    // Light text on light background — contrast will be poor.
    const result = adjustContrast('#f5f5f5', '#eeeeee', 4.5, 210, 'light');
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    expect(result.hex).not.toBe('#eeeeee');
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('respects the target ratio parameter', () => {
    // Request AAA (7.0) instead of AA (4.5).
    const result = adjustContrast('#1a1a2e', '#333333', 7.0, 210, 'dark');
    expect(result.ratio).toBeGreaterThanOrEqual(7.0);
  });

  it('returns best effort after max iterations', () => {
    // Extremely difficult case: mid-gray on mid-gray.
    const result = adjustContrast('#808080', '#707070', 21.0, 210, 'dark', 10);
    // Even if it can't reach 21:1, it should return the best found.
    expect(result.ratio).toBeGreaterThan(1);
    expect(result.iterations).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// ensureWcagContrast
// ---------------------------------------------------------------------------

describe('ensureWcagContrast', () => {
  it('does not modify tokens when contrast is sufficient', () => {
    const tokens = mapToTokens([{ color: { r: 74, g: 144, b: 217 }, weight: 1 }], 'dark', 210);
    const result = ensureWcagContrast(tokens, 'dark', 210);
    expect(result.text).toBe(tokens.text);
  });

  it('nudges text toward white when contrast is insufficient (dark)', () => {
    // Create tokens with text too close to background.
    const tokens = {
      ...mapToTokens([{ color: { r: 74, g: 144, b: 217 }, weight: 1 }], 'dark', 210),
      text: '#111111', // very dark text on dark bg
    };
    const result = ensureWcagContrast(tokens, 'dark', 210);
    // Text should be nudged toward white (luminance close to 1).
    expect(result.text).not.toBe('#111111');
  });

  it('nudges text toward black when contrast is insufficient (light)', () => {
    const tokens = {
      ...mapToTokens([{ color: { r: 74, g: 144, b: 217 }, weight: 1 }], 'light', 210),
      text: '#eeeeee', // light text on light bg
    };
    const result = ensureWcagContrast(tokens, 'light', 210);
    expect(result.text).not.toBe('#eeeeee');
  });
});

// ---------------------------------------------------------------------------
// generateContrastReport
// ---------------------------------------------------------------------------

describe('generateContrastReport', () => {
  it('returns report for all critical pairs', () => {
    const tokens = mapToTokens(
      [
        { color: { r: 30, g: 30, b: 40 }, weight: 50 },
        { color: { r: 74, g: 144, b: 217 }, weight: 30 },
      ],
      'dark',
      210,
    );
    const report = generateContrastReport(tokens);
    expect(report.length).toBeGreaterThanOrEqual(5);

    const pairs = report.map((r) => r.pair);
    expect(pairs).toContain('text/background');
    expect(pairs).toContain('text/surface');
    expect(pairs).toContain('muted/background');
    expect(pairs).toContain('accent/background');
    expect(pairs).toContain('primary/background');
  });

  it('each report entry has expected shape', () => {
    const tokens = mapToTokens([{ color: { r: 74, g: 144, b: 217 }, weight: 1 }], 'dark', 210);
    const report = generateContrastReport(tokens);
    for (const entry of report) {
      expect(entry).toHaveProperty('pair');
      expect(entry).toHaveProperty('ratio');
      expect(entry).toHaveProperty('level');
      expect(entry).toHaveProperty('passes');
      expect(typeof entry.ratio).toBe('number');
      expect(typeof entry.passes).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// generateFromColors (integration)
// ---------------------------------------------------------------------------

describe('generateFromColors', () => {
  it('generates a complete theme from dark colors', () => {
    const result = generateFromColors(['#1a1a2e', '#4a90d9', '#e0e0e0']);
    expect(result.scheme).toBe('dark');
    assertAllTokensPresent(result.tokens, 'dark-colors');
    expect(result.meta.source).toBe('colors');
  });

  it('generates a complete theme from light colors', () => {
    const result = generateFromColors(['#f5f5f5', '#ffffff', '#e0e0e0']);
    expect(result.scheme).toBe('light');
    assertAllTokensPresent(result.tokens, 'light-colors');
  });

  it('throws on invalid hex color', () => {
    expect(() => generateFromColors(['not-a-color'])).toThrow('Invalid hex color');
  });

  it('populates meta.extractedAt with ISO timestamp', () => {
    const result = generateFromColors(['#1a1a2e']);
    expect(typeof result.meta.extractedAt).toBe('string');
    expect(new Date(result.meta.extractedAt).toISOString()).toBe(result.meta.extractedAt);
  });

  it('text/bg contrast meets WCAG AA (>= 4.5)', () => {
    for (const colors of [
      ['#1a1a2e', '#4a90d9'],
      ['#f5f5f5', '#ffffff'],
      ['#ff0000', '#00ff00', '#0000ff'],
    ]) {
      const result = generateFromColors(colors);
      const bg = result.tokens.background;
      const text = result.tokens.text;
      const cr = contrastRatio(bg, text);
      expect(cr, `${colors.join(',')} text/bg contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('includes contrastReport in meta', () => {
    const result = generateFromColors(['#1a1a2e', '#4a90d9']);
    expect(result.meta).toHaveProperty('contrastReport');
    expect(Array.isArray(result.meta.contrastReport)).toBe(true);
    expect(result.meta.contrastReport.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 14-token contract validation
// ---------------------------------------------------------------------------

describe('MANIFEST_TOKENS', () => {
  it('contains exactly 14 tokens', () => {
    expect(MANIFEST_TOKENS).toHaveLength(14);
  });

  it('includes overlay as the 14th token', () => {
    expect(MANIFEST_TOKENS).toContain('overlay');
  });

  it('includes all expected token names', () => {
    const expected = [
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
    expect(MANIFEST_TOKENS).toEqual(expected);
  });
});
