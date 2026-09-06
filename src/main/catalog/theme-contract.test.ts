// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  DERIVED_CSS_TOKENS,
  isThemeColorsComplete,
  MANIFEST_COLOR_KEYS,
  THEME_COLOR_KEYS,
  validateThemeColors,
} from './theme-contract';

/**
 * 13 manifest keys (selection is derived from accent at CSS generation time,
 * so it is NOT part of the manifest).
 */
const MANIFEST_COMPLETE: Record<string, string> = {
  background: '#1e1e1e',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  foreground: '#e0e0e0',
  muted: '#888888',
  accent: '#4a90d9',
  secondary: '#7a8a99',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  focusRing: '#4a90d960',
  buttonBackground: '#4a90d918',
  inputBackground: '#2a2a2a',
};

/** 14 keys = 13 manifest + 1 derived (selection). */
const COMPLETE: Record<string, string> = {
  ...MANIFEST_COMPLETE,
  selection: '#4a90d952',
};

describe('theme-contract', () => {
  it('exposes the canonical 13 manifest keys', () => {
    expect(MANIFEST_COLOR_KEYS).toHaveLength(13);
    expect(MANIFEST_COLOR_KEYS).toContain('focusRing');
    expect(MANIFEST_COLOR_KEYS).toContain('accent');
    expect(MANIFEST_COLOR_KEYS).not.toContain('selection');
  });

  it('exposes the derived CSS tokens', () => {
    expect(DERIVED_CSS_TOKENS).toEqual(['selection']);
  });

  it('THEME_COLOR_KEYS = MANIFEST + DERIVED = 14 keys', () => {
    expect(THEME_COLOR_KEYS).toHaveLength(14);
    expect(THEME_COLOR_KEYS).toEqual([...MANIFEST_COLOR_KEYS, ...DERIVED_CSS_TOKENS]);
  });

  it('accepts a complete manifest (13 keys)', () => {
    const r = validateThemeColors(MANIFEST_COMPLETE);
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(isThemeColorsComplete(MANIFEST_COMPLETE)).toBe(true);
  });

  it('treats selection as unknown when passed to validateThemeColors', () => {
    // selection is derived, not a manifest key — it should be classified as unknown
    const r = validateThemeColors(COMPLETE);
    expect(r.unknown).toContain('selection');
    expect(r.missing).toEqual([]);
  });

  it('reports missing manifest tokens', () => {
    const partial = { ...MANIFEST_COMPLETE };
    delete (partial as Record<string, string>).accent;
    delete (partial as Record<string, string>).focusRing;
    const r = validateThemeColors(partial);
    expect(r.missing.sort()).toEqual(['accent', 'focusRing']);
    expect(r.invalid).toEqual([]);
    expect(isThemeColorsComplete(partial)).toBe(false);
  });

  it('reports malformed color values', () => {
    const bad = { ...MANIFEST_COMPLETE, border: 'not-a-color', foreground: 'rgb(1,2' };
    const r = validateThemeColors(bad);
    expect(r.invalid.sort()).toEqual(['border', 'foreground']);
    expect(r.missing).toEqual([]);
  });

  it('accepts 8-digit hex (rgba) values as valid', () => {
    const r = validateThemeColors({
      ...MANIFEST_COMPLETE,
      border: '#4a90d92e',
      focusRing: '#4a90d960',
    });
    expect(r.invalid).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('reports unknown (non-canonical) keys without dropping them', () => {
    const r = validateThemeColors({ ...MANIFEST_COMPLETE, primary: '#ffffff', text: '#000000' });
    expect(r.unknown.sort()).toEqual(['primary', 'text']);
    expect(r.missing).toEqual([]);
  });

  it('treats empty color map as fully missing', () => {
    const r = validateThemeColors({});
    expect(r.missing).toHaveLength(13);
    expect(r.unknown).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  it('is pure and never throws on odd input shapes', () => {
    expect(() => validateThemeColors({ accent: 123 as unknown as string })).not.toThrow();
    const r = validateThemeColors({ accent: 123 as unknown as string });
    expect(r.invalid).toContain('accent');
  });

  it('MANIFEST_COLOR_KEYS is a subset of THEME_COLOR_KEYS', () => {
    for (const key of MANIFEST_COLOR_KEYS) {
      expect(THEME_COLOR_KEYS).toContain(key);
    }
  });
});
