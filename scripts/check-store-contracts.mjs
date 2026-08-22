// SPDX-License-Identifier: MPL-2.0

/**
 * # Store Contract Assertion (C5)
 *
 * Run via: `node scripts/check-store-contracts.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * Enforces the Store contract consistency invariant (C5):
 *
 * 1. Cross-store calls must use `getState()` — a store file must not import
 *    another store's hook and call its methods directly
 *    (e.g. `useShellStore.setLocale()` is wrong; `useShellStore.getState().setLocale()` is correct).
 * 2. Store files in `src/ui/stores/` must follow the `*Store.ts` naming convention.
 *    Excluded: index.ts, import-guard.ts, workspace-presets.ts, `*.test.ts`.
 * 3. `create()` from zustand must only appear inside `src/ui/stores/`.
 *    Stores defined elsewhere violate the single-source-of-truth rule.
 * 4. A file named `*Store.ts` must export a properly named Zustand hook
 *    (`use*Store` pattern) created via `create()`.
 *
 * Allowed patterns (no violation reported):
 * - Store calling its own `getState()` / `setState()` / `get()` / `set()` internally.
 * - Cross-store access via `useXStore.getState().action()`.
 * - `<T>()` generic instantiation with type parameters in create call.
 * - Test files (`*.test.ts`) are excluded from all checks.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const storesDir = join(root, 'src', 'ui', 'stores');

const errors = [];

function fail(file, line, problem, fix) {
  errors.push({ file, line, problem, fix });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist']);

/** Files excluded from naming and create() checks. */
const STORE_ALLOWED_EXCEPTIONS = new Set(['index.ts', 'import-guard.ts', 'workspace-presets.ts']);

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

function getLineNumber(src, index) {
  return src.substring(0, index).split('\n').length;
}

// ---------------------------------------------------------------------------
// Violation 1: Cross-store direct call (hook.method() instead of hook.getState().method())
// ---------------------------------------------------------------------------

function checkCrossStoreDirectCalls(filePath, fileName) {
  if (!fileName.endsWith('.ts')) return;
  if (fileName.endsWith('.test.ts')) return;

  const src = readFileSync(filePath, 'utf8');

  // Find imports of store hooks from other stores.
  // Matches: `import { useXxxStore } from '@/stores/xxxStore'`
  // Also matches relative imports: `import { useXxxStore } from './xxxStore'`
  const importRe =
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]*(?:stores[/\\]\w+Store|@\/\w+Store|@\/stores\/\w+Store))['"]/g;

  let match = importRe.exec(src);
  while (match !== null) {
    const importedNames = match[1].split(',').map((s) => s.trim());
    const _importPath = match[2];

    for (const name of importedNames) {
      // Only care about store hook names (useXxxStore pattern)
      if (!/^use\w+Store$/.test(name)) continue;

      // Find direct calls to this store: `useXxxStore.method()` NOT preceded by `.getState()`
      // We look for the pattern `useXxxStore.` followed by something that is NOT `getState(` or `setState(`
      const callRe = new RegExp(`\\b${name}\\.(\\w+)`, 'g');
      let callMatch = callRe.exec(src);
      while (callMatch !== null) {
        const methodName = callMatch[1];
        // Skip allowed Zustand hook methods
        if (
          methodName === 'getState' ||
          methodName === 'setState' ||
          methodName === 'subscribe' ||
          methodName === '__ISO__FINDER__' // internal
        ) {
          callMatch = callRe.exec(src);
          continue;
        }

        // This is a direct call to another store's method — VIOLATION
        const lineNum = getLineNumber(src, callMatch.index);
        const relPath = relative(root, filePath).replace(/\\/g, '/');
        fail(
          relPath,
          lineNum,
          `Cross-store call \`${name}.${methodName}\` does not use \`getState()\` — ` +
            `direct method calls bypass Zustand's subscription model and break the single-store-of-truth contract.`,
          `Replace \`${name}.${methodName}\` with \`${name}.getState().${methodName}\` so the call reads the authoritative state snapshot from the store hook.`,
        );
        callMatch = callRe.exec(src);
      }
    }
    match = importRe.exec(src);
  }
}

