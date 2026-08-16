// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../shared/types';
import type { DiscoveryDeps } from './app-discovery';
import { LivePortCache, resolveLivePort } from './app-discovery';

// Mock the shared discovery orchestrator + TCP probe so the cache-wrapper
// tests exercise only the RFC §4.2 layer, not the full child-process chain.
vi.mock('../shared/cdp-discovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/cdp-discovery')>();
  return {
    ...actual,
    resolveLivePort: vi.fn(async () => 9222),
    probePortLive: vi.fn(async () => true),
  };
});

vi.mock('../legacy/agentskin-core-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../legacy/agentskin-core-runtime')>();
  return {
    ...actual,
    probePortLive: vi.fn(async () => true),
  };
});

const sharedCdp = await import('../shared/cdp-discovery');
const { probePortLive } = await import('../legacy/agentskin-core-runtime');

const TEST_AGENT = 'traework' as AgentId;

function makeDeps(cache: LivePortCache): DiscoveryDeps {
  return {
    adapter: () => ({}) as never,
    settings: {
      appPathFor: () => null,
      portOverrideFor: () => null,
    },
    log: () => undefined,
    logStructured: () => undefined,
    detectionLogFile: '',
    displayName: () => 'TraeWork',
    getAppPort: () => null,
    clearAppPort: () => undefined,
    persist: async () => undefined,
    getDetectedPath: () => null,
    setDetectedPath: () => undefined,
    activeThemeId: () => null,
    activeSchemeId: () => null,
    livePortCache: cache,
  } as unknown as DiscoveryDeps;
}

describe('LivePortCache', () => {
  it('returns a cached port within the TTL window and null after it expires', () => {
    const cache = new LivePortCache();
    cache.set(TEST_AGENT, 9222);
    expect(cache.get(TEST_AGENT)).toBe(9222);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);
    expect(cache.get(TEST_AGENT)).toBeNull();
    expect(cache.size()).toBe(0);
    vi.useRealTimers();
  });

  it('clear and clearAll drop entries', () => {
    const cache = new LivePortCache();
    cache.set(TEST_AGENT, 9222);
    cache.set('doubao' as AgentId, 9223);
    cache.clear(TEST_AGENT);
    expect(cache.get(TEST_AGENT)).toBeNull();
    expect(cache.get('doubao' as AgentId)).toBe(9223);
    cache.clearAll();
    expect(cache.size()).toBe(0);
  });
});

describe('resolveLivePort — live-port cache (RFC §4.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(probePortLive).mockResolvedValue(true);
    vi.mocked(sharedCdp.resolveLivePort).mockResolvedValue(9222);
  });

  it('returns the cached live port without running shared discovery (cache hit)', async () => {
    const cache = new LivePortCache();
    cache.set(TEST_AGENT, 9222);
    const deps = makeDeps(cache);

    const port = await resolveLivePort(TEST_AGENT, deps);
    expect(port).toBe(9222);
    expect(probePortLive).toHaveBeenCalledWith(9222, 300);
    expect(sharedCdp.resolveLivePort).not.toHaveBeenCalled();
  });

  it('clears a stale cached port and runs shared discovery when the probe fails', async () => {
    const cache = new LivePortCache();
    cache.set(TEST_AGENT, 9222);
    const deps = makeDeps(cache);
    vi.mocked(probePortLive).mockResolvedValue(false);

    const port = await resolveLivePort(TEST_AGENT, deps);
    expect(port).toBe(9222); // falls through to shared discovery
    expect(sharedCdp.resolveLivePort).toHaveBeenCalledTimes(1);
    expect(cache.get(TEST_AGENT)).toBe(9222); // re-cached by the fallback
  });

  it('bypassCache skips the cache read', async () => {
    const cache = new LivePortCache();
    cache.set(TEST_AGENT, 9222);
    const deps = makeDeps(cache);

    const port = await resolveLivePort(TEST_AGENT, deps, null, { bypassCache: true });
    expect(port).toBe(9222);
    expect(probePortLive).not.toHaveBeenCalled();
    expect(sharedCdp.resolveLivePort).toHaveBeenCalledTimes(1);
  });

  it('pops a dead knownDeadPort even when cached (no probe)', async () => {
    const cache = new LivePortCache();
    cache.set(TEST_AGENT, 9222);
    const deps = makeDeps(cache);

    const port = await resolveLivePort(TEST_AGENT, deps, 9222);
    expect(port).toBe(9222);
    expect(probePortLive).not.toHaveBeenCalled();
  });

  it('caches a freshly-resolved shared port for the next call', async () => {
    const cache = new LivePortCache();
    const deps = makeDeps(cache);

    await resolveLivePort(TEST_AGENT, deps);
    expect(cache.get(TEST_AGENT)).toBe(9222);
  });
});
