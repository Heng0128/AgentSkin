// SPDX-License-Identifier: MPL-2.0

/**
 * Main-process filesystem helpers.
 *
 * Centralizes the `mkdir -p + write JSON with trailing newline` and
 * `best-effort log append` patterns that were duplicated across
 * agent-engine-service, settings-service, locale-preferences, and
 * install-detection.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Atomically write `data` as pretty-printed JSON to `file`, creating parent
 * directories as needed. The output is suffixed with a trailing newline to
 * match the existing on-disk format of settings.json / manager-state.json.
 *
 * Atomicity: writes to a temp file in the same directory, then renames it
 * onto the target. NTFS rename is atomic, so a crash during writeFile
 * leaves the original file untouched; a crash after rename leaves the new
 * file fully written. The temp filename embeds PID + random suffix to avoid
 * collisions across concurrent writers.
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    // Best-effort cleanup of the temp file if rename failed (e.g. target
    // locked by another process). The original file is still intact.
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * Append `line` to `file`, creating parent directories as needed. Never
 * throws — log writes must not break the calling operation. Replaces the
 * try/catch + mkdir + appendFile boilerplate in install-detection and
 * agent-engine-service.
 */
export async function appendLogLine(file: string, line: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, 'utf8');
  } catch {
    // Best-effort — never block on log writes.
  }
}
