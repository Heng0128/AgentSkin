// SPDX-License-Identifier: MPL-2.0

/**
 * # Community ZIP Extractor
 *
 * Safe extraction of DreamSkin theme ZIP packages. Guards against:
 *
 * 1. **Path traversal** — every entry's resolved path is verified to stay
 *    within the extraction root (`resolveWithin` pattern). Entries like
 *    `../../etc/passwd` are rejected immediately.
 * 2. **ZIP bomb** — a hard cap on total decompressed size (100 MB) and
 *    entry count (1,000) prevents a small ZIP from exhausting memory or
 *    disk. The size check is enforced incrementally during streaming so
 *    the limit is hit before the full payload lands on disk.
 *
 * Uses `yauzl` (pure JS, no native deps) for streaming random-access reads.
 *
 * ## Lifecycle
 *
 * ```
 * const { extractDir, themeRoot } = await extractThemeZip(zipPath);
 * // ... use themeRoot (contains theme.json) ...
 * cleanupExtractDir(extractDir);
 * ```
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { mainError } from '../logger';

// --- Limits -------------------------------------------------------------------------------

/** Maximum total decompressed size (100 MB). */
const MAX_EXTRACT_SIZE = 100 * 1024 * 1024;

/** Maximum number of entries in a single ZIP. */
const MAX_ENTRY_COUNT = 1000;

/** Prefix for the OS temp directory. */
const TEMP_PREFIX = 'dreamskin-extract-';

// --- Types --------------------------------------------------------------------------------

export interface ExtractResult {
  /** The root extraction directory (temp — must be cleaned up by caller). */
  extractDir: string;
  /** Sub-directory within extractDir that contains `theme.json`. */
  themeRoot: string;
}

// --- Public API ---------------------------------------------------------------------------

/**
 * Safely extract a DreamSkin theme ZIP to a temporary directory.
 *
 * Security checks performed:
 * - Rejects ZIPs with more than {@link MAX_ENTRY_COUNT} entries.
 * - Rejects entries whose resolved path escapes the extraction root
 *   (path-traversal / slip attack).
 * - Rejects entries that would cause total extracted size to exceed
 *   {@link MAX_EXTRACT_SIZE}.
 *
 * @param zipPath - Absolute path to the `.agentskin-theme` ZIP file.
 * @returns The extraction directory and the theme root (containing `theme.json`).
 * @throws Error if the ZIP is malformed, contains unsafe paths, or exceeds size limits.
 */
export async function extractThemeZip(zipPath: string): Promise<ExtractResult> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));

  try {
    return await performExtraction(zipPath, tempDir);
  } catch (error) {
    // Clean up the temp dir on any failure so we don't leak disk space.
    cleanupExtractDir(tempDir);
    throw error;
  }
}

/**
 * Remove a temporary extraction directory and all its contents.
 *
 * Errors are logged but never thrown — cleanup must be non-fatal.
 *
 * @param extractDir - The directory returned by {@link extractThemeZip}.
 */
export function cleanupExtractDir(extractDir: string): void {
  try {
    fs.rmSync(extractDir, { recursive: true, force: true });
  } catch (error) {
    mainError('community-zip', `Failed to cleanup extract dir: ${String(error)}`);
  }
}

// --- Internals ----------------------------------------------------------------------------

/**
 * Core extraction loop. Wraps `yauzl` in a Promise. All entries are streamed
 * concurrently (yauzl handles the sequencing internally).
 */
function performExtraction(zipPath: string, tempDir: string): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    let totalSize = 0;
    let completedEntries = 0;

    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (err: Error | null, zipfile: ZipFile) => {
        if (err) {
          reject(new Error(`Failed to open ZIP: ${err.message}`));
          return;
        }

        if (zipfile.entryCount > MAX_ENTRY_COUNT) {
          reject(new Error(`ZIP contains too many entries: ${zipfile.entryCount}`));
          zipfile.close();
          return;
        }

        zipfile.readEntry();

        zipfile.on('entry', (entry: Entry) => {
          // --- Path traversal check ---
          const resolvedPath = path.resolve(tempDir, entry.fileName);
          if (!isWithinDir(tempDir, resolvedPath)) {
            reject(new Error(`Path traversal detected: ${entry.fileName}`));
            zipfile.close();
            return;
          }

          // --- Directory entry ---
          if (entry.fileName.endsWith('/')) {
            fs.mkdirSync(resolvedPath, { recursive: true });
            zipfile.readEntry();
            return;
          }

          // --- File entry: ensure parent dir, then stream ---
          const parentDir = path.dirname(resolvedPath);
          fs.mkdirSync(parentDir, { recursive: true });

          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) {
              reject(
                new Error(
                  `Failed to read entry "${entry.fileName}": ${readErr.message}`,
                ),
              );
              zipfile.close();
              return;
            }

            const writeStream = fs.createWriteStream(resolvedPath);
            let entrySize = 0;

            readStream.on('data', (chunk: Buffer) => {
              entrySize += chunk.length;
              totalSize += chunk.length;

              // Abort if cumulative size exceeds the bomb limit.
              if (totalSize > MAX_EXTRACT_SIZE) {
                writeStream.destroy();
                // Synchronously remove the partially-written file. Errors here
                // are non-fatal — cleanupExtractDir will handle stragglers.
                try {
                  fs.unlinkSync(resolvedPath);
                } catch {
                  // ignore
                }
                reject(
                  new Error(
                    `Extracted size exceeds ${MAX_EXTRACT_SIZE} byte limit`,
                  ),
                );
                zipfile.close();
              }
            });

            // Pipe read → write; handle completion and errors.
            readStream.pipe(writeStream);

            writeStream.on('finish', () => {
              completedEntries++;
              zipfile.readEntry();
            });

            writeStream.on('error', (writeError) => {
              reject(
                new Error(
                  `Failed to write entry "${entry.fileName}": ${writeError.message}`,
                ),
              );
              zipfile.close();
            });
          });
        });

        zipfile.on('end', () => {
          // Locate the theme root (directory containing theme.json).
          const themeRoot = findThemeRoot(tempDir);
          if (!themeRoot) {
            reject(
              new Error(
                'No valid theme root found in ZIP (missing theme.json)',
              ),
            );
            zipfile.close();
            return;
          }

          resolve({ extractDir: tempDir, themeRoot });
          zipfile.close();
        });

        zipfile.on('error', (zipErr: Error) => {
          reject(
            new Error(`ZIP processing error: ${zipErr.message}`),
          );
        });
      },
    );
  });
}

// --- Helpers ------------------------------------------------------------------------------

/**
 * Check that `filePath` is strictly inside `dir`. Both arguments must be
 * absolute paths. Uses `path.resolve` normalization + `startsWith` so that
 * `../../etc/passwd` escapes are caught even on case-insensitive filesystems.
 */
function isWithinDir(dir: string, filePath: string): boolean {
  const relative = path.relative(dir, filePath);
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

/**
 * Find the directory containing `theme.json` within the extraction root.
 *
 * Checks the root level first, then one level of subdirectories (handles
 * the common case where the ZIP contains a single wrapper folder).
 *
 * @returns Absolute path to the theme root, or `null` if not found.
 */
function findThemeRoot(extractDir: string): string | null {
  if (fs.existsSync(path.join(extractDir, 'theme.json'))) {
    return extractDir;
  }

  const entries = fs.readdirSync(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const candidate = path.join(extractDir, entry.name);
      if (fs.existsSync(path.join(candidate, 'theme.json'))) {
        return candidate;
      }
    }
  }

  return null;
}
