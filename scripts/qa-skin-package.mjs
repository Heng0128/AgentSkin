// SPDX-License-Identifier: MPL-2.0

/**
 * # qa-skin-package.mjs — Skin package QA validator
 *
 * Runs a comprehensive QA checklist against a scaffolded (or hand-authored)
 * skin package directory. Inspired by the codex-skin-builder QA pattern:
 * syntax check, structure validation, path safety, sensitive info scan.
 *
 * Each check returns a structured result:
 *   { name, passed, severity, message }
 *
 * Exit code 0 = all checks passed; 1 = any error-severity check failed.
 *
 * @type {import('node:fs')}
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIRED_TOKENS } from './theme-tokens.mjs';

/**
 * The 13 manifest color keys required by the theme contract.
 * The 14th CSS token (--agentskin-selection) is derived from accent via
 * color-mix at CSS generation time, so it is NOT declared in the manifest.
 * Source of truth: tests/contract/14-token-theme-contract.test.ts.
 */
const MANIFEST_COLOR_KEYS = [
  'background',
  'surface',
  'surfaceElevated',
  'foreground',
  'muted',
  'accent',
  'secondary',
  'border',
  'codeBackground',
  'codeForeground',
  'focusRing',
  'buttonBackground',
  'inputBackground',
];

// ---------------------------------------------------------------------------
// Check: manifest.json format validation
// ---------------------------------------------------------------------------

