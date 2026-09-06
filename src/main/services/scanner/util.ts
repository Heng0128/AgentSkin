// SPDX-License-Identifier: MPL-2.0

import { createHash } from 'node:crypto';
import path from 'node:path';

/** Short, collision-resistant fingerprint of an exe path. */
export function hashPath(p: string): string {
  return createHash('sha256').update(p, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Derive a display name from an executable's filename — the last-resort
 * fallback when both PE version info and registry metadata are empty. Electron
 * main binaries almost always mirror the product name (`Discord.exe` →
 * "Discord"), so this beats rendering a blank label.
 */
export function nameFromExe(exePath: string): string {
  return path.basename(exePath, path.extname(exePath)).trim();
}
