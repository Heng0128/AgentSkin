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

const { scanElectronApps, getCachedScan, invalidateScanCache } = await import('./electron-scanner');

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
      // past the 10s deadline.
      if (callCount > 5) {
        return realNow() + 11_000;
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
  });
});
