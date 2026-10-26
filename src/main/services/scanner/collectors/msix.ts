// SPDX-License-Identifier: MPL-2.0

/**
 * # MSIX / Store app collector (scan layer L2.5)
 *
 * Windows Store apps (UWP / MSIX) do NOT write to the traditional Uninstall
 * registry, so the registry sweep (L2) never sees them. This collector
 * enumerates `Get-AppxPackage` (the PowerShell face of
 * `Windows.ApplicationModel.PackageManager`) and keeps the packages that look
 * like desktop apps — specifically ones whose install payload contains a
 * `resources/app(.asar)` Electron marker or a runnable `*.exe`.
 *
 * Satisfied packages are collected as `ScannedApp` with:
 *   - `source: 'msix'` (source rank between registry and shortcut);
 *   - `productName` from the package manifest (`PackageDisplayName`, falling
 *     back to the package family name) — the Store-curated display name;
 *   - `version` from `Package.Version` (always `major.minor.build.rev`);
 *   - `iconHint` pointing at the best-sized Assets PNG (scale/DPI matched) so
 *     `extractAppIcon` can fall back to it when the exe has no usable icon.
 *
 * System packages (Framework, Microsoft's own inbox apps) are filtered to
 * keep the launcher list user-facing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileAsync } from '@shared/exec-async';
import type { ScannedApp } from '@shared/types/agent';
import { mainWarnFromCatch } from '../../../logger';
import { withPsConcurrency } from '../infra/concurrency';
import { hashPath, nameFromExe } from '../util';

/** One parsed Get-AppxPackage hit. */
interface MsixEntry {
  /** Package display name from the manifest (may be empty on old PS 5.1). */
  displayName: string;
  /** `Name` of the package (e.g. `Microsoft.WindowsCalculator`). */
  packageName: string;
  /** Install root under `C:\Program Files\WindowsApps\<PackageFullName>`. */
  location: string;
  /** `major.minor.build.rev` from the package manifest. */
  version: string;
}

/**
 * Build the PowerShell script. One line per package:
 * `DisplayName|Name|InstallLocation|Version|firstExe|assetsDir`
 *
 * Filters applied in-script (cheap, avoids piping hundreds of inbox packages
 * through the pipe):
 *   - `SignatureKind` ≠ System (drops inbox OS packages);
 *   - not a Framework package;
 *   - InstallLocation readable, contains at least one `.exe`.
 * The exe probe is capped (`Select-Object -First 1`) and the Assets dir is
 * resolved only when it exists, so the whole sweep stays within a couple of
 * seconds.
 */
function buildMsixSweepScript(): string {
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Get-AppxPackage | Where-Object {',
    '  $_.SignatureKind -ne [Windows.ApplicationModel.SignatureKind,Windows.ApplicationModel,ContentType=WindowsRuntime]::System -and',
    '  -not $_.IsFramework -and $_.InstallLocation',
    '} | ForEach-Object {',
    '  $root = $_.InstallLocation',
    '  if (-not (Test-Path -LiteralPath $root)) { return }',
    '  $exe = Get-ChildItem -LiteralPath $root -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1',
    '  if (-not $exe) { return }',
    '  $assets = Join-Path $root "Assets"',
    '  $assetsDir = ""',
    '  if (Test-Path -LiteralPath $assets) { $assetsDir = $assets }',
    '  "$($_.DisplayName)|$($_.Name)|$root|$($_.Version)|$($exe.FullName)|$assetsDir"',
    '}',
  ].join('\n');
}

/** Parse one line of the sweep output. */
export function parseMsixLine(
  line: string,
): (MsixEntry & { exePath: string; assetsDir: string }) | null {
  const parts = line.split('|');
  if (parts.length < 6) return null;
  const [displayName, packageName, location, version, exePath, assetsDir] = parts;
  if (!location || !exePath) return null;
  return {
    displayName: displayName.trim(),
    packageName: packageName.trim(),
    location: location.trim(),
    version: version.trim(),
    exePath: exePath.trim(),
    assetsDir: assetsDir.trim(),
  };
}

