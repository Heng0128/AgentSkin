// SPDX-License-Identifier: MPL-2.0

/**
 * # Electron App Scanner
 *
 * Three-layer Windows scanner that discovers locally installed Electron
 * applications and classifies them as "adapted" (backed by an AgentSkin
 * adapter) or "other" (raw Electron, no backing adapter yet).
 *
 * Scan strategy:
 *   - **L1 — known agents**: for each of the 6 known AgentId, delegate to the
 *     existing `detectInstallation()` from `install-detection.ts`. Matched exes
 *     are tagged with their `adapterMatch: AgentId`.
 *   - **L2 — registry sweep**: enumerate `HKLM\...\Uninstall\*` and check
 *     whether any `InstallLocation` contains `resources/app.asar` or
 *     `resources/app`. Every hit is probed for its PE version info and matched
 *     against every adapter's `installHints`.
 *   - **L3 — filesystem sweep**: walk common Program Files / AppData roots,
 *     look for subdirectories containing `resources/app(.asar)`. Same PE probe
 *     + hint matching as L2.
 *
 * Deduplication uses SHA-256 (first 16 hex chars) of the exe path as the
 * stable `id`. An in-memory cache (one-shot per process) avoids repeated full
 * scans when the renderer polles the launcher repeatedly; callers can bypass
 * it with `useCache: false`.
 *
 * Timing: the whole operation is bounded by `SCAN_TIMEOUT_MS` (10s). On
 * timeout we return whatever partial results have been gathered so far.
 *
 * Module is main-process only (PowerShell via `execFileAsync`, registry,
 * filesystem). Renderer-facing IPC lives in the launcher handler — this module
 * returns plain data and stays testable.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallHints } from '../../adapters/base';
import { CodexAdapter } from '../../adapters/domestic/codex';
import { DoubaoAdapter } from '../../adapters/domestic/doubao';
import { QoderAdapter } from '../../adapters/domestic/qoder';
import { TraeAdapter } from '../../adapters/domestic/trae';
import { WorkbuddyAdapter } from '../../adapters/domestic/workbuddy';
import { ZcodeAdapter } from '../../adapters/domestic/zcode';
import { execFileAsync } from '../../shared/exec-async';
import type { AgentId, ElectronScanResult, ScannedApp } from '../../shared/types/agent';
import { detectInstallation } from '../install-detection';
import { mainWarn, mainWarnFromCatch } from '../logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard ceiling on how long a full scan may take before we return partial results. */
const SCAN_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ScanCache {
  result: ElectronScanResult;
  timestamp: number;
}

let cache: ScanCache | null = null;

/**
 * Snapshot of a single adapter's identity + install hints.
 * Built once at module load so the scanner never has to instantiate adapters
 * during the hot scan path.
 */
interface AgentProbe {
  id: AgentId;
  displayName: string;
  hints: InstallHints;
}

// ---------------------------------------------------------------------------
// Adapter registry (module-level, built from the existing adapters)
// ---------------------------------------------------------------------------

function buildAgentProbes(): AgentProbe[] {
  const adapters = [
    new TraeAdapter(),
    new QoderAdapter(),
    new WorkbuddyAdapter(),
    new DoubaoAdapter(),
    new CodexAdapter(),
    new ZcodeAdapter(),
  ];
  const probes: AgentProbe[] = [];
  for (const a of adapters) {
    if (!a.installHints) {
      mainWarn('ElectronScanner', `adapter "${a.id}" has no installHints — skipping in L1 scan`);
      continue;
    }
    probes.push({
      id: a.id as AgentId,
      displayName: a.name,
      hints: a.installHints,
    });
  }
  return probes;
}

