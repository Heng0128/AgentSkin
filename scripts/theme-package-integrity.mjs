// SPDX-License-Identifier: MPL-2.0
//
// # theme-package-integrity.mjs — Theme package SHA-256 integrity CLI
//
// Calculates and verifies SHA-256 hashes for all files in a theme package
// directory. Inspired by CodeDrobe/desktop's marketplace SHA-256 verification.
//
// Modes:
//   generate   — Calculate hashes for all files and output JSON manifest
//   verify     — Verify current files match a previously generated manifest
//
// Usage:
//   node scripts/theme-package-integrity.mjs <theme-dir> [--verify] [--output <file>]
//
// With --verify: reads existing .theme-integrity.json and checks all files match.
// Without: calculates and prints the integrity manifest as JSON to stdout.
// With --output <file>: writes the manifest to the specified file instead of stdout.
//
// Exit codes:
//   0 — verification passed (or manifest generated successfully)
//   1 — verification failed (mismatches/missing/extra files detected)
//   2 — usage error (missing path, invalid arguments)

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const INTEGRITY_FILENAME = '.theme-integrity.json';
const EXCLUDED_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  INTEGRITY_FILENAME,
]);

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest of a file's contents.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string|null>} Hex digest, or null if unreadable.
 */
async function computeFileHash(filePath) {
  try {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Recursively collect all file paths inside a directory.
 * Excludes .git, node_modules, OS noise, and the integrity manifest itself.
 * @param {string} dir - Absolute directory path.
 * @returns {Promise<string[]>} Sorted array of absolute file paths.
 */
async function collectFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    try {
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        files.push(...(await collectFiles(fullPath)));
      } else if (info.isFile()) {
        files.push(fullPath);
      }
    } catch {
      // Skip files we can't stat
    }
  }

  return files.sort();
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * Calculate integrity manifest for a theme directory.
 * @param {string} dir - Absolute path to the theme directory.
 * @returns {Promise<{algorithm: string, generatedAt: string, files: Record<string, string>}>}
 */
async function generateManifest(dir) {
  const filePaths = await collectFiles(dir);
  const files = {};

  for (const absPath of filePaths) {
    const hash = await computeFileHash(absPath);
    if (hash === null) continue;
    const relPath = relative(dir, absPath).split('\\').join('/');
    files[relPath] = hash;
  }

  return {
    algorithm: 'sha256',
    generatedAt: new Date().toString(),
    files,
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a theme directory against an existing manifest.
 * @param {string} dir - Absolute path to the theme directory.
 * @param {Record<string, string>} expectedHashes - Relative path → expected hash.
 * @returns {{ valid: boolean, mismatches: string[], missing: string[], extra: string[] }}
 */
async function verifyManifest(dir, expectedHashes) {
  const mismatches = [];
  const missing = [];
  const extra = [];

  // Check expected files (normalize keys to forward slashes for cross-platform compat)
  for (const [relPath, expectedHash] of Object.entries(expectedHashes)) {
    const normalized = relPath.split('\\').join('/');
    const absPath = join(dir, normalized);
    const actualHash = await computeFileHash(absPath);
    if (actualHash === null) {
      missing.push(normalized);
    } else if (actualHash !== expectedHash) {
      mismatches.push(normalized);
    }
  }

  // Detect extra files
  const currentFiles = await collectFiles(dir);
  const expectedSet = new Set(Object.keys(expectedHashes));
  for (const absPath of currentFiles) {
    const relPath = relative(dir, absPath).split('\\').join('/');
    if (!expectedSet.has(relPath)) {
      extra.push(relPath);
    }
  }

  const valid = mismatches.length === 0 && missing.length === 0 && extra.length === 0;
  return { valid, mismatches, missing, extra };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const verifyMode = args.includes('--verify');
  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  // Find the positional argument (theme directory path)
  const target = args.find((a, i) => {
    if (a === '--output') return false;
    if (i > 0 && args[i - 1] === '--output') return false;
    return !a.startsWith('--');
  });

  if (!target) {
    console.error(
      'Usage: node scripts/theme-package-integrity.mjs <theme-dir> [--verify] [--output <file>]',
    );
    console.error('');
    console.error('Modes:');
    console.error('  (none)           Calculate SHA-256 hashes and output JSON manifest');
    console.error('  --verify         Verify files against existing .theme-integrity.json');
    console.error('  --output <file>  Write manifest to file instead of stdout');
    process.exit(2);
  }

  const dir = resolve(target);

  // Check directory exists
  try {
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) {
      console.error(`Error: ${dir} is not a directory`);
      process.exit(2);
    }
  } catch {
    console.error(`Error: directory not found: ${dir}`);
    process.exit(2);
  }

  if (verifyMode) {
    // Verify mode: read existing manifest and check
    let manifest;
    try {
      const manifestRaw = await readFile(join(dir, INTEGRITY_FILENAME), 'utf8');
      manifest = JSON.parse(manifestRaw);
    } catch {
      console.error(`Error: ${INTEGRITY_FILENAME} not found or invalid in ${dir}`);
      console.error('Run without --verify first to generate the manifest.');
      process.exit(2);
    }

    const result = await verifyManifest(dir, manifest.files);

    // Output JSON report to stdout
    const report = {
      valid: result.valid,
      checked: Object.keys(manifest.files).length,
      mismatches: result.mismatches,
      missing: result.missing,
      extra: result.extra,
    };
    console.log(JSON.stringify(report, null, 2));

    // Human-readable summary to stderr
    if (result.valid) {
      console.error(`[PASS] All ${report.checked} files verified successfully.`);
    } else {
      console.error(`[FAIL] Verification failed:`);
      if (result.mismatches.length > 0) {
        console.error(
          `  ${result.mismatches.length} modified file(s): ${result.mismatches.join(', ')}`,
        );
      }
      if (result.missing.length > 0) {
        console.error(`  ${result.missing.length} missing file(s): ${result.missing.join(', ')}`);
      }
      if (result.extra.length > 0) {
        console.error(`  ${result.extra.length} unexpected file(s): ${result.extra.join(', ')}`);
      }
    }

    process.exit(result.valid ? 0 : 1);
  } else {
    // Generate mode: calculate hashes
    const manifest = await generateManifest(dir);

    const output = JSON.stringify(manifest, null, 2);

    if (outputFile) {
      const outputPath = resolve(outputFile);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${output}\n`);
      console.error(
        `Generated integrity manifest: ${outputPath} (${Object.keys(manifest.files).length} files)`,
      );
    } else {
      console.log(output);
      console.error(
        `\nCalculated hashes for ${Object.keys(manifest.files).length} files (generatedAt: ${manifest.generatedAt})`,
      );
    }

    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(2);
});
