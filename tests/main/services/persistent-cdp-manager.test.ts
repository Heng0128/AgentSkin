// SPDX-License-Identifier: MPL-2.0

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock functions so they're available before module import
const mockAccess = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockCopyFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockExecFileAsync = vi.hoisted(() => vi.fn());

// Mock fs/promises with hoisted mock functions
vi.mock('node:fs/promises', () => ({
  default: {
    access: mockAccess,
    readFile: mockReadFile,
    mkdir: mockMkdir,
    copyFile: mockCopyFile,
    writeFile: mockWriteFile,
  },
  access: mockAccess,
  readFile: mockReadFile,
  mkdir: mockMkdir,
  copyFile: mockCopyFile,
  writeFile: mockWriteFile,
}));

// Mock exec-async
vi.mock('../../../src/shared/exec-async', () => ({
  execFileAsync: mockExecFileAsync,
}));

// Import after mocks are set up
import {
  addDebugPortToShortcut,
  configurePersistentCdpManager,
  ensurePersistentCdpPort,
  findShortcutForAgent,
  getEnvDebugPort,
  readShortcutArgs,
  setEnvDebugPort,
  shortcutHasDebugPort,
} from '../../../src/main/services/persistent-cdp-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Restore `process.platform` after each test. */
let originalPlatform: PropertyDescriptor | undefined;

function setPlatform(platform: 'win32' | 'darwin'): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

