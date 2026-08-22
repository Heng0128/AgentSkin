// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  getTemplate,
  passesAA,
  STUDIO_THEME_TEMPLATES,
  templateCategories,
  templatesByCategory,
  templatesByMode,
  wcagContrast,
} from './studio-theme-templates';

// Helper to check if a string is a valid CSS color (hex or rgba)
const isValidColor = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const hexMatch = value.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
  const rgbaMatch = value.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/);
  return !!hexMatch || !!rgbaMatch;
};

// ---------------------------------------------------------------------------
// Contrast utility tests
// ---------------------------------------------------------------------------

describe('wcagContrast', () => {
  it('returns ~21 for black-on-white', () => {
    expect(wcagContrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('returns 1 for identical colors', () => {
    expect(wcagContrast('#808080', '#808080')).toBeCloseTo(1, 1);
  });

  it('is symmetric (order-independent)', () => {
    expect(wcagContrast('#fff', '#000')).toBeCloseTo(wcagContrast('#000', '#fff'), 5);
  });
});

describe('passesAA', () => {
  it('passes for 4.5:1 contrast', () => {
    expect(passesAA('#767676', '#FFFFFF')).toBe(true);
  });

  it('fails for 2:1 contrast', () => {
    expect(passesAA('#949494', '#FFFFFF')).toBe(false);
  });

  it('accepts 3:1 for large text', () => {
    expect(passesAA('#949494', '#FFFFFF', true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template curation rules
// ---------------------------------------------------------------------------

describe('STUDIO_THEME_TEMPLATES curation rules', () => {
  it('contains at least 5 templates', () => {
    expect(STUDIO_THEME_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it('has at least 3 dark + 2 light templates', () => {
    expect(templatesByMode('dark').length).toBeGreaterThanOrEqual(3);
    expect(templatesByMode('light').length).toBeGreaterThanOrEqual(2);
  });

  it('every template hits WCAG AA on foreground/background pairs', () => {
    for (const t of STUDIO_THEME_TEMPLATES) {
      // Critical: normal text on base background.
      expect(
        passesAA(t.palette.foreground, t.palette.background),
        `${t.id}: foreground/background failed AA`,
      ).toBe(true);
      // Critical: muted text on base background (lowest-contrast text).
      expect(
        passesAA(t.palette.muted, t.palette.background, true),
        `${t.id}: muted/background failed AA Large`,
      ).toBe(true);
      // Critical: surfaceElevated panel text card.
      expect(
        passesAA(t.palette.foreground, t.palette.surfaceElevated),
        `${t.id}: foreground/surfaceElevated failed AA`,
      ).toBe(true);
    }
  });

  it('every template has all 14 palette keys', () => {
    const REQUIRED: Array<keyof (typeof STUDIO_THEME_TEMPLATES)[0]['palette']> = [
      'accent',
      'secondary',
      'background',
      'foreground',
      'muted',
      'surface',
      'surfaceElevated',
      'border',
      'codeBackground',
      'codeForeground',
      'inputBackground',
      'buttonBackground',
      'buttonForeground',
      'focusRing',
    ];
    for (const t of STUDIO_THEME_TEMPLATES) {
      for (const key of REQUIRED) {
        const value = t.palette[key];
        expect(value, `${t.id}: palette.${key} must be a valid color`).toBeDefined();
        expect(typeof value).toBe('string');
        // Validate using helper function
        expect(isValidColor(value), `${t.id}: palette.${key} is not a valid color`).toBe(true);
      }
    }
  });

  it('has accent color diversity (at least 3 distinct hues)', () => {
    const hues = new Set(STUDIO_THEME_TEMPLATES.map((t) => t.palette.accent));
    expect(hues.size).toBeGreaterThanOrEqual(3);
  });

  it('has distinct ids (no duplicates)', () => {
    const ids = STUDIO_THEME_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every template has a valid mode + category', () => {
    const validCategories = new Set(['chat-dark', 'chat-light', 'ide', 'terminal', 'reading']);
    for (const t of STUDIO_THEME_TEMPLATES) {
      expect(t.mode).toMatch(/^(dark|light)$/);
      expect(validCategories.has(t.category)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

describe('template lookup helpers', () => {
  it('getTemplate returns the correct template', () => {
    const tmpl = getTemplate('terminal-ops');
    expect(tmpl?.name).toBe('终端作战室');
  });

  it('getTemplate returns undefined for unknown id', () => {
    expect(getTemplate('does-not-exist')).toBeUndefined();
  });

  it('templatesByMode filters strictly', () => {
    for (const t of templatesByMode('dark')) {
      expect(t.mode).toBe('dark');
    }
  });

  it('templatesByCategory filters strictly', () => {
    for (const t of templatesByCategory('ide')) {
      expect(t.category).toBe('ide');
    }
  });

  it('templateCategories returns a non-empty array', () => {
    const cats = templateCategories();
    expect(cats.length).toBeGreaterThan(0);
    // Every returned category must exist in the set.
    for (const c of cats) {
      expect(templatesByCategory(c).length).toBeGreaterThan(0);
    }
  });
});
