// SPDX-License-Identifier: MPL-2.0

/**
 * Main-process filesystem helpers.
 *
 * Centralizes the `mkdir -p + write JSON with trailing newline` and
 * `best-effort log append` patterns that were duplicated across
 * agent-engine-service, settings-service, locale-preferences, and
 * install-detection.
 *
 * ## Atomic write protocol (ported from heige-codex-skin-studio)
 *
 * `atomicWriteFile` / `atomicWriteJson` guarantee that a crash or power loss
 * can never leave the target file half-written:
 *
 *   1. Serialize to a temp file in the same directory (PID + randomUUID
 *      suffix to avoid collisions across concurrent writers).
 *   2. fsync the temp file — guarantees the bytes are on persistent storage
 *      before we attempt the rename.
 *   3. rename the temp file onto the target. NTFS/FAT rename is atomic, so a
 *      crash mid-write leaves the original file untouched; a crash after
 *      rename leaves the new file fully written.
 *   4. fsync the parent directory — guarantees the directory entry (the
 *      rename result) is persisted. Without this step a crash after rename
 *      can roll the directory back to its pre-rename state on some filesystems.
 *
 * Crash recovery: a leftover `.<basename>.<pid>.<rand>.tmp` file indicates the
 * write crashed between open and rename. Callers can detect and clean these
 * up on next boot (see theme/store.initialize for an example).
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// DiskFullError
// ---------------------------------------------------------------------------

/**
 * Error thrown when a write operation fails due to insufficient disk space.
 * Carries the original NodeJS error plus a user-facing hint.
 */
export class DiskFullError extends Error {
  readonly code = 'ENOSPC';
  constructor(
    readonly originalError: NodeJS.ErrnoException,
    readonly filePath: string,
  ) {
    super(`磁盘空间不足，无法写入文件 "${path.basename(filePath)}"。请清理磁盘空间后重试。`);
    this.name = 'DiskFullError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * fsync a directory to persist its entries (e.g. after a rename).
 *
 * Best-effort — directory fsync is unsupported on some platforms (notably
 * Windows). The rename itself is still atomic; this step is a durability
 * enhancement, not a correctness requirement.
 */
async function fsyncDir(dir: string): Promise<void> {
  try {
    const handle = await fsp.open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync not supported — ignore.
  }
}

/**
 * Synchronous variant of {@link fsyncDir}.
 */
function fsyncDirSync(dir: string): void {
  try {
    const fd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Directory fsync not supported — ignore.
  }
}

function enospcToDiskFull(error: unknown, file: string): DiskFullError | unknown {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC') {
    return new DiskFullError(error as NodeJS.ErrnoException, file);
  }
  return error;
}

// ---------------------------------------------------------------------------
// atomicWriteFile — generic (string | Buffer) atomic write with fsync
// ---------------------------------------------------------------------------

/**
 * Atomically write `content` to `file`, creating parent directories as needed.
 *
 * See the module-level doc for the full atomic write protocol (temp file →
 * fsync → rename → dir fsync). The temp filename embeds PID + randomUUID to
 * avoid collisions across concurrent writers.
 *
 * On any failure the temp file is removed and the original target is left
 * untouched. ENOSPC errors are wrapped in {@link DiskFullError}.
 */
export async function atomicWriteFile(file: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);

  // Step 1-2: write temp file, then fsync it so the bytes are on disk before
  // we attempt the rename. writeFile accepts string | Buffer natively.
  try {
    await fsp.writeFile(tmp, content);
    const fd = await fsp.open(tmp, 'r+');
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  } catch (error) {
    throw enospcToDiskFull(error, file);
  }

  // Step 3: atomic rename onto target.
  try {
    await fsp.rename(tmp, file);
  } catch (error) {
    const diskFull = enospcToDiskFull(error, file);
    if (diskFull instanceof DiskFullError) throw diskFull;
    // Best-effort cleanup of the temp file if rename failed (e.g. target
    // locked by another process). The original file is still intact.
    await fsp.unlink(tmp).catch(() => {});
    throw error;
  }

