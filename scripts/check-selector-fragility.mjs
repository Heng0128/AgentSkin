// SPDX-License-Identifier: MPL-2.0

/**
 * # check-selector-fragility
 *
 * B3 — Selector fragility linter for themes/ and engines/ CSS.
 *
 * Inspired by CodeDrobe's `theme inspect` selector lint, this check scans all CSS
 * files in the project and reports selectors that are fragile — likely to break
 * when the target application updates its DOM structure.
 *
 * Fragility patterns detected (warn-only, does NOT block CI):
 *   1. Positional selectors: nth-child, nth-of-type, first-child, last-child
 *      → break when items are reordered
 *   2. Deep direct-child chains: .a > .b > .c > .d (> 3 levels)
 *      → break when intermediate wrappers are added/removed
 *   3. Generated class names: CSS Modules / hashed class patterns
 *      (e.g. ._abc123, .css-1a2b3c, .styles_xxx)
 *      → break on every build
 *   4. Overly long selectors: > 5 compound parts
 *      → indicate structural coupling
 *   5. Locale-dependent attribute selectors: [data-testid], [aria-label="..."],
 *      [class*="..."]
 *      → break on localization or class rename
 *
 * Outputs warnings to stderr (matching the contrast warning pattern in check-themes).
 *
 * Exit code:
 *   0 — no blocking errors (warnings are non-blocking)
 *   1 — critical error (file not readable, etc.)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');
const ENGINES_DIR = path.resolve(process.cwd(), 'engines');
const _SRC_DIR = path.resolve(process.cwd(), 'src');

// ---------------------------------------------------------------------------
// Fragility pattern matchers
// ---------------------------------------------------------------------------

/** Match positional pseudo-class selectors (nth-child, nth-of-type, first-child, last-child). */
const POSITIONAL_RE =
  /:(nth-child|nth-of-type|nth-last-child|nth-last-of-type|first-child|last-child|first-of-type|last-of-type)\s*\(/i;

/** Match deep direct-child chains (> 3 levels of `>` combinators). */
const DEEP_CHAIN_RE = /(?:[.#][\w-]+\s*>\s*){3,}[.#][\w-]+/;

/** Match likely generated/hashed class names (CSS Modules, styled-components, emotion).
 *  Excludes BEM-style double-underscore modifiers which are intentional naming. */
const GENERATED_CLASS_RE = /\.(?:css-|styles_|style_)[0-9a-z]{4,}(?:\s|$|[,:{])/i;

/** Match locale-dependent attribute selectors (data-testid, aria-label with localized strings). */
const LOCALE_ATTR_RE = /\[data-testid\s*=|\[aria-label\s*=\s*["'][^"']{3,}["']|\[class\*=/i;

/** Match overly long selectors (compound parts separator by descendant or sibling combinators). */
function isOverlyLong(selector) {
  // Trim trailing pseudo-elements/classes that aren't structural
  const cleaned = selector.replace(/::?[a-z-]+(\([^)]*\))?$/i, '').trim();
  const parts = cleaned.split(/\s+[>+~]\s+|[>+~\s]+/).filter(Boolean);
  return parts.length > 5;
}

/**
 * Heuristic: is this string a plausible CSS selector vs a CSS value / custom property name?
 * Filters out false positives such as custom property names or raw values.
 */
function isPlausibleSelector(sel) {
  // Must start with a selector-valid character: . # [ : :: * or a letter/html tag
  if (!/^[.#[:*a-zA-Z]/.test(sel)) return false;
  // Must not be a custom property name (starts with --)
  if (sel.startsWith('--')) return false;
  // Must not look like a CSS value keyword or function call
  if (
    /^(var|calc|attr|min|max|clamp|rgb|rgba|hsl|hsla|url|linear-gradient|radial-gradient)\s*\(/i.test(
      sel,
    )
  )
    return false;
  return true;
}

// ---------------------------------------------------------------------------
// CSS selector extraction
// ---------------------------------------------------------------------------

/**
 * Strip CSS comments from a source string, preserving line numbers.
 * Returns the cleaned source with comments replaced by spaces.
 */
function stripComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      // Skip until */
      i += 2;
      while (i < css.length && !(css[i] === '*' && css[i + 1] === '/')) {
        if (css[i] === '\n') out += '\n';
        else out += ' ';
        i++;
      }
      i += 2; // skip */
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}

/**
 * Extract selectors from a CSS string (naive parser — strips block bodies
 * and comments first). Returns array of { selector, line } objects.
 * Multi-selectors (comma-separated) are split and analyzed independently.
 */
function extractSelectors(rawCss) {
  const selectors = [];
  const css = stripComments(rawCss);
  let depth = 0;
  let buffer = '';
  let lineNum = 1;
  let selectorStartLine = 1;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\n') lineNum++;

    if (ch === '{') {
      if (depth === 0) {
        const sel = buffer.trim();
        if (sel.length > 0 && !sel.startsWith('@')) {
          // Split multi-selectors and add each part
          const parts = sel
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const part of parts) {
            selectors.push({ selector: part, line: selectorStartLine });
          }
        }
        buffer = '';
        selectorStartLine = lineNum + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        selectorStartLine = lineNum + 1;
      }
    } else if (depth === 0) {
      buffer += ch;
    }
  }

  return selectors;
}

// ---------------------------------------------------------------------------
// Fragility analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single selector string for fragility issues.
 * Returns array of fragility warning strings (empty if clean).
 */
function analyzeSelector(selector) {
  const issues = [];

  if (POSITIONAL_RE.test(selector)) {
    issues.push('positional pseudo-class (breaks on reorder)');
  }

  if (DEEP_CHAIN_RE.test(selector)) {
    issues.push('deep >3 child chain (breaks on wrapper change)');
  }

  if (GENERATED_CLASS_RE.test(selector)) {
    issues.push('generated/hashed class name (breaks on rebuild)');
  }

  if (LOCALE_ATTR_RE.test(selector)) {
    issues.push('locale-dependent attribute selector (breaks on i18n)');
  }

  if (isOverlyLong(selector)) {
    issues.push('overly long selector (>5 parts, structural coupling)');
  }

  return issues;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

async function scanCssFile(filePath, warnings) {
  let css;
  try {
    css = await fs.readFile(filePath, 'utf8');
  } catch (e) {
    warnings.push(`${filePath}: cannot read (${e.message})`);
    return;
  }

  const selectors = extractSelectors(css);
  const relPath = path.relative(process.cwd(), filePath);

  for (const { selector, line } of selectors) {
    if (!isPlausibleSelector(selector)) continue;
    const issues = analyzeSelector(selector);
    if (issues.length > 0) {
      // Truncate overly long selectors for display
      const displaySel = selector.length > 60 ? `${selector.slice(0, 57)}...` : selector;
      warnings.push(
        `  ⚠ ${relPath}:${line} — ${issues.length} fragility issue(s): ${issues.join(', ')}\n    selector: "${displaySel}"`,
      );
    }
  }
}

async function scanDirectory(dirPath, pattern, warnings) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    // Directory doesn't exist — skip
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(fullPath, pattern, warnings);
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      await scanCssFile(fullPath, warnings);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const warnings = [];
  let filesChecked = 0;

  // 1. Scan themes CSS
  try {
    const themeDirs = await fs.readdir(THEMES_DIR, { withFileTypes: true });
    for (const entry of themeDirs) {
      if (!entry.isDirectory() || entry.name === '_shared') continue;
      const cssDir = path.join(THEMES_DIR, entry.name, 'assets', 'css');
      try {
        const cssFiles = await fs.readdir(cssDir, { withFileTypes: true });
        for (const f of cssFiles) {
          if (f.isFile() && f.name.endsWith('.css')) {
            await scanCssFile(path.join(cssDir, f.name), warnings);
            filesChecked++;
          }
        }
      } catch {
        // no css dir
      }
    }
  } catch (e) {
    console.error(`check-selector-fragility: cannot read themes dir: ${e.message}`);
    process.exit(1);
  }

  // 2. Scan engines CSS
  try {
    const engineDirs = await fs.readdir(ENGINES_DIR, { withFileTypes: true });
    for (const entry of engineDirs) {
      if (!entry.isDirectory()) continue;
      await scanDirectory(path.join(ENGINES_DIR, entry.name), '*.css', warnings);
    }
  } catch {
    // no engines dir
  }

  // 3. Scan src UI CSS
  const srcCssDirs = ['src/ui/styles', 'src/ui/components'];
  for (const d of srcCssDirs) {
    try {
      await scanDirectory(path.resolve(process.cwd(), d), '*.css', warnings);
    } catch {
      // dir doesn't exist
    }
  }

  // Count engines/src CSS files via lightweight directory walk
  // (scanDirectory already scanned content; this only counts unscanned files)
  try {
    const countFiles = async (dir) => {
      let count = 0;
      try {
        const walk = async (p) => {
          const entries = await fs.readdir(p, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory()) await walk(path.join(p, e.name));
            else if (e.isFile() && e.name.endsWith('.css')) count++;
          }
        };
        await walk(dir);
      } catch {}
      return count;
    };
    filesChecked += await countFiles(ENGINES_DIR);
    for (const d of srcCssDirs) {
      filesChecked += await countFiles(path.resolve(process.cwd(), d));
    }
  } catch {}

  // Output results
  if (warnings.length === 0) {
    console.log(
      `check-selector-fragility: ${filesChecked} CSS files scanned, no fragility warnings.`,
    );
  } else {
    console.log(
      `check-selector-fragility: ${filesChecked} CSS files scanned, ${warnings.length} fragility warning(s):\n`,
    );
    for (const w of warnings) {
      console.log(w);
    }
    console.log(
      `\n  (warnings are non-blocking — fix fragility to improve resilience against target app updates)`,
    );
  }

  // Warnings are non-blocking (exit 0). Critical errors exit 1.
  process.exit(0);
}

await main();
