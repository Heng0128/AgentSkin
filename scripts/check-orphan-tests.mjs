// SPDX-License-Identifier: MPL-2.0 OR MIT
//
/**
 * Check Orphan Tests
 *
 * Detects test files whose inferred source files no longer exist on disk.
 * Part of `npm run check` suite (invariant C12).
 *
 * Strategy: For each *.test.ts/*.test.tsx/*.test.mjs tracked by git, infer
 * the source path by stripping `.test` suffix and checking file existence.
 * Falls back to import-resolution for tests that follow 1:many patterns
 * (e.g. `tests/unit/` integration tests).
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. Collect test files via git ls-files (scoped, ignores node_modules etc.)
// ---------------------------------------------------------------------------

/**
 * Run `git ls-files` with the given glob patterns and return a de-duplicated,
 * sorted list of paths (POSIX separators).
 */
function getTrackedTestFiles() {
  const patterns = ['**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs'];

  try {
    const output = execSync(`git ls-files -- ${patterns.join(' ')}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    return output
      .split('\n')
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter((line) => line.length > 0);
  } catch {
    // Not a git repo or git unavailable — fall back to filesystem scan
    console.warn('[check-orphan-tests] git ls-files failed, falling back to filesystem scan');
    return [];
  }
}

/**
 * Fallback: recursively find test files on disk, skipping known noise dirs.
 */
function findTestFilesOnDisk(dir, results = []) {
  const EXCLUDED = new Set([
    'node_modules',
    'out',
    'dist',
    '.git',
    'coverage',
    'test-output',
    '.meituan-catpaw',
    '.vite',
    '.build-tmp',
    'build',
    'assets',
  ]);

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED.has(entry.name)) {
        findTestFilesOnDisk(fullPath, results);
      }
    } else if (/\.(test|spec)\.(ts|tsx|mjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 1.5 Load path aliases from tsconfig.json
// ---------------------------------------------------------------------------

function loadPathAliases() {
  try {
    const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json');
    const raw = readFileSync(tsconfigPath, 'utf-8');
    // Strip comments so JSON.parse works on tsconfig
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const tsconfig = JSON.parse(stripped);
    const paths = tsconfig?.compilerOptions?.paths ?? {};
    const aliases = [];
    for (const [pattern, targets] of Object.entries(paths)) {
      // pattern: "@/*" → prefix: "@/", replacement: "src/ui/"
      const starIndex = pattern.indexOf('*');
      if (starIndex === -1 || !Array.isArray(targets) || targets.length === 0) continue;
      const prefix = pattern.slice(0, starIndex); // e.g. "@/" or "@shared/"
      const targetStarIndex = targets[0].indexOf('*');
      const replacement =
        targetStarIndex === -1 ? targets[0] : targets[0].slice(0, targetStarIndex);
      aliases.push({ prefix, replacement });
    }
    return aliases;
  } catch {
    // Fallback defaults matching the project's known aliases
    return [
      { prefix: '@/', replacement: 'src/ui/' },
      { prefix: '@shared/', replacement: 'src/shared/' },
      { prefix: '@agentskin/engine', replacement: 'src/engine' },
    ];
  }
}

const PATH_ALIASES = loadPathAliases();

// ---------------------------------------------------------------------------
// 2. Path utility helpers
// ---------------------------------------------------------------------------

/**
 * Parse a compound test filename.
 *
 * `bar.test.ts`   → `{ stem: 'bar', originalExt: 'ts' }`
 * `bar.test.mjs`  → `{ stem: 'bar', originalExt: 'mjs' }`
 * `bar.spec.tsx`  → `{ stem: 'bar', originalExt: 'tsx' }`
 * `bar.mjs`       → `null` (not a test file)
 */
function parseTestFilename(filename) {
  const match = filename.match(/^(.+?)\.(test|spec)\.(ts|tsx|mjs|js|jsx)$/);
  if (!match) return null;
  return { stem: match[1], originalExt: match[3] };
}

/**
 * Given a test file path (POSIX), return an array of candidate source paths
 * (POSIX) that might be the file it tests.  Each candidate is later checked
 * with `existsSync`.
 */
function inferSourceCandidates(testRelPath) {
  const candidates = [];
  const dir = path.posix.dirname(testRelPath);
  const filename = path.posix.basename(testRelPath);
  const parsed = parseTestFilename(filename);

  if (!parsed) {
    // Shouldn't happen for real test files, but guard anyway
    return candidates;
  }

  const { stem, originalExt } = parsed;

  // --- Strategy A: co-located  (src/main/foo/bar.test.ts → src/main/foo/bar.ts) ---
  // Primary: same extension (bar.test.ts → bar.ts)
  candidates.push(path.posix.join(dir, stem + '.' + originalExt));
  // Secondary: try adjacent extensions (bar.test.ts could test .tsx/.mjs/.json in rare cases)
  for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json', '.d.ts']) {
    if (ext.slice(1) !== originalExt) {
      candidates.push(path.posix.join(dir, stem + ext));
    }
  }

  // --- Strategy B: __tests__ directory  (src/ui/__tests__/foo.test.ts → src/ui/foo.ts) ---
  if (dir.includes('/__tests__')) {
    const testsIndex = dir.indexOf('/__tests__');
    const parentSegment = dir.slice(0, testsIndex);
    candidates.push(path.posix.join(parentSegment, stem + '.' + originalExt));
    for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.jsx']) {
      if (ext.slice(1) !== originalExt) {
        candidates.push(path.posix.join(parentSegment, stem + ext));
      }
    }
  }

  // --- Strategy C: tests/<segment>/... → src/<segment>/... ---
  //   tests/main/foo/bar.test.ts     → src/main/foo/bar.ts
  //   tests/shared/types/foo.test.ts → src/shared/types/foo.ts
  //   tests/ui/foo.test.ts           → src/ui/foo.ts
  const testsSegmentMap = [
    ['tests/main/', 'src/main/'],
    ['tests/shared/', 'src/shared/'],
    ['tests/ui/', 'src/ui/'],
    ['tests/lib/', 'src/lib/'],
    ['tests/integrate/', 'src/'],
    ['tests/performance/', 'src/'],
  ];
  for (const [prefix, replacement] of testsSegmentMap) {
    if (testRelPath.startsWith(prefix)) {
      const rest = testRelPath.slice(prefix.length);
      const restDir = path.posix.dirname(rest);
      candidates.push(path.posix.join(replacement, restDir, stem + '.' + originalExt));
      for (const ext of ['.ts', '.tsx', '.mjs']) {
        if (ext.slice(1) !== originalExt) {
          candidates.push(path.posix.join(replacement, restDir, stem + ext));
        }
      }
    }
  }

  // --- Strategy D: tests/unit/... ────────────────────────────────────────
  // Integration-style tests that import from multiple src files.  We can't
  // reliably infer a single source, so we add the most common targets and
  // rely on the import-resolution fallback if none match.
  if (testRelPath.startsWith('tests/unit/')) {
    const rest = testRelPath.slice('tests/unit/'.length);
    const restDir = path.posix.dirname(rest);
    const restBase = path.posix.basename(rest);
    const restParsed = parseTestFilename(restBase);
    const restStem = restParsed
      ? restParsed.stem
      : restBase.replace(/\.(test|spec)\.(ts|tsx|mjs)$/, '');
    const restExt = restParsed ? restParsed.originalExt : 'ts';

    if (restDir === 'scripts' || restDir.startsWith('scripts/')) {
      // tests/unit/scripts/foo.test.ts → scripts/.../foo
      const scriptRest = rest.slice('scripts/'.length);
      const scriptDir = path.posix.dirname(scriptRest);
      candidates.push(path.posix.join('scripts', scriptDir, restStem + '.mjs'));
      candidates.push(path.posix.join('scripts', scriptDir, restStem + '.ts'));
    } else {
      // Best-effort: try src/main/ and src/shared/
      for (const root of ['src/main', 'src/shared']) {
        candidates.push(path.posix.join(root, restDir, restStem + '.' + restExt));
        for (const ext of ['.ts', '.tsx', '.mjs']) {
          candidates.push(path.posix.join(root, restDir, restStem + ext));
        }
      }
    }
  }

  // --- Strategy E: fallback via import resolution ------------------------
  // (applied at runtime in `resolveViaImports`)

  return candidates;
}

// ---------------------------------------------------------------------------
// 3. Import-resolution fallback
// ---------------------------------------------------------------------------

/**
 * Resolve a single import specifier (relative or aliased) to a real file path.
 * Returns true if the specifier points to something that exists on disk.
 */
function checkSpecifier(specifier, testDir) {
  const extensions = ['', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json', '.d.ts'];
  const indexFiles = ['/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

  // Relative import
  if (specifier.startsWith('.')) {
    const resolved = path.posix.normalize(path.posix.join(testDir, specifier));
    for (const ext of extensions) {
      if (existsSync(path.join(PROJECT_ROOT, resolved + ext))) return true;
    }
    for (const idx of indexFiles) {
      if (existsSync(path.join(PROJECT_ROOT, resolved + idx))) return true;
    }
    return false;
  }

  // Path-alias import (@/, @shared/, @agentskin/engine, etc.)
  for (const { prefix, replacement } of PATH_ALIASES) {
    if (specifier.startsWith(prefix)) {
      const aliasedPath = replacement + specifier.slice(prefix.length);
      const resolved = path.posix.normalize(aliasedPath);
      for (const ext of extensions) {
        if (existsSync(path.join(PROJECT_ROOT, resolved + ext))) return true;
      }
      for (const idx of indexFiles) {
        if (existsSync(path.join(PROJECT_ROOT, resolved + idx))) return true;
      }
    }
  }

  return false;
}

/**
 * Parse the test file for import specifiers and check whether any of them
 * resolve to a file on disk.  Returns true if at least one import target
 * exists — meaning the test is anchored to real source.
 */
function resolveViaImports(testRelPath) {
  const absPath = path.join(PROJECT_ROOT, testRelPath);
  let content;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    return false;
  }

  // Collect relative/aliased specifiers from three patterns:
  //   1. `from './foo'`, `import('./baz')`, `await import('../../bar')`, `require('...')`
  //   2. `path.resolve(__dirname, 'manifest-v2.schema.json')` — runtime file resolution
  //   3. `@/...` and `@shared/...` alias imports already handled by checkSpecifier
  const importRegex = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?|from\s+['"]([^'"]+)['"]/g;
  const resolveDirnameRegex = /path\.resolve\s*\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  const testDir = path.posix.dirname(testRelPath);

  // Pattern 1 & 3: import / require specifiers
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;

    // Skip bare node built-ins and external packages
    if (!specifier.startsWith('.') && !PATH_ALIASES.some((a) => specifier.startsWith(a.prefix))) {
      continue;
    }

    if (checkSpecifier(specifier, testDir)) {
      return true;
    }
  }

  // Pattern 2: path.resolve(__dirname, '...')
  while ((match = resolveDirnameRegex.exec(content)) !== null) {
    const relativePath = match[1]; // e.g. 'manifest-v2.schema.json' or '../../../docs/schema.json'
    const resolved = path.posix.normalize(path.posix.join(testDir, relativePath));
    if (existsSync(path.join(PROJECT_ROOT, resolved))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// 3.5 Ignore file (.orphan-tests-ignore)
// ---------------------------------------------------------------------------

/**
 * Load ignore patterns from `.orphan-tests-ignore` at the repo root.
 * Supports one POSIX-style path (or glob) per line; `#` comments and blank
 * lines are ignored.  Patterns are matched against the test file's relative
 * path using simple substring / exact-match semantics.
 */
function loadIgnoreList() {
  const ignoreFile = path.join(PROJECT_ROOT, '.orphan-tests-ignore');
  if (!existsSync(ignoreFile)) return [];
  try {
    const raw = readFileSync(ignoreFile, 'utf-8');
    return raw
      .split('\n')
      .map((line) => line.split('#')[0].trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function isIgnored(testRelPath, ignorePatterns) {
  return ignorePatterns.some(
    (pattern) =>
      testRelPath === pattern ||
      testRelPath.endsWith('/' + pattern) ||
      testRelPath.includes(pattern),
  );
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

function main() {
  let testFiles = getTrackedTestFiles();
  const ignorePatterns = loadIgnoreList();

  // De-duplicate (git may return same file from multiple globs in edge cases)
  testFiles = [...new Set(testFiles)].sort();

  // If git returned nothing (rare), fall back to filesystem scan
  if (testFiles.length === 0) {
    const absFiles = findTestFilesOnDisk(PROJECT_ROOT);
    testFiles = absFiles.map((p) => path.posix.relative(PROJECT_ROOT, p));
  }

  const orphans = [];
  const healthy = [];
  const ignored = [];

  for (const testRel of testFiles) {
    if (isIgnored(testRel, ignorePatterns)) {
      ignored.push(testRel);
      continue;
    }

    const candidates = inferSourceCandidates(testRel);

    let hasSource = false;
    for (const candidate of candidates) {
      if (existsSync(path.join(PROJECT_ROOT, candidate))) {
        hasSource = true;
        break;
      }
    }

    if (!hasSource) {
      // One more chance: maybe the test imports real files directly
      if (resolveViaImports(testRel)) {
        healthy.push(testRel);
        continue;
      }
    }

    if (hasSource) {
      healthy.push(testRel);
    } else {
      orphans.push(testRel);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Output
  // ---------------------------------------------------------------------------

  const report = {
    totalTests: testFiles.length,
    healthy: healthy.length,
    orphans: orphans.length,
    ignored: ignored.length,
    orphanList: orphans,
    ignoredList: ignored,
  };

  console.log(JSON.stringify(report, null, 2));

  if (ignored.length > 0) {
    console.log(
      `\n[check-orphan-tests] INFO: ${ignored.length} test(s) ignored via .orphan-tests-ignore`,
    );
  }

  if (orphans.length > 0) {
    console.error(
      `\n[check-orphan-tests] FAIL: ${orphans.length} orphan test(s) found (no matching source file).`,
    );
    for (const o of orphans) {
      console.error(`  - ${o}`);
    }
    console.error(
      '\nEither delete/relocate these tests, add them to .orphan-tests-ignore, or ensure their source files are restored.',
    );
    process.exit(1);
  }

  console.log(
    `[check-orphan-tests] OK: all ${testFiles.length} test(s) have matching source (${ignored.length} ignored).`,
  );
  process.exit(0);
}

main();
