// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-selector-lint
 *
 * Static CSS selector linter for theme packages.
 *
 * Analyzes theme CSS files without requiring a CDP runtime — detects
 * potentially problematic selectors at pack/import time. Inspired by
 * CodeDrobe's `theme inspect` selector linting.
 *
 * ## Warning types
 *
 * | type | description |
 * |------|-------------|
 * | `positional-selector` | `:nth-child`, `:nth-of-type`, `:first-child`, `:last-child` — fragile across re-renders |
 * | `deep-descendant` | more than 3 levels of nesting — breaks when wrappers change |
 * | `generated-class` | CSS module hash patterns (`.css-1w23xea`, `.abc123def`) — breaks on rebuild |
 * | `overly-long` | selector longer than 120 characters — hard to maintain |
 * | `invalid-syntax` | selectors that fail basic syntax validation |
 * | `universal-selector` | bare `*` selector — performance concern |
 * | `important-overuse` | more than 5 `!important` declarations per rule |
 *
 * ## Usage
 *
 *   node scripts/theme-selector-lint.mjs                        # scan all themes
 *   node scripts/theme-selector-lint.mjs --json                 # machine-readable output
 *   node scripts/theme-selector-lint.mjs --max-depth 4         # custom threshold
 *   node scripts/theme-selector-lint.mjs --types positional-selector,deep-descendant
 *
 * ## Exit codes
 *
 *   0 — no errors (warnings are non-blocking)
 *   1 — errors found (invalid-syntax)
 *   2 — unrecoverable error (bad arguments, file not readable)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Constants and patterns
// ---------------------------------------------------------------------------

/** Default options for lintCssSelectors. */
const DEFAULT_OPTIONS = {
  maxDescendantDepth: 3,
  maxSelectorLength: 120,
  maxImportantPerRule: 5,
  enabledTypes: null, // null = all types enabled
};

/** All supported warning types. */
const WARNING_TYPES = [
  'positional-selector',
  'deep-descendant',
  'generated-class',
  'overly-long',
  'invalid-syntax',
  'universal-selector',
  'important-overuse',
];

/** Match positional pseudo-class selectors. Optional parens for :first-child etc. */
const POSITIONAL_RE =
  /:(?:nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type)(?:\s*\([^)]*\))?/i;

/** Match CSS Modules / styled-components generated class names (prefixed).
 *  The hash suffix may be separated by additional underscores (e.g., .styles_header_1a2b). */
const GENERATED_CLASS_RE = /\.(?:css-|styles_|style_)[0-9a-z_]*[0-9a-f][0-9a-z]{3,}(?![\w-])/i;

/** Match hex-hash-like class names (e.g., `.abc123def`). */
const HASH_CLASS_RE = /\.[0-9a-f]{6,}(?![\w-])/i;

/** Match emotion-style underscore-prefixed hash class names (e.g., `._1a2b3c`). */
const EMOTION_CLASS_RE = /\._[0-9a-z]{4,}(?![\w-])/i;

/** Match bare universal selector `*` (not `*.class` which is equivalent to `.class`). */
const UNIVERSAL_RE = /(?:^|[\s>+~])\*(?:$|[\s>+~])/;

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

/**
 * Strip CSS comments from a source string, preserving line numbers.
 * Comments are replaced with spaces (newlines kept).
 */
function stripComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      i += 2;
      while (i < css.length && !(css[i] === '*' && css[i + 1] === '/')) {
        if (css[i] === '\n') out += '\n';
        else out += ' ';
        i++;
      }
      i += 2;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

/**
 * Parse CSS text into an array of rule objects.
 * Each rule has: { selector, declarations, line, column }.
 *
 * Handles @media nested rules correctly by tracking the current rule context.
 */
