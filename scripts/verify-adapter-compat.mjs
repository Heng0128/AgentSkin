// SPDX-License-Identifier: MPL-2.0
//
// # verify-adapter-compat.mjs — CI Adapter Compatibility Verification
//
// Scans all themes in the themes/ directory and verifies their compatibility
// with the 6 supported adapters (traework, qoderwork, workbuddy, doubao,
// codex, zcode). Inspired by dsh-suite's honest compatibility marking:
// each theme receives ok / broken / unknown based on automated checks.
//
// Checks performed:
//   1. palette.css exists and contains all 12 core --agentskin-* tokens
//   2. manifest.json is valid JSON with schemaVersion: 2
//   3. Each declared adapter in supportedAgents has a corresponding CSS file
//      in assets/css/
//   4. CSS files have valid syntax (bracket matching, no illegal characters)
//   5. Image resources (icon, preview, hero) referenced in manifest exist
//
// Usage:
//   node scripts/verify-adapter-compat.mjs
//   node scripts/verify-adapter-compat.mjs --report
//   node scripts/verify-adapter-compat.mjs themes/miku-future-beats
//
// Output:
//   stdout — JSON report
//   stderr — human-readable summary
//
// Exit codes:
//   0 — all themes pass (ok)
//   1 — warnings (some themes have minor issues)
//   2 — errors (broken themes detected)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const THEMES_DIR = join(PROJECT_ROOT, 'themes');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The 12 core tokens that palette.css must carry.
 * The remaining 2 (--agentskin-button-bg, --agentskin-input-bg) are
 * per-agent derived and only exist in adapter CSS files.
 */
export const PALETTE_TOKENS = [
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
];

/** All 14 canonical tokens (for reference and adapter CSS completeness checks). */
export const CANONICAL_TOKENS = [
  ...PALETTE_TOKENS,
  '--agentskin-button-bg',
  '--agentskin-input-bg',
];

/** Known adapter IDs. */
export const KNOWN_ADAPTERS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/**
 * Extract all --agentskin-* variable declarations from a CSS string.
 * @param {string} css
 * @returns {Set<string>} Set of declared variable names.
 */
export function extractPaletteTokens(css) {
  const found = new Set();
  const re = /(--agentskin-[\w-]+)\s*:/g;
  let m = re.exec(css);
  while (m !== null) {
    found.add(m[1].trim());
    m = re.exec(css);
  }
  return found;
}

// ---------------------------------------------------------------------------
// CSS syntax validation
// ---------------------------------------------------------------------------