  // Step 4: fsync the parent directory to persist the rename result.
  await fsyncDir(dir);
}

// ---------------------------------------------------------------------------
// atomicWriteJson — JSON-specific atomic write (backward-compatible API)
// ---------------------------------------------------------------------------

/**
 * Atomically write `data` as pretty-printed JSON to `file`, creating parent
 * directories as needed. The output is suffixed with a trailing newline to
 * match the existing on-disk format of settings.json / manager-state.json.
 *
 * Delegates to {@link atomicWriteFile} for the full temp-file → fsync →
 * rename → dir-fsync protocol.
 */
export async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  await atomicWriteFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Synchronous variant of {@link atomicWriteJson}. Uses the same atomic write
 * protocol (temp file → fsyncSync → renameSync → dir-fsyncSync).
 */
export function atomicWriteJsonSync(file: string, data: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);

  // Step 1-2: write temp file, then fsync it.
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, `${JSON.stringify(data, null, 2)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    throw enospcToDiskFull(error, file);
  }

  // Step 3: atomic rename onto target.
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    const diskFull = enospcToDiskFull(error, file);
    if (diskFull instanceof DiskFullError) throw diskFull;
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }

  // Step 4: fsync the parent directory to persist the rename result.
  fsyncDirSync(dir);
}

// ---------------------------------------------------------------------------
// writeJsonAtomic — legacy alias (delegates to atomicWriteJson)
// ---------------------------------------------------------------------------

/**
 * Legacy alias for {@link atomicWriteJson}. Retained for backward compatibility
 * with existing callers (agent-engine-service, settings-service,
 * studio-window-state). New code should use {@link atomicWriteJson} directly.
 *
 * @deprecated Use {@link atomicWriteJson} instead.
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await atomicWriteJson(file, data);
}

// ---------------------------------------------------------------------------
// writeJsonAtomicSafe — atomic write with .bak backup & auto-rollback
// ---------------------------------------------------------------------------

/**
 * Atomically write JSON with a `.bak` backup and automatic rollback on failure.
 *
 * ## Protocol
 *
 *   1. If the target file already exists, copy it to `<file>.bak` (best-effort —
 *      a missing source file is not an error).
 *   2. Delegate to {@link atomicWriteJson} for the temp-file → fsync → rename
 *      → dir-fsync protocol.
 *   3. On success: remove the `.bak` file (best-effort).
 *   4. On failure: restore the original file from `<file>.bak` (best-effort),
 *      then re-throw the error.
 *
 * ## When to use
 *
 * Use this instead of {@link atomicWriteJson} when the target file's contents
 * are critical and a failed write must not leave a corrupt/empty file. The
 * `.bak` file provides a recovery point even if the atomic write itself fails
 * mid-rename.
 *
 * @param file  Target file path.
 * @param data  JSON-serialisable data.
 */
export async function writeJsonAtomicSafe(file: string, data: unknown): Promise<void> {
  const bakFile = `${file}.bak`;

  // Step 1: Back up the existing file (if any).
  try {
    await fsp.copyFile(file, bakFile);
  } catch {
    // No existing file to back up — nothing to do.
  }

  try {
    // Step 2: Atomic write.
    await atomicWriteJson(file, data);
    // Step 3: Success — remove the backup.
    await fsp.unlink(bakFile).catch(() => {});
  } catch (error) {
    // Step 4: Failure — attempt rollback from backup.
    try {
      await fsp.copyFile(bakFile, file);
      await fsp.unlink(bakFile).catch(() => {});
    } catch {
      // Rollback failed — leave .bak in place for manual recovery.
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// UTF-8 strict validation
// ---------------------------------------------------------------------------

/**
 * Result of a UTF-8 strict check on a file's contents.
 */
export interface Utf8StrictResult {
  /** Whether the file is valid UTF-8 without BOM. */
  valid: boolean;
  /** True if a UTF-8 BOM was detected at the start of the file. */
  hasBom: boolean;
  /** True if the content required NFC normalization (contained non-NFC sequences). */
  hadNonNfc: boolean;
  /** The NFC-normalized content (only populated when normalization was needed). */
  normalized?: Buffer;
}

/**
 * Check whether a Buffer contains valid UTF-8 without BOM and in NFC form.
 *
 * Performs three checks:
 *   1. BOM detection — rejects files that start with the UTF-8 BOM (EF BB BF).
 *   2. UTF-8 validity — decodes the buffer as UTF-8 and re-encodes to verify
 *      round-trip integrity (catches invalid byte sequences).
 *   3. NFC normalization — detects characters that are not in Unicode NFC form
 *      and provides the normalized version.
 *
 * @param buf  The raw file bytes to validate.
 */
export function checkUtf8Strict(buf: Buffer): Utf8StrictResult {
  // 1. BOM detection.
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (hasBom) {
    return { valid: false, hasBom: true, hadNonNfc: false };
  }

  // 2. UTF-8 validity — decode and re-encode to verify round-trip.
  const decoded = buf.toString('utf8');
  const reEncoded = Buffer.from(decoded, 'utf8');
  if (!buf.equals(reEncoded)) {
    return { valid: false, hasBom: false, hadNonNfc: false };
  }

  // 3. NFC normalization check.
  const nfc = decoded.normalize('NFC');
  if (nfc !== decoded) {
    return { valid: false, hasBom: false, hadNonNfc: true, normalized: Buffer.from(nfc, 'utf8') };
  }

  return { valid: true, hasBom: false, hadNonNfc: false };
}

// ---------------------------------------------------------------------------
// Byte-for-byte verification
// ---------------------------------------------------------------------------

/**
 * Compare two files byte-for-byte using `Buffer.compare`.
 *
 * Reads both files fully into memory and performs a constant-time comparison.
 * For very large files this is acceptable because backup/restore is typically
 * used for configuration files (KB range).
 *
 * @param original  Path to the original file.
 * @param restored  Path to the restored/comparison file.
 * @returns `true` if the files are identical byte-for-byte.
 */
export async function verifyByteForByte(original: string, restored: string): Promise<boolean> {
  const [a, b] = await Promise.all([fsp.readFile(original), fsp.readFile(restored)]);
  return a.length === b.length && Buffer.compare(a, b) === 0;
}

// ---------------------------------------------------------------------------
// Backup manifest types
// ---------------------------------------------------------------------------

/**
 * A single entry in the backup manifest.
 */
export interface BackupEntry {
  /** ISO timestamp when the backup was created. */
  timestamp: string;
  /** SHA-256 hex digest of the backed-up content. */
  sha256: string;
  /** Byte length of the backed-up content. */
  size: number;
  /** Filename of the backup blob (relative to the .backup directory). */
  file: string;
}

/**
 * The backup manifest structure — a JSON file stored at `<dir>/.backup/<basename>.manifest.json`.
 */
export interface BackupManifest {
  /** Schema version for forward compatibility. */
  version: 1;
  /** The original filename this manifest tracks. */
  targetFile: string;
  /** Ordered list of backups, newest first. */
  entries: BackupEntry[];
}

// ---------------------------------------------------------------------------
// Internal helpers for backup/restore
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a Buffer.
 */
function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Get the backup directory and manifest path for a given target file.
 *
 * Backups live in a `.backup` subdirectory alongside the target file:
 *   `<dir>/.backup/<basename>.<timestamp>-<shortHash>.bak`
 *   `<dir>/.backup/<basename>.manifest.json`
 */
function getBackupPaths(filePath: string): {
  backupDir: string;
  manifestFile: string;
  basename: string;
} {
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const backupDir = path.join(dir, '.backup');
  const manifestFile = path.join(backupDir, `${basename}.manifest.json`);
  return { backupDir, manifestFile, basename };
}

/**
 * Read and parse the backup manifest. Returns an empty manifest if none exists.
 */
async function readManifest(manifestFile: string, targetFile: string): Promise<BackupManifest> {
  try {
    const raw = await fsp.readFile(manifestFile, 'utf8');
    const parsed = JSON.parse(raw) as BackupManifest;
    // Basic shape validation.
    if (parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed;
    }
    // Malformed — start fresh.
    return { version: 1, targetFile, entries: [] };
  } catch {
    // No manifest yet or unreadable — start fresh.
    return { version: 1, targetFile, entries: [] };
  }
}

/**
 * Write the backup manifest atomically.
 */
async function writeManifest(manifestFile: string, manifest: BackupManifest): Promise<void> {
  await atomicWriteJson(manifestFile, manifest);
}

// ---------------------------------------------------------------------------
// atomicBackup — create a byte-for-byte verified backup
// ---------------------------------------------------------------------------

/**
 * Result of a successful backup operation.
 */
export interface AtomicBackupResult {
  /** Path to the backup blob file. */
  backupPath: string;
  /** SHA-256 hex digest of the backed-up content. */
  sha256: string;
  /** Byte length of the backed-up content. */
  size: number;
  /** ISO timestamp of the backup. */
  timestamp: string;
}

/**
 * Create a byte-for-byte verified backup of `filePath`.
 *
 * ## Protocol
 *
 *   1. Read the original file into memory.
 *   2. Compute SHA-256 digest and byte length.
 *   3. Write the backup blob to `.backup/<basename>.<timestamp>-<shortHash>.bak`
 *      using the atomic write protocol (temp → fsync → rename → dir-fsync).
 *   4. Read back the backup blob and verify byte-for-byte against the original
 *      buffer. If verification fails, the backup blob is removed and an error
 *      is thrown — we never leave an unverified backup behind.
 *   5. Update the manifest (`.backup/<basename>.manifest.json`) with the new
 *      entry, ordered newest-first.
 *
 * @param filePath  Absolute or relative path to the file to back up.
 * @returns Metadata about the created backup.
 * @throws Error if the source file does not exist or the backup fails verification.
 */
export async function atomicBackup(filePath: string): Promise<AtomicBackupResult> {
  const { backupDir, manifestFile, basename } = getBackupPaths(filePath);

  // Step 1: Read the original file.
  const originalBuf = await fsp.readFile(filePath);

  // Step 2: Compute hash and size.
  const hash = sha256Hex(originalBuf);
  const size = originalBuf.length;
  const timestamp = new Date().toISOString();
  const shortHash = hash.slice(0, 8);
  const backupFileName = `${basename}.${timestamp.replace(/[:.]/g, '-')}-${shortHash}.bak`;
  const backupPath = path.join(backupDir, backupFileName);

  // Step 3: Ensure backup directory exists and write the backup atomically.
  await fsp.mkdir(backupDir, { recursive: true });
  await atomicWriteFile(backupPath, originalBuf);

  // Step 4: Verify byte-for-byte.
  const verifyBuf = await fsp.readFile(backupPath);
  if (originalBuf.length !== verifyBuf.length || Buffer.compare(originalBuf, verifyBuf) !== 0) {
    // Verification failed — remove the corrupt backup.
    await fsp.unlink(backupPath).catch(() => {});
    throw new Error(
      `Backup verification failed for "${filePath}": byte-for-byte mismatch after write`,
    );
  }

  // Step 5: Update manifest.
  const manifest = await readManifest(manifestFile, basename);
  const entry: BackupEntry = { timestamp, sha256: hash, size, file: backupFileName };
  manifest.entries.unshift(entry); // newest first
  manifest.targetFile = basename;
  await writeManifest(manifestFile, manifest);

  return { backupPath, sha256: hash, size, timestamp };
}

// ---------------------------------------------------------------------------
// atomicRestore — restore from the latest backup atomically
// ---------------------------------------------------------------------------

/**
 * Result of a successful restore operation.
 */
export interface AtomicRestoreResult {
  /** Path to the restored file. */
  filePath: string;
  /** The backup entry that was restored from. */
  entry: BackupEntry;
  /** Whether byte-for-byte verification passed after restore. */
  verified: boolean;
}

/**
 * Restore `filePath` from its most recent backup.
 *
 * ## Protocol
 *
 *   1. Read the manifest to find the newest backup entry.
 *   2. Read the backup blob.
 *   3. Write the backup content to the target file using the atomic write
 *      protocol (temp → fsync → rename → dir-fsync).
 *   4. Read back the restored file and verify byte-for-byte against the
 *      backup blob. If verification fails, an error is thrown — the file may
 *      be in an inconsistent state, but the atomic rename guarantees it's
 *      either the old content or the new content, never a partial write.
 *
 * @param filePath  Absolute or relative path to the file to restore.
 * @returns Metadata about the restore operation.
 * @throws Error if no backup exists or verification fails.
 */
export async function atomicRestore(filePath: string): Promise<AtomicRestoreResult> {
  const { manifestFile, basename } = getBackupPaths(filePath);

  // Step 1: Read manifest and find the newest entry.
  const manifest = await readManifest(manifestFile, basename);
  if (manifest.entries.length === 0) {
    throw new Error(`No backups found for "${basename}" — manifest is empty or missing`);
  }
  const entry = manifest.entries[0]; // newest first

  // Step 2: Read the backup blob.
  const backupPath = path.join(path.dirname(manifestFile), entry.file);
  const backupBuf = await fsp.readFile(backupPath);

  // Verify the backup blob itself matches its recorded hash.
  const actualHash = sha256Hex(backupBuf);
  if (actualHash !== entry.sha256) {
    throw new Error(
      `Backup blob integrity check failed for "${entry.file}": hash mismatch (expected ${entry.sha256}, got ${actualHash})`,
    );
  }

  // Step 3: Atomic write to the target file.
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  await atomicWriteFile(filePath, backupBuf);

  // Step 4: Verify byte-for-byte.
  const restoredBuf = await fsp.readFile(filePath);
  const verified =
    restoredBuf.length === backupBuf.length && Buffer.compare(restoredBuf, backupBuf) === 0;

  if (!verified) {
    throw new Error(
      `Restore verification failed for "${filePath}": byte-for-byte mismatch after restore`,
    );
  }

  return { filePath, entry, verified };
}

// ---------------------------------------------------------------------------
// cleanupBackups — retain only the last N backups
// ---------------------------------------------------------------------------

/**
 * Result of a cleanup operation.
 */
export interface CleanupResult {
  /** Number of backup entries removed. */
  removed: number;
  /** Number of backup entries remaining. */
  remaining: number;
}

/**
 * Remove old backups for `filePath`, keeping only the most recent `keepCount`.
 *
 * Deletes both the backup blob files and prunes the manifest entries.
 * Backups are ordered newest-first in the manifest, so we keep the first
 * `keepCount` entries and remove the rest.
 *
 * @param filePath   Absolute or relative path to the original file.
 * @param keepCount  Number of recent backups to retain (default: 5).
 * @returns How many were removed and how many remain.
 */
export async function cleanupBackups(filePath: string, keepCount = 5): Promise<CleanupResult> {
  const { manifestFile } = getBackupPaths(filePath);

  const manifest = await readManifest(manifestFile, path.basename(filePath));
  if (manifest.entries.length <= keepCount) {
    return { removed: 0, remaining: manifest.entries.length };
  }

  const toRemove = manifest.entries.slice(keepCount);
  const backupDir = path.dirname(manifestFile);

  for (const entry of toRemove) {
    const backupPath = path.join(backupDir, entry.file);
    await fsp.unlink(backupPath).catch(() => {});
  }

  manifest.entries = manifest.entries.slice(0, keepCount);
  await writeManifest(manifestFile, manifest);

  return { removed: toRemove.length, remaining: manifest.entries.length };
}

// ---------------------------------------------------------------------------
// appendLogLine — best-effort log append (unchanged)
// ---------------------------------------------------------------------------

/**
 * Append `line` to `file`, creating parent directories as needed. Never
 * throws — log writes must not break the calling operation. Replaces the
 * try/catch + mkdir + appendFile boilerplate in install-detection and
 * agent-engine-service.
 */
export async function appendLogLine(file: string, line: string): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, line, 'utf8');
  } catch {
    // Best-effort — never block on log writes.
  }
}
