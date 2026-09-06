// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  computeReadableTextColor,
  contrastRatio,
  evaluateContrastFallback,
  evaluateContrastFallbackFromCss,
  getContrastColor,
  hexToRgb,
  parseCssColor,
  rgbToHex,
  WCAG_AA_LARGE_THRESHOLD,
  WCAG_AA_THRESHOLD,
  WCAG_AAA_THRESHOLD,
  wcagLuminance,
  wcagRelativeLuminance,
} from './contrast-utils';

// ---------------------------------------------------------------------------
// hexToRgb / rgbToHex
// ---------------------------------------------------------------------------

describe('hexToRgb', () => {
  it('parses #3B82F6 correctly', () => {
    const rgb = hexToRgb('#3B82F6');
    expect(rgb).not.toBeNull();
    expect(rgb!.r).toBe(0x3b);
    expect(rgb!.g).toBe(0x82);
    expect(rgb!.b).toBe(0xf6);
  });

  it('parses lowercase hex', () => {
    const rgb = hexToRgb('#ffffff');
    expect(rgb).not.toBeNull();
    expect(rgb!.r).toBe(255);
    expect(rgb!.g).toBe(255);
    expect(rgb!.b).toBe(255);
  });

  it('returns null for invalid input', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(hexToRgb('#12')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('handles whitespace', () => {
    const rgb = hexToRgb('  #ff0000  ');
    expect(rgb).not.toBeNull();
    expect(rgb!.r).toBe(255);
    expect(rgb!.g).toBe(0);
    expect(rgb!.b).toBe(0);
  });
});

describe('rgbToHex', () => {
  it('formats channels correctly', () => {
    expect(rgbToHex(0x3b, 0x82, 0xf6)).toBe('#3b82f6');
  });

  it('clamps out-of-range values', () => {
    expect(rgbToHex(-10, 300, 128)).toBe('#00ff80');
  });

  it('rounds fractional values', () => {
    expect(rgbToHex(127.4, 127.5, 127.6)).toBe('#7f8080');
  });
});

// ---------------------------------------------------------------------------
// wcagRelativeLuminance
// ---------------------------------------------------------------------------

describe('wcagRelativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(wcagRelativeLuminance(0, 0, 0)).toBe(0);
  });

  it('returns 1 for white', () => {
    expect(wcagRelativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it('returns ~0.2126 for pure red', () => {
    // Pure red: R=1 linearizes to ~0.2126
    expect(wcagRelativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 3);
  });

  it('returns ~0.7152 for pure green', () => {
    expect(wcagRelativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 3);
  });

  it('returns ~0.0722 for pure blue', () => {
    expect(wcagRelativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 3);
  });

  it('applies gamma expansion (non-linear)', () => {
    // Mid-grey 128 should NOT be 0.5 — it should be lower due to gamma.
    const lum = wcagRelativeLuminance(128, 128, 128);
    expect(lum).toBeLessThan(0.5);
    expect(lum).toBeGreaterThan(0.15);
  });
});

describe('wcagLuminance', () => {
  it('returns 0.5 fallback for invalid hex', () => {
    expect(wcagLuminance('invalid')).toBe(0.5);
  });

  it('matches wcagRelativeLuminance for valid hex', () => {
    expect(wcagLuminance('#ff0000')).toBeCloseTo(0.2126, 3);
    expect(wcagLuminance('#00ff00')).toBeCloseTo(0.7152, 3);
    expect(wcagLuminance('#0000ff')).toBeCloseTo(0.0722, 3);
  });
});

// ---------------------------------------------------------------------------
// contrastRatio
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

  it('returns a low ratio for similar colors', () => {
    const ratio = contrastRatio('#1a1a1a', '#2a2a2a');
    expect(ratio).toBeLessThan(2.0);
  });

  it('returns 1.0 for invalid input', () => {
    expect(contrastRatio('invalid', '#ffffff')).toBe(1.0);
  });

  it('handles red on white correctly', () => {
    // #FF0000 on #FFFFFF ≈ 3.99:1
    const ratio = contrastRatio('#FF0000', '#FFFFFF');
    expect(ratio).toBeCloseTo(3.99, 1);
  });
});

// ---------------------------------------------------------------------------
// getContrastColor
// ---------------------------------------------------------------------------

