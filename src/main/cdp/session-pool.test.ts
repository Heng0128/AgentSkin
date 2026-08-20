// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../shared/types';
import type { CdpSession } from './cdp-client';
import { acquireSession, CdpSessionPool, targetKeyFor } from './session-pool';

const APP: AgentId = 'workbuddy';

function makeSession(): CdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue('ok'),
    close: vi.fn(),
  };
}

describe('CdpSessionPool', () => {
  it('creates a session on first acquire and reuses it thereafter', async () => {
    const pool = new CdpSessionPool();
    const open = vi.fn(async () => makeSession());

    const s1 = await pool.acquire(APP, 't1', open);
    const s2 = await pool.acquire(APP, 't1', open);

    expect(s1).not.toBeNull();
    expect(s2).toBe(s1); // same pooled object
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct sessions per target key', async () => {
    const pool = new CdpSessionPool();
    const open = vi.fn(async () => makeSession());

    const s1 = await pool.acquire(APP, 't1', open);
    const s2 = await pool.acquire(APP, 't2', open);

    expect(s1).not.toBe(s2);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('returns null when open fails and does not cache it', async () => {
    const pool = new CdpSessionPool();
    const open = vi.fn().mockResolvedValue(null);

    const s1 = await pool.acquire(APP, 't1', open);
    const s2 = await pool.acquire(APP, 't1', open);

    expect(s1).toBeNull();
    expect(s2).toBeNull();
    expect(open).toHaveBeenCalledTimes(2); // no negative caching
  });

  it('invalidateEpoch soft-retires in-use sessions and closes idle ones', async () => {
    const pool = new CdpSessionPool();
    const s1 = makeSession();
    const s2 = makeSession();
    // Acquire s1 (refCount=1), s2 (refCount=1)
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    await pool.acquire(APP, 't2', () => Promise.resolve(s2));

    pool.invalidateEpoch(APP);

    // Soft-retire: in-use sessions (refCount>0) are NOT closed immediately
    expect(s1.close).not.toHaveBeenCalled();
    expect(s2.close).not.toHaveBeenCalled();
    // Pool still holds the sessions (not cleared)
    expect(pool.poolSize(APP)).toBe(2);
  });

  it('invalidateEpoch closes idle sessions (refCount=0) immediately', async () => {
    const pool = new CdpSessionPool();
    const s1 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    // Release to drop refCount to 0
    pool.release(APP, 't1');

    pool.invalidateEpoch(APP);

    // Idle session is closed immediately
    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(pool.poolSize(APP)).toBe(0);
  });

  it('invalidateTarget closes only that target', async () => {
    const pool = new CdpSessionPool();
    const s1 = makeSession();
    const s2 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    await pool.acquire(APP, 't2', () => Promise.resolve(s2));

    pool.invalidateTarget(APP, 't1');

    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(s2.close).not.toHaveBeenCalled();
    expect(pool.poolSize(APP)).toBe(1);
  });

  it('dispose closes sessions across all agents', async () => {
    const pool = new CdpSessionPool();
    const s1 = makeSession();
    const s2 = makeSession();
    await pool.acquire(APP, 't1', () => Promise.resolve(s1));
    await pool.acquire('doubao' as AgentId, 't1', () => Promise.resolve(s2));

    pool.dispose();

    expect(s1.close).toHaveBeenCalledTimes(1);
    expect(s2.close).toHaveBeenCalledTimes(1);
  });
});

describe('acquireSession', () => {
  it('marks pooled sessions as pooled (caller must not close)', async () => {
    const pool = new CdpSessionPool();
    const open = vi.fn(async () => makeSession());
    const handle = await acquireSession(pool, APP, 't1', open);
    expect(handle.session).not.toBeNull();
    expect(handle.pooled).toBe(true);
  });

  it('marks one-shot sessions as unpooled (caller owns lifecycle)', async () => {
    const session = makeSession();
    const handle = await acquireSession(undefined, APP, 't1', () => Promise.resolve(session));
    expect(handle.session).toBe(session);
    expect(handle.pooled).toBe(false);
  });
});

describe('targetKeyFor', () => {
  it('prefers id and falls back to ws url', () => {
    expect(targetKeyFor('abc', 'ws://x')).toBe('abc');
    expect(targetKeyFor(null, 'ws://x')).toBe('ws://x');
    expect(targetKeyFor(undefined, null)).toBe('unknown-target');
  });
});
