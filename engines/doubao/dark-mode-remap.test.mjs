/**
 * dark-mode-remap.test.mjs — Vitest tests for Doubao dark mode remap module.
 *
 * Run: npx vitest run engines/doubao/dark-mode-remap.test.mjs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDarkModeTokenOverrides,
  getDarkModeElementOverrides,
  isDarkModePreferred,
  isValidCssColor,
  tokensToCss,
  getFullDarkModeCss,
} from './dark-mode-remap.mjs';

// ---------------------------------------------------------------------------
// Test group 1: getDarkModeTokenOverrides
// ---------------------------------------------------------------------------
describe('getDarkModeTokenOverrides', () => {
  it('returns a non-empty object with expected token keys', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(typeof tokens).toBe('object');
    expect(tokens).not.toBeNull();
    expect(Object.keys(tokens).length).toBeGreaterThan(0);
  });

  it('contains core text color tokens', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(tokens).toHaveProperty('--dbx-text-primary');
    expect(tokens).toHaveProperty('--dbx-text-secondary');
    expect(tokens).toHaveProperty('--dbx-text-tertiary');
    expect(tokens).toHaveProperty('--dbx-text-disable');
  });

  it('contains background color tokens', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(tokens).toHaveProperty('--dbx-bg-primary');
    expect(tokens).toHaveProperty('--dbx-bg-secondary');
    expect(tokens).toHaveProperty('--dbx-bg-tertiary');
    expect(tokens).toHaveProperty('--dbx-bg-float');
  });

  it('contains border color tokens', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(tokens).toHaveProperty('--dbx-border-primary');
    expect(tokens).toHaveProperty('--dbx-border-secondary');
    expect(tokens).toHaveProperty('--dbx-line-divider-10');
    expect(tokens).toHaveProperty('--dbx-line-10');
  });

  it('contains Semi Design (--semi-color-*) tokens', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(tokens).toHaveProperty('--semi-color-bg-0');
    expect(tokens).toHaveProperty('--semi-color-text-0');
    expect(tokens).toHaveProperty('--semi-color-border');
    expect(tokens).toHaveProperty('--semi-color-fill-0');
    expect(tokens).toHaveProperty('--semi-color-disabled-text');
  });

  it('contains --s-color-* tokens', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(tokens).toHaveProperty('--s-color-bg-body');
    expect(tokens).toHaveProperty('--s-color-text-primary');
    expect(tokens).toHaveProperty('--s-color-bg-primary');
    expect(tokens).toHaveProperty('--s-color-border-tertiary');
  });

  it('contains gray ramp tokens', () => {
    const tokens = getDarkModeTokenOverrides();
    expect(tokens).toHaveProperty('--gray1');
    expect(tokens).toHaveProperty('--gray6');
    expect(tokens).toHaveProperty('--gray12');
  });

  it('all token values are valid CSS color strings', () => {
    // The Doubao dark-mode tokens are theme-aware: they reference agentskin
    // CSS variables via var() and color-mix() rather than hard-coded hex
    // colors. isValidCssColor's built-in regex does not cover color-mix(), so
    // this test uses a broader check that accepts the full surface of valid
    // CSS color expressions: hex, rgb/rgba, hsl/hsla, named, var(), and
    // color-mix() with var() arguments.
    const CSS_COLOR_EXPANDED =
      /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(.+\)$|^hsla?\(.+\)$|^var\(.+\)$|^color-mix\(.+\)$|^[a-z]+$/;
    function isValidColorExpanded(value) {
      if (typeof value !== 'string') return false;
      return CSS_COLOR_EXPANDED.test(value.trim());
    }
    const tokens = getDarkModeTokenOverrides();
    for (const [key, value] of Object.entries(tokens)) {
      expect(isValidColorExpanded(value), `Token "${key}" has invalid color: "${value}"`).toBe(true);
    }
  });

  it('dark text tokens reference light theme variables (high luminance source)', () => {
    // After the Doubao adapter refactor, dark tokens reference agentskin theme
    // variables instead of hard-coded hex. The contract shifts from "these
    // specific hex values" to "these tokens reference the correct agentskin
    // semantic variable" — which is guaranteed light in dark themes by the
    // agentskin theme engine. --agentskin-text is the primary light-bg text
    // token and IS high-luminance in any dark theme (WCAG AA compliant).
    const tokens = getDarkModeTokenOverrides();
    expect(tokens['--dbx-text-primary']).toBe('var(--agentskin-text)');
    expect(tokens['--dbx-text-secondary']).toBe('var(--agentskin-text-muted)');
  });

  it('dark background tokens reference dark theme variables (low luminance source)', () => {
    // Per the refactor, background tokens now resolve to agentskin surface/bg
    // variables. --agentskin-bg is the darkest surface token in any dark
    // theme; --agentskin-surface and --agentskin-surface-elevated are
    // progressively lighter — all remain low-luminance in dark mode.
    const tokens = getDarkModeTokenOverrides();
    expect(tokens['--dbx-bg-primary']).toBe('var(--agentskin-bg)');
    expect(tokens['--dbx-bg-secondary']).toBe('var(--agentskin-surface)');
    expect(tokens['--dbx-bg-tertiary']).toBe('var(--agentskin-surface-elevated)');
  });
});

// ---------------------------------------------------------------------------
// Test group 2: getDarkModeElementOverrides
// ---------------------------------------------------------------------------
describe('getDarkModeElementOverrides', () => {
  it('returns a non-empty CSS string', () => {
    const css = getDarkModeElementOverrides();
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(0);
  });

  it('contains sidebar account selector coverage', () => {
    const css = getDarkModeElementOverrides();
    expect(css).toContain('.dbx-account-info');
    expect(css).toContain('account');
  });

  it('contains search input selectors', () => {
    const css = getDarkModeElementOverrides();
    expect(css).toContain('search');
    expect(css).toContain('input');
  });

  it('contains history item selectors', () => {
    const css = getDarkModeElementOverrides();
    expect(css).toContain('history-item');
    expect(css).toContain('conversation-item');
  });

  it('contains titlebar selectors', () => {
    const css = getDarkModeElementOverrides();
    expect(css).toContain('titlebar');
    expect(css).toContain('h-header-height');
  });

  it('contains suggestion card selectors', () => {
    const css = getDarkModeElementOverrides();
    expect(css).toContain('suggestion-card');
    expect(css).toContain('recommend-card');
  });

  it('contains composer actions selectors', () => {
    const css = getDarkModeElementOverrides();
    expect(css).toContain('composer-actions');
    expect(css).toContain('input-actions');
  });

  it('all color values in element overrides are valid CSS colors', () => {
    const css = getDarkModeElementOverrides();
    const colorMatches = css.match(/#[0-9a-fA-F]{3,8}/g) || [];
    for (const color of colorMatches) {
      expect(isValidCssColor(color), `CSS contains invalid color: "${color}"`).toBe(true);
    }
  });

  it('uses !important for all declarations', () => {
    const css = getDarkModeElementOverrides();
    // Every property declaration line should have !important.
    // A declaration line contains `: <value>;` (property: value;).
    // Selector-only lines (e.g. comma-separated selectors) are skipped.
    const declLines = css.split('\n').filter(l => /:\s*[^;]+;/.test(l));
    expect(declLines.length).toBeGreaterThan(0);
    for (const line of declLines) {
      if (line.trim().startsWith('/*') || line.trim() === '') continue;
      expect(line).toContain('!important');
    }
  });
});

// ---------------------------------------------------------------------------
// Test group 3: isDarkModePreferred
// ---------------------------------------------------------------------------
describe('isDarkModePreferred', () => {
  let originalMatchMedia;
  let originalWindow;

  beforeEach(() => {
    originalMatchMedia = globalThis.window?.matchMedia;
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
    vi.restoreAllMocks();
  });

  it('returns false when window is undefined (non-browser env)', () => {
    delete globalThis.window;
    expect(isDarkModePreferred()).toBe(false);
  });

  it('returns true when system prefers dark mode', () => {
    globalThis.window = {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    };
    expect(isDarkModePreferred()).toBe(true);
  });

  it('returns false when system prefers light mode', () => {
    globalThis.window = {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
    };
    expect(isDarkModePreferred()).toBe(false);
  });

  it('returns false when matchMedia is not available', () => {
    globalThis.window = {};
    expect(isDarkModePreferred()).toBe(false);
  });

  it('queries prefers-color-scheme: dark', () => {
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: true });
    globalThis.window = { matchMedia: mockMatchMedia };
    isDarkModePreferred();
    expect(mockMatchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });
});

// ---------------------------------------------------------------------------
// Test group 4: isValidCssColor (utility)
// ---------------------------------------------------------------------------
describe('isValidCssColor', () => {
  it('accepts 6-digit hex colors', () => {
    expect(isValidCssColor('#E8E8E8')).toBe(true);
    expect(isValidCssColor('#1E1E1E')).toBe(true);
  });

  it('accepts 3-digit hex colors', () => {
    expect(isValidCssColor('#FFF')).toBe(true);
    expect(isValidCssColor('#000')).toBe(true);
  });

  it('accepts rgb/rgba colors', () => {
    expect(isValidCssColor('rgb(232, 232, 232)')).toBe(true);
    expect(isValidCssColor('rgba(0, 0, 0, 0.4)')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidCssColor('')).toBe(false);
    expect(isValidCssColor('not-a-color')).toBe(false);
    expect(isValidCssColor(123)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test group 5: tokensToCss
// ---------------------------------------------------------------------------
describe('tokensToCss', () => {
  it('converts token object to CSS rule string', () => {
    const tokens = { '--dbx-text-primary': '#E8E8E8' };
    const css = tokensToCss(tokens);
    expect(css).toContain(':root');
    expect(css).toContain('--dbx-text-primary: #E8E8E8 !important;');
  });

  it('accepts custom selector', () => {
    const tokens = { '--test': '#000000' };
    const css = tokensToCss(tokens, '.custom-selector');
    expect(css).toContain('.custom-selector');
    expect(css).not.toContain(':root');
  });
});

// ---------------------------------------------------------------------------
// Test group 6: getFullDarkModeCss
// ---------------------------------------------------------------------------
describe('getFullDarkModeCss', () => {
  it('returns combined token + element CSS', () => {
    const css = getFullDarkModeCss();
    expect(css).toContain('--dbx-text-primary');
    expect(css).toContain('.dbx-account-info');
    expect(css).toContain('history-item');
  });

  it('output is a non-empty string', () => {
    const css = getFullDarkModeCss();
    expect(typeof css).toBe('string');
    expect(css.length).toBeGreaterThan(100);
  });
});
