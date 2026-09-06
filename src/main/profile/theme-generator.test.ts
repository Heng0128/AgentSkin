// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../shared/contrast-utils';
import type { ImageThemePalette } from './image-theme-analyzer';
import { generateThemeTokens, type ThemeTokens, validateThemeContrast } from './theme-generator';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal ImageThemePalette for testing. */
function makePalette(overrides: Partial<ImageThemePalette> = {}): ImageThemePalette {
  return {
    primary: {
      hex: '#3B82F6',
      rgb: { r: 59, g: 130, b: 246 },
      hsl: { h: 217, s: 0.91, l: 0.6 },
      weight: 0.5,
    },
    secondary: {
      hex: '#8B5CF6',
      rgb: { r: 139, g: 92, b: 246 },
      hsl: { h: 258, s: 0.9, l: 0.66 },
      weight: 0.3,
    },
    accent: {
      hex: '#EF4444',
      rgb: { r: 239, g: 68, b: 68 },
      hsl: { h: 0, s: 0.85, l: 0.6 },
      weight: 0.2,
    },
    mode: 'light',
    luminance: 0.6,
    dominantHue: 217,
    ...overrides,
  };
}

/** Validate a hex color string (#RRGGBB uppercase). */
function expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

/** Check all 14 required keys are present. */
function expectCompleteTokens(tokens: ThemeTokens): void {
  const required: Array<keyof ThemeTokens> = [
    'accent',
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
  for (const key of required) {
    expect(tokens[key]).toBeDefined();
    expectHex(tokens[key]);
  }
}

// ---------------------------------------------------------------------------
// 1. generateThemeTokens — structure
// ---------------------------------------------------------------------------

describe('generateThemeTokens — structure', () => {
  it('produces all 14 required tokens', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    expectCompleteTokens(result.tokens);
  });

  it('returns contrast diagnostics', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    expect(result.contrast.textOnBackground).toBeGreaterThan(0);
    expect(result.contrast.textOnButton).toBeGreaterThan(0);
    expect(result.contrast.accentOnSurface).toBeGreaterThan(0);
  });

  it('sets buttonBackground to accent', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    expect(result.tokens.buttonBackground).toBe(result.tokens.accent);
  });

  it('sets buttonForeground to contrast color of accent', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    // Accent is dark enough that buttonForeground should be white.
    const ratio = contrastRatio(result.tokens.buttonForeground, result.tokens.buttonBackground);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// 2. generateThemeTokens — mode awareness
// ---------------------------------------------------------------------------

describe('generateThemeTokens — mode awareness', () => {
  it('generates light background for light mode', () => {
    const palette = makePalette({ mode: 'light', luminance: 0.8 });
    const result = generateThemeTokens(palette);

    // Light mode background should be very light.
    const bgLum = contrastRatio(result.tokens.background, '#FFFFFF');
    expect(bgLum).toBeLessThan(1.5); // close to white
  });

  it('generates dark background for dark mode', () => {
    const palette = makePalette({ mode: 'dark', luminance: 0.2 });
    const result = generateThemeTokens(palette);

    // Dark mode background should be very dark.
    const bgLum = contrastRatio(result.tokens.background, '#000000');
    expect(bgLum).toBeLessThan(1.5); // close to black
  });

  it('generates dark foreground for light mode', () => {
    const palette = makePalette({ mode: 'light' });
    const result = generateThemeTokens(palette);

    // Foreground should be dark in light mode.
    const fgRatio = contrastRatio(result.tokens.foreground, '#000000');
    expect(fgRatio).toBeLessThan(2.0);
  });

  it('generates light foreground for dark mode', () => {
    const palette = makePalette({ mode: 'dark' });
    const result = generateThemeTokens(palette);

    // Foreground should be light in dark mode.
    const fgRatio = contrastRatio(result.tokens.foreground, '#FFFFFF');
    expect(fgRatio).toBeLessThan(2.0);
  });
});

// ---------------------------------------------------------------------------
// 3. generateThemeTokens — WCAG contrast
// ---------------------------------------------------------------------------

describe('generateThemeTokens — WCAG contrast', () => {
  it('ensures foreground/background contrast >= 4.5 for light mode', () => {
    const palette = makePalette({ mode: 'light' });
    const result = generateThemeTokens(palette);

    expect(result.contrast.textOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it('ensures foreground/background contrast >= 4.5 for dark mode', () => {
    const palette = makePalette({ mode: 'dark' });
    const result = generateThemeTokens(palette);

    expect(result.contrast.textOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it('ensures button text contrast >= 4.5', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    expect(result.contrast.textOnButton).toBeGreaterThanOrEqual(4.5);
  });

  it('passes validateThemeContrast for a well-formed palette', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);
    const issues = validateThemeContrast(result.tokens);

    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. generateThemeTokens — color derivation
// ---------------------------------------------------------------------------

describe('generateThemeTokens — color derivation', () => {
  it('derives surfaceElevated lighter than surface in dark mode', () => {
    const palette = makePalette({ mode: 'dark' });
    const result = generateThemeTokens(palette);

    // In dark mode, elevated should be lighter (higher contrast vs black).
    const elevatedLum = contrastRatio(result.tokens.surfaceElevated, '#000000');
    const surfaceLum = contrastRatio(result.tokens.surface, '#000000');
    expect(elevatedLum).toBeGreaterThan(surfaceLum);
  });

  it('derives surfaceElevated darker than surface in light mode', () => {
    const palette = makePalette({ mode: 'light' });
    const result = generateThemeTokens(palette);

    // In light mode, elevated is darker than surface → further from white
    // → higher contrastRatio against white.
    const elevatedVsWhite = contrastRatio(result.tokens.surfaceElevated, '#FFFFFF');
    const surfaceVsWhite = contrastRatio(result.tokens.surface, '#FFFFFF');
    expect(elevatedVsWhite).toBeGreaterThan(surfaceVsWhite);
  });

  it('generates muted as a desaturated foreground', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    // Muted should have lower contrast than foreground against background.
    const fgContrast = contrastRatio(result.tokens.foreground, result.tokens.background);
    const mutedContrast = contrastRatio(result.tokens.muted, result.tokens.background);
    expect(mutedContrast).toBeLessThan(fgContrast);
  });

  it('generates border between background and foreground', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);

    // Border should be between bg and fg in luminance.
    const bgLum = contrastRatio(result.tokens.background, '#000000');
    const fgLum = contrastRatio(result.tokens.foreground, '#000000');
    const borderLum = contrastRatio(result.tokens.border, '#000000');

    const minLum = Math.min(bgLum, fgLum);
    const maxLum = Math.max(bgLum, fgLum);
    expect(borderLum).toBeGreaterThanOrEqual(minLum);
    expect(borderLum).toBeLessThanOrEqual(maxLum);
  });
});

// ---------------------------------------------------------------------------
// 5. generateThemeTokens — edge cases
// ---------------------------------------------------------------------------

describe('generateThemeTokens — edge cases', () => {
  it('handles greyscale palette (saturation = 0)', () => {
    const palette = makePalette({
      primary: {
        hex: '#808080',
        rgb: { r: 128, g: 128, b: 128 },
        hsl: { h: 0, s: 0, l: 0.5 },
        weight: 1,
      },
      secondary: {
        hex: '#A0A0A0',
        rgb: { r: 160, g: 160, b: 160 },
        hsl: { h: 0, s: 0, l: 0.63 },
        weight: 0,
      },
      accent: {
        hex: '#808080',
        rgb: { r: 128, g: 128, b: 128 },
        hsl: { h: 0, s: 0, l: 0.5 },
        weight: 1,
      },
      mode: 'light',
      luminance: 0.5,
      dominantHue: 0,
    });
    const result = generateThemeTokens(palette);

    expectCompleteTokens(result.tokens);
    // Should still meet contrast.
    expect(result.contrast.textOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it('handles very high saturation palette', () => {
    const palette = makePalette({
      primary: {
        hex: '#FF0000',
        rgb: { r: 255, g: 0, b: 0 },
        hsl: { h: 0, s: 1, l: 0.5 },
        weight: 0.6,
      },
      accent: {
        hex: '#FF0000',
        rgb: { r: 255, g: 0, b: 0 },
        hsl: { h: 0, s: 1, l: 0.5 },
        weight: 0.4,
      },
    });
    const result = generateThemeTokens(palette);

    expectCompleteTokens(result.tokens);
    expect(result.contrast.textOnBackground).toBeGreaterThanOrEqual(4.5);
  });

  it('handles very dark accent', () => {
    const palette = makePalette({
      accent: {
        hex: '#1a1a2e',
        rgb: { r: 26, g: 26, b: 46 },
        hsl: { h: 240, s: 0.28, l: 0.14 },
        weight: 0.3,
      },
    });
    const result = generateThemeTokens(palette);

    expectCompleteTokens(result.tokens);
    // Button text should still be readable.
    expect(result.contrast.textOnButton).toBeGreaterThanOrEqual(4.5);
  });
});

// ---------------------------------------------------------------------------
// 6. validateThemeContrast
// ---------------------------------------------------------------------------

describe('validateThemeContrast', () => {
  it('returns no issues for a valid theme', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);
    const issues = validateThemeContrast(result.tokens);

    expect(issues).toHaveLength(0);
  });

  it('detects insufficient foreground contrast', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);
    // Manually break the contrast.
    const broken: ThemeTokens = {
      ...result.tokens,
      foreground: result.tokens.background, // same as background → 1:1
    };
    const issues = validateThemeContrast(broken);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('foreground/background');
  });

  it('detects insufficient button contrast', () => {
    const palette = makePalette();
    const result = generateThemeTokens(palette);
    const broken: ThemeTokens = {
      ...result.tokens,
      buttonForeground: result.tokens.buttonBackground,
    };
    const issues = validateThemeContrast(broken);

    const hasButtonIssue = issues.some((i) => i.includes('button'));
    expect(hasButtonIssue).toBe(true);
  });
});
