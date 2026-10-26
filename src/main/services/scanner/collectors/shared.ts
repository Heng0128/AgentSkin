// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';
import { productNameFromDir } from '../util';

/**
 * Executable names that are almost never an Electron app's main entry point.
 * Electron/Chromium apps ship several auxiliary binaries alongside the real
 * launcher (uninstallers, crash handlers, PWA shims, elevation helpers); we
 * skip them so the scanner doesn't return the wrong exe (which would also
 * break icon extraction and launching).
 */
const AUX_EXE_KEYWORDS = [
  'unins',
  'uninstall',
  'setup',
  'installer',
  'crashpad',
  'elevation',
  'elevated',
  'notification',
  'helper',
  'maintenance',
  'dxsetup',
  'vcredist',
  'redist',
  'chrome_proxy',
  'chrome_pwa',
  'updater',
  'doctor',
  'reporter',
  'dump',
  'crash',
  'downloader',
  'handler',
  'guard',
];

function isAuxExe(name: string): boolean {
  const lower = name.toLowerCase();
  return AUX_EXE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Locate any executable inside a directory confirmed to be an Electron app
 * (L2/L3 already verified `resources/app.asar` or `resources/app/`). Used by
 * the registry and filesystem sweeps where the directory IS the Electron app
 * but we don't yet know which adapter (if any) it maps to.
 *
 * Three passes, most-specific first:
 *   1. exact directory-name match (`<DirName>.exe`) — Electron main binaries
 *      almost always mirror the install folder name;
 *   2. first non-auxiliary exe (skipping uninstallers / helpers / updaters);
 *   3. fallback to any exe (even an uninstaller) — better than returning null.
 */
export async function findAnyExe(installDir: string): Promise<string | null> {
  // Walk up to two ancestors: some launchers (QQ NT under `C:\yyb\QQ.exe`,
  // Docker Desktop under `...\Docker\Docker\Docker Desktop.exe`) keep their
  // exe outside the `resources/app` directory that L2/L3 discovered.
  const searchDirs = [installDir, path.dirname(installDir), path.dirname(path.dirname(installDir))];

  const isFile = async (candidate: string) => {
    try {
      return (await fs.stat(candidate)).isFile();
    } catch {
      return false;
    }
  };

  // Read all candidate directories up front so passes run globally (across
  // every search dir) rather than per-dir — a shallow directory full of
  // auxiliary exes must not win via the "any exe" fallback before we've had a
  // chance to find the real launcher in an ancestor.
  const dirs: { dir: string; dirName: string; entries: string[] }[] = [];
  for (const dir of searchDirs) {
    try {
      dirs.push({
        dir,
        dirName: path.basename(dir).toLowerCase(),
        entries: await fs.readdir(dir),
      });
    } catch {
      // unreadable dir — skip.
    }
  }

  // Pass 1: exact directory-name match (`<DirName>.exe`).
  for (const { dir, dirName, entries } of dirs) {
    for (const entry of entries) {
      if (entry.toLowerCase() === `${dirName}.exe`) {
        const candidate = path.join(dir, entry);
        if (await isFile(candidate)) return candidate;
      }
    }
  }

  // Pass 2: first non-auxiliary exe (skipping uninstallers / updaters / …).
  for (const { dir, entries } of dirs) {
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.exe')) continue;
      if (isAuxExe(entry)) continue;
      const candidate = path.join(dir, entry);
      if (await isFile(candidate)) return candidate;
    }
  }

  // Pass 3: fallback to any exe (even an uninstaller) — better than null.
  for (const { dir, entries } of dirs) {
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.exe')) continue;
      const candidate = path.join(dir, entry);
      if (await isFile(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * A registry-derived name entry recorded by L2 (the Uninstall sweep) so L3
 * (the filesystem sweep) can backfill a proper product name when the exe's PE
 * version block has no `ProductName`. Both sweeps resolve the exe with the same
 * `findAnyExe`, so keying by the normalized exe path lines them up for the
 * common "exe sits next to `resources/`" layout.
 *
 * `companyName` / `version` are carried alongside `displayName` so that, when
 * L3 backfills, its `identityKey` (normalized `product|company`) matches L2's
 * entry and the same physical app folds into a single tile instead of two.
 */
export interface RegistryNameEntry {
  displayName: string;
  companyName: string;
  version: string | null;
}

/**
 * Normalized-exe-path → L2 registry name entry. Populated during the L2 sweep,
 * consumed by the L3 sweep. Pass `undefined` to disable backfill (e.g. tests
 * that only exercise one layer).
 */
export type RegistryNameIndex = Map<string, RegistryNameEntry>;

/** Lowercase + trim an exe path to use as a stable, case-insensitive index key. */
export function normalizeExeKey(exePath: string): string {
  return exePath.trim().toLowerCase();
}

/**
 * A name-based index key: the lowercased product-folder name derived from a
 * directory (via `productNameFromDir`). L2 and L3 both derive this the same
 * way for the same physical app — even across version sub-folders
 * (`Vendor\App\1.2.3`) — so it lines them up without ever keying on a broad
 * shared ancestor like `C:\Program Files` (which many apps would clobber).
 * Empty when no name-like folder exists.
 */
function productKey(dir: string): string {
  return productNameFromDir(dir).trim().toLowerCase();
}

/**
 * Look up a registry name for an L3-discovered app: first by its exact exe
 * path, then by the derived product-folder name (covers versioned
 * `<App>\<version>` layouts where L2 recorded a different version dir).
 */
export function lookupRegistryName(
  index: RegistryNameIndex | undefined,
  exePath: string,
  dir: string,
): RegistryNameEntry | null {
  if (!index) return null;
  const byExe = index.get(normalizeExeKey(exePath));
  if (byExe) return byExe;
  const key = productKey(dir);
  return key ? (index.get(key) ?? null) : null;
}

/**
 * Insert one registry entry under every key an L3 lookup might use (the
 * resolved exe path plus the derived product-folder name), so L3 reaches it
 * whether it matched by exe or by the product folder it was discovered under.
 */
export function registerInIndex(
  index: RegistryNameIndex,
  entry: RegistryNameEntry,
  exePath: string | null,
  location: string,
): void {
  const keys = new Set<string>();
  if (exePath) keys.add(normalizeExeKey(exePath));
  const key = productKey(location);
  if (key) keys.add(key);
  for (const k of keys) index.set(k, entry);
}
