// SPDX-License-Identifier: MPL-2.0

/**
 * # Dependency Audit — Build-time supply-chain scanner
 *
 * Reads package.json + package-lock.json to identify:
 *   - Total transitive dependency count (warn if >200).
 *   - Packages with install/postinstall scripts (supply-chain risk).
 *   - Snyk Advisory API check (optional, skipped if no network).
 *
 * Score: 'ok' | 'warn' | 'fail'
 *   - fail: install scripts present OR >700 transitive deps.
 *   - warn: >200 transitive deps OR Snyk reports vulnerabilities.
 *   - ok:   everything clean.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const DEPS_WARN_THRESHOLD = 200;
const DEPS_FAIL_THRESHOLD = 700;

// ---------------------------------------------------------------------------
// Types (JSDoc for IDE support)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AuditResult
 * @property {number} total              - Total transitive dep count.
 * @property {Array<{name: string, version: string, risk: string}>} risky - Risky packages.
 * @property {'ok'|'warn'|'fail'} score  - Overall assessment.
 * @property {string[]} warnings         - Human-readable warnings.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run dependency audit against the project root.
 * @param {Object} [options]
 * @param {boolean} [options.skipSnyk=false] - Skip network-based Snyk check.
 * @param {boolean} [options.verbose=false]  - Print progress to stderr.
 * @returns {Promise<AuditResult>}
 */
export async function checkDependencyAudit(options = {}) {
  const { skipSnyk = false, verbose = false } = options;
  const log = verbose ? (msg) => console.error(`[audit] ${msg}`) : () => {};

  const pkg = readPackageJson(root);
  const lock = readPackageLock(root);

  const deps = collectAllDependencies(pkg, lock);
  log(`Found ${deps.size} total dependencies (direct + transitive)`);

  const risky = [];
  const warnings = [];

  // Check 1: Install/postinstall scripts.
  const installScriptRisks = scanInstallScripts(lock, deps);
  for (const r of installScriptRisks) {
    risky.push(r);
    warnings.push(`Install script risk: ${r.name}@${r.version} — ${r.risk}`);
  }

  // Check 2: Transitive dep count.
  const totalCount = deps.size;
  if (totalCount > DEPS_FAIL_THRESHOLD) {
    warnings.push(`Excessive dependencies: ${totalCount} (${DEPS_FAIL_THRESHOLD} max)`);
    return { total: totalCount, risky, score: 'fail', warnings };
  }
  if (totalCount > DEPS_WARN_THRESHOLD) {
    warnings.push(`High dependency count: ${totalCount} (threshold: ${DEPS_WARN_THRESHOLD})`);
  }

  // Check 3: Snyk Advisory (optional, no network = skip).
  if (!skipSnyk) {
    const snykRisks = await checkSnykVulnerabilities(deps, log);
    for (const r of snykRisks) {
      risky.push(r);
      warnings.push(`Vulnerability: ${r.name}@${r.version} — ${r.risk}`);
    }
  } else {
    log('Snyk check skipped (--skip-snyk)');
  }

  // Determine score.
  let score = 'ok';
  if (risky.some((r) => /critical|install script/i.test(r.risk))) {
    score = 'fail';
  } else if (risky.length > 0 || totalCount > DEPS_WARN_THRESHOLD) {
    score = 'warn';
  }

  return { total: totalCount, risky, score, warnings };
}

// ---------------------------------------------------------------------------
// Package.json / lockfile readers
// ---------------------------------------------------------------------------

function readPackageJson(projectRoot) {
  const path = join(projectRoot, 'package.json');
  if (!existsSync(path)) throw new Error(`package.json not found at ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readPackageLock(projectRoot) {
  const path = join(projectRoot, 'package-lock.json');
  if (!existsSync(path)) {
    return null; // No lockfile — warn but continue.
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// Dependency collection
// ---------------------------------------------------------------------------

/**
 * Collect all dependencies (direct + transitive) from the lockfile.
 * Falls back to direct deps only if no lockfile.
 * @returns {Map<string, string>} name → version
 */
function collectAllDependencies(pkg, lock) {
  const deps = new Map();

  // Direct dependencies.
  const directDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  if (!lock) {
    // No lockfile — use direct deps only.
    for (const [name, version] of Object.entries(directDeps)) {
      deps.set(name, version);
    }
    return deps;
  }

  // Parse lockfile v3 (npm 7+) or v2.
  const packages = lock.packages || {};
  for (const name of Object.keys(directDeps)) {
    const key = `node_modules/${name}`;
    const entry = packages[key];
    if (entry?.version) {
      deps.set(name, entry.version);
    }
  }

  // Transitive: walk all node_modules packages.
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || !entry.version) continue;
    const name =
      key
        .replace(/^node_modules\//, '')
        .split('/node_modules/')
        .pop() || key;
    if (!deps.has(name)) {
      deps.set(name, entry.version);
    }
  }

  return deps;
}

// ---------------------------------------------------------------------------
// Install script scanner
// ---------------------------------------------------------------------------

/**
 * Scan lockfile packages for install/postinstall hooks.
 * @returns {Array<{name: string, version: string, risk: string}>}
 */
function scanInstallScripts(lock, _deps) {
  if (!lock) return [];
  const risky = [];

  const packages = lock.packages || {};
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '') continue;
    const scripts = entry.scripts || {};
    const name =
      key
        .replace(/^node_modules\//, '')
        .split('/node_modules/')
        .pop() || key;

    if (scripts.install || scripts.postinstall || scripts.preinstall) {
      const hooks = [
        scripts.install && 'install',
        scripts.postinstall && 'postinstall',
        scripts.preinstall && 'preinstall',
      ]
        .filter(Boolean)
        .join(', ');
      risky.push({
        name,
        version: entry.version || 'unknown',
        risk: `install script: ${hooks}`,
      });
    }
  }

  return risky;
}

// ---------------------------------------------------------------------------
// Snyk Advisory API (optional, graceful degradation)
// ---------------------------------------------------------------------------

/**
 * Check vulnerabilities via Snyk public API.
 * Returns empty array on network failure.
 */
async function checkSnykVulnerabilities(deps, log) {
  const risky = [];
  const depList = [...deps.entries()].slice(0, 50); // Limit to first 50 to avoid rate limiting.

  for (const [name, version] of depList) {
    try {
      const url = `https://snyk.io/api/v1/test/npm/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.vulnerabilities?.length > 0) {
        const vulns = data.vulnerabilities;
        const critical = vulns.filter((v) => v.severity === 'critical').length;
        const high = vulns.filter((v) => v.severity === 'high').length;
        risky.push({
          name,
          version,
          risk: `${vulns.length} vulnerabilities (${critical} critical, ${high} high)`,
        });
      }
    } catch {
      // Network failure — skip Snyk check.
      log(`Snyk check failed for ${name}@${version} (network unavailable)`);
      break; // Don't keep trying if network is down.
    }
  }

  return risky;
}
