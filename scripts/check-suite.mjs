// SPDX-License-Identifier: MPL-2.0 OR MIT
//
/**
 * @file Check suite runner — runs all invariant checks independently,
 * collects results, and reports a summary. Avoids `&&` short-circuiting
 * so that one failing check doesn't mask others.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;

/**
 * Each step: { name, cmd, args, skipOnBiomeError }
 * Steps are run sequentially but ALL execute regardless of prior failures.
 */
const STEPS = [
  { name: 'biome', cmd: 'npx', args: ['biome', 'check', 'src/'] },
  { name: 'tsc', cmd: 'npx', args: ['tsc', '--noEmit'] },
  { name: 'design-tokens', cmd: 'node', args: [path.join(SCRIPTS_DIR, 'check-design-tokens.mjs')] },
  { name: 'i18n', cmd: 'node', args: [path.join(SCRIPTS_DIR, 'check-i18n.mjs')] },
  { name: 'themes', cmd: 'node', args: [path.join(SCRIPTS_DIR, 'check-themes.mjs')] },
  {
    name: 'architecture-boundaries',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-architecture-boundaries.mjs')],
  },
  {
    name: 'injection-contract',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-injection-contract.mjs')],
  },
  {
    name: 'store-contracts',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-store-contracts.mjs')],
  },
  {
    name: 'native-defect-consistency',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-native-defect-consistency.mjs')],
  },
  {
    name: 'license-header',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-license-header.mjs')],
  },
  {
    name: 'theme-staleness',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-theme-staleness.mjs')],
  },
  {
    name: 'semantic-contract',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-semantic-contract.mjs')],
  },
  {
    name: 'specificity-budget',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-specificity-budget.mjs')],
  },
  {
    name: 'dependency-audit',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-dependency-audit.mjs')],
  },
  {
    name: 'selector-fragility',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'check-selector-fragility.mjs')],
  },
  {
    name: 'defect-doc',
    cmd: 'node',
    args: [path.join(SCRIPTS_DIR, 'generate-defect-fixes-doc.mjs'), '--verify'],
  },
];

console.log('=== AGENTSKIN CHECK SUITE ===');
console.log(`Running ${STEPS.length} checks independently (no short-circuit)\n`);

const results = [];
let failures = 0;

for (const step of STEPS) {
  const start = Date.now();
  const result = spawnSync(step.cmd, step.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: process.cwd(),
  });
  const elapsed = Date.now() - start;
  const passed = result.status === 0;

  if (!passed) failures++;
  results.push({ name: step.name, passed, elapsed, status: result.status });

  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} ${step.name} (${elapsed}ms)${passed ? '' : ` — EXIT ${result.status}`}`);
}

console.log('\n=== SUMMARY ===');
console.log(`Total: ${STEPS.length} | Passed: ${STEPS.length - failures} | Failed: ${failures}`);

if (failures > 0) {
  console.log('\nFailed checks:');
  for (const r of results) {
    if (!r.passed) console.log(`  ✗ ${r.name}`);
  }
  console.log('');
  process.exit(1);
}

console.log('');
process.exit(0);