/**
 * Check whether a CSS string has valid basic syntax:
 * - Balanced curly braces
 * - No null bytes (binary corruption)
 * - Properly closed comments and strings
 * @param {string} css
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCssSyntax(css) {
  // Check for null bytes (binary file mistaken for CSS)
  if (css.includes('\0')) {
    return { valid: false, error: 'contains null bytes (binary?)' };
  }

  // Check balanced curly braces, handling comments and strings properly
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let inComment = false;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    const next = css[i + 1];

    // Inside a CSS comment: look for closing */
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++; // skip the '/' as well
      }
      continue;
    }

    // Inside a string: look for closing quote
    if (inString) {
      if (ch === stringChar && css[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    // Not in string or comment: check for comment start, string start, or braces
    if (ch === '/' && next === '*') {
      inComment = true;
      i++; // skip the '*' as well
    } else if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) {
        return { valid: false, error: 'unmatched closing brace' };
      }
    }
  }

  if (inComment) {
    return { valid: false, error: 'unclosed comment' };
  }
  if (inString) {
    return { valid: false, error: 'unclosed string' };
  }
  if (depth !== 0) {
    return { valid: false, error: `unbalanced braces (depth: ${depth})` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

/**
 * Validate manifest.json structure.
 * @param {Record<string, any>} manifest
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateManifest(manifest) {
  const issues = [];

  // Check schemaVersion
  if (manifest.schemaVersion !== 2) {
    issues.push(`schemaVersion must be 2, got: ${manifest.schemaVersion}`);
  }

  // Check required fields
  const requiredFields = ['id', 'name', 'version'];
  for (const field of requiredFields) {
    if (!manifest[field]) {
      issues.push(`missing required field: ${field}`);
    }
  }

  // Check colors object exists
  if (!manifest.colors || typeof manifest.colors !== 'object') {
    issues.push('missing or invalid colors object');
  }

  // Check supportedAgents
  if (!Array.isArray(manifest.supportedAgents) || manifest.supportedAgents.length === 0) {
    issues.push('supportedAgents must be a non-empty array');
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Theme verification
// ---------------------------------------------------------------------------

/**
 * Verify a single theme directory for adapter compatibility.
 * @param {string} themePath - Path to the theme directory.
 * @returns {Record<string, any>} Verification result.
 */
export function verifyTheme(themePath) {
  const themeId = basename(themePath);
  const result = {
    themeId,
    status: 'ok',
    checks: {
      paletteComplete: false,
      manifestValid: false,
      adapterCssComplete: false,
      imagesExist: false,
    },
    issues: [],
  };

  // --- Check 1: manifest.json ---
  const manifestPath = join(themePath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    result.issues.push('manifest.json not found');
    result.status = 'broken';
    return result;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    result.issues.push(`manifest.json parse error: ${e.message}`);
    result.status = 'broken';
    return result;
  }

  const manifestResult = validateManifest(manifest);
  if (manifestResult.valid) {
    result.checks.manifestValid = true;
  } else {
    for (const issue of manifestResult.issues) {
      result.issues.push(`manifest: ${issue}`);
    }
    result.status = 'broken';
  }

  // --- Check 2: palette.css ---
  const palettePath = join(themePath, 'palette.css');
  if (!existsSync(palettePath)) {
    result.issues.push('palette.css not found');
    if (result.status !== 'broken') result.status = 'broken';
  } else {
    const paletteCss = readFileSync(palettePath, 'utf8');
    const declaredTokens = extractPaletteTokens(paletteCss);
    const missing = PALETTE_TOKENS.filter((t) => !declaredTokens.has(t));

    if (missing.length === 0) {
      result.checks.paletteComplete = true;
    } else {
      result.issues.push(`palette.css: missing ${missing.length} token(s): ${missing.join(', ')}`);
      if (result.status !== 'broken') result.status = 'broken';
    }
  }

  // --- Check 3: adapter CSS files ---
  const adapters = manifest.supportedAgents || [];
  const targets = manifest.targets || {};
  const cssDir = join(themePath, 'assets', 'css');
  let allAdapterCssOk = true;
  let allCssSyntaxOk = true;

  for (const adapter of adapters) {
    // Determine the CSS file path
    let cssRelativePath = `assets/css/${adapter}.css`;
    if (targets[adapter] && targets[adapter].css) {
      cssRelativePath = targets[adapter].css;
    }

    const cssPath = join(themePath, cssRelativePath);

    if (!existsSync(cssPath)) {
      result.issues.push(`adapter ${adapter}: CSS file not found: ${cssRelativePath}`);
      allAdapterCssOk = false;
      continue;
    }

    // Validate CSS syntax
    const css = readFileSync(cssPath, 'utf8');
    const syntaxResult = validateCssSyntax(css);
    if (!syntaxResult.valid) {
      result.issues.push(`adapter ${adapter}: CSS syntax error: ${syntaxResult.error}`);
      allCssSyntaxOk = false;
    }
  }

  // Also check that targets with CSS references point to existing files
  for (const [adapterId, target] of Object.entries(targets)) {
    if (!target.css) continue;
    const cssPath = join(themePath, target.css);
    if (!existsSync(cssPath)) {
      result.issues.push(`target ${adapterId}: referenced CSS not found: ${target.css}`);
      allAdapterCssOk = false;
    }
  }

  if (allAdapterCssOk && allCssSyntaxOk) {
    result.checks.adapterCssComplete = true;
  } else if (result.status !== 'broken') {
    result.status = 'broken';
  }

  // --- Check 4: image resources ---
  const imageFields = ['icon', 'preview', 'hero'];
  let allImagesExist = true;

  for (const field of imageFields) {
    const value = manifest[field];
    if (!value) continue; // field not declared, skip

    const imagePath = join(themePath, value);
    if (!existsSync(imagePath)) {
      result.issues.push(`image ${field}: referenced file not found: ${value}`);
      allImagesExist = false;
    }
  }

  if (allImagesExist) {
    result.checks.imagesExist = true;
  } else if (result.status !== 'broken') {
    // Image missing is a warning, not a hard error
    result.status = 'unknown';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Theme discovery
// ---------------------------------------------------------------------------

/**
 * Discover theme directories in the themes/ folder.
 * @returns {string[]} Array of theme directory paths.
 */
export function discoverThemes() {
  const themes = [];
  let entries;
  try {
    entries = readdirSync(THEMES_DIR, { withFileTypes: true });
  } catch {
    return themes;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const name = entry.name;
    // Skip hidden directories, spec files, and compiled theme packages
    if (name.startsWith('.') || name.endsWith('.agentskin-theme') || name === 'THEME_SPEC.md') {
      continue;
    }
    const themePath = join(THEMES_DIR, name);
    if (existsSync(join(themePath, 'manifest.json'))) {
      themes.push(themePath);
    }
  }

  return themes;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

/**
 * Format the verification report as human-readable text.
 * @param {Record<string, any>} report
 * @returns {string}
 */
function formatSummary(report) {
  const lines = [];
  lines.push('Adapter Compatibility Verification Report');
  lines.push('='.repeat(50));
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Total themes: ${report.totalThemes}`);
  lines.push(`OK: ${report.summary.ok}`);
  lines.push(`Unknown: ${report.summary.unknown}`);
  lines.push(`Broken: ${report.summary.broken}`);
  lines.push('');

  for (const result of report.results) {
    const icon =
      result.status === 'ok' ? '[PASS]' : result.status === 'broken' ? '[FAIL]' : '[WARN]';
    lines.push(`${icon} ${result.themeId} (${result.status})`);

    for (const issue of result.issues) {
      lines.push(`    ${issue}`);
    }
  }

  lines.push('');
  if (report.summary.broken > 0) {
    lines.push(`Result: FAIL (${report.summary.broken} broken theme(s))`);
  } else if (report.summary.unknown > 0) {
    lines.push(`Result: PASS with warnings (${report.summary.unknown} theme(s) with minor issues)`);
  } else {
    lines.push('Result: ALL OK');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const showReport = args.includes('--report');
  const themeArg = args.find((a) => !a.startsWith('--'));

  let themes;
  let singleMode = false;

  if (themeArg) {
    const themePath = resolve(themeArg);
    if (!existsSync(themePath)) {
      console.error(`Theme directory not found: ${themePath}`);
      process.exit(2);
    }
    themes = [themePath];
    singleMode = true;
  } else {
    themes = discoverThemes();
  }

  const report = {
    timestamp: new Date().toISOString(),
    totalThemes: 0,
    results: [],
    summary: {
      ok: 0,
      unknown: 0,
      broken: 0,
    },
  };

  for (const themePath of themes) {
    const result = verifyTheme(themePath);

    const entry = {
      themeId: result.themeId,
      status: result.status,
      checks: result.checks,
      issues: result.issues,
    };

    report.results.push(entry);
    report.totalThemes++;
    report.summary[result.status]++;
  }

  // Output
  console.log(JSON.stringify(report, null, 2));
  console.error(formatSummary(report));

  // Exit code
  if (report.summary.broken > 0) process.exit(2);
  if (report.summary.unknown > 0) process.exit(1);
  process.exit(0);
}

// Only run main() when executed directly (not when imported by tests).
// Use path comparison to handle Windows backslashes vs URL forward slashes.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
