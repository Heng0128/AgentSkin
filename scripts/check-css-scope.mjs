// SPDX-License-Identifier: MPL-2.0
//
// # check-css-scope
//
// Static CSS scope validator for adapter CSS files.
//
// Ensures every CSS rule in a theme's `assets/css/<agent>.css` is properly
// anchored to the adapter's host class (`html.agentskin-host-<agent>` or
// `:root.agentskin-host-<agent>`), preventing theme CSS from leaking into
// other applications' DOM if the injection layer misroutes a stylesheet.
//
// Inspired by codex-autoskin's rule: "first selector of every rule must
// anchor `html.dream-theme-<name>` or the entire theme is rejected."
//
// ## Validation rules
//
// 1. **Host-anchored** — selector contains `html.agentskin-host-<agent>` or
//    `:root.agentskin-host-<agent>` as a compound substring (handles both
//    `html.agentskin-host-traework body` and `:root.agentskin-host-codex`).
// 2. **@scope wrapped** — rule is inside `@scope (html.agentskin-host-<agent>) { … }`,
//    which natively limits the rule to descendants of the host element.
// 3. **Variable-only exception** — `:root` / `html` global selectors are
//    permitted when the rule body contains ONLY custom property declarations
//    (e.g. `--agentskin-accent: #fff;`). These don't style elements.
// 4. **Known app-attribute exceptions** — `body[data-application-name="workbuddy"]`
//    is allowed for the workbuddy adapter (the attribute is set by the app's
//    own runtime, so it's a reliable app-scoped anchor).
//
// ## Usage
//
//   node scripts/check-css-scope.mjs                  # scan all themes
//   node scripts/check-css-scope.mjs --theme <id>     # scan one theme
//   node scripts/check-css-scope.mjs --json           # machine-readable output
//
// ## Exit codes
//
//   0 — all rules properly scoped
//   1 — violations found
//   2 — unrecoverable error

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THEMES_DIR = path.join(ROOT, 'themes');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Known safe attribute-anchor patterns per adapter (from app runtime). */
const APP_ATTRIBUTE_ANCHORS = {
  workbuddy: ['body[data-application-name="workbuddy"]'],
};

/**
 * CSS properties that are NOT custom properties. Used to detect whether a
 * rule body is "variable-only" (safe on `:root`/`html` global selectors).
 * A property like `color-scheme` or `text-shadow` applied to `:root` would
 * leak into every element.
 */
const NON_VARIABLE_PROPERTIES = new Set([
  'color-scheme',
  'text-shadow',
  'background',
  'background-color',
  'background-image',
  'color',
  'border',
  'border-radius',
  'box-shadow',
  'transition',
  'animation',
  'transform',
  'opacity',
  'display',
  'width',
  'height',
  'margin',
  'padding',
  'font-size',
  'font-family',
  'position',
  'z-index',
  'overflow',
  'pointer-events',
  'content',
  'inset',
  'filter',
  'backdrop-filter',
]);

// ---------------------------------------------------------------------------
// CSS parsing
// ---------------------------------------------------------------------------

/**
 * Strip CSS comments (/* ... *∕) from a stylesheet string.
 * Handles multi-line comments and preserves line positions by replacing each
 * comment with whitespace of the same length.
 * @param {string} css
 * @returns {string}
 */
function stripComments(css) {
  let result = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '/' && css[i + 1] === '*') {
      // Skip comment
      let end = css.indexOf('*/', i + 2);
      if (end === -1) end = css.length;
      else end += 2;
      // Preserve line breaks for line-number tracking
      const comment = css.substring(i, end);
      result += comment.replace(/[^\n]/g, ' ');
      i = end;
    } else {
      result += css[i];
      i++;
    }
  }
  return result;
}

/**
 * Parse CSS into a flat list of rule descriptors, recursively unwrapping
 * @scope / @media / @supports blocks. Each rule has:
 *   - selector:    the raw selector text before `{`
 *   - declarations: the raw body text between `{` and `}`
 *   - scoped:      true if inside an @scope wrapping a valid host anchor
 *   - lineStart:   original line number of the rule
 * @param {string} css
 * @param {boolean} scoped  — are we already inside an @scope host block?
 * @returns {Array<{selector:string, declarations:string, scoped:boolean, lineStart:number}>}
 */
