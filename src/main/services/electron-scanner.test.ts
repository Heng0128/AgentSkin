// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for the Electron App Scanner.
 *
 * Coverage targets 5 core scenarios:
 *   1. Known agent detected → adapterMatch returns the corresponding agentId
 *   2. Unknown Electron app → adapterMatch is null
 *   3. Same exe path deduplicated
 *   4. Cache hit skips the second scan
 *   5. Scan timeout returns partial results (what was gathered before the
 *      deadline)
 *
 * All filesystem / registry / PowerShell operations are mocked so the tests
 * run hermetically in the vitest node environment.
 */

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecFileResult } from '../../shared/exec-async';

// ---------------------------------------------------------------------------
// Mock adapters — provide the same installHints shape as the real adapters
// but strip the BaseApplicationAdapter dependency (which pulls in the legacy
// runtime). Each mock exposes the minimal surface the scanner needs:
// `id`, `name`, and `installHints`.
// ---------------------------------------------------------------------------

const TRAE_HINTS = {
  dirNames: ['TRAE SOLO CN'],
  exeNames: ['TRAE SOLO CN.exe'],
  registryNames: ['TRAE SOLO', 'TRAE SOLO CN'],
};
const QODER_HINTS = {
  dirNames: ['QoderWork CN'],
  exeNames: ['QoderWork CN.exe'],
  registryNames: ['QoderWork CN', 'QoderWork'],
};
const WORKBUDDY_HINTS = {
  dirNames: ['WorkBuddy'],
  exeNames: ['WorkBuddy.exe'],
  registryNames: ['WorkBuddy'],
};
const DOUBAO_HINTS = {
  dirNames: ['Doubao'],
  exeNames: ['Doubao.exe'],
  registryNames: ['Doubao', '豆包'],
};
const CODEX_HINTS = {
  dirNames: ['ChatGPT'],
  exeNames: ['ChatGPT.exe'],
  registryNames: ['ChatGPT', 'OpenAI Codex'],
};
const ZCODE_HINTS = {
  dirNames: ['ZCode'],
  exeNames: ['ZCode.exe'],
  registryNames: ['ZCode'],
};

const makeAdapter = (id: string, name: string, hints: object) =>
  class {
    static id = id;
    static name = name;
    static hints = hints;
    id = id;
    name = name;
    installHints = hints as typeof TRAE_HINTS;
  };

vi.mock('../../adapters/domestic/trae', () => ({
  TraeAdapter: makeAdapter('traework', 'TRAE Work CN', TRAE_HINTS),
}));
vi.mock('../../adapters/domestic/qoder', () => ({
  QoderAdapter: makeAdapter('qoderwork', 'QoderWork CN', QODER_HINTS),
}));
vi.mock('../../adapters/domestic/workbuddy', () => ({
  WorkbuddyAdapter: makeAdapter('workbuddy', 'WorkBuddy', WORKBUDDY_HINTS),
}));
vi.mock('../../adapters/domestic/doubao', () => ({
  DoubaoAdapter: makeAdapter('doubao', '豆包', DOUBAO_HINTS),
}));
vi.mock('../../adapters/domestic/codex', () => ({
  CodexAdapter: makeAdapter('codex', 'OpenAI Codex', CODEX_HINTS),
}));
vi.mock('../../adapters/domestic/zcode', () => ({
  ZcodeAdapter: makeAdapter('zcode', 'ZCode', ZCODE_HINTS),
}));

// Logger mock reference — used for silencing warn output during tests.
await import('../logger');

// ---------------------------------------------------------------------------
// Mock install-detection — control what detectInstallation returns per agent.
// ---------------------------------------------------------------------------

const mockDetectInstallation = vi.fn();
vi.mock('../install-detection', () => ({
  detectInstallation: mockDetectInstallation,
}));

// ---------------------------------------------------------------------------
// Mock exec-async — differentiate between registry sweep (plain string return)
// and readExeInfo (ExecFileResult with .stdout).
// ---------------------------------------------------------------------------

const mockExecFileAsync = vi.fn();
vi.mock('../../shared/exec-async', () => ({
  execFileAsync: mockExecFileAsync,
}));

// ---------------------------------------------------------------------------
// Mock logger — silence mainWarn / mainWarnFromCatch during tests.
// ---------------------------------------------------------------------------

