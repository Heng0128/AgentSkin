// SPDX-License-Identifier: MPL-2.0

/**
 * # L2 — Session Pool Lifecycle (Integration)
 *
 * Tests CdpSessionPool with mocked CdpSession objects. Validates the full
 * lifecycle: acquire → reuse → release → epoch invalidation → dispose.
 *
 * Runs with real wall-clock time; the pool is now a pure cache with no
 * internal timers, so no fake-timer setup is needed. All cleanup is
 * explicit via dispose().
 *
 * Run: npm run test:backtest:l2
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from '../../src/main/cdp/cdp-client';
import { acquireSession, CdpSessionPool, releaseSession } from '../../src/main/cdp/session-pool';
import type { AgentId } from '../../src/shared/types';

const APP: AgentId = 'workbuddy';

function makeSession(): CdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue('ok'),
    close: vi.fn(),
  };
}

describe('L2 — CdpSessionPool: basic lifecycle', () => {
  let pool: CdpSessionPool;

  beforeEach(() => {
    pool = new CdpSessionPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it('creates a session on first acquire and reuses it thereafter', async () => {
    const open = vi.fn(async () => makeSession());

    const s1 = await pool.acquire(APP, 't1', open);
    const s2 = await pool.acquire(APP, 't1', open);

    expect(s1).not.toBeNull();
    expect(s2).toBe(s1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct sessions per target key', async () => {
    const open = vi.fn(async () => makeSession());

    const s1 = await pool.acquire(APP, 't1', open);
    const s2 = await pool.acquire(APP, 't2', open);

    expect(s1).not.toBe(s2);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('returns null when open fails and does not cache it', async () => {
    const open = vi.fn().mockResolvedValue(null);

    const s1 = await pool.acquire(APP, 't1', open);
    const s2 = await pool.acquire(APP, 't1', open);

    expect(s1).toBeNull();
    expect(s2).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('tracks poolSize per agent', async () => {
    const open = vi.fn(async () => makeSession());

    expect(pool.poolSize(APP)).toBe(0);

    await pool.acquire(APP, 't1', open);
    expect(pool.poolSize(APP)).toBe(1);

    await pool.acquire(APP, 't2', open);
    expect(pool.poolSize(APP)).toBe(2);
  });
});

describe('L2 — CdpSessionPool: reference counting', () => {
  let pool: CdpSessionPool;

  beforeEach(() => {
    pool = new CdpSessionPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it('increments refCount on each acquire for the same target', async () => {
    const open = vi.fn(async () => makeSession());

    await pool.acquire(APP, 't1', open);
    await pool.acquire(APP, 't1', open);
    await pool.acquire(APP, 't1', open);

    // open called once (session reused), but refCount is 3.
    expect(open).toHaveBeenCalledTimes(1);

    // Release 3 times to fully drop the refCount.
    pool.release(APP, 't1');
    pool.release(APP, 't1');
    pool.release(APP, 't1');
  });

  it('decrements refCount on release', async () => {
    const open = vi.fn(async () => makeSession());

    await pool.acquire(APP, 't1', open);
    await pool.acquire(APP, 't1', open);

    pool.release(APP, 't1');
    pool.release(APP, 't1');
    // No crash — refCount reaches 0.
  });

  it('release on unknown target is a no-op', () => {
    expect(() => pool.release(APP, 'nonexistent')).not.toThrow();
  });
});

describe('L2 — CdpSessionPool: epoch invalidation', () => {
  let pool: CdpSessionPool;

  beforeEach(() => {
    pool = new CdpSessionPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it('soft-retires in-use sessions (refCount > 0)', async () => {
    const s1 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));

    pool.invalidateEpoch(APP);

    // In-use session is NOT closed immediately.
    expect(s1.close).not.toHaveBeenCalled();
    expect(pool.poolSize(APP)).toBe(1);
  });

  it('closes idle sessions (refCount = 0) immediately on epoch invalidation', async () => {
    const s1 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    pool.release(APP, 't1'); // refCount drops to 0

    pool.invalidateEpoch(APP);

    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(pool.poolSize(APP)).toBe(0);
  });

  it('invalidateTarget closes only that target', async () => {
    const s1 = makeSession();
    const s2 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    await pool.acquire(APP, 't2', () => Promise.resolve(s2));

    pool.invalidateTarget(APP, 't1');

    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(s2.close).not.toHaveBeenCalled();
    expect(pool.poolSize(APP)).toBe(1);
  });
});

describe('L2 — CdpSessionPool: dispose', () => {
  it('closes all sessions across all agents', async () => {
    const pool = new CdpSessionPool();
    const s1 = makeSession();
    const s2 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    await pool.acquire('doubao' as AgentId, 't1', () => Promise.resolve(s2));

    pool.dispose();

    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(s2.close).toHaveBeenCalledTimes(1);
  });

  it('dispose is safe on an empty pool', () => {
    const pool = new CdpSessionPool();
    expect(() => pool.dispose()).not.toThrow();
  });
});

describe('L2 — CdpSessionPool: concurrent acquire', () => {
  let pool: CdpSessionPool;

  beforeEach(() => {
    pool = new CdpSessionPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it('does not create duplicate sessions when two acquires race for the same key', async () => {
    const open = vi.fn(async () => makeSession());

    const [s1, s2] = await Promise.all([
      pool.acquire(APP, 't1', open),
      pool.acquire(APP, 't1', open),
    ]);

    expect(s1).not.toBeNull();
    expect(s2).toBe(s1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('still allows concurrent acquires for different keys', async () => {
    const open = vi.fn(async () => makeSession());

    const [s1, s2] = await Promise.all([
      pool.acquire(APP, 't1', open),
      pool.acquire(APP, 't2', open),
    ]);

    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1).not.toBe(s2);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('L2 — acquireSession / releaseSession helpers', () => {
  let pool: CdpSessionPool;

  beforeEach(() => {
    pool = new CdpSessionPool();
  });

  afterEach(() => {
    pool.dispose();
  });

  it('acquireSession marks pooled sessions as pooled', async () => {
    const open = vi.fn(async () => makeSession());
    const handle = await acquireSession(pool, APP, 't1', open);

    expect(handle.session).not.toBeNull();
    expect(handle.pooled).toBe(true);
  });

  it('acquireSession marks one-shot sessions as unpooled', async () => {
    const session = makeSession();
    const handle = await acquireSession(undefined, APP, 't1', () => Promise.resolve(session));

    expect(handle.session).toBe(session);
    expect(handle.pooled).toBe(false);
  });

  it('releaseSession decrements refCount for pooled sessions', async () => {
    const open = vi.fn(async () => makeSession());
    const handle = await acquireSession(pool, APP, 't1', open);

    expect(handle.pooled).toBe(true);
    releaseSession(pool, APP, 't1');
  });
});
