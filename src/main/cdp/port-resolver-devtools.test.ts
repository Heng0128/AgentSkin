// SPDX-License-Identifier: MPL-2.0

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:net and node:fs/promises — must be declared before importing the
// module under test.
vi.mock('node:net', () => ({
  default: { createServer: vi.fn(), connect: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn() },
}));

const netModule = await import('node:net');
const fsModule = await import('node:fs/promises');
const mockedNet = netModule.default as unknown as {
  createServer: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};
const mockedFs = fsModule.default as unknown as {
  readFile: ReturnType<typeof vi.fn>;
};

const { PortResolver, buildDevToolsActivePortPath, resolveDevToolsActivePort, resolveDebugPort } =
  await import('./port-resolver');

// ---------------------------------------------------------------------------
// Test helpers (shared with port-resolver.test.ts)
// ---------------------------------------------------------------------------

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

function simulateOccupiedPort() {
  const server = createFakeServer();
  mockedNet.createServer.mockReturnValueOnce(server);
  setTimeout(() => {
    server.onError?.(Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' }));
  }, 0);
  return { server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDevToolsActivePortPath', () => {
  const originalPlatform = process.platform;
  const originalLocalAppData = process.env.LOCALAPPDATA;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }
  });

  it('returns macOS path when platform is darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const home = os.homedir();
    const result = buildDevToolsActivePortPath('QoderWork');
    expect(result).toBe(
      path.join(home, 'Library', 'Application Support', 'QoderWork', 'DevToolsActivePort'),
    );
  });

  it('returns Windows path when platform is win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.LOCALAPPDATA = 'C:\\Users\\test\\AppData\\Local';
    const result = buildDevToolsActivePortPath('TRAE SOLO');
    expect(result).toBe(
      path.join('C:\\Users\\test\\AppData\\Local', 'TRAE SOLO', 'DevToolsActivePort'),
    );
  });

  it('falls back to ~/AppData/Local when LOCALAPPDATA is unset on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    delete process.env.LOCALAPPDATA;
    const home = os.homedir();
    const result = buildDevToolsActivePortPath('WorkBuddy');
    expect(result).toBe(path.join(home, 'AppData', 'Local', 'WorkBuddy', 'DevToolsActivePort'));
  });

  it('returns Linux path when platform is linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const home = os.homedir();
    const result = buildDevToolsActivePortPath('qoderwork');
    expect(result).toBe(path.join(home, '.config', 'qoderwork', 'DevToolsActivePort'));
  });
});

describe('resolveDevToolsActivePort', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns the port number when file contains a valid port', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('9222\n');
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBe(9222);
  });

  it('strips whitespace and trailing newlines', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('  1234  \r\n');
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBe(1234);
  });

  it('returns null when file does not exist', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBeNull();
  });

  it('returns null when file content is not a number', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('not-a-port\n');
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBeNull();
  });

  it('returns null when port is below MIN_PORT (1024)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('80\n');
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBeNull();
  });

  it('returns null when port is above MAX_PORT (65535)', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('70000\n');
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBeNull();
  });

  it('returns null when file is empty', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('');
    const result = await resolveDevToolsActivePort('QoderWork');
    expect(result).toBeNull();
  });
});

describe('resolveDebugPort', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns preferredPort when provided', async () => {
    const result = await resolveDebugPort({ preferredPort: 5000 });
    expect(result).toBe(5000);
    // Should not read the file when preferredPort is given.
    expect(mockedFs.readFile).not.toHaveBeenCalled();
  });

  it('reads DevToolsActivePort file when no preferredPort', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('9222\n');
    const result = await resolveDebugPort({ appPath: 'QoderWork' });
    expect(result).toBe(9222);
  });

  it('returns defaultPort when file read fails and no preferredPort', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await resolveDebugPort({ appPath: 'QoderWork' });
    expect(result).toBe(9222); // DEFAULT_DEBUG_PORT
  });

  it('returns custom defaultPort when file read fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await resolveDebugPort({ appPath: 'QoderWork', defaultPort: 3000 });
    expect(result).toBe(3000);
  });

  it('skips file read when appPath is not provided', async () => {
    const result = await resolveDebugPort({});
    expect(result).toBe(9222);
    expect(mockedFs.readFile).not.toHaveBeenCalled();
  });

  it('ignores non-integer preferredPort', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mockedFs.readFile.mockResolvedValueOnce('5555\n');
    const result = await resolveDebugPort({ appPath: 'QoderWork', preferredPort: 3.14 });
    expect(result).toBe(5555);
  });
});

describe('findAvailablePort with DevToolsActivePort fallback', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('falls back to DevToolsActivePort file when TCP walk exhausts', async () => {
    const resolver = new PortResolver({ maxAttempts: 2 });
    // Both TCP attempts fail (occupied).
    simulateOccupiedPort();
    simulateOccupiedPort();
    // DevToolsActivePort file returns port 9222.
    mockedFs.readFile.mockResolvedValueOnce('9222\n');
    // The fallback checkPort(9222) needs a free port simulation.
    simulateFreePort();
    const result = await resolver.findAvailablePort(9222, 'QoderWork');
    expect(result).toBe(9222);
  });

  it('throws when both TCP walk and DevToolsActivePort fail', async () => {
    const resolver = new PortResolver({ maxAttempts: 1 });
    simulateOccupiedPort();
    mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(resolver.findAvailablePort(9222, 'QoderWork')).rejects.toThrow(
      /No available port found/,
    );
  });

  it('does not read file when TCP walk succeeds', async () => {
    const resolver = new PortResolver();
    simulateFreePort();
    const result = await resolver.findAvailablePort(9222, 'QoderWork');
    expect(result).toBe(9222);
    expect(mockedFs.readFile).not.toHaveBeenCalled();
  });
});
