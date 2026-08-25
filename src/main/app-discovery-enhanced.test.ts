// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_REGISTRY, getAppVersion, scanApps } from './app-discovery-enhanced';

const mockExec = vi.mocked(execFile);
const cb =
  (val: string) => (_c: string, _a: string[], _o: object, fn: (e: null, s: string) => void) => {
    fn(null, val);
    return {} as never;
  };

describe('app-discovery-enhanced', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-test-'));
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\test');
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    process.env.ProgramFiles = 'C:\\Program Files';
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    delete process.env.HOME;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('getAppVersion', () => {
    it('returns Windows ProductVersion via PowerShell', async () => {
      mockExec.mockImplementation(cb('1.2.3.4\n'));
      expect(await getAppVersion('C:\\app\\test.exe', 'win32')).toBe('1.2.3.4');
    });

    it('returns macOS version via mdls', async () => {
      mockExec.mockImplementation(cb('2.5.0\n'));
      expect(await getAppVersion('/Applications/Test.app', 'darwin')).toBe('2.5.0');
    });

    it('returns null when mdls reports (null)', async () => {
      mockExec.mockImplementation(cb('(null)\n'));
      expect(await getAppVersion('/Applications/Test.app', 'darwin')).toBeNull();
    });

    it('parses Linux --version output', async () => {
      mockExec.mockImplementation(cb('myapp 3.1.0-beta.1\n'));
      expect(await getAppVersion('/usr/bin/myapp', 'linux')).toBe('3.1.0-beta.1');
    });

    it('returns null on exec failure', async () => {
      mockExec.mockImplementation((_c, _a, _o, fn) => {
        fn(new Error('ENOENT'), '');
        return {} as never;
      });
      expect(await getAppVersion('/usr/bin/missing', 'linux')).toBeNull();
    });
  });

  describe('scanApps - Windows', () => {
    it('discovers installed app via path scan', async () => {
      const dir = path.join(tempDir, 'WorkBuddy');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'WorkBuddy.exe'), 'fake');
      process.env.ProgramFiles = tempDir;
      mockExec.mockImplementation(cb('5.3.0.1\n'));
      const results = await scanApps('workbuddy', { strategy: 'quick', platform: 'win32' });
      expect(results).toHaveLength(1);
      expect(results[0].path).toContain('WorkBuddy.exe');
      expect(results[0].version).toBe('5.3.0.1');
      expect(results[0].platform).toBe('win32');
    });

    it('returns empty when app not installed', async () => {
      expect(await scanApps('traework', { platform: 'win32' })).toHaveLength(0);
    });

    it('scans all adapters when no id given', async () => {
      process.env.ProgramFiles = tempDir;
      const results = await scanApps(undefined, { platform: 'win32' });
      expect(results).toHaveLength(0);
    });
  });

  describe('scanApps - macOS', () => {
    it('discovers app bundle in /Applications', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      process.env.HOME = tempDir;
      const appsDir = path.join(tempDir, 'Applications');
      fs.mkdirSync(appsDir, { recursive: true });
      fs.mkdirSync(path.join(appsDir, 'ChatGPT.app'));
      mockExec.mockImplementation(cb('26.707\n'));
      const results = await scanApps('codex', { strategy: 'quick', platform: 'darwin' });
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe(path.join(tempDir, 'Applications', 'ChatGPT.app'));
      expect(results[0].platform).toBe('darwin');
    });
  });

  describe('scanApps - Linux', () => {
    it('discovers app via which resolution', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      process.env.HOME = '/home/test';
      mockExec.mockImplementation((_c, _a, _o, fn) => {
        fn(null, _c === 'which' ? '/usr/bin/doubao\n' : 'doubao 1.8.0\n');
        return {} as never;
      });
      const results = await scanApps('doubao', { strategy: 'quick', platform: 'linux' });
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('/usr/bin/doubao');
      expect(results[0].version).toBe('1.8.0');
    });
  });

  describe('APP_REGISTRY', () => {
    it('has entries for all 6 adapters', () => {
      expect(APP_REGISTRY).toHaveLength(6);
      expect(APP_REGISTRY.map((e) => e.id)).toEqual([
        'traework',
        'qoderwork',
        'workbuddy',
        'doubao',
        'codex',
        'zcode',
      ]);
    });

    it('every entry has non-empty platform paths', () => {
      for (const entry of APP_REGISTRY) {
        expect(entry.installPaths.length).toBeGreaterThan(0);
        expect(entry.darwinBundles.length).toBeGreaterThan(0);
        expect(entry.linuxExecutables.length).toBeGreaterThan(0);
      }
    });
  });
});
