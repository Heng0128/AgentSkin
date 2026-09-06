// SPDX-License-Identifier: MPL-2.0

/**
 * # check-css-scope.test.mjs
 *
 * Unit tests for the CSS scope validation tool.
 *
 * Covers:
 *   - stripComments      — comment removal preserves line numbers
 *   - parseRules         — CSS rule extraction with at-rule unwrapping
 *   - isHostAnchored     — host-class detection
 *   - isVariableOnly     — variable-only rule detection
 *   - validateRule       — the full validation logic
 *   - isAppAttributeAnchored — workbuddy attribute exception
 */

import { describe, expect, it } from 'vitest';
import {
  agentFromFilename,
  getHostAnchors,
  hasNonVariableDeclarations,
  isAppAttributeAnchored,
  isHostAnchored,
  isVariableOnly,
  parseRules,
  stripComments,
  validateRule,
} from './check-css-scope.mjs';

// ---------------------------------------------------------------------------
// stripComments
// ---------------------------------------------------------------------------

describe('stripComments', () => {
  it('removes single-line comments', () => {
    const result = stripComments('color: red; /* comment */');
    expect(result.startsWith('color: red; ')).toBe(true);
    expect(result).not.toContain('comment');
  });

  it('removes multi-line comments', () => {
    const input = '/* line1\nline2 */color: red;';
    const result = stripComments(input);
    expect(result).not.toContain('line1');
    expect(result).not.toContain('line2');
    expect(result.trim()).toBe('color: red;');
  });

  it('preserves line breaks for line-number tracking', () => {
    const input = '/* comment\nsecond line */\n.foo { color: red; }';
    const result = stripComments(input);
    expect(result.split('\n').length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseRules
// ---------------------------------------------------------------------------

describe('parseRules', () => {
  it('parses simple rules', () => {
    const css = '.foo { color: red; } .bar { background: blue; }';
    const rules = parseRules(css);
    expect(rules).toHaveLength(2);
    expect(rules[0].selector).toBe('.foo');
    expect(rules[1].selector).toBe('.bar');
  });

  it('unwraps @media blocks and returns inner rules', () => {
    const css = '@media (max-width: 600px) { .foo { color: red; } }';
    const rules = parseRules(css);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe('.foo');
    expect(rules[0].scoped).toBe(false);
  });

  it('unwraps @scope blocks and marks inner rules as scoped', () => {
    const css = '@scope (html.agentskin-host-codex) { .foo { color: red; } }';
    const rules = parseRules(css);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toBe('.foo');
    expect(rules[0].scoped).toBe(true);
  });

  it('ignores @font-face at-rules', () => {
    const css = '@font-face { font-family: "Icons"; src: url("icons.woff"); }';
    const rules = parseRules(css);
    expect(rules).toHaveLength(0);
  });

  it('parses multi-selector rules', () => {
    const css =
      'html.agentskin-host-traework a, html.agentskin-host-traework button { color: red; }';
    const rules = parseRules(css);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toContain(',');
  });
});

// ---------------------------------------------------------------------------
// isHostAnchored
// ---------------------------------------------------------------------------

describe('isHostAnchored', () => {
  it('returns true for html.agentskin-host-<agent> selectors', () => {
    expect(isHostAnchored('html.agentskin-host-traework', 'traework')).toBe(true);
    expect(isHostAnchored('html.agentskin-host-codex body', 'codex')).toBe(true);
  });

  it('returns true for :root.agentskin-host-<agent> selectors', () => {
    expect(isHostAnchored(':root.agentskin-host-codex', 'codex')).toBe(true);
    expect(isHostAnchored(':root.agentskin-host-codex #root', 'codex')).toBe(true);
  });

  it('returns false for unanchored selectors', () => {
    expect(isHostAnchored('.foo', 'codex')).toBe(false);
    expect(isHostAnchored('body', 'traework')).toBe(false);
  });

  it('differentiates between adapters', () => {
    expect(isHostAnchored('html.agentskin-host-traework', 'traework')).toBe(true);
    expect(isHostAnchored('html.agentskin-host-traework', 'codex')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAppAttributeAnchored
// ---------------------------------------------------------------------------

describe('isAppAttributeAnchored', () => {
  it('returns true for workbuddy body[data-application-name] selectors', () => {
    expect(isAppAttributeAnchored('body[data-application-name="workbuddy"]', 'workbuddy')).toBe(
      true,
    );
    expect(
      isAppAttributeAnchored('body[data-application-name="workbuddy"] ::selection', 'workbuddy'),
    ).toBe(true);
  });

  it('returns false for other adapters', () => {
    expect(isAppAttributeAnchored('body[data-application-name="workbuddy"]', 'codex')).toBe(false);
  });

  it('returns false for unrelated selectors', () => {
    expect(isAppAttributeAnchored('body[data-theme="dark"]', 'workbuddy')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isVariableOnly
// ---------------------------------------------------------------------------

describe('isVariableOnly', () => {
  it('returns true for custom-property-only declarations', () => {
    expect(isVariableOnly('--agentskin-accent: #afcad2; --agentskin-bg: #13171a;')).toBe(true);
  });

  it('returns false when non-custom-property declarations exist', () => {
    expect(isVariableOnly('--agentskin-accent: #afcad2; color: red;')).toBe(false);
  });

  it('returns false for empty declarations', () => {
    expect(isVariableOnly('')).toBe(false);
    expect(isVariableOnly('   ')).toBe(false);
  });

  it('handles whitespace and trailing semicolons', () => {
    expect(isVariableOnly('  --foo: bar;  --baz: qux;  ')).toBe(true);
  });

  it('returns false for non-variable layout properties', () => {
    expect(isVariableOnly('background: transparent;')).toBe(false);
    expect(isVariableOnly('text-shadow: 0 1px 3px rgba(0,0,0,0.5);')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasNonVariableDeclarations
// ---------------------------------------------------------------------------

describe('hasNonVariableDeclarations', () => {
  it('returns true when non-custom-property declarations exist', () => {
    expect(hasNonVariableDeclarations('color: red;')).toBe(true);
    expect(hasNonVariableDeclarations('--foo: bar; color: red;')).toBe(true);
  });

  it('returns false when all declarations are custom properties', () => {
    expect(hasNonVariableDeclarations('--foo: bar; --baz: qux;')).toBe(false);
  });

  it('returns false for empty declarations', () => {
    expect(hasNonVariableDeclarations('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRule — the core validation logic
// ---------------------------------------------------------------------------

describe('validateRule', () => {
  it('PASS: host-anchored selector', () => {
    const rule = {
      selector: 'html.agentskin-host-codex .foo',
      declarations: 'color: red;',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'codex')).toBeNull();
  });

  it('PASS: :root host-anchored selector', () => {
    const rule = {
      selector: ':root.agentskin-host-traework',
      declarations: '--agentskin-accent: #fff;',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'traework')).toBeNull();
  });

  it('FAIL: unanchored selector with styling declarations', () => {
    const rule = {
      selector: '.some-class',
      declarations: 'color: red; background: blue;',
      scoped: false,
      lineNum: 5,
    };
    const result = validateRule(rule, 'codex');
    expect(result).not.toBeNull();
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('html.agentskin-host-codex');
  });

  it('PASS: scoped rule inside @scope block', () => {
    const rule = {
      selector: '.some-class',
      declarations: 'color: red;',
      scoped: true,
      lineNum: 1,
    };
    expect(validateRule(rule, 'codex')).toBeNull();
  });

  it('PASS: variable-only :root selector', () => {
    const rule = {
      selector: ':root',
      declarations: '--agentskin-accent: #afcad2; --agentskin-bg: #13171a;',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'codex')).toBeNull();
  });

  it('PASS: variable-only html selector', () => {
    const rule = {
      selector: 'html',
      declarations: '--foo: bar;',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'codex')).toBeNull();
  });

  it('FAIL: :root selector with non-variable declarations', () => {
    const rule = {
      selector: ':root',
      declarations: 'color-scheme: dark; --agentskin-accent: #fff;',
      scoped: false,
      lineNum: 1,
    };
    const result = validateRule(rule, 'codex');
    expect(result).not.toBeNull();
    expect(result.valid).toBe(false);
  });

  it('PASS: workbuddy body[data-application-name] selector', () => {
    const rule = {
      selector: 'body[data-application-name="workbuddy"]',
      declarations: '--wb-accent: #fff;',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'workbuddy')).toBeNull();
  });

  it('PASS: workbuddy descendant of body attribute selector', () => {
    const rule = {
      selector: 'body[data-application-name="workbuddy"] ::selection',
      declarations: 'background: rgba(175, 202, 210, 0.32);',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'workbuddy')).toBeNull();
  });

  it('FAIL: workbuddy attribute selector used for wrong adapter', () => {
    const rule = {
      selector: 'body[data-application-name="workbuddy"]',
      declarations: '--wb-accent: #fff;',
      scoped: false,
      lineNum: 1,
    };
    const result = validateRule(rule, 'codex');
    expect(result).not.toBeNull();
    expect(result.valid).toBe(false);
  });

  it('FAIL: bare element selector for any adapter', () => {
    const rule = {
      selector: 'a',
      declarations: 'color: var(--agentskin-accent);',
      scoped: false,
      lineNum: 1,
    };
    expect(validateRule(rule, 'traework')).not.toBeNull();
    expect(validateRule(rule, 'codex')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getHostAnchors
// ---------------------------------------------------------------------------

describe('getHostAnchors', () => {
  it('returns the correct anchors for each adapter', () => {
    const anchors = getHostAnchors('traework');
    expect(anchors).toContain('html.agentskin-host-traework');
    expect(anchors).toContain(':root.agentskin-host-traework');
  });
});

// ---------------------------------------------------------------------------
// agentFromFilename
// ---------------------------------------------------------------------------

describe('agentFromFilename', () => {
  it('extracts agent ID from CSS filenames', () => {
    expect(agentFromFilename('traework.css')).toBe('traework');
    expect(agentFromFilename('codex.css')).toBe('codex');
    expect(agentFromFilename('workbuddy.css')).toBe('workbuddy');
  });

  it('returns null for non-CSS filenames', () => {
    expect(agentFromFilename('manifest.json')).toBeNull();
    expect(agentFromFilename('readme.md')).toBeNull();
  });

  it('returns null for non-adapter CSS filenames', () => {
    expect(agentFromFilename('palette.css')).toBeNull();
    expect(agentFromFilename('globals.css')).toBeNull();
  });
});