/**
 * Validate manifest.json structure and 14-token contract completeness.
 *
 * @param {string} pkgDir - Absolute path to the skin package directory.
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkManifestFormat(pkgDir) {
  const name = 'manifest-format';
  const manifestPath = path.join(pkgDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { name, passed: false, severity: 'error', message: 'manifest.json not found' };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `manifest.json is not valid JSON: ${e.message}`,
    };
  }

  // Required top-level fields
  const requiredFields = ['id', 'name', 'version', 'colors', 'targets', 'supportedAgents'];
  const missingFields = requiredFields.filter((f) => !(f in manifest));
  if (missingFields.length > 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `manifest.json missing required fields: ${missingFields.join(', ')}`,
    };
  }

  // 14-token contract: manifest.colors must contain all 13 keys
  const colors = manifest.colors || {};
  const missingKeys = MANIFEST_COLOR_KEYS.filter((k) => typeof colors[k] !== 'string');
  if (missingKeys.length > 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `manifest.colors missing keys: ${missingKeys.join(', ')}`,
    };
  }

  // supportedAgents must be a non-empty array
  if (!Array.isArray(manifest.supportedAgents) || manifest.supportedAgents.length === 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: 'manifest.supportedAgents must be a non-empty array',
    };
  }

  // targets must be an object with at least one entry
  if (
    typeof manifest.targets !== 'object' ||
    manifest.targets === null ||
    Object.keys(manifest.targets).length === 0
  ) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: 'manifest.targets must be a non-empty object',
    };
  }

  return { name, passed: true, severity: 'error', message: 'manifest.json is valid' };
}

// ---------------------------------------------------------------------------
// Check: CSS file syntax
// ---------------------------------------------------------------------------

/**
 * Check that the agent CSS file exists and has valid syntax (balanced braces).
 *
 * @param {string} pkgDir
 * @param {string} [agentId] - If not provided, read from manifest.
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkCssSyntax(pkgDir, agentId) {
  const name = 'css-syntax';

  // Determine agentId from manifest if not provided
  let agent = agentId;
  if (!agent) {
    const manifestPath = path.join(pkgDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { name, passed: false, severity: 'error', message: 'Cannot find manifest.json' };
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const targets = manifest.targets || {};
      agent = Object.keys(targets)[0];
    } catch {
      return { name, passed: false, severity: 'error', message: 'Cannot parse manifest.json' };
    }
  }

  const cssPath = path.join(pkgDir, 'assets', 'css', `${agent}.css`);
  if (!fs.existsSync(cssPath)) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `CSS file not found: assets/css/${agent}.css`,
    };
  }

  const css = fs.readFileSync(cssPath, 'utf-8');

  // Check balanced braces
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) {
      return {
        name,
        passed: false,
        severity: 'error',
        message: `CSS has unbalanced braces (extra closing) in ${agent}.css`,
      };
    }
  }
  if (depth !== 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `CSS has ${depth} unclosed block(s) in ${agent}.css`,
    };
  }

  // Check all 14 required tokens are declared
  const missing = REQUIRED_TOKENS.filter((t) => !css.includes(`${t}:`));
  if (missing.length > 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `CSS missing ${missing.length} required token(s): ${missing.join(', ')}`,
    };
  }

  return { name, passed: true, severity: 'error', message: 'CSS syntax is valid' };
}

// ---------------------------------------------------------------------------
// Check: image resource existence
// ---------------------------------------------------------------------------

/**
 * Check that required image resources (icon, preview) exist.
 *
 * @param {string} pkgDir
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkImageResources(pkgDir) {
  const name = 'image-resources';
  const manifestPath = path.join(pkgDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { name, passed: false, severity: 'error', message: 'Cannot find manifest.json' };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return { name, passed: false, severity: 'error', message: 'Cannot parse manifest.json' };
  }

  const warnings = [];
  const errors = [];

  // icon and preview are required by the theme contract
  for (const imgId of ['icon', 'preview']) {
    const imgRef = manifest[imgId];
    if (!imgRef || typeof imgRef !== 'string') {
      warnings.push(`manifest.${imgRef} not declared`);
      continue;
    }
    const imgPath = path.join(pkgDir, imgRef);
    if (!fs.existsSync(imgPath)) {
      errors.push(`Referenced image missing: ${imgRef}`);
    }
  }

  if (errors.length > 0) {
    return { name, passed: false, severity: 'error', message: errors.join('; ') };
  }
  if (warnings.length > 0) {
    return { name, passed: true, severity: 'warning', message: warnings.join('; ') };
  }

  return { name, passed: true, severity: 'error', message: 'Image resources OK' };
}

// ---------------------------------------------------------------------------
// Check: script file executability
// ---------------------------------------------------------------------------

/**
 * Check that install/verify/restore scripts exist and are valid JS syntax.
 *
 * @param {string} pkgDir
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkScriptExecutability(pkgDir) {
  const name = 'script-executability';
  const scriptsDir = path.join(pkgDir, 'scripts');

  if (!fs.existsSync(scriptsDir)) {
    return { name, passed: false, severity: 'error', message: 'scripts/ directory not found' };
  }

  const requiredScripts = ['install.mjs', 'verify.mjs', 'restore.mjs'];
  const missing = requiredScripts.filter((s) => !fs.existsSync(path.join(scriptsDir, s)));
  if (missing.length > 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `Missing scripts: ${missing.join(', ')}`,
    };
  }

  // Basic syntax check: balanced braces + no obvious syntax errors
  const errors = [];
  for (const script of requiredScripts) {
    const content = fs.readFileSync(path.join(scriptsDir, script), 'utf-8');
    let depth = 0;
    for (const ch of content) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth < 0) {
        errors.push(`${script}: unbalanced braces`);
        break;
      }
    }
    if (depth !== 0 && !errors.includes(`${script}: unbalanced braces`)) {
      errors.push(`${script}: unclosed blocks`);
    }
  }

  if (errors.length > 0) {
    return { name, passed: false, severity: 'error', message: errors.join('; ') };
  }

  return { name, passed: true, severity: 'error', message: 'All scripts are valid' };
}

// ---------------------------------------------------------------------------
// Check: directory structure completeness
// ---------------------------------------------------------------------------

/**
 * Check that the package directory has the expected structure.
 *
 * @param {string} pkgDir
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkDirectoryStructure(pkgDir) {
  const name = 'directory-structure';

  if (!fs.existsSync(pkgDir)) {
    return { name, passed: false, severity: 'error', message: `Directory not found: ${pkgDir}` };
  }

  const requiredEntries = [
    'manifest.json',
    'assets',
    'assets/css',
    'assets/images',
    'scripts',
    'SKILL.md',
    'README.md',
  ];

  const missing = requiredEntries.filter((entry) => !fs.existsSync(path.join(pkgDir, entry)));
  if (missing.length > 0) {
    return {
      name,
      passed: false,
      severity: 'error',
      message: `Missing entries: ${missing.join(', ')}`,
    };
  }

  return { name, passed: true, severity: 'error', message: 'Directory structure is complete' };
}

// ---------------------------------------------------------------------------
// Check: no absolute path leakage
// ---------------------------------------------------------------------------

/**
 * Scan all text files for absolute path references that would leak
 * the build machine's filesystem layout.
 *
 * @param {string} pkgDir
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkNoAbsolutePathLeakage(pkgDir) {
  const name = 'no-absolute-path-leakage';

  // Patterns that indicate absolute paths (Windows + Unix)
  const absPathPatterns = [
    /[A-Z]:[\\/]/, // Windows C:\
    /\/(Users|home|etc|var|usr|opt)\//, // Unix absolute
    /\\Users\\/, // Windows Users
  ];

  const textExtensions = ['.json', '.css', '.mjs', '.md', '.txt'];
  const violations = [];

  /**
   * @param {string} dir
   */
  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        scanDir(full);
      } else if (textExtensions.some((ext) => entry.endsWith(ext))) {
        const content = fs.readFileSync(full, 'utf-8');
        for (const pattern of absPathPatterns) {
          if (pattern.test(content)) {
            violations.push(`${path.relative(pkgDir, full)}: matches ${pattern}`);
            break;
          }
        }
      }
    }
  }

  try {
    scanDir(pkgDir);
  } catch (e) {
    return { name, passed: false, severity: 'error', message: `Scan error: ${e.message}` };
  }

  if (violations.length > 0) {
    return {
      name,
      passed: false,
      severity: 'warning',
      message: `Absolute path leakage detected: ${violations.slice(0, 5).join('; ')}`,
    };
  }

  return { name, passed: true, severity: 'error', message: 'No absolute path leakage detected' };
}

