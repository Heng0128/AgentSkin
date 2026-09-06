// SPDX-License-Identifier: MPL-2.0

/**
 * # Dependency Audit CLI (C9 extension)
 *
 * Run: `node scripts/check-dependency-audit.mjs [--skip-snyk] [--verbose]`
 * Exit code: 0 (ok/warn) | 1 (fail)
 *
 * Scans the project dependency tree for supply-chain risks:
 *   - Install/postinstall scripts.
 *   - Transitive dep count thresholds.
 *   - Snyk Advisory API vulnerabilities (optional, requires network).
 */

import { checkDependencyAudit } from '../src/compiler/dependency-audit.mjs';

const args = process.argv.slice(2);
const skipSnyk = args.includes('--skip-snyk');
const verbose = args.includes('--verbose');

const result = await checkDependencyAudit({ skipSnyk, verbose });

// --- Output report ---
console.log('');
console.log('=== DEPENDENCY AUDIT REPORT ===');
console.log('');
console.log(`Total dependencies: ${result.total}`);
console.log(`Score: ${result.score.toUpperCase()}`);
console.log('');

if (result.risky.length > 0) {
  console.log(`Risky packages (${result.risky.length}):`);
  for (const r of result.risky) {
    console.log(`  ⚠ ${r.name}@${r.version} — ${r.risk}`);
  }
  console.log('');
}

if (result.warnings.length > 0) {
  console.log(`Warnings (${result.warnings.length}):`);
  for (const w of result.warnings) {
    console.log(`  • ${w}`);
  }
  console.log('');
}

// --- Exit code ---
if (result.score === 'fail') {
  console.error('❌ DEPENDENCY AUDIT FAILED — address risks before deploying.');
  process.exit(1);
}

if (result.score === 'warn') {
  console.warn('⚠ DEPENDENCY AUDIT WARNING — review listed risks.');
  process.exit(0);
}

console.log('✅ Dependency audit passed.');
process.exit(0);
