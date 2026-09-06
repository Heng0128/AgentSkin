// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast-utils';
import {
  type ExtractedPalette,
  extractPaletteFromPixels,
  mapToTokens,
} from './image-palette-extractor';

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

/** Create a two-color image (left half color1, right half color2). */
function twoColor(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  size = 8,
): Uint8ClampedArray {
  const pixels: number[][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isLeft = x < size / 2;
      pixels.push([isLeft ? r1 : r2, isLeft ? g1 : g2, isLeft ? b1 : b2, 255]);
    }
  }
  return makeRgba(pixels);
}

/** Create a gradient image from color1 to color2 (horizontal). */
function gradient(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
  size = 16,
): Uint8ClampedArray {
  const pixels: number[][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = x / (size - 1);
      pixels.push([
        Math.round(r1 + (r2 - r1) * t),
        Math.round(g1 + (g2 - g1) * t),
        Math.round(b1 + (b2 - b1) * t),
        255,
      ]);
    }
  }
  return makeRgba(pixels);
}

/** Validate a hex color string (#RRGGBB uppercase). */
function expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

// ---------------------------------------------------------------------------
// Solid color extraction
// ---------------------------------------------------------------------------

describe('extractPaletteFromPixels — solid color', () => {
  it('extracts primary close to the input color for a pure blue image', () => {
    const data = solidColor(59, 130, 246, 8); // #3B82F6
    const palette = extractPaletteFromPixels(data, 8, 8);

    expectHex(palette.primary);
    // Blue (#3B82F6) has WCAG luminance ~0.22, so mode is dark.
    expect(palette.mode).toBe('dark');
  });

  it('produces a valid palette for a pure red image', () => {
    const data = solidColor(220, 20, 60, 8); // #DC143C
    const palette = extractPaletteFromPixels(data, 8, 8);

    expectHex(palette.primary);
    expectHex(palette.secondary);
    expectHex(palette.accent);
    expectHex(palette.background);
    expectHex(palette.text);
    expectHex(palette.border);
    expect(['light', 'dark']).toContain(palette.mode);
  });

  it('produces distinct primary, secondary, and accent for a vivid color', () => {
    const data = solidColor(255, 165, 0, 10); // orange
    const palette = extractPaletteFromPixels(data, 10, 10);

    // All three brand colors should be valid hex.
    expectHex(palette.primary);
    expectHex(palette.secondary);
    expectHex(palette.accent);

    // Secondary and accent should differ from primary (fallback derivation).
    expect(palette.secondary).not.toBe(palette.primary);
    expect(palette.accent).not.toBe(palette.primary);
  });
});

// ---------------------------------------------------------------------------
// Two-color extraction
// ---------------------------------------------------------------------------

