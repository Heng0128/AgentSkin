// SPDX-License-Identifier: MPL-2.0
//
// # verify-theme-integrity.mjs — Theme package integrity verifier
//
// Verifies a theme package is internally consistent and matches AgentSkin's
// 14-token contract BEFORE injection. Addresses the CodeDrobe analysis insight
// that themes should be verifiable before they reach the runtime.
//
// Checks performed:
//   1. manifest.json exists with required fields (id, name, version, colors)
//   2. All 14 canonical --agentskin-* tokens declared in each agent CSS
//   3. CSS files exist for each supported agent in assets/css/
//   4. CSS variable names are correct (typo detection)
//   5. WCAG AA contrast: background/foreground >= 4.5:1
//   6. WCAG AA contrast: accent/background >= 3:1 (large text / UI components)
//   7. Image assets referenced in manifest exist on disk
//   8. No orphaned CSS files (CSS for agents not in supportedAgents)
//
// Usage:
//   node scripts/verify-theme-integrity.mjs themes/miku-future-beats
//
// Output:
//   stdout — JSON report
//   stderr — human-readable summary
//
// Exit codes:
//   0 — all checks pass
//   1 — warnings only (WCAG AA pass but AAA fail, deprecated keys used)
//   2 — errors (missing files, WCAG fail, missing tokens)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical 14 --agentskin-* tokens (aligned with theme-tokens.mjs REQUIRED_TOKENS). */
const CANONICAL_TOKENS = [
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-bg',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-input-bg',
  '--agentskin-button-bg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
];

/** Deprecated/alternative token names that should trigger warnings. */
const DEPRECATED_TOKENS = [
  '--agentskin-primary',
  '--agentskin-foreground',
  '--agentskin-shadow',
  '--agentskin-overlay',
  '--agentskin-danger',
  '--agentskin-warning',
  '--agentskin-success',
  '--agentskin-info',
];

/** Common typos for --agentskin-* variables (for fuzzy detection). */
const COMMON_TYPOS = {
  '--agentskin-accent': [
    '--agentskin-accentt',
    '--agentskin-accnet',
    '--agentskin-accent-',
    '--agentskin-accetn',
  ],
  '--agentskin-secondary': ['--agentskin-seconday', '--agentskin-secondry'],
  '--agentskin-bg': ['--agentskin-background', '--agentskin-bag', '--agentskin-bd'],
  '--agentskin-text': ['--agentskin-tex', '--agentskin-txt', '--agentskin-ext'],
  '--agentskin-muted': ['--agentskin-mute', '--agentskin-mutd', '--agentskin-muetd'],
  '--agentskin-surface': ['--agentskin-surfac', '--agentskin-surafce'],
  '--agentskin-surface-elevated': ['--agentskin-surface-elevate', '--agentskin-surfaceelevated'],
  '--agentskin-border': ['--agentskin-bordr', '--agentskin-boder'],
  '--agentskin-code-bg': ['--agentskin-codebg', '--agentskin-code-background'],
  '--agentskin-code-fg': ['--agentskin-codefg', '--agentskin-code-foreground'],
  '--agentskin-input-bg': ['--agentskin-inputbg', '--agentskin-input-background'],
  '--agentskin-button-bg': ['--agentskin-buttonbg', '--agentskin-button-background'],
  '--agentskin-focus-ring': ['--agentskin-focusring', '--agentskin-focus-ring-'],
  '--agentskin-selection': ['--agentskin-select', '--agentskin-selecton'],
};

/** All known agent IDs. */
const KNOWN_AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

/** WCAG AA threshold for normal text. */
const WCAG_AA_NORMAL = 4.5;

/** WCAG AA threshold for large text / UI components. */
const WCAG_AA_LARGE = 3.0;

/** WCAG AAA threshold for normal text. */
const WCAG_AAA_NORMAL = 7.0;

// ---------------------------------------------------------------------------
// Color parsing (zero-dependency)
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string to [r, g, b] (0–255).
 * Supports #rgb, #rrggbb, #rrggbbaa (alpha stripped).
 * @param {string} hex
 * @returns {[number, number, number] | null}
 */
function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  else if (h.length === 8) h = h.slice(0, 6);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Parse an rgb()/rgba() string to [r, g, b, a].
 * @param {string} str
 * @returns {[number, number, number, number] | null}
 */
