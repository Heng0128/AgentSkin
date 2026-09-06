// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { type DominantColor, generateAdaptiveTheme, TOKEN_NAMES } from './adaptive-theme-generator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isValidHex = (value: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(value);

const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const raw = hex.replace('#', '');
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
};

/** Compute relative luminance (Rec. 709). */
const luminance = (c: { r: number; g: number; b: number }): number =>
  (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const WARM_TOP5: DominantColor[] = [
  { r: 231, g: 76, b: 60 }, // #E74C3C (red)
  { r: 241, g: 196, b: 15 }, // #F1C40F (yellow)
  { r: 230, g: 126, b: 34 }, // #E67E22 (orange)
  { r: 192, g: 57, b: 43 }, // #C0392B (dark red)
  { r: 211, g: 84, b: 0 }, // #D35400 (burnt orange)
];

const COOL_TOP5: DominantColor[] = [
  { r: 52, g: 152, b: 219 }, // #3498DB (blue)
  { r: 46, g: 204, b: 113 }, // #2ECC71 (green)
  { r: 155, g: 89, b: 182 }, // #9B59B6 (purple)
  { r: 22, g: 160, b: 133 }, // #16A085 (teal)
  { r: 241, g: 196, b: 15 }, // #F1C40F (yellow)
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateAdaptiveTheme', () => {
  // --- Structural: all 14 tokens present and valid ---

  it('returns all 14 tokens for warm input in dark mode', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    for (const name of TOKEN_NAMES) {
      expect(tokens[name], `token ${name} should exist`).toBeDefined();
      expect(isValidHex(tokens[name]), `token ${name} should be valid hex`).toBe(true);
    }
  });

  it('returns all 14 tokens for cool input in light mode', () => {
    const tokens = generateAdaptiveTheme({ top5: COOL_TOP5, mode: 'light' });
    for (const name of TOKEN_NAMES) {
      expect(tokens[name], `token ${name} should exist`).toBeDefined();
      expect(isValidHex(tokens[name]), `token ${name} should be valid hex`).toBe(true);
    }
  });

  it('returns all 14 tokens for auto mode', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'auto' });
    for (const name of TOKEN_NAMES) {
      expect(tokens[name], `token ${name} should exist`).toBeDefined();
      expect(isValidHex(tokens[name]), `token ${name} should be valid hex`).toBe(true);
    }
  });

  // --- Warm color input produces coordinated accent ---

  it('uses the top-weighted color as accent for warm input', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const accent = parseHex(tokens['--agentskin-accent']);
    // The accent should be in the warm hue range (red/orange/yellow).
    // Top color is #E74C3C — accent should be warm (R > B).
    expect(accent.r).toBeGreaterThan(accent.b);
  });

  it('produces a warm accent-alt for warm input', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const accentAlt = parseHex(tokens['--agentskin-accent-alt']);
    // Second color is #F1C40F (yellow) — should be warm.
    expect(accentAlt.r).toBeGreaterThan(accentAlt.b);
  });

  // --- Cool color input produces coordinated accent ---

  it('uses the top-weighted color as accent for cool input', () => {
    const tokens = generateAdaptiveTheme({ top5: COOL_TOP5, mode: 'dark' });
    const accent = parseHex(tokens['--agentskin-accent']);
    // Top color is #3498DB (blue) — accent should be cool (B > R).
    expect(accent.b).toBeGreaterThan(accent.r);
  });

  it('produces a cool secondary for cool input', () => {
    const tokens = generateAdaptiveTheme({ top5: COOL_TOP5, mode: 'dark' });
    const secondary = parseHex(tokens['--agentskin-secondary']);
    // Third color is #9B59B6 (purple) — should be cool.
    expect(secondary.b).toBeGreaterThan(secondary.r);
  });

  // --- Light vs Dark mode produces different brightness ---

  it('produces darker background in dark mode than light mode', () => {
    const darkTokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const lightTokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'light' });

    const darkBg = parseHex(darkTokens['--agentskin-background']);
    const lightBg = parseHex(lightTokens['--agentskin-background']);

    expect(luminance(darkBg)).toBeLessThan(luminance(lightBg));
  });

  it('produces lighter text in dark mode than light mode', () => {
    const darkTokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const lightTokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'light' });

    const darkText = parseHex(darkTokens['--agentskin-text']);
    const lightText = parseHex(lightTokens['--agentskin-text']);

    expect(luminance(darkText)).toBeGreaterThan(luminance(lightText));
  });

  it('produces higher text-background contrast in both modes', () => {
    for (const mode of ['dark', 'light'] as const) {
      const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode });
      const bg = parseHex(tokens['--agentskin-background']);
      const text = parseHex(tokens['--agentskin-text']);
      const lumBg = luminance(bg);
      const lumText = luminance(text);
      const [hi, lo] = lumText >= lumBg ? [lumText, lumBg] : [lumBg, lumText];
      const contrast = (hi + 0.05) / (lo + 0.05);
      // WCAG AA requires 4.5:1 for normal text.
      expect(contrast, `contrast in ${mode} mode`).toBeGreaterThan(4.5);
    }
  });

  // --- Surface hierarchy ---

  it('produces monotonically lighter surface layers in dark mode', () => {
    const tokens = generateAdaptiveTheme({ top5: COOL_TOP5, mode: 'dark' });
    const bg = luminance(parseHex(tokens['--agentskin-background']));
    const surface = luminance(parseHex(tokens['--agentskin-surface']));
    const elevated = luminance(parseHex(tokens['--agentskin-surface-elevated']));
    expect(surface).toBeGreaterThan(bg);
    expect(elevated).toBeGreaterThan(surface);
  });

  it('produces correct surface hierarchy in light mode', () => {
    const tokens = generateAdaptiveTheme({ top5: COOL_TOP5, mode: 'light' });
    const bg = luminance(parseHex(tokens['--agentskin-background']));
    const surface = luminance(parseHex(tokens['--agentskin-surface']));
    const elevated = luminance(parseHex(tokens['--agentskin-surface-elevated']));
    // In light mode, surface is slightly darker than bg for depth,
    // elevated is lighter than bg for a "raised" effect.
    expect(surface).toBeLessThan(bg);
    expect(elevated).toBeGreaterThan(bg);
  });

  // --- Muted and border are derived from accent/text ---

  it('produces muted color that is less saturated than text', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const text = parseHex(tokens['--agentskin-text']);
    const muted = parseHex(tokens['--agentskin-muted']);
    // Muted should be closer to background luminance than text is.
    const bg = parseHex(tokens['--agentskin-background']);
    const lumText = luminance(text);
    const lumMuted = luminance(muted);
    const lumBg = luminance(bg);
    const textDist = Math.abs(lumText - lumBg);
    const mutedDist = Math.abs(lumMuted - lumBg);
    expect(mutedDist).toBeLessThan(textDist);
  });

  it('produces border that is close to background (low alpha effect)', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const bg = parseHex(tokens['--agentskin-background']);
    const border = parseHex(tokens['--agentskin-border']);
    // Border at 24% alpha should be much closer to bg than to accent.
    const accent = parseHex(tokens['--agentskin-accent']);
    const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
      Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    expect(dist(border, bg)).toBeLessThan(dist(accent, bg));
  });

  // --- Semantic colors ---

  it('produces semantically appropriate error (warm-red)', () => {
    const tokens = generateAdaptiveTheme({ top5: COOL_TOP5, mode: 'dark' });
    const error = parseHex(tokens['--agentskin-error']);
    // Error hue should be in the red range (R > G, R > B).
    expect(error.r).toBeGreaterThan(error.g);
    expect(error.r).toBeGreaterThan(error.b);
  });

  it('produces semantically appropriate success (green)', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const success = parseHex(tokens['--agentskin-success']);
    // Success hue should be in the green range (G > R, G > B).
    expect(success.g).toBeGreaterThan(success.r);
    expect(success.g).toBeGreaterThan(success.b);
  });

  it('produces semantically appropriate info (blue)', () => {
    const tokens = generateAdaptiveTheme({ top5: WARM_TOP5, mode: 'dark' });
    const info = parseHex(tokens['--agentskin-info']);
    // Info hue should be in the blue range (B > R).
    expect(info.b).toBeGreaterThan(info.r);
  });

  // --- Edge case: fewer than 5 colors ---

  it('generates valid theme with only 1 dominant color', () => {
    const tokens = generateAdaptiveTheme({
      top5: [{ r: 100, g: 150, b: 200 }],
      mode: 'dark',
    });
    for (const name of TOKEN_NAMES) {
      expect(isValidHex(tokens[name]), `token ${name} should be valid hex`).toBe(true);
    }
  });

  it('generates valid theme with only 2 dominant colors', () => {
    const tokens = generateAdaptiveTheme({
      top5: [
        { r: 200, g: 50, b: 50 },
        { r: 50, g: 100, b: 200 },
      ],
      mode: 'light',
    });
    for (const name of TOKEN_NAMES) {
      expect(isValidHex(tokens[name]), `token ${name} should be valid hex`).toBe(true);
    }
  });

  // --- Auto mode ---

  it('auto mode selects dark for dark images', () => {
    const darkImage: DominantColor[] = [
      { r: 20, g: 20, b: 30 },
      { r: 40, g: 35, b: 50 },
      { r: 10, g: 15, b: 25 },
    ];
    const tokens = generateAdaptiveTheme({ top5: darkImage, mode: 'auto' });
    const bg = parseHex(tokens['--agentskin-background']);
    expect(luminance(bg)).toBeLessThan(0.4);
  });

  it('auto mode selects light for bright images', () => {
    const brightImage: DominantColor[] = [
      { r: 220, g: 230, b: 240 },
      { r: 200, g: 210, b: 220 },
      { r: 240, g: 245, b: 250 },
    ];
    const tokens = generateAdaptiveTheme({ top5: brightImage, mode: 'auto' });
    const bg = parseHex(tokens['--agentskin-background']);
    expect(luminance(bg)).toBeGreaterThan(0.5);
  });
});
