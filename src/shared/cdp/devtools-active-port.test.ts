// SPDX-License-Identifier: MPL-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expandCandidatesForPlatform,
  expandPath,
  getDevToolsActivePortCandidates,
  getMsixUserDataDirsSync,
  readDevToolsActivePort,
  scanDevToolsActivePort,
} from './devtools-active-port';

/**
 * Helper: create a temporary directory with a DevToolsActivePort file.
 * Returns the directory path (caller must clean up).
 */
function createPortDir(port: number | string, wsPath = '/devtools/browser/abc'): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentskin-dtap-'));
  writeFileSync(join(dir, 'DevToolsActivePort'), `${port}\n${wsPath}\n`);
  return dir;
}

describe('expandPath', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('expands ~ to the user home directory', () => {
    const result = expandPath('~/Library/Application Support/ChatGPT');
    expect(result).not.toContain('~');
    expect(result).toContain('Library/Application Support/ChatGPT');
  });

  it('does NOT expand ~ when it is not a path prefix', () => {
    const result = expandPath('/foo~bar/baz');
    expect(result).toBe('/foo~bar/baz');
  });

  it('expands %APPDATA% on Windows-style paths', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const result = expandPath('%APPDATA%\\ChatGPT');
    expect(result).toBe('C:\\Users\\test\\AppData\\Roaming\\ChatGPT');
  });

  it('expands %LOCALAPPDATA% on Windows-style paths', () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    const result = expandPath('%LOCALAPPDATA%\\Programs\\ChatGPT');
    expect(result).toBe('C:\\Users\\test\\AppData\\Local\\Programs\\ChatGPT');
  });

  it('leaves unknown %VAR% tokens unresolved', () => {
    const result = expandPath('%UNKNOWN_VAR%\\ChatGPT');
    expect(result).toBe('%UNKNOWN_VAR%\\ChatGPT');
  });

  it('handles paths with no tokens', () => {
    const result = expandPath('/absolute/path/no/tokens');
    expect(result).toBe('/absolute/path/no/tokens');
  });
});

describe('readDevToolsActivePort', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it('reads a valid port from a well-formed file', async () => {
    const dir = createPortDir(9222);
    dirs.push(dir);
    expect(await readDevToolsActivePort(dir)).toBe(9222);
  });

  it('reads the port even when the second line (ws path) is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentskin-dtap-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'DevToolsActivePort'), '9335\n');
    expect(await readDevToolsActivePort(dir)).toBe(9335);
  });

  it('handles CRLF line endings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentskin-dtap-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'DevToolsActivePort'), '9222\r\n/devtools/browser/abc\r\n');
    expect(await readDevToolsActivePort(dir)).toBe(9222);
  });

  it('returns null when the file does not exist', async () => {
    const dir = join(tmpdir(), `agentskin-dtap-nonexistent-${Date.now()}`);
    expect(await readDevToolsActivePort(dir)).toBeNull();
  });

  it('returns null when the file is empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentskin-dtap-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'DevToolsActivePort'), '');
    expect(await readDevToolsActivePort(dir)).toBeNull();
  });

  it('returns null when the port is below 1024', async () => {
    const dir = createPortDir(80);
    dirs.push(dir);
    expect(await readDevToolsActivePort(dir)).toBeNull();
  });

  it('returns null when the port is above 65535', async () => {
    const dir = createPortDir(70000);
    dirs.push(dir);
    expect(await readDevToolsActivePort(dir)).toBeNull();
  });

  it('returns null when the port is not an integer', async () => {
    const dir = createPortDir('not-a-number');
    dirs.push(dir);
    expect(await readDevToolsActivePort(dir)).toBeNull();
  });

  it('returns null when the port is a float', async () => {
    const dir = createPortDir('9222.5');
    dirs.push(dir);
    expect(await readDevToolsActivePort(dir)).toBeNull();
  });

  it('trims whitespace from the port line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentskin-dtap-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'DevToolsActivePort'), '  9222  \n/devtools/browser/abc\n');
    expect(await readDevToolsActivePort(dir)).toBe(9222);
  });
});

describe('getDevToolsActivePortCandidates', () => {
  it('returns Windows templates for win32', () => {
    const candidates = getDevToolsActivePortCandidates('win32');
    expect(candidates.length).toBeGreaterThan(0);
    // All should contain % or backslash (Windows-style paths).
    for (const c of candidates) {
      expect(c.template.includes('%') || c.template.includes('\\')).toBe(true);
    }
  });

  it('returns macOS templates for darwin', () => {
    const candidates = getDevToolsActivePortCandidates('darwin');
    expect(candidates.length).toBeGreaterThan(0);
    // All should start with ~/ (macOS-style home-relative paths).
    for (const c of candidates) {
      expect(c.template.startsWith('~/')).toBe(true);
    }
  });

  it('returns empty array for linux', () => {
    const candidates = getDevToolsActivePortCandidates('linux');
    expect(candidates).toEqual([]);
  });

  it('includes codex candidates', () => {
    const candidates = getDevToolsActivePortCandidates('win32');
    const codexCandidates = candidates.filter((c) => c.agentId === 'codex');
    expect(codexCandidates.length).toBeGreaterThan(0);
  });

  it('includes qoderwork candidates', () => {
    const candidates = getDevToolsActivePortCandidates('win32');
    const qoderCandidates = candidates.filter((c) => c.agentId === 'qoderwork');
    expect(qoderCandidates.length).toBeGreaterThan(0);
  });

  it('includes all six supported agents', () => {
    const candidates = getDevToolsActivePortCandidates('win32');
    const agentIds = new Set(candidates.map((c) => c.agentId));
    expect(agentIds.has('codex')).toBe(true);
    expect(agentIds.has('qoderwork')).toBe(true);
    expect(agentIds.has('traework')).toBe(true);
    expect(agentIds.has('workbuddy')).toBe(true);
    expect(agentIds.has('doubao')).toBe(true);
    expect(agentIds.has('zcode')).toBe(true);
  });
});