// ---------------------------------------------------------------------------
// Check: no sensitive information
// ---------------------------------------------------------------------------

/**
 * Scan all text files for patterns that look like sensitive information
 * (API keys, tokens, passwords).
 *
 * @param {string} pkgDir
 * @returns {{ name: string, passed: boolean, severity: 'error'|'warning', message: string }}
 */
export function checkNoSensitiveInfo(pkgDir) {
  const name = 'no-sensitive-info';

  // Patterns that indicate sensitive data
  const sensitivePatterns = [
    /(?:api[_-]?key|apikey|token|password|secret|passwd)\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}/i,
    /(?:sk|ak|bk)-[a-zA-Z0-9]{20,}/,
    /Bearer\s+[a-zA-Z0-9_\-.]{20,}/,
  ];

  const textExtensions = ['.json', '.css', '.mjs', '.md', '.txt'];
  const violations = [];

  /**
   * @param {string} dir
   */
  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        scanDir(full);
      } else if (textExtensions.some((ext) => entry.endsWith(ext))) {
        const content = fs.readFileSync(full, 'utf-8');
        for (const pattern of sensitivePatterns) {
          if (pattern.test(content)) {
            violations.push(`${path.relative(pkgDir, full)}: potential sensitive data`);
            break;
          }
        }
      }
    }
  }

  try {
    scanDir(pkgDir);
  } catch (e) {
    return { name, passed: false, severity: 'error', message: `Scan error: ${e.message}` };
  }

  if (violations.length > 0) {
    return {
      name,
      passed: false,
      severity: 'warning',
      message: `Potential sensitive data: ${violations.slice(0, 5).join('; ')}`,
    };
  }

  return { name, passed: true, severity: 'error', message: 'No sensitive information detected' };
}

// ---------------------------------------------------------------------------
// QA runner
// ---------------------------------------------------------------------------

/**
 * Run all QA checks against a skin package directory.
 *
 * @param {string} pkgDir - Absolute path to the skin package.
 * @returns {{ passed: boolean, checks: Array, errorCount: number, warningCount: number }}
 */
export function qaSkinPackage(pkgDir) {
  const checks = [
    checkDirectoryStructure(pkgDir),
    checkManifestFormat(pkgDir),
    checkCssSyntax(pkgDir),
    checkImageResources(pkgDir),
    checkScriptExecutability(pkgDir),
    checkNoAbsolutePathLeakage(pkgDir),
    checkNoSensitiveInfo(pkgDir),
  ];

  const errorCount = checks.filter((c) => !c.passed && c.severity === 'error').length;
  const warningCount = checks.filter((c) => !c.passed && c.severity === 'warning').length;

  return {
    passed: errorCount === 0,
    checks,
    errorCount,
    warningCount,
  };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pkgDir = process.argv[2] || process.cwd();
  const result = qaSkinPackage(path.resolve(pkgDir));

  console.log(`\nQA Report for: ${path.resolve(pkgDir)}`);
  console.log('='.repeat(60));
  for (const check of result.checks) {
    const status = check.passed ? 'PASS' : check.severity === 'error' ? 'FAIL' : 'WARN';
    console.log(`  [${status}] ${check.name}: ${check.message}`);
  }
  console.log('-'.repeat(60));
  console.log(
    `Result: ${result.passed ? 'PASSED' : 'FAILED'} (${result.errorCount} errors, ${result.warningCount} warnings)`,
  );

  process.exit(result.passed ? 0 : 1);
}
