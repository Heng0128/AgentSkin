// SPDX-License-Identifier: MPL-2.0

import { execFileAsync } from '../../../../shared/exec-async';
import type { ScannedApp } from '../../../../shared/types/agent';
import { mainWarnFromCatch } from '../../../logger';
import { withPsConcurrency } from '../infra/concurrency';
import { readExeInfo } from '../infra/ps';
import { matchAgainstHints } from '../pipeline/match';
import { hashPath, nameFromExe } from '../util';
import { findAnyExe } from './shared';

/**
 * Build a PowerShell script that returns every Uninstall entry whose install
 * directory contains an `app(.asar)` Electron payload. The install directory
 * is resolved as `InstallLocation` when present, otherwise derived from
 * `DisplayIcon` / `UninstallString` (common for Tencent-installed apps that
 * write DisplayIcon + UninstallString but leave InstallLocation blank).
 *
 * Emits one line per hit: `DisplayName|DisplayVersion|ResolvedLocation`.
 * HKLM + HKCU are covered so that per-user installs (current-user MSIX,
 * non-admin installs) are caught as well.
 */
function buildElectronRegistryScript(): string {
  return [
    // Force UTF-8 stdout so localized DisplayNames (e.g. "文心一言") survive
    // the PowerShell→Node pipe (see readExeInfo note).
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$keys = @(',
    "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    "  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    "  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    ')',
    'Get-ItemProperty $keys -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $loc = $_.InstallLocation',
    "  if ($loc) { $loc = $loc.Trim().Trim('\"') }",
    '  if (-not $loc -and $_.DisplayIcon) {',
    "    $p = ($_.DisplayIcon -split ',')[0].Trim().Trim('\"')",
    '    if ($p) {',
    '      if (Test-Path $p -PathType Container) { $loc = $p }',
    '      else { $loc = Split-Path $p -Parent }',
    '    }',
    '  }',
    '  if (-not $loc -and $_.UninstallString) {',
    '    $us = $_.UninstallString',
    '    if ($us -match \'"([^"]+\\.exe)"\') { $p = $Matches[1] }',
    "    else { $p = ($us -split ' ' | Where-Object { $_ -match '\\.exe$' } | Select-Object -First 1) }",
    "    if ($p) { $p = $p.Trim().Trim('\"'); $loc = Split-Path $p -Parent }",
    '  }',
    '  if ($loc -and (',
    "    (Test-Path (Join-Path $loc 'resources\\app.asar')) -or",
    "    (Test-Path (Join-Path $loc 'resources\\app'))",
    '  )) {',
    '    "$($_.DisplayName)|$($_.DisplayVersion)|$loc"',
    '  }',
    '}',
  ].join('\n');
}

/** Parse one line of PowerShell output: "DisplayName|Version|ResolvedLocation". */
function parseRegistryLine(
  line: string,
): { displayName: string; version: string | null; location: string } | null {
  const [dn, dv, il] = line.split('|');
  const location = (il ?? '').trim();
  if (!location) return null;
  return {
    displayName: (dn ?? '').trim(),
    version: (dv ?? '').trim() || null,
    location,
  };
}

/** Sweep the Uninstall registry for directories that look like Electron apps. */
export async function scanRegistry(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  let raw: string;
  try {
    raw = await withPsConcurrency(() =>
      execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', buildElectronRegistryScript()],
        10000,
      ),
    );
  } catch (error) {
    mainWarnFromCatch('ElectronScanner', error, 'L2 registry sweep');
    return;
  }

  // Parse all lines first.
  const entries = raw
    .split('\n')
    .map((l) => parseRegistryLine(l.trim()))
    .filter(
      (e): e is { displayName: string; version: string | null; location: string } => e !== null,
    );

  // Locate exes in parallel (fs-bound), then read PE info in parallel
  // (PowerShell-bound, the slow part) — serial readExeInfo was the timeout
  // bottleneck when the registry lists many apps.
  const located = await Promise.all(
    entries.map(async (entry) => {
      const exePath = await findAnyExe(entry.location);
      return { entry, exePath };
    }),
  );

  const resolved = await Promise.all(
    located
      .filter((x) => x.exePath !== null)
      .map(async ({ entry, exePath }) => {
        const info = await readExeInfo(exePath as string).catch(() => null);
        return { entry, exePath: exePath as string, info };
      }),
  );

  for (const { entry, exePath, info } of resolved) {
    if (isTimedOut()) return;
    // When the PE read fails, fall back to the registry DisplayName for hint
    // matching instead of dropping the adapter match entirely — the registry
    // name is often the only reliable identity signal (localized names,
    // blocked PowerShell, etc.).
    const adapterInfo = info
      ? matchAgainstHints(info)
      : matchAgainstHints({ productName: entry.displayName, fileDescription: '' });
    collect({
      id: hashPath(exePath),
      exePath,
      productName: info?.productName || entry.displayName || nameFromExe(exePath),
      companyName: info?.companyName ?? '',
      version: info?.version ?? entry.version ?? undefined,
      adapterMatch: adapterInfo,
      source: 'registry',
    });
  }
}