function parseCss(css) {
  const rules = [];
  const cleaned = stripComments(css);

  let depth = 0;
  let buffer = '';
  let declBuffer = '';
  let lineNum = 1;
  let selectorStartLine = 1;
  let selectorStartCol = 0;
  let lineStartIdx = 0;
  let foundFirstNonWs = false;
  let currentRule = null;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '\n') {
      lineNum++;
      lineStartIdx = i + 1;
    }

    if (ch === '{') {
      const sel = buffer.trim();
      buffer = '';
      foundFirstNonWs = false;

      if (sel.length > 0 && !sel.startsWith('@')) {
        currentRule = {
          selector: sel,
          declarations: '',
          line: selectorStartLine,
          column: selectorStartCol,
        };
        rules.push(currentRule);
      }
      depth++;
    } else if (ch === '}') {
      if (currentRule && currentRule.declarations === '') {
        currentRule.declarations = declBuffer.trim();
      }
      declBuffer = '';
      depth--;
      currentRule = null;
      foundFirstNonWs = false;
    } else {
      if (!foundFirstNonWs && !/\s/.test(ch)) {
        selectorStartLine = lineNum;
        selectorStartCol = i - lineStartIdx + 1;
        foundFirstNonWs = true;
      }

      if (depth === 0 || (depth > 0 && currentRule === null)) {
        buffer += ch;
      } else {
        declBuffer += ch;
      }
    }
  }

  return rules;
}

/**
 * Split a multi-selector string (comma-separated) into individual selectors.
 * Handles commas inside parentheses (e.g., `:not(.a, .b)`).
 */
