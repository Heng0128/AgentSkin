// SPDX-License-Identifier: MPL-2.0

import { createServer, type Server } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the PID/netstat parsing + resolveLivePort orchestration in
 * cdp-discovery. The isPort/probePortLive unit tests live in
 * cdp-discovery.test.ts; this file mocks ./exec-async (wmic + netstat) and
 * uses vi.resetModules + dynamic imports so the wmic snapshot cache
 * (cachedProcessSnapshot) starts empty for every test.
 */
vi.mock('./exec-async', () => ({ execFileAsync: vi.fn() }));

import type { PortDiscoveryAdapter } from './cdp-discovery';

/** Realistic wmic /format:list output (CRLF, blank-line-separated blocks). */
function wmicOutput(entries: { pid: number; cmd: string }[]): string {
  const blocks = entries.map((e) => `ProcessId=${e.pid}\r\nCommandLine=${e.cmd}`);
  return `${blocks.join('\r\n\r\n')}\r\n\r\n`;
}

/** Realistic `netstat -ano` output. */
function netstatOutput(rows: { local: string; pid: number; listening?: boolean }[]): string {
  const lines = rows.map(
    (r) =>
      `  TCP    ${r.local.padEnd(22)} 0.0.0.0:0              ${r.listening === false ? 'CLOSED' : 'LISTENING'}       ${r.pid}`,
  );
  return `Active Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n${lines.join('\n')}\n`;
}

/** Reset the module cache + return fresh imports (fresh wmic cache). */
async function freshModule() {
  vi.resetModules();
  const exec = await import('./exec-async');
  const mod = await import('./cdp-discovery');
  // The vi.mock factory is cached, so execFileAsync is the same vi.fn across
  // freshModule() calls — clear its call history + implementation so each
  // test starts clean.
  vi.mocked(exec.execFileAsync).mockReset();
  // P3-8 (includeStderr overload): execFileAsync now has two overloads.
  // `ReturnType<>` on overloaded functions only resolves the *last* overload
  // (TypeScript design limitation), which makes `mockResolvedValue(string)`
  // fail with "string is not assignable to ExecFileResult". These tests only
  // exercise the 3-arg (no includeStderr) call path, so cast the mock to the
  // first-overload signature here once — call sites can keep passing plain
  // strings.
  type StringOverload = (command: string, args: string[], timeoutMs?: number) => Promise<string>;
  return {
    mod,
    execFileAsync: vi.mocked(exec.execFileAsync as unknown as StringOverload),
  };
}

async function withListeningServer<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(port);
  } finally {
    server.close();
  }
}

describe('explicitDebugPortsFromPids', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('extracts --remote-debugging-port=N for the requested PIDs', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue(
      wmicOutput([
        { pid: 1234, cmd: 'C:\\app.exe --remote-debugging-port=8888' },
        { pid: 5678, cmd: 'C:\\other.exe --remote-debugging-port=9999' },
      ]),
    );
    expect(await mod.explicitDebugPortsFromPids([1234, 5678])).toEqual([8888, 9999]);
  });

  it('ignores port=0 (let-Chromium-pick) and out-of-range values', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue(
      wmicOutput([{ pid: 1234, cmd: 'C:\\app.exe --remote-debugging-port=0' }]),
    );
    expect(await mod.explicitDebugPortsFromPids([1234])).toEqual([]);
  });

  it('returns [] when wmic produces no output', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue('');
    expect(await mod.explicitDebugPortsFromPids([1234])).toEqual([]);
  });

  it('returns [] for an empty PID list', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue(
      wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=8888' }]),
    );
    expect(await mod.explicitDebugPortsFromPids([])).toEqual([]);
    // wmic must not be invoked for an empty PID list.
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('deduplicates and sorts ports ascending', async () => {
    const { mod, execFileAsync } = await freshModule();
    // Two blocks for the same pid, distinct ports → deduped + sorted.
    vi.mocked(execFileAsync).mockResolvedValue(
      `${wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=9222' }])}${wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=8222' }])}`,
    );
    expect(await mod.explicitDebugPortsFromPids([1234])).toEqual([8222, 9222]);
  });
});

