// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeIntegrity — SHA-256 hash verification for theme packages
 *
 * Provides functions to calculate and verify SHA-256 hashes for all files
 * within a theme package directory. Inspired by CodeDrobe/desktop's
 * marketplace SHA-256 verification.
 *
 * The integrity manifest is stored as `.theme-integrity.json` inside the
 * theme directory. It records the SHA-256 hex digest of every file (excluding
 * itself, `.git`, `node_modules`, and OS noise files).
 *
 * ## Usage
 *
 * ```typescript
 * import { calculateThemeIntegrity, verifyThemeIntegrity } from './theme-integrity';
 *
 * // Generate integrity data
 * const integrity = await calculateThemeIntegrity('/path/to/theme');
 * console.log(integrity.files['manifest.json']); // sha256 hex
 *
 * // Verify against expected
 * const result = await verifyThemeIntegrity('/path/to/theme', integrity.files);
 * if (!result.valid) {
 *   console.error('Mismatches:', result.mismatches);
 * }
 * ```
 *
 * @module shared/theme-integrity
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Integrity manifest filename (stored inside the theme directory). */
export const INTEGRITY_MANIFEST_FILENAME = '.theme-integrity.json';

/** Hash algorithm used for file digests. */
export const HASH_ALGORITHM = 'sha256';

/** Directories and files excluded from integrity calculation. */
const EXCLUDED_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  INTEGRITY_MANIFEST_FILENAME,
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Integrity manifest — maps relative file paths to their SHA-256 hex digests.
 */
export interface ThemeIntegrityManifest {
  /** Hash algorithm (currently "sha256"). */
  algorithm: typeof HASH_ALGORITHM;
  /** ISO 8601 timestamp of when the manifest was generated. */
  generatedAt: string;
  /** Relative file path → SHA-256 hex digest. */
  files: Record<string, string>;
}

/**
 * Result of an integrity verification.
 * Discriminated union on `valid`.
 */
export type IntegrityVerificationResult =
  | {
      /** True when all files match and no extras/missing are found. */
      valid: true;
      /** Relative paths that were checked. */
      checked: string[];
    }
  | {
      /** False when any mismatch, missing, or extra file is detected. */
      valid: false;
      /** Relative paths that were checked. */
      checked: string[];
      /** Files whose digest does not match the expected hash. */
      mismatches: string[];
      /** Files listed in the expected hashes but missing from disk. */
      missing: string[];
      /** Files present on disk but not listed in the expected hashes. */
      extra: string[];
      /** Human-readable summary of all failures. */
      errors: string[];
    };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file's contents.
 * @param filePath - Absolute path to the file.
 * @returns Hex-encoded SHA-256 digest, or null if the file cannot be read.
 */
async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath);
    return createHash(HASH_ALGORITHM).update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Recursively collect all file paths inside a directory.
 * Excludes `.git`, `node_modules`, OS noise, and the integrity manifest itself.
 *
 * @param dir - Absolute directory path.
 * @returns Sorted array of absolute file paths.
 */
async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const info = await stat(fullPath);

    if (info.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (info.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate SHA-256 hashes for all files in a theme directory.
 *
 * Recursively walks the directory, computing a SHA-256 digest for each file.
 * Excludes `.git`, `node_modules`, OS noise files (`.DS_Store`, `Thumbs.db`),
 * and the integrity manifest itself (`.theme-integrity.json`).
 *
 * All relative paths use forward slashes for cross-platform consistency.
 *
 * @param themeDir - Absolute path to the theme directory.
 * @returns Integrity manifest with file hashes and generation timestamp.
 */
export async function calculateThemeIntegrity(themeDir: string): Promise<ThemeIntegrityManifest> {
  const filePaths = await collectFiles(themeDir);
  const files: Record<string, string> = {};

  for (const absPath of filePaths) {
    const hash = await computeFileHash(absPath);
    if (hash === null) continue; // Skip unreadable files
    const relPath = relative(themeDir, absPath).split('\\').join('/');
    files[relPath] = hash;
  }

  return {
    algorithm: HASH_ALGORITHM,
    generatedAt: new Date().toISOString(),
    files,
  };
}

/**
 * Verify a theme directory against expected SHA-256 hashes.
 *
 * Compares current file hashes against the provided expected hashes.
 * Reports mismatches (file modified), missing (file deleted), and extra
 * (new file not in expected) entries.
 *
 * @param themeDir - Absolute path to the theme directory.
 * @param expectedHashes - Map of relative path → expected SHA-256 hex digest.
 * @returns Verification result with details on any failures.
 */
export async function verifyThemeIntegrity(
  themeDir: string,
  expectedHashes: Record<string, string>,
): Promise<IntegrityVerificationResult> {
  const mismatches: string[] = [];
  const missing: string[] = [];
  const extra: string[] = [];
  const checked: string[] = [];
  const errors: string[] = [];

  // Check every file listed in the expected hashes.
  for (const [relPath, expectedHash] of Object.entries(expectedHashes)) {
    checked.push(relPath);
    const absPath = join(themeDir, relPath);
    const actualHash = await computeFileHash(absPath);

    if (actualHash === null) {
      missing.push(relPath);
      errors.push(`file missing: ${relPath}`);
    } else if (actualHash !== expectedHash) {
      mismatches.push(relPath);
      errors.push(`hash mismatch: ${relPath}`);
    }
  }

  // Detect extra files not in the expected hashes.
  const currentFiles = await collectFiles(themeDir);
  const expectedSet = new Set(Object.keys(expectedHashes));
  for (const absPath of currentFiles) {
    const relPath = relative(themeDir, absPath).split('\\').join('/');
    if (!expectedSet.has(relPath)) {
      extra.push(relPath);
      errors.push(`unexpected file: ${relPath}`);
    }
  }

  const valid = mismatches.length === 0 && missing.length === 0 && extra.length === 0;

  return {
    valid,
    checked,
    mismatches,
    missing,
    extra,
    errors,
  };
}
