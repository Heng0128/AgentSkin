// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScannedApp } from '../../../../shared/types/agent';
import { readExeInfo } from '../infra/ps';
import { matchAgainstHints } from '../pipeline/match';
import type { ElectronMarker, ScanRoot } from '../types';
import { hashPath, nameFromExe } from '../util';
import { findAnyExe } from './shared';

/**
 * Common install roots where Electron apps are likely to live (Windows).
 *
 * Program Files apps often nest under vendor + version folders
 * (`Quark\7.0.5.931`, `Docker\Docker\frontend`, `ByteDance\douyin\8.2.303`),
 * so those roots descend three levels. LocalAppData / AppData apps nest under
 * a vendor or version folder (`<LocalAppData>\<vendor>\<app>`, e.g. Slack's
 * `slack\app-4.x`, or `Microsoft VS Code\<build-hash>`), so they descend two.
 */
function commonInstallRoots(): ScanRoot[] {
  const roots: ScanRoot[] = [];
  const seen = new Set<string>();
  const push = (p: string | undefined, depth: number) => {
    if (p?.trim() && !seen.has(p.trim())) {
      seen.add(p.trim());
      roots.push({ dir: p.trim(), depth });
    }
  };
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const w6432 = process.env.ProgramW6432;
  const local = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  if (pf) push(pf, 3);
  if (w6432) push(w6432, 3);
  if (pf86) push(pf86, 3);
  if (local) {
    push(path.join(local, 'Programs'), 2);
    push(local, 2);
  }
  if (appData) push(appData, 2);
  // 应用宝（腾讯应用商店）把 QQ NT 等 Electron 应用装在盘符根目录的 `yyb`
  // 下（`<drive>:\yyb\versions\<ver>\resources\app`）。枚举 A–Z，readdir 时
  // 不存在的盘符自然跳过。
  for (let i = 0; i < 26; i++) {
    const drive = String.fromCharCode(65 + i);
    push(`${drive}:\\yyb`, 3);
  }
  return roots;
}

/**
 * Directories to skip while descending. `WindowsApps` holds MSIX packages — a
 * huge, ACL-restricted tree (≈90% of the Program Files sweep) already covered
 * by L1's `Get-AppxPackage`. The rest are system/vendor dirs that never
 * contain a user Electron app but add thousands of needless `readdir` calls.
 * `microsoft visual studio` is skipped because its Electron-based installer UI
 * is not a user-facing app.
 */
const SKIP_DIRS = new Set([
  'windowsapps',
  'common files',
  'windows defender',
  'windows security',
  'windows mail',
  'windows nt',
  'windows portable devices',
  'windows sidebar',
  'windowspowershell',
  'powershell',
  'windows kits',
  'internet explorer',
  'microsoft.net',
  'msbuild',
  'microsoft sql server',
  'dotnet',
  'modifiablewindowsapps',
  'reference assemblies',
  'uninstall information',
  'microsoft office',
  'microsoft shared',
  'microsoft visual studio',
  'iis',
  'wsl',
  'microsoft edge',
  'microsoft edgewebview',
]);

/**
 * App paths to exclude from results — technically Electron but not a
 * user-facing launcher. The Visual Studio Installer (an Electron UI) is the
 * canonical case: it shows up in the Uninstall registry (L2) so the directory
 * blacklist above can't filter it; this path guard catches it at collect time.
 */
const SKIP_APP_PATH_FRAGMENTS = ['microsoft visual studio'];

export function isSkippableApp(exePath: string): boolean {
  const lower = exePath.toLowerCase();
  return SKIP_APP_PATH_FRAGMENTS.some((frag) => lower.includes(frag));
}

/**
 * Multi-signal Electron detection. Returns whether `dir` looks like an
 * Electron app root plus a 0-100 confidence score.
 *
 * Signals (weighted):
 *   - `resources/app.asar`            — strong (60)
 *   - `resources/app/`                — strong (50)
 *   - `resources/app.asar.unpacked/`  — medium (20)
 *   - runtime binaries in the app dir — `electron.exe`, `chrome_100_percent.pak`,
 *     `v8_context_snapshot.bin`       — medium (15 each)
 *   - `resources/app/package.json` with an `electron` dependency or a `main`
 *     entry                          — medium (20)
 *
 * An app is considered Electron when it carries at least one strong signal
 * (confidence >= 50). The score is capped at 100.
 */
