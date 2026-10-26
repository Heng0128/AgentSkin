// SPDX-License-Identifier: MPL-2.0
//
// # verify-theme-sha256.mjs — .agentskin-theme SHA256SUMS.txt generator and verifier.
//
// Generates a `SHA256SUMS.txt` file inside a `.agentskin-theme` directory by
// hashing every file in the package (excluding SHA256SUMS.txt itself and any
// `.DS_Store` / `Thumbs.db` noise). The output follows the standard
// `<hash>  <filename>` format (two spaces, relative path) so it can be checked
// with the system `sha256sum -c` tool on Unix-like systems.
//
// Can also verify an existing SHA256SUMS.txt against the current file contents
// to detect tampering or accidental modification.
//
// Usage:
//   node scripts/verify-theme-sha256.mjs <path-to-.agentskin-theme> [--check]
//
// With --check: reads existing SHA256SUMS.txt and verifies all files still match.
// Without: generates/overwrites SHA256SUMS.txt with current hashes.

import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const SUMS_FILE = 'SHA256SUMS.txt';
const EXCLUDED = new Set([SUMS_FILE, '.DS_Store', 'Thumbs.db']);

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute SHA256 hex digest of a file's contents.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Promise<string>} Hex-encoded SHA256 digest.
 */
async function hashFile(filePath) {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Recursively collect all file paths inside a directory, excluding noise files.
 * @param {string} dir - Absolute directory path.
 * @returns {Promise<string[]>} Sorted array of absolute file paths.
 */
async function collectFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files.sort();
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * Generate SHA256SUMS.txt content for a directory.
 * @param {string} dir - Absolute path to .agentskin-theme directory.
 * @returns {Promise<string>} The full SHA256SUMS.txt content.
 */
async function generateSums(dir) {
  const files = await collectFiles(dir);
  const lines = [];
  for (const file of files) {
    const hash = await hashFile(file);
    const rel = relative(dir, file);
    lines.push(`${hash}  ${rel}`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Parse a SHA256SUMS.txt file into a map of relative path → expected hash.
 * @param {string} content - File content.
 * @returns {Map<string, string>} Relative path → expected hash.
 */
function parseSums(content) {
  const map = new Map();
  for (const line of content.split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trim());
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

/**
 * Verify current files against an existing SHA256SUMS.txt.
 * @param {string} dir - Absolute path to .agentskin-theme directory.
 * @param {string} sumsContent - Existing SHA256SUMS.txt content.
 * @returns {Promise<{ passed: string[], failed: string[], missing: string[] }>}
 */
async function verifySums(dir, sumsContent) {
  const expected = parseSums(sumsContent);
  const passed = [];
  const failed = [];
  const missing = [];

  for (const [rel, expHash] of expected) {
    const full = join(dir, rel);
    try {
      const actual = await hashFile(full);
      if (actual === expHash) passed.push(rel);
      else failed.push(rel);
    } catch {
      missing.push(rel);
    }
  }

  return { passed, failed, missing };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');
  const target = args.find((a) => !a.startsWith('--'));

  if (!target) {
    console.error(
      'Usage: node scripts/verify-theme-sha256.mjs <path-to-.agentskin-theme> [--check]',
    );
    process.exit(1);
  }

  const dir = resolve(target);
  await stat(dir); // throws if missing

  if (checkMode) {
    const sumsFile = join(dir, SUMS_FILE);
    const sumsContent = await readFile(sumsFile, 'utf8');
    const result = await verifySums(dir, sumsContent);
    console.log(`Passed: ${result.passed.length}`);
    console.log(`Failed: ${result.failed.length}`);
    console.log(`Missing: ${result.missing.length}`);
    if (result.failed.length > 0) {
      console.log('Failed files:');
      for (const f of result.failed) console.log(`  ${f}`);
    }
    if (result.missing.length > 0) {
      console.log('Missing files:');
      for (const f of result.missing) console.log(`  ${f}`);
    }
    process.exit(result.failed.length + result.missing.length > 0 ? 1 : 0);
  } else {
    const content = await generateSums(dir);
    await writeFile(join(dir, SUMS_FILE), content);
    console.log(`Generated ${SUMS_FILE} (${content.trim().split('\n').length} files)`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
