// SPDX-License-Identifier: MPL-2.0

/**
 * # BuildFingerprint — theme package integrity verification
 *
 * Generates and verifies a `build.fingerprint.json` file inside `.agentskin-theme`
 * packages. The fingerprint covers the core files that define a theme's visual
 * behavior and metadata, detecting tampering or local corruption.
 *
 * Fingerprinted files (the AgentSkin equivalent of DSH's tokens.css/cosmetic.css/
 * adapter.mjs/manifest.json):
 *   - `manifest.json` — theme metadata, colors, targets
 *   - `assets/css/<agentId>.css` — per-agent injection CSS (one per supported agent)
 *
 * Only the 6 supported adapters are fingerprinted: traework, qoderwork, workbuddy,
 * doubao, codex, zcode.
 *
 * @module shared/theme-build-fingerprint
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fingerprint schema version (forward compatibility). */
export const BUILD_FINGERPRINT_VERSION = 1;

/** Hash algorithm used for file digests. */
export const HASH_ALGORITHM = 'sha256';

/** The 6 supported adapter ids — single source of truth for fingerprint scope. */
export const SUPPORTED_AGENT_IDS = [
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
] as const;

export type SupportedAgentId = (typeof SUPPORTED_AGENT_IDS)[number];

/** Relative path of the fingerprint file inside a theme package. */
export const FINGERPRINT_FILENAME = 'build.fingerprint.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single file entry in the fingerprint (relative path → hex digest). */
export interface FingerprintFileEntry {
  /** SHA-256 hex digest of the file contents. */
  hash: string;
  /** File size in bytes at fingerprint creation time. */
  size: number;
}

/**
 * Build fingerprint — written to `build.fingerprint.json` inside the theme
 * package directory at build time.
 */
export interface BuildFingerprint {
  /** Schema version (currently 1). */
  version: typeof BUILD_FINGERPRINT_VERSION;
  /** Hash algorithm (currently "sha256"). */
  algorithm: typeof HASH_ALGORITHM;
  /** Relative file path → digest entry. */
  files: Record<string, FingerprintFileEntry>;
  /** ISO 8601 timestamp of when the fingerprint was generated. */
  createdAt: string;
}

/**
 * Result of a fingerprint verification.
 * Discriminated union on `valid`: when `true`, only `checked` is present;
 * when `false`, detailed failure info is available.
 */
export type FingerprintVerificationResult =
  | {
      /** True when all fingerprinted files match their recorded digests. */
      valid: true;
      /** Relative paths that were checked. */
      checked: string[];
    }
  | {
      /** False when any file is missing, extra, or has a mismatched digest. */
      valid: false;
      /** Relative paths that were checked. */
      checked: string[];
      /** Files listed in the fingerprint but missing from disk. */
      missing: string[];
      /** Files present on disk but not listed in the fingerprint. */
      extra: string[];
      /** Files whose digest does not match the fingerprint. */
      mismatched: string[];
      /** Human-readable summary of all failures. */
      errors: string[];
    };

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file's contents.
 * Returns null if the file cannot be read.
 */
export async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath);
    return createHash(HASH_ALGORITHM).update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Get file size in bytes, or null if the file doesn't exist.
 */
