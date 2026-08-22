// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { isThemeColorsComplete, THEME_COLOR_KEYS, validateThemeColors } from './theme-contract';

const COMPLETE: Record<string, string> = {
  accent: '#4a90d9',
  secondary: '#7a8a99',
  background: '#1e1e1e',
  foreground: '#e0e0e0',
  muted: '#888888',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  inputBackground: '#2a2a2a',
  buttonBackground: '#4a90d918',
  buttonForeground: '#4a90d9',
  focusRing: '#4a90d960',
};

describe('theme-contract', () => {
  it('exposes the canonical 14 token keys', () => {
    expect(THEME_COLOR_KEYS).toHaveLength(14);
    expect(THEME_COLOR_KEYS).toContain('focusRing');
    expect(THEME_COLOR_KEYS).toContain('accent');
  });

  it('accepts a complete, valid color map', () => {
    const r = validateThemeColors(COMPLETE);
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(isThemeColorsComplete(COMPLETE)).toBe(true);
  });

  it('reports missing canonical tokens', () => {
    const partial = { ...COMPLETE };
    delete (partial as Record<string, string>).accent;
    delete (partial as Record<string, string>).focusRing;
    const r = validateThemeColors(partial);
    expect(r.missing).toEqual(['accent', 'focusRing']);
    expect(r.invalid).toEqual([]);
    expect(isThemeColorsComplete(partial)).toBe(false);
  });

  it('reports malformed color values', () => {
    const bad = { ...COMPLETE, border: 'not-a-color', foreground: 'rgb(1,2' };
    const r = validateThemeColors(bad);
    expect(r.invalid.sort()).toEqual(['border', 'foreground']);
    expect(r.missing).toEqual([]);
  });

  it('accepts 8-digit hex (rgba) values as valid', () => {
    const r = validateThemeColors({ ...COMPLETE, border: '#4a90d92e', focusRing: '#4a90d960' });
    expect(r.invalid).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('reports unknown (non-canonical) keys without dropping them', () => {
    const r = validateThemeColors({ ...COMPLETE, primary: '#ffffff', text: '#000000' });
    expect(r.unknown.sort()).toEqual(['primary', 'text']);
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  it('treats empty color map as fully missing', () => {
    const r = validateThemeColors({});
    expect(r.missing).toHaveLength(14);
    expect(r.unknown).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  it('is pure and never throws on odd input shapes', () => {
    expect(() => validateThemeColors({ accent: 123 as unknown as string })).not.toThrow();
    const r = validateThemeColors({ accent: 123 as unknown as string });
    expect(r.invalid).toContain('accent');
  });
});
