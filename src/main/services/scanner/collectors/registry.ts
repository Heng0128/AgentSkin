// SPDX-License-Identifier: MPL-2.0

import { normalizeProductName } from '@shared/app-identity';
import { execFileAsync } from '@shared/exec-async';
import type { ScannedApp } from '@shared/types/agent';
import { mainWarnFromCatch } from '../../../logger';
import { withPsConcurrency } from '../infra/concurrency';
import { readExeInfo, readExeInfosBatch } from '../infra/ps';
import { matchAgainstHints } from '../pipeline/match';
import { hashPath, nameFromExe } from '../util';
import { findAnyExe, type RegistryNameIndex, registerInIndex } from './shared';

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
    '  if ($loc) {',
    '    $payload = $null',
    "    if ((Test-Path (Join-Path $loc 'resources\\app.asar')) -or (Test-Path (Join-Path $loc 'resources\\app'))) { $payload = $loc } else {",
    "      $payload = Get-ChildItem -LiteralPath $loc -Directory -ErrorAction SilentlyContinue | Where-Object { (Test-Path (Join-Path $_.FullName 'resources\\app.asar')) -or (Test-Path (Join-Path $_.FullName 'resources\\app')) } | Select-Object -First 1 | ForEach-Object { $_.FullName }",
    '    }',
    '    if ($payload) { "$($_.DisplayName)|$($_.DisplayVersion)|$payload" }',
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
  index?: RegistryNameIndex,
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
    // Record this entry under BOTH the resolved exe and the payload directory
    // (with its ancestor candidates) so the L3 sweep backfills it whether it
    // matched the same exe or discovered the same install from a versioned
    // sub-folder. The registry DisplayName is the authoritative human name;
    // carry the PE company/version so L3's identity key stays aligned with
    // L2's for the same physical app.
    if (index) {
      registerInIndex(
        index,
        {
          displayName: entry.displayName,
          companyName: info?.companyName ?? '',
          version: info?.version ?? entry.version ?? null,
        },
        exePath,
        entry.location,
      );
    }
    // When the PE read fails, fall back to the registry DisplayName for hint
    // matching instead of dropping the adapter match entirely — the registry
    // name is often the only reliable identity signal (localized names,
    // blocked PowerShell, etc.).
    const adapterInfo = info
      ? matchAgainstHints(info)
      : matchAgainstHints({ productName: entry.displayName, fileDescription: '' });
    // Name resolution chain (most-authoritative first):
    //   registry DisplayName → PE ProductName → PE FileDescription → exe basename.
    // FileDescription ("WeChat" rather than "WeChat.exe") beats the raw exe
    // filename when both higher signals are empty.
    const productName =
      entry.displayName ||
      info?.productName ||
      (info?.fileDescription || '').trim() ||
      nameFromExe(exePath);
    collect({
      id: hashPath(exePath),
      exePath,
      productName,
      companyName: info?.companyName ?? '',
      version: info?.version ?? entry.version ?? undefined,
      adapterMatch: adapterInfo,
      source: 'registry',
    });
  }
}

/**
 * Whether a registry entry's DisplayName corresponds to a product already
 * discovered by L1. The v2 sweep skips re-reading PE info for these because the
 * known-agent probe already carries authoritative identity + version.
 */
export function shouldSkipRegistryEntry(
  displayName: string,
  knownProducts: ReadonlySet<string>,
): boolean {
  return knownProducts.has(normalizeProductName(displayName));
}

/**
 * v2 registry sweep — identical discovery to {@link scanRegistry}, but:
 *   - filters out entries already found by L1 (via {@link shouldSkipRegistryEntry});
 *   - reads PE version info in batches (`readExeInfosBatch`) instead of one
 *     PowerShell process per exe.
 *
 * The collect semantics (adapter match fallback, name/version fallbacks,
 * `source: 'registry'`) match v1 verbatim.
 */
export async function scanRegistryV2(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
  knownProducts?: ReadonlySet<string>,
  index?: RegistryNameIndex,
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

  const skip = knownProducts ?? new Set<string>();
  const entries = raw
    .split('\n')
    .map((l) => parseRegistryLine(l.trim()))
    .filter(
      (e): e is { displayName: string; version: string | null; location: string } => e !== null,
    )
    .filter((entry) => !shouldSkipRegistryEntry(entry.displayName, skip));

  const located = await Promise.all(
    entries.map(async (entry) => {
      const exePath = await findAnyExe(entry.location);
      return { entry, exePath };
    }),
  );

  const withExe = located.filter((x) => x.exePath !== null);
  const infoMap = await readExeInfosBatch(withExe.map((x) => x.exePath as string));

  for (const { entry, exePath } of withExe) {
    if (isTimedOut()) return;
    const info = infoMap.get(exePath as string) ?? null;
    // Record under exe + payload-directory keys so L3 backfills by either
    // (see `registerInIndex`).
    if (index) {
      registerInIndex(
        index,
        {
          displayName: entry.displayName,
          companyName: info?.companyName ?? '',
          version: info?.version ?? entry.version ?? null,
        },
        exePath as string,
        entry.location,
      );
    }
    // When the PE read fails, fall back to the registry DisplayName for hint
    // matching instead of dropping the adapter match entirely — the registry
    // name is often the only reliable identity signal (localized names,
    // blocked PowerShell, etc.).
    const adapterInfo = info
      ? matchAgainstHints(info)
      : matchAgainstHints({ productName: entry.displayName, fileDescription: '' });
    // Name resolution chain (most-authoritative first):
    //   registry DisplayName → PE ProductName → PE FileDescription → exe basename.
    const productName =
      entry.displayName ||
      info?.productName ||
      (info?.fileDescription || '').trim() ||
      nameFromExe(exePath as string);
    collect({
      id: hashPath(exePath as string),
      exePath: exePath as string,
      productName,
      companyName: info?.companyName ?? '',
      version: info?.version ?? entry.version ?? undefined,
      adapterMatch: adapterInfo,
      source: 'registry',
    });
  }
}