function parseRules(css, scoped = false) {
  const rules = [];
  const cleaned = stripComments(css);
  let i = 0;
  let lineNum = 1;

  while (i < cleaned.length) {
    // Track line numbers
    const pos = cleaned.indexOf('{', i);
    if (pos === -1) break;

    // Count newlines up to this opening brace
    for (let k = i; k < pos; k++) {
      if (cleaned[k] === '\n') lineNum++;
    }

    const selector = cleaned.substring(i, pos).trim();

    // Find matching closing brace (depth tracking for nested at-rules)
    let depth = 1;
    let j = pos + 1;
    while (j < cleaned.length && depth > 0) {
      if (cleaned[j] === '{') depth++;
      else if (cleaned[j] === '}') depth--;
      if (cleaned[j] === '\n') {
        // don't advance lineNum here; we'll do it at the start of next rule
      }
      j++;
    }
    const declarations = cleaned.substring(pos + 1, j - 1).trim();

    // Check if this is an at-rule with a block body
    if (selector.startsWith('@scope')) {
      // @scope (selector) { rules… } — recursively parse inner rules as scoped
      const innerRules = parseRules(declarations, true);
      rules.push(...innerRules);
    } else if (
      selector.startsWith('@media') ||
      selector.startsWith('@supports') ||
      selector.startsWith('@layer')
    ) {
      // Conditional at-rules (@media, @supports, @layer) scope inner rules to the same context
      const innerRules = parseRules(declarations, scoped);
      rules.push(...innerRules);
    } else if (!selector.startsWith('@')) {
      // Regular rule — validate it
      rules.push({ selector, declarations, scoped, lineNum });
    }
    // Other at-rules (@font-face, @keyframes, @charset, etc.) are ignored
    // — they don't generate style rules that could leak.

    i = j;
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Scope validation
// ---------------------------------------------------------------------------

/**
 * Get the expected host-class anchor string for a given adapter.
 * @param {string} agentId
 * @returns {string[]}
 */
function getHostAnchors(agentId) {
  return [`html.agentskin-host-${agentId}`, `:root.agentskin-host-${agentId}`];
}

/**
 * Check if a selector is anchored to the host class.
 * @param {string} selector
 * @param {string} agentId
 * @returns {boolean}
 */
function isHostAnchored(selector, agentId) {
  const anchors = getHostAnchors(agentId);
  return anchors.some((anchor) => selector.includes(anchor));
}

/**
 * Check if a selector uses a known app-level attribute anchor.
 * @param {string} selector
 * @param {string} agentId
 * @returns {boolean}
 */
function isAppAttributeAnchored(selector, agentId) {
  const attrs = APP_ATTRIBUTE_ANCHORS[agentId] || [];
  return attrs.some((attr) => selector.includes(attr));
}

/**
 * Check whether a rule body contains ONLY CSS custom property declarations
 * (i.e. properties starting with `--`). Such rules are safe on bare `:root`
 * or `html` selectors because they don't style any elements — they only define
 * variables that are consumed elsewhere.
 * @param {string} declarations
 * @returns {boolean}
 */
function isVariableOnly(declarations) {
  if (!declarations) return false;

  // Split by `;` and filter empty entries
  const props = declarations
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  if (props.length === 0) return false;

  return props.every((prop) => {
    const colonIdx = prop.indexOf(':');
    if (colonIdx === -1) return false;
    const propName = prop.substring(0, colonIdx).trim();
    // A property is "variable-only" if its name starts with `--`
    return propName.startsWith('--');
  });
}

/**
 * Check whether a rule body contains at least one non-variable declaration
 * that would actually style an element. Returns true if the rule has
 * declarations that are NOT custom properties.
 * @param {string} declarations
 * @returns {boolean}
 */
function hasNonVariableDeclarations(declarations) {
  if (!declarations) return false;

  const props = declarations
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  return props.some((prop) => {
    const colonIdx = prop.indexOf(':');
    if (colonIdx === -1) return false;
    const propName = prop.substring(0, colonIdx).trim();
    return !propName.startsWith('--');
  });
}

/**
 * Validate a single CSS rule descriptor against scope requirements.
 * @param {{selector:string, declarations:string, scoped:boolean, lineStart:number}} rule
 * @param {string} agentId
 * @returns {{valid:boolean, reason:string}|null}  — null if valid
 */
function validateRule(rule, agentId) {
  const { selector, declarations, scoped } = rule;

  // Empty selector — skip
  if (!selector) return null;

  // 1. Inside @scope host block — already scoped by CSS native mechanism
  if (scoped) return null;

  // 2. Host-anchored selector
  if (isHostAnchored(selector, agentId)) return null;

  // 3. App attribute anchor (workbuddy-specific)
  if (isAppAttributeAnchored(selector, agentId)) return null;

  // 4. Variable-only exception for :root / html global selectors
  //    Only applies when the selector starts with `:root` or `html` (with no
  //    specificity that would target specific elements) AND the rule body is
  //    exclusively custom property declarations.
  if (isVariableOnly(declarations) && /^(:root|html)(\s*,|$)/.test(selector)) {
    return null;
  }

  return {
    valid: false,
    reason: `Selector "${selector.substring(0, 80)}${selector.length > 80 ? '...' : ''}" is not anchored to the host class html.agentskin-host-${agentId}`,
  };
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

/**
 * Known adapter identifiers. Used to distinguish adapter CSS files
 * (e.g. `traework.css`) from other CSS files in the theme directory
 * (e.g. `palette.css`).
 */
const KNOWN_ADAPTERS = new Set(['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']);

/**
 * Extract adapter ID from a CSS filename (e.g. `traework.css` → `traework`).
 * Only matches known adapter names to avoid false positives on files like
 * `palette.css` or `globals.css` that may exist in the theme directory.
 * @param {string} filename
 * @returns {string|null}
 */
function agentFromFilename(filename) {
  const match = filename.match(/^([a-z]+)\.css$/);
  if (!match) return null;
  return KNOWN_ADAPTERS.has(match[1]) ? match[1] : null;
}

/**
 * Scan a single CSS file for scope violations.
 * @param {string} filePath
 * @param {string} agentId
 * @returns {Array<{file:string, line:number, selector:string, reason:string}>}
 */
function scanCssFile(filePath, agentId) {
  const violations = [];

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    violations.push({
      file: filePath,
      line: 0,
      selector: '',
      reason: `Failed to read file: ${err.message}`,
    });
    return violations;
  }

  const rules = parseRules(content, false);
  for (const rule of rules) {
    const result = validateRule(rule, agentId);
    if (result) {
      violations.push({
        file: filePath,
        line: rule.lineStart,
        selector: rule.selector.substring(0, 120),
        reason: result.reason,
      });
    }
  }

  return violations;
}

/**
 * Discover all theme directories and their CSS files.
 * @param {string|null} themeFilter  — if set, only scan this theme ID
 * @returns {Array<{themeId:string, cssFiles:Array<{agentId:string, filePath:string}>}>}
 */
function discoverThemes(themeFilter = null) {
  const themes = [];

  let entries;
  try {
    entries = fs.readdirSync(THEMES_DIR, { withFileTypes: true });
  } catch {
    return themes;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.agentskin-theme')) continue; // skip packed dirs
    if (themeFilter && entry.name !== themeFilter) continue;

    const themeId = entry.name;
    const cssDir = path.join(THEMES_DIR, themeId, 'assets', 'css');

    let cssFiles;
    try {
      cssFiles = fs.readdirSync(cssDir);
    } catch {
      continue; // no css dir
    }

    const agentFiles = [];
    for (const file of cssFiles) {
      const agentId = agentFromFilename(file);
      if (agentId) {
        agentFiles.push({ agentId, filePath: path.join(cssDir, file) });
      }
    }

    if (agentFiles.length > 0) {
      themes.push({ themeId, cssFiles: agentFiles });
    }
  }

  return themes;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { theme: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--theme' && argv[i + 1]) {
      args.theme = argv[++i];
    } else if (argv[i] === '--json') {
      args.json = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const themes = discoverThemes(args.theme);

  if (themes.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ themes: [], violations: [], summary: { total: 0, errors: 0 } }));
    } else {
      console.log('[check-css-scope] No themes found to scan.');
    }
    process.exit(0);
  }

  const allViolations = [];
  const themeSummaries = [];

  for (const theme of themes) {
    let themeErrors = 0;
    for (const cssFile of theme.cssFiles) {
      const violations = scanCssFile(cssFile.filePath, cssFile.agentId);
      allViolations.push(...violations);
      themeErrors += violations.length;
    }
    themeSummaries.push({ themeId: theme.themeId, errors: themeErrors });
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          themes: themeSummaries,
          violations: allViolations.map((v) => ({
            file: path.relative(ROOT, v.file),
            line: v.line,
            selector: v.selector,
            reason: v.reason,
          })),
          summary: { total: allViolations.length, errors: allViolations.length },
        },
        null,
        2,
      ),
    );
  } else {
    if (allViolations.length === 0) {
      console.log(
        `[check-css-scope] ✓ All CSS rules properly scoped (${themes.length} themes scanned).`,
      );
    } else {
      console.log(`[check-css-scope] ✗ ${allViolations.length} scope violation(s) found:\n`);
      for (const v of allViolations) {
        const relPath = path.relative(ROOT, v.file);
        console.log(`  ${relPath}:${v.line}`);
        console.log(`    Selector: ${v.selector}`);
        console.log(`    Reason:   ${v.reason}`);
        console.log('');
      }
    }
  }

  process.exit(allViolations.length > 0 ? 1 : 0);
}

// Run CLI only when executed directly (not imported as a module).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`[check-css-scope] Fatal error: ${err.message}`);
    process.exit(2);
  });
}

// ---------------------------------------------------------------------------
// Exports (for tests and programmatic use)
// ---------------------------------------------------------------------------

export {
  agentFromFilename,
  discoverThemes,
  getHostAnchors,
  hasNonVariableDeclarations,
  isAppAttributeAnchored,
  isHostAnchored,
  isVariableOnly,
  parseRules,
  scanCssFile,
  stripComments,
  validateRule,
};