// ---------------------------------------------------------------------------
// Violation 2: Store file naming convention
// ---------------------------------------------------------------------------

function checkStoreNaming(filePath, fileName) {
  if (!fileName.endsWith('.ts')) return;
  if (fileName.endsWith('.test.ts')) return;
  if (STORE_ALLOWED_EXCEPTIONS.has(fileName)) return;

  const src = readFileSync(filePath, 'utf8');

  // If the file calls create() from zustand, it must be named *Store.ts
  if (!src.includes('create(')) return;

  // Verify it's actually a zustand create call (import { create } from 'zustand')
  const hasZustandImport = /import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*['"]zustand['"]/.test(src);
  if (!hasZustandImport) return;

  // Check naming
  if (!fileName.endsWith('Store.ts')) {
    const relPath = relative(root, filePath).replace(/\\/g, '/');
    fail(
      relPath,
      1,
      `Store file \`${fileName}\` does not follow the \`*Store.ts\` naming convention. ` +
        `Files that define a Zustand store (via \`create()\`) must end with \`Store.ts\`.`,
      `Rename \`${fileName}\` to \`<name>Store.ts\` (replace \`<name>\` with the store domain, e.g. \`agentStore.ts\`).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Violation 3: Store defined outside src/ui/stores/
// ---------------------------------------------------------------------------

function checkStoreLocation(filePath) {
  const normRel = relative(root, filePath).replace(/\\/g, '/');

  // Skip files inside src/ui/stores/ — those are allowed
  if (normRel.startsWith('src/ui/stores/')) return;

  if (!normRel.endsWith('.ts')) return;
  if (normRel.endsWith('.test.ts')) return;

  const src = readFileSync(filePath, 'utf8');

  // Check for zustand create() call
  const hasZustandImport = /import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*['"]zustand['"]/.test(src);
  if (!hasZustandImport) return;

  // Find create() calls
  const createRe = /\bcreate\s*<[^>]*>\s*\(/g;
  let m = createRe.exec(src);
  while (m !== null) {
    const lineNum = getLineNumber(src, m.index);
    fail(
      normRel,
      lineNum,
      `Store \`create()\` call found outside \`src/ui/stores/\`. ` +
        `All Zustand stores must be defined in \`src/ui/stores/\` to maintain a single source of truth.`,
      `Move the store definition to a new file \`src/ui/stores/<name>Store.ts\` and import it from there. Remove the orphaned store file at \`${normRel}\`.`,
    );
    m = createRe.exec(src);
  }

  // Also detect plain `create(` without type params (less common but still valid)
  const plainCreateRe = /[^.]?\bcreate\s*\(/g;
  m = plainCreateRe.exec(src);
  while (m !== null) {
    const before = src.substring(Math.max(0, m.index - 30), m.index);
    // Avoid matching React.createElement or other create-like calls
    if (/\bdocument\.|React\.|\.create(Element|Event)/.test(before)) {
      m = plainCreateRe.exec(src);
      continue;
    }
    const lineNum = getLineNumber(src, m.index);
    fail(
      normRel,
      lineNum,
      `Store \`create()\` call found outside \`src/ui/stores/\`. ` +
        `All Zustand stores must be defined in \`src/ui/stores/\` to maintain a single source of truth.`,
      `Move the store definition to \`src/ui/stores/<name>Store.ts\` and import it from there.`,
    );
    m = plainCreateRe.exec(src);
  }
}

// ---------------------------------------------------------------------------
// Violation 4: Store file must export a properly named Zustand hook
// ---------------------------------------------------------------------------

function checkStoreExport(filePath, fileName) {
  if (!fileName.endsWith('Store.ts')) return;
  if (fileName.endsWith('.test.ts')) return;

  const src = readFileSync(filePath, 'utf8');

  // Find exported identifiers from this file
  const exportHookRe = /export\s+const\s+(\w+)\s*=\s*create\s*[<(]/g;
  let m = exportHookRe.exec(src);
  let foundValidHook = false;

  while (m !== null) {
    const hookName = m[1];
    if (/^use\w+Store$/.test(hookName)) {
      foundValidHook = true;
    } else {
      const lineNum = getLineNumber(src, m.index);
      const relPath = relative(root, filePath).replace(/\\/g, '/');
      fail(
        relPath,
        lineNum,
        `Store export \`${hookName}\` does not follow the \`use*Store\` naming convention. ` +
          `Zustand hooks must start with \`use\` and end with \`Store\` (e.g. \`useAgentStore\`).`,
        `Rename the export from \`${hookName}\` to \`use${hookName}Store\` (or another \`use*Store\` name) to match the project convention.`,
      );
    }
    m = exportHookRe.exec(src);
  }

  // Also check: if there are no create() exports at all, this might be a misnamed file
  if (!foundValidHook) {
    exportHookRe.lastIndex = 0;
    if (!exportHookRe.test(src)) {
      // No create() export found — but this file is named *Store.ts
      // Only report if we can see the file imports zustand at all
      const hasZustandImport = /import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*['"]zustand['"]/.test(
        src,
      );
      if (hasZustandImport) {
        const relPath = relative(root, filePath).replace(/\\/g, '/');
        fail(
          relPath,
          1,
          `File \`${fileName}\` imports \`create\` from zustand but does not export a \`use*Store\` hook. ` +
            `Every \`*Store.ts\` file must export a Zustand store created via \`create()\`.`,
          `Add \`export const use${fileName.replace('.ts', '')} = create<...>(...)\` to define the store.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

let filesScanned = 0;
let storesChecked = 0;

// Pass 1: Scan src/ui/stores/ for naming, exports, cross-store calls
if (statSync(storesDir).isDirectory()) {
  walkDir(storesDir, (filePath, fileName) => {
    if (!fileName.endsWith('.ts')) return;
    filesScanned++;

    if (!fileName.endsWith('.test.ts')) {
      storesChecked++;
      checkStoreNaming(filePath, fileName);
      checkStoreExport(filePath, fileName);
    }
    // Cross-store check applies to all non-test files (including exceptions like import-guard)
    if (!fileName.endsWith('.test.ts')) {
      checkCrossStoreDirectCalls(filePath, fileName);
    }
  });
}

// Pass 2: Scan all .ts files in src/ for create() outside src/ui/stores/
const srcDir = join(root, 'src');
if (statSync(srcDir).isDirectory()) {
  walkDir(srcDir, (filePath, fileName) => {
    if (!fileName.endsWith('.ts')) return;
    if (fileName.endsWith('.test.ts')) return;

    const normRel = relative(root, filePath).replace(/\\/g, '/');
    if (normRel.startsWith('src/ui/stores/')) return; // Already handled in Pass 1

    filesScanned++;
    checkStoreLocation(filePath);
    checkCrossStoreDirectCalls(filePath, fileName);
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`✖ ${errors.length} store contract violation(s) found:\n`);
  for (const e of errors) {
    console.error(`[C5] STORE CONTRACT VIOLATION`);
    console.error(`File: ${e.file}:${e.line}`);
    console.error(`Problem: ${e.problem}`);
    console.error(`Fix: ${e.fix}`);
    console.error(`Guide: AGENTS.md §4 row C5 + src/ui/stores/INDEX.md`);
    console.error('');
  }
  process.exit(1);
}

console.log(
  `✓ Store contracts OK — checked ${storesChecked} stores, ${filesScanned} files scanned`,
);
