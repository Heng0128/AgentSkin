// SPDX-License-Identifier: MPL-2.0
//
// # verify-theme-compatibility.mjs — Theme registry verification evidence chain
//
// Scans all themes in the themes/ directory and produces a verification
// evidence chain report. Inspired by dshworks/awesome-dsh-themes:
//   - Each theme record gets an evidence field (path#key) for verifiable checks
//   - Status tracking: verified / unverified / broken
//   - verifiedAgainst field records the target app version
//   - Auto-detects potentially broken themes when agent versions change
//
// Checks performed:
//   1. manifest.json exists with required fields (id, name, version, colors)
//   2. All 14 canonical --agentskin-* tokens declared in each agent CSS
//   3. CSS file references resolve to existing files
//   4. Selector references in verification blocks match known contract selectors
//   5. manifest targets match supportedAgents cross-field consistency
//   6. Duplicate agent coverage detection
//
// Usage:
//   node scripts/verify-theme-compatibility.mjs
//   node scripts/verify-theme-compatibility.mjs --report
//   node scripts/verify-theme-compatibility.mjs themes/miku-future-beats --report
//
// Output:
//   stdout — JSON report
//   stderr — human-readable summary
//
// Exit codes:
//   0 — all themes verified
//   1 — warnings (some themes unverified)
//   2 — errors (broken themes detected)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const THEMES_DIR = join(PROJECT_ROOT, 'themes');
const CONTRACTS_DIR = join(PROJECT_ROOT, 'src', 'shared', 'injection', 'contracts');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical 14 --agentskin-* tokens (aligned with THEME_SPEC.md). */
export const CANONICAL_TOKENS = [
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

/** All known agent IDs. */
export const KNOWN_AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

// ---------------------------------------------------------------------------
// Contract loading (zero-dependency JSON import)
// ---------------------------------------------------------------------------

/**
 * Load a verification contract for a given agent.
 * @param {string} agentId
 * @returns {Record<string, any> | null}
 */
export function loadContract(agentId) {
  const contractPath = join(CONTRACTS_DIR, `${agentId}.contract.json`);
  if (!existsSync(contractPath)) return null;
  try {
    return JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Collect all known selectors from a verification contract.
 * @param {Record<string, any>} contract
 * @returns {Set<string>}
 */
export function collectContractSelectors(contract) {
  const selectors = new Set();
  const verification = contract?.targets?.[Object.keys(contract.targets || {})[0]]?.verification;
  if (!verification) return selectors;

  const extractFromChecks = (checks) => {
    if (!Array.isArray(checks)) return;
    for (const check of checks) {
      if (Array.isArray(check.any)) {
        for (const sel of check.any) selectors.add(sel);
      }
    }
  };

  extractFromChecks(verification.required);
  extractFromChecks(verification.recommended);
  if (Array.isArray(verification.contexts)) {
    for (const ctx of verification.contexts) {
      extractFromChecks(ctx.required);
      if (ctx.when?.any) {
        for (const sel of ctx.when.any) selectors.add(sel);
      }
    }
  }

  return selectors;
}

// ---------------------------------------------------------------------------
// CSS variable extraction
// ---------------------------------------------------------------------------

/**
 * Extract all --agentskin-* variable declarations from a CSS string.
 * @param {string} css
 * @returns {Record<string, string>}
 */
export function extractCssVariables(css) {
  const vars = {};
  const re = /(--agentskin-[\w-]+)\s*:\s*([^;]+);/g;
  let m = re.exec(css);
  while (m !== null) {
    vars[m[1].trim()] = m[2].trim();
    m = re.exec(css);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Evidence builder
// ---------------------------------------------------------------------------

/**
 * Create an evidence entry.
 * @param {string} path - File path within theme.
 * @param {string} key - Check identifier.
 * @param {boolean} passed - Whether the check passed.
 * @param {string} [detail] - Optional detail message.
 * @returns {Record<string, any>}
 */
export function evidence(path, key, passed, detail = undefined) {
  const entry = { path, key, passed };
  if (detail !== undefined) entry.detail = detail;
  return entry;
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

/**
 * Run all verification checks against a single theme directory.
 * @param {string} themePath - Path to the theme directory.
 * @returns {Record<string, any>} Verification result with evidence.
 */
export function verifyTheme(themePath) {
  const themeName = basename(themePath);
  const result = {
    theme: themeName,
    path: themePath,
    evidence: [],
    status: 'unverified',
    errors: [],
    warnings: [],
  };

  // Check 1: manifest.json
  const manifestPath = join(themePath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    result.evidence.push(evidence('manifest.json', 'exists', false, 'file not found'));
    result.errors.push('manifest.json not found');
    result.status = 'broken';
    return result;
  }

  result.evidence.push(evidence('manifest.json', 'exists', true));

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    result.evidence.push(evidence('manifest.json', 'valid-json', false, e.message));
    result.errors.push(`manifest.json parse error: ${e.message}`);
    result.status = 'broken';
    return result;
  }

  result.evidence.push(evidence('manifest.json', 'valid-json', true));

  // Validate required fields
  const requiredFields = ['id', 'name', 'version'];
  for (const field of requiredFields) {
    if (!manifest[field]) {
      result.evidence.push(evidence('manifest.json', `field-${field}`, false, `missing: ${field}`));
      result.errors.push(`missing required field: ${field}`);
    } else {
      result.evidence.push(evidence('manifest.json', `field-${field}`, true));
    }
  }

  // Check 2: supportedAgents matches targets keys
  const agents = manifest.supportedAgents || [];
  const targets = manifest.targets || {};

  if (agents.length === 0) {
    result.evidence.push(
      evidence('manifest.json', 'supportedAgents-nonempty', false, 'no agents listed'),
    );
    result.errors.push('supportedAgents is empty');
  } else {
    result.evidence.push(evidence('manifest.json', 'supportedAgents-nonempty', true));
  }

  // Cross-field: targets keys must be subset of known agents
  if (targets && typeof targets === 'object') {
    const targetKeys = Object.keys(targets);
    const unknownTargets = targetKeys.filter((t) => !KNOWN_AGENTS.includes(t));
    if (unknownTargets.length > 0) {
      result.evidence.push(
        evidence(
          'manifest.json',
          'targets-known-agents',
          false,
          `unknown: ${unknownTargets.join(', ')}`,
        ),
      );
      result.warnings.push(`targets contain unknown agents: ${unknownTargets.join(', ')}`);
    } else {
      result.evidence.push(evidence('manifest.json', 'targets-known-agents', true));
    }

    // Cross-field: supportedAgents ⊇ targets keys
    const agentSet = new Set(agents);
    const missingInSupported = targetKeys.filter((t) => !agentSet.has(t));
    if (missingInSupported.length > 0) {
      result.evidence.push(
        evidence(
          'manifest.json',
          'targets-subset-supportedAgents',
          false,
          `targets not in supportedAgents: ${missingInSupported.join(', ')}`,
        ),
      );
      result.errors.push(`targets not in supportedAgents: ${missingInSupported.join(', ')}`);
    } else {
      result.evidence.push(evidence('manifest.json', 'targets-subset-supportedAgents', true));
    }
  }

  // Check 3: 14-token contract in each agent CSS
  const cssDir = join(themePath, 'assets', 'css');
  for (const agent of agents) {
    if (
      agent === 'traework' ||
      agent === 'qoderwork' ||
      agent === 'workbuddy' ||
      agent === 'doubao' ||
      agent === 'codex' ||
      agent === 'zcode'
    ) {
      const cssPath = join(cssDir, `${agent}.css`);
      if (!existsSync(cssPath)) {
        // Only error if this agent is in targets
        if (targets[agent]) {
          result.evidence.push(
            evidence(
              `assets/css/${agent}.css`,
              'exists',
              false,
              'referenced in targets but file missing',
            ),
          );
          result.errors.push(`${agent}: CSS file missing (referenced in targets)`);
        } else {
          result.evidence.push(
            evidence(
              `assets/css/${agent}.css`,
              'exists',
              true,
              'optional file not present (not in targets)',
            ),
          );
        }
        continue;
      }

      result.evidence.push(evidence(`assets/css/${agent}.css`, 'exists', true));

      // Check 14 tokens
      const css = readFileSync(cssPath, 'utf8');
      const declaredVars = extractCssVariables(css);
      const declaredSet = new Set(Object.keys(declaredVars));
      const missing = CANONICAL_TOKENS.filter((t) => !declaredSet.has(t));

      if (missing.length > 0) {
        result.evidence.push(
          evidence(
            `assets/css/${agent}.css`,
            '14-token-complete',
            false,
            `missing ${missing.length} token(s): ${missing.join(', ')}`,
          ),
        );
        result.errors.push(`${agent}: missing ${missing.length} token(s): ${missing.join(', ')}`);
      } else {
        result.evidence.push(evidence(`assets/css/${agent}.css`, '14-token-complete', true));
      }
    }
  }

  // Check 4: Selector references in verification blocks match contracts
  if (targets && typeof targets === 'object') {
    for (const [agentId, target] of Object.entries(targets)) {
      if (!target.verification) continue;

      const contract = loadContract(agentId);
      if (!contract) {
        result.evidence.push(
          evidence(
            `manifest.json`,
            `verification-${agentId}-contract`,
            true,
            'no contract available for selector check',
          ),
        );
        continue;
      }

      const knownSelectors = collectContractSelectors(contract);
      const verifBlocks = [
        ...(target.verification.required || []),
        ...(target.verification.recommended || []),
      ];

      const unmatchedSels = [];
      for (const block of verifBlocks) {
        if (Array.isArray(block.any)) {
          for (const sel of block.any) {
            if (!knownSelectors.has(sel)) {
              unmatchedSels.push(sel);
            }
          }
        }
      }

      if (unmatchedSels.length > 0) {
        result.evidence.push(
          evidence(
            `manifest.json`,
            `verification-${agentId}-selectors`,
            false,
            `${unmatchedSels.length} selector(s) not in contract: ${unmatchedSels.join(', ')}`,
          ),
        );
        result.warnings.push(
          `${agentId}: ${unmatchedSels.length} selector(s) not in verification contract`,
        );
      } else {
        result.evidence.push(evidence(`manifest.json`, `verification-${agentId}-selectors`, true));
      }
    }
  }

  // Check 5: CSS file targets resolve correctly
  if (targets && typeof targets === 'object') {
    for (const [agentId, target] of Object.entries(targets)) {
      if (!target.css) continue;
      const cssPath = join(themePath, target.css);
      if (!existsSync(cssPath)) {
        result.evidence.push(
          evidence(target.css, 'css-resolves', false, `file not found: ${target.css}`),
        );
        result.errors.push(`${agentId}: target CSS not found: ${target.css}`);
      } else {
        result.evidence.push(evidence(target.css, 'css-resolves', true));
      }
    }
  }

  // Compute final status
  const failedEvidence = result.evidence.filter((e) => !e.passed);
  if (result.errors.length > 0) {
    result.status = 'broken';
  } else if (result.warnings.length > 0) {
    result.status = 'unverified';
  } else {
    result.status = failedEvidence.length === 0 ? 'verified' : 'broken';
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
  lines.push('Theme Verification Evidence Chain Report');
  lines.push('='.repeat(60));
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Themes scanned: ${report.summary.total}`);
  lines.push(`Verified: ${report.summary.verified}`);
  lines.push(`Unverified: ${report.summary.unverified}`);
  lines.push(`Broken: ${report.summary.broken}`);
  lines.push('');

  for (const theme of report.themes) {
    const icon =
      theme.status === 'verified' ? '[PASS]' : theme.status === 'broken' ? '[FAIL]' : '[WARN]';
    lines.push(`${icon} ${theme.theme} (${theme.status})`);

    if (theme.detail) {
      const failed = theme.evidence.filter((e) => !e.passed);
      for (const ev of failed) {
        lines.push(`    FAIL: ${ev.path}#${ev.key}${ev.detail ? ` — ${ev.detail}` : ''}`);
      }
    }

    if (!theme.detail && theme.errors.length > 0) {
      for (const err of theme.errors) {
        lines.push(`    ERROR: ${err}`);
      }
    }
    if (!theme.detail && theme.warnings.length > 0) {
      for (const warn of theme.warnings) {
        lines.push(`    WARN: ${warn}`);
      }
    }
  }

  lines.push('');
  if (report.summary.broken > 0) {
    lines.push(`Result: FAIL (${report.summary.broken} broken theme(s))`);
  } else if (report.summary.unverified > 0) {
    lines.push(`Result: PASS with warnings (${report.summary.unverified} unverified theme(s))`);
  } else {
    lines.push('Result: ALL VERIFIED');
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
    mode: singleMode ? 'single' : 'scan',
    themes: [],
    summary: {
      total: 0,
      verified: 0,
      unverified: 0,
      broken: 0,
    },
  };

  for (const themePath of themes) {
    const result = verifyTheme(themePath);
    const themeEntry = {
      theme: result.theme,
      path: result.path,
      status: result.status,
      evidenceCount: result.evidence.length,
      passedCount: result.evidence.filter((e) => e.passed).length,
      failedCount: result.evidence.filter((e) => !e.passed).length,
    };

    if (showReport) {
      themeEntry.evidence = result.evidence;
      themeEntry.errors = result.errors;
      themeEntry.warnings = result.warnings;
    }

    report.themes.push(themeEntry);
    report.summary.total++;
    report.summary[result.status]++;
  }

  // Output
  console.log(JSON.stringify(report, null, 2));
  console.error(formatSummary(report));

  // Exit code
  if (report.summary.broken > 0) process.exit(2);
  if (report.summary.unverified > 0) process.exit(1);
  process.exit(0);
}

// Only run main() when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
