// SPDX-License-Identifier: MPL-2.0
/* biome-ignore-all lint/suspicious/noExplicitAny: test mocks for node:child_process require any for callback parameters */

import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:child_process at module level (ESM-compatible)
// vi.hoisted 确保 mockExecFile 在 vi.mock 工厂执行前已定义
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

import {
  configureLaunchd,
  getLaunchdDeps,
  getStatus,
  installService,
  isLaunchdSupported,
  loadService,
  setupService,
  startService,
  stopService,
  uninstallService,
  unloadService,
} from './launchd-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockLog = vi.fn();

/** 创建临时目录用于测试 */
async function createTempDir(): Promise<string> {
  const tmp = path.join(
    os.tmpdir(),
    `agentskin-launchd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tmp, { recursive: true });
  return tmp;
}

// ---------------------------------------------------------------------------
// Platform guard tests
// ---------------------------------------------------------------------------

describe('isLaunchdSupported', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns true on darwin', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    expect(isLaunchdSupported()).toBe(true);
  });

  it('returns false on win32', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    expect(isLaunchdSupported()).toBe(false);
  });

  it('returns false on linux', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    expect(isLaunchdSupported()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: 为需要 darwin 平台的测试套件设置 process.platform mock
// ---------------------------------------------------------------------------

function mockDarwin(): void {
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
}

// ---------------------------------------------------------------------------
// configureLaunchd tests
// ---------------------------------------------------------------------------

describe('configureLaunchd', () => {
  afterEach(() => {
    configureLaunchd(null as unknown as never);
  });

  it('stores the injected deps', () => {
    const testDeps = {
      getExecutablePath: () => '/Mock/App.app',
      getWorkingDirectory: () => '/Mock/Cwd',
      log: mockLog,
    };
    configureLaunchd(testDeps);
    expect(getLaunchdDeps()).toBe(testDeps);
  });
});

// ---------------------------------------------------------------------------
// installService tests (mock execFile)
// ---------------------------------------------------------------------------

describe('installService', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin.app/Contents/MacOS/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const plistPath = path.join(tempDir, 'Library', 'LaunchAgents', 'com.agentskin.launchd.plist');
    if (existsSync(plistPath)) {
      await unlink(plistPath).catch(() => {});
    }
  });

  it('creates LaunchAgents directory if not exists', async () => {
    await installService();
    const launchAgentsDir = path.join(tempDir, 'Library', 'LaunchAgents');
    expect(existsSync(launchAgentsDir)).toBe(true);
  });

  it('writes plist file with correct content', async () => {
    await installService();
    const plistPath = path.join(tempDir, 'Library', 'LaunchAgents', 'com.agentskin.launchd.plist');
    expect(existsSync(plistPath)).toBe(true);

    const content = await readFile(plistPath, 'utf-8');
    expect(content).toContain('<string>com.agentskin.launchd</string>');
    expect(content).toContain('<string>/Mock/AgentSkin.app/Contents/MacOS/AgentSkin</string>');
    expect(content).toContain('<key>RunAtLoad</key>');
    expect(content).toContain('<true/>');
    expect(content).toContain('<key>KeepAlive</key>');
    expect(content).toContain('StandardOutPath');
    expect(content).toContain('StandardErrorPath');
  });

  it('creates log directory', async () => {
    await installService();
    const logDir = path.join(tempDir, 'Library', 'Logs');
    expect(existsSync(logDir)).toBe(true);
  });

  it('logs installation steps', async () => {
    await installService();
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Installing plist'));
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('installed successfully'));
  });

  it('escapes XML special characters in paths', async () => {
    configureLaunchd({
      getExecutablePath: () => '/Mock/App & Special <Chars>',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });
    mockLog.mockClear();

    await installService();
    const plistPath = path.join(tempDir, 'Library', 'LaunchAgents', 'com.agentskin.launchd.plist');
    const content = await readFile(plistPath, 'utf-8');
    expect(content).toContain('/Mock/App &amp; Special &lt;Chars&gt;');
    expect(content).not.toContain('/Mock/App & Special <Chars>');
  });
});

// ---------------------------------------------------------------------------
// uninstallService tests
// ---------------------------------------------------------------------------

describe('uninstallService', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('removes plist file if exists', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });

    await installService();
    const plistPath = path.join(tempDir, 'Library', 'LaunchAgents', 'com.agentskin.launchd.plist');
    expect(existsSync(plistPath)).toBe(true);

    await uninstallService();
    expect(existsSync(plistPath)).toBe(false);
  });

  it('does not throw when plist does not exist', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
    await expect(uninstallService()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadService tests
// ---------------------------------------------------------------------------

describe('loadService', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });

    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('throws if plist not installed', async () => {
    await expect(loadService()).rejects.toThrow('Plist not found');
  });

  it('calls launchctl load after install', async () => {
    await installService();
    mockLog.mockClear();

    await loadService();
    expect(mockExecFile).toHaveBeenCalledWith(
      'launchctl',
      ['load', expect.stringContaining('com.agentskin.launchd.plist')],
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// unloadService tests
// ---------------------------------------------------------------------------

describe('unloadService', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });

    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls launchctl unload', async () => {
    await installService();
    mockLog.mockClear();

    await unloadService();
    expect(mockExecFile).toHaveBeenCalledWith(
      'launchctl',
      ['unload', expect.stringContaining('com.agentskin.launchd.plist')],
      expect.any(Function),
    );
  });

  it('does not throw when plist does not exist', async () => {
    await expect(unloadService()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// startService / stopService tests
// ---------------------------------------------------------------------------

describe('startService and stopService', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });

    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('startService calls launchctl start with label', async () => {
    await startService();
    expect(mockExecFile).toHaveBeenCalledWith(
      'launchctl',
      ['start', 'com.agentskin.launchd'],
      expect.any(Function),
    );
  });

  it('stopService calls launchctl stop with label', async () => {
    await stopService();
    expect(mockExecFile).toHaveBeenCalledWith(
      'launchctl',
      ['stop', 'com.agentskin.launchd'],
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// getStatus tests
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns installed=false when plist not present', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(new Error('not loaded'), { stdout: '', stderr: '' });
    });

    const status = await getStatus();
    expect(status.installed).toBe(false);
    expect(status.loaded).toBe(false);
  });

  it('returns installed=true after installService', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(new Error('not loaded'), { stdout: '', stderr: '' });
    });

    await installService();
    const status = await getStatus();
    expect(status.installed).toBe(true);
  });

  it('returns loaded=true when launchctl list succeeds', async () => {
    const mockStdout = '{\n\tExitCode = 0;\n\tLabel = "com.agentskin.launchd";\n}';
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: mockStdout, stderr: '' });
    });

    await installService();
    const status = await getStatus();
    expect(status.loaded).toBe(true);
    expect(status.exitCode).toBe(0);
  });

  it('parses non-zero exit code', async () => {
    const mockStdout = '{\n\tExitCode = 1;\n\tLabel = "com.agentskin.launchd";\n}';
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: mockStdout, stderr: '' });
    });

    await installService();
    const status = await getStatus();
    expect(status.loaded).toBe(true);
    expect(status.exitCode).toBe(1);
  });

  it('parses negative exit code', async () => {
    const mockStdout = '{\n\tExitCode = -1;\n\tLabel = "com.agentskin.launchd";\n}';
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: mockStdout, stderr: '' });
    });

    await installService();
    const status = await getStatus();
    expect(status.loaded).toBe(true);
    expect(status.exitCode).toBe(-1);
  });

  it('includes correct plistPath and logPath', async () => {
    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(new Error('not loaded'), { stdout: '', stderr: '' });
    });

    const status = await getStatus();
    expect(status.plistPath).toContain('com.agentskin.launchd.plist');
    expect(status.logPath).toContain('agentskin-launchd.log');
  });
});

// ---------------------------------------------------------------------------
// setupService tests
// ---------------------------------------------------------------------------

describe('setupService', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockDarwin();
    tempDir = await createTempDir();
    vi.spyOn(os, 'homedir').mockReturnValue(tempDir);
    mockExecFile.mockReset();
    mockLog.mockClear();

    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      getWorkingDirectory: () => tempDir,
      log: mockLog,
    });

    mockExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, { stdout: '', stderr: '' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('installs and loads service', async () => {
    await setupService();
    const plistPath = path.join(tempDir, 'Library', 'LaunchAgents', 'com.agentskin.launchd.plist');
    expect(existsSync(plistPath)).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'launchctl',
      ['load', expect.stringContaining('com.agentskin.launchd.plist')],
      expect.any(Function),
    );
  });
});

// ---------------------------------------------------------------------------
// Platform guard error tests
// ---------------------------------------------------------------------------

describe('platform guard', () => {
  beforeEach(() => {
    configureLaunchd({
      getExecutablePath: () => '/Mock/AgentSkin',
      log: mockLog,
    });
    mockLog.mockClear();
    mockExecFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('installService throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(installService()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });

  it('uninstallService throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(uninstallService()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });

  it('loadService throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(loadService()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });

  it('unloadService throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(unloadService()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });

  it('startService throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(startService()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });

  it('stopService throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(stopService()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });

  it('getStatus throws on non-darwin', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    await expect(getStatus()).rejects.toThrow('launchd is only supported on macOS');
    vi.unstubAllGlobals();
  });
});
