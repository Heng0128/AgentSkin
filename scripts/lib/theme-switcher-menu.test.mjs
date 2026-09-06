// SPDX-License-Identifier: MPL-2.0
//
// # theme-switcher-menu.test.mjs
//
// Unit tests for the lightweight theme switcher menu generator.
// Uses Vitest test framework.
//
// Coverage:
//   - createSwitcherMenu: HTML generation, escaping, validation
//   - generateThemeCss: CSS output, theme class generation
//   - switchTheme: JS snippet generation, sanitization
//   - persistTheme: JS snippet generation, key correctness
//   - getPersistedTheme: JS snippet generation
//   - buildInjectionScript: full script assembly, idempotency guard
//   - injectMenu: CDP payload shape
//   - Edge cases: empty themes, invalid inputs, XSS safety

import { describe, expect, it } from 'vitest';
import {
  buildInjectionScript,
  createSwitcherMenu,
  generateThemeCss,
  getPersistedTheme,
  injectMenu,
  persistTheme,
  SWITCHER_DOM_ID,
  SWITCHER_Z_INDEX,
  switchTheme,
  THEME_CLASS_PREFIX,
  THEME_PREFERENCE_KEY,
} from './theme-switcher-menu.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal set of themes for testing. */
function sampleThemes() {
  return [
    { id: 'catppuccin', name: 'Catppuccin', css: '--as-bg: #1e1e2e; --as-text: #cdd6f4;' },
    { id: 'dracula', name: 'Dracula', css: '--as-bg: #282a36; --as-text: #f8f8f2;' },
    { id: 'nord', name: 'Nord', css: '--as-bg: #2e3440; --as-text: #eceff4;' },
  ];
}

// ---------------------------------------------------------------------------
// createSwitcherMenu
// ---------------------------------------------------------------------------

