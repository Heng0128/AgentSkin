// SPDX-License-Identifier: MPL-2.0

/**
 * # Architecture Boundary Assertion (C4)
 *
 * Run via: `node scripts/check-architecture-boundaries.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * Enforces the layered dependency direction invariant (C4):
 *
 *   UI (src/ui/) → src/shared/ → main (src/main/) → engine (src/engine/, engines/)
 *
 * Each layer may only depend on layers to its right. Detected violations:
 *
 * 1. src/ui/  → src/main/   (UI reverse-importing main)
 * 2. src/ui/  → src/engine/|engines/ (UI reverse-importing engine)
 * 3. src/shared/ → src/main/ (shared reverse-importing main)
 * 4. src/shared/ → src/ui/  (shared reverse-importing UI)
 * 5. src/main/ → src/ui/    (main reverse-importing UI)
 *
 * Allowed patterns (no violation reported):
 * - src/main/ → src/shared/ (main may depend on shared)
 * - src/ui/  → src/shared/  (UI may depend on shared)
 * - src/shared/ → external deps / node builtins
 * - src/legacy/ → @agentskin/engine (the sole engine import gateway)
 *
 * Type-only imports (`import type`) are reported with a softer severity
 * note but still flagged — types can still create coupling.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];

function fail(file, line, importRef, problem, fix) {
  errors.push({ file, line, importRef, problem, fix });
}

// ---------------------------------------------------------------------------
// Path alias resolution (mirrors tsconfig.json paths)
// ---------------------------------------------------------------------------

const ENGINE_ALIAS = '@agentskin/engine';

// ---------------------------------------------------------------------------
// Layer classification
// ---------------------------------------------------------------------------

/**
 * Determine which architectural layer a resolved absolute path belongs to.
 * Returns one of: 'ui', 'shared', 'main', 'engine', 'engine-pkg', 'legacy', or null.
 */
function classifyLayer(absPath) {
  const rel = relative(root, absPath);
  const norm = rel.replace(/\\/g, '/');

  if (norm.startsWith('src/legacy/')) return 'legacy';
  if (norm.startsWith('src/ui/')) return 'ui';
  if (norm.startsWith('src/shared/')) return 'shared';
  if (norm.startsWith('src/main/')) return 'main';
  if (norm.startsWith('src/engine/')) return 'engine';
  if (norm.startsWith('engines/')) return 'engine-pkg';
  if (
    norm === 'src/engine' ||
    norm === 'src/engine/' ||
    norm === 'engines' ||
    norm === 'engines/'
  ) {
    return norm.startsWith('src/engine') ? 'engine' : 'engine-pkg';
  }

  return null; // external dep, node builtin, or unrelated
}

/**
 * Resolve an import source string to an absolute path.
 * Returns { absPath, isExternal } — if isExternal is true, absPath is the raw specifier.
 */
function resolveImportSource(source, fromFile) {
  // Relative import: resolve against the directory containing fromFile
  if (source.startsWith('./') || source.startsWith('../')) {
    const fromDir = dirname(fromFile);
    return { absPath: resolve(fromDir, source), isExternal: false };
  }

  // Path alias: @/* → src/ui/*
  if (source.startsWith('@/')) {
    const mapped = source.replace('@/', `${join(root, 'src/ui/')}/`);
    return { absPath: mapped, isExternal: false };
  }

  // Path alias: @shared/* → src/shared/*
  if (source.startsWith('@shared/')) {
    const mapped = source.replace('@shared/', `${join(root, 'src/shared/')}/`);
    return { absPath: mapped, isExternal: false };
  }

  // Path alias: @agentskin/engine → src/engine (allowed only from src/legacy/)
  if (source === ENGINE_ALIAS || source.startsWith(`${ENGINE_ALIAS}/`)) {
    const suffix = source.slice(ENGINE_ALIAS.length);
    return { absPath: join(root, 'src/engine') + suffix, isExternal: false };
  }

  // Everything else is an external package or node builtin
  return { absPath: source, isExternal: true };
}

// ---------------------------------------------------------------------------
// Boundary violation matrix
// ---------------------------------------------------------------------------

/**
 * Given the layer of the importing file and the layer of the import target,
 * determine if this is a violation.
 * Returns a violation description string, or null if allowed.
 */
function checkBoundary(fromLayer, toLayer, _importSource) {
  // External / node builtin — always allowed
  if (toLayer === null) return null;

  // Legacy is allowed to import @agentskin/engine (mapped to src/engine)
  if (fromLayer === 'legacy' && (toLayer === 'engine' || toLayer === 'engine-pkg')) {
    return null;
  }

  // src/ui/ → src/main/
  if (fromLayer === 'ui' && toLayer === 'main') {
    return 'src/ui/ must not import src/main/ — UI depends on shared, never directly on main';
  }

  // src/ui/ → src/engine/ or engines/
  if (fromLayer === 'ui' && (toLayer === 'engine' || toLayer === 'engine-pkg')) {
    return 'src/ui/ must not import engine modules — UI interacts with engine only via @agentskin/engine through src/legacy/';
  }

  // src/shared/ → src/main/
  if (fromLayer === 'shared' && toLayer === 'main') {
    return 'src/shared/ must not import src/main/ — shared is a lower layer than main';
  }

  // src/shared/ → src/ui/
  if (fromLayer === 'shared' && toLayer === 'ui') {
    return 'src/shared/ must not import src/ui/ — shared is a lower layer than UI';
  }

  // src/main/ → src/ui/
  if (fromLayer === 'main' && toLayer === 'ui') {
    return 'src/main/ must not import src/ui/ — main is a lower layer than UI';
  }

  // Allowed: main → shared, ui → shared, same-layer imports
  return null;
}