export async function getFileSize(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Discover the CSS files that should be fingerprinted for a given set of agents.
 * Only includes files that actually exist on disk.
 *
 * @param packagePath - Absolute path to the theme package root.
 * @param agentIds - Agent ids to look for CSS files.
 * @returns Map of relative path → absolute path for existing CSS files.
 */
async function discoverCssFiles(
  packagePath: string,
  agentIds: readonly string[],
): Promise<Map<string, string>> {
  const cssFiles = new Map<string, string>();
  const cssDir = join(packagePath, 'assets', 'css');

  // Read the CSS directory — may not exist if the package has no CSS files.
  let entries: string[];
  try {
    entries = await readdir(cssDir);
  } catch {
    return cssFiles;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.css')) continue;
    const agentId = entry.replace(/\.css$/, '');
    if (!agentIds.includes(agentId)) continue;
    const relPath = `assets/css/${entry}`;
    cssFiles.set(relPath, join(cssDir, entry));
  }

  return cssFiles;
}

/**
 * Generate a `BuildFingerprint` for a theme package directory.
 *
 * Hashes `manifest.json` and each `assets/css/<agentId>.css` for the supported
 * agents that exist on disk. CSS files for agents not present in the package
 * are silently skipped (a theme may target only a subset of the 6 agents).
 *
 * @param packagePath - Absolute path to the theme package root.
 * @returns The generated fingerprint.
 * @throws Error if manifest.json cannot be read.
 */
export async function generateBuildFingerprint(packagePath: string): Promise<BuildFingerprint> {
  const files: Record<string, FingerprintFileEntry> = {};

  // 1. Hash manifest.json
  const manifestPath = join(packagePath, 'manifest.json');
  const manifestHash = await computeFileHash(manifestPath);
  if (manifestHash === null) {
    throw new Error(`[build-fingerprint] manifest.json not found in ${packagePath}`);
  }
  const manifestSize = (await getFileSize(manifestPath)) ?? 0;
  files['manifest.json'] = { hash: manifestHash, size: manifestSize };

  // 2. Hash each supported agent's CSS file
  const cssFiles = await discoverCssFiles(packagePath, SUPPORTED_AGENT_IDS);
  for (const [relPath, absPath] of cssFiles) {
    const hash = await computeFileHash(absPath);
    if (hash === null) continue; // Shouldn't happen since we just discovered it
    const size = (await getFileSize(absPath)) ?? 0;
    files[relPath] = { hash, size };
  }

  return {
    version: BUILD_FINGERPRINT_VERSION,
    algorithm: HASH_ALGORITHM,
    files,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a theme package against its `build.fingerprint.json`.
 *
 * Checks that:
 * - Every file listed in the fingerprint exists and matches its digest.
 * - No extra CSS files exist for supported agents that aren't in the fingerprint
 *   (this catches injection of unauthorized CSS).
 *
 * A package without a `build.fingerprint.json` is considered valid (backward
 * compatibility — older themes and hand-authored packages may not have one).
 *
 * @param packagePath - Absolute path to the theme package root.
 * @returns Verification result with details on any failures.
 */
export async function verifyBuildFingerprint(
  packagePath: string,
): Promise<FingerprintVerificationResult> {
  const fingerprintPath = join(packagePath, FINGERPRINT_FILENAME);

  // Read the fingerprint file — if absent, skip verification (valid by default).
  let raw: string;
  try {
    raw = await readFile(fingerprintPath, 'utf8');
  } catch {
    return { valid: true, checked: [] };
  }

  // Parse the fingerprint.
  let fingerprint: BuildFingerprint;
  try {
    fingerprint = JSON.parse(raw) as BuildFingerprint;
  } catch {
    return {
      valid: false,
      checked: [],
      missing: [],
      extra: [],
      mismatched: [],
      errors: [`${FINGERPRINT_FILENAME} is not valid JSON`],
    };
  }

  // Basic schema validation.
  if (
    fingerprint.version !== BUILD_FINGERPRINT_VERSION ||
    fingerprint.algorithm !== HASH_ALGORITHM ||
    typeof fingerprint.files !== 'object' ||
    fingerprint.files === null
  ) {
    return {
      valid: false,
      checked: [],
      missing: [],
      extra: [],
      mismatched: [],
      errors: [`${FINGERPRINT_FILENAME} has an unsupported schema`],
    };
  }

  const missing: string[] = [];
  const extra: string[] = [];
  const mismatched: string[] = [];
  const checked: string[] = [];
  const errors: string[] = [];

  // Check every file listed in the fingerprint.
  for (const [relPath, entry] of Object.entries(fingerprint.files)) {
    checked.push(relPath);
    const absPath = join(packagePath, relPath);
    const hash = await computeFileHash(absPath);
    if (hash === null) {
      missing.push(relPath);
      errors.push(`fingerprinted file missing: ${relPath}`);
      continue;
    }
    if (hash !== entry.hash) {
      mismatched.push(relPath);
      errors.push(`fingerprinted file modified: ${relPath}`);
    }
  }

  // Check for extra CSS files not in the fingerprint (potential injection).
  const cssFiles = await discoverCssFiles(packagePath, SUPPORTED_AGENT_IDS);
  for (const [relPath] of cssFiles) {
    if (!(relPath in fingerprint.files)) {
      extra.push(relPath);
      errors.push(`unexpected CSS file not in fingerprint: ${relPath}`);
    }
  }

  const valid = missing.length === 0 && extra.length === 0 && mismatched.length === 0;

  return {
    valid,
    checked,
    missing,
    extra,
    mismatched,
    errors,
  };
}
