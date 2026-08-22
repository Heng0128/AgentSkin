// SPDX-License-Identifier: MPL-2.0

/**
 * # License Header Assertion (C7)
 *
 * Run via: `node scripts/check-license-header.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * Asserts that every source file carries a valid SPDX license header.
 * Detects three violation classes:
 *
 *   1. Missing SPDX — no `SPDX-License-Identifier` in the first 5 lines.
 *   2. Malformed SPDX — the identifier is present but not in the standard
 *      `// SPDX-License-Identifier: <license>` format.
 *   3. License mismatch — a recognized SPDX identifier is present but it is
 *      not one of the allowed licenses (MPL-2.0 or dual MPL-2.0 OR MIT).
 *
 * Scanned file types:
 *   - All .ts/.tsx/.js/.jsx files under src/
 *   - All .mjs files under scripts/
 *
 * Skipped paths:
 *   - node_modules, out, dist directories (build artifacts)
 *   - .d.ts files (auto-generated type declarations)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', 'out', 'dist']);

const SRC_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SCRIPTS_EXTENSIONS = new Set(['.mjs']);

const ALLOWED_LICENSES = ['MPL-2.0', 'MPL-2.0 OR MIT'];

const SPDX_LINE_RE = /SPDX-License-Identifier:\s*(.+)/;
const HEADER_RE = /\/\/\s*SPDX-License-Identifier:\s*(.+)/;

const violations = [];
let scanned = 0;

/**
 * Walk a directory recursively, calling `visitor` for every file found.
 * Skips directories in the SKIP_DIRS set.
 */
function walk(dir, visitor) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(fullPath, visitor);
    } else if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

/**
 * Check a single file for SPDX header compliance.
 * Returns nothing; pushes to `violations` on failure.
 */
function checkFile(absPath) {
  scanned++;
  const relPath = relative(root, absPath).replace(/\\/g, '/');

  let content;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch {
    violations.push({ file: relPath, problem: '无法读取文件', fix: '检查文件权限' });
    return;
  }

  // Consider only the first 5 lines (SPDX must appear at the very top).
  const head = content.split('\n', 5).join('\n');

  const hasSpdx = SPDX_LINE_RE.test(head);

  if (!hasSpdx) {
    violations.push({
      file: relPath,
      problem: '缺少 SPDX 头部',
      fix: '在文件首行添加 "// SPDX-License-Identifier: MPL-2.0"',
    });
    return;
  }

  // Check for standard format: line starts with "// SPDX-License-Identifier:"
  const isStandardFormat = HEADER_RE.test(head);
  if (!isStandardFormat) {
    violations.push({
      file: relPath,
      problem: 'SPDX 格式不规范（非标准行格式）',
      fix: '使用标准格式 "// SPDX-License-Identifier: MPL-2.0"，确保以 // 注释开头',
    });
    return;
  }

  // Extract license identifier and validate against allowlist.
  const match = SPDX_LINE_RE.exec(head);
  const license = match[1].trim();
  if (!ALLOWED_LICENSES.includes(license)) {
    violations.push({
      file: relPath,
      problem: `许可证不一致（"${license}" 不在允许列表中）`,
      fix: '使用允许的许可证标识符: MPL-2.0 或 "MPL-2.0 OR MIT"',
    });
  }
}

// ---------------------------------------------------------------------------
// Scan targets
// ---------------------------------------------------------------------------

// src/**/*.{ts,tsx,js,jsx}
const srcDir = join(root, 'src');
walk(srcDir, (absPath) => {
  const ext = absPath.slice(absPath.lastIndexOf('.'));
  if (!SRC_EXTENSIONS.has(ext)) return;
  if (absPath.endsWith('.d.ts')) return; // auto-generated type declarations
  checkFile(absPath);
});

// scripts/**/*.mjs
const scriptsDir = join(root, 'scripts');
walk(scriptsDir, (absPath) => {
  const ext = absPath.slice(absPath.lastIndexOf('.'));
  if (!SCRIPTS_EXTENSIONS.has(ext)) return;
  checkFile(absPath);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error(`[C7] LICENSE HEADER VIOLATION`);
  for (const v of violations) {
    console.error(`File: ${v.file}`);
    console.error(`Problem: ${v.problem}`);
    console.error(`Fix: ${v.fix}`);
    console.error(`Guide: AGENTS.md §4 row C7 + CONTRIBUTING.md`);
    console.error('');
  }
  console.error(
    `${violations.length} violation(s) across ${scanned} file(s). Run with valid SPDX headers to pass C7.`,
  );
  process.exit(1);
}

console.log(`✓ License headers OK — ${scanned} files have valid SPDX header`);
