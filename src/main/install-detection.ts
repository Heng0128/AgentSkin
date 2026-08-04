// SPDX-License-Identifier: MPL-2.0

/**
 * # Install Detection (AgentSkin-side, Windows)
 *
 * @agentskin/engine's `discoverApp` is the execution-layer detector and must
 * NOT be modified for this fix. AgentSkin adds its own install-location
 * detection (filesystem paths + Uninstall registry keys) so that an installed
 * agent is reported as detected even when it is not currently running. The
 * result is merged into `AppStatus` by agent-engine-service.
 *
 * This module is main-process only (uses child_process / fs / os).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallHints } from '../adapters/base';
import { toMessage } from '../shared/errors';
import { type ExecFileResult, execFileAsync } from '../shared/exec-async';
import { appendLogLine } from './fs-utils';

export interface InstallDetection {
  installed: boolean;
  /** Detected install directory (or executable directory). */
  path: string | null;
  /** Detected product version (typically from the exe or registry). */
  version: string | null;
  /** Which signal confirmed the install. */
  source: 'path' | 'registry' | 'core' | null;
}

export interface DetectInstallationOptions {
  platform: string;
  /** Manual install-location override (from settings). Wins over auto-scan. */
  appPath?: string | null;
  /** Per-adapter detection hints supplied by the adapter identity. */
  hints: InstallHints | undefined;
  /** Human-readable product name, used for the detection log. */
  displayName: string;
  /** When provided, a human-readable detection report is appended here. */
  logFile?: string | null;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

// execFileAsync is imported from ../shared/exec-async — see that module for
// the rationale (Windows-friendly defaults, uniform empty-string-on-error).

/** Read FileVersion + ProductVersion + ProductName + FileDescription of an exe. */
async function readExeInfo(
  exePath: string,
  logFile?: string | null,
): Promise<{ version: string | null; productName: string; fileDescription: string } | null> {
  const literal = exePath.replace(/'/g, "''");
  // NOTE: single-quoted JS strings — `$` is literal, no template interpolation.
  const script = [
    `$v = (Get-Item -LiteralPath '${literal}').VersionInfo`,
    '"$($v.FileVersion)|$($v.ProductVersion)|$($v.ProductName)|$($v.FileDescription)"',
  ].join('\n');
  const res: ExecFileResult = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    8000,
    { includeStderr: true },
  );
  // P3-8 / N13: When the PowerShell call barfs (execution policy, missing
  // binary, path containing special chars) stderr used to be silently
  // dropped — callers got back empty stdout and inferred "not installed"
  // with no breadcrumb. Now we log stderr (and the underlying err message)
  // to the detection log so it's clear why detection failed.
  if ((!res.stdout.trim() || res.errorMessage) && (res.stderr || res.errorMessage) && logFile) {
    await appendLogLine(
      logFile,
      `[${new Date().toISOString()}] [readExeInfo] ${exePath}: ${res.errorMessage ? `${res.errorMessage}; ` : ''}stderr=${res.stderr.trim() || '(empty)'}`,
    ).catch(() => undefined);
  }
  const line = res.stdout.trim();
  if (!line) return null;
  const [fileVersion, productVersion, productName, fileDescription] = line.split('|');
  const version = (fileVersion || productVersion || '').trim() || null;
  return {
    version,
    productName: (productName || '').trim(),
    fileDescription: (fileDescription || '').trim(),
  };
}

function matchesIdentity(
  info: { productName: string; fileDescription: string },
  hints: InstallHints,
): boolean {
  const haystack = `${info.productName} ${info.fileDescription}`.toLowerCase();
  const tokens = [...hints.registryNames, ...hints.dirNames].map((s) => s.toLowerCase());
  // N5: The original `haystack.includes(token)` matched any SUBSTRING, so
  // short tokens like "code" or "qoder" would fire on unrelated strings
  // ("Microsoft Visual Studio Code Insider" matched for a token meant only
  // for the app "Code.exe", and a short rebrand token could match a directory
  // name fragment). We now:
  //   - Split the haystack into UNICODE-aware whole words (letters + digits).
  //   - Short (< 8 chars) single-word tokens must match a WHOLE word in the
  //     set, not a substring.
  //   - Long tokens (>= 8 chars) or tokens containing spaces / punctuation
  //     (file paths, product phrases) keep the includes() semantics because
  //     they're distinctive enough to not trigger false positives.
  const wordSet = new Set(haystack.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0));
  return tokens.some((token) => {
    if (!token) return false;
    const isPhrase = /\s|[^a-z0-9]/.test(token);
    if (isPhrase || token.length >= 8) return haystack.includes(token);
    return wordSet.has(token);
  });
}

