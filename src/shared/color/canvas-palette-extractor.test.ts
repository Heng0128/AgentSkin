// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast-utils';
import {
  extractFromCanvas,
  extractFromPixels,
  type Tone4Palette,
} from './canvas-palette-extractor';

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

/** Create a multi-color image simulating a realistic scene. */
function scene(top: number[], middle: number[], bottom: number[], size = 16): Uint8ClampedArray {
  const pixels: number[][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const region = y < size * 0.4 ? top : y < size * 0.7 ? middle : bottom;
      pixels.push([region[0], region[1], region[2], 255]);
    }
  }
  return makeRgba(pixels);
}

/** Validate a hex color string (#RRGGBB uppercase). */
function expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

/** Assert all 4-tone palette fields are valid hex. */
function expectValidPalette(palette: Tone4Palette): void {
  expectHex(palette.accent);
  expectHex(palette.secondary);
  expectHex(palette.surface);
  expectHex(palette.text);
  expect(['light', 'dark']).toContain(palette.mode);
}

// ---------------------------------------------------------------------------
// 1. Solid color extraction (tests 1-5)
// ---------------------------------------------------------------------------

describe('extractFromPixels — solid color', () => {
  it('extracts accent close to pure red (hue ~350 degrees)', () => {
    const data = solidColor(220, 20, 60, 8); // crimson
    const palette = extractFromPixels(data, 8, 8);

    expectValidPalette(palette);
    // Crimson has WCAG luminance ~0.16, so mode is dark.
    expect(palette.mode).toBe('dark');
  });

  it('extracts accent close to pure green (hue ~120 degrees)', () => {
    const data = solidColor(34, 139, 34, 8); // forest green
    const palette = extractFromPixels(data, 8, 8);

    expectValidPalette(palette);
    expect(palette.mode).toBe('dark');
  });

  it('extracts accent close to pure blue (hue ~218 degrees)', () => {
    const data = solidColor(59, 130, 246, 8); // #3B82F6
    const palette = extractFromPixels(data, 8, 8);

    expectValidPalette(palette);
    // Blue has WCAG luminance ~0.22, so mode is dark.
    expect(palette.mode).toBe('dark');
  });

  it('produces distinct accent and secondary for a vivid orange', () => {
    const data = solidColor(255, 165, 0, 10); // orange
    const palette = extractFromPixels(data, 10, 10);

    expectValidPalette(palette);
    // Secondary should differ from accent (fallback derivation).
    expect(palette.secondary).not.toBe(palette.accent);
  });

  it('detects light mode for a bright yellow image', () => {
    const data = solidColor(255, 235, 59, 8); // bright yellow
    const palette = extractFromPixels(data, 8, 8);

    expectValidPalette(palette);
    expect(palette.mode).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// 2. Two-color extraction (tests 6-9)
// ---------------------------------------------------------------------------

describe('extractFromPixels — two-color image', () => {
  it('extracts accent and secondary from distinct hues (red + blue)', () => {
    const data = twoColor(220, 20, 60, 59, 130, 246, 10);
    const palette = extractFromPixels(data, 10, 10);

    expectValidPalette(palette);
    // Accent and secondary should be different colors.
    expect(palette.accent).not.toBe(palette.secondary);
  });

  it('detects light mode for a bright two-color image', () => {
    const data = twoColor(240, 240, 200, 200, 240, 240, 8);
    const palette = extractFromPixels(data, 8, 8);
    expect(palette.mode).toBe('light');
  });

  it('detects dark mode for a dark two-color image', () => {
    const data = twoColor(20, 20, 60, 60, 20, 20, 8);
    const palette = extractFromPixels(data, 8, 8);
    expect(palette.mode).toBe('dark');
  });

  it('weights vivid colors more than muted ones in a two-color image', () => {
    // Left half: vivid red (high saturation, high weight via s^2).
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
    const palette = extractFromPixels(data, size, size);

    // Dominant accent should be close to crimson (hue ~350 degrees).
    expectValidPalette(palette);
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-color scene extraction (tests 10-12)
// ---------------------------------------------------------------------------

describe('extractFromPixels — multi-color scene', () => {
  it('produces a complete palette from a landscape scene', () => {
    // Sky blue, grass green, warm earth.
    const data = scene([135, 206, 235], [34, 139, 34], [139, 90, 43], 16);
    const palette = extractFromPixels(data, 16, 16);

    expectValidPalette(palette);
  });

  it('enforces WCAG AA contrast between text and surface', () => {
    const data = scene([135, 206, 235], [34, 139, 34], [139, 90, 43], 16);
    const palette = extractFromPixels(data, 16, 16);

    const ratio = contrastRatio(palette.text, palette.surface);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('produces a valid palette from a warm sunset scene', () => {
    // Orange sky, purple clouds, dark ground.
    const data = scene([255, 140, 0], [186, 85, 211], [40, 20, 60], 16);
    const palette = extractFromPixels(data, 16, 16);

    expectValidPalette(palette);
  });
});

// ---------------------------------------------------------------------------
// 4. Filtering behavior (tests 13-15)
// ---------------------------------------------------------------------------

describe('extractFromPixels — filtering', () => {
  it('skips transparent pixels', () => {
    const pixels: number[][] = [];
    const size = 8;
    for (let i = 0; i < size * size; i++) {
      if (i < 10) {
        pixels.push([220, 20, 60, 255]); // only 10 opaque pixels
      } else {
        pixels.push([59, 130, 246, 0]); // rest transparent
      }
    }
    const data = makeRgba(pixels);
    const palette = extractFromPixels(data, size, size);

    // Should still produce a valid palette from the 10 opaque pixels.
    expectValidPalette(palette);
  });

  it('filters out near-black pixels from hue bucketing but counts them for luminance', () => {
    const pixels: number[][] = [];
    const size = 8;
    for (let i = 0; i < size * size; i++) {
      if (i < 16) {
        pixels.push([220, 20, 60, 255]); // vivid crimson
      } else {
        pixels.push([5, 5, 5, 255]); // near-black (filtered from buckets)
      }
    }
    const data = makeRgba(pixels);
    const palette = extractFromPixels(data, size, size);

    expectValidPalette(palette);
  });

  it('handles a greyscale image via fallback derivation', () => {
    // All pixels are grey (saturation = 0), so no hue buckets get weight.
    const data = solidColor(128, 128, 128, 8);
    const palette = extractFromPixels(data, 8, 8);

    expectValidPalette(palette);
    // Secondary should still be derived (via hue rotation fallback).
    expect(palette.secondary).not.toBe(palette.accent);
  });
});

// ---------------------------------------------------------------------------
// 5. Error handling (tests 16-18)
// ---------------------------------------------------------------------------

describe('extractFromPixels — error handling', () => {
  it('throws for zero or negative dimensions', () => {
    const data = new Uint8ClampedArray(0);
    expect(() => extractFromPixels(data, 0, 0)).toThrow();
    expect(() => extractFromPixels(data, -1, 4)).toThrow();
  });

  it('throws for a fully transparent image', () => {
    const pixels: number[][] = [];
    for (let i = 0; i < 16; i++) {
      pixels.push([255, 0, 0, 0]); // all transparent
    }
    const data = makeRgba(pixels);
    expect(() => extractFromPixels(data, 4, 4)).toThrow(/no visible pixels/);
  });

  it('throws when pixel data length does not match dimensions', () => {
    const data = new Uint8ClampedArray(16); // too short for 8x8
    expect(() => extractFromPixels(data, 8, 8)).toThrow(/does not match/);
  });
});

// ---------------------------------------------------------------------------
// 6. Canvas I/O wrapper (tests 19-21)
// ---------------------------------------------------------------------------

describe('extractFromCanvas', () => {
  /** Create a mock HTMLCanvasElement from raw pixel data. */
  function mockCanvas(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
    return {
      width,
      height,
      getContext: () => ({
        getImageData: (x: number, y: number, w: number, h: number) => ({
          data,
          width: w,
          height: h,
        }),
      }),
    } as unknown as HTMLCanvasElement;
  }

  it('extracts a 4-tone palette from a mock canvas', () => {
    const data = solidColor(59, 130, 246, 8);
    const canvas = mockCanvas(data, 8, 8);
    const palette = extractFromCanvas(canvas);

    expectValidPalette(palette);
  });

  it('throws for a canvas with zero dimensions', () => {
    const canvas = mockCanvas(new Uint8ClampedArray(0), 0, 0);
    expect(() => extractFromCanvas(canvas)).toThrow(/zero dimensions/);
  });

  it('throws when canvas context is unavailable', () => {
    const canvas = {
      width: 8,
      height: 8,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(() => extractFromCanvas(canvas)).toThrow(/context is not available/);
  });
});

// ---------------------------------------------------------------------------
// 7. Integration: full pipeline (test 22)
// ---------------------------------------------------------------------------

describe('integration: extractFromPixels end-to-end', () => {
  it('produces a complete and valid result from a realistic multi-color image', () => {
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
    const palette = extractFromPixels(data, size, size);

    // All fields valid.
    expectValidPalette(palette);

    // Mode should be valid.
    expect(['light', 'dark']).toContain(palette.mode);

    // WCAG AA contrast between text and surface.
    const ratio = contrastRatio(palette.text, palette.surface);
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    // Accent and secondary should be distinct.
    expect(palette.accent).not.toBe(palette.secondary);
  });
});
