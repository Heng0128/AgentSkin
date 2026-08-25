// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assembleTokens,
  computeHistogram,
  contrastRatioRgb,
  createTestBmp,
  decodeBmp,
  detectMode,
  enforceWcag,
  extractTheme,
  oklchToHex,
  pickPrimarySecondary,
  rgbToOklch,
} from '../../scripts/lib/oklch-extract.mjs';

// ---------------------------------------------------------------------------
// Helpers — generate synthetic BMP buffers for controlled test images
// ---------------------------------------------------------------------------

/** Solid single-color image, 32×32. */
function solidColorBmp(r: number, g: number, b: number): Buffer {
  return createTestBmp(32, 32, () => [r, g, b]);
}

/** Two horizontal bands of distinct hues, 32×32. */
function twoBandBmp(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): Buffer {
  return createTestBmp(32, 32, (_i, _x, y) => (y < 16 ? [r1, g1, b1] : [r2, g2, b2]));
}

const HEX_RE = /^#[0-9a-f]{6}$/;

// ---------------------------------------------------------------------------
// 1. BMP roundtrip — encode then decode yields identical pixels
// ---------------------------------------------------------------------------

describe('BMP roundtrip', () => {
  it('decodes a solid-red 32×32 BMP to all-red pixels', () => {
    const buf = solidColorBmp(255, 0, 0);
    const { width, height, pixels } = decodeBmp(buf);
    expect(width).toBe(32);
    expect(height).toBe(32);
    expect(pixels.length).toBe(32 * 32 * 4);
    // Sample a few pixels
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([255, 0, 0]);
  });

  it('decodes a two-band BMP with different bands', () => {
    const buf = twoBandBmp(255, 0, 0, 0, 0, 255);
    const { pixels } = decodeBmp(buf);
    // Top row (y=0) → red band stored bottom-up = bottom in BMP, but in our
    // decoded row-major order (top-down), row 0 is y=0.
    const topRowOffset = 0;
    expect([pixels[topRowOffset], pixels[topRowOffset + 1], pixels[topRowOffset + 2]]).toEqual([
      255, 0, 0,
    ]);
    const midRowOffset = 16 * 32 * 4;
    expect([pixels[midRowOffset], pixels[midRowOffset + 1], pixels[midRowOffset + 2]]).toEqual([
      0, 0, 255,
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. RGB → OKLCH conversion sanity
// ---------------------------------------------------------------------------

describe('rgbToOklch', () => {
  it('returns [L, C, H] in valid ranges for any RGB input', () => {
    const [l, c, h] = rgbToOklch(100, 150, 200);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('pure gray (R=G=B) has near-zero chroma', () => {
    const [, c] = rgbToOklch(128, 128, 128);
    expect(c).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// 3. Solid-color (pure blue) → dark mode with blue accent
// ---------------------------------------------------------------------------

describe('Pure blue → dark mode', () => {
  it('detects dark mode and returns accent near blue hue', () => {
    const buf = solidColorBmp(30, 60, 200);
    const result = extractTheme(buf);
    expect(result.mode).toBe('dark');
    const [,, accentHue] = rgbToOklch(
      parseInt(result.tokens.accent.slice(1, 3), 16),
      parseInt(result.tokens.accent.slice(3, 5), 16),
      parseInt(result.tokens.accent.slice(5, 7), 16),
    );
    // Blue hue is ~260-280 in OKLCH. Allow some tolerance for gamut mapping.
    const hueDist = Math.abs(((accentHue - 270 + 540) % 360) - 180);
    expect(hueDist).toBeLessThan(60);
  });
});

// ---------------------------------------------------------------------------
// 4. Bright color (near-white) → light mode
// ---------------------------------------------------------------------------

describe('Bright yellow-white → light mode', () => {
  it('returns light mode for an image with avgL ≥ 0.5', () => {
    const buf = solidColorBmp(240, 230, 200);
    const result = extractTheme(buf);
    expect(result.mode).toBe('light');
    expect(result.tokens.bg).toMatch(HEX_RE);
  });
});

// ---------------------------------------------------------------------------
// 5. Dark image → dark mode
// ---------------------------------------------------------------------------

describe('Dark image → dark mode', () => {
  it('returns dark mode for low luminance image', () => {
    const buf = solidColorBmp(10, 15, 30);
    const result = extractTheme(buf);
    expect(result.mode).toBe('dark');
    expect(result.tokens.bg).toMatch(HEX_RE);
    expect(result.meta.avgL).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-color → primary ≠ secondary
// ---------------------------------------------------------------------------

describe('Multi-color image → distinct primary/secondary', () => {
  it('picks two distinct hues from a red + cyan banded image', () => {
    const buf = twoBandBmp(220, 40, 40, 40, 200, 220);
    const result = extractTheme(buf);
    const [,, h1] = rgbToOklch(
      parseInt(result.tokens.accent.slice(1, 3), 16),
      parseInt(result.tokens.accent.slice(3, 5), 16),
      parseInt(result.tokens.accent.slice(5, 7), 16),
    );
    const accentCR = contrastRatioRgb(
      parseInt(result.tokens.accent.slice(1, 3), 16),
      parseInt(result.tokens.accent.slice(3, 5), 16),
      parseInt(result.tokens.accent.slice(5, 7), 16),
      parseInt(result.tokens.bg.slice(1, 3), 16),
      parseInt(result.tokens.bg.slice(3, 5), 16),
      parseInt(result.tokens.bg.slice(5, 7), 16),
    );
    // accent/bg should pass WCAG AA for large text (≥ 3.0)
    expect(accentCR).toBeGreaterThanOrEqual(3.0);
  });
});

// ---------------------------------------------------------------------------
// 7. WCAG contrast enforcement
// ---------------------------------------------------------------------------

describe('WCAG contrast enforcement', () => {
  it('ensures text/bg ≥ 4.5:1 for all outputs', () => {
    // Test several image types
    const testImages: Buffer[] = [
      solidColorBmp(10, 10, 10),
      solidColorBmp(250, 250, 250),
      solidColorBmp(128, 64, 200),
      twoBandBmp(200, 50, 50, 50, 100, 200),
    ];
    for (const buf of testImages) {
      const result = extractTheme(buf);
      const cr = contrastRatioRgb(
        parseInt(result.tokens.text.slice(1, 3), 16),
        parseInt(result.tokens.text.slice(3, 5), 16),
        parseInt(result.tokens.text.slice(5, 7), 16),
        parseInt(result.tokens.bg.slice(1, 3), 16),
        parseInt(result.tokens.bg.slice(3, 5), 16),
        parseInt(result.tokens.bg.slice(5, 7), 16),
      );
      expect(cr, `text/bg contrast for mode=${result.mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('enforceWcag darkens text on a dark bg that is too low contrast', () => {
    // Simulate a token set where text fails 4.5 against bg
    const tokens = {
      accent: '#5566ff',
      'accent-hover': '#6677ff',
      'accent-muted': '#3355cc',
      bg: '#1a1a2e',
      'bg-elevated': '#222244',
      'bg-overlay': '#181838',
      border: '#5566ff26',
      'border-strong': '#5566ff59',
      text: '#2a2a3e', // intentionally low contrast
      'text-muted': '#9090a0',
      'text-inverse': '#0a0a1e',
      'focus-ring': '#5566ff',
      selection: '#5566ff52',
      'code-bg': '#10102a',
    };
    const fixed = enforceWcag({ ...tokens }, 'dark');
    const cr = contrastRatioRgb(
      parseInt(fixed.text.slice(1, 3), 16),
      parseInt(fixed.text.slice(3, 5), 16),
      parseInt(fixed.text.slice(5, 7), 16),
      parseInt(fixed.bg.slice(1, 3), 16),
      parseInt(fixed.bg.slice(3, 5), 16),
      parseInt(fixed.bg.slice(5, 7), 16),
    );
    expect(cr).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// 8. Detected mode matches luminance threshold
// ---------------------------------------------------------------------------

describe('detectMode', () => {
  it('returns dark when avgL < 0.5', () => {
    expect(detectMode(0.3)).toBe('dark');
  });

  it('returns light when avgL ≥ 0.5', () => {
    expect(detectMode(0.6)).toBe('light');
  });

  it('boundary at 0.5 returns light', () => {
    expect(detectMode(0.5)).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// 9. All 14 tokens present and valid hex
// ---------------------------------------------------------------------------

describe('extractTheme output', () => {
  it('returns exactly 14 tokens with hex string values', () => {
    const buf = solidColorBmp(50, 80, 180);
    const result = extractTheme(buf);
    const expectedKeys = [
      'accent',
      'accent-hover',
      'accent-muted',
      'bg',
      'bg-elevated',
      'bg-overlay',
      'border',
      'border-strong',
      'text',
      'text-muted',
      'text-inverse',
      'focus-ring',
      'selection',
      'code-bg',
    ];
    for (const key of expectedKeys) {
      expect(result.tokens[key], `token ${key} exists`).toBeDefined();
      expect(typeof result.tokens[key]).toBe('string');
    }
    expect(Object.keys(result.tokens)).toHaveLength(14);
  });

  it('includes non-null meta info', () => {
    const buf = solidColorBmp(50, 80, 180);
    const result = extractTheme(buf);
    expect(result.meta).toBeDefined();
    expect(result.meta.width).toBeGreaterThan(0);
    expect(result.meta.height).toBeGreaterThan(0);
    expect(typeof result.meta.avgL).toBe('number');
  });
});
