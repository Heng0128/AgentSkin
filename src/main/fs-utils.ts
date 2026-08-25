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

import { randomUUID } from 'node:crypto';
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
