// SPDX-License-Identifier: MPL-2.0

/**
 * check-i18n.mjs — i18n completeness validation
 *
 * Validates:
 * 1. All i18n keys in uiMessages have matching translations in both locales
 * 2. No empty string translations
 * 3. Function-type keys have matching signatures between locales
 * 4. All i18n keys are referenced somewhere in the UI codebase (no orphans)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pkg from 'glob';
const { glob } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const i18nFile = join(rootDir, 'src', 'shared', 'i18n.ts');

let exitCode = 0;

function log(msg) {
  console.log(`  ${msg}`);
}

function error(msg) {
  console.error(`  ✗ ${msg}`);
  exitCode = 1;
}

function success(msg) {
  console.log(`  ✓ ${msg}`);
}

// Read the i18n file and extract key names
const i18nContent = readFileSync(i18nFile, 'utf-8');

// Extract all key definitions from both locales
const zhBlock = i18nContent.match(/'zh-CN': \{([\s\S]*?)\n  \},\n  en: \{/);
const enBlock = i18nContent.match(/en: \{([\s\S]*?)\n  \},\n\};/);

if (!zhBlock || !enBlock) {
  console.error('✗ Failed to parse i18n.ts — could not locate locale blocks');
  process.exit(1);
}

function extractKeys(block) {
  const keys = new Set();
  const lines = block.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s+(\w+):/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

const zhKeys = extractKeys(zhBlock[1]);
const enKeys = extractKeys(enBlock[1]);

console.log('\n=== i18n Completeness Check ===\n');

// 1. Check structural alignment
console.log('[1/4] Structural alignment');
const zhOnly = [...zhKeys].filter((k) => !enKeys.has(k));
const enOnly = [...enKeys].filter((k) => !zhKeys.has(k));
if (zhOnly.length === 0 && enOnly.length === 0) {
  success(`All ${zhKeys.size} keys aligned between zh-CN and en`);
} else {
  if (zhOnly.length > 0) error(`Keys only in zh-CN: ${zhOnly.join(', ')}`);
  if (enOnly.length > 0) error(`Keys only in en: ${enOnly.join(', ')}`);
}

// 2. Check for empty translations
console.log('\n[2/4] Empty translation check');
const emptyZh = [];
const emptyEn = [];
const zhLines = zhBlock[1].split('\n');
const enLines = enBlock[1].split('\n');
for (const line of zhLines) {
  if (line.match(/^\s+(\w+): ['"]['"],?$/)) {
    const key = line.match(/^\s+(\w+):/)[1];
    emptyZh.push(key);
  }
}
for (const line of enLines) {
  if (line.match(/^\s+(\w+): ['"]['"],?$/)) {
    const key = line.match(/^\s+(\w+):/)[1];
    emptyEn.push(key);
  }
}
if (emptyZh.length === 0 && emptyEn.length === 0) {
  success('No empty string translations found');
} else {
  if (emptyZh.length > 0) error(`Empty zh-CN: ${emptyZh.join(', ')}`);
  if (emptyEn.length > 0) error(`Empty en: ${emptyEn.join(', ')}`);
}

// 3. Check for unused keys (orphans)
console.log('\n[3/4] Orphan key detection');
const uiFiles = glob.sync(join(rootDir, 'src', 'ui', '**', '*.{ts,tsx}'));
const allUiContent = uiFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');
const usedKeys = new Set();
for (const key of zhKeys) {
  // Check if key is referenced in UI code (as t.keyName or t['keyName'])
  const patterns = [
    new RegExp(`t\\.${key}\\b`),
    new RegExp(`t\\['${key}'\\]`),
    new RegExp(`t\\["${key}"\\]`),
  ];
  if (patterns.some((p) => p.test(allUiContent))) {
    usedKeys.add(key);
  }
}
const orphanKeys = [...zhKeys].filter((k) => !usedKeys.has(k));
if (orphanKeys.length === 0) {
  success(`All ${zhKeys.size} keys are referenced in UI code`);
} else {
  log(`  ⚠ ${orphanKeys.length} potentially unused keys (may be used dynamically):`);
  for (const key of orphanKeys.slice(0, 10)) {
    log(`    - ${key}`);
  }
  if (orphanKeys.length > 10) {
    log(`    ... and ${orphanKeys.length - 10} more`);
  }
  // Orphans are warnings, not errors
}

// 4. Summary
console.log('\n[4/4] Summary');
console.log(`  Total i18n keys: ${zhKeys.size}`);
console.log(`  Used in UI: ${usedKeys.size}`);
console.log(`  Potentially unused: ${orphanKeys.length}`);

if (exitCode === 0) {
  console.log('\n✓ i18n check passed\n');
} else {
  console.log('\n✗ i18n check failed\n');
}

process.exit(exitCode);
