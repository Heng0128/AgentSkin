// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:net — must be declared before importing the module under test.
// Helpers use nested setTimeout to sequence events: outer fires bind callback,
// inner fires connect callback AFTER tryConnect sets up its handler.
vi.mock('node:net', () => ({
  default: { createServer: vi.fn(), connect: vi.fn() },
}));

const netModule = await import('node:net');
const mockedNet = netModule.default as unknown as {
  createServer: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};
const { PortResolver } = await import('./port-resolver');

interface FakeServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onError: ((err: Error & { code?: string }) => void) | null;
  on: ReturnType<typeof vi.fn>;
}
interface FakeSocket {
  destroy: ReturnType<typeof vi.fn>;
  onConnect: (() => void) | null;
  onError: (() => void) | null;
  on: ReturnType<typeof vi.fn>;
}

function createFakeServer(): FakeServer {
  const server: FakeServer = {
    listen: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
    onError: null,
    on: vi.fn((event: string, handler: (err: Error & { code?: string }) => void) => {
      if (event === 'error') server.onError = handler;
    }),
  };
  return server;
}

function createFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    destroy: vi.fn(),
    onConnect: null,
    onError: null,
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'connect') socket.onConnect = handler;
      if (event === 'error') socket.onError = handler;
    }),
  };
  return socket;
}

// Port is free: bind succeeds, then connect fails (no listener).
function simulateFreePort() {
  const server = createFakeServer();
  const socket = createFakeSocket();
  mockedNet.createServer.mockReturnValueOnce(server);
  mockedNet.connect.mockReturnValueOnce(socket);
  setTimeout(() => {
    server.listen.mock.calls[0]?.[2]?.();
    setTimeout(() => socket.onError?.(), 0);
  }, 0);
  return { server, socket };
}

// Port occupied: bind fails with EADDRINUSE.
function simulateOccupiedPort() {
  const server = createFakeServer();
  mockedNet.createServer.mockReturnValueOnce(server);
  setTimeout(() => {
    server.onError?.(Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' }));
  }, 0);
  return { server };
}

// Ghost listen: bind succeeds AND connect also succeeds.
function simulateGhostListenPort() {
  const server = createFakeServer();
  const socket = createFakeSocket();
  mockedNet.createServer.mockReturnValueOnce(server);
  mockedNet.connect.mockReturnValueOnce(socket);
  setTimeout(() => {
    server.listen.mock.calls[0]?.[2]?.();
    setTimeout(() => socket.onConnect?.(), 0);
  }, 0);
  return { server, socket };
}

describe('PortResolver', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) removes queued mockReturnValueOnce
    // entries so leftover entries from previous tests don't leak.
    vi.resetAllMocks();
  });
  afterEach(() => {});

  it('reports an available port as available', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    expect(await resolver.checkPort(9222)).toEqual({ port: 9222, available: true });
  });

  it('reports an occupied port as in-use', async () => {
    const resolver = new PortResolver();
    simulateOccupiedPort();
    const status = await resolver.checkPort(9222);
    expect(status.available).toBe(false);
    expect(status.reason).toBe('in-use');
  });

  it('detects ghost-listen ports', async () => {
    const resolver = new PortResolver();
    simulateGhostListenPort();
    const status = await resolver.checkPort(9222);
    expect(status.available).toBe(false);
    expect(status.reason).toBe('ghost-listen');
  });

  it('rejects out-of-range ports without probing', async () => {
    const resolver = new PortResolver();
    expect(await resolver.checkPort(80)).toEqual({
      port: 80,
      available: false,
      reason: 'out-of-range',
    });
    expect(await resolver.checkPort(70000)).toEqual({
      port: 70000,
      available: false,
      reason: 'out-of-range',
    });
  });

  it('accepts boundary port 1024', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    const status = await resolver.checkPort(1024);
    expect(status).toEqual({ port: 1024, available: true });
  });

  it('returns the preferred port when available', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    expect(await resolver.findAvailablePort(9222)).toBe(9222);
  });

  it('walks forward when preferred port is occupied', async () => {
    const resolver = new PortResolver();
    simulateOccupiedPort();
    simulateFreePort();
    expect(await resolver.findAvailablePort(9222)).toBe(9223);
  });

  it('throws when no port is available within budget', async () => {
    const resolver = new PortResolver({ maxAttempts: 3 });
    simulateOccupiedPort();
    simulateOccupiedPort();
    simulateOccupiedPort();
    await expect(resolver.findAvailablePort(9222)).rejects.toThrow(/No available port found/);
  });

  it('stops searching at port 65535', async () => {
    const resolver = new PortResolver({ maxAttempts: 10 });
    for (let i = 0; i < 10; i++) simulateOccupiedPort();
    await expect(resolver.findAvailablePort(65530)).rejects.toThrow(/No available port found/);
  });

  it('rents an available port successfully', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    expect(await resolver.rentPort(9222)).toBe(true);
    expect(resolver.rentedPorts.has(9222)).toBe(true);
  });

  it('fails to rent an occupied port', async () => {
    const resolver = new PortResolver();
    simulateOccupiedPort();
    expect(await resolver.rentPort(9222)).toBe(false);
  });

  it('prevents double-renting the same port', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    expect(await resolver.rentPort(9222)).toBe(true);
    expect(await resolver.rentPort(9222)).toBe(false);
  });

  it('allows re-renting after release', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    expect(await resolver.rentPort(9222)).toBe(true);
    resolver.releasePort(9222);
    simulateFreePort();
    expect(await resolver.rentPort(9222)).toBe(true);
  });

  it('returns a read-only copy of rented ports', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    await resolver.rentPort(9222);
    const ports = resolver.rentedPorts;
    (ports as Set<number>).add(9999);
    expect(resolver.rentedPorts.has(9999)).toBe(false);
  });

  it('times out when bind hangs', async () => {
    const resolver = new PortResolver({ timeoutMs: 50 });
    const server = createFakeServer();
    mockedNet.createServer.mockReturnValueOnce(server);
    const status = await resolver.checkPort(9222);
    expect(status.available).toBe(false);
    expect(status.reason).toBe('in-use');
  });

  it('uses sensible defaults', () => {
    const resolver = new PortResolver();
    expect(resolver.maxAttempts).toBe(100);
    expect(resolver.timeoutMs).toBe(2000);
  });

  it('respects custom options', () => {
    const resolver = new PortResolver({ maxAttempts: 50, timeoutMs: 1000 });
    expect(resolver.maxAttempts).toBe(50);
    expect(resolver.timeoutMs).toBe(1000);
  });
});
