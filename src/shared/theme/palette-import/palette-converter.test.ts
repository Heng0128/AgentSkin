// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { convertPalette, PaletteParseError } from './palette-converter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Validate a hex color string (#RRGGBB uppercase). */
function expectHex(value: string): void {
  expect(value).toMatch(/^#[0-9A-F]{6}$/);
}

/** All 14 token keys that must be present in the output. */
const ALL_TOKEN_KEYS = [
  'primary',
  'secondary',
  'accent',
  'muted',
  'surface',
  'text',
  'border',
  'success',
  'warning',
  'error',
  'info',
  'shadow',
  'scrim',
  'overlay',
] as const;

/** A minimal valid .itermcolors XML plist. */
function makeItermcolors(overrides: Record<string, string> = {}): string {
  const defaults: Record<string, string> = {
    'Foreground Color': '0.9 0.9 0.9',
    'Background Color': '0.1 0.1 0.1',
    'Ansi 0 Color': '0 0 0',
    'Ansi 1 Color': '0.8 0.2 0.2',
    'Ansi 2 Color': '0.2 0.8 0.2',
    'Ansi 3 Color': '0.9 0.9 0.1',
    'Ansi 4 Color': '0.2 0.4 0.9',
    'Ansi 5 Color': '0.8 0.2 0.8',
    'Ansi 6 Color': '0.1 0.7 0.8',
    'Ansi 7 Color': '0.4 0.4 0.4',
    'Ansi 8 Color': '0.9 0.3 0.3',
    'Ansi 9 Color': '0.3 0.9 0.3',
    'Ansi 10 Color': '1 1 0.2',
    'Ansi 11 Color': '0.3 0.5 1',
    'Ansi 12 Color': '0.9 0.3 0.9',
    'Ansi 13 Color': '0.2 0.8 0.9',
  };

  const merged = { ...defaults, ...overrides };

  const dicts = Object.entries(merged)
    .map(
      ([key, value]) => `
    <key>${key}</key>
    <dict>
      <key>Red Component</key>
      <real>${value.split(' ')[0]}</real>
      <key>Green Component</key>
      <real>${value.split(' ')[1]}</real>
      <key>Blue Component</key>
      <real>${value.split(' ')[2]}</real>
    </dict>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>${dicts}
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// 1. Token completeness (tests 1-3)
// ---------------------------------------------------------------------------

describe('convertPalette -- token completeness', () => {
  it('produces all 14 token keys for itermcolors input', () => {
    const result = convertPalette(makeItermcolors(), 'itermcolors');
    for (const key of ALL_TOKEN_KEYS) {
      expect(result.tokens[key], `key "${key}" should exist`).toBeDefined();
    }
  });

  it('produces all 14 token keys for JSON input', () => {
    const json = JSON.stringify({
      name: 'Test Theme',
      colors: {
        foreground: '#E0E0E0',
        background: '#1A1A1A',
        red: '#FF0000',
        green: '#00FF00',
        yellow: '#FFFF00',
        blue: '#0000FF',
        magenta: '#FF00FF',
        cyan: '#00FFFF',
      },
    });
    const result = convertPalette(json, 'json');
    for (const key of ALL_TOKEN_KEYS) {
      expect(result.tokens[key], `key "${key}" should exist`).toBeDefined();
    }
  });

  it('produces all 14 token keys for YAML input', () => {
    const yaml = `name: Test Theme
colors:
  foreground: "#E0E0E0"
  background: "#1A1A1A"
  red: "#FF0000"
  green: "#00FF00"
  yellow: "#FFFF00"
  blue: "#0000FF"
  magenta: "#FF00FF"
  cyan: "#00FFFF"
`;
    const result = convertPalette(yaml, 'yaml');
    for (const key of ALL_TOKEN_KEYS) {
      expect(result.tokens[key], `key "${key}" should exist`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Direct mappings (tests 4-7)
// ---------------------------------------------------------------------------

describe('convertPalette -- direct mappings', () => {
  it('maps foreground to text token (itermcolors)', () => {
    const xml = makeItermcolors({ 'Foreground Color': '0.93 0.93 0.93' });
    const result = convertPalette(xml, 'itermcolors');
    // 0.93 * 255 = 237.15 -> rounds to 237 = 0xED
    expect(result.tokens.text).toBe('#EDEDED');
  });

  it('maps background to surface token (itermcolors)', () => {
    const xml = makeItermcolors({ 'Background Color': '0.06 0.06 0.06' });
    const result = convertPalette(xml, 'itermcolors');
    expect(result.tokens.surface).toBe('#0F0F0F');
  });

  it('maps ANSI blue to primary token (JSON)', () => {
    const json = JSON.stringify({
      colors: { blue: '#3B82F6', brightBlue: '#60A5FA' },
    });
    const result = convertPalette(json, 'json');
    // Should prefer brightBlue.
    expect(result.tokens.primary).toBe('#60A5FA');
  });

  it('maps ANSI red to error token (JSON)', () => {
    const json = JSON.stringify({
      colors: { red: '#EF4444', brightRed: '#F87171' },
    });
    const result = convertPalette(json, 'json');
    expect(result.tokens.error).toBe('#F87171');
  });
});

// ---------------------------------------------------------------------------
// 3. Format-specific parsing (tests 8-10)
// ---------------------------------------------------------------------------

describe('convertPalette -- format-specific parsing', () => {
  it('parses .itermcolors XML plist correctly', () => {
    const xml = makeItermcolors({
      'Ansi 4 Color': '0.24 0.45 0.8', // blue
      'Ansi 11 Color': '0.23 0.56 1.0', // bright blue
    });
    const result = convertPalette(xml, 'itermcolors');
    // 0.23*255=58.65->59=0x3B, 0.56*255=142.8->143=0x8F, 1.0*255=255=0xFF
    expect(result.tokens.primary).toBe('#3B8FFF'); // bright blue preferred
    expect(result.metadata.source).toBe('itermcolors');
  });

  it('parses JSON with nested colors object', () => {
    const json = JSON.stringify({
      name: 'My Theme',
      colors: {
        foreground: '#FFFFFF',
        background: '#000000',
        green: '#22C55E',
      },
    });
    const result = convertPalette(json, 'json');
    expect(result.tokens.text).toBe('#FFFFFF');
    expect(result.tokens.surface).toBe('#000000');
    // User-provided green is used for success (no brightGreen provided).
    expect(result.tokens.success).toBe('#22C55E');
  });

  it('parses YAML with colors node', () => {
    const yaml = `name: Dracula
colors:
  foreground: "#F8F8F2"
  background: "#282A36"
  red: "#FF5555"
  green: "#50FA7B"
  yellow: "#F1FA8C"
  blue: "#6272A4"
  magenta: "#FF79C6"
  cyan: "#8BE9FD"
`;
    const result = convertPalette(yaml, 'yaml');
    expect(result.tokens.text).toBe('#F8F8F2');
    expect(result.tokens.surface).toBe('#282A36');
    // User-provided red is used for error (no brightRed provided).
    expect(result.tokens.error).toBe('#FF5555');
    // User-provided green is used for success (no brightGreen provided).
    expect(result.tokens.success).toBe('#50FA7B');
  });
});

// ---------------------------------------------------------------------------
// 4. Missing fields & defaults (tests 11-12)
// ---------------------------------------------------------------------------

describe('convertPalette -- missing fields and defaults', () => {
  it('uses default colors for missing ANSI values in itermcolors', () => {
    // Minimal itermcolors with only foreground and background.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Foreground Color</key>
    <dict>
      <key>Red Component</key>
      <real>0.8</real>
      <key>Green Component</key>
      <real>0.8</real>
      <key>Blue Component</key>
      <real>0.8</real>
    </dict>
    <key>Background Color</key>
    <dict>
      <key>Red Component</key>
      <real>0.1</real>
      <key>Green Component</key>
      <real>0.1</real>
      <key>Blue Component</key>
      <real>0.1</real>
    </dict>
</dict>
</plist>`;
    const result = convertPalette(xml, 'itermcolors');
    // Missing ANSI colors should fall back to defaults.
    expect(result.tokens.primary).toBe('#3B8EEA'); // default brightBlue
    expect(result.tokens.error).toBe('#F14C4C'); // default brightRed
    expect(result.tokens.success).toBe('#23D18B'); // default brightGreen
  });

  it('uses default colors for missing fields in JSON', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#FFFFFF',
        background: '#000000',
      },
    });
    const result = convertPalette(json, 'json');
    // Missing ANSI colors should fall back to defaults.
    expect(result.tokens.primary).toBe('#3B8EEA'); // default brightBlue
    expect(result.tokens.text).toBe('#FFFFFF');
    expect(result.tokens.surface).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// 5. Invalid format handling (tests 13-14)
