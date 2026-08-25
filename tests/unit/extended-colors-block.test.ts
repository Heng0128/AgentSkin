// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  apcaContrast,
  autoOnColor,
  contrastRatio,
  extendedColorsBlock,
  luminance,
  wcagCheck,
} from '../../scripts/extended-colors.mjs';

// ---------------------------------------------------------------------------
// WCAG primitives — luminance, contrastRatio, apcaContrast
// ---------------------------------------------------------------------------

describe('WCAG primitives', () => {
  it('luminance returns 0 for #000000 (black)', () => {
    expect(luminance('#000000')).toBe(0);
  });

  it('luminance returns 1 for #ffffff (white)', () => {
    expect(luminance('#ffffff')).toBe(1);
  });

  it('luminance returns ~0.21-0.22 for #808080 (mid-gray)', () => {
    const result = luminance('#808080');
    expect(result).toBeGreaterThanOrEqual(0.21);
    expect(result).toBeLessThanOrEqual(0.22);
  });

  it('contrastRatio returns 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('contrastRatio returns 1 for identical colors', () => {
    expect(contrastRatio('#ff0000', '#ff0000')).toBe(1);
  });

  it('contrastRatio is order-independent (symmetric)', () => {
    const a = contrastRatio('#1a2b3c', '#fedcba');
    const b = contrastRatio('#fedcba', '#1a2b3c');
    expect(a).toBe(b);
  });

  it('apcaContrast returns 0 for invalid hex input', () => {
    expect(apcaContrast('not-a-color', '#ffffff')).toBe(0);
    expect(apcaContrast('#000000', 'nope')).toBe(0);
  });

  it('apcaContrast returns a positive value for distinct colors', () => {
    const lc = apcaContrast('#000000', '#ffffff');
    expect(lc).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Auto on-color selection
// ---------------------------------------------------------------------------

describe('Auto on-color', () => {
  it('returns #000000 for light background (#ffffff)', () => {
    expect(autoOnColor('#ffffff')).toBe('#000000');
  });

  it('returns #ffffff for dark background (#000000)', () => {
    expect(autoOnColor('#000000')).toBe('#ffffff');
  });

  it('returns #ffffff for mid-gray background (#888888)', () => {
    // luminance('#888888') ≈ 0.26, which is ≤ 0.45 threshold → white
    expect(autoOnColor('#888888')).toBe('#ffffff');
  });

  it('returns #000000 for a near-white background (#f5f5f5)', () => {
    expect(autoOnColor('#f5f5f5')).toBe('#000000');
  });

  it('returns #ffffff for a dark-blue background (#1a2b3c)', () => {
    expect(autoOnColor('#1a2b3c')).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// WCAG compliance — wcagCheck
// ---------------------------------------------------------------------------

describe('WCAG compliance', () => {
  it('passes AA at threshold #767676 on #ffffff', () => {
    const result = wcagCheck('#767676', '#ffffff');
    expect(result.passesAA).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('fails AA at threshold #949494 on #ffffff', () => {
    const result = wcagCheck('#949494', '#ffffff');
    expect(result.passesAA).toBe(false);
    expect(result.ratio).toBeLessThan(4.5);
  });

  it('passes AAA for #000000 on #ffffff', () => {
    const result = wcagCheck('#000000', '#ffffff');
    expect(result.passesAAA).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(7.0);
  });

  it('fails AAA for colors that only pass AA', () => {
    const result = wcagCheck('#767676', '#ffffff');
    expect(result.passesAA).toBe(true);
    expect(result.passesAAA).toBe(false);
  });

  it('returns ratio of 1 for identical colors and fails both AA and AAA', () => {
    const result = wcagCheck('#808080', '#808080');
    expect(result.ratio).toBe(1);
    expect(result.passesAA).toBe(false);
    expect(result.passesAAA).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extended color block generator
// ---------------------------------------------------------------------------

describe('Extended color block', () => {
  it('returns empty string for an empty object', () => {
    expect(extendedColorsBlock({})).toBe('');
  });

  it('returns empty string for null/undefined input', () => {
    expect(extendedColorsBlock(undefined as any)).toBe('');
    expect(extendedColorsBlock(null as any)).toBe('');
  });

  it('generates --agentskin-ext-* and --agentskin-ext-on-* variables', () => {
    const css = extendedColorsBlock({ error: '#ef4444', success: '#22c55e' });

    expect(css).toContain('--agentskin-ext-error: #ef4444;');
    expect(css).toContain('--agentskin-ext-on-error: #ffffff;');
    expect(css).toContain('--agentskin-ext-success: #22c55e;');
    expect(css).toContain('--agentskin-ext-on-success: #ffffff;');
  });

  it('lowercases color names (e.g. Error → error)', () => {
    const css = extendedColorsBlock({ Error: '#ef4444' });

    expect(css).toContain('--agentskin-ext-error: #ef4444;');
    expect(css).not.toContain('Error');
  });

  it('silently skips entries with invalid hex values', () => {
    const css = extendedColorsBlock({ bad: 'not-a-color' });
    expect(css).toBe('');
  });

  it('skips only invalid entries while keeping valid ones', () => {
    const css = extendedColorsBlock({
      good: '#ff0000',
      bad: 'wat',
    });

    expect(css).toContain('--agentskin-ext-good: #ff0000;');
    expect(css).not.toContain('bad');
    expect(css).not.toContain('wat');
  });

  it('scopes variables under the custom host selector when provided', () => {
    const css = extendedColorsBlock({ accent: '#3b82f6' }, '.theme-dark');

    expect(css.startsWith('.theme-dark {')).toBe(true);
    expect(css).toContain('--agentskin-ext-accent: #3b82f6;');
  });

  it('uses :root as the default host selector', () => {
    const css = extendedColorsBlock({ accent: '#3b82f6' });

    expect(css.startsWith(':root {')).toBe(true);
  });

  it('produces one ext and one on-ext variable per valid entry', () => {
    const css = extendedColorsBlock({
      error: '#ef4444',
      warning: '#f59e0b',
      success: '#22c55e',
    });

    const extVars = (css.match(/--agentskin-ext-/g) || []).length;
    const onVars = (css.match(/--agentskin-ext-on-/g) || []).length;

    // 3 entries → 3 color vars + 3 on-color vars = 6 total
    expect(extVars).toBe(6);
    expect(onVars).toBe(3);
  });
});

describe('Coverage gaps', () => {
  it('skips 3-digit hex values (#f00) — only accepts 6-digit', () => {
    const css = extendedColorsBlock({ bad: '#f00', good: '#ff0000' });
    expect(css).not.toContain('--agentskin-ext-bad');
    expect(css).toContain('--agentskin-ext-good: #ff0000');
  });

  it('skips 8-digit hex with alpha channel', () => {
    const css = extendedColorsBlock({ translucent: '#ff000080' });
    expect(css).not.toContain('--agentskin-ext-translucent');
  });

  it('handles mixed valid and invalid entries gracefully', () => {
    const css = extendedColorsBlock({
      error: '#ef4444',
      invalid: 'not-a-color',
      success: '#22c55e',
    });
    expect(css).toContain('--agentskin-ext-error: #ef4444');
    expect(css).toContain('--agentskin-ext-success: #22c55e');
    expect(css).not.toContain('--agentskin-ext-invalid');
  });

  it('generates on-color for dark extended color', () => {
    const css = extendedColorsBlock({ dark: '#1a1a2e' });
    expect(css).toContain('--agentskin-ext-on-dark: #ffffff');
  });

  it('generates on-color for light extended color', () => {
    const css = extendedColorsBlock({ light: '#f0f0f0' });
    expect(css).toContain('--agentskin-ext-on-light: #000000');
  });
});

// ---------------------------------------------------------------------------
// Reserved key validation (design-tokens.md §11.3 — CI-blocking)
// ---------------------------------------------------------------------------

describe('Reserved key validation', () => {
  it('throws when using reserved key "on"', () => {
    expect(() => extendedColorsBlock({ on: '#ff0000' })).toThrow(/reserved/);
  });

  it('throws when using reserved key "ext"', () => {
    expect(() => extendedColorsBlock({ ext: '#ff0000' })).toThrow(/reserved/);
  });

  it('throws when using reserved key "raw"', () => {
    expect(() => extendedColorsBlock({ raw: '#ff0000' })).toThrow(/reserved/);
  });

  it('throws when using reserved key "wcag"', () => {
    expect(() => extendedColorsBlock({ wcag: '#ff0000' })).toThrow(/reserved/);
  });

  it('throws with descriptive message listing all reserved keys', () => {
    expect(() => extendedColorsBlock({ on: '#ff0000' })).toThrow(/on, ext, raw, wcag/);
  });

  it('does NOT throw for non-reserved keys that contain reserved substrings', () => {
    // "one", "onboarding", "rawdata" are NOT reserved — only exact matches
    expect(() => extendedColorsBlock({ one: '#ff0000' })).not.toThrow();
    expect(() => extendedColorsBlock({ onboarding: '#ff0000' })).not.toThrow();
    expect(() => extendedColorsBlock({ rawdata: '#ff0000' })).not.toThrow();
  });
});
