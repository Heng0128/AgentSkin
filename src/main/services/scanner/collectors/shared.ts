// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';

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