describe('expandCandidatesForPlatform', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('expands all templates to absolute paths on win32', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    process.env.USERPROFILE = 'C:\\Users\\test';
    const expanded = expandCandidatesForPlatform('win32');
    expect(expanded.length).toBeGreaterThan(0);
    for (const e of expanded) {
      expect(e.dirPath).not.toContain('%');
      expect(e.agentId).toBeTruthy();
    }
  });

  it('expands all templates to absolute paths on darwin', () => {
    const expanded = expandCandidatesForPlatform('darwin');
    expect(expanded.length).toBeGreaterThan(0);
    for (const e of expanded) {
      expect(e.dirPath).not.toContain('~');
      // On the current platform, os.homedir() determines the absolute root.
      // On macOS this starts with '/'; on Windows it starts with a drive letter.
      const isAbsolute = /^[A-Za-z]:\\/.test(e.dirPath) || e.dirPath.startsWith('/');
      expect(isAbsolute).toBe(true);
    }
  });
});

describe('getMsixUserDataDirsSync', () => {
  let fakeHome: string;
  const dirs: string[] = [];

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'agentskin-msix-'));
    dirs.push(fakeHome);
  });

  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it('returns the Codex user-data dir when an OpenAI.Codex MSIX package exists', () => {
    const userData = join(
      fakeHome,
      'AppData',
      'Local',
      'Packages',
      'OpenAI.Codex_1.0.0.0_x64__hash',
      'LocalCache',
      'Roaming',
      'Codex',
      'web',
      'Codex',
    );
    mkdirSync(userData, { recursive: true });
    const result = getMsixUserDataDirsSync(fakeHome);
    expect(result).toContain(userData);
  });

  it('ignores packages without the Codex user-data subtree', () => {
    const pkg = join(fakeHome, 'AppData', 'Local', 'Packages', 'OpenAI.Codex_1.0.0.0_x64__hash');
    mkdirSync(join(pkg, 'LocalCache'), { recursive: true });
    mkdirSync(join(fakeHome, 'AppData', 'Local', 'Packages', 'Some.OtherApp_1.0.0.0_x64__hash'), {
      recursive: true,
    });
    expect(getMsixUserDataDirsSync(fakeHome)).toEqual([]);
  });

  it('returns empty when the Packages root is missing', () => {
    expect(getMsixUserDataDirsSync(fakeHome)).toEqual([]);
  });

  it('appends the MSIX candidate to expandCandidatesForPlatform on win32', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    process.env.USERPROFILE = 'C:\\Users\\test';
    const userData = join(
      fakeHome,
      'AppData',
      'Local',
      'Packages',
      'OpenAI.Codex_1.0.0.0_x64__hash',
      'LocalCache',
      'Roaming',
      'Codex',
      'web',
      'Codex',
    );
    mkdirSync(userData, { recursive: true });
    const expanded = expandCandidatesForPlatform('win32', fakeHome);
    expect(expanded.some((c) => c.agentId === 'codex' && c.dirPath === userData)).toBe(true);
  });

  it('does not duplicate an MSIX candidate already covered by a static template', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    process.env.USERPROFILE = 'C:\\Users\\test';
    const userData = join(
      fakeHome,
      'AppData',
      'Local',
      'Packages',
      'OpenAI.Codex_1.0.0.0_x64__hash',
      'LocalCache',
      'Roaming',
      'Codex',
      'web',
      'Codex',
    );
    mkdirSync(userData, { recursive: true });
    const expanded = expandCandidatesForPlatform('win32', fakeHome);
    const codexDirs = expanded.filter((c) => c.agentId === 'codex' && c.dirPath === userData);
    expect(codexDirs.length).toBe(1);
  });
});

describe('scanDevToolsActivePort', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it('returns null when no candidate directory has a port file', async () => {
    // All candidate dirs point to non-existent locations (no env vars set),
    // so scan should return null.
    const result = await scanDevToolsActivePort('linux');
    expect(result).toBeNull();
  });

  it('returns null for linux platform (no candidates)', async () => {
    const result = await scanDevToolsActivePort('linux');
    expect(result).toBeNull();
  });
});