function parseRgb(str) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(str.trim());
  if (!m) return null;
  return [+m[1], +m[2], +m[3], m[4] !== undefined ? +m[4] : 1];
}

/**
 * Parse an hsl()/hsla() string to [r, g, b, a].
 * @param {string} str
 * @returns {[number, number, number, number] | null}
 */
function parseHsl(str) {
  const m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    str.trim(),
  );
  if (!m) return null;
  const h = +m[1] / 360;
  const s = +m[2] / 100;
  const l = +m[3] / 100;
  const a = m[4] !== undefined ? +m[4] : 1;

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a];
}

/**
 * Parse any supported color string to [r, g, b, a].
 * @param {string} str
 * @returns {[number, number, number, number] | null}
 */
function parseColor(str) {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (trimmed.startsWith('#')) return parseHex(trimmed)?.map((v, i) => (i < 3 ? v : 1));
  if (trimmed.startsWith('rgb')) return parseRgb(trimmed);
  if (trimmed.startsWith('hsl')) return parseHsl(trimmed);
  return null;
}

/**
 * Compute relative luminance per WCAG 2.1.
 * @param {[number, number, number]} rgb - [r, g, b] in 0–255.
 * @returns {number} Relative luminance (0–1).
 */
function relativeLuminance([r, g, b]) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Compute WCAG 2.1 contrast ratio between two colors.
 * @param {string} color1 - First color string.
 * @param {string} color2 - Second color string.
 * @returns {number | null} Contrast ratio (1–21), or null if unparseable.
 */
function contrastRatio(color1, color2) {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);
  if (!c1 || !c2) return null;
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Manifest color → CSS variable mapping
// ---------------------------------------------------------------------------

/**
 * Map manifest.json camelCase color keys to their CSS variable names.
 * The manifest uses camelCase (background, codeBackground) while CSS uses
 * kebab-case (--agentskin-bg, --agentskin-code-bg).
 */
const _MANIFEST_KEY_TO_CSS_VAR = {
  accent: '--agentskin-accent',
  secondary: '--agentskin-secondary',
  background: '--agentskin-bg',
  foreground: '--agentskin-text',
  muted: '--agentskin-muted',
  surface: '--agentskin-surface',
  surfaceElevated: '--agentskin-surface-elevated',
  border: '--agentskin-border',
  codeBackground: '--agentskin-code-bg',
  codeForeground: '--agentskin-code-fg',
  inputBackground: '--agentskin-input-bg',
  buttonBackground: '--agentskin-button-bg',
  buttonForeground: '--agentskin-button-fg',
  focusRing: '--agentskin-focus-ring',
  selection: '--agentskin-selection',
};

// ---------------------------------------------------------------------------
// CSS variable extraction
// ---------------------------------------------------------------------------

/**
 * Extract all --agentskin-* variable declarations from a CSS string.
 * Returns a map of variable name → declared value.
 * @param {string} css
 * @returns {Record<string, string>}
 */
function extractCssVariables(css) {
  const vars = {};
  const re = /(--agentskin-[\w-]+)\s*:\s*([^;]+);/g;
  let m = re.exec(css);
  while (m !== null) {
    vars[m[1].trim()] = m[2].trim();
    m = re.exec(css);
  }
  return vars;
}

/**
 * Resolve a CSS variable value to a concrete color.
 * Handles var() references by looking them up in the provided context.
 * Returns null for unresolvable values (color-mix, complex expressions).
 * @param {string} value
 * @param {Record<string, string>} context - Already-resolved variables.
 * @returns {string | null}
 */
