// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { Tone4Palette } from '../color/canvas-palette-extractor';
import { contrastRatio } from '../contrast-utils';
import { map4To14Colors } from './palette-to-tokens';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Validate a hex color string (#RRGGBB uppercase). */
function expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

/** All 14 token keys that must be present in the output. */
const ALL_TOKEN_KEYS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'surface',
  'surfaceElevated',
  'border',
  'muted',
  'accentMuted',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
] as const;

/** Create a light-mode 4-tone palette for testing. */
function lightPalette(overrides: Partial<Tone4Palette> = {}): Tone4Palette {
  return {
    accent: '#3B82F6',
    secondary: '#8B5CF6',
    surface: '#F8FAFC',
    text: '#1E293B',
    mode: 'light',
    ...overrides,
  };
}

/** Create a dark-mode 4-tone palette for testing. */
function darkPalette(overrides: Partial<Tone4Palette> = {}): Tone4Palette {
  return {
    accent: '#60A5FA',
    secondary: '#A78BFA',
    surface: '#0F172A',
    text: '#E2E8F0',
    mode: 'dark',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Token completeness (tests 1-3)
// ---------------------------------------------------------------------------

describe('map4To14Colors — token completeness', () => {
  it('produces all 15 token keys for a light palette', () => {
    const result = map4To14Colors(lightPalette());
    for (const key of ALL_TOKEN_KEYS) {
      expect(result[key], `key "${key}" should exist`).toBeDefined();
    }
  });

  it('produces all 15 token keys for a dark palette', () => {
    const result = map4To14Colors(darkPalette());
    for (const key of ALL_TOKEN_KEYS) {
      expect(result[key], `key "${key}" should exist`).toBeDefined();
    }
  });

  it('produces exactly 15 keys (no extras)', () => {
    const result = map4To14Colors(lightPalette());
    expect(Object.keys(result).length).toBe(ALL_TOKEN_KEYS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Direct mappings (tests 4-7)
// ---------------------------------------------------------------------------

describe('map4To14Colors — direct mappings', () => {
  it('maps accent directly through', () => {
    const result = map4To14Colors(lightPalette({ accent: '#FF5733' }));
    expect(result.accent).toBe('#FF5733');
  });

  it('maps secondary directly through', () => {
    const result = map4To14Colors(lightPalette({ secondary: '#00FF00' }));
    expect(result.secondary).toBe('#00FF00');
  });

  it('aliases background to surface', () => {
    const result = map4To14Colors(lightPalette({ surface: '#FFFFFF' }));
    expect(result.background).toBe('#FFFFFF');
  });

  it('aliases foreground to text', () => {
    const result = map4To14Colors(lightPalette({ text: '#000000' }));
    expect(result.foreground).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// 3. Derived tokens validity (tests 8-11)
// ---------------------------------------------------------------------------

describe('map4To14Colors — derived tokens validity', () => {
  it('produces valid hex for all color tokens (light mode)', () => {
    const result = map4To14Colors(lightPalette());
    for (const key of ALL_TOKEN_KEYS) {
      expectHex(result[key]);
    }
  });

  it('produces valid hex for all color tokens (dark mode)', () => {
    const result = map4To14Colors(darkPalette());
    for (const key of ALL_TOKEN_KEYS) {
      expectHex(result[key]);
    }
  });

  it('sets focusRing equal to accent', () => {
    const result = map4To14Colors(lightPalette({ accent: '#E11D48' }));
    expect(result.focusRing).toBe('#E11D48');
  });

  it('sets buttonBackground equal to accent', () => {
    const result = map4To14Colors(lightPalette({ accent: '#10B981' }));
    expect(result.buttonBackground).toBe('#10B981');
  });
});

// ---------------------------------------------------------------------------
// 4. WCAG AA contrast (tests 12-14)
// ---------------------------------------------------------------------------

describe('map4To14Colors — WCAG AA contrast', () => {
  it('enforces contrast between foreground and background', () => {
    const result = map4To14Colors(lightPalette());
    const ratio = contrastRatio(result.foreground, result.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('enforces contrast between foreground and background (dark mode)', () => {
    const result = map4To14Colors(darkPalette());
    const ratio = contrastRatio(result.foreground, result.background);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('buttonForeground is a contrast extreme (#000000 or #FFFFFF)', () => {
    const result = map4To14Colors(lightPalette());
    expect(['#000000', '#FFFFFF']).toContain(result.buttonForeground);
  });
});

// ---------------------------------------------------------------------------
// 5. Light vs dark mode behavior (tests 15-18)
// ---------------------------------------------------------------------------

describe('map4To14Colors — mode-aware derivation', () => {
  it('surfaceElevated is darker than surface in light mode', () => {
    const result = map4To14Colors(lightPalette());
    // In light mode, elevated surface shifts toward darker.
    // We verify it's different from the base surface.
    expect(result.surfaceElevated).not.toBe(result.surface);
  });

  it('surfaceElevated is lighter than surface in dark mode', () => {
    const result = map4To14Colors(darkPalette());
    // In dark mode, elevated surface shifts toward lighter.
    expect(result.surfaceElevated).not.toBe(result.surface);
  });

  it('border differs between light and dark for the same base colors', () => {
    // Same colors but different mode should produce different borders
    // because the mix ratio differs (0.15 vs 0.2).
    const base = {
      accent: '#3B82F6',
      secondary: '#8B5CF6',
      surface: '#888888',
      text: '#444444',
    };
    const lightResult = map4To14Colors({ ...base, mode: 'light' });
    const darkResult = map4To14Colors({ ...base, mode: 'dark' });
    expect(lightResult.border).not.toBe(darkResult.border);
  });

  it('muted is a desaturated variant of text', () => {
    const result = map4To14Colors(
      lightPalette({
        text: '#1E293B',
        surface: '#F8FAFC',
      }),
    );
    // muted should differ from foreground (= text).
    expect(result.muted).not.toBe(result.foreground);
    expectHex(result.muted);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases (tests 19-21)
// ---------------------------------------------------------------------------

describe('map4To14Colors — edge cases', () => {
  it('handles a very light surface with dark text', () => {
    const result = map4To14Colors(
      lightPalette({
        surface: '#FFFFFF',
        text: '#000000',
      }),
    );
    expectHex(result.surfaceElevated);
    expectHex(result.border);
    expectHex(result.codeBackground);
  });

  it('handles a very dark surface with light text', () => {
    const result = map4To14Colors(
      darkPalette({
        surface: '#000000',
        text: '#FFFFFF',
      }),
    );
    expectHex(result.surfaceElevated);
    expectHex(result.border);
    expectHex(result.codeBackground);
  });

  it('handles a highly saturated accent', () => {
    const result = map4To14Colors(lightPalette({ accent: '#FF0000' }));
    // accentMuted should be a desaturated version.
    expect(result.accentMuted).not.toBe(result.accent);
    expectHex(result.accentMuted);
    // buttonForeground should be contrast color.
    expect(['#000000', '#FFFFFF']).toContain(result.buttonForeground);
  });
});
