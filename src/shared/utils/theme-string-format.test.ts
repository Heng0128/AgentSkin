// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from '../types/theme';
import {
  decodeThemeFromString,
  encodeThemeToString,
  THEME_STRING_PREFIX,
  validateThemeString,
} from './theme-string-format';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTheme(overrides: Partial<ThemeManifest> = {}): ThemeManifest {
  return {
    id: 'cyber-neon',
    name: 'Cyber Neon',
    version: '1.0.0',
    author: 'test',
    description: 'A test theme',
    supportedAgents: [],
    preview: null,
    mode: 'dark',
    colors: {
      primary: '#FF00FF',
      accent: '#00FFFF',
      background: '#1E1E2E',
      foreground: '#FFFFFF',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// encode / decode round-trip
// ---------------------------------------------------------------------------

describe('encodeThemeToString', () => {
  it('produces a string with the correct prefix', () => {
    const result = encodeThemeToString(makeTheme());
    expect(result.startsWith(THEME_STRING_PREFIX)).toBe(true);
  });

  it('encodes and decodes a theme with full fields', () => {
    const theme = makeTheme();
    const encoded = encodeThemeToString(theme);
    const decoded = decodeThemeFromString(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe('cyber-neon');
    expect(decoded?.name).toBe('Cyber Neon');
    expect(decoded?.version).toBe('1.0.0');
    expect(decoded?.mode).toBe('dark');
  });

  it('round-trips through base64 with non-ASCII characters', () => {
    const theme = makeTheme({ name: '赛博霓虹', description: '中文描述' });
    const encoded = encodeThemeToString(theme);
    const decoded = decodeThemeFromString(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded?.name).toBe('赛博霓虹');
    expect(decoded?.description).toBe('中文描述');
  });
});

// ---------------------------------------------------------------------------
// decodeThemeFromString — validation
// ---------------------------------------------------------------------------

describe('decodeThemeFromString', () => {
  it('returns null for strings without the prefix', () => {
    expect(decodeThemeFromString('not-a-theme-string')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeThemeFromString('')).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(decodeThemeFromString(`${THEME_STRING_PREFIX}!!!invalid!!!`)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    // Manually craft a valid base64 payload that isn't valid JSON
    const b64 = btoa(unescape(encodeURIComponent('not-json')));
    expect(decodeThemeFromString(`${THEME_STRING_PREFIX}${b64}`)).toBeNull();
  });

  it('returns null for unsupported format version', () => {
    const payload = JSON.stringify({
      v: '99',
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      tokens: { primary: '#fff', accent: '#000', background: '#111' },
    });
    const b64 = btoa(payload);
    expect(decodeThemeFromString(`${THEME_STRING_PREFIX}${b64}`)).toBeNull();
  });

  it('returns null when required tokens are missing', () => {
    const payload = JSON.stringify({
      v: '1',
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      tokens: { primary: '#fff' }, // missing accent & background
    });
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    expect(decodeThemeFromString(`${THEME_STRING_PREFIX}${b64}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateThemeString
// ---------------------------------------------------------------------------

describe('validateThemeString', () => {
  it('accepts a valid encoded theme string', () => {
    const encoded = encodeThemeToString(makeTheme());
    const result = validateThemeString(encoded);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects string without prefix', () => {
    const result = validateThemeString('random-string');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes('prefix'))).toBe(true);
  });

  it('rejects unsupported version', () => {
    const payload = JSON.stringify({
      v: '3',
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      tokens: { primary: '#fff', accent: '#000', background: '#111' },
    });
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    const result = validateThemeString(`${THEME_STRING_PREFIX}${b64}`);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('reports all missing required fields at once', () => {
    const payload = JSON.stringify({
      v: '1',
      tokens: {},
    });
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    const result = validateThemeString(`${THEME_STRING_PREFIX}${b64}`);

    expect(result.valid).toBe(false);
    // Should report: id, name, version, primary, accent, background
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts a minimal valid payload (only required fields)', () => {
    const payload = JSON.stringify({
      v: '1',
      id: 'minimal',
      name: 'Minimal',
      version: '0.1.0',
      tokens: { primary: '#ff0000', accent: '#00ff00', background: '#0000ff' },
    });
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    const result = validateThemeString(`${THEME_STRING_PREFIX}${b64}`);

    expect(result.valid).toBe(true);
  });
});