function _resolveColorValue(value, context) {
  const trimmed = value.trim();

  // Direct color
  if (parseColor(trimmed)) return trimmed;

  // var() reference
  const varMatch = /^var\((--agentskin-[\w-]+)\)$/.exec(trimmed);
  if (varMatch) {
    const ref = varMatch[1];
    if (context[ref]) return _resolveColorValue(context[ref], context);
    return null;
  }

  // color-mix with transparent — approximate by extracting the base color
  const colorMixMatch =
    /^color-mix\(in\s+\w+,\s*(#[0-9a-f]+|rgba?\([^)]+)\s+\d+%,\s*transparent\)$/i.exec(trimmed);
  if (colorMixMatch) {
    const baseColor = colorMixMatch[1];
    if (parseColor(baseColor)) return baseColor;
  }

  // rgba() with var() inside — can't resolve without computed values
  if (trimmed.includes('var(')) return null;

  return null;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Create a fresh report object.
 * @param {string} themePath
 * @returns {Record<string, any>}
 */
function createReport(themePath) {
  return {
    theme: basename(themePath),
    path: themePath,
    timestamp: new Date().toISOString(),
    checks: {
      manifest: { status: 'pending', errors: [], warnings: [] },
      tokens: { status: 'pending', errors: [], warnings: [], details: {} },
      cssFiles: { status: 'pending', errors: [], warnings: [], details: {} },
      variableNames: { status: 'pending', errors: [], warnings: [], details: {} },
      contrast: { status: 'pending', errors: [], warnings: [], details: {} },
      assets: { status: 'pending', errors: [], warnings: [] },
      orphanedCss: { status: 'pending', errors: [], warnings: [] },
    },
    summary: {
      errors: 0,
      warnings: 0,
      passes: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

/**
 * Check 1: manifest.json exists and has required fields.
 * @param {string} themePath
 * @param {Record<string, any>} report
 * @returns {Record<string, any> | null} Parsed manifest or null on failure.
 */
function checkManifest(themePath, report) {
  const manifestPath = join(themePath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    report.checks.manifest.errors.push('manifest.json not found');
    report.checks.manifest.status = 'error';
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    report.checks.manifest.errors.push(`manifest.json parse error: ${e.message}`);
    report.checks.manifest.status = 'error';
    return null;
  }

  const errors = [];
  const warnings = [];

  // Required fields
  if (!manifest.id) errors.push('missing required field: id');
  if (!manifest.name) errors.push('missing required field: name');
  if (!manifest.version) errors.push('missing required field: version');
  if (!manifest.colors || typeof manifest.colors !== 'object') {
    errors.push('missing required field: colors');
  } else {
    if (!manifest.colors.background) errors.push('missing required color: background');
    if (!manifest.colors.foreground) errors.push('missing required color: foreground');
  }

  // ID matches directory name
  if (manifest.id && basename(themePath) !== manifest.id) {
    warnings.push(
      `manifest.id "${manifest.id}" does not match directory name "${basename(themePath)}"`,
    );
  }

  // Deprecated color keys in manifest
  const deprecatedManifestKeys = [
    'primary',
    'text',
    'shadow',
    'overlay',
    'danger',
    'warning',
    'success',
    'info',
  ];
  if (manifest.colors) {
    for (const key of Object.keys(manifest.colors)) {
      if (deprecatedManifestKeys.includes(key)) {
        warnings.push(`deprecated color key in manifest: ${key}`);
      }
    }
  }

  report.checks.manifest.errors = errors;
  report.checks.manifest.warnings = warnings;
  report.checks.manifest.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';

  return errors.length > 0 ? null : manifest;
}

/**
 * Check 2: All 14 canonical tokens present in each agent CSS.
 * @param {string} themePath
 * @param {Record<string, any>} manifest
 * @param {Record<string, any>} report
 */
function checkTokens(themePath, manifest, report) {
  const agents = manifest.supportedAgents || Object.keys(manifest.targets || {});
  const cssDir = join(themePath, 'assets', 'css');

  if (!existsSync(cssDir)) {
    report.checks.tokens.errors.push('assets/css/ directory not found');
    report.checks.tokens.status = 'error';
    return;
  }

  const errors = [];
  const warnings = [];
  const details = {};

  for (const agent of agents) {
    const cssPath = join(cssDir, `${agent}.css`);
    if (!existsSync(cssPath)) {
      details[agent] = { status: 'missing', missingTokens: CANONICAL_TOKENS.slice() };
      errors.push(`${agent}: CSS file not found`);
      continue;
    }

    const css = readFileSync(cssPath, 'utf8');
    const declaredVars = extractCssVariables(css);
    const declaredSet = new Set(Object.keys(declaredVars));

    const missing = CANONICAL_TOKENS.filter((t) => !declaredSet.has(t));
    const present = CANONICAL_TOKENS.filter((t) => declaredSet.has(t));

    // Check for deprecated tokens
    const deprecated = DEPRECATED_TOKENS.filter((t) => declaredSet.has(t));

    details[agent] = {
      status: missing.length === 0 ? 'pass' : 'error',
      present,
      missing,
      deprecated,
    };

    if (missing.length > 0) {
      errors.push(`${agent}: missing ${missing.length} token(s): ${missing.join(', ')}`);
    }
    for (const dep of deprecated) {
      warnings.push(`${agent}: uses deprecated token ${dep}`);
    }
  }

  report.checks.tokens.details = details;
  report.checks.tokens.errors = errors;
  report.checks.tokens.warnings = warnings;
  report.checks.tokens.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';
}

/**
 * Check 3: CSS files exist for each supported agent.
 * @param {string} themePath
 * @param {Record<string, any>} manifest
 * @param {Record<string, any>} report
 */
function checkCssFiles(themePath, manifest, report) {
  const agents = manifest.supportedAgents || Object.keys(manifest.targets || {});
  const cssDir = join(themePath, 'assets', 'css');

  if (!existsSync(cssDir)) {
    report.checks.cssFiles.errors.push('assets/css/ directory not found');
    report.checks.cssFiles.status = 'error';
    return;
  }

  const errors = [];
  const warnings = [];
  const details = {};

  for (const agent of agents) {
    const cssPath = join(cssDir, `${agent}.css`);
    if (!existsSync(cssPath)) {
      details[agent] = { exists: false, size: 0 };
      errors.push(`${agent}: assets/css/${agent}.css not found`);
    } else {
      const stat = statSync(cssPath);
      details[agent] = { exists: true, size: stat.size };
    }
  }

  // Check targets match supportedAgents
  if (manifest.targets) {
    const targetKeys = Object.keys(manifest.targets);
    const supportedSet = new Set(agents);
    for (const target of targetKeys) {
      if (!supportedSet.has(target)) {
        warnings.push(`target "${target}" not in supportedAgents list`);
      }
    }
  }

  report.checks.cssFiles.details = details;
  report.checks.cssFiles.errors = errors;
  report.checks.cssFiles.warnings = warnings;
  report.checks.cssFiles.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';
}

/**
 * Check 4: CSS variable names are correct (typo detection).
 * @param {string} themePath
 * @param {Record<string, any>} manifest
 * @param {Record<string, any>} report
 */
function checkVariableNames(themePath, manifest, report) {
  const agents = manifest.supportedAgents || Object.keys(manifest.targets || {});
  const cssDir = join(themePath, 'assets', 'css');

  if (!existsSync(cssDir)) {
    report.checks.variableNames.status = 'skip';
    return;
  }

  const errors = [];
  const warnings = [];
  const details = {};

  // Build reverse typo map: typo → correct
  const typoToCorrect = {};
  for (const [correct, typos] of Object.entries(COMMON_TYPOS)) {
    for (const typo of typos) {
      typoToCorrect[typo] = correct;
    }
  }

  for (const agent of agents) {
    const cssPath = join(cssDir, `${agent}.css`);
    if (!existsSync(cssPath)) continue;

    const css = readFileSync(cssPath, 'utf8');
    const declaredVars = extractCssVariables(css);
    const agentIssues = [];

    for (const varName of Object.keys(declaredVars)) {
      // Skip canonical tokens
      if (CANONICAL_TOKENS.includes(varName)) continue;
      // Skip deprecated tokens (already warned)
      if (DEPRECATED_TOKENS.includes(varName)) continue;
      // Skip non-agentskin variables (--vscode-*, --color-*, etc.)
      if (!varName.startsWith('--agentskin-')) continue;

      // Check if it's a known typo
      if (typoToCorrect[varName]) {
        agentIssues.push({
          variable: varName,
          issue: 'typo',
          suggestion: typoToCorrect[varName],
        });
        errors.push(`${agent}: "${varName}" appears to be a typo of "${typoToCorrect[varName]}"`);
      }
    }

    details[agent] = agentIssues;
  }

  report.checks.variableNames.details = details;
  report.checks.variableNames.errors = errors;
  report.checks.variableNames.warnings = warnings;
  report.checks.variableNames.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';
}

/**
 * Check 5 & 6: WCAG AA contrast ratios.
 * @param {string} themePath
 * @param {Record<string, any>} manifest
 * @param {Record<string, any>} report
 */
function checkContrast(_themePath, manifest, report) {
  const colors = manifest.colors;
  if (!colors?.background || !colors?.foreground) {
    report.checks.contrast.warnings.push(
      'Cannot check contrast: missing background or foreground color',
    );
    report.checks.contrast.status = 'warning';
    return;
  }

  const errors = [];
  const warnings = [];
  const details = {};

  // Check 5: background/foreground >= 4.5:1 (normal text AA)
  const fgBgRatio = contrastRatio(colors.foreground, colors.background);
  if (fgBgRatio !== null) {
    details.foregroundBackground = {
      ratio: fgBgRatio,
      required: WCAG_AA_NORMAL,
      passesAA: fgBgRatio >= WCAG_AA_NORMAL,
      passesAAA: fgBgRatio >= WCAG_AAA_NORMAL,
    };
    if (fgBgRatio < WCAG_AA_NORMAL) {
      errors.push(
        `foreground/background contrast ${fgBgRatio}:1 is below WCAG AA ${WCAG_AA_NORMAL}:1`,
      );
    } else if (fgBgRatio < WCAG_AAA_NORMAL) {
      warnings.push(
        `foreground/background contrast ${fgBgRatio}:1 passes AA but not AAA (${WCAG_AAA_NORMAL}:1)`,
      );
    }
  } else {
    details.foregroundBackground = { ratio: null, reason: 'unparseable color values' };
    warnings.push('Could not parse foreground/background colors for contrast check');
  }

  // Check 6: accent/background >= 3:1 (large text / UI components AA)
  if (colors.accent) {
    const accentBgRatio = contrastRatio(colors.accent, colors.background);
    if (accentBgRatio !== null) {
      details.accentBackground = {
        ratio: accentBgRatio,
        required: WCAG_AA_LARGE,
        passesAA: accentBgRatio >= WCAG_AA_LARGE,
      };
      if (accentBgRatio < WCAG_AA_LARGE) {
        warnings.push(
          `accent/background contrast ${accentBgRatio}:1 is below WCAG AA large-text ${WCAG_AA_LARGE}:1`,
        );
      }
    } else {
      details.accentBackground = { ratio: null, reason: 'unparseable color values' };
      warnings.push('Could not parse accent/background colors for contrast check');
    }
  }

  // Additional: muted/foreground on background
  if (colors.muted) {
    const mutedBgRatio = contrastRatio(colors.muted, colors.background);
    if (mutedBgRatio !== null) {
      details.mutedBackground = {
        ratio: mutedBgRatio,
        required: WCAG_AA_NORMAL,
        passesAA: mutedBgRatio >= WCAG_AA_NORMAL,
      };
      if (mutedBgRatio < WCAG_AA_NORMAL) {
        warnings.push(
          `muted/background contrast ${mutedBgRatio}:1 is below WCAG AA ${WCAG_AA_NORMAL}:1 (secondary text)`,
        );
      }
    }
  }

  report.checks.contrast.details = details;
  report.checks.contrast.errors = errors;
  report.checks.contrast.warnings = warnings;
  report.checks.contrast.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';
}

/**
 * Check 7: Image assets referenced in manifest exist on disk.
 * @param {string} themePath
 * @param {Record<string, any>} manifest
 * @param {Record<string, any>} report
 */
function checkAssets(themePath, manifest, report) {
  const errors = [];
  const warnings = [];

  const assetFields = ['icon', 'preview', 'hero'];
  for (const field of assetFields) {
    if (manifest[field]) {
      const assetPath = join(themePath, manifest[field]);
      if (!existsSync(assetPath)) {
        errors.push(`referenced asset not found: ${manifest[field]} (field: ${field})`);
      }
    }
  }

  report.checks.assets.errors = errors;
  report.checks.assets.warnings = warnings;
  report.checks.assets.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';
}

/**
 * Check 8: No orphaned CSS files (CSS for agents not in supportedAgents).
 * @param {string} themePath
 * @param {Record<string, any>} manifest
 * @param {Record<string, any>} report
 */
function checkOrphanedCss(themePath, manifest, report) {
  const cssDir = join(themePath, 'assets', 'css');
  if (!existsSync(cssDir)) {
    report.checks.orphanedCss.status = 'skip';
    return;
  }

  const supported = new Set(manifest.supportedAgents || []);
  const errors = [];
  const warnings = [];

  let entries;
  try {
    entries = readdirSync(cssDir);
  } catch {
    report.checks.orphanedCss.status = 'skip';
    return;
  }

  const orphaned = [];
  for (const entry of entries) {
    if (!entry.endsWith('.css')) continue;
    const agentName = entry.replace(/\.css$/, '');
    if (!supported.has(agentName) && KNOWN_AGENTS.includes(agentName)) {
      orphaned.push(entry);
    }
  }

  if (orphaned.length > 0) {
    warnings.push(`orphaned CSS files (agent not in supportedAgents): ${orphaned.join(', ')}`);
  }

  report.checks.orphanedCss.details = { orphaned };
  report.checks.orphanedCss.errors = errors;
  report.checks.orphanedCss.warnings = warnings;
  report.checks.orphanedCss.status =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'pass';
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

/**
 * Compute summary counts from all checks.
 * @param {Record<string, any>} report
 */
function computeSummary(report) {
  let errors = 0;
  let warnings = 0;
  let passes = 0;

  for (const check of Object.values(report.checks)) {
    if (check.status === 'error') errors++;
    else if (check.status === 'warning') warnings++;
    else if (check.status === 'pass') passes++;
  }

  report.summary = { errors, warnings, passes };
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

/**
 * Format the report as a human-readable summary for stderr.
 * @param {Record<string, any>} report
 * @returns {string}
 */
function formatSummary(report) {
  const lines = [];
  const { theme, checks, summary } = report;

  lines.push(`Theme Integrity Report: ${theme}`);
  lines.push('='.repeat(50));

  const statusIcon = (status) => {
    if (status === 'pass') return '[PASS]';
    if (status === 'warning') return '[WARN]';
    if (status === 'error') return '[FAIL]';
    if (status === 'skip') return '[SKIP]';
    return '[????]';
  };

  for (const [name, check] of Object.entries(checks)) {
    lines.push(`${statusIcon(check.status)} ${name}`);
    for (const err of check.errors) lines.push(`    ERROR: ${err}`);
    for (const warn of check.warnings) lines.push(`    WARN:  ${warn}`);
  }

  lines.push('-'.repeat(50));
  lines.push(
    `Result: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.passes} check(s) passed`,
  );

  if (summary.errors > 0) {
    lines.push('Overall: FAIL (exit code 2)');
  } else if (summary.warnings > 0) {
    lines.push('Overall: PASS with warnings (exit code 1)');
  } else {
    lines.push('Overall: PASS (exit code 0)');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Run all integrity checks against a theme directory.
 * @param {string} themePath - Path to the theme directory.
 * @returns {{ report: Record<string, any>, exitCode: number }}
 */
function runChecks(themePath) {
  const absPath = resolve(themePath);
  const report = createReport(absPath);

  if (!existsSync(absPath)) {
    report.checks.manifest.errors.push(`theme directory not found: ${absPath}`);
    report.checks.manifest.status = 'error';
    computeSummary(report);
    return { report, exitCode: 2 };
  }

  // Check 1: Manifest
  const manifest = checkManifest(absPath, report);
  if (!manifest) {
    // Can't proceed without manifest — mark remaining checks as skipped
    for (const key of [
      'tokens',
      'cssFiles',
      'variableNames',
      'contrast',
      'assets',
      'orphanedCss',
    ]) {
      if (report.checks[key].status === 'pending') {
        report.checks[key].status = 'skip';
      }
    }
    computeSummary(report);
    return { report, exitCode: 2 };
  }

  // Check 2: Tokens
  checkTokens(absPath, manifest, report);

  // Check 3: CSS files
  checkCssFiles(absPath, manifest, report);

  // Check 4: Variable names
  checkVariableNames(absPath, manifest, report);

  // Check 5 & 6: Contrast
  checkContrast(absPath, manifest, report);

  // Check 7: Assets
  checkAssets(absPath, manifest, report);

  // Check 8: Orphaned CSS
  checkOrphanedCss(absPath, manifest, report);

  // Compute summary
  computeSummary(report);

  // Determine exit code
  let exitCode = 0;
  if (report.summary.errors > 0) exitCode = 2;
  else if (report.summary.warnings > 0) exitCode = 1;

  return { report, exitCode };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const themePath = args.find((a) => !a.startsWith('--'));

  if (!themePath) {
    console.error('Usage: node scripts/verify-theme-integrity.mjs <theme-directory>');
    console.error('');
    console.error('Verifies a theme package is internally consistent and matches');
    console.error("AgentSkin's 14-token contract before injection.");
    console.error('');
    process.exit(1);
  }

  const { report, exitCode } = runChecks(themePath);

  // JSON report to stdout
  console.log(JSON.stringify(report, null, 2));

  // Human-readable summary to stderr
  console.error(formatSummary(report));

  process.exit(exitCode);
}

main();
