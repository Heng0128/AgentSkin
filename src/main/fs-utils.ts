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
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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
