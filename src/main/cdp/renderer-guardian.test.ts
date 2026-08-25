// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventCdpSession } from './cdp-client';
import type { CdpTarget } from './cdp-targets';
import {
  defaultRendererResolver,
  RendererGuardian,
  sleep,
  targetExists,
} from './renderer-guardian';

vi.mock('./cdp-client', () => ({ connectEventCdp: vi.fn() }));
vi.mock('./cdp-targets', () => ({ listTargets: vi.fn() }));

const { connectEventCdp } = await import('./cdp-client');
const { listTargets } = await import('./cdp-targets');

function makeTarget(id: string, url = 'http://localhost:3000/chat'): CdpTarget {
  return {
    id,
    type: 'page',
    url,
    title: 'Page',
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
  } as CdpTarget;
}

function makeEventSession(): {
  session: EventCdpSession;
  handlers: Map<string, (p: unknown) => void>;
} {
  const handlers = new Map<string, (p: unknown) => void>();
  return {
    handlers,
    session: {
      send: vi.fn().mockResolvedValue({}),
      evaluate: vi.fn().mockResolvedValue('{}'),
      close: vi.fn(),
      on: vi.fn((m: string, h: (p: unknown) => void) => {
        handlers.set(m, h);
      }),
      off: vi.fn((m: string, h: (p: unknown) => void) => {
        if (handlers.get(m) === h) handlers.delete(m);
      }),
    } as unknown as EventCdpSession,
  };
}

const resolveHint = (targets: readonly CdpTarget[], hint: string) =>
  defaultRendererResolver(targets, hint);
describe('pure helpers', () => {
  it('defaultResolver: match, miss, case-insensitive', () => {
    expect(
      defaultRendererResolver([makeTarget('A', '/other'), makeTarget('B', '/chat')], 'chat'),
    ).toBe('B');
    expect(defaultRendererResolver([makeTarget('A', '/other')], 'chat')).toBeUndefined();
    expect(defaultRendererResolver([makeTarget('A', '/CHAT')], 'chat')).toBe('A');
  });
  it('targetExists: present=true, absent=false', () => {
    expect(targetExists([makeTarget('A'), makeTarget('B')], 'A')).toBe(true);
    expect(targetExists([makeTarget('A')], 'Z')).toBe(false);
  });
  it('sleep resolves after ms', async () => {
    const t0 = Date.now();
    await sleep(20);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });
});

describe('waitForStableRenderer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns stable id', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('STABLE')]);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', stableMs: 50, pollMs: 10 },
      { resolveRenderer: resolveHint },
    );
    expect(await g.waitForStableRenderer()).toBe('STABLE');
  });

  it('times out when id changes', async () => {
    let n = 0;
    vi.mocked(listTargets).mockImplementation(async () => [makeTarget(`D${++n}`)]);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', stableMs: 1000, pollMs: 10, timeoutMs: 100 },
      { resolveRenderer: resolveHint },
    );
    await expect(g.waitForStableRenderer()).rejects.toThrow(/timed out/);
  });
});

describe('startWatching / stopWatching', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('connects, subscribes, tears down', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('T1')]);
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat' },
      { resolveRenderer: resolveHint },
    );
    await g.startWatching();
    expect(connectEventCdp).toHaveBeenCalled();
    expect(g.isWatching).toBe(true);
    expect(handlers.has('Target.targetDestroyed')).toBe(true);
    await g.stopWatching();
    expect(g.isWatching).toBe(false);
    expect(session.close).toHaveBeenCalled();
  });

  it('idempotent + no-connect on miss', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('T1')]);
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat' },
      { resolveRenderer: resolveHint },
    );
    await g.startWatching();
    await g.startWatching();
    expect(connectEventCdp).toHaveBeenCalledTimes(1);

    vi.mocked(listTargets).mockResolvedValue([makeTarget('T1', '/other')]);
    const g2 = new RendererGuardian(
      { port: 9222, rendererHint: 'chat' },
      { resolveRenderer: resolveHint },
    );
    await g2.startWatching();
    expect(connectEventCdp).toHaveBeenCalledTimes(1);
    expect(g2.isWatching).toBe(false);
  });
});

describe('recreation (debounce)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('fires onRendererRecreated after debounce, coalesces rapid creates', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('OLD')]);
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const onRecreated = vi.fn().mockResolvedValue(undefined);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', onRendererRecreated: onRecreated },
      { resolveRenderer: resolveHint },
    );
    g.stableTargetId = 'OLD';
    await g.startWatching();
    handlers.get('Target.targetDestroyed')!({ targetId: 'OLD' });
    handlers.get('Target.targetCreated')!({ targetId: 'NEW1' });
    handlers.get('Target.targetCreated')!({ targetId: 'NEW2' });
    handlers.get('Target.targetCreated')!({ targetId: 'NEW3' });
    await vi.advanceTimersByTimeAsync(600);
    expect(onRecreated).toHaveBeenCalledTimes(1);
    expect(onRecreated).toHaveBeenCalledWith('OLD', 'NEW3');
  });

  it('ignores destroys of non-matching targets', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('STABLE')]);
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const onRecreated = vi.fn().mockResolvedValue(undefined);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', onRendererRecreated: onRecreated },
      { resolveRenderer: resolveHint },
    );
    g.stableTargetId = 'STABLE';
    await g.startWatching();
    handlers.get('Target.targetDestroyed')!({ targetId: 'OTHER' });
    handlers.get('Target.targetCreated')!({ targetId: 'NEW' });
    await vi.advanceTimersByTimeAsync(600);
    expect(onRecreated).not.toHaveBeenCalled();
  });
});

describe('health check & failure threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('calls onInjectionLost when lost, NOT when intact', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('T1')]);
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const onLost = vi.fn().mockResolvedValue(undefined);

    const gLost = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', onInjectionLost: onLost },
      { resolveRenderer: resolveHint, checkInjection: async () => false },
    );
    gLost.stableTargetId = 'T1';
    await gLost.startWatching();
    await vi.advanceTimersByTimeAsync(5100);
    expect(onLost).toHaveBeenCalled();
    expect(gLost.isHealthy).toBe(false);

    const gIntact = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', onInjectionLost: onLost },
      { resolveRenderer: resolveHint, checkInjection: async () => true },
    );
    gIntact.stableTargetId = 'T1';
    await gIntact.startWatching();
    await vi.advanceTimersByTimeAsync(5100);
    expect(gIntact.isHealthy).toBe(true);
  });

  it('stops watching after maxFailures', async () => {
    vi.mocked(listTargets).mockResolvedValue([makeTarget('T1')]);
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const onLost = vi.fn().mockResolvedValue(undefined);
    const g = new RendererGuardian(
      { port: 9222, rendererHint: 'chat', maxFailures: 2, onInjectionLost: onLost },
      { resolveRenderer: resolveHint, checkInjection: async () => false },
    );
    g.stableTargetId = 'T1';
    await g.startWatching();
    await vi.advanceTimersByTimeAsync(5100);
    expect(g.failureCount).toBe(1);
    expect(g.isWatching).toBe(true);
    await vi.advanceTimersByTimeAsync(5100);
    expect(g.failureCount).toBe(2);
    expect(g.isWatching).toBe(false);
    expect(session.close).toHaveBeenCalled();
  });
});
describe('initial state', () => {
  it('failureCount=0, isHealthy=true', () => {
    const g = new RendererGuardian({ port: 9222, rendererHint: 'chat' });
    expect(g.failureCount).toBe(0);
    expect(g.isHealthy).toBe(true);
  });
});
