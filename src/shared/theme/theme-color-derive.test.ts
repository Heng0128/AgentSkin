// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast-utils';
import {
  type DerivedColorScheme,
  type DominantColorResult,
  detectMode,
  extractDominantColor,
  generateColorScheme,
  matchThemePalette,
  PREDEFINED_PALETTES,
} from './theme-color-derive';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create an RGBA Uint8ClampedArray from a flat list of [r, g, b, a] values. */
function makeRgba(pixels: number[][]): Uint8ClampedArray {
  const flat: number[] = [];
  for (const p of pixels) {
    flat.push(p[0], p[1], p[2], p[3] ?? 255);
  }
  return new Uint8ClampedArray(flat);
}

/** Create a solid-color image of the given size. */
function solidColor(r: number, g: number, b: number, size = 8): Uint8ClampedArray {
  const pixels: number[][] = [];
  for (let i = 0; i < size * size; i++) {
    pixels.push([r, g, b, 255]);
  }
  return makeRgba(pixels);
}

/** Validate a hex color string (#RRGGBB uppercase). */
function _expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

// ---------------------------------------------------------------------------
// 1. HSL bucketing algorithm correctness (tests 1–5)
// ---------------------------------------------------------------------------

describe('extractDominantColor — HSL bucketing', () => {
  it('extracts dominant hue close to pure red (0°)', () => {
    const data = solidColor(220, 20, 60, 8); // crimson — hue ≈ 350°
    const result = extractDominantColor(data, 8, 8);

    expect(result.hue).toBeGreaterThanOrEqual(340);
    expect(result.hue).toBeLessThanOrEqual(360);
    expect(result.saturation).toBeGreaterThan(0.5); // high saturation
  });

  it('extracts dominant hue close to pure green (120°)', () => {
    const data = solidColor(34, 139, 34, 8); // forest green — hue ≈ 120°
    const result = extractDominantColor(data, 8, 8);

    expect(result.hue).toBeGreaterThanOrEqual(110);
    expect(result.hue).toBeLessThanOrEqual(130);
  });

  it('extracts dominant hue close to pure blue (240°)', () => {
    const data = solidColor(59, 130, 246, 8); // #3B82F6 — hue ≈ 218°
    const result = extractDominantColor(data, 8, 8);

    // Blue sector: 210–270° (sector 3 = 180–240, sector 4 = 240–300)
    // #3B82F6 hue is approximately 218°.
    expect(result.hue).toBeGreaterThanOrEqual(200);
    expect(result.hue).toBeLessThanOrEqual(240);
  });

  it('assigns high-saturation pixels to the high-saturation bucket', () => {
    // Vivid orange: high saturation → bucket level 1 (index 0 + 6 = 6)
    const data = solidColor(255, 165, 0, 8); // orange — hue ≈ 39°, s ≈ 1.0
    const result = extractDominantColor(data, 8, 8);

    expect(result.saturation).toBeGreaterThan(0.5);
    expect(result.hue).toBeGreaterThanOrEqual(30);
    expect(result.hue).toBeLessThanOrEqual(50);
  });

  it('weights vivid colors more than muted ones in a two-color image', () => {
    // Left half: vivid red (high saturation, high weight via s²).
    // Right half: muted greyish red (low saturation, low weight).
    const pixels: number[][] = [];
    const size = 10;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < size / 2) {
          pixels.push([220, 20, 60, 255]); // vivid crimson
        } else {
          pixels.push([150, 100, 100, 255]); // muted rose
        }
      }
    }
    const data = makeRgba(pixels);
    const result = extractDominantColor(data, size, size);

    // Dominant hue should be close to crimson (≈350°), not the muted color.
    expect(result.hue).toBeGreaterThanOrEqual(340);
  });
});

// ---------------------------------------------------------------------------
// 2. Mode detection boundary values (tests 6–9)
// ---------------------------------------------------------------------------

