// SPDX-License-Identifier: MPL-2.0

import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../../adapters/base';
import * as registry from '../../adapters/registry';
import {
  configureLauncher,
  launchApp,
  registerAllowedExePaths,
  resetLaunchRateLimit,
} from './electron-launcher';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

/**
 * Simulate a TCP socket for probeTcpPort and tryConnect (the post-spawn CDP
 * liveness check AND the ghost-listen detection). Default: connection refused
 * ('error' fires on next microtask → port is free). Tests that need success
 * call mockNetConnectSuccess().
 *
 * Supports both `socket.on(event, cb)` (used by tryConnect) and
 * `socket.once(event, cb)` (used by probeTcpPort) — the default mock must
 * register a handler for `'error'` that fires on the next microtask.
 */
function makeDefaultSocket() {
  // Store handlers keyed by event — supports both .on() and .once().
  const handlers: Record<string, () => void> = {};
  const socket = {
    once(event: string, cb: () => void) {
      handlers[event] = cb;
      if (event === 'error') queueMicrotask(cb);
    },
    on(event: string, cb: () => void) {
      handlers[event] = cb;
      // Default behavior: error fires on microtask (no listener = free port).
      if (event === 'error') queueMicrotask(cb);
    },
    destroy() {},
    unref() {},
    // Test trigger: invoke a stored handler.
    trigger(event: string) {
      handlers[event]?.();
    },
  };
  return socket;
}

/**
 * Simulate a TCP server for PortResolver.checkPort (the pre-spawn bind probe).
 * Default: bind succeeds (listen callback fires). Tests that need occupied
 * ports call mockNetBindFail().
 */
function makeDefaultServer() {
  const handlers: Record<string, (() => void) | ((err: Error) => void)> = {};
  return {
    listen(_port: number, _host: string, cb: () => void) {
      queueMicrotask(cb);
    },
    close(cb?: () => void) {
      cb?.();
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers[event] = handler;
      return this;
    },
    // Test trigger: invoke the stored error handler.
    triggerError(err: Error & { code?: string }) {
      (handlers as Record<string, (err: Error) => void>).error?.(err);
    },
  };
}

vi.mock('node:net', () => ({
  default: {
    connect: vi.fn(() => makeDefaultSocket()),
    createServer: vi.fn(() => makeDefaultServer()),
    Server: vi.fn(),
  },
}));

