// SPDX-License-Identifier: MPL-2.0

/**
 * # agentskin-compiler.mjs — Unified compiler CLI
 *
 * Orchestrates theme compilation with integrated safety guardrails
 * (λ P0-2 sanitize + P0-1 specificity). Wraps build-theme-package.mjs
 * and adds verify / diagnose commands.
 *
 * Usage:
 *   node scripts/agentskin-compiler.mjs build <theme-id>     Build a single theme
 *   node scripts/agentskin-compiler.mjs build --all           Build all themes
 *   node scripts/agentskin-compiler.mjs verify <theme-id>     Validate schema + safety
 *   node scripts/agentskin-compiler.mjs diagnose <theme-id>   Diagnostic report (with specificity)
 *
 * Safety integration is detect + warn only — CSS output is unchanged
 * (backward compatible with build-palette.mjs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeKeyframes } from '../src/compiler/sanitize.js';
import { AGENT_SPECIFICITY_PROFILES, validateSpecificity } from '../src/compiler/specificity.js';
import { buildAgentCss, buildThemePackage, deriveTokens } from './build-theme-package.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const OUT_DIR = path.join(ROOT, 'theme-workbench', 'out');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadManifest(themeId) {
  const themeDir = path.join(THEMES_DIR, themeId);
  const manifestPath = path.join(themeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw Error(`manifest not found: ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
}

function listThemeIds() {
  return fs
    .readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

/** Map manifest.colors to the --agentskin-* token shape expected by deriveTokens. */
function mapColorsToTokens(colors) {
  if (!colors) return {};
  const tokens = {};
  const mapping = {
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
  for (const [key, varName] of Object.entries(mapping)) {
    if (colors[key] != null) tokens[varName] = colors[key];
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

async function buildTheme(themeId) {
  const manifest = loadManifest(themeId);
  const agentIds = manifest.supportedAgents ?? Object.keys(manifest.targets ?? {});
  if (agentIds.length === 0) {
    console.warn(`[compiler] ${themeId}: no supported agents declared, skipping`);
    return;
  }
  const tokens = mapColorsToTokens(manifest.colors);
  let built = 0;
  for (const agentId of agentIds) {
    const request = {
      agentId,
      meta: {
        id: manifest.id || themeId,
        name: manifest.displayName || manifest.name || themeId,
        author: manifest.author?.name || 'AgentSkin',
      },
      root: tokens,
      declarations: manifest.declarations,
    };
    const pkgDir = buildThemePackage(request, OUT_DIR);
    console.log(`[compiler] build ${themeId}/${agentId} → ${path.basename(pkgDir)}`);
    built++;
  }
  console.log(`[compiler] ${themeId}: built ${built} agent package(s)`);
}

async function cmdBuild(target) {
  if (target === 'all' || target === '--all') {
    const ids = listThemeIds();
    for (const id of ids) {
      await buildTheme(id);
    }
    console.log(`\n[compiler] build --all: ${ids.length} theme(s) processed`);
  } else {
    await buildTheme(target);
  }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

function verifyTheme(themeId) {
  const manifest = loadManifest(themeId);
  const agentIds = manifest.supportedAgents ?? Object.keys(manifest.targets ?? {});
  const tokens = mapColorsToTokens(manifest.colors);
  const palette = deriveTokens(tokens);
  const issues = [];

  // 1. Schema validation.
  if (!manifest.id) issues.push('missing manifest.id');
  if (!manifest.colors) issues.push('missing manifest.colors');
  if (!agentIds.length) issues.push('no supported agents');

  // 2. Keyframes sanitize (P0-2).
  const rawKeyframes = manifest.declarations?.keyframes;
  let keyframesResult = null;
  if (rawKeyframes) {
    keyframesResult = sanitizeKeyframes(rawKeyframes, {
      allowPaletteTokens: true,
      namespacePrefix: 'agentskin-',
    });
    if (keyframesResult.isBlocked) {
      issues.push(`keyframes blocked: ${keyframesResult.violations.join('; ')}`);
    }
  }

  // 3. Specificity check per agent (P0-1).
  const specificityReports = {};
  for (const agentId of agentIds) {
    const css = buildAgentCss(agentId, palette, null, null, rawKeyframes);
    const profile = AGENT_SPECIFICITY_PROFILES[agentId];
    if (!profile) continue;
    const report = validateSpecificity(css, profile);
    specificityReports[agentId] = report;
    if (report.violated) {
      issues.push(
        `${agentId}: specificity exceeded (${report.actualBudget}/${profile.importantBudget})`,
      );
    }
  }

  return { manifest, agentIds, issues, keyframesResult, specificityReports };
}

function cmdVerify(themeId) {
  const { manifest, agentIds, issues, keyframesResult, specificityReports } = verifyTheme(themeId);
  console.log(`\n=== verify: ${themeId} ===`);
  console.log(`name: ${manifest.displayName || manifest.name}`);
  console.log(`agents: ${agentIds.join(', ')}`);
  if (keyframesResult) {
    console.log(
      `keyframes: ${keyframesResult.isBlocked ? 'BLOCKED' : 'ok'} (${keyframesResult.violations.length} warnings)`,
    );
  }
  for (const [agent, report] of Object.entries(specificityReports)) {
    const status = report.violated ? 'EXCEEDED' : 'ok';
    console.log(
      `specificity ${agent}: ${status} (${report.actualBudget}/${AGENT_SPECIFICITY_PROFILES[agent].importantBudget})`,
    );
  }
  if (issues.length > 0) {
    console.log(`\nIssues (${issues.length}):`);
    for (const issue of issues) console.log(`  - ${issue}`);
    return false;
  }
  console.log('\nNo issues found.');
  return true;
}

// ---------------------------------------------------------------------------
// diagnose
// ---------------------------------------------------------------------------

function computeHealthScore(verifyResult) {
  let score = 100;
  const { issues, specificityReports, keyframesResult } = verifyResult;

  // Deduct for blocking issues.
  score -= issues.length * 10;

  // Deduct for specificity overflows.
  for (const [agent, report] of Object.entries(specificityReports)) {
    if (report.violated) {
      const overflow = report.actualBudget - AGENT_SPECIFICITY_PROFILES[agent].importantBudget;
      score -= Math.min(20, Math.ceil(overflow / 10));
    }
  }

  // Deduct for keyframes blocked.
  if (keyframesResult?.isBlocked) score -= 15;

  return Math.max(0, score);
}

function cmdDiagnose(themeId) {
  const verifyResult = verifyTheme(themeId);
  const { manifest, agentIds, issues, keyframesResult, specificityReports } = verifyResult;
  const healthScore = computeHealthScore(verifyResult);

  console.log(`\n=== diagnose: ${themeId} ===`);
  console.log(`name: ${manifest.displayName || manifest.name}`);
  console.log(`mode: ${manifest.mode || 'unspecified'}`);
  console.log(`agents: ${agentIds.join(', ')}`);
  console.log(`\nHealth score: ${healthScore}/100`);

  // Keyframes report.
  console.log('\n[Keyframes sanitize]');
  if (keyframesResult) {
    console.log(`  status: ${keyframesResult.isBlocked ? 'BLOCKED' : 'ok'}`);
    console.log(`  warnings: ${keyframesResult.violations.length}`);
    for (const v of keyframesResult.violations) console.log(`    - ${v}`);
  } else {
    console.log('  no keyframes declared');
  }

  // Specificity report.
  console.log('\n[Specificity budget]');
  for (const agentId of agentIds) {
    const report = specificityReports[agentId];
    if (!report) continue;
    const profile = AGENT_SPECIFICITY_PROFILES[agentId];
    const status = report.violated ? 'EXCEEDED' : 'ok';
    console.log(
      `  ${agentId}: ${status} — !important ${report.actualBudget}/${profile.importantBudget}`,
    );
    if (report.overflowSelectors.length > 0) {
      console.log(`    overflow selectors: ${report.overflowSelectors.length}`);
    }
    for (const r of report.recommendations) console.log(`    → ${r}`);
  }

  // Summary.
  if (issues.length > 0) {
    console.log(`\n[Issues: ${issues.length}]`);
    for (const issue of issues) console.log(`  ! ${issue}`);
  } else {
    console.log('\nNo issues found.');
  }

  return healthScore;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];
const target = args[1];

if (!command || !target) {
  console.error('Usage:');
  console.error('  node scripts/agentskin-compiler.mjs build <theme-id|--all>');
  console.error('  node scripts/agentskin-compiler.mjs verify <theme-id>');
  console.error('  node scripts/agentskin-compiler.mjs diagnose <theme-id>');
  process.exit(1);
}

switch (command) {
  case 'build':
    await cmdBuild(target);
    break;
  case 'verify': {
    const ok = cmdVerify(target);
    process.exit(ok ? 0 : 1);
    break;
  }
  case 'diagnose': {
    const score = cmdDiagnose(target);
    process.exit(score >= 60 ? 0 : 1);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
