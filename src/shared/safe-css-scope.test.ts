// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  PART_BY_ID,
  REGISTERED_PARTS,
  type SkinPart,
  scopeCss,
  validateScope,
} from './safe-css-scope';

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

describe('REGISTERED_PARTS', () => {
  it('contains exactly 14 parts', () => {
    expect(REGISTERED_PARTS).toHaveLength(14);
  });

  it('has unique ids', () => {
    const ids = REGISTERED_PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every part has a valid data-agentskin-part selector', () => {
    for (const part of REGISTERED_PARTS) {
      expect(part.selector).toBe(`[data-agentskin-part="${part.id}"]`);
    }
  });

  it('has at least one required global part', () => {
    const requiredGlobals = REGISTERED_PARTS.filter((p) => p.required && p.scope === 'global');
    expect(requiredGlobals.length).toBeGreaterThanOrEqual(1);
  });

  it('PART_BY_ID lookup is consistent with registry', () => {
    for (const part of REGISTERED_PARTS) {
      expect(PART_BY_ID[part.id]).toBe(part);
    }
  });
});

// ---------------------------------------------------------------------------
// validateScope — valid CSS
// ---------------------------------------------------------------------------

describe('validateScope — passes valid CSS', () => {
  it('accepts a single registered part selector', () => {
    const css = '[data-agentskin-part="sidebar"] { color: #FFF; }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('accepts --agentskin-* custom properties', () => {
    const css = '[data-agentskin-part="composer"] { --agentskin-accent: #FF453A; }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('accepts multiple registered parts in one block', () => {
    const css = '[data-agentskin-part="sidebar"], [data-agentskin-part="header"] { opacity: 0.9; }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('accepts compound selectors anchored to a registered part', () => {
    const css = '[data-agentskin-part="message"] .content { color: blue; }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('accepts @media wrapping valid rules', () => {
    const css =
      '@media (prefers-color-scheme: dark) { [data-agentskin-part="shell-main"] { background: #000; } }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('accepts multiple allowed properties in one block', () => {
    const css =
      '[data-agentskin-part="composer"] { color: red; background: blue; border-radius: 8px; padding: 12px; }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateScope — empty / comment-only CSS
// ---------------------------------------------------------------------------

describe('validateScope — empty and comment-only CSS', () => {
  it('treats empty string as valid', () => {
    const result = validateScope('');
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.scopedRules).toHaveLength(0);
  });

  it('treats whitespace-only as valid', () => {
    const result = validateScope('   \n\t  ');
    expect(result.valid).toBe(true);
  });

  it('treats comment-only CSS as valid', () => {
    const result = validateScope('/* just a comment */');
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateScope — global selector rejection
// ---------------------------------------------------------------------------

describe('validateScope — rejects global selectors', () => {
  it('rejects "body" selector', () => {
    const result = validateScope('body { color: red; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Global selector'))).toBe(true);
  });

  it('rejects "html" selector', () => {
    const result = validateScope('html { background: black; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Global selector'))).toBe(true);
  });

  it('rejects ":root" selector', () => {
    const result = validateScope(':root { --custom: red; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Global selector'))).toBe(true);
  });

  it('rejects "*" universal selector', () => {
    const result = validateScope('* { box-sizing: border-box; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Global selector'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateScope — unregistered part rejection
// ---------------------------------------------------------------------------

describe('validateScope — rejects unregistered selectors', () => {
  it('rejects a selector targeting a non-existent part', () => {
    const result = validateScope('[data-agentskin-part="unknown-thing"] { color: red; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('does not target a registered part'))).toBe(
      true,
    );
  });

  it('rejects a raw class selector', () => {
    const result = validateScope('.some-class { color: red; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('does not target a registered part'))).toBe(
      true,
    );
  });

  it('rejects an id selector', () => {
    const result = validateScope('#app { color: red; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('does not target a registered part'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// validateScope — blocked property rejection
// ---------------------------------------------------------------------------

describe('validateScope — rejects blocked properties', () => {
  it('rejects position: fixed', () => {
    const result = validateScope('[data-agentskin-part="sidebar"] { position: fixed; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('position'))).toBe(true);
  });

  it('rejects z-index', () => {
    const result = validateScope('[data-agentskin-part="header"] { z-index: 9999; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('z-index'))).toBe(true);
  });

  it('rejects display: none', () => {
    const result = validateScope('[data-agentskin-part="composer"] { display: none; }');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('display'))).toBe(true);
  });

  it('rejects width / height', () => {
    const css = '[data-agentskin-part="shell-main"] { width: 100px; height: 200px; }';
    const result = validateScope(css);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('width') || v.includes('height'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateScope — unknown property rejection
// ---------------------------------------------------------------------------

describe('validateScope — rejects unknown properties', () => {
  it('rejects a property not in the allowed list', () => {
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
  it('wraps declarations in a part attribute selector', () => {
    const result = scopeCss('color: red;', 'sidebar');
    expect(result).toBe('[data-agentskin-part="sidebar"] {\ncolor: red;\n}');
  });

  it('adds trailing semicolon if missing', () => {
    const result = scopeCss('color: red', 'composer');
    expect(result).toContain('color: red;');
  });

  it('handles multi-declaration input', () => {
    const result = scopeCss('color: red; background: blue;', 'header');
    expect(result).toContain('[data-agentskin-part="header"]');
    expect(result).toContain('color: red;');
    expect(result).toContain('background: blue;');
  });

  it('throws for an unknown part id', () => {
    expect(() => scopeCss('color: red;', 'nonexistent')).toThrow(/Unknown part/);
  });

  it('returns empty string for empty declarations', () => {
    const result = scopeCss('', 'sidebar');
    expect(result).toBe('');
  });

  it('returns empty string for whitespace-only declarations', () => {
    const result = scopeCss('   \n  ', 'sidebar');
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Integration: validateScope + scopeCss
// ---------------------------------------------------------------------------

describe('integration — validateScope output feeds scopeCss', () => {
  it('valid CSS produces non-empty scopedRules', () => {
    const css = '[data-agentskin-part="sidebar"] { color: #FFF; background: #000; }';
    const result = validateScope(css);
    expect(result.valid).toBe(true);
    expect(result.scopedRules.length).toBeGreaterThan(0);
  });

  it('invalid CSS produces empty scopedRules', () => {
    const css = 'body { color: red; }';
    const result = validateScope(css);
    expect(result.valid).toBe(false);
    expect(result.scopedRules).toHaveLength(0);
  });
});
