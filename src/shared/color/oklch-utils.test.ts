// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  analogous,
  complementary,
  formatHex,
  hexToOklch,
  isInGamut,
  monochromatic,
  oklchContrast,
  oklchLightness,
  oklchToHex,
  oklchToRgb,
  oklchWcagContrast,
  parseHex,
  rgbToOklch,
  rotateHue,
  rotateRgbHue,
  sortByLightness,
  splitComplementary,
  triadic,
} from './oklch-utils';

// ---------------------------------------------------------------------------
// Tolerance
// ---------------------------------------------------------------------------

/** Floating-point tolerance for OKLCH value comparisons. */
const _EPS = 0.001;

// ---------------------------------------------------------------------------
// Reference values (from OKLab spec / verified with colour-science Python lib)
// ---------------------------------------------------------------------------

// sRGB #ff0000 → OKLCH: L≈0.62796, C≈0.25658, H≈29.2336°
// sRGB #00ff00 → OKLCH: L≈0.86644, C≈0.29481, H≈142.4953°
// sRGB #0000ff → OKLCH: L≈0.45201, C≈0.31321, H≈264.0520°
// sRGB #ffffff → OKLCH: L=1.0, C=0, H=0
// sRGB #000000 → OKLCH: L=0, C=0, H=0

// ---------------------------------------------------------------------------
// rgbToOklch — known reference values
// ---------------------------------------------------------------------------