/**
 * Pick the best icon candidate from an MSIX package's Assets directory.
 * Manifest-declared icons are scale-monikered (`Square44x44Logo.scale-200.png`,
 * `targetsize-256`); we prefer the largest `targetsize-*`, then the largest
 * `scale-*`, then any square PNG. Returns an absolute path or null.
 */
export async function pickMsixIcon(assetsDir: string): Promise<string | null> {
  if (!assetsDir) return null;
  let entries: string[];
  try {
    entries = await fs.readdir(assetsDir);
  } catch {
    return null;
  }
  const pngs = entries.filter((e) => e.toLowerCase().endsWith('.png'));
  if (pngs.length === 0) return null;

  const sizeOf = (name: string): number => {
    const target = name.match(/targetsize-(\d+)/i);
    if (target) return Number.parseInt(target[1] ?? '0', 10);
    const scale = name.match(/scale-(\d+)/i);
    if (scale) {
      // A scale moniker multiplies the base 44/150px layout size; rank the
      // multiplied value so `scale-200` of a 150px logo beats `scale-100`.
      const factor = Number.parseInt(scale[1] ?? '100', 10);
      const base = name.match(/(\d+)x\d+/i);
      return base ? Number.parseInt(base[1] ?? '0', 10) * factor : factor * 44;
    }
    const plain = name.match(/(\d+)x(\d+)/i);
    return plain ? Number.parseInt(plain[1] ?? '0', 10) : 0;
  };

  const ranked = [...pngs].sort((a, b) => sizeOf(b) - sizeOf(a));
  for (const name of ranked) {
    // Prefer logos over taskbar/altform assets when sizes tie.
    if (/logo/i.test(name)) return path.join(assetsDir, name);
  }
  return path.join(assetsDir, ranked[0] ?? '');
}

/** Names that mark a package as infrastructure rather than a user-facing app. */
const SYSTEM_PACKAGE_FRAGMENTS = [
  'microsoft.services.store',
  'microsoft.windows.store',
  'microsoft.store',
  'microsoft.sechealth',
  'microsoft.net.native',
  'microsoft.vclibs',
  'microsoft.ui.xaml',
  'microsoft.winjs',
  'microsoft.advertising',
  'microsoft.services',
  'winjs',
  'xaml',
];

function isSystemPackage(entry: MsixEntry): boolean {
  const hay = `${entry.packageName} ${entry.displayName}`.toLowerCase();
  return SYSTEM_PACKAGE_FRAGMENTS.some((frag) => hay.includes(frag));
}

/**
 * Sweep MSIX packages and collect desktop-looking ones. Windows-only; other
 * platforms return silently. Every failure degrades to "no packages" — a
 * broken Appx service must never fail the whole scan.
 */
export async function scanMsixPackages(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  if (process.platform !== 'win32') return;

  let raw: string;
  try {
    raw = await withPsConcurrency(() =>
      execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', buildMsixSweepScript()],
        15000,
      ),
    );
  } catch (error) {
    mainWarnFromCatch('ElectronScanner', error, 'L2.5 msix sweep');
    return;
  }

  const entries = raw
    .split('\n')
    .map((l) => parseMsixLine(l.trim()))
    .filter((e): e is MsixEntry & { exePath: string; assetsDir: string } => e !== null)
    .filter((e) => !isSystemPackage(e));

  for (const entry of entries) {
    if (isTimedOut()) return;
    const iconHint = await pickMsixIcon(entry.assetsDir);
    const productName =
      entry.displayName || entry.packageName.replace(/\.[^.]+$/, '') || nameFromExe(entry.exePath);
    collect({
      id: hashPath(entry.exePath),
      exePath: entry.exePath,
      productName,
      companyName: entry.packageName.split('.')[0] ?? '',
      version: entry.version || undefined,
      adapterMatch: null,
      iconHint: iconHint ?? undefined,
      source: 'msix',
    });
  }
}