describe('detectMode — boundary values', () => {
  it('returns light for luminance above threshold', () => {
    // Luminance 0.6 > 140/255 ≈ 0.549
    expect(detectMode(0.6)).toBe('light');
  });

  it('returns dark for luminance below threshold', () => {
    // Luminance 0.4 < 140/255 ≈ 0.549
    expect(detectMode(0.4)).toBe('dark');
  });

  it('returns light for luminance exactly at threshold', () => {
    // At threshold: >= means light.
    const threshold = 140 / 255;
    expect(detectMode(threshold)).toBe('light');
  });

  it('respects custom threshold', () => {
    // With threshold 0.7, luminance 0.6 should be dark.
    expect(detectMode(0.6, 0.7)).toBe('dark');
    // With threshold 0.5, luminance 0.6 should be light.
    expect(detectMode(0.6, 0.5)).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// 3. Theme palette matching logic (tests 10–13)
// ---------------------------------------------------------------------------

describe('matchThemePalette', () => {
  it('matches a pink-dominant light image to sakura-girl', () => {
    const dominant: DominantColorResult = {
      hue: 340,
      saturation: 0.65,
      lightness: 0.6,
      luminance: 0.7,
      mode: 'light',
    };
    const match = matchThemePalette(dominant);
    expect(match.paletteId).toBe('sakura-girl');
    expect(match.confidence).toBeGreaterThan(0.7);
  });

  it('matches a blue-dominant dark image to deep-sea', () => {
    const dominant: DominantColorResult = {
      hue: 220,
      saturation: 0.55,
      lightness: 0.4,
      luminance: 0.2,
      mode: 'dark',
    };
    const match = matchThemePalette(dominant);
    expect(match.paletteId).toBe('deep-sea');
    expect(match.confidence).toBeGreaterThan(0.6);
  });

  it('matches a yellow-dominant light image to sunny-campus', () => {
    const dominant: DominantColorResult = {
      hue: 45,
      saturation: 0.7,
      lightness: 0.65,
      luminance: 0.75,
      mode: 'light',
    };
    const match = matchThemePalette(dominant);
    expect(match.paletteId).toBe('sunny-campus');
  });

  it('produces lower confidence for a hue far from all palettes', () => {
    // 270° (purple/violet) is the farthest point from all predefined palettes.
    // Nearest palettes: deep-sea 220° (50° away), sakura-girl 340° (70° away).
    const dominant: DominantColorResult = {
      hue: 270,
      saturation: 0.5,
      lightness: 0.5,
      luminance: 0.5,
      mode: 'light',
    };
    const match = matchThemePalette(dominant);
    // Confidence should be moderate (nearest palette is 50° away).
    expect(match.confidence).toBeLessThan(0.8);
    expect(match.hueDistance).toBeGreaterThan(30);
  });
});

// ---------------------------------------------------------------------------
// 4. Color scheme generation completeness (tests 14–17)
// ---------------------------------------------------------------------------

describe('generateColorScheme', () => {
  it('produces all 16 token keys', () => {
    const dominant: DominantColorResult = {
      hue: 210,
      saturation: 0.6,
      lightness: 0.55,
      luminance: 0.7,
      mode: 'light',
    };
    const scheme = generateColorScheme(dominant);

    const expectedKeys = [
      'mode',
      'accent',
      'accentMuted',
      'secondary',
      'background',
      'foreground',
      'muted',
      'surface',
      'surfaceElevated',
      'border',
      'codeBackground',
      'codeForeground',
      'inputBackground',
      'buttonBackground',
      'buttonForeground',
      'focusRing',
    ];
    for (const key of expectedKeys) {
      expect(scheme[key as keyof DerivedColorScheme], `key "${key}" should exist`).toBeDefined();
    }
  });

  it('produces valid hex for all color tokens', () => {
    const dominant: DominantColorResult = {
      hue: 30,
      saturation: 0.5,
      lightness: 0.5,
      luminance: 0.3,
      mode: 'dark',
    };
    const scheme = generateColorScheme(dominant);

    const colorKeys = Object.keys(scheme).filter((k) => k !== 'mode');
    for (const key of colorKeys) {
      const value = scheme[key as keyof DerivedColorScheme];
      expect(value, `token "${key}" should be valid hex`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('enforces WCAG AA contrast between foreground and background', () => {
    const dominant: DominantColorResult = {
      hue: 0,
      saturation: 0.1, // very low saturation — challenging for contrast
      lightness: 0.5,
      luminance: 0.5,
      mode: 'light',
    };
    const scheme = generateColorScheme(dominant);

    const ratio = contrastRatio(scheme.foreground, scheme.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('generates buttonForeground as a contrast color of accent', () => {
    const dominant: DominantColorResult = {
      hue: 210,
      saturation: 0.7,
      lightness: 0.55,
      luminance: 0.7,
      mode: 'light',
    };
    const scheme = generateColorScheme(dominant);

    // buttonBackground === accent
    expect(scheme.buttonBackground).toBe(scheme.accent);
    // buttonForeground should be either #000000 or #FFFFFF (contrast extremes).
    expect(['#000000', '#FFFFFF']).toContain(scheme.buttonForeground);
  });
});

// ---------------------------------------------------------------------------
// 5. Error handling (tests 18–19)
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws for zero or negative dimensions', () => {
    const data = new Uint8ClampedArray(0);
    expect(() => extractDominantColor(data, 0, 0)).toThrow();
    expect(() => extractDominantColor(data, -1, 4)).toThrow();
  });

  it('throws for a fully transparent image', () => {
    const pixels: number[][] = [];
    for (let i = 0; i < 16; i++) {
      pixels.push([255, 0, 0, 0]); // all transparent
    }
    const data = makeRgba(pixels);
    expect(() => extractDominantColor(data, 4, 4)).toThrow(/no visible pixels/);
  });
});

// ---------------------------------------------------------------------------
// 6. Integration: full pipeline (test 20)
// ---------------------------------------------------------------------------

describe('integration: deriveFromPixels pipeline', () => {
  it('produces a complete result from a realistic multi-color image', () => {
    // Simulate a landscape: sky blue, grass green, warm sun.
    const pixels: number[][] = [];
    const size = 16;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (y < size * 0.5) {
          pixels.push([135, 206, 235, 255]); // sky blue
        } else if (y < size * 0.8) {
          pixels.push([34, 139, 34, 255]); // grass green
        } else {
          pixels.push([255, 165, 0, 255]); // sun amber
        }
      }
    }
    const data = makeRgba(pixels);

    // Run the full pipeline via extractDominantColor + match + generate.
    const dominant = extractDominantColor(data, size, size);
    const match = matchThemePalette(dominant);
    const scheme = generateColorScheme(dominant);

    // Dominant should be valid.
    expect(dominant.hue).toBeGreaterThanOrEqual(0);
    expect(dominant.hue).toBeLessThan(360);
    expect(['light', 'dark']).toContain(dominant.mode);

    // Match should reference a known palette.
    const knownIds = PREDEFINED_PALETTES.map((p) => p.id);
    expect(knownIds).toContain(match.paletteId);

    // Scheme should have valid hex for all tokens.
    const colorKeys = Object.keys(scheme).filter((k) => k !== 'mode');
    for (const key of colorKeys) {
      const value = scheme[key as keyof DerivedColorScheme];
      expect(value, `token "${key}" should be valid hex`).toMatch(/^#[0-9A-F]{6}$/);
    }

    // WCAG AA contrast.
    const ratio = contrastRatio(scheme.foreground, scheme.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
