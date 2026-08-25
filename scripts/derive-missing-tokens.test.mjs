// SPDX-License-Identifier: MPL-2.0

/**
 * # derive-missing-tokens.test.mjs
 *
 * Unit tests for the deriveMissingTokens function. Verifies:
 * 1. Provided tokens are never overridden.
 * 2. Missing tokens are derived from the correct source.
 * 3. Dark vs light theme derivation differs appropriately.
 * 4. The inference field correctly marks provided vs derived.
 * 5. Error handling for missing required fields.
 * 6. The 14-token contract is satisfied after derivation.
 */

import { describe, expect, it } from 'vitest';
import { deriveMissingTokens, MANIFEST_COLOR_KEYS } from './derive-missing-tokens.mjs';
import { parseColor } from './theme-utils.mjs';
import { luminance } from './utils/color-utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert a value is a valid CSS color string (hex or rgba). */
function assertValidColor(value, label) {
  expect(typeof value, `${label} should be a string`).toBe('string');
  expect(value.length, `${label} should not be empty`).toBeGreaterThan(0);
  // Should be parseable by the project's own parseColor.
  expect(() => parseColor(value), `${label} "${value}" should be a valid color`).not.toThrow();
}

/** Assert all 13 manifest color keys are present and valid. */
function assertAllTokensPresent(colors, label) {
  for (const key of MANIFEST_COLOR_KEYS) {
    expect(colors, `${label}: missing key "${key}"`).toHaveProperty(key);
    assertValidColor(colors[key], `${label}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveMissingTokens', () => {
  // --- Error handling ---------------------------------------------------

  it('throws when background is missing', () => {
    expect(() => deriveMissingTokens({ foreground: '#ffffff' })).toThrow(
      'colors.background is required',
    );
  });

  it('throws when foreground is missing', () => {
    expect(() => deriveMissingTokens({ background: '#1a1a1a' })).toThrow(
      'colors.foreground is required',
    );
  });

  it('throws when input is null', () => {
    expect(() => deriveMissingTokens(null)).toThrow('expected a colors object');
  });

  it('throws when input is not an object', () => {
    expect(() => deriveMissingTokens('string')).toThrow('expected a colors object');
  });

  // --- Provided tokens are preserved ------------------------------------

  it('preserves all provided tokens verbatim', () => {
    const input = {
      accent: '#ff0000',
      secondary: '#00ff00',
      background: '#1a1a1a',
      foreground: '#e0e0e0',
      muted: '#888888',
      surface: '#2a2a2a',
      surfaceElevated: '#333333',
      border: '#444444',
      codeBackground: '#0a0a0a',
      codeForeground: '#cccccc',
      inputBackground: '#1f1f1f',
      buttonBackground: '#ff000018',
      buttonForeground: '#ff0000',
      focusRing: '#ff000060',
    };
    const result = deriveMissingTokens(input);
    for (const key of MANIFEST_COLOR_KEYS) {
      expect(result[key], `${key} should be preserved`).toBe(input[key]);
    }
  });

  it('does not override a partially provided set', () => {
    const input = {
      background: '#0a0a10',
      foreground: '#e8eaf2',
      accent: '#7C9CFF',
    };
    const result = deriveMissingTokens(input);
    expect(result.background).toBe('#0a0a10');
    expect(result.foreground).toBe('#e8eaf2');
    expect(result.accent).toBe('#7C9CFF');
    // Others should be derived.
    expect(result.surface).not.toBeUndefined();
    expect(result.border).not.toBeUndefined();
  });

  // --- 14-token contract satisfaction -----------------------------------

  it('produces all 13 manifest color keys from minimal input', () => {
    const result = deriveMissingTokens({
      background: '#1a1a2e',
      foreground: '#e0e0e0',
    });
    assertAllTokensPresent(result, 'minimal-input');
  });

  it('produces all 13 manifest color keys for light themes', () => {
    const result = deriveMissingTokens({
      background: '#f5f5f5',
      foreground: '#1a1a1a',
    });
    assertAllTokensPresent(result, 'light-theme');
  });

  // --- Derivation rules -------------------------------------------------

  it('derives inputBackground from background with +5% brightness (dark)', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
    });
    // inputBackground should be brighter than background.
    expect(luminance(result.inputBackground)).toBeGreaterThan(luminance('#1a1a1a'));
  });

  it('derives inputBackground from background with -5% darkness (light)', () => {
    const result = deriveMissingTokens({
      background: '#f5f5f5',
      foreground: '#1a1a1a',
    });
    // inputBackground should be darker than background.
    expect(luminance(result.inputBackground)).toBeLessThan(luminance('#f5f5f5'));
  });

  it('derives buttonBackground from accent as 10% alpha tint', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      accent: '#ff0000',
    });
    // buttonBackground should be 8-digit hex with ~0.1 alpha (0x1a ≈ 0.102).
    expect(result.buttonBackground).toMatch(/^#ff00001a$/);
  });

  it('derives codeBackground from surface (darker for dark themes)', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      surface: '#2a2a2a',
    });
    // codeBackground should be darker than surface for dark themes.
    expect(luminance(result.codeBackground)).toBeLessThan(luminance('#2a2a2a'));
  });

  it('derives codeBackground from surface (lighter for light themes)', () => {
    const result = deriveMissingTokens({
      background: '#f5f5f5',
      foreground: '#1a1a1a',
      surface: '#e0e0e0',
    });
    // codeBackground should be lighter than surface for light themes.
    expect(luminance(result.codeBackground)).toBeGreaterThan(luminance('#e0e0e0'));
  });

  it('derives border from foreground at 20% alpha', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#e0e0e0',
    });
    // border should be 8-digit hex with 0.2 alpha (0x33 ≈ 0.2).
    expect(result.border).toMatch(/^#e0e0e033$/);
  });

  it('derives focusRing from accent at 40% alpha', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      accent: '#4a90d9',
    });
    // focusRing should be 8-digit hex with 0.4 alpha (0x66 ≈ 0.4).
    expect(result.focusRing).toMatch(/^#4a90d966$/);
  });

  it('derives buttonForeground as same value as accent', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      accent: '#4a90d9',
    });
    expect(result.buttonForeground).toBe('#4a90d9');
  });

  it('derives muted from foreground at 60% alpha', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#e0e0e0',
    });
    // muted should be 8-digit hex with 0.6 alpha (0x99 ≈ 0.6).
    expect(result.muted).toMatch(/^#e0e0e099$/);
  });

  it('derives accent from background when missing', () => {
    const result = deriveMissingTokens({
      background: '#1a1a2e',
      foreground: '#e0e0e0',
    });
    assertValidColor(result.accent, 'derived-accent');
    // Accent should be visibly different from background.
    expect(result.accent).not.toBe('#1a1a2e');
  });

  it('derives secondary from accent when missing', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      accent: '#ff0000',
    });
    assertValidColor(result.secondary, 'derived-secondary');
    // Secondary should differ from accent.
    expect(result.secondary).not.toBe('#ff0000');
  });

  it('derives surface from background when missing (dark)', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
    });
    // Surface should be lighter than background for dark themes.
    expect(luminance(result.surface)).toBeGreaterThan(luminance('#1a1a1a'));
  });

  it('derives surface from background when missing (light)', () => {
    const result = deriveMissingTokens({
      background: '#f5f5f5',
      foreground: '#1a1a1a',
    });
    // Surface should be darker than background for light themes.
    expect(luminance(result.surface)).toBeLessThan(luminance('#f5f5f5'));
  });

  it('derives surfaceElevated from surface when missing (dark)', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      surface: '#2a2a2a',
    });
    // surfaceElevated should be lighter than surface for dark themes.
    expect(luminance(result.surfaceElevated)).toBeGreaterThan(luminance('#2a2a2a'));
  });

  // --- Inference metadata -----------------------------------------------

  it('marks provided tokens as "provided" in inference', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
      accent: '#ff0000',
    });
    expect(result.inference).toBeDefined();
    expect(result.inference.background).toBe('provided');
    expect(result.inference.foreground).toBe('provided');
    expect(result.inference.accent).toBe('provided');
  });

  it('marks derived tokens as "derived" in inference', () => {
    const result = deriveMissingTokens({
      background: '#1a1a1a',
      foreground: '#ffffff',
    });
    expect(result.inference.surface).toBe('derived');
    expect(result.inference.border).toBe('derived');
    expect(result.inference.accent).toBe('derived');
    expect(result.inference.buttonBackground).toBe('derived');
    expect(result.inference.focusRing).toBe('derived');
  });

  // --- Edge cases -------------------------------------------------------

  it('handles near-black background', () => {
    const result = deriveMissingTokens({
      background: '#000000',
      foreground: '#ffffff',
    });
    assertAllTokensPresent(result, 'black-bg');
    // Surface should be visible (not pure black).
    expect(luminance(result.surface)).toBeGreaterThan(0);
  });

  it('handles near-white background', () => {
    const result = deriveMissingTokens({
      background: '#ffffff',
      foreground: '#000000',
    });
    assertAllTokensPresent(result, 'white-bg');
    // Surface should be visible (not pure white).
    expect(luminance(result.surface)).toBeLessThan(1);
  });

  it('handles saturated background (graceful accent derivation)', () => {
    const result = deriveMissingTokens({
      background: '#ff0000',
      foreground: '#ffffff',
    });
    assertAllTokensPresent(result, 'saturated-bg');
    // Accent should be derived (not crash on saturated input).
    expect(result.accent).not.toBeUndefined();
  });

  it('handles grayscale background (neutral accent fallback)', () => {
    const result = deriveMissingTokens({
      background: '#888888',
      foreground: '#ffffff',
    });
    assertAllTokensPresent(result, 'gray-bg');
    // Accent should be a valid color (fallback to blue-purple hue).
    assertValidColor(result.accent, 'gray-bg-accent');
  });
});