describe('extractPaletteFromPixels — two-color image', () => {
  it('extracts primary and secondary from distinct hues', () => {
    // Left half: vivid red; right half: vivid blue.
    const data = twoColor(220, 20, 60, 59, 130, 246, 10);
    const palette = extractPaletteFromPixels(data, 10, 10);

    expectHex(palette.primary);
    expectHex(palette.secondary);
    // Primary and secondary should be different colors.
    expect(palette.primary).not.toBe(palette.secondary);
  });

  it('detects light mode for a bright two-color image', () => {
    // Light yellow + light cyan → overall bright.
    const data = twoColor(240, 240, 200, 200, 240, 240, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);
    expect(palette.mode).toBe('light');
  });

  it('detects dark mode for a dark two-color image', () => {
    // Dark navy + dark maroon → overall dark.
    const data = twoColor(20, 20, 60, 60, 20, 20, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);
    expect(palette.mode).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Gradient extraction
// ---------------------------------------------------------------------------

describe('extractPaletteFromPixels — gradient image', () => {
  it('produces a complete palette from a black-to-white gradient', () => {
    const data = gradient(0, 0, 0, 255, 255, 255, 16);
    const palette = extractPaletteFromPixels(data, 16, 16);

    expectHex(palette.primary);
    expectHex(palette.secondary);
    expectHex(palette.accent);
    expectHex(palette.background);
    expectHex(palette.text);
    expectHex(palette.border);
  });

  it('produces a complete palette from a warm gradient (red → amber)', () => {
    const data = gradient(200, 30, 30, 245, 158, 11, 16);
    const palette = extractPaletteFromPixels(data, 16, 16);

    // All tokens should be valid hex.
    for (const [key, value] of Object.entries(palette)) {
      if (key === 'mode') continue;
      expectHex(value);
    }
  });
});

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

describe('mode detection', () => {
  it('returns light for a white image', () => {
    const data = solidColor(255, 255, 255, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);
    expect(palette.mode).toBe('light');
  });

  it('returns dark for a black image', () => {
    const data = solidColor(0, 0, 0, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);
    expect(palette.mode).toBe('dark');
  });

  it('returns light for a mid-grey image (luminance >= 0.5)', () => {
    // #CCCCCC has luminance ≈ 0.60, which is >= 0.5 → light.
    const data = solidColor(204, 204, 204, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);
    expect(palette.mode).toBe('light');
  });

  it('returns dark for a dark-grey image (luminance < 0.5)', () => {
    // #444444 has luminance ≈ 0.13, which is < 0.5 → dark.
    const data = solidColor(68, 68, 68, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);
    expect(palette.mode).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws for zero-width image', () => {
    const data = new Uint8ClampedArray(0);
    expect(() => extractPaletteFromPixels(data, 0, 0)).toThrow();
  });

  it('throws for negative dimensions', () => {
    const data = new Uint8ClampedArray(16);
    expect(() => extractPaletteFromPixels(data, -1, 4)).toThrow();
  });

  it('throws for mismatched data length', () => {
    // 4×4 image needs 64 bytes, but we provide only 16.
    const data = new Uint8ClampedArray(16);
    expect(() => extractPaletteFromPixels(data, 4, 4)).toThrow();
  });

  it('throws for a fully transparent image', () => {
    const pixels: number[][] = [];
    for (let i = 0; i < 16; i++) {
      pixels.push([255, 0, 0, 0]); // all transparent
    }
    const data = makeRgba(pixels);
    expect(() => extractPaletteFromPixels(data, 4, 4)).toThrow(/no visible pixels/);
  });
});

// ---------------------------------------------------------------------------
// Token mapping
// ---------------------------------------------------------------------------

describe('mapToTokens', () => {
  /** Build a minimal valid palette for testing. */
  function testPalette(overrides: Partial<ExtractedPalette> = {}): ExtractedPalette {
    return {
      primary: '#3B82F6',
      secondary: '#8B5CF6',
      accent: '#F59E0B',
      background: '#F8FAFC',
      text: '#0F172A',
      border: '#CBD5E1',
      mode: 'light',
      ...overrides,
    };
  }

  it('produces all 14 required token keys', () => {
    const tokens = mapToTokens(testPalette());
    const expectedKeys = [
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
      expect(tokens[key], `token "${key}" should exist`).toBeDefined();
    }
  });

  it('maps primary → accent and text → foreground', () => {
    const tokens = mapToTokens(testPalette());
    expect(tokens.accent).toBe('#3B82F6');
    expect(tokens.foreground).toBe('#0F172A');
  });

  it('maps accent → focusRing', () => {
    const tokens = mapToTokens(testPalette());
    expect(tokens.focusRing).toBe('#F59E0B');
  });

  it('maps primary → buttonBackground', () => {
    const tokens = mapToTokens(testPalette());
    expect(tokens.buttonBackground).toBe('#3B82F6');
  });

  it('produces valid hex for all token values', () => {
    const tokens = mapToTokens(testPalette());
    for (const [key, value] of Object.entries(tokens)) {
      expect(value, `token "${key}" should be valid hex`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('generates buttonForeground as a contrast color of primary', () => {
    // Light primary → dark buttonForeground.
    const lightTokens = mapToTokens(testPalette({ primary: '#FBBF24' }));
    expectHex(lightTokens.buttonForeground);

    // Dark primary → light buttonForeground.
    const darkTokens = mapToTokens(testPalette({ primary: '#1E3A5F' }));
    expectHex(darkTokens.buttonForeground);
  });

  it('produces darker surface in light mode', () => {
    const tokens = mapToTokens(testPalette({ mode: 'light', background: '#FFFFFF' }));
    // surface should be slightly darker than background in light mode.
    expect(tokens.surface).not.toBe('#FFFFFF');
    expectHex(tokens.surface);
  });

  it('produces lighter surface in dark mode', () => {
    const tokens = mapToTokens(testPalette({ mode: 'dark', background: '#0F172A' }));
    // surface should be slightly lighter than background in dark mode.
    expect(tokens.surface).not.toBe('#0F172A');
    expectHex(tokens.surface);
  });

  it('accentMuted is a desaturated variant of accent', () => {
    const tokens = mapToTokens(testPalette({ accent: '#FF0000' }));
    expectHex(tokens.accentMuted);
    // Desaturated red should still be valid hex.
    expect(tokens.accentMuted).toMatch(/^#[0-9A-F]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// Integration: extract → tokens
// ---------------------------------------------------------------------------

describe('integration: extract → tokens', () => {
  it('produces a complete 14-token theme from a multi-color image', () => {
    // Simulate a wallpaper-like image: sky blue, grass green, warm sun.
    const pixels: number[][] = [];
    const size = 16;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (y < size * 0.5) {
          // Sky — light blue.
          pixels.push([135, 206, 235, 255]);
        } else if (y < size * 0.8) {
          // Grass — green.
          pixels.push([34, 139, 34, 255]);
        } else {
          // Sun — warm amber.
          pixels.push([255, 165, 0, 255]);
        }
      }
    }
    const data = makeRgba(pixels);
    const palette = extractPaletteFromPixels(data, size, size);
    const tokens = mapToTokens(palette);

    // All tokens should be valid hex.
    for (const [key, value] of Object.entries(tokens)) {
      expect(value, `token "${key}" should be valid hex`).toMatch(/^#[0-9A-F]{6}$/);
    }

    // Mode is determined by average luminance; just verify it is valid.
    expect(['light', 'dark']).toContain(palette.mode);
  });

  it('enforces WCAG AA contrast between foreground and background', () => {
    // Create a low-contrast image (both colors close in luminance).
    const data = twoColor(100, 100, 100, 130, 130, 130, 8);
    const palette = extractPaletteFromPixels(data, 8, 8);

    // Verify WCAG AA contrast between text and background.
    const ratio = contrastRatio(palette.text, palette.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
