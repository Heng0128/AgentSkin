// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for install-detection.ts
 *
 * Covers: matchesIdentity logic (pure function), detectInstallation platform
 * guard, and verifyInstallPath behavior with mocked filesystem/PowerShell.
 */

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

describe('install-detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      mockStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      mockReaddir.mockResolvedValue(['Trae.exe']);
      mockExecFileAsync.mockResolvedValue({
        stdout: '1.0.0|1.0.0|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: undefined,
      } satisfies ExecFileResult);

      const result = await detectInstallation({
        platform: 'win32',
        appPath: 'C:\\Program Files\\Trae',
        hints: testHints,
        displayName: 'Trae',
      });

      expect(result.installed).toBe(true);
      expect(result.source).toBe('path');
      expect(result.version).toBe('1.0.0');
    });

    it('detects installation via manual appPath override (exe file path)', async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true,
      } as fs.Stats);
      mockReaddir.mockResolvedValue(['Trae.exe']);
      mockExecFileAsync.mockResolvedValue({
        stdout: '2.0.1|2.0.1|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: undefined,
      } satisfies ExecFileResult);

      const result = await detectInstallation({
        platform: 'win32',
        appPath: 'C:\\Program Files\\Trae\\Trae.exe',
        hints: testHints,
        displayName: 'Trae',
      });

      expect(result.installed).toBe(true);
      expect(result.source).toBe('path');
      expect(result.version).toBe('2.0.1');
    });

    it('falls back to path scan after registry scan fails', async () => {
      // Registry scan throws
      mockExecFileAsync.mockRejectedValueOnce(new Error('registry access denied'));

      // Then filesystem scan: for the directory check
      mockStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      mockReaddir.mockResolvedValue([]);
      // No exe found in any directory — mockReaddir returns empty array

      const result = await detectInstallation({
        platform: 'win32',
        hints: testHints,
        displayName: 'Trae',
      });

      expect(result.installed).toBe(false);
    });

    it('detects installation via MSIX package when registry finds nothing', async () => {
      // Registry scan returns empty
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        errorMessage: undefined,
      } satisfies ExecFileResult);

      // MSIX scan finds a package
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'C:\\Program Files\\WindowsApps\\ChatGPT\\app|1.2.3|ChatGPT\n',
        stderr: '',
        errorMessage: undefined,
      } satisfies ExecFileResult);

      const msixHints: InstallHints = {
        ...testHints,
        msixPackageNames: ['ChatGPT'],
      };

      const result = await detectInstallation({
        platform: 'win32',
        hints: msixHints,
        displayName: 'ChatGPT',
      });

      expect(result.installed).toBe(true);
      expect(result.source).toBe('msix');
      expect(result.path).toBe('C:\\Program Files\\WindowsApps\\ChatGPT\\app');
      expect(result.version).toBe('1.2.3');
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

    it('returns { path, version } when exe found in directory', async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      mockReaddir.mockResolvedValue(['Trae.exe']);
      mockExecFileAsync.mockResolvedValue({
        stdout: '3.0.0|3.0.0|Trae|Trae IDE\n',
        stderr: '',
        errorMessage: undefined,
      } satisfies ExecFileResult);

      const result = await verifyInstallPath('C:\\Program Files\\Trae', testHints);

      expect(result).not.toBeNull();
      expect(result?.path).toBe('C:\\Program Files\\Trae');
      expect(result?.version).toBe('3.0.0');
    });

    it('returns null when no exe matches in directory', async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false,
      } as fs.Stats);
      mockReaddir.mockResolvedValue(['unrelated.exe', 'readme.txt']);
      // The unrelated.exe doesn't match identity, so readExeInfo is called
      mockExecFileAsync.mockResolvedValue({
        stdout: '1.0.0|1.0.0|Unrelated App|Some other app\n',
        stderr: '',
        errorMessage: undefined,
      } satisfies ExecFileResult);

      const result = await verifyInstallPath('C:\\Program Files\\OtherApp', testHints);

      expect(result).toBeNull();
    });
  });
});
