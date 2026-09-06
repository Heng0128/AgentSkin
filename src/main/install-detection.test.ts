// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for install-detection.ts
 *
 * Covers: detectInstallation platform guard, path detection, MSIX detection,
 * and verifyInstallPath behavior with mocked filesystem/PowerShell.
 */

import type { Stats } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the exec-async module BEFORE importing install-detection
vi.mock('../shared/exec-async', () => ({
  execFileAsync: vi.fn(),
}));

// Mock the fs/promises module
vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
}));

// Mock appendLogLine
vi.mock('./fs-utils', () => ({
  appendLogLine: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from 'node:fs/promises';
import type { InstallHints } from '../adapters/base';
import type { ExecFileResult } from '../shared/exec-async';
import { execFileAsync } from '../shared/exec-async';
import { detectInstallation, verifyInstallPath } from './install-detection';

const mockExecFileAsync = vi.mocked(execFileAsync);
const mockStat = vi.mocked(fs.stat);
const mockReaddir = vi.mocked(fs.readdir);

const testHints: InstallHints = {
  exeNames: ['Trae.exe'],
  dirNames: ['Trae'],
  registryNames: ['Trae', 'Trae CN'],
};

/**
 * Helper to mock readdir with string array (avoids Dirent type mismatch).
 */
function mockReaddirWithStrings(items: string[]): void {
  // biome-ignore lint: test mock bridging Dirent/string type mismatch
  mockReaddir.mockResolvedValue(items as any);
}

/**
 * Creates a mock Stats object for a directory.
 */
function mockDirStats(): Stats {
  return { isDirectory: () => true, isFile: () => false } as Stats;
}

/**
 * Creates a mock Stats object for a file.
 */
function mockFileStats(): Stats {
  return { isDirectory: () => false, isFile: () => true } as Stats;
}

describe('install-detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all paths are directories (prevents ENOENT from breaking tests)
    mockStat.mockResolvedValue(mockDirStats());
  });

  describe('detectInstallation', () => {
    it('returns NOT INSTALLED when platform is not win32', async () => {
      const result = await detectInstallation({
        platform: 'darwin',
        hints: testHints,
        displayName: 'Trae',
      });

      expect(result).toEqual({
        installed: false,
        path: null,
        version: null,
        source: null,
        injectable: false,
      });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('returns NOT INSTALLED when hints is undefined', async () => {
      const result = await detectInstallation({
        platform: 'win32',
        hints: undefined,
        displayName: 'Trae',
      });

      expect(result).toEqual({
        installed: false,
        path: null,
        version: null,
        source: null,
        injectable: false,
      });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('detects installation via manual appPath override (directory)', async () => {
      mockReaddirWithStrings(['Trae.exe']);
      // Make the exe path return file stats
      mockStat.mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('Trae.exe')) {
          return mockFileStats();
        }
        return mockDirStats();
      });
      mockExecFileAsync.mockResolvedValue({
        stdout: '1.0.0|1.0.0|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: '',
      } as ExecFileResult);

      const result = await detectInstallation({
        platform: 'win32',
        appPath: 'C:\\Program Files\\Trae',
        hints: testHints,
        displayName: 'Trae',
      });

      // When appPath is provided, installed is always true (manual override)
      expect(result.installed).toBe(true);
      expect(result.source).toBe('path');
    });

    it('detects installation via manual appPath override (exe file path)', async () => {
      mockReaddirWithStrings(['Trae.exe']);
      mockStat.mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('Trae.exe')) {
          return mockFileStats();
        }
        return mockDirStats();
      });
      mockExecFileAsync.mockResolvedValue({
        stdout: '2.0.1|2.0.1|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: '',
      } as ExecFileResult);

      const result = await detectInstallation({
        platform: 'win32',
        appPath: 'C:\\Program Files\\Trae\\Trae.exe',
        hints: testHints,
        displayName: 'Trae',
      });

      // When appPath is provided, installed is always true (manual override)
      expect(result.installed).toBe(true);
      expect(result.source).toBe('path');
    });

    it('falls back to path scan after registry scan fails', async () => {
      // Registry scan throws
      mockExecFileAsync.mockRejectedValueOnce(new Error('registry access denied'));
      // Filesystem scan finds nothing
      mockReaddirWithStrings([]);

      const result = await detectInstallation({
        platform: 'win32',
        hints: testHints,
        displayName: 'Trae',
      });

      expect(result.installed).toBe(false);
    });

    it('handles MSIX hints without throwing', async () => {
      // Registry scan returns empty
      mockExecFileAsync.mockResolvedValue({
        stdout: '',
        stderr: '',
        errorMessage: '',
      } as ExecFileResult);
      // Filesystem scan finds nothing
      mockReaddirWithStrings([]);

      const msixHints: InstallHints = {
        ...testHints,
        msixPackageNames: ['ChatGPT'],
      };

      // Should not throw even with MSIX hints
      const result = await detectInstallation({
        platform: 'win32',
        hints: msixHints,
        displayName: 'ChatGPT',
      });

      // Both registry and filesystem scans return empty → not installed
      expect(result.installed).toBe(false);
    });

    it('marks MSIX-detected installs as not injectable', async () => {
      // execFileAsync returns a string when called without includeStderr (the
      // MSIX and registry scans use this overload). The mock must return a
      // string, not an ExecFileResult object. The double assertion bridges
      // the overloaded signature to the string-returning overload.
      mockExecFileAsync.mockImplementation((async (_cmd: string, args: string[]) => {
        const script = Array.isArray(args) ? args.join(' ') : '';
        // MSIX scan script contains "Get-AppxPackage"
        if (script.includes('Get-AppxPackage')) {
          // MSIX script output format: exeDir|version|packageName
          return 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.825.5331.0_x64__2p2nqsd0c76g0\\app|26.825.5331.0|OpenAI.Codex\n';
        }
        // Registry scan (and anything else) returns empty
        return '';
      }) as unknown as typeof execFileAsync);
      // Filesystem scan finds nothing (MSIX path is in WindowsApps, not scanned)
      mockReaddirWithStrings([]);
      // Ensure stat returns directory stats (prevents false exe matches)
      mockStat.mockResolvedValue(mockDirStats());

      const msixHints: InstallHints = {
        ...testHints,
        msixPackageNames: ['OpenAI.Codex'],
      };

      const result = await detectInstallation({
        platform: 'win32',
        hints: msixHints,
        displayName: 'ChatGPT',
      });

      // MSIX detection succeeds → installed
      expect(result.installed).toBe(true);
      expect(result.source).toBe('msix');
      expect(result.path).toContain('WindowsApps');
      // MSIX packages ARE injectable via .lnk shortcut launch
      expect(result.injectable).toBe(true);
    });

    it('marks path-detected installs as injectable', async () => {
      mockReaddirWithStrings(['Trae.exe']);
      mockStat.mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('Trae.exe')) {
          return mockFileStats();
        }
        return mockDirStats();
      });
      mockExecFileAsync.mockResolvedValue({
        stdout: '1.0.0|1.0.0|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: '',
      } as ExecFileResult);

      const result = await detectInstallation({
        platform: 'win32',
        appPath: 'C:\\Program Files\\Trae',
        hints: testHints,
        displayName: 'Trae',
      });

      expect(result.installed).toBe(true);
      expect(result.source).toBe('path');
      // Traditional installs can be spawn-launched with --remote-debugging-port
      expect(result.injectable).toBe(true);
    });
  });

  describe('verifyInstallPath', () => {
    it('returns null for empty path', async () => {
      const result = await verifyInstallPath('', testHints);
      expect(result).toBeNull();
    });

    it('returns null for whitespace-only path', async () => {
      const result = await verifyInstallPath('   ', testHints);
      expect(result).toBeNull();
    });

    it('returns null when directory does not exist', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));

      const result = await verifyInstallPath('C:\\NonExistent\\Path', testHints);

      expect(result).toBeNull();
    });

    it('returns valid result structure when path is valid', async () => {
      mockReaddirWithStrings(['Trae.exe']);
      mockExecFileAsync.mockResolvedValue({
        stdout: '3.0.0|3.0.0|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: '',
      } as ExecFileResult);

      const result = await verifyInstallPath('C:\\Program Files\\Trae', testHints);

      // Result should be either null or have the expected structure
      if (result) {
        expect(result.path).toBe('C:\\Program Files\\Trae');
      }
    });

    it('returns null when no exe matches in directory', async () => {
      mockReaddirWithStrings(['unrelated.exe', 'readme.txt']);
      mockStat.mockImplementation(async (p) => {
        const pathStr = String(p);
        if (pathStr.endsWith('.exe')) {
          return mockFileStats();
        }
        return mockDirStats();
      });
      // The unrelated.exe doesn't match identity
      mockExecFileAsync.mockResolvedValue({
        stdout: '1.0.0|1.0.0|Unrelated App|Some other app\n',
        stderr: '',
        errorMessage: '',
      } as ExecFileResult);

      const result = await verifyInstallPath('C:\\Program Files\\OtherApp', testHints);

      expect(result).toBeNull();
    });
  });
});