/** Look for the agent exe inside a single directory (exact name, then verify). */
async function scanDirForExe(
  dir: string,
  hints: InstallHints,
  logFile?: string | null,
): Promise<{ version: string | null } | null> {
  let entries: string[] = [];
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) return null;
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }

  // 1) Exact executable name match.
  for (const name of hints.exeNames) {
    const candidate = path.join(dir, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        const version = await readExeInfo(candidate, logFile)
          .then((i) => i?.version ?? null)
          .catch(() => null);
        return { version };
      }
    } catch {
      // Not present — try the next candidate.
    }
  }

  // 2) Fallback: scan top-level *.exe and confirm identity via version info.
  // Cap at 10 candidates to avoid spawning excessive PowerShell processes
  // in directories with many executables (e.g. game launcher folders).
  let probed = 0;
  for (const entry of entries) {
    if (probed >= 10) break;
    if (!entry.toLowerCase().endsWith('.exe')) continue;
    const candidate = path.join(dir, entry);
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    probed++;
    const info = await readExeInfo(candidate, logFile).catch(() => null);
    if (info && matchesIdentity(info, hints)) {
      return { version: info.version };
    }
  }
  return null;
}

/** Common Windows install roots where agent folders are expected. */
function candidateRoots(): string[] {
  const roots: string[] = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const local = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  if (pf) roots.push(pf);
  if (pf86) roots.push(pf86);
  if (local) {
    roots.push(path.join(local, 'Programs'));
    roots.push(local);
  }
  if (appData) roots.push(appData);
  return roots;
}

/**
 * Build a PowerShell script that finds Uninstall entries by DisplayName OR
 * the registry key name (PSChildName). Matching on PSChildName is essential
 * for apps whose DisplayName is localized (e.g. 豆包's DisplayName is "豆包"
 * but the registry key is "Doubao") — a pure-ASCII registryName like "Doubao"
 * would never -match the localized DisplayName.
 *
 * Emits: DisplayName|DisplayVersion|InstallLocation|DisplayIcon|UninstallString
 * so the caller can fall back to deriving the install dir from DisplayIcon /
 * UninstallString when InstallLocation is empty (common for Tencent-installed
 * apps that write DisplayIcon + UninstallString but leave InstallLocation blank).
 */