const AGENT_PROBES: AgentProbe[] = buildAgentProbes();

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Short, collision-resistant fingerprint of an exe path. */
function hashPath(p: string): string {
  return createHash('sha256').update(p, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Read PE version info from an exe. Mirrors the private `readExeInfo` in
 * install-detection.ts — duplicated here because the scanner needs standalone
 * access without modifying the existing detection module.
 *
 * Returns `null` on any failure (missing exe, blocked PowerShell, etc.).
 */
async function readExeInfo(exePath: string): Promise<{
  version: string | null;
  productName: string;
  fileDescription: string;
  companyName: string;
} | null> {
  const literal = exePath.replace(/'/g, "''");
  const script = [
    `$v = (Get-Item -LiteralPath '${literal}').VersionInfo`,
    '"$($v.FileVersion)|$($v.ProductVersion)|$($v.ProductName)|$($v.FileDescription)|$($v.CompanyName)"',
  ].join('\n');
  const res = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    8000,
    { includeStderr: true },
  );
  const line = res.stdout.trim();
  if (!line) return null;
  const [fileVersion, productVersion, productName, fileDescription, companyName] = line.split('|');
  const version = (fileVersion || productVersion || '').trim() || null;
  return {
    version,
    productName: (productName || '').trim(),
    fileDescription: (fileDescription || '').trim(),
    companyName: (companyName || '').trim(),
  };
}

/**
 * Score a discovered exe against every known adapter's installHints.
 * Replicates the `matchesIdentity` semantics from install-detection.ts
 * (short tokens = whole-word match, long tokens / phrases = substring match).
 *
 * Returns the winning AgentId or null.
 */
function matchAgainstHints(info: { productName: string; fileDescription: string }): AgentId | null {
  for (const probe of AGENT_PROBES) {
    const haystack = `${info.productName} ${info.fileDescription}`.toLowerCase();
    const tokens = [...probe.hints.registryNames, ...probe.hints.dirNames].map((s) =>
      s.toLowerCase(),
    );
    const wordSet = new Set(haystack.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0));
    const matched = tokens.some((token) => {
      if (!token) return false;
      const isPhrase = /\s|[^a-z0-9]/.test(token);
      if (isPhrase || token.length >= 8) return haystack.includes(token);
      return wordSet.has(token);
    });
    if (matched) return probe.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// L1 — known agent detection
// ---------------------------------------------------------------------------

/**
 * Scan using the existing `detectInstallation` path. Each agent's exe is
 * individually probed; the result is tagged `adapterMatch: agentId`.
 */
async function scanKnownAgents(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  for (const probe of AGENT_PROBES) {
    if (isTimedOut()) return;
    try {
      const detection = await detectInstallation({
        platform: process.platform,
        hints: probe.hints,
        displayName: probe.displayName,
      });
      if (!detection.installed || !detection.path) continue;

      const exePath = await findExeForAgent(detection.path, probe.hints);
      if (!exePath) continue;

      const hash = hashPath(exePath);
      const info = await readExeInfo(exePath).catch(() => null);

      collect({
        id: hash,
        exePath,
        productName: info?.productName ?? '',
        companyName: info?.companyName ?? '',
        version: info?.version ?? detection.version ?? undefined,
        adapterMatch: probe.id,
      });
    } catch (error) {
      mainWarnFromCatch('ElectronScanner', error, `L1 agent ${probe.id}`);
    }
  }
}

/**
 * Locate the executable inside a detected install directory by checking exact
 * names from the adapter and falling back to any `.exe` in the directory or
 * its parent (Electron apps typically ship `ProductName.exe` alongside
 * `resources/app.asar`). Identity is confirmed via PE version info match.
 */
async function findExeForAgent(installDir: string, hints: InstallHints): Promise<string | null> {
  const searchDirs = [installDir, path.dirname(installDir)];
  for (const dir of searchDirs) {
    for (const exeName of hints.exeNames) {
      const candidate = path.join(dir, exeName);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // Not present — try the next name.
      }
    }
    let probed = 0;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
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
      const info = await readExeInfo(candidate).catch(() => null);
      if (info && matchAgainstHints(info)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Locate any executable inside a directory confirmed to be an Electron app
 * (L2/L3 already verified `resources/app.asar` or `resources/app/`). Used by
 * the registry and filesystem sweeps where the directory IS the Electron app
 * but we don't yet know which adapter (if any) it maps to. Accepts the first
 * `.exe` found in the directory or its parent — capped at 5 candidates to
 * avoid scanning directories with many executables.
 */
async function findAnyExe(installDir: string): Promise<string | null> {
  const searchDirs = [installDir, path.dirname(installDir)];
  for (const dir of searchDirs) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    let found = 0;
    for (const entry of entries) {
      if (found >= 5) break;
      if (!entry.toLowerCase().endsWith('.exe')) continue;
      const candidate = path.join(dir, entry);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          found++;
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// L2 — registry sweep
// ---------------------------------------------------------------------------

/**
 * Build a PowerShell script that returns every Uninstall entry whose
 * InstallLocation contains an `app(.asar)` Electron payload. We emit only
 * the columns the scanner needs — DisplayName (for hint matching),
 * DisplayVersion (for the version string), and InstallLocation (to probe PE).
 *
 * HKLM + HKCU are covered so that per-user installs (current-user MSIX,
 * non-admin installs) are caught as well.
 */
function buildElectronRegistryScript(): string {
  return [
    '$keys = @(',
    "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    "  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    ')',
    'Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object {',
    '  $loc = $_.InstallLocation',
    '  $loc -and (',
    "    (Test-Path (Join-Path $loc 'resources\\app.asar')) -or",
    "    (Test-Path (Join-Path $loc 'resources\\app'))",
    '  )',
    '} | ForEach-Object {',
    '  "$($_.DisplayName)|$($_.DisplayVersion)|$($_.InstallLocation)"',
    '}',
  ].join('\n');
}

/** Parse one line of PowerShell output: "DisplayName|Version|InstallLocation". */
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
async function scanRegistry(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  let raw: string;
  try {
    raw = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', buildElectronRegistryScript()],
      10000,
    );
  } catch (error) {
    mainWarnFromCatch('ElectronScanner', error, 'L2 registry sweep');
    return;
  }

  for (const line of raw.split('\n')) {
    if (isTimedOut()) return;
    const entry = parseRegistryLine(line.trim());
    if (!entry) continue;

    // L2 has already confirmed the directory contains app(.asar) — find any
    // executable inside it. We do NOT require identity matching because the
    // app may be an unknown Electron app (adapterMatch: null is still useful).
    const exePath = await findAnyExe(entry.location);
    if (!exePath) continue;

    const hash = hashPath(exePath);
    const info = await readExeInfo(exePath).catch(() => null);
    const adapterInfo = info ? matchAgainstHints(info) : null;

    collect({
      id: hash,
      exePath,
      productName: info?.productName ?? '',
      companyName: info?.companyName ?? '',
      version: info?.version ?? entry.version ?? undefined,
      adapterMatch: adapterInfo,
    });
  }
}

// ---------------------------------------------------------------------------
// L3 — filesystem sweep
// ---------------------------------------------------------------------------

/** Common install roots where Electron apps are likely to live (Windows). */
function commonInstallRoots(): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (p?: string) => {
    if (p?.trim() && !seen.has(p.trim())) {
      seen.add(p.trim());
      roots.push(p.trim());
    }
  };
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const w6432 = process.env.ProgramW6432;
  const local = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  if (pf) push(pf);
  if (w6432) push(w6432);
  if (pf86) push(pf86);
  if (local) {
    push(path.join(local, 'Programs'));
    push(local);
  }
  if (appData) push(appData);
  return roots;
}

/**
 * Walk the immediate children of each install root and check whether any of
 * them contain `resources/app.asar` or `resources/app/`. This is the
 * conventional Electron layout — no deep recursion needed.
 */
async function scanFilesystem(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
  extraDirs: string[],
): Promise<void> {
  const roots = [...commonInstallRoots(), ...extraDirs];
  for (const root of roots) {
    if (isTimedOut()) return;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (isTimedOut()) return;
      const dir = path.join(root, entry);
      try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      // Check for Electron payload markers.
      const asarPath = path.join(dir, 'resources', 'app.asar');
      const appDirPath = path.join(dir, 'resources', 'app');
      let isElectron = false;
      try {
        const stat = await fs.stat(asarPath);
        if (stat.isFile()) isElectron = true;
      } catch {
        // Not app.asar — check app/ directory.
      }
      if (!isElectron) {
        try {
          const stat = await fs.stat(appDirPath);
          if (stat.isDirectory()) isElectron = true;
        } catch {
          // Neither marker — not an Electron app.
        }
      }
      if (!isElectron) continue;

      // L3 has already confirmed app(.asar) is present — find any exe inside.
      const exePath = await findAnyExe(dir);
      if (!exePath) continue;

      const hash = hashPath(exePath);
      const info = await readExeInfo(exePath).catch(() => null);
      const adapterInfo = info ? matchAgainstHints(info) : null;

      collect({
        id: hash,
        exePath,
        productName: info?.productName ?? '',
        companyName: info?.companyName ?? '',
        version: info?.version ?? undefined,
        adapterMatch: adapterInfo,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Return a cached result if one exists. Defaults to true. */
  useCache?: boolean;
  /** Additional directories to include in the L3 filesystem sweep. */
  extraDirs?: string[];
}

/** Return the cached scan result, or null if no cached result exists. */
export function getCachedScan(): ElectronScanResult | null {
  return cache?.result ?? null;
}

/** Discard any cached scan result. The next `scanElectronApps` call re-runs the full scan. */
export function invalidateScanCache(): void {
  cache = null;
}

/**
 * Run the three-layer Electron app scan and return the adapted/other split.
 *
 * The scan is bounded by {@link SCAN_TIMEOUT_MS}; on timeout whatever has been
 * collected so far is returned (best-effort).
 */
export async function scanElectronApps(options?: ScanOptions): Promise<ElectronScanResult> {
  const { useCache = true, extraDirs = [] } = options ?? {};

  if (useCache && cache) {
    return cache.result;
  }

  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  const isTimedOut = () => Date.now() > deadline;

  const seen = new Map<string, ScannedApp>();

  const collect = (app: ScannedApp) => {
    if (seen.has(app.id)) return; // SHA-256 collision ≈ impossible; dedup by existing entry.
    seen.set(app.id, app);
  };

  // L1 — known agents.
  await scanKnownAgents(collect, isTimedOut);
  if (isTimedOut()) {
    mainWarn('ElectronScanner', 'scan timed out after L1 — returning partial result');
  } else {
    // L2 — registry sweep.
    await scanRegistry(collect, isTimedOut);
    if (isTimedOut()) {
      mainWarn('ElectronScanner', 'scan timed out after L2 — returning partial result');
    } else {
      // L3 — filesystem sweep.
      await scanFilesystem(collect, isTimedOut, extraDirs);
      if (isTimedOut()) {
        mainWarn('ElectronScanner', 'scan timed out during L3 — returning partial result');
      }
    }
  }

  const adapted: ScannedApp[] = [];
  const other: ScannedApp[] = [];
  for (const app of seen.values()) {
    if (app.adapterMatch) adapted.push(app);
    else other.push(app);
  }

  const result: ElectronScanResult = { adapted, other };
  cache = { result, timestamp: Date.now() };
  return result;
}
