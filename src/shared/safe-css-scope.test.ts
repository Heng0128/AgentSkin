// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { PART_BY_ID, REGISTERED_PARTS, scopeCss, validateScope } from './safe-css-scope';

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

describe('REGISTERED_PARTS', () => {
  it('contains exactly 14 parts with unique ids', () => {
    expect(REGISTERED_PARTS).toHaveLength(14);
    expect(new Set(REGISTERED_PARTS.map((p) => p.id)).size).toBe(14);
  });

  it('every part has a valid selector and PART_BY_ID is consistent', () => {
    for (const part of REGISTERED_PARTS) {
      expect(part.selector).toBe(`[data-agentskin-part="${part.id}"]`);
      expect(PART_BY_ID[part.id]).toBe(part);
    }
  });

  it('has required global parts', () => {
    expect(REGISTERED_PARTS.some((p) => p.required && p.scope === 'global')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateScope — valid CSS passes
// ---------------------------------------------------------------------------

describe('validateScope — valid CSS', () => {
  it('accepts registered part selectors, custom properties, and compound selectors', () => {
    expect(validateScope('[data-agentskin-part="sidebar"] { color: #FFF; }').valid).toBe(true);
    expect(
      validateScope('[data-agentskin-part="composer"] { --agentskin-accent: #FF453A; }').valid,
    ).toBe(true);
    expect(
      validateScope(
        '[data-agentskin-part="sidebar"], [data-agentskin-part="header"] { opacity: 0.9; }',
      ).valid,
    ).toBe(true);
    expect(validateScope('[data-agentskin-part="message"] .content { color: blue; }').valid).toBe(
      true,
    );
  });

  it('accepts @media wrapping valid rules', () => {
    const css =
      '@media (prefers-color-scheme: dark) { [data-agentskin-part="shell-main"] { background: #000; } }';
    expect(validateScope(css).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateScope — empty / comment-only
// ---------------------------------------------------------------------------

describe('validateScope — empty and comment-only', () => {
  it('treats empty, whitespace-only, and comment-only CSS as valid', () => {
    expect(validateScope('').valid).toBe(true);
    expect(validateScope('   \n\t  ').valid).toBe(true);
    expect(validateScope('/* comment */').valid).toBe(true);
    expect(validateScope('').scopedRules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateScope — global selector rejection
// ---------------------------------------------------------------------------

describe('validateScope — rejects global selectors', () => {
  it('rejects body, html, :root, and *', () => {
    for (const css of [
      'body { color: red; }',
      'html { background: black; }',
      ':root { --custom: red; }',
      '* { box-sizing: border-box; }',
    ]) {
      const result = validateScope(css);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('Global selector'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateScope — unregistered / unknown selector
// ---------------------------------------------------------------------------

describe('validateScope — rejects unregistered selectors', () => {
  it('rejects non-existent parts, class, and id selectors', () => {
    for (const css of [
      '[data-agentskin-part="unknown"] { color: red; }',
      '.some-class { color: red; }',
      '#app { color: red; }',
    ]) {
      const result = validateScope(css);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('does not target a registered part'))).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// validateScope — blocked / unknown property rejection
// ---------------------------------------------------------------------------

describe('validateScope — rejects blocked and unknown properties', () => {
  it('rejects position, z-index, display, width, height', () => {
    for (const prop of ['position: fixed', 'z-index: 9999', 'display: none', 'width: 100px']) {
      const result = validateScope(`[data-agentskin-part="sidebar"] { ${prop}; }`);
      expect(result.valid).toBe(false);
      expect(result.violations.some((v) => v.includes('not allowed'))).toBe(true);
    }
  });

  it('rejects properties not in the allowed list', () => {
    const result = validateScope('[data-agentskin-part="sidebar"] { float: left; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('not in the allowed property list'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// scopeCss — wrapper
// ---------------------------------------------------------------------------

describe('scopeCss', () => {
  it('wraps declarations in a part selector and normalizes semicolon', () => {
    expect(scopeCss('color: red;', 'sidebar')).toBe(
      '[data-agentskin-part="sidebar"] {\ncolor: red;\n}',
    );
    expect(scopeCss('color: red', 'composer')).toContain('color: red;');
  });

  it('handles multi-declaration, empty, and unknown part', () => {
    const result = scopeCss('color: red; background: blue;', 'header');
    expect(result).toContain('[data-agentskin-part="header"]');
    expect(result).toContain('color: red;');
    expect(scopeCss('', 'sidebar')).toBe('');
    expect(scopeCss('   ', 'sidebar')).toBe('');
    expect(() => scopeCss('color: red;', 'nonexistent')).toThrow(/Unknown part/);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('integration', () => {
  it('valid CSS produces scopedRules; invalid produces empty', () => {
    const valid = validateScope('[data-agentskin-part="sidebar"] { color: #FFF; }');
    expect(valid.valid).toBe(true);
    expect(valid.scopedRules.length).toBeGreaterThan(0);
    const invalid = validateScope('body { color: red; }');
    expect(invalid.valid).toBe(false);
    expect(invalid.scopedRules).toHaveLength(0);
  });
});