vi.mock('../../adapters/registry', () => ({
  requireAdapter: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);
const mockRequireAdapter = vi.mocked(registry.requireAdapter);
const mockNetConnect = vi.mocked(net.connect);
const mockNetCreateServer = (net as unknown as { createServer: ReturnType<typeof vi.fn> })
  .createServer;

/**
 * Instruct the next `createServer` to simulate an occupied port — the bind
 * callback is never called; instead, the error handler fires with EADDRINUSE.
 */
function mockNetBindFail() {
  mockNetCreateServer.mockImplementationOnce(() => {
    const server = makeDefaultServer();
    server.listen = (_p: number, _h: string, _cb: () => void) => {
      queueMicrotask(() =>
        server.triggerError(Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' })),
      );
    };
    return server;
  });
}

/**
 * Instruct the next `createServer` to simulate a ghost-listen port — bind
 * succeeds AND connect also succeeds. Used to verify that PortResolver
 * (and thus the launcher) correctly skips these ports.
 */
function mockNetGhostListen() {
  // Bind succeeds (default server behavior)
  mockNetCreateServer.mockImplementationOnce(() => makeDefaultServer());
  // AND connect also succeeds → ghost-listen detected.
  mockNetConnectSuccess();
}

/**
 * Instruct the next N `createServer` calls to simulate occupied ports.
 */
function mockNetBindFailN(count: number) {
  for (let i = 0; i < count; i++) mockNetBindFail();
}

// mockNetCreateServer is used directly in bind-failure tests.

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
): Partial<ApplicationAdapter> {
  return {
    findRunningPids: vi.fn().mockResolvedValue(overrides.runningPids ?? []),
    resolveDebugPorts: vi.fn().mockResolvedValue(overrides.debugPorts ?? []),
  };
}

/** Cast a partial adapter mock to the full ApplicationAdapter the registry expects. */
function asAdapter(partial: Partial<ApplicationAdapter>): ApplicationAdapter {
  return partial as unknown as ApplicationAdapter;
}

/**
 * Mock net.connect to simulate a successful TCP connection,
 * making `tryConnect` return true (ghost-listen detected: bind succeeds AND
 * connect succeeds). The socket's `on('connect', cb)` fires on microtask.
 */
function mockNetConnectSuccess() {
  mockNetConnect.mockImplementationOnce(
    () =>
      ({
        on(event: string, cb: () => void) {
          if (event === 'connect') queueMicrotask(cb);
        },
        once(event: string, cb: () => void) {
          if (event === 'connect') queueMicrotask(cb);
        },
        destroy() {},
        unref() {},
      }) as unknown as ReturnType<typeof net.connect>,
  );
}

/**
 * Mock net.connect to simulate a refused connection,
 * making `tryConnect` return false ('error' fires on microtask → port free).
 */
function mockNetConnectRefused() {
  mockNetConnect.mockImplementation(
    () =>
      ({
        on(event: string, cb: () => void) {
          if (event === 'error') queueMicrotask(cb);
        },
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
    // resetAllMocks (not clearAllMocks) also removes pending mockImplementationOnce
    // entries. These leak across tests when a test fails before consuming a queued
    // mock, causing subsequent tests to receive stale implementations.
    // ALSO: resetAllMocks removes the vi.fn(factory) default implementations set in
    // the module-level vi.mock factories. We MUST re-establish them afterwards;
    // otherwise net.connect() returns undefined and the port probes throw TypeErrors
    // that silently collapse into ghost-listen misclassification.
    vi.resetAllMocks();
    mockNetConnect.mockImplementation(
      () => makeDefaultSocket() as unknown as ReturnType<typeof net.connect>,
    );
    mockNetCreateServer.mockImplementation(
      () => makeDefaultServer() as unknown as ReturnType<typeof net.createServer>,
    );
    resetLaunchRateLimit();
    configureLauncher({ log: vi.fn() });
    // Seed the launch whitelist with every exePath the success-path tests
    // exercise, so the new C1 guard doesn't reject them. The rejection path
    // is covered by the dedicated describe block below.
    registerAllowedExePaths([
      'C:\\trae\\trae.exe',
      'C:\\qoder\\qoder.exe',
      'C:\\doubao\\doubao.exe',
      'C:\\tools\\myapp.exe',
      'C:\\tools\\tool.exe',
      'C:\\nonexistent\\app.exe',
      'C:\\nonexistent\\tool.exe',
    ]);
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

  function _mockExecFileError() {
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(new Error('fail'), '');
      return {} as ReturnType<typeof execFile>;
    });
  }

  // ── 1. Adapted app: spawn with --remote-debugging-port=0 ───────────────
  describe('adapted app launches with CDP port flag', () => {
    it('spawns with --remote-debugging-port=0 when no preferred port', async () => {
      const adapter = createMockAdapter({ runningPids: [], debugPorts: [9222] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      mockSpawnSuccess(1234);
      // Mock net.connect to succeed so discoverRandomPort resolves immediately
      // instead of burning the full 8000ms discovery timeout.
      mockNetConnectSuccess();

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
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // Port 9336 is occupied (bind fails); port 9337 is free (default mock).
      mockNetBindFail();
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

    it('spawns with port=0 (random) when useAdapterPreferredPort is set — ports are never fixed', async () => {
      const adapter = createMockAdapter({ runningPids: [], debugPorts: [9451] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      mockSpawnSuccess(7777);
      // Mock net.connect to succeed so discoverRandomPort resolves immediately
      // instead of burning the full 8000ms discovery timeout.
      mockNetConnectSuccess();

      const result = await launchApp({
        appId: 'app-qoder-no-override',
        exePath: 'C:\\qoder\\qoder.exe',
        adapted: true,
        adapterId: 'qoderwork',
        useAdapterPreferredPort: true,
      });

      expect(result.state).toBe('launched');
      expect(mockSpawn).toHaveBeenCalledOnce();
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      // Adapter preferred ports are 0 (random-port policy) — Chromium picks.
      expect(spawnArgs[0]).toBe('--remote-debugging-port=0');
      // The real port is discovered afterwards via DevToolsActivePort files.
      expect(result.port).toBe(9451);
    });

    it('stays on the random-port path even when band ports are occupied (useAdapterPreferredPort)', async () => {
      const adapter = createMockAdapter({ runningPids: [], debugPorts: [9517] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // Under the random-port policy the launcher never walks a fixed band
      // from an adapter "home" port — occupied band probes are irrelevant.
      mockSpawnSuccess(8888);
      mockNetConnectSuccess();

      const result = await launchApp({
        appId: 'app-trae-fallback',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        adapterId: 'traework',
        useAdapterPreferredPort: true,
      });

      expect(result.state).toBe('launched');
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs[0]).toBe('--remote-debugging-port=0');
      expect(result.port).toBe(9517);
    });

    it('returns state=failed when all port candidates are occupied', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // Occupy the entire fallback range: preferredPort=9400 down to 9222 = 179 ports.
      // The resolver will exhaust MAX_PORT_RETRIES (136 for the agent band).
      mockNetBindFailN(136);

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
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
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
    });
  });

  // ── 4. Adapted app running but no CDP port ─────────────────────────────
  describe('adapted app running without CDP port', () => {
    it('returns state=needs-restart when no CDP ports are discovered', async () => {
      const adapter = createMockAdapter({
        runningPids: [7777],
        debugPorts: [], // no CDP ports discovered
      });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));

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
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
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
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
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
    it('walks forward to the next free port on conflict', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // Port 9336 occupied (bind fails); port 9337 free (default).
      mockNetBindFail();
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

    it('skips ghost-listen ports (bind succeeds but connect also succeeds)', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // Port 9336 is a ghost-listen — must be skipped.
      mockNetGhostListen();
      // Port 9337 is free (default).
      mockSpawnSuccess(9999);

      const result = await launchApp({
        appId: 'app-ghost-skip',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        preferredPort: 9336,
        adapterId: 'traework',
      });

      expect(result.state).toBe('launched');
      const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
      expect(spawnArgs[0]).toBe('--remote-debugging-port=9337');
    });

    it('returns state=failed when preferredPort exceeds 65535', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // No createServer calls should happen — the invalid port is rejected upfront.
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

    it('respects the adapter fallback range upper bound', async () => {
      const adapter = createMockAdapter({ runningPids: [] });
      mockRequireAdapter.mockReturnValue(asAdapter(adapter));
      // Occupy the full agent band from 9350 to 9357 (8 ports), the resolver
      // must stop at 9357 and give up — never probing beyond the range.
      mockNetBindFailN(8);

      const result = await launchApp({
        appId: 'app-port-at-range-edge',
        exePath: 'C:\\trae\\trae.exe',
        adapted: true,
        preferredPort: 9350,
        adapterId: 'traework',
      });

      expect(result.state).toBe('failed');
      expect(mockSpawn).not.toHaveBeenCalled();
      // Verify the resolver probed exactly the 8-port range [9350, 9357] —
      // no more (would mean it walked past the endPort bound).
      expect(mockNetCreateServer).toHaveBeenCalledTimes(8);
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

  // ── C1: exePath whitelist guard ────────────────────────────────────────
  describe('exePath whitelist guard', () => {
    it('rejects an exePath that was never registered — does not spawn', async () => {
      const result = await launchApp({
        appId: 'app-malicious',
        // Attacker-controlled path that is NOT in the whitelist.
        exePath: 'C:\\Windows\\System32\\cmd.exe',
        adapted: false,
      });

      expect(result.state).toBe('failed');
      expect(result.ok).toBe(false);
      // The guard must short-circuit before any spawn call.
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('rejects an exePath even when adapted=true with a valid adapterId', async () => {
      const result = await launchApp({
        appId: 'app-malicious-adapted',
        exePath: 'C:\\Windows\\System32\\cmd.exe',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).toBe('failed');
      expect(mockSpawn).not.toHaveBeenCalled();
      // The requireAdapter must not even be reached on a rejected path.
      expect(mockRequireAdapter).not.toHaveBeenCalled();
    });

    it('accepts a registered path with case-insensitive comparison on win32', async () => {
      // registered as 'C:\\trae\\trae.exe' in beforeEach; launch with a
      // different case — must still be allowed (and spawn).
      mockExecFileSuccess('');
      mockRequireAdapter.mockReturnValue(
        asAdapter(createMockAdapter({ runningPids: [], debugPorts: [0] })),
      );
      mockSpawnSuccess(4242);
      // Mock net.connect to succeed so discoverRandomPort resolves immediately
      // instead of burning the full 8000ms discovery timeout.
      mockNetConnectSuccess();

      const result = await launchApp({
        appId: 'app-case-insensitive',
        exePath: 'c:\\TRAE\\TRAE.EXE',
        adapted: true,
        adapterId: 'traework',
      });

      expect(result.state).not.toBe('failed');
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  // ── O4: launch rate limiting ──────────────────────────────────────────
  describe('launch rate limit', () => {
    it('rejects the 6th launch within the 5s window', async () => {
      resetLaunchRateLimit();
      const base = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(base);

      // First 5 launches pass the rate-limit gate and consume a slot, then
      // fail fast at the whitelist guard (non-whitelisted exePath → no spawn,
      // no slow CDP probing).
      for (let i = 0; i < 5; i += 1) {
        const r = await launchApp({
          appId: `app-rate-${i}`,
          exePath: 'C:\\nonexistent\\x.exe',
          adapted: false,
        });
        expect(r.state).toBe('failed');
        expect(r.message).toContain('not an allowed'); // whitelist, not rate limit
      }

      // 6th launch within the same window → rejected by the rate limiter.
      const sixth = await launchApp({
        appId: 'app-rate-6',
        exePath: 'C:\\nonexistent\\x.exe',
        adapted: false,
      });
      expect(sixth.state).toBe('failed');
      expect(sixth.message).toContain('rate limit');

      // After the window elapses, launches are allowed again.
      vi.spyOn(Date, 'now').mockReturnValue(base + 6_000);
      resetLaunchRateLimit();
      const later = await launchApp({
        appId: 'app-rate-later',
        exePath: 'C:\\nonexistent\\x.exe',
        adapted: false,
      });
      expect(later.message).not.toContain('rate limit');
      vi.restoreAllMocks();
    });
  });
});