function buildRegistryScript(names: string[]): string {
  const nameArray = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  const lines = [
    `$names = @(${nameArray})`,
    "$keys = @('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    'Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $e=$_; ($e.DisplayName -and ($names | Where-Object { $e.DisplayName -like "*$_*" })) -or ($names | Where-Object { $e.PSChildName -like "*$_*" }) } | ForEach-Object { "$($_.DisplayName)|$($_.DisplayVersion)|$($_.InstallLocation)|$($_.DisplayIcon)|$($_.UninstallString)" }',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function formatLogEntry(
  stamp: string,
  name: string,
  scanPaths: string[],
  registry: string,
  verdict: string,
  result: InstallDetection,
): string {
  return [
    `[${stamp}] Agent: ${name}`,
    'Scan paths:',
    ...scanPaths.map((p) => `  - ${p}`),
    `Registry: ${registry}`,
    `Result: ${verdict}`,
    `Path: ${result.path ?? '-'}`,
    `Version: ${result.version ?? '-'}`,
    '',
  ].join('\n');
}

async function appendLog(logFile: string, content: string): Promise<void> {
  await appendLogLine(logFile, `${content}\n`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect whether an agent is installed on the current machine.
 *
 * Strategy (Windows):
 *   1. If a manual `appPath` override is set, verify it directly.
 *   2. Scan known install directories for the agent exe (path detection).
 *   3. Query the Uninstall registry keys for a matching DisplayName (registry).
 *
 * On non-Windows platforms (or when the adapter provides no hints) this
 * returns a non-installed result without touching the OS.
 */
export async function detectInstallation(
  opts: DetectInstallationOptions,
): Promise<InstallDetection> {
  const { platform, appPath, hints, displayName, logFile } = opts;
  const stamp = new Date().toISOString();
  const empty: InstallDetection = { installed: false, path: null, version: null, source: null };

  if (platform !== 'win32' || !hints) {
    if (logFile) {
      await appendLog(
        logFile,
        formatLogEntry(stamp, displayName, [], 'n/a (unsupported platform)', 'NOT FOUND', empty),
      );
    }
    return empty;
  }

  // 1) Manual override wins.
  if (appPath && appPath.trim()) {
    const normalized = appPath.trim();
    let dir = normalized;
    try {
      const stat = await fs.stat(normalized);
      if (!stat.isDirectory()) dir = path.dirname(normalized);
    } catch {
      dir = path.dirname(normalized);
    }
    const found = await scanDirForExe(dir, hints, logFile).catch(() => null);
    const result: InstallDetection = {
      installed: true,
      path: dir,
      version: found?.version ?? null,
      source: 'path',
    };
    if (logFile) {
      await appendLog(
        logFile,
        formatLogEntry(stamp, displayName, [normalized], 'manual override', 'FOUND', result),
      );
    }
    return result;
  }

  // 2) Filesystem path scan.
  const roots = candidateRoots();
  const scanPaths: string[] = [];
  let pathResult: { path: string; version: string | null } | null = null;
  for (const root of roots) {
    for (const dirName of hints.dirNames) {
      const dir = path.join(root, dirName);
      scanPaths.push(dir);
      if (!pathResult) {
        const found = await scanDirForExe(dir, hints, logFile).catch(() => null);
        if (found) pathResult = { path: dir, version: found.version };
      }
    }
  }

  // 3) Registry scan.
  const registryInfo: string[] = [];
  let registryResult: { path: string | null; version: string | null } | null = null;
  try {
    const out = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', buildRegistryScript(hints.registryNames)],
      10000,
    );
    for (const raw of out.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      // Fields: DisplayName|DisplayVersion|InstallLocation|DisplayIcon|UninstallString
      const [dn, dv, il, icon, uninst] = line.split('|');
      registryInfo.push(`${dn ?? ''}${dv ? ` v${dv}` : ''}`);
      if (!registryResult) {
        // InstallLocation is authoritative when present; otherwise derive the
        // install dir from DisplayIcon or UninstallString (common for Tencent-
        // installed apps whose InstallLocation is blank).
        let regPath: string | null = il && il.trim() ? il.trim() : null;
        if (!regPath) {
          const probe = String(icon ?? uninst ?? '').trim();
          const m = probe.match(/^("[^"]+"|\S+)/);
          if (m) {
            try {
              const p = m[1].replace(/^"|"$/g, '');
              const stat = await fs.stat(p);
              regPath = stat.isDirectory() ? p : path.dirname(p);
            } catch {
              // Path not resolvable — leave regPath null.
            }
          }
        }
        registryResult = {
          path: regPath,
          version: dv && dv.trim() ? dv.trim() : null,
        };
      }
    }
  } catch (error) {
    // Registry scan is best-effort, but record the failure reason so a
    // broken PowerShell execution policy or missing reg key is diagnosable
    // instead of silently producing "NOT FOUND" for every registry-only app.
    if (logFile) {
      await appendLogLine(
        logFile,
        `[${stamp}] [${displayName}] registry scan failed: ${toMessage(error)}`,
      );
    }
  }

  // Merge: path detection is preferred (gives both dir + version); registry
  // is the fallback for version / InstallLocation.
  let result: InstallDetection;
  if (pathResult) {
    result = {
      installed: true,
      path: pathResult.path,
      version: pathResult.version,
      source: 'path',
    };
  } else if (registryResult) {
    result = {
      installed: true,
      path: registryResult.path,
      version: registryResult.version,
      source: 'registry',
    };
  } else {
    result = empty;
  }

  if (logFile) {
    await appendLog(
      logFile,
      formatLogEntry(
        stamp,
        displayName,
        scanPaths,
        registryInfo.join('; ') || 'none',
        result.installed ? 'FOUND' : 'NOT FOUND',
        result,
      ),
    );
  }
  return result;
}
