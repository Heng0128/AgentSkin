// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for palette/generator.ts
 *
 * Both functions are pure (no I/O, no side effects), making them
 * trivial to unit-test in isolation.
 */

import { describe, expect, it } from 'vitest';
import { buildPaletteCss, hexToRgbTriple } from './generator';

describe('hexToRgbTriple', () => {
  describe('6-digit hex', () => {
    it('converts #rrggbb to "r, g, b" triplet', () => {
      expect(hexToRgbTriple('#ff0000')).toBe('255, 0, 0');
      expect(hexToRgbTriple('#00ff00')).toBe('0, 255, 0');
      expect(hexToRgbTriple('#0000ff')).toBe('0, 0, 255');
    });

    it('handles lowercase hex', () => {
      expect(hexToRgbTriple('#abcdef')).toBe('171, 205, 239');
    });

    it('handles uppercase hex', () => {
      expect(hexToRgbTriple('#ABCDEF')).toBe('171, 205, 239');
    });

    it('handles mixed case hex', () => {
      expect(hexToRgbTriple('#aBcDeF')).toBe('171, 205, 239');
    });

    it('handles hash-less input', () => {
      expect(hexToRgbTriple('ff0000')).toBe('255, 0, 0');
    });

    it('trims whitespace', () => {
      expect(hexToRgbTriple('  #ff0000  ')).toBe('255, 0, 0');
    });
  });

  describe('3-digit shorthand hex', () => {
    it('converts #rgb to expanded "r, g, b" triplet', () => {
      expect(hexToRgbTriple('#f00')).toBe('255, 0, 0');
      expect(hexToRgbTriple('#0f0')).toBe('0, 255, 0');
      expect(hexToRgbTriple('#00f')).toBe('0, 0, 255');
    });

    it('expands shorthand by duplicating each digit', () => {
      expect(hexToRgbTriple('#abc')).toBe('170, 187, 204');
    });
  });

  describe('invalid input', () => {
    it('returns null for non-hex values', () => {
      expect(hexToRgbTriple('not-a-color')).toBeNull();
      expect(hexToRgbTriple('var(--something)')).toBeNull();
      expect(hexToRgbTriple('color-mix(in srgb, red, blue)')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(hexToRgbTriple('')).toBeNull();
    });

    it('returns null for 2-digit hex (invalid length)', () => {
      expect(hexToRgbTriple('#ff')).toBeNull();
    });

    it('returns null for 4-digit hex (invalid length)', () => {
      expect(hexToRgbTriple('#ffff')).toBeNull();
    });

    it('returns null for 5-digit hex (invalid length)', () => {
      expect(hexToRgbTriple('#fffff')).toBeNull();
    });

    it('returns null for 7-digit hex (invalid length)', () => {
      expect(hexToRgbTriple('#fffffff')).toBeNull();
    });

    it('returns null for hex with invalid characters', () => {
      expect(hexToRgbTriple('#gggggg')).toBeNull();
    });
  });
});

describe('buildPaletteCss', () => {
  describe('happy path', () => {
    it('builds palette CSS from valid agent CSS with 6+ tokens', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).not.toBeNull();
      expect(result).toContain(':root {');
      expect(result).toContain('--agentskin-accent: #ff0000;');
      expect(result).toContain('--agentskin-secondary: #00ff00;');
    });

    it('derives -raw RGB triplets from hex colors', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).not.toBeNull();
      expect(result).toContain('--agentskin-accent-raw: 255, 0, 0;');
      expect(result).toContain('--agentskin-secondary-raw: 0, 255, 0;');
      expect(result).toContain('--agentskin-text-raw: 51, 51, 51;');
    });

    it('does not override existing -raw declarations', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-accent-raw: 100, 100, 100;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).not.toBeNull();
      expect(result).toContain('--agentskin-accent-raw: 100, 100, 100;');
    });

    it('skips -raw derivation for non-hex values (var/color-mix)', () => {
      const agentCss = `
        --agentskin-accent: var(--some-var);
        --agentskin-secondary: color-mix(in srgb, red, blue);
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).not.toBeNull();
      expect(result).not.toContain('--agentskin-accent-raw');
      expect(result).not.toContain('--agentskin-secondary-raw');
    });

    it('preserves first occurrence of duplicate tokens', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-accent: #00ff00;
        --agentskin-secondary: #0000ff;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).not.toBeNull();
      expect(result).toContain('--agentskin-accent: #ff0000;');
    });
  });

  describe('boundary conditions', () => {
    it('returns null for empty string', () => {
      expect(buildPaletteCss('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(buildPaletteCss('   \n\t  ')).toBeNull();
    });

    it('returns null when fewer than 6 tokens', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
      `;
      expect(buildPaletteCss(agentCss)).toBeNull();
    });

    it('returns non-null when exactly 6 tokens', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      expect(buildPaletteCss(agentCss)).not.toBeNull();
    });

    it('handles extra whitespace in declarations', () => {
      const agentCss = `
        --agentskin-accent:    #ff0000   ;
        --agentskin-secondary:   #00ff00;
        --agentskin-text: #333333  ;
        --agentskin-muted:  #666666;
        --agentskin-surface:     #ffffff;
        --agentskin-bg: #f5f5f5   ;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).not.toBeNull();
      expect(result).toContain('--agentskin-accent: #ff0000;');
    });
  });

  describe('output format', () => {
    it('wraps declarations in :root block', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).toMatch(/^:root \{\n/);
      expect(result).toMatch(/\n\}\n$/);
    });

    it('indents declarations with 2 spaces', () => {
      const agentCss = `
        --agentskin-accent: #ff0000;
        --agentskin-secondary: #00ff00;
        --agentskin-text: #333333;
        --agentskin-muted: #666666;
        --agentskin-surface: #ffffff;
        --agentskin-bg: #f5f5f5;
      `;
      const result = buildPaletteCss(agentCss);
      expect(result).toContain('  --agentskin-accent: #ff0000;');
    });
  });
});
