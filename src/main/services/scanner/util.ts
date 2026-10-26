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

/**
 * Whether a path segment names a version/build id rather than a product.
 * Skipped when deriving a display name from the install directory:
 *   - `7.1.7.975` / `8.5.1` — pure dotted numbers;
 *   - `app-4.0.0` / `electron-1.2.3` — a word with a dotted-version tail;
 *   - `a5b5009513` — a long hex build id (VS Code's per-build folder).
 */
function isVersionLikeSegment(segment: string): boolean {
  if (/^\d+(\.\d+)*$/.test(segment)) return true;
  if (/[0-9]+\.[0-9]+/.test(segment)) return true; // `app-4.0.0`, `1.2`
  return /^[0-9a-f]{8,}$/.test(segment.toLowerCase()); // hex build id
}

/**
 * Derive a product name from an install directory: the basename of the nearest
 * ancestor whose name is NOT a version/build-number segment. Electron apps
 * installed as `<Vendor>\<App>\<version>\` keep the real product name in the
 * `<App>` folder, while the exe sits in the version subfolder and is often
 * named after the version or a build hash (`apollocmd.exe`, `a5b5009513`) — so
 * the folder (not the exe) is the name to show.
 *
 * `C:\PF\Quark\7.1.7.975` → "Quark"; `C:\PF\slack\app-4.0.0` → "slack";
 * `C:\...\Microsoft VS Code\a5b5009513` → "Microsoft VS Code". Returns '' when
 * every segment up to 4 levels up is version/hash-like (nothing name-like).
 */
export function productNameFromDir(dir: string): string {
  let cur = dir;
  for (let i = 0; i < 4; i += 1) {
    const base = path.basename(cur).trim();
    if (base && !isVersionLikeSegment(base)) return base;
    const parent = path.dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  return '';
}
