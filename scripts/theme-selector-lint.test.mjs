// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-selector-lint.test.mjs
 *
 * Unit tests for the static CSS selector linter.
 * Covers all 7 warning types, edge cases, and the theme scanner.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatReport, lintCssSelectors, scanThemePackage } from './theme-selector-lint.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory with theme CSS files for scanThemePackage tests. */
async function _createTempTheme(files) {
  const tmpDir = await mkdtemp(joinTempTheme(files));
  return tmpDir;
}

import { mkdtemp } from 'node:fs/promises';

async function joinTempTheme(files) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'theme-lint-test-'));
  const cssDir = path.join(base, 'assets', 'css');
  await mkdir(cssDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(cssDir, name), content);
  }
  return base;
}

// ---------------------------------------------------------------------------
// 1. Clean CSS — no warnings
// ---------------------------------------------------------------------------

describe('lintCssSelectors — clean CSS', () => {
  it('returns no warnings for valid CSS', () => {
    const css = `
      .foo { color: red; }
      .bar > .baz { background: blue; }
      #id-selector { margin: 0; }
      div[class*="test"] { padding: 1px; }
    `;
    const result = lintCssSelectors(css);
    expect(result.warnings).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('handles empty CSS', () => {
    const result = lintCssSelectors('');
    expect(result.warnings).toEqual([]);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it('handles CSS with only comments', () => {
    const css = '/* just a comment */';
    const result = lintCssSelectors(css);
    expect(result.warnings).toEqual([]);
  });

  it('does not flag pseudo-classes like :hover or :focus', () => {
    const css = `.btn:hover { color: red; }
    .input:focus { border: 1px solid blue; }`;
    const result = lintCssSelectors(css);
    const positional = result.warnings.filter((w) => w.type === 'positional-selector');
    expect(positional).toEqual([]);
  });

  it('does not flag pseudo-elements like ::before', () => {
    const css = `.item::before { content: ""; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. positional-selector
// ---------------------------------------------------------------------------

describe('lintCssSelectors — positional-selector', () => {
  it('detects :nth-child', () => {
    const css = `.item:nth-child(2) { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });

  it('detects :nth-of-type', () => {
    const css = `div:nth-of-type(3) { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });

  it('detects :first-child', () => {
    const css = `.list > :first-child { font-weight: bold; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });

  it('detects :last-child', () => {
    const css = `.list > :last-child { margin-bottom: 0; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });

  it('detects :nth-last-child', () => {
    const css = `.row:nth-last-child(2) { opacity: 0.5; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. deep-descendant
// ---------------------------------------------------------------------------

describe('lintCssSelectors — deep-descendant', () => {
  it('flags more than 3 descendant levels', () => {
    const css = `.a .b .c .d .e { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'deep-descendant')).toBe(true);
  });

  it('does not flag 3 or fewer descendant levels', () => {
    const css = `.a .b .c { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'deep-descendant')).toBe(false);
  });

  it('flags deep child-combinator chains', () => {
    const css = `.a > .b > .c > .d > .e { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'deep-descendant')).toBe(true);
  });

  it('respects custom maxDescendantDepth', () => {
    const css = `.a .b .c .d { color: red; }`;
    const result = lintCssSelectors(css, { maxDescendantDepth: 4 });
    expect(result.warnings.some((w) => w.type === 'deep-descendant')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. generated-class
// ---------------------------------------------------------------------------

describe('lintCssSelectors — generated-class', () => {
  it('detects CSS Modules pattern (.css-xxxxx)', () => {
    const css = `.css-1w23xea { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'generated-class')).toBe(true);
  });

  it('detects hex-hash class (.abc123def)', () => {
    const css = `.abc123def { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'generated-class')).toBe(true);
  });

  it('detects emotion-style class (._xxxxx)', () => {
    const css = `._1a2b3c4d { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'generated-class')).toBe(true);
  });

  it('detects styles_ prefix', () => {
    const css = `.styles_header_1a2b { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'generated-class')).toBe(true);
  });

  it('does not flag normal class names', () => {
    const css = `.my-component { color: red; }
    .chat-input { background: white; }
    .sidebar-navigation { width: 200px; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'generated-class')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. overly-long
// ---------------------------------------------------------------------------

describe('lintCssSelectors — overly-long', () => {
  it('flags selectors longer than 120 characters', () => {
    const longSel =
      '.very-long-selector-name-another-class-yet-another-class-and-more-classes-here-it-goes-on-and-on-and-on-and-even-more-here';
    const css = `${longSel} { color: red; }`;
    expect(longSel.length).toBeGreaterThan(120);
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'overly-long')).toBe(true);
  });

  it('does not flag selectors under 120 characters', () => {
    const css = '.normal-class-name { color: red; }';
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'overly-long')).toBe(false);
  });

  it('respects custom maxSelectorLength', () => {
    const sel = '.a.b.c.d.e.f.g';
    const css = `${sel} { color: red; }`;
    const result = lintCssSelectors(css, { maxSelectorLength: 5 });
    expect(result.warnings.some((w) => w.type === 'overly-long')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. invalid-syntax
// ---------------------------------------------------------------------------

describe('lintCssSelectors — invalid-syntax', () => {
  it('flags unbalanced brackets', () => {
    const css = `.foo[data-testid="bar { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'invalid-syntax')).toBe(true);
  });

  it('flags unbalanced parentheses', () => {
    const css = `.foo:not(.bar { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'invalid-syntax')).toBe(true);
  });

  it('counts invalid-syntax as errorCount', () => {
    const css = `.foo[data-testid="bar { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.errorCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. universal-selector
// ---------------------------------------------------------------------------

describe('lintCssSelectors — universal-selector', () => {
  it('flags bare * selector', () => {
    const css = `* { box-sizing: border-box; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'universal-selector')).toBe(true);
  });

  it('flags * with descendant combinator', () => {
    const css = `* .container { margin: 0; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'universal-selector')).toBe(true);
  });

  it('does not flag *.class (equivalent to .class)', () => {
    const css = `*.active { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'universal-selector')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. important-overuse
// ---------------------------------------------------------------------------

describe('lintCssSelectors — important-overuse', () => {
  it('flags rules with more than 5 !important declarations', () => {
    const css = `.overrides {
      color: red !important;
      background: blue !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      font-size: 14px !important;
    }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'important-overuse')).toBe(true);
  });

  it('does not flag rules with 5 or fewer !important declarations', () => {
    const css = `.normal {
      color: red !important;
      background: blue !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
    }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'important-overuse')).toBe(false);
  });

  it('respects custom maxImportantPerRule', () => {
    const css = `.custom {
      color: red !important;
      background: blue !important;
    }`;
    const result = lintCssSelectors(css, { maxImportantPerRule: 1 });
    expect(result.warnings.some((w) => w.type === 'important-overuse')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Multi-selector rules
// ---------------------------------------------------------------------------

describe('lintCssSelectors — multi-selector rules', () => {
  it('checks each selector in a comma-separated rule', () => {
    const css = `.foo, .item:nth-child(2), .bar { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });

  it('handles commas inside :not()', () => {
    const css = `.foo:not(.a, .b) { color: red; }`;
    const result = lintCssSelectors(css);
    // Should not split on the comma inside :not()
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Line and column tracking
// ---------------------------------------------------------------------------

describe('lintCssSelectors — line/column tracking', () => {
  it('reports correct line numbers', () => {
    const css = `\n\n.item:nth-child(2) { color: red; }`;
    const result = lintCssSelectors(css);
    const positional = result.warnings.find((w) => w.type === 'positional-selector');
    expect(positional).toBeDefined();
    expect(positional.line).toBe(3);
  });

  it('reports correct column numbers', () => {
    const css = `    .item:nth-child(2) { color: red; }`;
    const result = lintCssSelectors(css);
    const positional = result.warnings.find((w) => w.type === 'positional-selector');
    expect(positional).toBeDefined();
    expect(positional.column).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 11. enabledTypes option
// ---------------------------------------------------------------------------

describe('lintCssSelectors — enabledTypes option', () => {
  it('only checks specified types', () => {
    const css = `.item:nth-child(2) { color: red; }
    .a .b .c .d .e { color: blue; }`;
    const result = lintCssSelectors(css, { enabledTypes: ['positional-selector'] });
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
    expect(result.warnings.some((w) => w.type === 'deep-descendant')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Unicode selectors
// ---------------------------------------------------------------------------

describe('lintCssSelectors — unicode selectors', () => {
  it('handles unicode characters in selectors', () => {
    const css = `.中文选择器 { color: red; }`;
    const result = lintCssSelectors(css);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 13. scanThemePackage
// ---------------------------------------------------------------------------

describe('scanThemePackage', () => {
  it('scans all CSS files in a theme directory', async () => {
    const themeDir = await joinTempTheme({
      'traework.css': '.foo { color: red; }',
      'codex.css': '.bar { color: blue; }',
    });
    try {
      const result = await scanThemePackage(themeDir);
      expect(result.files).toHaveLength(2);
      expect(result.totalWarnings).toBe(0);
      expect(result.totalErrors).toBe(0);
    } finally {
      await rm(themeDir, { recursive: true, force: true });
    }
  });

  it('aggregates warnings across CSS files', async () => {
    const themeDir = await joinTempTheme({
      'traework.css': '.item:nth-child(2) { color: red; }',
      'codex.css': '.a .b .c .d .e { color: blue; }',
    });
    try {
      const result = await scanThemePackage(themeDir);
      expect(result.totalWarnings).toBeGreaterThan(0);
    } finally {
      await rm(themeDir, { recursive: true, force: true });
    }
  });

  it('handles missing css directory gracefully', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'theme-lint-empty-'));
    try {
      const result = await scanThemePackage(tmpDir);
      expect(result.files).toEqual([]);
      expect(result.totalWarnings).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 14. formatReport
// ---------------------------------------------------------------------------

describe('formatReport', () => {
  it('formats results with warnings', () => {
    const results = [
      {
        themeDir: '/themes/test-theme',
        files: [
          {
            file: '/themes/test-theme/assets/css/traework.css',
            relativePath: 'themes/test-theme/assets/css/traework.css',
            warnings: [
              {
                line: 5,
                column: 1,
                type: 'positional-selector',
                selector: '.item:nth-child(2)',
                message: 'Positional pseudo-class detected — fragile across re-renders',
              },
            ],
            errorCount: 0,
            warningCount: 1,
          },
        ],
        totalWarnings: 1,
        totalErrors: 0,
      },
    ];
    const report = formatReport(results, 1, 0, 1);
    expect(report).toContain('test-theme');
    expect(report).toContain('positional-selector');
    expect(report).toContain('1 files, 1 warnings, 0 errors');
  });

  it('formats clean results', () => {
    const results = [
      {
        themeDir: '/themes/clean-theme',
        files: [
          {
            file: '/themes/clean-theme/assets/css/traework.css',
            relativePath: 'themes/clean-theme/assets/css/traework.css',
            warnings: [],
            errorCount: 0,
            warningCount: 0,
          },
        ],
        totalWarnings: 0,
        totalErrors: 0,
      },
    ];
    const report = formatReport(results, 0, 0, 1);
    expect(report).toContain('OK');
  });
});

// ---------------------------------------------------------------------------
// 15. @media nested rules
// ---------------------------------------------------------------------------

describe('lintCssSelectors — @media nested rules', () => {
  it('lints selectors inside @media blocks', () => {
    const css = `@media (max-width: 600px) {
      .item:nth-child(2) { color: red; }
    }`;
    const result = lintCssSelectors(css);
    expect(result.warnings.some((w) => w.type === 'positional-selector')).toBe(true);
  });

  it('does not lint @media query as a selector', () => {
    const css = `@media (max-width: 600px) {
      .foo { color: red; }
    }`;
    const result = lintCssSelectors(css);
    // @media should not appear as a flagged selector
    expect(result.warnings.some((w) => w.selector.includes('@media'))).toBe(false);
  });
});