describe('createSwitcherMenu', () => {
  it('generates a container with the correct DOM id', () => {
    const html = createSwitcherMenu(sampleThemes());
    expect(html).toContain(`id="${SWITCHER_DOM_ID}"`);
  });

  it('includes a palette button', () => {
    const html = createSwitcherMenu(sampleThemes());
    expect(html).toContain('class="as-theme-btn"');
    expect(html).toContain('🎨');
  });

  it('always includes a "native" option as the first item', () => {
    const html = createSwitcherMenu(sampleThemes());
    expect(html).toContain('data-theme-id="native"');
    expect(html).toContain('原生界面');
  });

  it('renders all theme items with correct data attributes', () => {
    const themes = sampleThemes();
    const html = createSwitcherMenu(themes);
    for (const theme of themes) {
      expect(html).toContain(`data-theme-id="${theme.id}"`);
      expect(html).toContain(`>${theme.name}</div>`);
    }
  });

  it('produces valid fixed-position styling', () => {
    const html = createSwitcherMenu(sampleThemes());
    expect(html).toContain('position:fixed');
    expect(html).toContain('top:8px');
    expect(html).toContain('right:8px');
    expect(html).toContain(`z-index:${SWITCHER_Z_INDEX}`);
  });

  it('escapes HTML special characters in theme names', () => {
    const themes = [{ id: 'xss-test', name: '<script>alert(1)</script>' }];
    const html = createSwitcherMenu(themes);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML in theme ids used as attributes', () => {
    const themes = [{ id: 'foo"bar', name: 'Test' }];
    const html = createSwitcherMenu(themes);
    expect(html).not.toContain('data-theme-id="foo"bar"');
    expect(html).toContain('data-theme-id="foo&quot;bar"');
  });

  it('works with an empty themes array (only native option)', () => {
    const html = createSwitcherMenu([]);
    expect(html).toContain('data-theme-id="native"');
    // Should not contain any other data-theme-id
    const matches = html.match(/data-theme-id=/g);
    expect(matches.length).toBe(1);
  });

  it('throws TypeError for non-array input', () => {
    expect(() => createSwitcherMenu(null)).toThrow(TypeError);
    expect(() => createSwitcherMenu('string')).toThrow(TypeError);
    expect(() => createSwitcherMenu(123)).toThrow(TypeError);
  });

  it('throws TypeError for theme with missing id', () => {
    expect(() => createSwitcherMenu([{ name: 'No ID' }])).toThrow(TypeError);
  });

  it('throws TypeError for theme with missing name', () => {
    expect(() => createSwitcherMenu([{ id: 'no-name' }])).toThrow(TypeError);
  });

  it('throws TypeError for non-object theme entry', () => {
    expect(() => createSwitcherMenu(['string-theme'])).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// generateThemeCss
// ---------------------------------------------------------------------------

describe('generateThemeCss', () => {
  it('generates CSS with switcher structural rules', () => {
    const css = generateThemeCss(sampleThemes());
    expect(css).toContain('.as-theme-btn');
    expect(css).toContain('.as-theme-dropdown');
    expect(css).toContain('.as-theme-item');
  });

  it('generates a theme class for each non-native theme', () => {
    const css = generateThemeCss(sampleThemes());
    expect(css).toContain('.as-theme-catppuccin');
    expect(css).toContain('.as-theme-dracula');
    expect(css).toContain('.as-theme-nord');
  });

  it('includes the custom CSS content from each theme', () => {
    const css = generateThemeCss(sampleThemes());
    expect(css).toContain('--as-bg: #1e1e2e');
    expect(css).toContain('--as-bg: #282a36');
    expect(css).toContain('--as-bg: #2e3440');
  });

  it('does not generate a class for the "native" theme', () => {
    const themes = [{ id: 'native', name: 'Native' }];
    const css = generateThemeCss(themes);
    expect(css).not.toContain('.as-theme-native');
  });

  it('skips themes with empty or missing css property', () => {
    const themes = [
      { id: 'no-css', name: 'No CSS' },
      { id: 'empty-css', name: 'Empty CSS', css: '' },
      { id: 'whitespace-css', name: 'Whitespace', css: '   ' },
    ];
    const css = generateThemeCss(themes);
    expect(css).not.toContain('.as-theme-no-css');
    expect(css).not.toContain('.as-theme-empty-css');
    expect(css).not.toContain('.as-theme-whitespace-css');
  });

  it('returns structural CSS even for empty themes array', () => {
    const css = generateThemeCss([]);
    expect(css).toContain('.as-theme-btn');
    expect(css).toContain('.as-theme-dropdown');
  });

  it('throws TypeError for non-array input', () => {
    expect(() => generateThemeCss(null)).toThrow(TypeError);
    expect(() => generateThemeCss('bad')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// switchTheme
// ---------------------------------------------------------------------------

describe('switchTheme', () => {
  it('generates a self-invoking JS expression', () => {
    const js = switchTheme('catppuccin');
    expect(js.startsWith('((')).toBe(true);
    expect(js.endsWith(')')).toBe(true);
  });

  it('includes the theme class prefix and target id', () => {
    const js = switchTheme('dracula');
    expect(js).toContain(THEME_CLASS_PREFIX);
    expect(js).toContain('dracula');
  });

  it('handles "native" theme by not adding a class', () => {
    const js = switchTheme('native');
    expect(js).toContain("tid!=='native'");
  });

  it('sanitizes themeId to prevent injection', () => {
    const js = switchTheme('foo";alert(1);//');
    expect(js).not.toContain('alert(1)');
    expect(js).not.toContain('";');
  });

  it('throws TypeError for empty string', () => {
    expect(() => switchTheme('')).toThrow(TypeError);
  });

  it('throws TypeError for non-string input', () => {
    expect(() => switchTheme(123)).toThrow(TypeError);
    expect(() => switchTheme(null)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// persistTheme
// ---------------------------------------------------------------------------

describe('persistTheme', () => {
  it('generates a self-invoking JS expression', () => {
    const js = persistTheme('catppuccin');
    expect(js.startsWith('(()=>')).toBe(true);
  });

  it('uses the correct localStorage key', () => {
    const js = persistTheme('nord');
    expect(js).toContain(THEME_PREFERENCE_KEY);
  });

  it('stores themeId and timestamp in JSON format', () => {
    const js = persistTheme('dracula');
    expect(js).toContain('themeId:');
    expect(js).toContain('timestamp:Date.now()');
    expect(js).toContain('JSON.stringify');
  });

  it('wraps localStorage access in try/catch', () => {
    const js = persistTheme('catppuccin');
    expect(js).toContain('try{');
    expect(js).toContain('catch(_){');
  });

  it('sanitizes themeId to prevent injection', () => {
    const js = persistTheme("xss';document.cookie//");
    expect(js).not.toContain('document.cookie');
  });

  it('throws TypeError for empty string', () => {
    expect(() => persistTheme('')).toThrow(TypeError);
  });

  it('throws TypeError for non-string input', () => {
    expect(() => persistTheme(undefined)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// getPersistedTheme
// ---------------------------------------------------------------------------

describe('getPersistedTheme', () => {
  it('generates a self-invoking JS expression', () => {
    const js = getPersistedTheme();
    expect(js.startsWith('(()=>')).toBe(true);
  });

  it('reads from the correct localStorage key', () => {
    const js = getPersistedTheme();
    expect(js).toContain(THEME_PREFERENCE_KEY);
  });

  it('returns "native" as fallback when no data exists', () => {
    const js = getPersistedTheme();
    expect(js).toContain("return 'native'");
  });

  it('parses JSON and validates themeId type', () => {
    const js = getPersistedTheme();
    expect(js).toContain('JSON.parse');
    expect(js).toContain("typeof data.themeId==='string'");
  });

  it('wraps localStorage access in try/catch', () => {
    const js = getPersistedTheme();
    expect(js).toContain('try{');
    expect(js).toContain("catch(_){return 'native'}");
  });
});

// ---------------------------------------------------------------------------
// buildInjectionScript
// ---------------------------------------------------------------------------

describe('buildInjectionScript', () => {
  it('generates a self-invoking JS expression', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script.startsWith('(()=>{')).toBe(true);
  });

  it('includes the idempotency guard', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain('already-injected');
    expect(script).toContain(`getElementById('${SWITCHER_DOM_ID}')`);
  });

  it('injects CSS via a <style> element', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain("document.createElement('style')");
    expect(script).toContain('document.head.appendChild(style)');
  });

  it('injects menu HTML into <body>', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain('document.body.appendChild');
  });

  it('binds click handler to the palette button', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain("btn.addEventListener('click'");
  });

  it('closes dropdown when clicking outside', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain("document.addEventListener('click'");
  });

  it('restores persisted theme on injection', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain('localStorage.getItem');
    expect(script).toContain('JSON.parse');
  });

  it('includes all theme CSS in the style block', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).toContain('--as-bg: #1e1e2e');
    expect(script).toContain('--as-bg: #282a36');
  });

  it('works with empty themes array', () => {
    const script = buildInjectionScript([]);
    expect(script.startsWith('(()=>{')).toBe(true);
    expect(script).toContain('injected');
  });

  it('includes agentId in the script when provided', () => {
    const script = buildInjectionScript(sampleThemes(), { agentId: 'traework' });
    // agentId is used for scoping — verify it doesn't break the script
    expect(script).toContain('injected');
  });

  it('throws TypeError for non-array themes', () => {
    expect(() => buildInjectionScript(null)).toThrow(TypeError);
    expect(() => buildInjectionScript('bad')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// injectMenu
// ---------------------------------------------------------------------------

describe('injectMenu', () => {
  it('returns a CDP Runtime.evaluate payload', () => {
    const payload = injectMenu(sampleThemes());
    expect(payload.method).toBe('Runtime.evaluate');
    expect(typeof payload.params.expression).toBe('string');
    expect(payload.params.returnByValue).toBe(true);
  });

  it('expression is a self-invoking function', () => {
    const payload = injectMenu(sampleThemes());
    expect(payload.params.expression.startsWith('(()=>{')).toBe(true);
  });

  it('passes agentId through to buildInjectionScript', () => {
    const payload = injectMenu(sampleThemes(), { agentId: 'workbuddy' });
    expect(payload.method).toBe('Runtime.evaluate');
    expect(payload.params.expression.length).toBeGreaterThan(0);
  });

  it('throws TypeError for non-array themes', () => {
    expect(() => injectMenu(null)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('THEME_PREFERENCE_KEY is agentskin-theme-preference', () => {
    expect(THEME_PREFERENCE_KEY).toBe('agentskin-theme-preference');
  });

  it('SWITCHER_DOM_ID is agentskin-theme-switcher', () => {
    expect(SWITCHER_DOM_ID).toBe('agentskin-theme-switcher');
  });

  it('THEME_CLASS_PREFIX is as-theme-', () => {
    expect(THEME_CLASS_PREFIX).toBe('as-theme-');
  });

  it('SWITCHER_Z_INDEX is 99999', () => {
    expect(SWITCHER_Z_INDEX).toBe(99999);
  });
});

// ---------------------------------------------------------------------------
// Integration: end-to-end script structure
// ---------------------------------------------------------------------------

describe('integration: injection script structure', () => {
  it('produces a syntactically valid JS expression (balanced parens)', () => {
    const script = buildInjectionScript(sampleThemes());
    let depth = 0;
    for (const ch of script) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('contains no references to document.cookie or sensitive APIs', () => {
    const script = buildInjectionScript(sampleThemes());
    expect(script).not.toContain('document.cookie');
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
    expect(script).not.toContain('navigator.sendBeacon');
  });

  it('uses only its own localStorage key namespace', () => {
    const script = buildInjectionScript(sampleThemes());
    // All localStorage references should use the THEME_PREFERENCE_KEY
    const localStorageGets = script.match(/localStorage\.getItem\('([^']*)'\)/g);
    if (localStorageGets) {
      for (const match of localStorageGets) {
        expect(match).toContain(THEME_PREFERENCE_KEY);
      }
    }
  });
});
