// SPDX-License-Identifier: MPL-2.0

import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __clearAllocationsForTests,
  allocatePort,
  DEFAULT_PORT_CONFIG,
  findFreePort,
  isPortAvailable,
  listAllocations,
  type PortConfig,
  releasePort,
} from './port-manager';

/**
 * Helper: occupy a port by starting a TCP server on 127.0.0.1.
 * Returns a cleanup function that closes the server.
 */
async function occupyPort(port: number): Promise<() => void> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return () => server.close();
}

/**
 * Helper: find an ephemeral port that is currently free.
 * Creates a server on port 0 (OS picks), reads the assigned port, then closes.
 * The port is very likely to remain free for a short window afterward.
 */
async function getEphemeralPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  server.close();
  return port;
}

describe('isPortAvailable', () => {
  it('returns true for a port that is not in use', async () => {
    const port = await getEphemeralPort();
    expect(await isPortAvailable(port)).toBe(true);
  });

  it('returns false for a port that is currently occupied', async () => {
    const port = await getEphemeralPort();
    const cleanup = await occupyPort(port);
    try {
      expect(await isPortAvailable(port)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('returns false for invalid port numbers', async () => {
    expect(await isPortAvailable(0)).toBe(false);
    expect(await isPortAvailable(-1)).toBe(false);
    expect(await isPortAvailable(65536)).toBe(false);
    expect(await isPortAvailable(9222.5)).toBe(false);
  });
});

describe('findFreePort', () => {
  it('returns the preferred port when it is free', async () => {
    const port = await getEphemeralPort();
    const result = await findFreePort(port, [port, port + 5]);
    expect(result).toBe(port);
  });

  it('skips the preferred port and finds a free one in the range', async () => {
    const preferred = await getEphemeralPort();
    const fallback = await getEphemeralPort();
    // Ensure fallback is within a valid range for the test.
    const rangeStart = Math.min(preferred, fallback);
    const rangeEnd = Math.max(preferred, fallback);

    // Occupy the preferred port.
    const cleanup = await occupyPort(preferred);
    try {
      const result = await findFreePort(preferred, [rangeStart, rangeEnd]);
      // Should find the fallback port (or another free one in range).
      expect(result).not.toBeNull();
      expect(result).not.toBe(preferred);
    } finally {
      cleanup();
    }
  });

  it('returns null when no port in the range is free', async () => {
    // Occupy a small range of ports.
    const port1 = await getEphemeralPort();
    const port2 = port1 + 1;
    const cleanup1 = await occupyPort(port1);
    const cleanup2 = await occupyPort(port2);
    try {
      const result = await findFreePort(port1, [port1, port2]);
      expect(result).toBeNull();
    } finally {
      cleanup1();
      cleanup2();
    }
  });

  it('handles reversed range bounds gracefully', async () => {
    const port = await getEphemeralPort();
    // Pass [end, start] instead of [start, end].
    const result = await findFreePort(port, [port + 5, port]);
    expect(result).toBe(port);
  });
});

describe('allocatePort', () => {
  beforeEach(() => {
    __clearAllocationsForTests();
  });

  afterEach(() => {
    __clearAllocationsForTests();
  });

  it('allocates the preferred port for a new agent', async () => {
    const port = await getEphemeralPort();
    const config: PortConfig = { preferred: port, fallbackRange: [port, port + 5] };
    const result = await allocatePort('traework', config);
    expect(result).toBe(port);
  });

  it('returns the same port on repeated calls for the same agent', async () => {
    const port = await getEphemeralPort();
    const config: PortConfig = { preferred: port, fallbackRange: [port, port + 5] };
    const first = await allocatePort('workbuddy', config);
    const second = await allocatePort('workbuddy', config);
    expect(first).toBe(second);
    expect(first).toBe(port);
  });

  it('allocates different ports for different agents', async () => {
    const port1 = await getEphemeralPort();
    const _port2 = port1 + 1;
    const config: PortConfig = { preferred: port1, fallbackRange: [port1, port1 + 5] };

    const result1 = await allocatePort('traework', config);
    expect(result1).toBe(port1);

    // Second agent should get a different port (port1 is now "allocated" in our
    // tracking, but isPortAvailable still returns true since we didn't actually
    // bind to it — the allocation map prevents duplicate assignment).
    const result2 = await allocatePort('workbuddy', config);
    expect(result2).not.toBeNull();
    // The allocation map ensures different agents get different ports.
    expect(result2).not.toBe(result1);
  });

  it('falls back to a free port when preferred is occupied', async () => {
    const preferred = await getEphemeralPort();
    const fallback = preferred + 1;
    const config: PortConfig = { preferred, fallbackRange: [preferred, fallback + 2] };

    // Occupy the preferred port.
    const cleanup = await occupyPort(preferred);
    try {
      const result = await allocatePort('qoderwork', config);
      expect(result).not.toBeNull();
      expect(result).not.toBe(preferred);
      // Should be within the fallback range.
      expect(result).toBeGreaterThanOrEqual(preferred);
      expect(result).toBeLessThanOrEqual(fallback + 2);
    } finally {
      cleanup();
    }
  });

  it('returns null when no port is available in the range', async () => {
    const port1 = await getEphemeralPort();
    const port2 = port1 + 1;
    const config: PortConfig = { preferred: port1, fallbackRange: [port1, port2] };

    const cleanup1 = await occupyPort(port1);
    const cleanup2 = await occupyPort(port2);
    try {
      const result = await allocatePort('doubao', config);
      expect(result).toBeNull();
    } finally {
      cleanup1();
      cleanup2();
    }
  });

  it('uses DEFAULT_PORT_CONFIG when no config is provided', async () => {
    // We can't guarantee 9335 is free, but we can verify the function
    // returns either a valid port or null (never throws).
    const result = await allocatePort('codex');
    if (result !== null) {
      expect(result).toBeGreaterThanOrEqual(DEFAULT_PORT_CONFIG.fallbackRange[0]);
      expect(result).toBeLessThanOrEqual(DEFAULT_PORT_CONFIG.fallbackRange[1]);
    }
  });
});

describe('releasePort', () => {
  beforeEach(() => {
    __clearAllocationsForTests();
  });

  afterEach(() => {
    __clearAllocationsForTests();
  });

  it('returns true and removes the allocation', async () => {
    const port = await getEphemeralPort();
    const config: PortConfig = { preferred: port, fallbackRange: [port, port + 5] };
    await allocatePort('traework', config);

    expect(releasePort('traework')).toBe(true);
    expect(listAllocations()).toHaveLength(0);
  });

  it('returns false when the agent has no allocation', () => {
    expect(releasePort('nonexistent')).toBe(false);
  });

  it('allows re-allocation after release', async () => {
    const port = await getEphemeralPort();
    const config: PortConfig = { preferred: port, fallbackRange: [port, port + 5] };

    const first = await allocatePort('traework', config);
    expect(first).toBe(port);

    releasePort('traework');

    // After release, the same port should be allocatable again.
    const second = await allocatePort('traework', config);
    expect(second).toBe(port);
  });
});

describe('listAllocations', () => {
  beforeEach(() => {
    __clearAllocationsForTests();
  });

  afterEach(() => {
    __clearAllocationsForTests();
  });

  it('returns an empty array when no allocations exist', () => {
    expect(listAllocations()).toEqual([]);
  });

  it('returns all current allocations', async () => {
    const port1 = await getEphemeralPort();
    const _port2 = port1 + 1;
    const config: PortConfig = { preferred: port1, fallbackRange: [port1, port1 + 5] };

    await allocatePort('traework', config);
    await allocatePort('workbuddy', config);

    const all = listAllocations();
    expect(all).toHaveLength(2);
    const agentIds = all.map((a) => a.agentId).sort();
    expect(agentIds).toEqual(['traework', 'workbuddy']);
  });
});

describe('port conflict auto-selection (integration)', () => {
  beforeEach(() => {
    __clearAllocationsForTests();
  });

  afterEach(() => {
    __clearAllocationsForTests();
  });

  it('automatically selects a free port when preferred is occupied', async () => {
    // Simulate the real-world scenario: the preferred port is taken. Use an
    // ephemeral port instead of a hardcoded 9335 — the real Doubao process
    // (or any app) may legitimately occupy 9335 during a dev run, and binding
    // it here would fail with EADDRINUSE (environment-dependent flake).
    const preferred = await getEphemeralPort();
    const config: PortConfig = { preferred, fallbackRange: [preferred, preferred + 15] };

    // Occupy the preferred port.
    const cleanup = await occupyPort(preferred);
    try {
      const result = await allocatePort('traework', config);
      expect(result).not.toBeNull();
      expect(result).not.toBe(preferred);
      expect(result).toBeGreaterThanOrEqual(preferred);
      expect(result).toBeLessThanOrEqual(preferred + 15);
    } finally {
      cleanup();
    }
  });

  it('assigns sequential ports to multiple agents when preferred is occupied', async () => {
    // Ephemeral preferred port — see the comment in the test above.
    const preferred = await getEphemeralPort();
    const config: PortConfig = { preferred, fallbackRange: [preferred, preferred + 15] };

    // Occupy the preferred port.
    const cleanup = await occupyPort(preferred);
    try {
      const port1 = await allocatePort('traework', config);
      const port2 = await allocatePort('workbuddy', config);

      expect(port1).not.toBeNull();
      expect(port2).not.toBeNull();
      // Two different agents must get two different ports.
      expect(port1).not.toBe(port2);
    } finally {
      cleanup();
    }
  });
});