vi.mock('../logger', () => ({
  mainWarn: vi.fn(),
  mainWarnFromCatch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock fs/promises — redirect stat/readdir through Maps keyed by path.
// Tests populate these maps before invoking scanElectronApps.
// ---------------------------------------------------------------------------

const statMap = new Map<string, 'file' | 'dir' | 'asar' | undefined>();
const readdirMap = new Map<string, string[]>();

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(async (p: string) => {
      const key = String(p);
      const val = statMap.get(key);
      if (val === undefined) {
        throw new Error(`ENOENT: ${key}`);
      }
      return {
        isFile: () => val === 'file' || val === 'asar',
        isDirectory: () => val === 'dir',
      };
    }),
    readdir: vi.fn(async (p: string) => {
      const key = String(p);
      const entries = readdirMap.get(key);
      if (entries === undefined) {
        throw new Error(`ENOENT: ${key}`);
      }
      return entries;
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks so module-level AGENT_PROBES picks up the
// mocked adapters.
// ---------------------------------------------------------------------------

const {
  scanElectronApps,
  getCachedScan,
  invalidateScanCache,
  matchAgainstHints,
  scannerPipeline,
  resolveScanRoots,
} = await import('./electron-scanner');

const { shouldSkipRegistryEntry } = await import('./scanner/collectors/registry');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState(): void {
  invalidateScanCache();
  statMap.clear();
  readdirMap.clear();
  mockDetectInstallation.mockReset();
  mockExecFileAsync.mockReset();
}

/** SHA-256 first-16-hex mock for the scanner's hashPath — same algorithm. */
function fakeHash(exePath: string): string {
  return createHash('sha256').update(exePath, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Configure mockExecFileAsync for two distinct call shapes:
 *   1. calls WITH `{ includeStderr: true }` → readExeInfo path → return ExecFileResult
 *   2. calls WITHOUT options → scanRegistry path → return plain string
 *
 * `peStdout` is the pipe-delimited PE info string the scanner parses.
 * `registryStdout` is the pipe-delimited registry output (one = DisplayName|Version|Location).
 */
function configureExecMocks(peStdout: string, registryStdout: string): void {
  mockExecFileAsync.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _timeout?: number,
      options?: { includeStderr?: true },
    ): Promise<string | ExecFileResult> => {
      if (options?.includeStderr) {
        return Promise.resolve({
          stdout: peStdout,
          stderr: '',
          errorMessage: null,
          errorCode: null,
        });
      }
      return Promise.resolve(registryStdout);
    },
  );
}

/**
 * Configure mockExecFileAsync for the v2 registry batch path:
 *   - non-includeStderr call → registry sweep → plain string
 *   - includeStderr batch script (`readExeInfosBatch`) → path-prefixed lines
 *   - any other includeStderr call (single `readExeInfo`) → empty stdout
 */
function configureExecMocksBatch(registryStdout: string, batchStdout: string): void {
  mockExecFileAsync.mockImplementation(
    (
      _cmd: string,
      args: string[],
      _timeout?: number,
      options?: { includeStderr?: true },
    ): Promise<string | ExecFileResult> => {
      if (!options?.includeStderr) {
        return Promise.resolve(registryStdout);
      }
      const script = (args ?? []).join(' ');
      if (script.includes('foreach ($p in $paths)')) {
        return Promise.resolve({
          stdout: batchStdout,
          stderr: '',
          errorMessage: null,
          errorCode: null,
        });
      }
      return Promise.resolve({ stdout: '', stderr: '', errorMessage: null, errorCode: null });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('electron-scanner', () => {
  beforeEach(() => {
    resetState();
    // Force win32 so detectInstallation actually probes (it returns early
    // on non-win32 platforms).
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    // Disable env-based directory scanning on platforms where the env vars
    // aren't set (the test runs on Windows CI or node CI where they may not
    // be present).
    delete process.env.ProgramFiles;
    delete process.env.LOCALAPPDATA;
    delete process.env.APPDATA;
  });

  afterEach(() => {
    delete process.env.AGENTSKIN_SCANNER;
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Scenario 1 — known agent detected → adapterMatch returns agentId
  // -----------------------------------------------------------------------
  it('returns adapterMatch=agentId when a known agent is found', async () => {
    // detectInstallation mocks: traework is found, others not.
    mockDetectInstallation.mockImplementation(async (opts: { displayName: string }) => {
      if (opts.displayName === 'TRAE Work CN') {
        return {
          installed: true,
          path: 'C:\\Program Files\\TRAE SOLO CN',
          version: '1.2.3',
          source: 'path',
        };
      }
      return { installed: false, path: null, version: null, source: null };
    });

    // PE info for the detected exe.
    configureExecMocks('1.2.3|1.2.3|TRAE SOLO CN|TRAE|ByteDance', '');

    // fs: install dir contains the named exe; registry output is empty (L2 finds nothing new).
    statMap.set('C:\\Program Files\\TRAE SOLO CN\\TRAE SOLO CN.exe', 'file');

    const result = await scanElectronApps({ useCache: false });

    expect(result.adapted).toHaveLength(1);
    expect(result.adapted[0]).toMatchObject({
      adapterMatch: 'traework',
      version: '1.2.3',
    });
    expect(result.adapted[0].exePath).toBe('C:\\Program Files\\TRAE SOLO CN\\TRAE SOLO CN.exe');
    expect(result.other).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Scenario 2 — unknown Electron app → adapterMatch = null
  // -----------------------------------------------------------------------
  it('returns adapterMatch=null for unrecognized Electron apps found via registry sweep', async () => {
    // No known agents detected.
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    // Registry sweep finds an app with no adapter match.
    configureExecMocks(
      '0.9.0|0.9.0|SomeApp|Generic Electron App|Unknown Inc',
      'MyApp|0.9.0|D:\\Apps\\MyApp',
    );

    // The registry-found install dir contains the exe.
    statMap.set('D:\\Apps\\MyApp\\MyApp.exe', 'file');
    readdirMap.set('D:\\Apps\\MyApp', ['MyApp.exe']);

    const result = await scanElectronApps({ useCache: false });

    expect(result.adapted).toHaveLength(0);
    expect(result.other).toHaveLength(1);
    expect(result.other[0]).toMatchObject({
      exePath: 'D:\\Apps\\MyApp\\MyApp.exe',
      productName: 'SomeApp',
      companyName: 'Unknown Inc',
      adapterMatch: null,
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3 — same exe path not duplicated
  // -----------------------------------------------------------------------
  it('deduplicates the same exe path across scan layers', async () => {
    // L1 detects traework at a specific path.
    mockDetectInstallation.mockImplementation(async (opts: { displayName: string }) => {
      if (opts.displayName === 'TRAE Work CN') {
        return {
          installed: true,
          path: 'D:\\Electron\\TRAE SOLO CN',
          version: '1.0.0',
          source: 'path',
        };
      }
      return { installed: false, path: null, version: null, source: null };
    });

    // L2 registry sweep also returns an entry pointing to the same directory
    // (simulating a registry entry with a matching InstallLocation).
    configureExecMocks(
      '1.0.0|1.0.0|TRAE SOLO CN|TRAE|ByteDance',
      'TRAE SOLO CN|1.0.0|D:\\Electron\\TRAE SOLO CN',
    );

    // Both L1 and L2 look for TRAE SOLO CN.exe in the same dir.
    statMap.set('D:\\Electron\\TRAE SOLO CN\\TRAE SOLO CN.exe', 'file');
    readdirMap.set('D:\\Electron\\TRAE SOLO CN', ['TRAE SOLO CN.exe', 'resources']);

    const result = await scanElectronApps({ useCache: false });

    // The same exe should appear exactly once (in adapted, since L1 matched it).
    const allApps = [...result.adapted, ...result.other];
    expect(allApps).toHaveLength(1);
    expect(result.adapted).toHaveLength(1);
    expect(result.adapted[0].adapterMatch).toBe('traework');
    expect(result.adapted[0].id).toBe(fakeHash('D:\\Electron\\TRAE SOLO CN\\TRAE SOLO CN.exe'));
  });

  // -----------------------------------------------------------------------
  // Scenario 4 — cache hit skips re-scan
  // -----------------------------------------------------------------------
  it('returns cached result without re-running expensive operations on second call', async () => {
    mockDetectInstallation.mockImplementation(async (opts: { displayName: string }) => {
      if (opts.displayName === 'TRAE Work CN') {
        return {
          installed: true,
          path: 'C:\\Program Files\\TRAE SOLO CN',
          version: '1.0.0',
          source: 'path',
        };
      }
      return { installed: false, path: null, version: null, source: null };
    });

    configureExecMocks('1.0.0|1.0.0|TRAE SOLO CN|TRAE|ByteDance', '');
    statMap.set('C:\\Program Files\\TRAE SOLO CN\\TRAE SOLO CN.exe', 'file');

    // First call populates cache.
    const first = await scanElectronApps({ useCache: true });
    expect(first.adapted).toHaveLength(1);

    // Remove the mock so a second scan would fail if it tried to re-detect.
    mockDetectInstallation.mockReset();
    statMap.clear();

    // Second call should hit cache without invoking detectInstallation.
    const second = await scanElectronApps({ useCache: true });
    expect(second.adapted).toHaveLength(1);
    expect(second.adapted[0].adapterMatch).toBe('traework');
    expect(mockDetectInstallation).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 5 — cache bypassed with useCache: false
  // -----------------------------------------------------------------------
  it('bypasses cache when useCache is false', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });
    configureExecMocks('', '');
    readdirMap.set('C:\\Empty', []);

    await scanElectronApps({ useCache: true });
    // Invalidate not called, but next call with useCache:false should re-run.
    const detectMock = vi
      .fn()
      .mockResolvedValue({ installed: false, path: null, version: null, source: null });
    mockDetectInstallation.mockImplementation(detectMock);

    await scanElectronApps({ useCache: false });
    expect(detectMock).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 6 — scan timeout returns partial results
  // -----------------------------------------------------------------------
  it('returns partial results when the scan exceeds SCAN_TIMEOUT_MS', async () => {
    // The first detectInstallation call takes longer than the scan deadline.
    mockDetectInstallation.mockImplementation(async (opts: { displayName: string }) => {
      // Simulate slow detection.
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (opts.displayName === 'TRAE Work CN') {
        return {
          installed: true,
          path: 'C:\\Program Files\\TRAE SOLO CN',
          version: '1.0.0',
          source: 'path',
        };
      }
      return { installed: false, path: null, version: null, source: null };
    });

    configureExecMocks('1.0.0|1.0.0|TRAE SOLO CN|TRAE|ByteDance', '');
    statMap.set('C:\\Program Files\\TRAE SOLO CN\\TRAE SOLO CN.exe', 'file');
    readdirMap.set('C:\\Program Files\\TRAE SOLO CN', ['TRAE SOLO CN.exe']);

    // Scan with a short timeout by temporarily replacing SCAN_TIMEOUT_MS
    // behavior — we monkey-patch Date.now to advance past the deadline
    // halfway through L1.
    const realNow = Date.now.bind(Date);
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // After 5 calls (during first detectInstallation), jump time forward
      // past the 20s deadline (SCAN_TIMEOUT_MS = 20_000).
      if (callCount > 5) {
        return realNow() + 21_000;
      }
      return realNow();
    });

    const result = await scanElectronApps({ useCache: false });

    // We expect at most whatever was collected before the deadline.
    // DetectInstallation for traework is still in-flight when the deadline
    // fires (200ms > 10s virtual), so L1 may or may not have finished.
    // The invariant is: result is a valid ElectronScanResult with no crash.
    expect(result).toHaveProperty('adapted');
    expect(result).toHaveProperty('other');
    expect(Array.isArray(result.adapted)).toBe(true);
    expect(Array.isArray(result.other)).toBe(true);

    // Timed-out (partial) results must NOT be cached — a stale incomplete
    // snapshot would be replayed to every subsequent useCache caller.
    expect(getCachedScan()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Scenario 7 — getCachedScan before any scan returns null
  // -----------------------------------------------------------------------
  it('getCachedScan returns null before the first scan', async () => {
    invalidateScanCache();
    expect(getCachedScan()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Scenario 8 — getCachedScan returns the cached result
  // -----------------------------------------------------------------------
  it('getCachedScan returns a previously computed result', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });
    configureExecMocks('', '');
    readdirMap.set('C:\\Empty', []);

    await scanElectronApps({ useCache: true });
    const cached = getCachedScan();
    expect(cached).not.toBeNull();
    expect(cached).toHaveProperty('adapted');
    expect(cached).toHaveProperty('other');
  });

  // -----------------------------------------------------------------------
  // Scenario 8b — cache expires after the 5-minute TTL
  // -----------------------------------------------------------------------
  it('does not return a stale cache once the TTL expires', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });
    configureExecMocks('', '');
    readdirMap.set('C:\\Empty', []);

    await scanElectronApps({ useCache: true });
    expect(getCachedScan()).not.toBeNull();

    // Advance time past the 5-minute TTL; the cached result is now stale.
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 5 * 60 * 1000 + 1);

    expect(getCachedScan()).toBeNull();

    // A subsequent useCache call must re-run the scan rather than hit stale cache.
    const detectMock = vi
      .fn()
      .mockResolvedValue({ installed: false, path: null, version: null, source: null });
    mockDetectInstallation.mockImplementation(detectMock);
    await scanElectronApps({ useCache: true });
    expect(detectMock).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scenario 9 — filesystem sweep discovers Electron app via app.asar marker
  // -----------------------------------------------------------------------
  it('detects Electron apps via the filesystem L3 sweep using app.asar marker', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    // Registry sweep returns nothing; filesystem sweep is the active layer.
    configureExecMocks('2.0.0|2.0.0|CoolApp|Cool description|CoolCorp', '');

    // Provide a custom install root that L3 will scan.
    const customRoot = 'D:\\CustomApps';
    const appDir = `${customRoot}\\CoolApp`;
    const asarPath = `${appDir}\\resources\\app.asar`;

    // fs: customRoot entry → CoolApp is a directory.
    readdirMap.set(customRoot, ['CoolApp']);
    statMap.set(appDir, 'dir');
    statMap.set(asarPath, 'asar');
    // CoolApp dir contains the exe.
    readdirMap.set(appDir, ['CoolApp.exe', 'resources']);
    statMap.set(`${appDir}\\CoolApp.exe`, 'file');

    const result = await scanElectronApps({ useCache: false, extraDirs: [customRoot] });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe(`${appDir}\\CoolApp.exe`);
    expect(result.other[0].productName).toBe('CoolApp');
    // L3 now reads PE info: CoolApp matches no adapter hints → adapterMatch
    // stays null; the app.asar marker alone yields confidence 60.
    expect(result.other[0].adapterMatch).toBeNull();
    expect(result.other[0].confidence).toBe(60);
  });

  // -----------------------------------------------------------------------
  // Scenario 10 — non-skippable timeout surfaces via mainWarn
  // -----------------------------------------------------------------------
  it('does not crash when detectInstallation throws', async () => {
    mockDetectInstallation.mockRejectedValue(new Error('PowerShell not found'));
    configureExecMocks('', '');

    // Should not throw; errors are logged and the scan continues.
    const result = await scanElectronApps({ useCache: false });
    expect(result).toHaveProperty('adapted');
    expect(result).toHaveProperty('other');
    expect(result.adapted).toHaveLength(0);
    expect(result.other).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Scenario 11 — readExeInfo failure in L2/L3 still yields a scanned app
  // -----------------------------------------------------------------------
  it('includes Electron apps even when PE version read fails', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    // PE read returns empty (simulating PowerShell failure) -- info will be null.
    mockExecFileAsync.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _timeout?: number,
        options?: { includeStderr?: true },
      ): Promise<string | ExecFileResult> => {
        if (options?.includeStderr) {
          return Promise.resolve({
            stdout: '',
            stderr: 'access denied',
            errorMessage: 'stderr',
            errorCode: null,
          });
        }
        return Promise.resolve('MysteryApp|3.0.0|D:\\MysteryApp');
      },
    );

    statMap.set('D:\\MysteryApp\\MysteryApp.exe', 'file');
    readdirMap.set('D:\\MysteryApp', ['MysteryApp.exe']);

    const result = await scanElectronApps({ useCache: false });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe('D:\\MysteryApp\\MysteryApp.exe');
    // Version falls back to registry entry when PE read fails.
    expect(result.other[0].version).toBe('3.0.0');
    expect(result.other[0].adapterMatch).toBeNull();
    // Name falls back to the registry DisplayName when PE product name is empty.
    expect(result.other[0].productName).toBe('MysteryApp');
  });

  // -----------------------------------------------------------------------
  // Scenario 12 — findAnyExe prefers the directory-name match over aux exes
  // -----------------------------------------------------------------------
  it('picks the directory-name exe over an uninstaller listed first', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    configureExecMocks(
      '1.0.0|1.0.0|Discord|Discord App|Discord Inc',
      'Discord|1.0.0|D:\\Apps\\Discord',
    );

    // `uninstall.exe` sorts first — the scanner must still pick Discord.exe.
    statMap.set('D:\\Apps\\Discord\\uninstall.exe', 'file');
    statMap.set('D:\\Apps\\Discord\\Discord.exe', 'file');
    readdirMap.set('D:\\Apps\\Discord', ['uninstall.exe', 'Discord.exe']);

    const result = await scanElectronApps({ useCache: false });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe('D:\\Apps\\Discord\\Discord.exe');
  });

  // -----------------------------------------------------------------------
  // Scenario 13 — findAnyExe skips auxiliary exes when dir name doesn't match
  // -----------------------------------------------------------------------
  it('skips auxiliary exes when the directory name does not match', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    configureExecMocks('2.0.0|2.0.0|MyTool Launcher|MyTool|Acme', 'MyTool|2.0.0|D:\\Apps\\MyTool');

    // No `MyTool.exe` — the launcher lives under a different name, and the
    // uninstaller sorts first. The scanner must skip it.
    statMap.set('D:\\Apps\\MyTool\\uninstall.exe', 'file');
    statMap.set('D:\\Apps\\MyTool\\mytool-launcher.exe', 'file');
    readdirMap.set('D:\\Apps\\MyTool', ['uninstall.exe', 'mytool-launcher.exe']);

    const result = await scanElectronApps({ useCache: false });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe('D:\\Apps\\MyTool\\mytool-launcher.exe');
  });

  // -----------------------------------------------------------------------
  // Scenario 14 — L3 recurses into vendor folders (two-level AppData layout)
  // -----------------------------------------------------------------------
  it('discovers Electron apps nested under a vendor folder in AppData', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    // Registry sweep empty; PE read empty → name falls back to the exe name.
    configureExecMocks('', '');

    const local = 'C:\\Users\\me\\AppData\\Local';
    process.env.LOCALAPPDATA = local;

    const vendor = `${local}\\slack`;
    const appDir = `${vendor}\\app-4.0.0`;

    // LOCALAPPDATA → slack (vendor) → app-4.0.0 (app, two levels deep).
    readdirMap.set(local, ['slack']);
    statMap.set(vendor, 'dir');
    readdirMap.set(vendor, ['app-4.0.0']);
    statMap.set(appDir, 'dir');
    statMap.set(`${appDir}\\resources\\app.asar`, 'asar');
    readdirMap.set(appDir, ['slack.exe', 'resources']);
    statMap.set(`${appDir}\\slack.exe`, 'file');

    const result = await scanElectronApps({ useCache: false });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe(`${appDir}\\slack.exe`);
    // PE name empty → fallback to the exe filename ("slack").
    expect(result.other[0].productName).toBe('slack');
  });

  // -----------------------------------------------------------------------
  // Scenario 15 — L1 name falls back to the adapter display name
  // -----------------------------------------------------------------------
  it('falls back to the adapter name when PE product name is empty', async () => {
    mockDetectInstallation.mockImplementation(async (opts: { displayName: string }) => {
      if (opts.displayName === 'TRAE Work CN') {
        return {
          installed: true,
          path: 'C:\\Program Files\\TRAE SOLO CN',
          version: '1.2.3',
          source: 'path',
        };
      }
      return { installed: false, path: null, version: null, source: null };
    });

    // PE info has an empty product-name column (third field blank).
    configureExecMocks('1.2.3|1.2.3||TRAE|ByteDance', '');

    statMap.set('C:\\Program Files\\TRAE SOLO CN\\TRAE SOLO CN.exe', 'file');

    const result = await scanElectronApps({ useCache: false });

    expect(result.adapted).toHaveLength(1);
    expect(result.adapted[0].adapterMatch).toBe('traework');
    expect(result.adapted[0].productName).toBe('TRAE Work CN');
  });

  // -----------------------------------------------------------------------
  // Scenario 16 — L3 descends three levels under Program Files
  // -----------------------------------------------------------------------
  it('discovers Electron apps nested three levels deep under Program Files', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    configureExecMocks('', '');

    const pf = 'C:\\Program Files';
    process.env.ProgramFiles = pf;

    // Docker Desktop: Program Files\Docker\Docker\frontend (3 levels).
    const docker = `${pf}\\Docker`;
    const dockerInner = `${docker}\\Docker`;
    const frontend = `${dockerInner}\\frontend`;
    readdirMap.set(pf, ['Docker']);
    statMap.set(docker, 'dir');
    readdirMap.set(docker, ['Docker']);
    statMap.set(dockerInner, 'dir');
    readdirMap.set(dockerInner, ['frontend']);
    statMap.set(frontend, 'dir');
    statMap.set(`${frontend}\\resources\\app.asar`, 'asar');
    readdirMap.set(frontend, ['Docker Desktop.exe', 'resources']);
    statMap.set(`${frontend}\\Docker Desktop.exe`, 'file');

    const result = await scanElectronApps({ useCache: false });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe(`${frontend}\\Docker Desktop.exe`);
  });

  // -----------------------------------------------------------------------
  // Scenario 17 — launcher in a grandparent dir (QQ NT under C:\yyb)
  // -----------------------------------------------------------------------
  it('finds the launcher exe two ancestors up (QQ NT in the yyb dir)', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });
    configureExecMocks('', '');

    // C:\yyb\QQ.exe (launcher) → versions\9.9.31-49738\resources\app (no exe).
    const yyb = 'C:\\yyb';
    const versions = `${yyb}\\versions`;
    const ver = `${versions}\\9.9.31-49738`;
    readdirMap.set(yyb, ['QQ.exe', 'versions']);
    statMap.set(`${yyb}\\QQ.exe`, 'file');
    statMap.set(versions, 'dir');
    readdirMap.set(versions, ['9.9.31-49738']);
    statMap.set(ver, 'dir');
    statMap.set(`${ver}\\resources\\app`, 'dir');
    readdirMap.set(ver, ['resources']);

    const result = await scanElectronApps({ useCache: false });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe(`${yyb}\\QQ.exe`);
  });

  // -----------------------------------------------------------------------
  // Scenario 18 — version dir full of auxiliary exes → launcher in parent
  // -----------------------------------------------------------------------
  it('skips an auxiliary-only version dir and picks the parent launcher', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });
    configureExecMocks('', '');

    const douyin = 'C:\\Apps\\douyin';
    const ver = `${douyin}\\8.2.303`;
    readdirMap.set(douyin, ['douyin.exe', '8.2.303']);
    statMap.set(`${douyin}\\douyin.exe`, 'file');
    statMap.set(ver, 'dir');
    statMap.set(`${ver}\\resources\\app.asar`, 'asar');
    // Version dir holds only auxiliary exes (updater, doctor, uninstaller…).
    readdirMap.set(ver, ['app_shell_updater.exe', 'douyin_doctor.exe', 'uninst.exe', 'resources']);
    statMap.set(`${ver}\\app_shell_updater.exe`, 'file');
    statMap.set(`${ver}\\douyin_doctor.exe`, 'file');
    statMap.set(`${ver}\\uninst.exe`, 'file');

    const result = await scanElectronApps({ useCache: false, extraDirs: [douyin] });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe(`${douyin}\\douyin.exe`);
  });

  // -----------------------------------------------------------------------
  // Scenario 19 — registry sweep enumerates the WOW6432Node hive
  // -----------------------------------------------------------------------
  it('enumerates the WOW6432Node registry hive in the L2 sweep', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    // Capture the PowerShell args passed to execFileAsync for the registry
    // sweep (the only non-includeStderr call — L1 is mocked to not install).
    let capturedArgs: string[] = [];
    mockExecFileAsync.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _timeout?: number,
        options?: { includeStderr?: true },
      ): Promise<string | ExecFileResult> => {
        if (options?.includeStderr) {
          return Promise.resolve({ stdout: '', stderr: '', errorMessage: null, errorCode: null });
        }
        capturedArgs = args;
        return Promise.resolve('');
      },
    );

    await scanElectronApps({ useCache: false });

    const script = capturedArgs.join(' ');
    expect(script).toContain('WOW6432Node');
    expect(script).toContain(
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    );
  });

  // -----------------------------------------------------------------------
  // Scenario 20 — multi-signal Electron detection without app.asar
  // -----------------------------------------------------------------------
  it('detects Electron via multi-signal confidence (unpacked + runtime files)', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    // No app.asar / app dir — only app.asar.unpacked + runtime binaries.
    // Confidence: unpacked(20) + electron.exe(15) + chrome_100_percent.pak(15)
    // + v8_context_snapshot.bin(15) = 65 >= 50 → isElectron.
    configureExecMocks('', '');

    const customRoot = 'D:\\MultiSignal';
    const appDir = `${customRoot}\\MultiSignalApp`;
    readdirMap.set(customRoot, ['MultiSignalApp']);
    statMap.set(appDir, 'dir');
    statMap.set(`${appDir}\\resources\\app.asar.unpacked`, 'dir');
    statMap.set(`${appDir}\\electron.exe`, 'file');
    statMap.set(`${appDir}\\chrome_100_percent.pak`, 'file');
    statMap.set(`${appDir}\\v8_context_snapshot.bin`, 'file');
    readdirMap.set(appDir, [
      'electron.exe',
      'chrome_100_percent.pak',
      'v8_context_snapshot.bin',
      'resources',
    ]);

    const result = await scanElectronApps({ useCache: false, extraDirs: [customRoot] });

    expect(result.other).toHaveLength(1);
    expect(result.other[0].exePath).toBe(`${appDir}\\electron.exe`);
    expect(result.other[0].confidence).toBe(65);
  });

  // -----------------------------------------------------------------------
  // Scenario 21 — scan meta observability (default v1)
  // -----------------------------------------------------------------------
  it('attaches ScanMeta with the default v1 pipeline and scan observability', async () => {
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });
    configureExecMocks('', '');

    const result = await scanElectronApps({ useCache: false });

    expect(result.meta).toBeDefined();
    expect(result.meta?.pipeline).toBe('v1');
    expect(result.meta?.timedOut).toBe(false);
    expect(result.meta?.degradedSources).toEqual([]);
    expect(result.meta?.scannedRoots.length).toBeGreaterThan(0);
    expect(typeof result.meta?.durationMs).toBe('number');
    expect(typeof result.meta?.collectedAt).toBe('number');
  });

  // -----------------------------------------------------------------------
  // Scenario 22 — feature flag selects v2
  // -----------------------------------------------------------------------
  it('scannerPipeline returns v1 by default and v2 when the env flag is set', () => {
    delete process.env.AGENTSKIN_SCANNER;
    expect(scannerPipeline()).toBe('v1');
    process.env.AGENTSKIN_SCANNER = 'v2';
    expect(scannerPipeline()).toBe('v2');
  });

  // -----------------------------------------------------------------------
  // Scenario 23 — v2 scan returns the same app set as v1
  // -----------------------------------------------------------------------
  it('returns the same app set under the v2 pipeline flag', async () => {
    process.env.AGENTSKIN_SCANNER = 'v2';
    try {
      mockDetectInstallation.mockResolvedValue({
        installed: false,
        path: null,
        version: null,
        source: null,
      });
      configureExecMocks('2.0.0|2.0.0|CoolApp|Cool description|CoolCorp', '');

      const customRoot = 'D:\\CustomAppsV2';
      const appDir = `${customRoot}\\CoolApp`;
      const asarPath = `${appDir}\\resources\\app.asar`;

      readdirMap.set(customRoot, ['CoolApp']);
      statMap.set(appDir, 'dir');
      statMap.set(asarPath, 'asar');
      readdirMap.set(appDir, ['CoolApp.exe', 'resources']);
      statMap.set(`${appDir}\\CoolApp.exe`, 'file');

      const result = await scanElectronApps({ useCache: false, extraDirs: [customRoot] });

      expect(result.meta?.pipeline).toBe('v2');
      expect(result.other).toHaveLength(1);
      expect(result.other[0].exePath).toBe(`${appDir}\\CoolApp.exe`);
      expect(result.other[0].adapterMatch).toBeNull();
      expect(result.other[0].confidence).toBe(60);
    } finally {
      delete process.env.AGENTSKIN_SCANNER;
    }
  });

  // -----------------------------------------------------------------------
  // Scenario 23b — v2 merges multi-version installs by identity
  // -----------------------------------------------------------------------
  it('merges multi-version installs by identity under the v2 pipeline', async () => {
    process.env.AGENTSKIN_SCANNER = 'v2';
    try {
      mockDetectInstallation.mockResolvedValue({
        installed: false,
        path: null,
        version: null,
        source: null,
      });

      // Registry sweep finds two side-by-side Quark versions; PE read fails so
      // each entry falls back to its registry DisplayName + DisplayVersion.
      configureExecMocks(
        '',
        'Quark|7.0.5.931|D:\\Quark\\7.0.5.931\nQuark|7.0.7.940|D:\\Quark\\7.0.7.940',
      );
      readdirMap.set('D:\\Quark\\7.0.5.931', ['Quark.exe']);
      readdirMap.set('D:\\Quark\\7.0.7.940', ['Quark.exe']);
      statMap.set('D:\\Quark\\7.0.5.931\\Quark.exe', 'file');
      statMap.set('D:\\Quark\\7.0.7.940\\Quark.exe', 'file');

      const result = await scanElectronApps({ useCache: false });

      expect(result.meta?.pipeline).toBe('v2');
      expect(result.adapted).toHaveLength(0);
      expect(result.other).toHaveLength(1);
      expect(result.other[0].isDefaultEntry).toBe(true);
      expect(result.other[0].versions).toEqual(['7.0.7.940', '7.0.5.931']);
    } finally {
      delete process.env.AGENTSKIN_SCANNER;
    }
  });

  // -----------------------------------------------------------------------
  // Scenario 23c — streaming identity merge is pipeline-independent
  // -----------------------------------------------------------------------
  it('merges multi-version installs by identity under the default v1 pipeline too', async () => {
    delete process.env.AGENTSKIN_SCANNER;
    mockDetectInstallation.mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      source: null,
    });

    configureExecMocks(
      '',
      'Quark|7.0.5.931|D:\\Quark\\7.0.5.931\nQuark|7.0.7.940|D:\\Quark\\7.0.7.940',
    );
    readdirMap.set('D:\\Quark\\7.0.5.931', ['Quark.exe']);
    readdirMap.set('D:\\Quark\\7.0.7.940', ['Quark.exe']);
    statMap.set('D:\\Quark\\7.0.5.931\\Quark.exe', 'file');
    statMap.set('D:\\Quark\\7.0.7.940\\Quark.exe', 'file');

    const result = await scanElectronApps({ useCache: false });

    // The streaming identity merge (StreamMerge) applies to both pipelines so
    // the renderer never sees a pre-merge multi-version flood, and the settled
    // result is exactly what was streamed. v1 vs v2 only differ in collection
    // strategy (registry batch / filesystem parallelism), not merge behavior.
    expect(result.meta?.pipeline).toBe('v1');
    expect(result.other).toHaveLength(1);
    expect(result.other[0].isDefaultEntry).toBe(true);
    expect(result.other[0].versions).toEqual(['7.0.7.940', '7.0.5.931']);
  });

  // -----------------------------------------------------------------------
  // Scenario 23d — v2 registry sweep uses the batch PE reader
  // -----------------------------------------------------------------------
  it('v2 registry sweep reads PE info in a batch and returns the same app', async () => {
    process.env.AGENTSKIN_SCANNER = 'v2';
    try {
      mockDetectInstallation.mockResolvedValue({
        installed: false,
        path: null,
        version: null,
        source: null,
      });

      // Registry fixture returns one app; the batch PE read returns the same
      // metadata the single-exe v1 path would produce (path-prefixed line).
      configureExecMocksBatch(
        'MyApp|0.9.0|D:\\Apps\\MyApp',
        'D:\\Apps\\MyApp\\MyApp.exe|0.9.0|0.9.0|SomeApp|Generic Electron App|Unknown Inc',
      );

      statMap.set('D:\\Apps\\MyApp\\MyApp.exe', 'file');
      readdirMap.set('D:\\Apps\\MyApp', ['MyApp.exe']);

      const result = await scanElectronApps({ useCache: false });

      expect(result.meta?.pipeline).toBe('v2');
      expect(result.adapted).toHaveLength(0);
      expect(result.other).toHaveLength(1);
      expect(result.other[0]).toMatchObject({
        exePath: 'D:\\Apps\\MyApp\\MyApp.exe',
        productName: 'SomeApp',
        companyName: 'Unknown Inc',
        version: '0.9.0',
        adapterMatch: null,
      });
    } finally {
      delete process.env.AGENTSKIN_SCANNER;
    }
  });

  // -----------------------------------------------------------------------
  // Scenario 24 — resolveScanRoots includes extraDirs
  // -----------------------------------------------------------------------
  it('resolveScanRoots includes extraDirs with depth 2', () => {
    const roots = resolveScanRoots(['D:\\CustomA', 'D:\\CustomB']);
    const dirs = roots.map((root) => root.dir);
    expect(dirs).toContain('D:\\CustomA');
    expect(dirs).toContain('D:\\CustomB');

    const customA = roots.find((root) => root.dir === 'D:\\CustomA');
    expect(customA?.depth).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// matchAgainstHints — whole-word / whole-phrase matching
// ---------------------------------------------------------------------------

describe('matchAgainstHints', () => {
  it('matches a short single-word token as a whole word', () => {
    // 'ChatGPT' (7 chars, < 8) is a single-word hint for the codex adapter.
    expect(matchAgainstHints({ productName: 'ChatGPT Desktop', fileDescription: '' })).toBe(
      'codex',
    );
  });

  it('does not match a long single-word token that only appears as a substring', () => {
    // 'WorkBuddy' (9 chars) must not match inside the longer word 'WorkBuddyPro'.
    expect(matchAgainstHints({ productName: 'WorkBuddyPro', fileDescription: '' })).toBeNull();
  });

  it('requires every word of a phrase token to be present', () => {
    // Phrase 'OpenAI Codex' needs both 'openai' and 'codex'; 'Codex CLI' has only 'codex'.
    expect(matchAgainstHints({ productName: 'Codex CLI', fileDescription: '' })).toBeNull();
  });

  it('matches a phrase token when all words are present in any order', () => {
    // 'OpenAI Codex' words appear in reverse order across productName/fileDescription.
    expect(matchAgainstHints({ productName: 'Codex', fileDescription: 'OpenAI' })).toBe('codex');
  });
});

// ---------------------------------------------------------------------------
// shouldSkipRegistryEntry — L1/L2 reuse in the v2 registry sweep
// ---------------------------------------------------------------------------

describe('shouldSkipRegistryEntry', () => {
  it('returns true when the display name normalizes to a known product', () => {
    const known = new Set(['traesolocn', 'qoderworkcn']);
    expect(shouldSkipRegistryEntry('TRAE SOLO CN', known)).toBe(true);
    expect(shouldSkipRegistryEntry('QoderWork CN', known)).toBe(true);
  });

  it('returns false for an unknown product', () => {
    const known = new Set(['traesolocn']);
    expect(shouldSkipRegistryEntry('MyApp', known)).toBe(false);
  });

  it('normalizes a trailing version segment away', () => {
    const known = new Set(['quark']);
    expect(shouldSkipRegistryEntry('Quark 7.0.5.931', known)).toBe(true);
  });
});