// ---------------------------------------------------------------------------

describe('convertPalette -- invalid format handling', () => {
  it('throws PaletteParseError for invalid JSON', () => {
    expect(() => convertPalette('{ invalid json }', 'json')).toThrow(PaletteParseError);
  });

  it('throws PaletteParseError for empty input', () => {
    expect(() => convertPalette('', 'json')).toThrow(PaletteParseError);
    expect(() => convertPalette('', 'yaml')).toThrow(PaletteParseError);
    expect(() => convertPalette('', 'itermcolors')).toThrow(PaletteParseError);
  });
});

// ---------------------------------------------------------------------------
// 6. Color derivation (tests 15-17)
// ---------------------------------------------------------------------------

describe('convertPalette -- color derivation', () => {
  it('derives muted as a desaturated variant of text', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#E2E8F0',
        background: '#0F172A',
      },
    });
    const result = convertPalette(json, 'json');
    // muted should differ from text (desaturated).
    expect(result.tokens.muted).not.toBe(result.tokens.text);
    expectHex(result.tokens.muted);
  });

  it('derives border as a mix of surface and text', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#FFFFFF',
        background: '#000000',
      },
    });
    const result = convertPalette(json, 'json');
    // border should be different from both surface and text.
    expect(result.tokens.border).not.toBe(result.tokens.surface);
    expect(result.tokens.border).not.toBe(result.tokens.text);
    expectHex(result.tokens.border);
  });

  it('derives shadow and overlay from surface', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#FFFFFF',
        background: '#1E1E1E',
      },
    });
    const result = convertPalette(json, 'json');
    // shadow and overlay should differ from surface.
    expect(result.tokens.shadow).not.toBe(result.tokens.surface);
    expect(result.tokens.overlay).not.toBe(result.tokens.surface);
    expectHex(result.tokens.shadow);
    expectHex(result.tokens.overlay);
    expectHex(result.tokens.scrim);
  });
});