describe('listeningPortsForPids', () => {
  it('returns only loopback (127.0.0.1 / ::1) listening ports for the PIDs', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue(
      netstatOutput([
        { local: '127.0.0.1:8888', pid: 1234 },
        { local: '0.0.0.0:9999', pid: 1234 }, // public binding — skipped
        { local: '[::1]:7777', pid: 1234 }, // IPv6 loopback — included
        { local: '127.0.0.1:6666', pid: 9999 }, // different PID — skipped
      ]),
    );
    expect(await mod.listeningPortsForPids([1234])).toEqual([8888, 7777]);
  });

  it('returns [] when netstat produces no output', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue('');
    expect(await mod.listeningPortsForPids([1234])).toEqual([]);
  });

  it('returns [] for an empty PID list', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue(
      netstatOutput([{ local: '127.0.0.1:8888', pid: 1234 }]),
    );
    expect(await mod.listeningPortsForPids([])).toEqual([]);
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('skips non-LISTENING rows', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue(
      netstatOutput([{ local: '127.0.0.1:8888', pid: 1234, listening: false }]),
    );
    expect(await mod.listeningPortsForPids([1234])).toEqual([]);
  });
});

describe('resolveLivePort', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeAdapter(overrides: Partial<PortDiscoveryAdapter> = {}): PortDiscoveryAdapter {
    return {
      resolveDebugPorts: vi.fn().mockResolvedValue([]),
      findTargets: vi.fn().mockResolvedValue([]),
      findRunningPids: vi.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  it('layer 1: returns a DevToolsActivePort-file port when it is live and has targets', async () => {
    const { mod, execFileAsync } = await freshModule();
    await withListeningServer(async (port) => {
      const adapter = makeAdapter({
        resolveDebugPorts: vi.fn().mockResolvedValue([port]),
        findTargets: vi.fn().mockResolvedValue([{}]),
      });
      const logs: string[] = [];
      const result = await mod.resolveLivePort(adapter, 'workbuddy', (m) => logs.push(m));
      expect(result).toBe(port);
      expect(logs.some((l) => l.includes('layer 1 (DevToolsActivePort file)'))).toBe(true);
    });
    expect(execFileAsync).not.toHaveBeenCalled();
  });

  it('layer 1: skips a port that is not actually listening (stale file)', async () => {
    const { mod } = await freshModule();
    const adapter = makeAdapter({
      resolveDebugPorts: vi.fn().mockResolvedValue([59997]), // nothing listening
      findRunningPids: vi.fn().mockResolvedValue([]),
    });
    const logs: string[] = [];
    const result = await mod.resolveLivePort(adapter, 'trae', (m) => logs.push(m));
    expect(result).toBeNull();
    // findTargets must not be called against the dead port.
    expect(adapter.findTargets).not.toHaveBeenCalled();
  });

  it('layer 1: skips the knownDeadPort and falls through to no port', async () => {
    const { mod } = await freshModule();
    await withListeningServer(async (port) => {
      const adapter = makeAdapter({
        resolveDebugPorts: vi.fn().mockResolvedValue([port]),
        findTargets: vi.fn().mockResolvedValue([{}]),
        findRunningPids: vi.fn().mockResolvedValue([]),
      });
      const result = await mod.resolveLivePort(adapter, 'qoder', () => {}, port);
      expect(result).toBeNull();
      expect(adapter.findTargets).not.toHaveBeenCalled();
    });
  });

  it('layer 2 (argv): returns the explicit port from the PID command line', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'wmic' ? wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=8222' }]) : '',
      ),
    );
    const adapter = makeAdapter({
      findRunningPids: vi.fn().mockResolvedValue([1234]),
      findTargets: vi.fn().mockResolvedValue([{}]),
    });
    const logs: string[] = [];
    const result = await mod.resolveLivePort(adapter, 'workbuddy', (m) => logs.push(m));
    expect(result).toBe(8222);
    expect(logs.some((l) => l.includes('layer 2 (argv)'))).toBe(true);
  });

  it('layer 2 (netstat): falls back to netstat when argv has no explicit port', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'wmic'
          ? wmicOutput([{ pid: 1234, cmd: 'C:\\app.exe --remote-debugging-port=0' }]) // port=0 ignored
          : netstatOutput([{ local: '127.0.0.1:9111', pid: 1234 }]),
      ),
    );
    const adapter = makeAdapter({
      findRunningPids: vi.fn().mockResolvedValue([1234]),
      findTargets: vi.fn().mockResolvedValue([{}]),
    });
    const logs: string[] = [];
    const result = await mod.resolveLivePort(adapter, 'doubao', (m) => logs.push(m));
    expect(result).toBe(9111);
    expect(logs.some((l) => l.includes('layer 2 (netstat) — CDP found'))).toBe(true);
  });

  it('layer 2 (netstat): skips ports already probed via argv', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'wmic'
          ? wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=8222' }])
          : netstatOutput([
              { local: '127.0.0.1:8222', pid: 1234 }, // already probed via argv
              { local: '127.0.0.1:9333', pid: 1234 }, // new
            ]),
      ),
    );
    // argv port 8222 returns no targets; netstat 8222 skipped, 9333 hits.
    const adapter = makeAdapter({
      findRunningPids: vi.fn().mockResolvedValue([1234]),
      findTargets: vi.fn().mockImplementation((port) => Promise.resolve(port === 9333 ? [{}] : [])),
    });
    const result = await mod.resolveLivePort(adapter, 'workbuddy', () => {});
    expect(result).toBe(9333);
  });

  it('layer 2 (argv): falls through to netstat when findTargets throws', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'wmic'
          ? wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=8222' }])
          : netstatOutput([{ local: '127.0.0.1:9333', pid: 1234 }]),
      ),
    );
    const adapter = makeAdapter({
      findRunningPids: vi.fn().mockResolvedValue([1234]),
      findTargets: vi
        .fn()
        .mockImplementation((port) =>
          port === 8222 ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve([{}]),
        ),
    });
    const result = await mod.resolveLivePort(adapter, 'workbuddy', () => {});
    expect(result).toBe(9333);
  });

  it('returns null and logs when no live CDP port is found anywhere', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockResolvedValue('');
    const adapter = makeAdapter({
      resolveDebugPorts: vi.fn().mockResolvedValue([59996]), // dead
      findRunningPids: vi.fn().mockResolvedValue([1234]),
      findTargets: vi.fn().mockResolvedValue([]),
    });
    const logs: string[] = [];
    const result = await mod.resolveLivePort(adapter, 'trae', (m) => logs.push(m));
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes('no live CDP port found'))).toBe(true);
  });

  it('returns null when findRunningPids throws (layer 2 best-effort)', async () => {
    const { mod } = await freshModule();
    const adapter = makeAdapter({
      resolveDebugPorts: vi.fn().mockResolvedValue([]),
      findRunningPids: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const logs: string[] = [];
    const result = await mod.resolveLivePort(adapter, 'trae', (m) => logs.push(m));
    expect(result).toBeNull();
    expect(logs.some((l) => l.includes('no live CDP port found'))).toBe(true);
  });

  it('layer 2 (argv): skips the knownDeadPort and continues to netstat', async () => {
    const { mod, execFileAsync } = await freshModule();
    vi.mocked(execFileAsync).mockImplementation((cmd) =>
      Promise.resolve(
        cmd === 'wmic'
          ? wmicOutput([{ pid: 1234, cmd: '--remote-debugging-port=8222' }])
          : netstatOutput([{ local: '127.0.0.1:9333', pid: 1234 }]),
      ),
    );
    const adapter = makeAdapter({
      findRunningPids: vi.fn().mockResolvedValue([1234]),
      findTargets: vi.fn().mockResolvedValue([{}]),
    });
    // 8222 is dead (skip argv), 9333 hits via netstat.
    const result = await mod.resolveLivePort(adapter, 'workbuddy', () => {}, 8222);
    expect(result).toBe(9333);
  });
});