async function hasElectronMarker(dir: string): Promise<ElectronMarker> {
  const resourcesDir = path.join(dir, 'resources');
  const isFile = async (p: string) => {
    try {
      return (await fs.stat(p)).isFile();
    } catch {
      return false;
    }
  };
  const isDir = async (p: string) => {
    try {
      return (await fs.stat(p)).isDirectory();
    } catch {
      return false;
    }
  };

  let confidence = 0;

  // Strong signals — the classic Electron payload markers.
  if (await isFile(path.join(resourcesDir, 'app.asar'))) confidence += 60;
  const appDirPath = path.join(resourcesDir, 'app');
  const hasAppDir = await isDir(appDirPath);
  if (hasAppDir) confidence += 50;
  if (await isDir(path.join(resourcesDir, 'app.asar.unpacked'))) confidence += 20;

  // Runtime binaries shipped alongside the main exe (Electron/Chromium).
  for (const runtimeFile of ['electron.exe', 'chrome_100_percent.pak', 'v8_context_snapshot.bin']) {
    if (await isFile(path.join(dir, runtimeFile))) confidence += 15;
  }

  // package.json inside resources/app — an `electron` dependency or a `main`
  // entry is a strong hint that this is a real Electron payload.
  if (hasAppDir) {
    try {
      const pkgRaw = await fs.readFile(path.join(appDirPath, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        main?: string;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps.electron || pkg.main) confidence += 20;
    } catch {
      // Unreadable / invalid package.json — ignore, other signals still count.
    }
  }

  return { isElectron: confidence >= 50, confidence: Math.min(confidence, 100) };
}

/** Probe a confirmed Electron app dir: locate its exe, read PE info, and collect. */
async function collectElectronApp(
  dir: string,
  collect: (app: ScannedApp) => void,
  confidence: number,
): Promise<void> {
  const exePath = await findAnyExe(dir);
  if (!exePath) return;

  const hash = hashPath(exePath);
  // Read PE version info so L3-discovered apps carry the same metadata as
  // L1/L2 (productName, companyName, version, adapterMatch). The global
  // PowerShell concurrency pool (withPsConcurrency) bounds the spawn fan-out,
  // and a failed read degrades gracefully to the exe-filename fallback.
  const info = await readExeInfo(exePath).catch(() => null);
  collect({
    id: hash,
    exePath,
    productName: info?.productName || nameFromExe(exePath),
    companyName: info?.companyName ?? '',
    version: info?.version ?? undefined,
    adapterMatch: info ? matchAgainstHints(info) : null,
    confidence,
    source: 'filesystem',
  });
}

/** Recursively descend `dir` up to `depth` levels looking for Electron apps. */
async function walkDir(
  dir: string,
  depth: number,
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  if (isTimedOut()) return;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (isTimedOut()) return;
    // Skip system/vendor dirs that never contain a user Electron app.
    if (SKIP_DIRS.has(entry.toLowerCase())) continue;
    const sub = path.join(dir, entry);
    try {
      if (!(await fs.stat(sub)).isDirectory()) continue;
    } catch {
      continue;
    }

    const marker = await hasElectronMarker(sub);
    if (marker.isElectron) {
      await collectElectronApp(sub, collect, marker.confidence);
      continue; // an app dir — don't descend into it
    }
    if (depth > 1) {
      await walkDir(sub, depth - 1, collect, isTimedOut);
    }
  }
}

/**
 * Walk each install root (recursing into vendor folders where applicable) and
 * collect every directory carrying an Electron `resources/app(.asar)` payload.
 */
export async function scanFilesystem(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
  extraDirs: string[],
): Promise<void> {
  const roots: ScanRoot[] = [
    ...commonInstallRoots(),
    ...extraDirs.map((dir) => ({ dir, depth: 2 })),
  ];
  for (const root of roots) {
    if (isTimedOut()) return;
    await walkDir(root.dir, root.depth, collect, isTimedOut);
  }
}
