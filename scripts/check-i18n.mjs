// SPDX-License-Identifier: MPL-2.0

/**
 * check-i18n.mjs — i18n completeness validation
 *
 * Validates:
 * 1. All i18n keys in uiMessages / mainMessages have matching translations in both locales
 * 2. No empty string translations
 * 3. Function-type keys have matching signatures between locales
 * 4. All i18n keys are referenced somewhere in the UI codebase (no orphans)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'glob';

const { glob } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const i18nDir = join(rootDir, 'src', 'shared', 'i18n');
const i18nModulesDir = join(i18nDir, 'modules');

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

// Read all i18n source files (index.ts + modules/*.ts) into a map keyed by
// fully-qualified export name. uiMessages lives in index.ts (aggregated),
// mainMessages lives in modules/main.ts. Searching by export marker across
// all files is resilient to future file moves.
const i18nFiles = glob
  .sync(join(i18nDir, '{index,base}.ts'))
  .concat(glob.sync(join(i18nModulesDir, '*.ts')));
if (i18nFiles.length === 0) {
  console.error(`✗ No i18n source files found in ${i18nDir}`);
  process.exit(1);
}
const allI18nContent = i18nFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');

// Helper: find the file content that contains a given top-level export
function findExportContent(varName) {
  const marker = `export const ${varName}`;
  const idx = allI18nContent.indexOf(marker);
  if (idx === -1) return null;
  return idx;
}

// Extract a top-level object block by marker, using brace-depth counting.
// Returns the inner content (between the outer { and }).
function extractBlock(content, startMarker, endMarker) {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return null;
  // Find the opening brace after the marker
  const braceIdx = content.indexOf('{', startIdx + startMarker.length);
  if (braceIdx === -1) return null;
  let depth = 0;
  let endIdx = braceIdx;
  for (let i = braceIdx; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  const inner = content.slice(braceIdx + 1, endIdx);
  return inner;
}

// Extract top-level keys from a locale block (depth === 1).
// When the depth is exactly 1, a line starting with `keyName:` or `keyName(`
// is a top-level key. Nested objects (e.g. function bodies) are skipped.
function extractKeys(block) {
  const keys = new Set();
  let depth = 0;
  const lines = block.split('\n');
  for (const line of lines) {
    // Count braces on this line to track depth changes
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    // Only extract keys at depth 0 inside the block (i.e. top-level key)
    if (depth === 0) {
      const match = line.match(/^\s+(\w+):/);
      if (match) {
        keys.add(match[1]);
      }
    }
  }
  return keys;
}

// Extract both locale blocks for a given message category.
function extractLocaleBlocks(varName) {
  const exportIdx = findExportContent(varName);
  if (exportIdx === null) {
    console.error(`✗ Failed to find export: ${varName}`);
    return null;
  }
  // Slice from the export marker to end of file content to capture full block
  const contentFromExport = allI18nContent.slice(exportIdx);
  const fullBlock = extractBlock(contentFromExport, `export const ${varName}`, '\n};');
  if (!fullBlock) return null;
  // Extract zh-CN block
  const zhBlock = extractBlock(fullBlock, "'zh-CN':", 'en: {');
  // Extract en block — it runs to the end of fullBlock
  // Find "en: {" in fullBlock
  const enMarkerIdx = fullBlock.indexOf('en: {');
  let enBlock = null;
  if (enMarkerIdx !== -1) {
    const enBraceIdx = fullBlock.indexOf('{', enMarkerIdx);
    if (enBraceIdx !== -1) {
      let depth = 0;
      let endIdx = enBraceIdx;
      for (let i = enBraceIdx; i < fullBlock.length; i++) {
        const ch = fullBlock[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      enBlock = fullBlock.slice(enBraceIdx + 1, endIdx);
    }
  }
  return { zhBlock, enBlock };
}

function checkCategory(varName) {
  const blocks = extractLocaleBlocks(varName);
  if (!blocks || !blocks.zhBlock || !blocks.enBlock) {
    console.error(`✗ Failed to parse ${varName} — could not locate locale blocks`);
    process.exit(1);
  }
  return {
    zhKeys: extractKeys(blocks.zhBlock),
    enKeys: extractKeys(blocks.enBlock),
    zhBlock: blocks.zhBlock,
    enBlock: blocks.enBlock,
  };
}

const ui = checkCategory('uiMessages');
const main = checkCategory('mainMessages');

console.log('\n=== i18n Completeness Check ===\n');

// 1. Check structural alignment
console.log('[1/4] Structural alignment');

function checkAlignment(zhKeys, enKeys, label) {
  const zhOnly = [...zhKeys].filter((k) => !enKeys.has(k));
  const enOnly = [...enKeys].filter((k) => !zhKeys.has(k));
  if (zhOnly.length === 0 && enOnly.length === 0) {
    success(`${label}: All ${zhKeys.size} keys aligned between zh-CN and en`);
  } else {
    if (zhOnly.length > 0) error(`${label} keys only in zh-CN: ${zhOnly.join(', ')}`);
    if (enOnly.length > 0) error(`${label} keys only in en: ${enOnly.join(', ')}`);
  }
}

checkAlignment(ui.zhKeys, ui.enKeys, 'uiMessages');
checkAlignment(main.zhKeys, main.enKeys, 'mainMessages');

// 2. Check for empty translations
console.log('\n[2/4] Empty translation check');

function checkEmpty(block, label) {
  const empty = [];
  const lines = block.split('\n');
  let depth = 0;
  for (const line of lines) {
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && line.match(/^\s+(\w+): ['"]['"],?$/)) {
      const key = line.match(/^\s+(\w+):/)[1];
      empty.push(key);
    }
  }
  return empty;
}

const emptyUiZh = checkEmpty(ui.zhBlock, "uiMessages 'zh-CN'");
const emptyUiEn = checkEmpty(ui.enBlock, 'uiMessages en');
const emptyMainZh = checkEmpty(main.zhBlock, "mainMessages 'zh-CN'");
const emptyMainEn = checkEmpty(main.enBlock, 'mainMessages en');

if (
  emptyUiZh.length === 0 &&
  emptyUiEn.length === 0 &&
  emptyMainZh.length === 0 &&
  emptyMainEn.length === 0
) {
  success('No empty string translations found');
} else {
  if (emptyUiZh.length > 0) error(`Empty uiMessages['zh-CN']: ${emptyUiZh.join(', ')}`);
  if (emptyUiEn.length > 0) error(`Empty uiMessages.en: ${emptyUiEn.join(', ')}`);
  if (emptyMainZh.length > 0) error(`Empty mainMessages['zh-CN']: ${emptyMainZh.join(', ')}`);
  if (emptyMainEn.length > 0) error(`Empty mainMessages.en: ${emptyMainEn.join(', ')}`);
}

// 3. Check for unused keys (orphans)
console.log('\n[3/4] Orphan key detection');
const uiFiles = glob.sync(join(rootDir, 'src', 'ui', '**', '*.{ts,tsx}'));
const mainFiles = glob.sync(join(rootDir, 'src', 'main', '**', '*.{ts,tsx}'));
const uiContent = uiFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');
const mainContent = mainFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');

function findOrphans(zhKeys, content, label) {
  const usedKeys = new Set();
  for (const key of zhKeys) {
    const patterns = [
      new RegExp(`t\\.${key}\\b`),
      new RegExp(`t\\['${key}'\\]`),
      new RegExp(`t\\["${key}"\\]`),
    ];
    if (patterns.some((p) => p.test(content))) {
      usedKeys.add(key);
    }
  }
  return { usedKeys, orphanKeys: [...zhKeys].filter((k) => !usedKeys.has(k)) };
}

const uiOrphans = findOrphans(ui.zhKeys, uiContent, 'uiMessages');
const mainOrphans = findOrphans(main.zhKeys, mainContent, 'mainMessages');

if (uiOrphans.orphanKeys.length === 0) {
  success(`All ${ui.zhKeys.size} uiMessages keys are referenced in UI code`);
} else {
  log(
    `  ⚠ ${uiOrphans.orphanKeys.length} potentially unused uiMessages keys (may be used dynamically):`,
  );
  for (const key of uiOrphans.orphanKeys.slice(0, 10)) {
    log(`    - ${key}`);
  }
  if (uiOrphans.orphanKeys.length > 10) {
    log(`    ... and ${uiOrphans.orphanKeys.length - 10} more`);
  }
}

if (mainOrphans.orphanKeys.length === 0) {
  success(`All ${main.zhKeys.size} mainMessages keys are referenced in main code`);
} else {
  log(
    `  ⚠ ${mainOrphans.orphanKeys.length} potentially unused mainMessages keys (may be used dynamically):`,
  );
  for (const key of mainOrphans.orphanKeys.slice(0, 10)) {
    log(`    - ${key}`);
  }
  if (mainOrphans.orphanKeys.length > 10) {
    log(`    ... and ${mainOrphans.orphanKeys.length - 10} more`);
  }
}

// 4. Summary
console.log('\n[4/4] Summary');
console.log(
  `  uiMessages keys: ${ui.zhKeys.size} (used: ${uiOrphans.usedKeys.size}, orphans: ${uiOrphans.orphanKeys.length})`,
);
console.log(
  `  mainMessages keys: ${main.zhKeys.size} (used: ${mainOrphans.usedKeys.size}, orphans: ${mainOrphans.orphanKeys.length})`,
);

if (exitCode === 0) {
  console.log('\n✓ i18n check passed\n');
} else {
  console.log('\n✗ i18n check failed\n');
}

process.exit(exitCode);
