// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { buildPaletteCss, hexToRgbTriple } from './palette-builder';

// ---------------------------------------------------------------------------
// hexToRgbTriple
// ---------------------------------------------------------------------------

describe('hexToRgbTriple', () => {
  describe('6-digit hex (#rrggbb)', () => {
    it('converts #ff0000 to "255, 0, 0"', () => {
      expect(hexToRgbTriple('#ff0000')).toBe('255, 0, 0');
    });

    it('converts #00ff00 to "0, 255, 0"', () => {
      expect(hexToRgbTriple('#00ff00')).toBe('0, 255, 0');
    });

    it('converts #0000ff to "0, 0, 255"', () => {
      expect(hexToRgbTriple('#0000ff')).toBe('0, 0, 255');
    });

    it('converts #ffffff (white) to "255, 255, 255"', () => {
      expect(hexToRgbTriple('#ffffff')).toBe('255, 255, 255');
    });

    it('converts #000000 (black) to "0, 0, 0"', () => {
      expect(hexToRgbTriple('#000000')).toBe('0, 0, 0');
    });

    it('converts uppercase #FF0000', () => {
      expect(hexToRgbTriple('#FF0000')).toBe('255, 0, 0');
    });

    it('converts mixed case #Ff00Aa', () => {
      expect(hexToRgbTriple('#Ff00Aa')).toBe('255, 0, 170');
    });

    it('converts a complex color #1a2b3c', () => {
      expect(hexToRgbTriple('#1a2b3c')).toBe('26, 43, 60');
    });
  });

  describe('6-digit hex without hash', () => {
    it('converts ff0000 without hash', () => {
      expect(hexToRgbTriple('ff0000')).toBe('255, 0, 0');
    });

    it('converts uppercase FF0000 without hash', () => {
      expect(hexToRgbTriple('FF0000')).toBe('255, 0, 0');
    });
  });

  describe('3-digit hex (#rgb)', () => {
    it('converts #f00 to "255, 0, 0" (expands each digit)', () => {
      expect(hexToRgbTriple('#f00')).toBe('255, 0, 0');
    });

    it('converts #0f0 to "0, 255, 0"', () => {
      expect(hexToRgbTriple('#0f0')).toBe('0, 255, 0');
    });

    it('converts #00f to "0, 0, 255"', () => {
      expect(hexToRgbTriple('#00f')).toBe('0, 0, 255');
    });

    it('converts #fff (white shorthand) to "255, 255, 255"', () => {
      expect(hexToRgbTriple('#fff')).toBe('255, 255, 255');
    });

    it('converts #000 (black shorthand) to "0, 0, 0"', () => {
      expect(hexToRgbTriple('#000')).toBe('0, 0, 0');
    });

    it('converts #abc to "170, 187, 204"', () => {
      expect(hexToRgbTriple('#abc')).toBe('170, 187, 204');
    });

    it('converts uppercase #F00', () => {
      expect(hexToRgbTriple('#F00')).toBe('255, 0, 0');
    });
  });

  describe('3-digit hex without hash', () => {
    it('converts f00 without hash', () => {
      expect(hexToRgbTriple('f00')).toBe('255, 0, 0');
    });

    it('converts abc without hash', () => {
      expect(hexToRgbTriple('abc')).toBe('170, 187, 204');
    });
  });

  describe('whitespace handling', () => {
    it('trims leading whitespace', () => {
      expect(hexToRgbTriple('  #ff0000')).toBe('255, 0, 0');
    });

    it('trims trailing whitespace', () => {
      expect(hexToRgbTriple('#ff0000  ')).toBe('255, 0, 0');
    });

    it('trims both sides', () => {
      expect(hexToRgbTriple('   #ff0000   ')).toBe('255, 0, 0');
    });

    it('trims tabs and newlines', () => {
      expect(hexToRgbTriple('\t\n#ff0000\r\n')).toBe('255, 0, 0');
    });
  });

  describe('returns null for invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(hexToRgbTriple('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(hexToRgbTriple('   ')).toBeNull();
    });

    it('returns null for plain text', () => {
      expect(hexToRgbTriple('red')).toBeNull();
      expect(hexToRgbTriple('hello')).toBeNull();
    });

    it('returns null for CSS var() reference', () => {
      expect(hexToRgbTriple('var(--some-color)')).toBeNull();
    });

    it('returns null for color-mix() expression', () => {
      expect(hexToRgbTriple('color-mix(in srgb, #ff0000 50%, #0000ff)')).toBeNull();
    });

    it('returns null for rgb() notation', () => {
      expect(hexToRgbTriple('rgb(255, 0, 0)')).toBeNull();
    });

    it('returns null for 4-digit hex (#rgba)', () => {
      expect(hexToRgbTriple('#ffff')).toBeNull();
    });

    it('returns null for 5-digit hex', () => {
      expect(hexToRgbTriple('#fffff')).toBeNull();
    });

    it('returns null for 7-digit hex', () => {
      expect(hexToRgbTriple('#ffffff0')).toBeNull();
    });

    it('returns null for 8-digit hex with alpha (#rrggbbaa)', () => {
      expect(hexToRgbTriple('#ffffff80')).toBeNull();
    });

    it('returns null for hex with invalid characters', () => {
      expect(hexToRgbTriple('#gg0000')).toBeNull();
      expect(hexToRgbTriple('#zzz')).toBeNull();
    });

    it('returns null for hex that is too short', () => {
      expect(hexToRgbTriple('#f')).toBeNull();
      expect(hexToRgbTriple('#ff')).toBeNull();
    });

    it('returns null for hex with non-hex characters mixed in', () => {
      expect(hexToRgbTriple('12g')).toBeNull();
      expect(hexToRgbTriple('xyz')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// buildPaletteCss
// ---------------------------------------------------------------------------

describe('buildPaletteCss', () => {
  describe('null / empty / malformed inputs', () => {
    it('returns null for empty string', () => {
      expect(buildPaletteCss('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(buildPaletteCss('   \n  \t  ')).toBeNull();
    });

    it('returns null for CSS with no --agentskin-* vars', () => {
      expect(buildPaletteCss('.foo { color: red; }')).toBeNull();
    });

    it('returns null for fewer than 6 --agentskin-* tokens (5 tokens)', () => {
      const css = [
        '--agentskin-accent: #ff0000;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
      ].join('\n');
      expect(buildPaletteCss(css)).toBeNull();
    });

    it('returns null for exactly 0 tokens', () => {
      expect(buildPaletteCss(':root { --other-var: 5px; }')).toBeNull();
    });
  });

  describe('basic output structure', () => {
    const minimalTokens = [
      '--agentskin-accent: #ff0000;',
      '--agentskin-secondary: #00ff00;',
      '--agentskin-text: #ffffff;',
      '--agentskin-muted: #888888;',
      '--agentskin-surface: #1a1a1a;',
      '--agentskin-bg: #000000;',
    ].join('\n');

    it('returns non-null for exactly 6 tokens', () => {
      const result = buildPaletteCss(minimalTokens);
      expect(result).not.toBeNull();
    });

    it('wraps declarations in :root { }', () => {
      const result = buildPaletteCss(minimalTokens);
      expect(result).toContain(':root {');
      expect(result).toContain('}');
    });

    it('ends with a trailing newline', () => {
      const result = buildPaletteCss(minimalTokens);
      expect(result).toMatch(/\n$/);
    });

    it('formats each declaration as "  --agentskin-{name}: {value};"', () => {
      const result = buildPaletteCss(minimalTokens) ?? '';
      expect(result).toContain('  --agentskin-accent: #ff0000;');
      expect(result).toContain('  --agentskin-bg: #000000;');
    });

    it('preserves all 6 token values in output', () => {
      const result = buildPaletteCss(minimalTokens) ?? '';
      expect(result).toContain('#ff0000');
      expect(result).toContain('#00ff00');
      expect(result).toContain('#ffffff');
      expect(result).toContain('#888888');
      expect(result).toContain('#1a1a1a');
      expect(result).toContain('#000000');
    });
  });

  describe('-raw triplet derivation', () => {
    const hexThemeCss = [
      '--agentskin-accent: #ff0000;',
      '--agentskin-secondary: #00ff00;',
      '--agentskin-text: #ffffff;',
      '--agentskin-muted: #888888;',
      '--agentskin-surface: #1a1a1a;',
      '--agentskin-bg: #000000;',
    ].join('\n');

    it('derives accent-raw from hex accent color', () => {
      const result = buildPaletteCss(hexThemeCss) ?? '';
      expect(result).toContain('--agentskin-accent-raw: 255, 0, 0;');
    });

    it('derives secondary-raw from hex secondary color', () => {
      const result = buildPaletteCss(hexThemeCss) ?? '';
      expect(result).toContain('--agentskin-secondary-raw: 0, 255, 0;');
    });

    it('derives text-raw, muted-raw, surface-raw, bg-raw', () => {
      const result = buildPaletteCss(hexThemeCss) ?? '';
      expect(result).toContain('--agentskin-text-raw: 255, 255, 255;');
      expect(result).toContain('--agentskin-muted-raw: 136, 136, 136;');
      expect(result).toContain('--agentskin-surface-raw: 26, 26, 26;');
      expect(result).toContain('--agentskin-bg-raw: 0, 0, 0;');
    });

    it('derives surface-elevated-raw when surface-elevated is a hex color', () => {
      const css = [
        '--agentskin-accent: #ff0000;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-surface-elevated: #2a2a2a;',
        '--agentskin-bg: #000000;',
        '--agentskin-border: #333333;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      expect(result).toContain('--agentskin-surface-elevated-raw: 42, 42, 42;');
      expect(result).toContain('--agentskin-border-raw: 51, 51, 51;');
    });

    it('skips -raw derivation for non-hex values (var())', () => {
      const css = [
        '--agentskin-accent: var(--some-color);',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      // accent-raw should NOT be present since accent is a var() reference
      expect(result).not.toContain('--agentskin-accent-raw');
      // but secondary-raw should still be derived
      expect(result).toContain('--agentskin-secondary-raw: 0, 255, 0;');
    });

    it('skips -raw derivation for color-mix() values', () => {
      const css = [
        '--agentskin-accent: color-mix(in srgb, #ff0000 50%, #0000ff);',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      expect(result).not.toContain('--agentskin-accent-raw');
    });

    it('respects existing -raw values (does not overwrite)', () => {
      const css = [
        '--agentskin-accent: #ff0000;',
        '--agentskin-accent-raw: 100, 200, 50;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      // The existing value should be preserved, not overwritten with "255, 0, 0"
      expect(result).toContain('--agentskin-accent-raw: 100, 200, 50;');
      expect(result).not.toContain('--agentskin-accent-raw: 255, 0, 0');
    });

    it('derives all 8 raw bases when all are hex colors', () => {
      const css = [
        '--agentskin-accent: #ff0000;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-surface-elevated: #2a2a2a;',
        '--agentskin-bg: #000000;',
        '--agentskin-border: #333333;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      expect(result).toContain('--agentskin-accent-raw: 255, 0, 0;');
      expect(result).toContain('--agentskin-secondary-raw: 0, 255, 0;');
      expect(result).toContain('--agentskin-text-raw: 255, 255, 255;');
      expect(result).toContain('--agentskin-muted-raw: 136, 136, 136;');
      expect(result).toContain('--agentskin-surface-raw: 26, 26, 26;');
      expect(result).toContain('--agentskin-surface-elevated-raw: 42, 42, 42;');
      expect(result).toContain('--agentskin-bg-raw: 0, 0, 0;');
      expect(result).toContain('--agentskin-border-raw: 51, 51, 51;');
    });
  });

  describe('token extraction behavior', () => {
    it('extracts tokens from realistic theme CSS with selectors', () => {
      const css = `
        :root {
          --agentskin-accent: #5b9dd9;
          --agentskin-secondary: #c678dd;
          --agentskin-text: #d4d4d4;
          --agentskin-muted: #808080;
          --agentskin-surface: #1e1e1e;
          --agentskin-bg: #181818;
        }
        .some-class {
          color: var(--agentskin-text);
        }
      `;
      const result = buildPaletteCss(css);
      expect(result).not.toBeNull();
      expect(result).toContain('--agentskin-accent: #5b9dd9;');
    });

    it('handles tokens with hyphens in names (surface-elevated, code-bg)', () => {
      const css = [
        '--agentskin-accent: #ff0000;',
        '--agentskin-surface-elevated: #2a2a2a;',
        '--agentskin-code-bg: #0d0d0d;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      expect(result).toContain('--agentskin-surface-elevated: #2a2a2a;');
      expect(result).toContain('--agentskin-code-bg: #0d0d0d;');
    });

    it('first occurrence wins for duplicate tokens', () => {
      const css = [
        '--agentskin-accent: #ff0000;',
        '--agentskin-accent: #00ff00;',
        '--agentskin-secondary: #0000ff;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      // The first #ff0000 should be kept, not the second #00ff00
      expect(result).toContain('--agentskin-accent: #ff0000;');
      expect(result).not.toContain('--agentskin-accent: #00ff00;');
    });

    it('trims whitespace in token values', () => {
      const css = [
        '--agentskin-accent:   #ff0000   ;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      expect(result).toContain('--agentskin-accent: #ff0000;');
    });

    it('extracts tokens mixed with non-agentskin CSS properties', () => {
      const css = `
        .theme-dark {
          color: white;
          --agentskin-accent: #ff0000;
          background: black;
          --agentskin-secondary: #00ff00;
          --agentskin-text: #ffffff;
          --agentskin-muted: #888888;
          --agentskin-surface: #1a1a1a;
          --agentskin-bg: #000000;
          font-size: 14px;
        }
      `;
      const result = buildPaletteCss(css);
      expect(result).not.toBeNull();
      expect(result).toContain('--agentskin-accent: #ff0000;');
      expect(result).toContain('--agentskin-bg: #000000;');
    });

    it('does not match non-agentskin CSS variables', () => {
      const css = [
        '--other-accent: #ff0000;',
        '--dbx-accent: #00ff00;',
        '--agentskin-accent: #0000ff;',
        '--agentskin-secondary: #00ff00;',
        '--agentskin-text: #ffffff;',
        '--agentskin-muted: #888888;',
        '--agentskin-surface: #1a1a1a;',
        '--agentskin-bg: #000000;',
      ].join('\n');
      const result = buildPaletteCss(css) ?? '';
      expect(result).toContain('--agentskin-accent: #0000ff;');
      expect(result).not.toContain('--other-accent');
      expect(result).not.toContain('--dbx-accent');
    });
  });

  describe('full integration test', () => {
    it('produces a complete palette.css from a realistic theme', () => {
      const realisticCss = `
:root {
  --agentskin-accent: #5b9dd9;
  --agentskin-secondary: #c678dd;
  --agentskin-text: #d4d4d4;
  --agentskin-muted: #808080;
  --agentskin-surface: #1e1e1e;
  --agentskin-surface-elevated: #252526;
  --agentskin-bg: #181818;
  --agentskin-border: #3c3c3c;
  --agentskin-code-bg: #1e1e1e;
}
`;
      const result = buildPaletteCss(realisticCss);
      expect(result).not.toBeNull();

      // Original tokens preserved
      expect(result).toContain('--agentskin-accent: #5b9dd9;');
      expect(result).toContain('--agentskin-code-bg: #1e1e1e;');

      // Derived raw triplets
      expect(result).toContain('--agentskin-accent-raw: 91, 157, 217;');
      expect(result).toContain('--agentskin-secondary-raw: 198, 120, 221;');
      expect(result).toContain('--agentskin-bg-raw: 24, 24, 24;');
      expect(result).toContain('--agentskin-border-raw: 60, 60, 60;');

      // Format check
      expect(result?.startsWith(':root {\n')).toBe(true);
      expect(result?.endsWith('}\n')).toBe(true);
    });
  });
});
