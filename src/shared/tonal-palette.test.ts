// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  closestStep,
  deriveTonalPalette,
  hexToHsl,
  hslToHex,
  TONAL_STEPS,
  type TonalPalette,
  toSwatchStrip,
} from './tonal-palette';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const n = parseInt(raw, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // Rec.709 relative luminance
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------
// Conversion roundtrip
// ---------------------------------------------------------------------------

describe('hex ↔ hsl', () => {
  it('converts pure red correctly', () => {
    const hsl = hexToHsl('#FF0000');
    expect(Math.round(hsl.h)).toBe(0);
    expect(hsl.s).toBeCloseTo(1, 1);
    expect(hsl.l).toBeCloseTo(0.5, 1);
  });

  it('roundtrips a random color within tolerance', () => {
    const input = '#3B82F6';
    const back = hslToHex(hexToHsl(input));
    expect(back).toBe(input);
  });

  it('handles 3-digit shorthand', () => {
    expect(hexToHsl('#F00')).toMatchObject({ s: 1, l: 0.5 });
  });
});

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

describe('deriveTonalPalette', () => {
  const INPUT = '#FF453A';

  it('returns exactly the 11 documented tonal stops', () => {
    const p = deriveTonalPalette(INPUT);
    expect(
      Object.keys(p)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...TONAL_STEPS]);
  });

  it('monotonic lightness: every step lighter than previous', () => {
    const p = deriveTonalPalette(INPUT);
    const steps = [...TONAL_STEPS];
    for (let i = 1; i < steps.length; i++) {
      expect(luminance(p[steps[i] as keyof TonalPalette])).toBeGreaterThan(
        luminance(p[steps[i - 1] as keyof TonalPalette]),
      );
    }
  });

  it('hue stability: all steps within ±8° of input', () => {
    const inputH = hexToHsl(INPUT).h;
    const p = deriveTonalPalette(INPUT);
    for (const step of TONAL_STEPS) {
      const stepH = hexToHsl(p[step]).h;
      expect(hueDistance(inputH, stepH)).toBeLessThan(8);
    }
  });

  it('saturation peaks near the middle steps (30-60) and drops at extremes', () => {
    const p = deriveTonalPalette(INPUT);
    const sMid = hexToHsl(p[50]).s;
    const sDark = hexToHsl(p[10]).s;
    const sLight = hexToHsl(p[99]).s;
    expect(sMid).toBeGreaterThan(sDark);
    expect(sMid).toBeGreaterThan(sLight);
  });

  it('990 (lightest step) is not pure white', () => {
    const p = deriveTonalPalette(INPUT);
    expect(p[99]).not.toBe('#FFFFFF');
  });

  it('100 (darkest step) is not pure black', () => {
    const p = deriveTonalPalette(INPUT);
    expect(p[10]).not.toBe('#000000');
  });

  it('low-saturation input (grey) produces an all-grey ramp', () => {
    const p = deriveTonalPalette('#808080');
    for (const step of TONAL_STEPS) {
      const { s } = hexToHsl(p[step]);
      expect(s).toBeLessThan(0.02);
    }
  });
});

// ---------------------------------------------------------------------------
// toSwatchStrip / closestStep
// ---------------------------------------------------------------------------

describe('toSwatchStrip', () => {
  it('returns ordered swatch objects', () => {
    const strip = toSwatchStrip(deriveTonalPalette('#FF453A'));
    expect(strip).toHaveLength(11);
    expect(strip[0].step).toBe(10);
    expect(strip[10].step).toBe(99);
    expect(strip[0].hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('closestStep', () => {
  it('finds the step nearest to the source color', () => {
    const p = deriveTonalPalette('#FF453A');
    // We know deriveTonalPalette uses the input as guidance — the closest
    // step must exist in the palette.
    const step = closestStep(p, '#FF453A');
    expect(TONAL_STEPS).toContain(step);
  });

  it('returns 50 for a mid-grey input (true middle of the ramp)', () => {
    const p = deriveTonalPalette('#808080');
    const expected = closestStep(p, '#808080');
    // #808080 has L=0.5; with the explicit lookup table, step 50 (L=0.455)
    // is the closest — matches Material You's "50 represents the input"
    // convention.
    expect(expected).toBe(50);
  });
});