// ---------------------------------------------------------------------------
// 7. Mode detection (tests 18-19)
// ---------------------------------------------------------------------------

describe('convertPalette -- mode detection', () => {
  it('detects dark mode for dark background', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#E0E0E0',
        background: '#1A1A1A',
      },
    });
    const result = convertPalette(json, 'json');
    expect(result.mode).toBe('dark');
  });

  it('detects light mode for light background', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#1A1A1A',
        background: '#F5F5F5',
      },
    });
    const result = convertPalette(json, 'json');
    expect(result.mode).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// 8. Metadata tracking (test 20)
// ---------------------------------------------------------------------------

describe('convertPalette -- metadata tracking', () => {
  it('tracks which tokens were mapped vs derived', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#FFFFFF',
        background: '#000000',
        red: '#FF0000',
        green: '#00FF00',
        yellow: '#FFFF00',
        blue: '#0000FF',
        magenta: '#FF00FF',
        cyan: '#00FFFF',
      },
    });
    const result = convertPalette(json, 'json');

    // Directly mapped tokens.
    expect(result.metadata.mapped).toContain('text');
    expect(result.metadata.mapped).toContain('surface');
    expect(result.metadata.mapped).toContain('primary');
    expect(result.metadata.mapped).toContain('error');
    expect(result.metadata.mapped).toContain('success');

    // Derived tokens.
    expect(result.metadata.derived).toContain('muted');
    expect(result.metadata.derived).toContain('border');
    expect(result.metadata.derived).toContain('shadow');
    expect(result.metadata.derived).toContain('scrim');
    expect(result.metadata.derived).toContain('overlay');

    // Source format.
    expect(result.metadata.source).toBe('json');
  });
});

// ---------------------------------------------------------------------------
// 9. Hex normalization (test 21)
// ---------------------------------------------------------------------------

describe('convertPalette -- hex normalization', () => {
  it('normalizes 3-char hex to 6-char uppercase', () => {
    const json = JSON.stringify({
      colors: {
        foreground: '#fff',
        background: '#000',
        red: '#f00',
        green: '#0f0',
        yellow: '#ff0',
        blue: '#00f',
        magenta: '#f0f',
        cyan: '#0ff',
      },
    });
    const result = convertPalette(json, 'json');
    expect(result.tokens.text).toBe('#FFFFFF');
    expect(result.tokens.surface).toBe('#000000');
    // User-provided red (#f00 -> #FF0000) is used for error.
    expect(result.tokens.error).toBe('#FF0000');
    // User-provided green (#0f0 -> #00FF00) is used for success.
    expect(result.tokens.success).toBe('#00FF00');
  });
});

// ---------------------------------------------------------------------------
// 10. All tokens are valid hex (test 22)
// ---------------------------------------------------------------------------

describe('convertPalette -- output validity', () => {
  it('produces valid hex for all tokens across all formats', () => {
    const itermcolors = makeItermcolors();
    const json = JSON.stringify({
      colors: {
        foreground: '#E0E0E0',
        background: '#1A1A1A',
        red: '#FF0000',
        green: '#00FF00',
        yellow: '#FFFF00',
        blue: '#0000FF',
        magenta: '#FF00FF',
        cyan: '#00FFFF',
      },
    });
    const yaml = `colors:
  foreground: "#E0E0E0"
  background: "#1A1A1A"
  red: "#FF0000"
  green: "#00FF00"
  yellow: "#FFFF00"
  blue: "#0000FF"
  magenta: "#FF00FF"
  cyan: "#00FFFF"
`;

    for (const [format, input] of [
      ['itermcolors', itermcolors],
      ['json', json],
      ['yaml', yaml],
    ] as const) {
      const result = convertPalette(input, format);
      for (const key of ALL_TOKEN_KEYS) {
        expectHex(result.tokens[key]);
      }
    }
  });
});
