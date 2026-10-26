// SPDX-License-Identifier: MPL-2.0

/**
 * # Start-menu shortcut collector (scan layer L3.5)
 *
 * Final safety net of the discovery union: portable / green software that
 * writes neither an Uninstall registry entry (L2) nor lands under a swept
 * install root (L3) still shows up in the Start menu, because that is the one
 * integration every Windows app performs. This collector walks the Start menu
 * `.lnk` files, resolves each shortcut's target through the WScript.Shell COM
 * API, and collects Electron-looking targets the earlier layers missed.
 *
 * `WScript.Shell.CreateShortcut(lnk).TargetPath` is used instead of shelling
 * out per-link: one PowerShell process resolves the whole batch (paths are
 * escaped as doubled single quotes), keeping the sweep within the global PS
 * concurrency budget.
 *
 * An Electron target is confirmed by reading the target directory for
 * `resources/app(.asar)`; non-Electron targets are ignored — this launcher is
 * Electron-only by design. Collected entries carry `source: 'shortcut'`
 * (ranked between msix and filesystem) and the localized `.lnk` display name
 * (filename minus extension), which is exactly the name the user clicks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileAsync } from '@shared/exec-async';
import type { ScannedApp } from '@shared/types/agent';
import { mainWarnFromCatch } from '../../../logger';
import { withPsConcurrency } from '../infra/concurrency';
import { hashPath } from '../util';

/** Start menu roots (per-user + all-users). */
export function startMenuRoots(): string[] {
  const roots: string[] = [];
  const appData = process.env.APPDATA;
  const programData = process.env.ProgramData;
  if (appData) roots.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu'));
  if (programData) {
    roots.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu'));
  }
  return roots;
}

/** Result of resolving one `.lnk`: target exe path + optional icon path. */
export interface ResolvedShortcut {
  lnkPath: string;
  targetPath: string;
  iconPath: string;
}

/**
 * Build a PowerShell script that resolves every `.lnk` under the given roots
 * (depth-unbounded — the Start menu is shallow, ≤ 3 levels in practice) and
 * emits one line per shortcut with a non-empty target:
 * `lnkPath|targetPath|iconPath`.
 */
export function buildShortcutResolveScript(roots: string[]): string {
  const rootArray = roots.map((r) => `'${r.replace(/'/g, "''")}'`).join(',');
  return [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$roots = @(${rootArray})`,
    '$shell = New-Object -ComObject WScript.Shell',
    'foreach ($root in $roots) {',
    '  if (-not (Test-Path -LiteralPath $root)) { continue }',
    '  $lnks = Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue',
    '  foreach ($lnk in $lnks) {',
    '    try {',
    '      $sc = $shell.CreateShortcut($lnk.FullName)',
    '      $target = $sc.TargetPath',
    '      if ($target -and (Test-Path -LiteralPath $target -PathType Leaf)) {',
    '        $icon = $sc.IconLocation',
    "        if ($icon) { $icon = ($icon -split ',')[0] }",
    '        "$($lnk.FullName)|$target|$icon"',
    '      }',
    '    } catch { }',
    '  }',
    '}',
  ].join('\n');
}

/** Parse one line of resolver output. */
export function parseShortcutLine(line: string): ResolvedShortcut | null {
  const parts = line.split('|');
  if (parts.length < 3) return null;
  const [lnkPath, targetPath, iconPath] = parts;
  if (!lnkPath || !targetPath) return null;
  return {
    lnkPath: lnkPath.trim(),
    targetPath: targetPath.trim(),
    iconPath: iconPath.trim(),
  };
}

/**
 * Display name for a resolved shortcut: the localized `.lnk` filename minus
 * its extension ("微信开发者工具.lnk" → "微信开发者工具") — the exact string the
 * user sees in the Start menu.
 */
export function nameFromShortcut(lnkPath: string): string {
  return path
    .basename(lnkPath)
    .replace(/\.lnk$/i, '')
    .trim();
}

/**
 * Whether `targetPath` sits in an Electron payload directory
 * (`resources/app.asar` or `resources/app/` next to the exe).
 */
async function isElectronTarget(targetPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(path.dirname(targetPath), 'resources', 'app.asar'));
    return true;
  } catch {
    // fall through to the app/ directory probe.
  }
  try {
    const stat = await fs.stat(path.join(path.dirname(targetPath), 'resources', 'app'));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Sweep the Start menu and collect Electron apps the earlier layers missed.
 * Only plain-`.exe` targets are collected — MSIX appuser-model shortcuts
 * (target `C:\WINDOWS\explorer.exe` with an AUMID) don't resolve to a leaf exe
 * and are skipped by the leaf check inside the script.
 */
export async function scanStartMenuShortcuts(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  if (process.platform !== 'win32') return;
  const roots = startMenuRoots();
  if (roots.length === 0) return;

  let raw: string;
  try {
    raw = await withPsConcurrency(() =>
      execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', buildShortcutResolveScript(roots)],
        15000,
      ),
    );
  } catch (error) {
    mainWarnFromCatch('ElectronScanner', error, 'L3.5 shortcut sweep');
    return;
  }

  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (isTimedOut()) return;
    const shortcut = parseShortcutLine(line);
    if (!shortcut) continue;
    // Only the exe the shortcut actually launches is a launch target; a
    // DisplayIcon-style icon path (`.ico`, dll index) is carried as iconHint.
    if (!shortcut.targetPath.toLowerCase().endsWith('.exe')) continue;
    if (!(await isElectronTarget(shortcut.targetPath))) continue;

    const iconHint = shortcut.iconPath.toLowerCase().endsWith('.ico')
      ? shortcut.iconPath
      : undefined;
    collect({
      id: hashPath(shortcut.targetPath),
      exePath: shortcut.targetPath,
      productName: nameFromShortcut(shortcut.lnkPath),
      companyName: '',
      adapterMatch: null,
      iconHint,
      source: 'shortcut',
    });
  }
}