function createTempBackupDir(): string {
  return path.join(os.tmpdir(), `persistent-cdp-test-${Math.random().toString(36).slice(2, 10)}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persistent-cdp-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configurePersistentCdpManager({ log: vi.fn() });
    // Spy on os functions instead of mocking the entire module
    vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
    vi.spyOn(os, 'tmpdir').mockReturnValue('/tmp');
    // Setup default mock implementations
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('');
    mockMkdir.mockResolvedValue(undefined);
    mockCopyFile.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
      originalPlatform = undefined;
    }
  });

  // ── 1. ensurePersistentCdpPort: already-configured shortcut (Windows) ──
  it('returns alreadyConfigured when shortcut already has the flag', async () => {
    setPlatform('win32');
    const backupDir = createTempBackupDir();

    // findShortcutForAgent → returns a path
    mockExecFileAsync.mockImplementationOnce(async () => '/home/testuser/Desktop/TRAE SOLO.lnk');
    // shortcutHasDebugPort → readShortcutArgs returns args with flag
    mockExecFileAsync.mockImplementationOnce(async () => '--remote-debugging-port=9336');

    const result = await ensurePersistentCdpPort({
      agentId: 'traework',
      exePath: 'C:\\Program Files\\TRAE SOLO\\TRAE SOLO.exe',
      backupDir,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyConfigured).toBe(true);
    expect(result.port).toBe(9336);
    expect(result.modified).toBe(false);
    expect(result.method).toBe('shortcut');
  });

  // ── 2. ensurePersistentCdpPort: patches shortcut when flag absent (Win) ─
  it('patches shortcut and returns modified when flag is absent', async () => {
    setPlatform('win32');
    const backupDir = createTempBackupDir();

    // findShortcutForAgent → returns a path
    mockExecFileAsync.mockImplementationOnce(async () => '/home/testuser/Desktop/TRAE SOLO.lnk');
    // shortcutHasDebugPort → readShortcutArgs returns args WITHOUT flag
    mockExecFileAsync.mockImplementationOnce(async () => '--some-other-flag');
    // addDebugPortToShortcut → readShortcutArgs (again) + backup + write
    mockExecFileAsync.mockImplementationOnce(async () => '--some-other-flag');

    const result = await ensurePersistentCdpPort({
      agentId: 'traework',
      exePath: 'C:\\Program Files\\TRAE SOLO\\TRAE SOLO.exe',
      preferredPort: 9336,
      backupDir,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyConfigured).toBe(false);
    expect(result.modified).toBe(true);
    expect(result.port).toBe(9336);
    expect(result.method).toBe('shortcut');
    expect(result.backupPath).toContain('.bak');
  });

  // ── 3. ensurePersistentCdpPort: creates backup before modifying ─────────
  it('creates a backup file before modifying the shortcut', async () => {
    setPlatform('win32');
    const backupDir = createTempBackupDir();

    mockExecFileAsync.mockImplementationOnce(async () => '/home/testuser/Desktop/TRAE SOLO.lnk');
    mockExecFileAsync.mockImplementationOnce(async () => '');
    mockExecFileAsync.mockImplementationOnce(async () => '');

    const result = await ensurePersistentCdpPort({
      agentId: 'traework',
      exePath: 'C:\\Program Files\\TRAE SOLO\\TRAE SOLO.exe',
      preferredPort: 9222,
      backupDir,
    });

    expect(mockCopyFile).toHaveBeenCalledOnce();
    expect(result.backupPath).toBeTruthy();
    expect(result.backupPath).toMatch(/\.bak$/);
  });

  // ── 4. ensurePersistentCdpPort: already-configured env var (macOS) ─────
  it('returns alreadyConfigured when macOS env var is already set', async () => {
    setPlatform('darwin');
    const backupDir = createTempBackupDir();
    process.env.AGENTSKIN_CDP_PORT_TRAEWORK = '9336';

    const result = await ensurePersistentCdpPort({
      agentId: 'traework',
      exePath: '/Applications/TRAE SOLO.app/Contents/MacOS/TRAE SOLO',
      backupDir,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyConfigured).toBe(true);
    expect(result.port).toBe(9336);
    expect(result.method).toBe('env-var');

    delete process.env.AGENTSKIN_CDP_PORT_TRAEWORK;
  });

  // ── 5. ensurePersistentCdpPort: sets env var when absent (macOS) ────────
  it('sets env var and returns modified when macOS env var is absent', async () => {
    setPlatform('darwin');
    const backupDir = createTempBackupDir();
    delete process.env.AGENTSKIN_CDP_PORT_TRAEWORK;

    const result = await ensurePersistentCdpPort({
      agentId: 'traework',
      exePath: '/Applications/TRAE SOLO.app/Contents/MacOS/TRAE SOLO',
      preferredPort: 9336,
      backupDir,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyConfigured).toBe(false);
    expect(result.modified).toBe(true);
    expect(result.port).toBe(9336);
    expect(result.method).toBe('env-var');
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  // ── 6. findShortcutForAgent: returns null when no shortcut found ────────
  it('findShortcutForAgent returns null when no matching shortcut exists', async () => {
    setPlatform('win32');
    mockExecFileAsync.mockImplementation(async () => ''); // empty output = no match

    const result = await findShortcutForAgent('traework', 'C:\\NonExistent\\app.exe');

    expect(result).toBeNull();
  });

  // ── 7. findShortcutForAgent: finds a matching shortcut ─────────────────
  it('findShortcutForAgent returns the path of a matching shortcut', async () => {
    setPlatform('win32');
    mockExecFileAsync.mockImplementationOnce(async () => '/home/testuser/Desktop/TRAE SOLO.lnk');

    const result = await findShortcutForAgent(
      'traework',
      'C:\\Program Files\\TRAE SOLO\\TRAE SOLO.exe',
    );

    expect(result).toBe('/home/testuser/Desktop/TRAE SOLO.lnk');
  });

  // ── 8. shortcutHasDebugPort: detects existing flag with port ────────────
  it('shortcutHasDebugPort detects --remote-debugging-port=9336', async () => {
    mockExecFileAsync.mockImplementationOnce(
      async () => '--remote-debugging-port=9336 --disable-gpu',
    );

    const result = await shortcutHasDebugPort('/fake/shortcut.lnk');

    expect(result.has).toBe(true);
    expect(result.port).toBe(9336);
  });

  // ── 9. shortcutHasDebugPort: returns false when flag absent ─────────────
  it('shortcutHasDebugPort returns false when flag is absent', async () => {
    mockExecFileAsync.mockImplementationOnce(async () => '--disable-gpu --no-sandbox');

    const result = await shortcutHasDebugPort('/fake/shortcut.lnk');

    expect(result.has).toBe(false);
  });

  // ── 10. readShortcutArgs: returns the arguments string ──────────────────
  it('readShortcutArgs returns the shortcut arguments', async () => {
    mockExecFileAsync.mockImplementationOnce(async () => '--disable-gpu --no-sandbox');

    const result = await readShortcutArgs('/fake/shortcut.lnk');

    expect(result).toBe('--disable-gpu --no-sandbox');
  });

  // ── 11. getEnvDebugPort: returns null when env var not set ──────────────
  it('getEnvDebugPort returns null when env var is not set', async () => {
    delete process.env.AGENTSKIN_CDP_PORT_QODERWORK;

    const result = await getEnvDebugPort('qoderwork');

    expect(result).toBeNull();
  });

  // ── 12. getEnvDebugPort: returns port when env var is set ───────────────
  it('getEnvDebugPort returns the port when env var is set', async () => {
    process.env.AGENTSKIN_CDP_PORT_QODERWORK = '9444';

    const result = await getEnvDebugPort('qoderwork');

    expect(result).toBe(9444);

    delete process.env.AGENTSKIN_CDP_PORT_QODERWORK;
  });

  // ── 13. setEnvDebugPort: writes export line to shell profile ───────────
  it('setEnvDebugPort writes the export line to the shell profile', async () => {
    const result = await setEnvDebugPort('traework', 9336);

    expect(result).toContain('.bak');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    // mockWriteFile(filePath, content) → calls[0][1] is the content
    const writtenContent = mockWriteFile.mock.calls[0][1];
    expect(String(writtenContent)).toContain('AGENTSKIN_CDP_PORT_TRAEWORK=9336');
  });

  // ── 14. addDebugPortToShortcut: appends flag to existing args ───────────
  it('addDebugPortToShortcut appends the flag to existing arguments', async () => {
    // First call: readShortcutArgs returns existing args.
    mockExecFileAsync.mockImplementationOnce(async () => '--disable-gpu');
    // Second call: the write command (just needs to succeed).
    mockExecFileAsync.mockImplementationOnce(async () => '');

    const backupDir = createTempBackupDir();
    const result = await addDebugPortToShortcut('/fake/shortcut.lnk', 9222, backupDir);

    expect(result).toMatch(/\.bak$/);
    // The second execFileAsync call (write) should contain the new flag.
    // execFileAsync(command, args, timeout) → args[3] is the -Command script.
    const writeCall = mockExecFileAsync.mock.calls[1];
    const args = writeCall[1] as string[];
    expect(args[3]).toContain('--remote-debugging-port=9222');
  });
});
