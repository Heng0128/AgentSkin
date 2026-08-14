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
 * stable `id`. An in-memory cache with a 5-minute TTL avoids repeated full
 * scans when the renderer polls the launcher repeatedly; callers can bypass
 * it with `useCache: false`.
 *
 * Timing: the whole operation is bounded by `SCAN_TIMEOUT_MS` (20s). On
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
const SCAN_TIMEOUT_MS = 20_000;

/** How long a completed scan result stays fresh in the in-memory cache. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Global concurrency cap for PowerShell subprocess spawns. L1/L2 can fan out
 * dozens of `readExeInfo` / registry calls in parallel; without a cap that
 * means dozens of `powershell.exe` processes at once (memory + startup
 * contention, and on some systems the process table churns). A bounded FIFO
 * pool keeps the scan fast while bounding resource usage.
 */
const PS_CONCURRENCY_LIMIT = 8;

let psActive = 0;
const psQueue: Array<() => void> = [];

/** Run `fn` under the global PowerShell concurrency pool (FIFO, cap 8). */
async function withPsConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  if (psActive >= PS_CONCURRENCY_LIMIT) {
    await new Promise<void>((resolve) => psQueue.push(resolve));
  }
  psActive++;
  try {
    return await fn();
  } finally {
    psActive--;
    const next = psQueue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ScanCache {
  result: ElectronScanResult;
  timestamp: number;
}

let cache: ScanCache | null = null;

/** Return the cached entry when it is still within the TTL window, else null. */
function freshCache(): ScanCache | null {
  return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS ? cache : null;
}

/**
 * In-flight scan promise (single-flight guard). `useCache` callers that race
 * before the first scan has cached share this one promise instead of each
 * launching a full PowerShell-heavy sweep. Cleared once the scan settles.
 */
let inflight: Promise<ElectronScanResult> | null = null;

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
    // PowerShell 5.1 writes stdout in the OEM code page (GBK on zh-CN systems)
    // while Node decodes the pipe as UTF-8 — force UTF-8 so Chinese product
    // names / descriptions survive the round-trip un-mangled.
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$v = (Get-Item -LiteralPath '${literal}').VersionInfo`,
    '"$($v.FileVersion)|$($v.ProductVersion)|$($v.ProductName)|$($v.FileDescription)|$($v.CompanyName)"',
  ].join('\n');
  const res = await withPsConcurrency(() =>
    execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 8000, {
      includeStderr: true,
    }),
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
 * Derive a display name from an executable's filename — the last-resort
 * fallback when both PE version info and registry metadata are empty. Electron
 * main binaries almost always mirror the product name (`Discord.exe` →
 * "Discord"), so this beats rendering a blank label.
 */
function nameFromExe(exePath: string): string {
  return path.basename(exePath, path.extname(exePath)).trim();
}

/**
 * Score a discovered exe against every known adapter's installHints.
 * Matching is whole-word / whole-phrase: a single-word token must appear as a
 * whole word in the haystack, and a phrase token must have every one of its
 * words present (regardless of order or adjacency).
 *
 * Returns the winning AgentId or null.
 */
export function matchAgainstHints(info: {
  productName: string;
  fileDescription: string;
}): AgentId | null {
  for (const probe of AGENT_PROBES) {
    const haystack = `${info.productName} ${info.fileDescription}`.toLowerCase();
    const tokens = [...probe.hints.registryNames, ...probe.hints.dirNames].map((s) =>
      s.toLowerCase(),
    );
    const wordSet = new Set(haystack.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0));
    const matched = tokens.some((token) => {
      if (!token) return false;
      if (/\s|[^a-z0-9]/.test(token)) {
        const words = token.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        return words.every((w) => wordSet.has(w));
      }
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
  // Run all known-agent probes in parallel. Each probe spawns its own
  // PowerShell subprocesses (registry sweep + PE version reads), so doing them
  // serially could eat the entire SCAN_TIMEOUT_MS budget before L2 even starts.
  // The probes are independent (no shared mutable state); `collect` dedupes via
  // the `seen` Map so concurrent completion order is harmless.
  await Promise.all(
    AGENT_PROBES.map(async (probe) => {
      try {
        const detection = await detectInstallation({
          platform: process.platform,
          hints: probe.hints,
          displayName: probe.displayName,
        });
        if (isTimedOut()) return;
        if (!detection.installed || !detection.path) return;

        const exePath = await findExeForAgent(detection.path, probe.hints);
        if (!exePath) return;

        const hash = hashPath(exePath);
        const info = await readExeInfo(exePath).catch(() => null);

        collect({
          id: hash,
          exePath,
          productName: info?.productName || probe.displayName,
          companyName: info?.companyName ?? '',
          version: info?.version ?? detection.version ?? undefined,
          adapterMatch: probe.id,
          source: 'agent',
        });
      } catch (error) {
        mainWarnFromCatch('ElectronScanner', error, `L1 agent ${probe.id}`);
      }
    }),
  );
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
async function findAnyExe(installDir: string): Promise<string | null> {
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

// ---------------------------------------------------------------------------
// L2 — registry sweep
// ---------------------------------------------------------------------------

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
async function scanRegistry(
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

// ---------------------------------------------------------------------------
// L3 — filesystem sweep
// ---------------------------------------------------------------------------

/**
 * A scan root plus the maximum directory depth to descend when hunting for
 * `resources/app(.asar)`.
 *
 * Program Files apps often nest under vendor + version folders
 * (`Quark\7.0.5.931`, `Docker\Docker\frontend`, `ByteDance\douyin\8.2.303`),
 * so those roots descend three levels. LocalAppData / AppData apps nest under
 * a vendor or version folder (`<LocalAppData>\<vendor>\<app>`, e.g. Slack's
 * `slack\app-4.x`, or `Microsoft VS Code\<build-hash>`), so they descend two.
 */
interface ScanRoot {
  dir: string;
  depth: number;
}

/** Common install roots where Electron apps are likely to live (Windows). */
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

function isSkippableApp(exePath: string): boolean {
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
interface ElectronMarker {
  isElectron: boolean;
  confidence: number;
}

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
async function scanFilesystem(
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Return a cached result if one exists. Defaults to true. */
  useCache?: boolean;
  /** Additional directories to include in the L3 filesystem sweep. */
  extraDirs?: string[];
  /** Called once per newly-discovered app (streaming progress, pre-dedupe). */
  onApp?: (app: ScannedApp) => void;
}

/** Return the cached scan result, or null if no fresh cached result exists. */
export function getCachedScan(): ElectronScanResult | null {
  return freshCache()?.result ?? null;
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
  const { useCache = true, extraDirs = [], onApp } = options ?? {};

  if (useCache) {
    const cached = freshCache();
    if (cached) return cached.result;
  }

  // Single-flight: a concurrent `useCache` call reuses the in-progress scan
  // rather than starting a duplicate (e.g. two renderer polls racing before
  // the first scan has cached).
  if (useCache && inflight) {
    return inflight;
  }

  const run = (async (): Promise<ElectronScanResult> => {
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    const isTimedOut = () => Date.now() > deadline;

    const seen = new Map<string, ScannedApp>();

    const collect = (app: ScannedApp) => {
      if (seen.has(app.id)) return; // SHA-256 collision ≈ impossible; dedup by existing entry.
      if (isSkippableApp(app.exePath)) return;
      seen.set(app.id, app);
      mainWarn('ElectronScanner', `collect ${app.source}: ${app.productName} (${app.exePath})`);
      onApp?.(app);
    };

    // Track whether the scan hit the deadline. Partial (timed-out) results
    // must NOT be cached — a stale incomplete snapshot would be replayed to
    // every subsequent `useCache` caller until a manual force rescan.
    let timedOut = false;

    // L1 — known agents.
    const t1 = Date.now();
    await scanKnownAgents(collect, isTimedOut);
    mainWarn(
      'ElectronScanner',
      `L1 done ${Date.now() - t1}ms seen=${seen.size} timedOut=${isTimedOut()}`,
    );
    if (isTimedOut()) {
      timedOut = true;
      mainWarn('ElectronScanner', 'scan timed out after L1 — returning partial result');
    } else {
      // L2 — registry sweep.
      const t2 = Date.now();
      await scanRegistry(collect, isTimedOut);
      mainWarn(
        'ElectronScanner',
        `L2 done ${Date.now() - t2}ms seen=${seen.size} timedOut=${isTimedOut()}`,
      );
      if (isTimedOut()) {
        timedOut = true;
        mainWarn('ElectronScanner', 'scan timed out after L2 — returning partial result');
      } else {
        // L3 — filesystem sweep.
        const t3 = Date.now();
        await scanFilesystem(collect, isTimedOut, extraDirs);
        mainWarn(
          'ElectronScanner',
          `L3 done ${Date.now() - t3}ms seen=${seen.size} timedOut=${isTimedOut()}`,
        );
        if (isTimedOut()) {
          timedOut = true;
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
    // Only complete (non-timed-out) results are cached; partial results are
    // returned to the caller but never persisted.
    if (!timedOut) {
      cache = { result, timestamp: Date.now() };
    }
    return result;
  })();

  if (useCache) {
    inflight = run;
    try {
      return await run;
    } finally {
      inflight = null;
    }
  }

  return run;
}
