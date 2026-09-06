// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-sha256sums.mjs — Theme package SHA256SUMS.txt generation & verification
 *
 * Generates a `SHA256SUMS.txt` file inside `.agentskin-theme` packages,
 * compatible with the standard `sha256sum` command format:
 *
 *   <sha256-hash>  <filename>
 *
 * (two spaces between hash and filename, matching `sha256sum` output).
 *
 * Covers ALL files in the theme directory recursively, providing a complete
 * integrity manifest for build artifact verification. Inspired by the
 * FeiGe/Codex-Dream-Skin approach.
 *
 * @type {import('node:fs')}
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Name of the checksum file written into the theme package directory. */
export const SHA256SUMS_FILENAME = 'SHA256SUMS.txt';

/** Hash algorithm used for file digests. */
const HASH_ALGORITHM = 'sha256';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths under `dir`, sorted by relative path.
 * Excludes the SHA256SUMS.txt file itself to avoid self-reference.
 *
 * @param {string} dir - Absolute path to the directory to scan.
 * @param {string} [base] - Base path for relative path computation (internal).
 * @returns {string[]} Sorted array of absolute file paths.
 */
function collectFiles(dir, base) {
  const baseDir = base ?? dir;
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else if (entry !== SHA256SUMS_FILENAME) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => {
    const ra = relative(baseDir, a);
    const rb = relative(baseDir, b);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}

/**
 * Compute the SHA-256 hex digest of a file's contents.
 *
 * @param {string} filePath - Absolute path to the file.
 * @returns {string} Hex-encoded SHA-256 digest.
 */
function computeFileHash(filePath) {
  const content = readFileSync(filePath);
  return createHash(HASH_ALGORITHM).update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the SHA256SUMS.txt content for a theme package directory.
 *
 * Returns the text content (without a trailing newline after the last line)
 * and the list of relative paths that were hashed, so callers can verify
 * or write the file as needed.
 *
 * @param {string} pkgDir - Absolute path to the theme package root.
 * @returns {{ content: string, files: string[] }} The checksum file content
 *   and the relative paths of all files included.
 */
export function generateSha256Sums(pkgDir) {
  const files = collectFiles(pkgDir);
  const lines = [];

  for (const filePath of files) {
    const relPath = relative(pkgDir, filePath).split(sep).join('/');
    const hash = computeFileHash(filePath);
    lines.push(`${hash}  ${relPath}`);
  }

  return {
    content: lines.join('\n'),
    files: files.map((f) => relative(pkgDir, f).split(sep).join('/')),
  };
}

/**
 * Write the SHA256SUMS.txt file into the theme package directory.
 *
 * @param {string} pkgDir - Absolute path to the theme package root.
 * @returns {string} The absolute path of the written SHA256SUMS.txt file.
 */
export function writeSha256Sums(pkgDir) {
  const { content } = generateSha256Sums(pkgDir);
  const outputPath = join(pkgDir, SHA256SUMS_FILENAME);
  writeFileSync(outputPath, `${content}\n`, 'utf8');
  return outputPath;
}

/**
 * Parse a SHA256SUMS.txt content into a map of relPath -> expected hash.
 *
 * @param {string} raw - The raw text content of SHA256SUMS.txt.
 * @returns {Map<string, string>} Map of relative path → expected hex digest.
 */
export function parseSha256Sums(raw) {
  const map = new Map();
  const lines = raw.trim().split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    // Format: <64-char-hash>  <filepath>
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (match) {
      map.set(match[2], match[1]);
    }
  }
  return map;
}

/**
 * Verify a theme package against its SHA256SUMS.txt.
 *
 * Checks that:
 * - Every file listed in SHA256SUMS.txt exists and matches its digest.
 * - No additional files exist beyond what's listed (except SHA256SUMS.txt itself).
 *
 * @param {string} pkgDir - Absolute path to the theme package root.
 * @returns {{ valid: boolean, checked: string[], missing: string[],
 *             extra: string[], mismatched: string[], errors: string[] }}
 *   Verification result with details on any failures.
 */
export function verifySha256Sums(pkgDir) {
  const sumsPath = join(pkgDir, SHA256SUMS_FILENAME);
  let raw;
  try {
    raw = readFileSync(sumsPath, 'utf8');
  } catch {
    return {
      valid: false,
      checked: [],
      missing: [],
      extra: [],
      mismatched: [],
      errors: [`${SHA256SUMS_FILENAME} not found`],
    };
  }

  const expected = parseSha256Sums(raw);
  const checked = [];
  const missing = [];
  const extra = [];
  const mismatched = [];
  const errors = [];

  // Check every file listed in SHA256SUMS.txt
  for (const [relPath, expectedHash] of expected) {
    checked.push(relPath);
    const absPath = join(pkgDir, relPath);
    let actualHash;
    try {
      actualHash = computeFileHash(absPath);
    } catch {
      missing.push(relPath);
      errors.push(`listed file missing: ${relPath}`);
      continue;
    }
    if (actualHash !== expectedHash) {
      mismatched.push(relPath);
      errors.push(`file modified: ${relPath}`);
    }
  }

  // Check for extra files not in SHA256SUMS.txt
  const actualFiles = collectFiles(pkgDir);
  for (const absPath of actualFiles) {
    const relPath = relative(pkgDir, absPath).split(sep).join('/');
    if (!expected.has(relPath)) {
      extra.push(relPath);
      errors.push(`unexpected file not in ${SHA256SUMS_FILENAME}: ${relPath}`);
    }
  }

  const valid = missing.length === 0 && extra.length === 0 && mismatched.length === 0;

  return { valid, checked, missing, extra, mismatched, errors };
}