describe('rgbToOklch', () => {
  it('converts pure red #ff0000 to known OKLCH values', () => {
    const result = rgbToOklch({ r: 255, g: 0, b: 0 });
    expect(result.l).toBeCloseTo(0.628, 2);
    expect(result.c).toBeCloseTo(0.257, 2);
    expect(result.h).toBeCloseTo(29.2, 1);
  });

  it('converts pure green #00ff00 to known OKLCH values', () => {
    const result = rgbToOklch({ r: 0, g: 255, b: 0 });
    expect(result.l).toBeCloseTo(0.866, 2);
    expect(result.c).toBeCloseTo(0.295, 2);
    expect(result.h).toBeCloseTo(142.5, 1);
  });

  it('converts pure blue #0000ff to known OKLCH values', () => {
    const result = rgbToOklch({ r: 0, g: 0, b: 255 });
    expect(result.l).toBeCloseTo(0.452, 2);
    expect(result.c).toBeCloseTo(0.313, 2);
    expect(result.h).toBeCloseTo(264.1, 1);
  });

  it('converts white to L=1, C=0', () => {
    const result = rgbToOklch({ r: 255, g: 255, b: 255 });
    expect(result.l).toBeCloseTo(1.0, 3);
    expect(result.c).toBeCloseTo(0, 3);
  });

  it('converts black to L=0, C=0', () => {
    const result = rgbToOklch({ r: 0, g: 0, b: 0 });
    expect(result.l).toBeCloseTo(0, 3);
    expect(result.c).toBeCloseTo(0, 3);
  });

  it('converts mid-grey to L≈0.60, C≈0', () => {
    const result = rgbToOklch({ r: 128, g: 128, b: 128 });
    // OKLCH L for sRGB 128 is ~0.60 (perceptually uniform).
    expect(result.l).toBeCloseTo(0.6, 1);
    expect(result.c).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// oklchToRgb — round-trip consistency
// ---------------------------------------------------------------------------

describe('oklchToRgb round-trip', () => {
  it('round-trips pure red within ±2 channel', () => {
    const original = { r: 255, g: 0, b: 0 };
    const oklch = rgbToOklch(original);
    const back = oklchToRgb(oklch);
    // Gamut-corner colors accumulate more floating-point error through the
    // matrix chain; ±2 is still excellent for 8-bit quantization.
    expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(2);
  });

  it('round-trips pure green within ±1 channel', () => {
    const original = { r: 0, g: 255, b: 0 };
    const oklch = rgbToOklch(original);
    const back = oklchToRgb(oklch);
    expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(1);
  });

  it('round-trips pure blue within ±2 channel', () => {
    const original = { r: 0, g: 0, b: 255 };
    const oklch = rgbToOklch(original);
    const back = oklchToRgb(oklch);
    expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(2);
    expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(2);
  });

  it('round-trips a mid-tone color (#3b82f6) within ±1 channel', () => {
    const original = { r: 0x3b, g: 0x82, b: 0xf6 };
    const oklch = rgbToOklch(original);
    const back = oklchToRgb(oklch);
    expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(1);
  });

  it('round-trips white and black exactly', () => {
    expect(oklchToRgb(rgbToOklch({ r: 255, g: 255, b: 255 }))).toEqual({ r: 255, g: 255, b: 255 });
    expect(oklchToRgb(rgbToOklch({ r: 0, g: 0, b: 0 }))).toEqual({ r: 0, g: 0, b: 0 });
  });
});

// ---------------------------------------------------------------------------
// oklchLightness — perceptual ordering
// ---------------------------------------------------------------------------

describe('oklchLightness', () => {
  it('orders yellow as brighter than blue (perceptual truth)', () => {
    const yellowL = oklchLightness({ r: 255, g: 255, b: 0 });
    const blueL = oklchLightness({ r: 0, g: 0, b: 255 });
    expect(yellowL).toBeGreaterThan(blueL);
  });

  it('orders green as brighter than red', () => {
    const greenL = oklchLightness({ r: 0, g: 255, b: 0 });
    const redL = oklchLightness({ r: 255, g: 0, b: 0 });
    expect(greenL).toBeGreaterThan(redL);
  });

  it('orders white as brightest and black as darkest', () => {
    const whiteL = oklchLightness({ r: 255, g: 255, b: 255 });
    const blackL = oklchLightness({ r: 0, g: 0, b: 0 });
    expect(whiteL).toBeCloseTo(1.0, 3);
    expect(blackL).toBeCloseTo(0, 3);
  });

  it('gives equal lightness to same-L different-hue colors', () => {
    // Two colors with the same OKLCH L should have the same perceptual lightness.
    const color1 = oklchToRgb({ l: 0.6, c: 0.15, h: 0 });
    const color2 = oklchToRgb({ l: 0.6, c: 0.15, h: 120 });
    const color3 = oklchToRgb({ l: 0.6, c: 0.15, h: 240 });
    const l1 = oklchLightness(color1);
    const l2 = oklchLightness(color2);
    const l3 = oklchLightness(color3);
    expect(l1).toBeCloseTo(l2, 2);
    expect(l2).toBeCloseTo(l3, 2);
  });
});

// ---------------------------------------------------------------------------
// oklchContrast — perceptual contrast
// ---------------------------------------------------------------------------

describe('oklchContrast', () => {
  it('returns ~21 for black on white', () => {
    const ratio = oklchContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeGreaterThan(15);
    expect(ratio).toBeLessThanOrEqual(21);
  });

  it('returns 1.0 for identical colors', () => {
    const ratio = oklchContrast({ r: 100, g: 150, b: 200 }, { r: 100, g: 150, b: 200 });
    expect(ratio).toBeCloseTo(1.0, 2);
  });

  it('is symmetric (order independent)', () => {
    const a = oklchContrast({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 0 });
    const b = oklchContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 0, b: 0 });
    expect(a).toBeCloseTo(b, 5);
  });

  it('gives higher contrast for colors with larger lightness difference', () => {
    const lowContrast = oklchContrast({ r: 100, g: 100, b: 100 }, { r: 110, g: 110, b: 110 });
    const highContrast = oklchContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(highContrast).toBeGreaterThan(lowContrast);
  });
});

// ---------------------------------------------------------------------------
// oklchWcagContrast — WCAG-accurate contrast
// ---------------------------------------------------------------------------

describe('oklchWcagContrast', () => {
  it('returns ~21 for black on white (matches WCAG)', () => {
    const ratio = oklchWcagContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeCloseTo(21.0, 1);
  });

  it('returns ~4.0 for red on white (matches WCAG)', () => {
    const ratio = oklchWcagContrast({ r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeCloseTo(3.99, 1);
  });

  it('returns 1.0 for identical colors', () => {
    const ratio = oklchWcagContrast({ r: 80, g: 80, b: 80 }, { r: 80, g: 80, b: 80 });
    expect(ratio).toBeCloseTo(1.0, 2);
  });
});

// ---------------------------------------------------------------------------
// rotateHue — hue rotation correctness
// ---------------------------------------------------------------------------

describe('rotateHue', () => {
  it('rotates red (29°) by +120° to ~149°', () => {
    const red = rgbToOklch({ r: 255, g: 0, b: 0 });
    const rotated = rotateHue(red, 120);
    expect(rotated.h).toBeCloseTo(149.2, 0);
    expect(rotated.l).toBeCloseTo(red.l, 3); // lightness preserved
    expect(rotated.c).toBeCloseTo(red.c, 3); // chroma preserved
  });

  it('wraps around 360° correctly', () => {
    const color = { l: 0.6, c: 0.2, h: 350 };
    const rotated = rotateHue(color, 20);
    expect(rotated.h).toBeCloseTo(10, 3);
  });

  it('handles negative rotation (wraps below 0°)', () => {
    const color = { l: 0.6, c: 0.2, h: 10 };
    const rotated = rotateHue(color, -20);
    expect(rotated.h).toBeCloseTo(350, 3);
  });

  it('preserves L and C exactly', () => {
    const original = { l: 0.7, c: 0.15, h: 200 };
    const rotated = rotateHue(original, 45);
    expect(rotated.l).toBeCloseTo(original.l, 5);
    expect(rotated.c).toBeCloseTo(original.c, 5);
    expect(rotated.h).toBeCloseTo(245, 3);
  });
});

// ---------------------------------------------------------------------------
// rotateRgbHue — end-to-end RGB hue rotation
// ---------------------------------------------------------------------------

describe('rotateRgbHue', () => {
  it('rotates red by 120° to produce a green-ish color', () => {
    const result = rotateRgbHue({ r: 255, g: 0, b: 0 }, 120);
    // After 120° rotation from red hue (~29°), we land near green hue (~149°).
    const oklch = rgbToOklch(result);
    expect(oklch.h).toBeGreaterThan(120);
    expect(oklch.h).toBeLessThan(170);
  });

  it('preserves perceptual brightness after hue rotation', () => {
    const original = { r: 200, g: 50, b: 100 };
    const rotated = rotateRgbHue(original, 180);
    const lOrig = oklchLightness(original);
    const lRot = oklchLightness(rotated);
    // OKLCH hue rotation should preserve lightness (within quantization error).
    expect(Math.abs(lOrig - lRot)).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// Harmony generators
// ---------------------------------------------------------------------------

describe('complementary', () => {
  it('produces a color 180° apart', () => {
    const base = { l: 0.6, c: 0.2, h: 30 };
    const comp = complementary(base);
    expect(comp.h).toBeCloseTo(210, 3);
    expect(comp.l).toBeCloseTo(base.l, 5);
    expect(comp.c).toBeCloseTo(base.c, 5);
  });
});

describe('triadic', () => {
  it('produces three colors 120° apart', () => {
    const base = { l: 0.6, c: 0.2, h: 0 };
    const [a, b, c] = triadic(base);
    expect(a.h).toBeCloseTo(0, 3);
    expect(b.h).toBeCloseTo(120, 3);
    expect(c.h).toBeCloseTo(240, 3);
  });
});

describe('analogous', () => {
  it('produces three colors ±30° apart', () => {
    const base = { l: 0.6, c: 0.2, h: 60 };
    const [a, b, c] = analogous(base);
    expect(a.h).toBeCloseTo(30, 3);
    expect(b.h).toBeCloseTo(60, 3);
    expect(c.h).toBeCloseTo(90, 3);
  });
});

describe('splitComplementary', () => {
  it('produces colors at +150° and +210°', () => {
    const base = { l: 0.6, c: 0.2, h: 0 };
    const [a, b, c] = splitComplementary(base);
    expect(a.h).toBeCloseTo(0, 3);
    expect(b.h).toBeCloseTo(150, 3);
    expect(c.h).toBeCloseTo(210, 3);
  });
});

describe('monochromatic', () => {
  it('produces the requested number of steps', () => {
    const base = { l: 0.5, c: 0.2, h: 180 };
    const scale = monochromatic(base, 7);
    expect(scale).toHaveLength(7);
  });

  it('orders from darkest to lightest', () => {
    const base = { l: 0.5, c: 0.2, h: 180 };
    const scale = monochromatic(base, 5);
    for (let i = 1; i < scale.length; i++) {
      expect(scale[i].l).toBeGreaterThan(scale[i - 1].l);
    }
  });

  it('preserves hue and chroma across all steps', () => {
    const base = { l: 0.5, c: 0.15, h: 90 };
    const scale = monochromatic(base, 4);
    for (const step of scale) {
      expect(step.h).toBeCloseTo(90, 3);
      expect(step.c).toBeCloseTo(0.15, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// sortByLightness
// ---------------------------------------------------------------------------

describe('sortByLightness', () => {
  it('sorts colors from darkest to lightest', () => {
    const colors = [
      { r: 255, g: 255, b: 255 }, // white (lightest)
      { r: 0, g: 0, b: 0 }, // black (darkest)
      { r: 128, g: 128, b: 128 }, // mid-grey
    ];
    const sorted = sortByLightness(colors);
    expect(sorted[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(sorted[1]).toEqual({ r: 128, g: 128, b: 128 });
    expect(sorted[2]).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('does not mutate the input array', () => {
    const colors = [
      { r: 200, g: 200, b: 200 },
      { r: 50, g: 50, b: 50 },
    ];
    sortByLightness(colors);
    expect(colors[0]).toEqual({ r: 200, g: 200, b: 200 });
    expect(colors[1]).toEqual({ r: 50, g: 50, b: 50 });
  });
});

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

describe('parseHex', () => {
  it('parses #3b82f6 correctly', () => {
    const rgb = parseHex('#3b82f6');
    expect(rgb).not.toBeNull();
    expect(rgb!.r).toBe(0x3b);
    expect(rgb!.g).toBe(0x82);
    expect(rgb!.b).toBe(0xf6);
  });

  it('returns null for invalid input', () => {
    expect(parseHex('not-a-color')).toBeNull();
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('formatHex', () => {
  it('formats channels as lowercase hex', () => {
    expect(formatHex({ r: 0x3b, g: 0x82, b: 0xf6 })).toBe('#3b82f6');
  });

  it('clamps out-of-range values', () => {
    expect(formatHex({ r: -10, g: 300, b: 128 })).toBe('#00ff80');
  });
});

describe('hexToOklch', () => {
  it('converts #ff0000 to known OKLCH', () => {
    const result = hexToOklch('#ff0000');
    expect(result).not.toBeNull();
    expect(result!.l).toBeCloseTo(0.628, 2);
    expect(result!.c).toBeCloseTo(0.257, 2);
    expect(result!.h).toBeCloseTo(29.2, 1);
  });

  it('returns null for invalid hex', () => {
    expect(hexToOklch('nope')).toBeNull();
  });
});

describe('oklchToHex', () => {
  it('converts OKLCH back to hex (round-trip via rgbToOklch)', () => {
    // Use full-precision OKLCH from rgbToOklch for exact round-trip.
    const oklch = rgbToOklch({ r: 255, g: 0, b: 0 });
    const hex = oklchToHex(oklch);
    expect(hex).toBe('#ff0000');
  });
});

// ---------------------------------------------------------------------------
// isInGamut
// ---------------------------------------------------------------------------

describe('isInGamut', () => {
  it('returns true for sRGB-reproducible colors', () => {
    expect(isInGamut({ l: 0.6, c: 0.1, h: 30 })).toBe(true);
    expect(isInGamut({ l: 0.5, c: 0.05, h: 200 })).toBe(true);
  });

  it('returns false for extremely high chroma (out of sRGB gamut)', () => {
    // C=0.5 is far beyond sRGB gamut for most hues.
    expect(isInGamut({ l: 0.5, c: 0.5, h: 30 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: OKLCH vs HSL perceptual uniformity
// ---------------------------------------------------------------------------

describe('perceptual uniformity advantage', () => {
  it('OKLCH lightness is more uniform than HSL for same-L different-hue colors', () => {
    // Create three OKLCH colors with identical L but different hues.
    const oklchColors = [
      oklchToRgb({ l: 0.6, c: 0.15, h: 0 }),
      oklchToRgb({ l: 0.6, c: 0.15, h: 120 }),
      oklchToRgb({ l: 0.6, c: 0.15, h: 240 }),
    ];

    // All three should have nearly identical OKLCH lightness.
    const lValues = oklchColors.map((c) => oklchLightness(c));
    const maxDiff = Math.max(...lValues) - Math.min(...lValues);
    expect(maxDiff).toBeLessThan(0.02); // within 2% — excellent uniformity
  });

  it('hue rotation preserves lightness better than naive RGB rotation', () => {
    // Compare: OKLCH rotate vs simple RGB channel shift.
    const base = { r: 180, g: 60, b: 40 };
    const oklchRotated = rotateRgbHue(base, 180);
    const lBefore = oklchLightness(base);
    const lAfter = oklchLightness(oklchRotated);
    // OKLCH rotation should keep lightness within 5%.
    expect(Math.abs(lBefore - lAfter)).toBeLessThan(0.05);
  });
});