function splitSelectors(selector) {
  const parts = [];
  let parenDepth = 0;
  let current = '';
  for (const ch of selector) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    if (ch === ',' && parenDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Selector analysis
// ---------------------------------------------------------------------------

/**
 * Count the number of descendant levels in a selector.
 * Splits by combinators (space, >, +, ~) and counts the parts.
 */
function countDescendantDepth(selector) {
  const parts = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return parts.length;
}

/**
 * Basic CSS selector syntax validation.
 * Checks for empty selectors and unbalanced brackets/parentheses.
 */
function isValidSelectorSyntax(selector) {
  if (!selector || selector.trim() === '') return false;

  let bracketDepth = 0;
  let parenDepth = 0;
  for (const ch of selector) {
    if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    if (bracketDepth < 0 || parenDepth < 0) return false;
  }
  return bracketDepth === 0 && parenDepth === 0;
}

/**
 * Check a single selector for a specific warning type.
 * Returns a warning object or null if clean.
 */
function checkSelector(selector, type, line, column, opts) {
  switch (type) {
    case 'positional-selector':
      if (POSITIONAL_RE.test(selector)) {
        return {
          line,
          column,
          type,
          selector,
          message: 'Positional pseudo-class detected — fragile across re-renders',
        };
      }
      break;

    case 'deep-descendant': {
      const depth = countDescendantDepth(selector);
      if (depth > opts.maxDescendantDepth) {
        return {
          line,
          column,
          type,
          selector,
          message: `Deep descendant selector (${depth} levels, max ${opts.maxDescendantDepth})`,
        };
      }
      break;
    }

    case 'generated-class':
      if (
        GENERATED_CLASS_RE.test(selector) ||
        HASH_CLASS_RE.test(selector) ||
        EMOTION_CLASS_RE.test(selector)
      ) {
        return {
          line,
          column,
          type,
          selector,
          message: 'Generated/hashed class name detected — will break on rebuild',
        };
      }
      break;

    case 'overly-long':
      if (selector.length > opts.maxSelectorLength) {
        return {
          line,
          column,
          type,
          selector,
          message: `Selector too long (${selector.length} chars, max ${opts.maxSelectorLength})`,
        };
      }
      break;

    case 'invalid-syntax':
      if (!isValidSelectorSyntax(selector)) {
        return {
          line,
          column,
          type,
          selector,
          message: 'Invalid selector syntax',
        };
      }
      break;

    case 'universal-selector':
      if (UNIVERSAL_RE.test(selector)) {
        return {
          line,
          column,
          type,
          selector,
          message: 'Universal selector (*) — performance concern',
        };
      }
      break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main lint function
// ---------------------------------------------------------------------------

/**
 * Lint CSS text for problematic selectors.
 *
 * @param {string} cssText - The CSS source to analyze.
 * @param {object} [options] - Lint options.
 * @param {number} [options.maxDescendantDepth=3] - Max allowed descendant levels.
 * @param {number} [options.maxSelectorLength=120] - Max allowed selector length.
 * @param {number} [options.maxImportantPerRule=5] - Max allowed !important per rule.
 * @param {string[]|null} [options.enabledTypes=null] - Warning types to check (null = all).
 * @returns {{ warnings: Array, errorCount: number, warningCount: number }}
 */
export function lintCssSelectors(cssText, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const enabledTypes = opts.enabledTypes || WARNING_TYPES;
  const warnings = [];

  const rules = parseCss(cssText);

  for (const rule of rules) {
    const { selector, declarations, line, column } = rule;

    // Check important-overuse (per rule, not per selector).
    if (enabledTypes.includes('important-overuse')) {
      const importantCount = (declarations.match(/!important/g) || []).length;
      if (importantCount > opts.maxImportantPerRule) {
        warnings.push({
          line,
          column,
          type: 'important-overuse',
          selector,
          message: `Rule contains ${importantCount} !important declarations (max ${opts.maxImportantPerRule})`,
        });
      }
    }

    // Split multi-selector and check each part.
    const selectors = splitSelectors(selector);
    for (const sel of selectors) {
      if (!sel.trim()) continue;

      for (const type of enabledTypes) {
        if (type === 'important-overuse') continue; // already checked per-rule
        const warning = checkSelector(sel, type, line, column, opts);
        if (warning) warnings.push(warning);
      }
    }
  }

  const errorCount = warnings.filter((w) => w.type === 'invalid-syntax').length;
  const warningCount = warnings.length - errorCount;

  return { warnings, errorCount, warningCount };
}

// ---------------------------------------------------------------------------
// Theme package scanning
// ---------------------------------------------------------------------------

/**
 * Scan a theme package directory for CSS files and lint each one.
 *
 * @param {string} themeDir - Path to the theme directory.
 * @param {object} [options] - Lint options (same as lintCssSelectors).
 * @returns {Promise<{ themeDir: string, files: Array, totalWarnings: number, totalErrors: number }>}
 */
export async function scanThemePackage(themeDir, options = {}) {
  const cssDir = path.join(themeDir, 'assets', 'css');
  const result = {
    themeDir,
    files: [],
    totalWarnings: 0,
    totalErrors: 0,
  };

  let entries;
  try {
    entries = await fs.readdir(cssDir, { withFileTypes: true });
  } catch {
    return result; // no css dir
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.css')) continue;
    const filePath = path.join(cssDir, entry.name);
    let css;
    try {
      css = await fs.readFile(filePath, 'utf8');
    } catch (e) {
      result.files.push({
        file: filePath,
        relativePath: path.relative(process.cwd(), filePath),
        warnings: [],
        errorCount: 0,
        warningCount: 0,
        readError: e.message,
      });
      continue;
    }
    const lint = lintCssSelectors(css, options);
    result.files.push({
      file: filePath,
      relativePath: path.relative(process.cwd(), filePath),
      ...lint,
    });
    result.totalWarnings += lint.warningCount;
    result.totalErrors += lint.errorCount;
  }

  return result;
}

/**
 * Find all theme directories under a themes root.
 * A theme directory is one that contains an `assets/css` subdirectory.
 */
export async function findThemeDirs(themesDir) {
  const themeDirs = [];
  let entries;
  try {
    entries = await fs.readdir(themesDir, { withFileTypes: true });
  } catch {
    return themeDirs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const cssDir = path.join(themesDir, entry.name, 'assets', 'css');
    try {
      const stat = await fs.stat(cssDir);
      if (stat.isDirectory()) {
        themeDirs.push(path.join(themesDir, entry.name));
      }
    } catch {
      // no css dir — skip
    }
  }

  return themeDirs.sort();
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

/**
 * Format lint results as a human-readable report.
 */
export function formatReport(results, totalWarnings, totalErrors, totalFiles) {
  const lines = [];
  lines.push('Theme Selector Lint Report');
  lines.push('='.repeat(60));
  lines.push('');

  for (const result of results) {
    if (result.files.length === 0) continue;
    const themeName = path.basename(result.themeDir);
    lines.push(`Theme: ${themeName}`);

    for (const file of result.files) {
      if (file.readError) {
        lines.push(`  ${path.basename(file.relativePath)}: ERROR — ${file.readError}`);
        continue;
      }
      const status = file.warnings.length === 0 ? 'OK' : `${file.warnings.length} issue(s)`;
      lines.push(`  ${path.basename(file.relativePath)}: ${status}`);

      for (const w of file.warnings) {
        lines.push(`    ${w.line}:${w.column}  [${w.type}] ${w.message}`);
        lines.push(`      selector: "${truncate(w.selector, 80)}"`);
      }
    }
    lines.push('');
  }

  lines.push('-'.repeat(60));
  lines.push(`Total: ${totalFiles} files, ${totalWarnings} warnings, ${totalErrors} errors`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    themes: null,
    json: false,
    help: false,
    maxDepth: DEFAULT_OPTIONS.maxDescendantDepth,
    maxLength: DEFAULT_OPTIONS.maxSelectorLength,
    maxImportant: DEFAULT_OPTIONS.maxImportantPerRule,
    types: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--themes':
        args.themes = argv[++i];
        break;
      case '--max-depth':
        args.maxDepth = Number(argv[++i]);
        break;
      case '--max-length':
        args.maxLength = Number(argv[++i]);
        break;
      case '--max-important':
        args.maxImportant = Number(argv[++i]);
        break;
      case '--types':
        args.types = argv[++i].split(',').map((s) => s.trim());
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(2);
        }
        break;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Theme Selector Lint — static CSS selector analysis for theme packages

Usage:
  node scripts/theme-selector-lint.mjs [options]

Options:
  --themes <dir>       Themes directory (default: themes/)
  --json               Output machine-readable JSON
  --max-depth <n>      Max descendant depth (default: 3)
  --max-length <n>     Max selector length (default: 120)
  --max-important <n>  Max !important per rule (default: 5)
  --types <list>       Comma-separated warning types to check
  --help, -h           Show this help

Exit codes:
  0  no errors (warnings are non-blocking)
  1  errors found (invalid-syntax)
  2  unrecoverable error`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const themesDir = args.themes || path.resolve(process.cwd(), 'themes');
  const themeDirs = await findThemeDirs(themesDir);

  if (themeDirs.length === 0) {
    console.error(`No theme directories found in ${themesDir}`);
    process.exit(2);
  }

  const options = {
    maxDescendantDepth: args.maxDepth,
    maxSelectorLength: args.maxLength,
    maxImportantPerRule: args.maxImportant,
    enabledTypes: args.types,
  };

  let totalWarnings = 0;
  let totalErrors = 0;
  let totalFiles = 0;
  const results = [];

  for (const themeDir of themeDirs) {
    const result = await scanThemePackage(themeDir, options);
    results.push(result);
    totalWarnings += result.totalWarnings;
    totalErrors += result.totalErrors;
    totalFiles += result.files.length;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          results,
          totalWarnings,
          totalErrors,
          totalFiles,
          themeCount: results.length,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatReport(results, totalWarnings, totalErrors, totalFiles));
  }

  // Exit 1 if errors found (invalid-syntax), 0 if only warnings.
  process.exit(totalErrors > 0 ? 1 : 0);
}

// Only run main when executed directly (not when imported for testing).
import { pathToFileURL } from 'node:url';

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`Error: ${err.stack ?? err}`);
    process.exit(2);
  });
}