// ---------------------------------------------------------------------------
// Import regex
// ---------------------------------------------------------------------------

// Match: import x from '...', import { x } from '...', import '...', import * as x from '...'
// Also captures type-only imports: import type { x } from '...'
const IMPORT_RE = /^(import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

// ---------------------------------------------------------------------------
// Directory traversal
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist']);

function walkDir(dir, callback) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath, entry.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

let checkedFiles = 0;
const SCAN_DIRS = ['src/ui', 'src/shared', 'src/main'];

for (const scanDir of SCAN_DIRS) {
  const absDir = join(root, scanDir);
  let dirExists = false;
  try {
    dirExists = statSync(absDir).isDirectory();
  } catch {
    continue;
  }
  if (!dirExists) continue;

  walkDir(absDir, (filePath, fileName) => {
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return;
    checkedFiles++;

    const src = readFileSync(filePath, 'utf8');
    const fromLayer = classifyLayer(filePath);

    // Reset regex state
    IMPORT_RE.lastIndex = 0;

    for (let match = IMPORT_RE.exec(src); match !== null; match = IMPORT_RE.exec(src)) {
      const isTypeOnly = !!match[2];
      const importSource = match[3];

      const { absPath: resolvedPath, isExternal } = resolveImportSource(importSource, filePath);

      if (isExternal) continue;

      const toLayer = classifyLayer(resolvedPath);
      const violation = checkBoundary(fromLayer, toLayer, importSource);
      if (!violation) continue;

      // Find the line number for this match
      const offset = match.index;
      const lineNum = src.substring(0, offset).split('\n').length;

      const relPath = relative(root, filePath).replace(/\\/g, '/');
      const typeNote = isTypeOnly ? ' (type-only)' : '';
      const fix = buildFix(fromLayer, toLayer, importSource);

      fail(relPath, lineNum, `'${importSource}' → layer '${toLayer}'${typeNote}`, violation, fix);
    }
  });
}

// Also check that ONLY src/legacy/ imports @agentskin/engine (not from other layers).
// Uses the same import regex as the main scan to avoid false positives from
// comments or string literals that happen to contain "import"/"export".
function scanForEngineImportViolations() {
  const allSrcDir = join(root, 'src');
  let dirExists = false;
  try {
    dirExists = statSync(allSrcDir).isDirectory();
  } catch {
    return;
  }
  if (!dirExists) return;

  walkDir(allSrcDir, (filePath, fileName) => {
    if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx') && !fileName.endsWith('.mjs'))
      return;

    const layer = classifyLayer(filePath);
    // Legacy is allowed, skip
    if (layer === 'legacy') return;

    const src = readFileSync(filePath, 'utf8');

    IMPORT_RE.lastIndex = 0;
    for (let match = IMPORT_RE.exec(src); match !== null; match = IMPORT_RE.exec(src)) {
      const importSource = match[3];
      // Only care about @agentskin/engine imports
      if (importSource !== ENGINE_ALIAS && !importSource.startsWith(`${ENGINE_ALIAS}/`)) continue;

      // Allow the engine package to reference itself by package name
      // (e.g. src/engine/src/* files importing @agentskin/engine are self-referencing)
      if (layer === 'engine') continue;

      const offset = match.index;
      const lineNum = src.substring(0, offset).split('\n').length;
      const relPath = relative(root, filePath).replace(/\\/g, '/');
      const fromLayerName = layer || 'unknown';
      fail(
        relPath,
        lineNum,
        `'${importSource}' (engine package)`,
        `Only src/legacy/ may import @agentskin/engine directly. ` +
          `Layer '${fromLayerName}' is not authorized to import the engine package.`,
        `Move the engine interaction into src/legacy/agentskin-core-runtime.ts ` +
          `and expose a typed wrapper that '${fromLayerName}' can call instead.`,
      );
    }
  });
}

scanForEngineImportViolations();

// ---------------------------------------------------------------------------
// Fix suggestion builder
// ---------------------------------------------------------------------------

function buildFix(fromLayer, toLayer, _importSource) {
  if (toLayer === 'main') {
    return (
      `Move the needed functionality from src/main/ into src/shared/ (if it is cross-cutting) ` +
      `or expose it via IPC and call it from src/ui/ or src/shared/.`
    );
  }
  if (toLayer === 'engine' || toLayer === 'engine-pkg') {
    return (
      `Route engine access through src/legacy/agentskin-core-runtime.ts ` +
      `and call the runtime wrapper from '${fromLayer}'.`
    );
  }
  if (toLayer === 'ui') {
    return (
      `Do not import UI components/modules from a lower layer. ` +
      `Extract shared types or logic into src/shared/ and import from there.`
    );
  }
  return `Re-architect to respect the dependency direction: UI → shared → main → engine.`;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`✖ ${errors.length} architecture boundary violation(s) found:\n`);
  for (const e of errors) {
    console.error(`  [C4] ARCHITECTURE BOUNDARY VIOLATION`);
    console.error(`  File: ${e.file}:${e.line}`);
    console.error(`  Import: ${e.importRef}`);
    console.error(`  Problem: ${e.problem}`);
    console.error(`  Fix: ${e.fix}`);
    console.error(`  Guide: AGENTS.md §4 row C4 + docs/ARCHITECTURE.md`);
    console.error('');
  }
  process.exit(1);
}

console.log(`✓ Architecture boundaries OK — checked ${checkedFiles} files`);
