// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  computeImageBrightness,
  downscalePixels,
  extractThemePalette,
  type PixelData,
  validateImageDimensions,
} from './image-theme-analyzer';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a solid-color RGBA image. */
function solidColor(width: number, height: number, r: number, g: number, b: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

/** Create a two-color image (left half / right half). */
function splitHorizontal(
  width: number,
  height: number,
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x < width / 2) {
        data[i] = r1;
        data[i + 1] = g1;
        data[i + 2] = b1;
      } else {
        data[i] = r2;
        data[i + 1] = g2;
        data[i + 2] = b2;
      }
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Validate a hex color string (#RRGGBB uppercase). */
function expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

// ---------------------------------------------------------------------------
// 1. extractThemePalette — basic extraction
// ---------------------------------------------------------------------------

describe('extractThemePalette — basic extraction', () => {
  it('extracts primary color close to pure red', () => {
    const { data, width, height } = solidColor(32, 32, 220, 20, 60);
    const palette = extractThemePalette(data, width, height);

    expectHex(palette.primary.hex);
    expect(palette.primary.hsl.h).toBeGreaterThanOrEqual(340);
    expect(palette.primary.hsl.h).toBeLessThanOrEqual(360);
    expect(palette.mode).toBe('dark'); // crimson is dark
  });

  it('extracts primary color close to pure green', () => {
    const { data, width, height } = solidColor(32, 32, 34, 139, 34);
    const palette = extractThemePalette(data, width, height);

    expect(palette.primary.hsl.h).toBeGreaterThanOrEqual(110);
    expect(palette.primary.hsl.h).toBeLessThanOrEqual(130);
  });

  it('extracts primary color close to pure blue', () => {
    const { data, width, height } = solidColor(32, 32, 59, 130, 246);
    const palette = extractThemePalette(data, width, height);

    expect(palette.primary.hsl.h).toBeGreaterThanOrEqual(200);
    expect(palette.primary.hsl.h).toBeLessThanOrEqual(240);
  });

  it('detects light mode for bright images', () => {
    const { data, width, height } = solidColor(32, 32, 245, 245, 240);
    const palette = extractThemePalette(data, width, height);

    expect(palette.mode).toBe('light');
    expect(palette.luminance).toBeGreaterThan(0.5);
  });

  it('detects dark mode for dark images', () => {
    const { data, width, height } = solidColor(32, 32, 15, 15, 20);
    const palette = extractThemePalette(data, width, height);

    expect(palette.mode).toBe('dark');
    expect(palette.luminance).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 2. extractThemePalette — multi-color images
// ---------------------------------------------------------------------------

describe('extractThemePalette — multi-color images', () => {
  it('extracts distinct primary and secondary from a two-color image', () => {
    // Left: vivid red, Right: vivid blue.
    const { data, width, height } = splitHorizontal(64, 32, 220, 20, 60, 59, 130, 246);
    const palette = extractThemePalette(data, width, height);

    expectHex(palette.primary.hex);
    expectHex(palette.secondary.hex);
    // Primary and secondary should be different hues.
    const hueDiff = Math.abs(palette.primary.hsl.h - palette.secondary.hsl.h);
    expect(hueDiff).toBeGreaterThan(20);
  });

  it('assigns accent to the most saturated color', () => {
    // Left: grey (low sat), Right: vivid orange (high sat).
    const { data, width, height } = splitHorizontal(64, 32, 128, 128, 128, 255, 165, 0);
    const palette = extractThemePalette(data, width, height);

    // Accent should be the orange (hue ~39°).
    expect(palette.accent.hsl.h).toBeGreaterThanOrEqual(30);
    expect(palette.accent.hsl.h).toBeLessThanOrEqual(50);
  });

  it('handles a three-color image', () => {
    const data = new Uint8ClampedArray(48 * 32 * 4);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 48; x++) {
        const i = (y * 48 + x) * 4;
        if (x < 16) {
          data[i] = 220;
          data[i + 1] = 20;
          data[i + 2] = 60;
        } else if (x < 32) {
          data[i] = 34;
          data[i + 1] = 139;
          data[i + 2] = 34;
        } else {
          data[i] = 59;
          data[i + 1] = 130;
          data[i + 2] = 246;
        }
        data[i + 3] = 255;
      }
    }
    const palette = extractThemePalette(data, 48, 32);

    expectHex(palette.primary.hex);
    expectHex(palette.secondary.hex);
    expectHex(palette.accent.hex);
  });
});

// ---------------------------------------------------------------------------
// 3. extractThemePalette — edge cases
// ---------------------------------------------------------------------------

describe('extractThemePalette — edge cases', () => {
  it('handles greyscale images (no saturated pixels)', () => {
    const { data, width, height } = solidColor(32, 32, 128, 128, 128);
    const palette = extractThemePalette(data, width, height);

    expectHex(palette.primary.hex);
    expect(palette.dominantHue).toBe(0);
  });

  it('handles pure black image', () => {
    const { data, width, height } = solidColor(16, 16, 0, 0, 0);
    const palette = extractThemePalette(data, width, height);

    expect(palette.mode).toBe('dark');
    expect(palette.luminance).toBeLessThan(0.1);
  });

  it('handles pure white image', () => {
    const { data, width, height } = solidColor(16, 16, 255, 255, 255);
    const palette = extractThemePalette(data, width, height);

    expect(palette.mode).toBe('light');
    expect(palette.luminance).toBeGreaterThan(0.9);
  });

  it('skips transparent pixels', () => {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0; // fully transparent
    }
    expect(() => extractThemePalette(data, 32, 32)).toThrow('no visible pixels');
  });

  it('throws on invalid dimensions', () => {
    const data = new Uint8ClampedArray(100);
    expect(() => extractThemePalette(data, 0, 0)).toThrow('dimensions must be positive');
  });

  it('throws on mismatched data length', () => {
    const data = new Uint8ClampedArray(100);
    expect(() => extractThemePalette(data, 50, 50)).toThrow('does not match dimensions');
  });
});

// ---------------------------------------------------------------------------
// 4. downscalePixels
// ---------------------------------------------------------------------------

describe('downscalePixels', () => {
  it('does not downscale images within bounds', () => {
    const { data, width, height } = solidColor(100, 100, 128, 64, 32);
    const result = downscalePixels(data, width, height, 320);

    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it('downscales oversized images proportionally', () => {
    const { data, width, height } = solidColor(1920, 1080, 128, 64, 32);
    const result = downscalePixels(data, width, height, 320);

    expect(result.width).toBeLessThanOrEqual(320);
    expect(result.height).toBeLessThanOrEqual(320);
    // Aspect ratio preserved.
    expect(result.width / result.height).toBeCloseTo(1920 / 1080, 1);
  });

  it('preserves color after downscale', () => {
    const { data, width, height } = solidColor(640, 480, 200, 100, 50);
    const result = downscalePixels(data, width, height, 320);

    // Solid color should remain the same after downscale.
    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 5. computeImageBrightness
// ---------------------------------------------------------------------------

describe('computeImageBrightness', () => {
  it('returns 0 for pure black', () => {
    const { data, width, height } = solidColor(8, 8, 0, 0, 0);
    expect(computeImageBrightness(data, width, height)).toBeCloseTo(0, 5);
  });

  it('returns ~1 for pure white', () => {
    const { data, width, height } = solidColor(8, 8, 255, 255, 255);
    expect(computeImageBrightness(data, width, height)).toBeCloseTo(1, 1);
  });

  it('returns mid value for grey', () => {
    const { data, width, height } = solidColor(8, 8, 128, 128, 128);
    const brightness = computeImageBrightness(data, width, height);
    // WCAG relative luminance of #808080 is ~0.216 (perceptually mid-grey).
    expect(brightness).toBeGreaterThan(0.15);
    expect(brightness).toBeLessThan(0.4);
  });
});

// ---------------------------------------------------------------------------
// 6. validateImageDimensions
// ---------------------------------------------------------------------------

describe('validateImageDimensions', () => {
  it('returns null for valid dimensions', () => {
    const { data, width, height } = solidColor(100, 100, 128, 128, 128);
    expect(validateImageDimensions(data, width, height)).toBeNull();
  });

  it('rejects zero dimensions', () => {
    const data = new Uint8ClampedArray(0);
    expect(validateImageDimensions(data, 0, 0)).toBe('Image dimensions must be positive');
  });

  it('rejects oversized images', () => {
    const data = new Uint8ClampedArray(8193 * 100 * 4);
    expect(validateImageDimensions(data, 8193, 100)).toBe(
      'Image dimensions exceed maximum (8192×8192)',
    );
  });

  it('rejects mismatched data length', () => {
    const data = new Uint8ClampedArray(100);
    expect(validateImageDimensions(data, 50, 50)).toBe(
      'Pixel data length does not match dimensions',
    );
  });
});
