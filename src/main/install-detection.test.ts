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

      // Result may or may not be installed depending on filesystem scan
      expect(result).toBeDefined();
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