describe('getContrastColor', () => {
  it('returns black for light backgrounds', () => {
    expect(getContrastColor('#ffffff')).toBe('#000000');
    expect(getContrastColor('#eeeeee')).toBe('#000000');
  });

  it('returns white for dark backgrounds', () => {
    expect(getContrastColor('#000000')).toBe('#ffffff');
    expect(getContrastColor('#1a1a2e')).toBe('#ffffff');
  });

  it('returns white for invalid input', () => {
    expect(getContrastColor('invalid')).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// computeReadableTextColor
// ---------------------------------------------------------------------------

describe('computeReadableTextColor', () => {
  it('produces a color meeting WCAG AA on a light background', () => {
    const bg = '#f0f0f0';
    const text = computeReadableTextColor(bg, WCAG_AA_THRESHOLD);
    const ratio = contrastRatio(bg, text);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
  });

  it('produces a color meeting WCAG AA on a dark background', () => {
    const bg = '#1a1a2e';
    const text = computeReadableTextColor(bg, WCAG_AA_THRESHOLD);
    const ratio = contrastRatio(bg, text);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
  });

  it('produces a color meeting WCAG AA on a mid-grey background', () => {
    const bg = '#808080';
    const text = computeReadableTextColor(bg, WCAG_AA_THRESHOLD);
    const ratio = contrastRatio(bg, text);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
  });

  it('produces a darker text for light backgrounds', () => {
    const bg = '#ffffff';
    const text = computeReadableTextColor(bg, WCAG_AA_THRESHOLD);
    const rgb = hexToRgb(text);
    expect(rgb).not.toBeNull();
    // Dark text: all channels should be low (< 128).
    expect(rgb!.r).toBeLessThan(128);
    expect(rgb!.g).toBeLessThan(128);
    expect(rgb!.b).toBeLessThan(128);
  });

  it('produces a lighter text for dark backgrounds', () => {
    const bg = '#000000';
    const text = computeReadableTextColor(bg, WCAG_AA_THRESHOLD);
    const rgb = hexToRgb(text);
    expect(rgb).not.toBeNull();
    // Light text: all channels should be >= 64 (the darkest grey that
    // achieves 4.5:1 against pure black is approximately #707070).
    expect(rgb!.r).toBeGreaterThanOrEqual(64);
    expect(rgb!.g).toBeGreaterThanOrEqual(64);
    expect(rgb!.b).toBeGreaterThanOrEqual(64);
  });

  it('meets the AAA threshold when requested', () => {
    const bg = '#f0f0f0';
    const text = computeReadableTextColor(bg, WCAG_AAA_THRESHOLD);
    const ratio = contrastRatio(bg, text);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA_THRESHOLD);
  });

  it('returns white for invalid background', () => {
    expect(computeReadableTextColor('invalid')).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// evaluateContrastFallback
// ---------------------------------------------------------------------------

describe('evaluateContrastFallback', () => {
  it('returns pass=true for high-contrast colors', () => {
    const result = evaluateContrastFallback('#000000', '#ffffff');
    expect(result.pass).toBe(true);
    expect(result.css).toBe('');
    expect(result.ratio).toBeCloseTo(21.0, 1);
  });

  it('returns pass=false and CSS for low-contrast colors', () => {
    const result = evaluateContrastFallback('#808080', '#909090');
    expect(result.pass).toBe(false);
    expect(result.ratio).toBeLessThan(WCAG_AA_THRESHOLD);
    expect(result.css).toContain('--agentskin-readable-text');
    expect(result.css).toContain('--agentskin-readable-shadow');
  });

  it('produces a readable text color that meets AA', () => {
    const result = evaluateContrastFallback('#1a1a2e', '#2a2a3e');
    expect(result.pass).toBe(false);
    // Extract the computed text color from the CSS.
    const match = /--agentskin-readable-text:\s*(#[0-9a-f]+)/i.exec(result.css);
    expect(match).not.toBeNull();
    const textColor = match![1];
    const ratio = contrastRatio('#1a1a2e', textColor);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_THRESHOLD);
  });

  it('uses a light shadow for dark readable text on light background', () => {
    // Light background (#ffffff) → dark text (lum < 0.5) → light shadow.
    const result = evaluateContrastFallback('#ffffff', '#eeeeee');
    expect(result.pass).toBe(false);
    expect(result.css).toContain('rgba(255,255,255,0.45)');
  });

  it('uses a light shadow for grey readable text on dark background', () => {
    // Dark background (#000000) → grey text (~#707070, lum < 0.5) → light shadow.
    // The computed readable text is a mid-grey whose luminance is below 0.5,
    // so the shadow uses the light (white) halo for legibility.
    const result = evaluateContrastFallback('#000000', '#111111');
    expect(result.pass).toBe(false);
    expect(result.css).toContain('rgba(255,255,255,0.45)');
  });

  it('respects a custom threshold (large text AA = 3.0)', () => {
    // Use a pair with ratio between 3.0 and 4.5: #787878 on #ffffff ≈ 4.45
    const resultAA = evaluateContrastFallback('#ffffff', '#787878', WCAG_AA_THRESHOLD);
    expect(resultAA.pass).toBe(false);
    const resultLarge = evaluateContrastFallback('#ffffff', '#787878', WCAG_AA_LARGE_THRESHOLD);
    expect(resultLarge.pass).toBe(true);
  });

  it('handles pure black on pure black (ratio = 1.0)', () => {
    const result = evaluateContrastFallback('#000000', '#000000');
    expect(result.pass).toBe(false);
    expect(result.ratio).toBeCloseTo(1.0, 2);
    expect(result.css).toContain('--agentskin-readable-text');
  });
});

// ---------------------------------------------------------------------------
// parseCssColor
// ---------------------------------------------------------------------------

describe('parseCssColor', () => {
  it('parses rgb() notation', () => {
    expect(parseCssColor('rgb(26, 26, 46)')).toBe('#1a1a2e');
  });

  it('parses rgba() notation', () => {
    expect(parseCssColor('rgba(26, 26, 46, 1)')).toBe('#1a1a2e');
    expect(parseCssColor('rgba(26, 26, 46, 0.5)')).toBe('#1a1a2e');
  });

  it('parses hex notation', () => {
    expect(parseCssColor('#1a1a2e')).toBe('#1a1a2e');
  });

  it('returns null for invalid input', () => {
    expect(parseCssColor('not-a-color')).toBeNull();
    expect(parseCssColor('hsl(0,0%,0%)')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateContrastFallbackFromCss
// ---------------------------------------------------------------------------

describe('evaluateContrastFallbackFromCss', () => {
  it('handles rgb() inputs', () => {
    const result = evaluateContrastFallbackFromCss('rgb(0,0,0)', 'rgb(255,255,255)');
    expect(result.pass).toBe(true);
  });

  it('handles rgba() inputs with low contrast', () => {
    const result = evaluateContrastFallbackFromCss('rgba(128,128,128,1)', 'rgba(140,140,140,1)');
    expect(result.pass).toBe(false);
    expect(result.css).toContain('--agentskin-readable-text');
  });

  it('returns pass=true for invalid CSS colors', () => {
    const result = evaluateContrastFallbackFromCss('invalid', 'also-invalid');
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: WCAG compliance boundaries
// ---------------------------------------------------------------------------

describe('WCAG compliance boundaries', () => {
  it('correctly identifies AA-passing combinations', () => {
    // Black on white always passes.
    expect(evaluateContrastFallback('#000000', '#ffffff').pass).toBe(true);
    // White on black always passes.
    expect(evaluateContrastFallback('#ffffff', '#000000').pass).toBe(true);
  });

  it('correctly identifies AA-failing combinations', () => {
    // Mid-grey on slightly different mid-grey should fail.
    expect(evaluateContrastFallback('#808080', '#888888').pass).toBe(false);
  });

  it('emits valid CSS custom property names', () => {
    const result = evaluateContrastFallback('#202020', '#282828');
    expect(result.pass).toBe(false);
    expect(result.css).toContain('--agentskin-readable-text:');
    expect(result.css).toContain('--agentskin-readable-shadow:');
  });

  it('the computed readable color is always valid hex', () => {
    const testBgs = ['#000000', '#ffffff', '#1a1a2e', '#f0f0f0', '#808080', '#3b82f6'];
    for (const bg of testBgs) {
      const result = evaluateContrastFallback(bg, bg);
      if (!result.pass) {
        const match = /--agentskin-readable-text:\s*(#[0-9a-f]+)/i.exec(result.css);
        expect(match, `bg=${bg} should produce valid hex`).not.toBeNull();
        expect(match![1]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
