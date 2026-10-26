// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:net — must be declared before importing the module under test.
vi.mock('node:net', () => ({
  default: { createServer: vi.fn(), connect: vi.fn() },
}));

const netModule = await import('node:net');
const mockedNet = netModule.default as unknown as {
  createServer: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

const { PortResolver, ResolvedPortCache } = await import('./port-manager');
const {
  DEFAULT_PORT_CONFIGS,
  getAdapterPortConfig,
  resolveStartPort,
  resolveEndPort,
  AGENT_PORT_FALLBACK_MIN,
  AGENT_PORT_FALLBACK_MAX,
  isWithinFallbackRange,
  validatePortOverride,
} = await import('./port-manager');

// ---------------------------------------------------------------------------
// Test helpers — port simulation
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

/** Port is free: bind succeeds, connect fails (no listener). */
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

/** Port occupied: bind fails with EADDRINUSE. */
function simulateOccupiedPort() {
  const server = createFakeServer();
  mockedNet.createServer.mockReturnValueOnce(server);
  setTimeout(() => {
    server.onError?.(Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' }));
  }, 0);
  return { server };
}

// ---------------------------------------------------------------------------
// Tests — port-config
// ---------------------------------------------------------------------------

describe('port-config constants', () => {
  it('defines AGENT_PORT_FALLBACK_MIN as 9222', () => {
    expect(AGENT_PORT_FALLBACK_MIN).toBe(9222);
  });

  it('defines AGENT_PORT_FALLBACK_MAX as 9357', () => {
    expect(AGENT_PORT_FALLBACK_MAX).toBe(9357);
  });

  it('provides a config entry for every built-in adapter', () => {
    const ids = DEFAULT_PORT_CONFIGS.map((c) => c.adapterId).sort();
    expect(ids).toEqual(['codex', 'doubao', 'qoderwork', 'traework', 'workbuddy', 'zcode']);
  });

  it('sets every adapter preferred port to 0 (random, never fixed)', () => {
    // 2026-09-07 policy: adapters must NOT reserve fixed ports — each launch
    // asks Chromium for a random free port; uniqueness comes from the OS bind
    // plus identity-verified discovery, not from static reservation.
    const ports = DEFAULT_PORT_CONFIGS.map((c) => c.preferredPort);
    expect(ports.every((p) => p === 0)).toBe(true);
  });

  it('sets the shared fallback range on every config', () => {
    for (const cfg of DEFAULT_PORT_CONFIGS) {
      expect(cfg.fallbackRange[0]).toBe(AGENT_PORT_FALLBACK_MIN);
      expect(cfg.fallbackRange[1]).toBe(AGENT_PORT_FALLBACK_MAX);
    }
  });
});

describe('getAdapterPortConfig', () => {
  it('returns the config for a known adapter', () => {
    const cfg = getAdapterPortConfig('traework');
    expect(cfg).toBeDefined();
    expect(cfg?.adapterId).toBe('traework');
    expect(cfg?.preferredPort).toBe(0);
  });

  it('returns undefined for an unknown adapter', () => {
    expect(getAdapterPortConfig('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getAdapterPortConfig('')).toBeUndefined();
  });
});

describe('resolveStartPort', () => {
  it('returns 0 when preferredPort is 0 (random port request)', () => {
    expect(resolveStartPort('traework', 0)).toBe(0);
    expect(resolveStartPort(undefined, 0)).toBe(0);
    expect(resolveStartPort(null, 0)).toBe(0);
  });

  it('returns the explicit preferredPort when valid', () => {
    expect(resolveStartPort('traework', 9500)).toBe(9500);
    expect(resolveStartPort(undefined, 9500)).toBe(9500);
    expect(resolveStartPort(null, 3000)).toBe(3000);
  });

  it('returns 0 (random) for null/undefined when useAdapterPreferredPort is not set', () => {
    // Backward compatibility: null/undefined preferredPort without opt-in
    // means "let Chromium pick a random port" — same as the old behavior.
    expect(resolveStartPort('traework', undefined)).toBe(0);
    expect(resolveStartPort('traework', null)).toBe(0);
    expect(resolveStartPort('qoderwork', undefined)).toBe(0);
    expect(resolveStartPort('zcode', null)).toBe(0);
  });

  it('returns 0 (random) for explicit but invalid ports — no fixed fallback exists', () => {
    // Out-of-range or non-integer explicit ports resolve to random under the
    // no-fixed-port policy. (Note: the electron-launcher resolvePort layer
    // rejects these before calling resolveStartPort; this stays defensive.)
    expect(resolveStartPort('traework', -1)).toBe(0);
    expect(resolveStartPort('traework', 70000)).toBe(0);
    expect(resolveStartPort('traework', 3.14)).toBe(0);
  });

  it('returns 0 (random) for null/undefined when adapter is unknown — backward compatibility', () => {
    // null/undefined preferredPort without useAdapterPreferredPort preserves the
    // historical "random port" behavior for backward compatibility.
    expect(resolveStartPort('unknown', undefined)).toBe(0);
    expect(resolveStartPort(undefined, null)).toBe(0);
    expect(resolveStartPort(null, undefined)).toBe(0);
  });

  it('returns 0 (random) for adapter preferred port — ports are never fixed', () => {
    // useAdapterPreferredPort still exists for user-configured overrides, but
    // every built-in adapter's preferred port is 0 → random.
    expect(resolveStartPort('traework', undefined, true)).toBe(0);
    expect(resolveStartPort('qoderwork', null, true)).toBe(0);
    expect(resolveStartPort('zcode', undefined, true)).toBe(0);
  });

  it('ignores negative preferredPort values (falls through to config → random)', () => {
    expect(resolveStartPort('traework', -1)).toBe(0);
  });

  it('ignores out-of-range preferredPort (> 65535, falls through to config → random)', () => {
    expect(resolveStartPort('traework', 70000)).toBe(0);
  });

  it('validates integer-only preferredPort (non-integer falls through → random)', () => {
    expect(resolveStartPort('traework', 3.14)).toBe(0);
  });
});

describe('resolveEndPort', () => {
  it('returns the adapter fallbackRange upper bound', () => {
    expect(resolveEndPort('traework')).toBe(AGENT_PORT_FALLBACK_MAX);
    expect(resolveEndPort('zcode')).toBe(AGENT_PORT_FALLBACK_MAX);
  });

  it('returns AGENT_PORT_FALLBACK_MAX for unknown adapter', () => {
    expect(resolveEndPort('unknown')).toBe(AGENT_PORT_FALLBACK_MAX);
    expect(resolveEndPort(undefined)).toBe(AGENT_PORT_FALLBACK_MAX);
    expect(resolveEndPort(null)).toBe(AGENT_PORT_FALLBACK_MAX);
  });
});

describe('isWithinFallbackRange', () => {
  it('returns true for ports within [9222, 9357]', () => {
    expect(isWithinFallbackRange(9222)).toBe(true);
    expect(isWithinFallbackRange(9300)).toBe(true);
    expect(isWithinFallbackRange(9357)).toBe(true);
  });

  it('returns false for ports outside the range', () => {
    expect(isWithinFallbackRange(9221)).toBe(false);
    expect(isWithinFallbackRange(9358)).toBe(false);
    expect(isWithinFallbackRange(1024)).toBe(false);
    expect(isWithinFallbackRange(65535)).toBe(false);
  });
});

describe('validatePortOverride', () => {
  it('accepts valid ports within the fallback range', () => {
    expect(validatePortOverride(9222)).toBeNull();
    expect(validatePortOverride(9300)).toBeNull();
    expect(validatePortOverride(9357)).toBeNull();
  });

  it('rejects ports below MIN_PORT (1024)', () => {
    expect(validatePortOverride(1023)).toBe('invalidPort');
    expect(validatePortOverride(0)).toBe('invalidPort');
    expect(validatePortOverride(-1)).toBe('invalidPort');
  });

  it('rejects ports above MAX_PORT (65535)', () => {
    expect(validatePortOverride(65536)).toBe('invalidPort');
    expect(validatePortOverride(70000)).toBe('invalidPort');
  });

  it('flags ports in [1024, 9221] as invalidCdpPort (below agent band)', () => {
    expect(validatePortOverride(1024)).toBe('invalidCdpPort');
    expect(validatePortOverride(5000)).toBe('invalidCdpPort');
    expect(validatePortOverride(9221)).toBe('invalidCdpPort');
  });

  it('rejects non-integer ports', () => {
    expect(validatePortOverride(3.14)).toBe('invalidPort');
    expect(validatePortOverride(NaN)).toBe('invalidPort');
  });
});

// ---------------------------------------------------------------------------
// Tests — ResolvedPortCache
// ---------------------------------------------------------------------------

describe('ResolvedPortCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for a missing entry', () => {
    const cache = new ResolvedPortCache();
    expect(cache.peek('traework')).toBeNull();
  });

  it('returns the cached port within TTL', () => {
    const cache = new ResolvedPortCache();
    cache.set('traework', 9222);
    expect(cache.peek('traework')).toBe(9222);
  });

  it('evicts an entry after TTL expires', () => {
    const cache = new ResolvedPortCache({ ttlMs: 30_000 });
    cache.set('traework', 9222);
    vi.advanceTimersByTime(30_001);
    expect(cache.peek('traework')).toBeNull();
  });

  it('set() overwrites a previous entry', () => {
    const cache = new ResolvedPortCache();
    cache.set('traework', 9222);
    cache.set('traework', 9300);
    expect(cache.peek('traework')).toBe(9300);
  });

  it('clear() drops a specific entry', () => {
    const cache = new ResolvedPortCache();
    cache.set('traework', 9222);
    cache.set('qoderwork', 9223);
    cache.clear('traework');
    expect(cache.peek('traework')).toBeNull();
    expect(cache.peek('qoderwork')).toBe(9223);
  });

  it('clearAll() drops every entry', () => {
    const cache = new ResolvedPortCache();
    cache.set('traework', 9222);
    cache.set('qoderwork', 9223);
    cache.clearAll();
    expect(cache.peek('traework')).toBeNull();
    expect(cache.peek('qoderwork')).toBeNull();
  });

  it('evicts the oldest entry when capacity is exceeded', () => {
    const cache = new ResolvedPortCache({ maxEntries: 2 });
    cache.set('traework', 9222);
    cache.set('qoderwork', 9223);
    cache.set('workbuddy', 9224);
    // Oldest (traework) should be evicted.
    expect(cache.peek('traework')).toBeNull();
    expect(cache.peek('qoderwork')).toBe(9223);
    expect(cache.peek('workbuddy')).toBe(9224);
  });

  it('size() returns the number of live entries', () => {
    const cache = new ResolvedPortCache();
    expect(cache.size()).toBe(0);
    cache.set('traework', 9222);
    cache.set('qoderwork', 9223);
    expect(cache.size()).toBe(2);
  });

  it('size() excludes expired entries', () => {
    const cache = new ResolvedPortCache({ ttlMs: 1000 });
    cache.set('traework', 9222);
    vi.advanceTimersByTime(1001);
    expect(cache.size()).toBe(0);
  });
});

describe('ResolvedPortCache.peekAndValidate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns cached port still free', async () => {
    const cache = new ResolvedPortCache();
    cache.set('traework', 9222);
    simulateFreePort();
    const resolver = new PortResolver();
    const result = await cache.peekAndValidate('traework', resolver);
    expect(result).toBe(9222);
  });

  it('evicts and returns null when cached port is no longer free', async () => {
    const cache = new ResolvedPortCache();
    cache.set('traework', 9222);
    simulateOccupiedPort();
    const resolver = new PortResolver();
    const result = await cache.peekAndValidate('traework', resolver);
    expect(result).toBeNull();
    expect(cache.peek('traework')).toBeNull();
  });

  it('returns null for a missing entry without probing', async () => {
    const cache = new ResolvedPortCache();
    const resolver = new PortResolver();
    const result = await cache.peekAndValidate('nonexistent', resolver);
    expect(result).toBeNull();
    expect(mockedNet.createServer).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — PortResolver.findAvailablePortBounded
// ---------------------------------------------------------------------------

describe('PortResolver.findAvailablePortBounded', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the startPort when it is free', async () => {
    const resolver = new PortResolver({ maxAttempts: 10 });
    simulateFreePort();
    expect(await resolver.findAvailablePortBounded(9222, 9357)).toBe(9222);
  });

  it('walks forward to the next free port within bounds', async () => {
    const resolver = new PortResolver({ maxAttempts: 10 });
    simulateOccupiedPort(); // 9222 occupied
    simulateFreePort(); // 9223 free
    expect(await resolver.findAvailablePortBounded(9222, 9357)).toBe(9223);
  });

  it('stops at endPort and does not exceed it', async () => {
    const resolver = new PortResolver({ maxAttempts: 100 });
    for (let i = 0; i < 20; i++) simulateOccupiedPort();
    await expect(resolver.findAvailablePortBounded(9350, 9357)).rejects.toThrow(
      /No available port found in \[9350–9357\]/,
    );
  });

  it('respects maxAttempts within bounded range', async () => {
    const resolver = new PortResolver({ maxAttempts: 3 });
    for (let i = 0; i < 3; i++) simulateOccupiedPort();
    // Should try 9222, 9223, 9224 then give up (budget = min(3, 9357-9222+1) = 3).
    await expect(resolver.findAvailablePortBounded(9222, 9357)).rejects.toThrow(/after 3 attempts/);
  });

  it('throws a descriptive error when all ports in range are occupied', async () => {
    const resolver = new PortResolver({ maxAttempts: 5 });
    for (let i = 0; i < 5; i++) simulateOccupiedPort();
    await expect(resolver.findAvailablePortBounded(9300, 9357)).rejects.toThrow(
      /No available port found in \[9300–9357\]/,
    );
  });

  it('clamps endPort to MAX_PORT when given a very high value', async () => {
    const resolver = new PortResolver({ maxAttempts: 1 });
    simulateFreePort();
    // End is clamped from 70000 → 65535. The first probe at start=65530 is free.
    expect(await resolver.findAvailablePortBounded(65530, 70000)).toBe(65530);
  });

  it('clamps startPort to MIN_PORT when given a very low value', async () => {
    const resolver = new PortResolver({ maxAttempts: 1 });
    simulateFreePort();
    // Start is clamped from 100 → 1024.
    expect(await resolver.findAvailablePortBounded(100, 9357)).toBe(1024);
  });
});
