// SPDX-License-Identifier: MPL-2.0

import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as registry from '../../adapters/registry';
import { configureLauncher, getRunningApps, launchApp } from './electron-launcher';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:net', () => {
  // Default: simulate connection refused (no listener yet) — fires 'error'
  // on the next microtask. Tests needing success call mockNetConnectSuccess().
  const defaultSocket = {
    once(event: string, cb: () => void) {
      if (event === 'error') queueMicrotask(cb);
    },
    destroy() {},
  };
  return {
    default: {
      connect: vi.fn(() => defaultSocket),
    },
  };
});

vi.mock('../../adapters/registry', () => ({
  requireAdapter: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);
const mockRequireAdapter = vi.mocked(registry.requireAdapter);
const mockNetConnect = vi.mocked(net.connect);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock adapter with configurable behavior. */
function createMockAdapter(
  overrides: {
    /** PIDs returned by findRunningPids. Default []. */
    runningPids?: number[];
    /** Ports returned by resolveDebugPorts. Default []. */
    debugPorts?: number[];
  } = {},
) {
  return {
    findRunningPids: vi.fn().mockResolvedValue(overrides.runningPids ?? []),
    resolveDebugPorts: vi.fn().mockResolvedValue(overrides.debugPorts ?? []),
  };
}

/**
 * Mock net.connect to simulate a successful TCP connection,
 * making `probeTcpPort` return true ('connect' fires on next microtask).
 */
function mockNetConnectSuccess() {
  mockNetConnect.mockImplementation(
    () =>
      ({
        once(event: string, cb: () => void) {
          if (event === 'connect') queueMicrotask(cb);
        },
        destroy() {},
      }) as unknown as ReturnType<typeof net.connect>,
  );
}

/**
 * Mock net.connect to simulate a refused connection,
 * making `probeTcpPort` return false ('error' fires on next microtask).
 */
function mockNetConnectRefused() {
  mockNetConnect.mockImplementation(
    () =>
      ({
        once(event: string, cb: () => void) {
          if (event === 'error') queueMicrotask(cb);
        },
        destroy() {},
      }) as unknown as ReturnType<typeof net.connect>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('electron-launcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureLauncher({ log: vi.fn() });
    // Note: module-level runningApps Map persists across tests by design
    // (it tracks real spawned PIDs). Tests use unique appId per case to
    // avoid cross-test contamination.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helper: mock spawn to return a fake child with a pid ────────────────
  function mockSpawnSuccess(pid: number) {
    mockSpawn.mockImplementationOnce(
      () => ({ pid, unref: vi.fn(), on: vi.fn() }) as unknown as ReturnType<typeof spawn>,
    );
  }

  // ── Helper: mock execFile for tasklist/taskkill/powershell ─────────────
  function mockExecFileSuccess(stdout = '') {
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, stdout);
      return {} as ReturnType<typeof execFile>;
    });
  }

  function mockExecFileError() {
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(new Error('fail'), '');
      return {} as ReturnType<typeof execFile>;
    });
  }

  // ── 1. Adapted app: spawn with --remote-debugging-port=0 ───────────────
  describe('adapted app launches with CDP port flag', () => {
    it('spawns with --remote-debugging-port=0 when no preferred port', async () => {
      const adapter = createMockAdapter({ runningPids: [], debugPorts: [9222] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      mockSpawnSuccess(1234);

      const result = await launchApp({
        appId: 'app-trae',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).toBe('launched');
      expect(result.ok).toBe(true);
      expect(result.pid).toBe(1234);
      expect(mockSpawn).toHaveBeenCalledOnce();
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\trae\\trae.exe',
        expect.arrayContaining([
          expect.stringMatching(/^--remote-debugging-port=\d+$/),
          '--remote-debugging-address=127.0.0.1',
        ]),
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
      // The port arg must be 0 (random) since no preference was given.
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs[0]).toBe('--remote-debugging-port=0');
    });

    it('spawns with the preferred port when specified and available', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // PowerShell says port 9336 is occupied.
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (err: Error | null, stdout: string) => void)(null, 'occupied');
        return {} as ReturnType<typeof execFile>;
      });
      // PowerShell says port 9337 is free.
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (err: Error | null, stdout: string) => void)(null, '');
        return {} as ReturnType<typeof execFile>;
      });
      mockSpawnSuccess(5678);

      const result = await launchApp({
        appId: 'app-qoder',
        exePath: 'C:\\qoder\\qoder.exe',
        adapted: true,
        preferredPort: 9336,
        adapterId: 'qoderwork',
      });

      expect(result.state).toBe('launched');
      expect(mockSpawn).toHaveBeenCalledOnce();
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs[0]).toBe('--remote-debugging-port=9337');
    });

    it('returns state=failed when all port candidates are occupied', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // All 11 probes (preferredPort + 0..10) report occupied.
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: Error | null, stdout: string) => void)(null, 'occupied');
        return {} as ReturnType<typeof execFile>;
      });

      const result = await launchApp({
        appId: 'app-doubao',
        exePath: 'C:\\doubao\\doubao.exe',
        adapted: true,
        preferredPort: 9400,
        adapterId: 'doubao',
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
      expect(result.message).toBe('端口全部被占用');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── 2. Non-adapted app: spawn without any port args ────────────────────
  describe('non-adapted app launches without CDP flags', () => {
    it('spawns with no extra arguments and port=null', async () => {
      mockExecFileSuccess(''); // tasklist returns empty → not running
      mockSpawnSuccess(9999);

      const result = await launchApp({
        appId: 'app-random-tool',
        exePath: 'C:\\tools\\myapp.exe',
        adapted: false,
      });

      expect(result.state).toBe('launched');
      expect(result.ok).toBe(true);
      expect(result.pid).toBe(9999);
      expect(result.port).toBeNull();
      expect(mockSpawn).toHaveBeenCalledOnce();
      expect(mockSpawn).toHaveBeenCalledWith(
        'C:\\tools\\myapp.exe',
        [], // no args
        expect.any(Object),
      );
    });

    it('returns state=running when the exe is already in the tasklist', async () => {
      mockExecFileSuccess('"myapp.exe","1234","Console","1","1234 K"');
      // No spawn should happen.
      const result = await launchApp({
        appId: 'app-already-running',
        exePath: 'C:\\tools\\myapp.exe',
        adapted: false,
      });

      expect(result.state).toBe('running');
      expect(result.ok).toBe(true);
      expect(result.port).toBeNull();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── 3. Adapted app already running with CDP port ──────────────────────
  describe('adapted app already running with CDP port', () => {
    it('does not restart — returns state=running with the live port', async () => {
      const adapter = createMockAdapter({ runningPids: [4242], debugPorts: [9222] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // Simulate that port 9222 has an active listener so probeTcpPort succeeds.
      mockNetConnectSuccess();

      const result = await launchApp({
        appId: 'app-running-with-cdp',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).toBe('running');
      expect(result.ok).toBe(true);
      expect(result.pid).toBe(4242);
      expect(result.port).toBe(9222);
      expect(mockSpawn).not.toHaveBeenCalled();
      // The running entry must be tracked.
      expect(getRunningApps().get('app-running-with-cdp')?.port).toBe(9222);
    });
  });

  // ── 4. Adapted app running but no CDP port ─────────────────────────────
  describe('adapted app running without CDP port', () => {
    it('returns state=needs-restart when no CDP ports are discovered', async () => {
      const adapter = createMockAdapter({
        runningPids: [7777],
        debugPorts: [], // no CDP ports discovered
      });
      mockRequireAdapter.mockReturnValue(adapter as any);

      const result = await launchApp({
        appId: 'app-running-no-cdp',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).toBe('needs-restart');
      expect(result.ok).toBe(false);
      expect(result.pid).toBe(7777);
      expect(result.port).toBeNull();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('returns state=needs-restart when CDP ports exist but all probes fail', async () => {
      const adapter = createMockAdapter({
        runningPids: [8888],
        debugPorts: [9222, 9223], // ports discovered but none reachable
      });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // Simulate that both ports refuse connection.
      mockNetConnectRefused();

      const result = await launchApp({
        appId: 'app-running-dead-cdp',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).toBe('needs-restart');
      expect(result.ok).toBe(false);
      expect(result.pid).toBe(8888);
      expect(result.port).toBeNull();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── 5. Launch failure (exe does not exist / spawn throws) ──────────────
  describe('launch failure', () => {
    it('returns state=failed when spawn throws synchronously', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('The system cannot find the file specified');
      });

      const result = await launchApp({
        appId: 'app-missing',
        exePath: 'C:\\nonexistent\\app.exe',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('cannot find');
    });

    it('returns state=failed for non-adapted app when spawn throws', async () => {
      mockExecFileSuccess(''); // not running
      mockSpawn.mockImplementationOnce(() => {
        throw new Error('spawn ENOENT');
      });

      const result = await launchApp({
        appId: 'app-nonadapted-missing',
        exePath: 'C:\\nonexistent\\tool.exe',
        adapted: false,
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('ENOENT');
    });
  });

  // ── 6. Port conflict → automatic next-port retry ──────────────────────
  describe('port conflict resolution', () => {
    it('tries port+1 through port+10 on conflict', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // First call: port 9336 occupied.
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (err: Error | null, stdout: string) => void)(null, 'occupied');
        return {} as ReturnType<typeof execFile>;
      });
      // Second call: port 9337 free.
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
        (cb as (err: Error | null, stdout: string) => void)(null, '');
        return {} as ReturnType<typeof execFile>;
      });
      mockSpawnSuccess(8888);

      const result = await launchApp({
        appId: 'app-port-retry',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        preferredPort: 9336,
        adapterId: 'traework',
      });

      expect(result.state).toBe('launched');
      expect(mockSpawn).toHaveBeenCalledOnce();
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs[0]).toBe('--remote-debugging-port=9337');
    });

    it('returns state=failed when preferredPort exceeds 65535', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // No execFile calls should happen — the invalid port is rejected upfront.
      const result = await launchApp({
        appId: 'app-port-overflow',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        preferredPort: 70000,
        adapterId: 'traework',
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('stops incrementing when candidate exceeds 65535 (preferredPort near ceiling)', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      // preferredPort=65533, retries would yield 65533, 65534, 65535, 65536...
      // The loop must break at 65536 and never pass it to spawn.
      mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
        (cb as (err: Error | null, stdout: string) => void)(null, 'occupied');
        return {} as ReturnType<typeof execFile>;
      });

      const result = await launchApp({
        appId: 'app-port-ceiling',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        preferredPort: 65533,
        adapterId: 'traework',
      });

      expect(result.state).toBe('failed');
      expect(mockSpawn).not.toHaveBeenCalled();
      // Verify no execFile call probed a port > 65535.
      for (const call of mockExecFile.mock.calls) {
        const cmd = call[0] as string;
        if (cmd.includes('powershell') || cmd === 'powershell') {
          const argStr = JSON.stringify(call[1]);
          // Extract the port number from the PowerShell command.
          const portMatch = argStr.match(/-LocalPort (\d+)/);
          if (portMatch) {
            expect(Number(portMatch[1])).toBeLessThanOrEqual(65535);
          }
        }
      }
    });
  });

  // ── Running apps tracking ──────────────────────────────────────────────
  describe('getRunningApps', () => {
    it('tracks launched apps and returns a snapshot', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(adapter as any);
      mockExecFileSuccess(''); // not running (adapted flow: findRunningPids already mocked)
      mockSpawnSuccess(1111);

      await launchApp({
        appId: 'app-tracked',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'traework',
      });

      const running = getRunningApps();
      expect(running.has('app-tracked')).toBe(true);
      expect(running.get('app-tracked')?.pid).toBe(1111);

      // Verify it's a copy — mutating the returned map must not affect state.
      running.delete('app-tracked');
      expect(getRunningApps().has('app-tracked')).toBe(true);
    });

    it('clears a running app when its spawned process exits', async () => {
      mockExecFileSuccess(''); // not running → spawn
      // Capture the exit handler so we can simulate process termination.
      const captured = { handler: null as (() => void) | null };
      mockSpawn.mockImplementationOnce(
        () =>
          ({
            pid: 2222,
            unref: vi.fn(),
            on: vi.fn((event: string, cb: () => void) => {
              if (event === 'exit') captured.handler = cb;
            }),
          }) as unknown as ReturnType<typeof spawn>,
      );

      await launchApp({
        appId: 'app-exit-cleanup',
        exePath: 'C:\\tools\\tool.exe',
        adapted: false,
      });

      expect(getRunningApps().has('app-exit-cleanup')).toBe(true);

      // Simulate the spawned process terminating.
      captured.handler?.();
      expect(getRunningApps().has('app-exit-cleanup')).toBe(false);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────
  describe('error safety', () => {
    it('never throws — returns structured failure', async () => {
      // Cause requireAdapter to throw (adapterId provided but not registered).
      mockRequireAdapter.mockImplementation(() => {
        throw new Error('No application adapter registered for id "unknown"');
      });

      // Should NOT throw — must resolve with state=failed.
      const result = await launchApp({
        appId: 'app-bad-adapter',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'unknown',
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
    });

    it('returns state=failed when adapted=true but adapterId is missing', async () => {
      const result = await launchApp({
        appId: 'app-no-adapter-id',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
    });
  });
});
