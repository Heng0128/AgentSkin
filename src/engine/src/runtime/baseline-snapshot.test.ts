// SPDX-License-Identifier: MPL-2.0

/**
 * baseline-snapshot.mjs 单测（RFC §4.2 / S1）
 *
 * 纯逻辑：生命周期判定 + 三元组失效 + LRU 缓存语义。不触达 CDP/DOM。
 */

import { describe, expect, it } from 'vitest';
import {
  BASELINE_FRESH_MS,
  BASELINE_STALE_MS,
  BaselineStore,
  isBaselineValid,
  snapshotLifecycle,
} from './baseline-snapshot.mjs';

const NOW = 1_700_000_000_000;

function makeKey(overrides = {}) {
  return {
    appId: 'codex',
    appVersion: '2.10.0',
    themeMode: 'dark',
    schema: '1',
    ...overrides,
  };
}

function makeSnapshot(key = makeKey(), overrides = {}) {
  return {
    schemaVersion: 1,
    appId: key.appId,
    appVersion: key.appVersion,
    themeMode: key.themeMode,
    route: '/home',
    viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    nodes: [{ selector: 'body', tag: 'body', depth: 0, rect: { x: 0, y: 0, width: 100, height: 100 }, styles: { color: '#fff' }, customProperties: {} }],
    rootCustomProperties: { '--cb-fg': '#fff' },
    ...overrides,
  };
}

describe('snapshotLifecycle', () => {
  it('classifies fresh/stale/expired by age', () => {
    const fresh = snapshotLifecycle({ now: NOW });
    const aFresh = snapshotLifecycle({ capturedAt: new Date(NOW - 1000).toISOString(), now: NOW });
    const aStale = snapshotLifecycle({ capturedAt: new Date(NOW - BASELINE_FRESH_MS - 1000).toISOString(), now: NOW });
    const aExpired = snapshotLifecycle({ capturedAt: new Date(NOW - BASELINE_STALE_MS - 1000).toISOString(), now: NOW });
    expect(fresh).toBe('fresh');
    expect(aFresh).toBe('fresh');
    expect(aStale).toBe('stale');
    expect(aExpired).toBe('expired');
  });

  it('treats invalid/in-the-future safely', () => {
    expect(snapshotLifecycle({ capturedAt: 'nonsense', now: NOW })).toBe('expired');
    expect(snapshotLifecycle({ capturedAt: new Date(NOW + 5000).toISOString(), now: NOW })).toBe('fresh');
  });
});

describe('isBaselineValid', () => {
  it('rejects null/empty snapshots', () => {
    expect(isBaselineValid(null, makeKey(), NOW)).toBe(false);
    expect(isBaselineValid(makeSnapshot(makeKey(), { nodes: [] }), makeKey(), NOW)).toBe(false);
  });

  it('invalidates on appId/appVersion/themeMode mismatch', () => {
    const snapshot = makeSnapshot();
    expect(isBaselineValid(snapshot, makeKey({ appId: 'traework' }), NOW)).toBe(false);
    expect(isBaselineValid(snapshot, makeKey({ appVersion: '9.9.9' }), NOW)).toBe(false);
    expect(isBaselineValid(snapshot, makeKey({ themeMode: 'light' }), NOW)).toBe(false);
    expect(isBaselineValid(snapshot, makeKey(), NOW)).toBe(true);
  });

  it('invalidates on schema upgrade and on expiry', () => {
    const snapshot = makeSnapshot();
    expect(isBaselineValid(snapshot, makeKey({ schema: '2' }), NOW)).toBe(false);
    // 已被缓存 put 过的 expired 项
    const expired = makeSnapshot(makeKey(), { capturedAt: new Date(NOW - BASELINE_STALE_MS - 1000).toISOString() });
    expect(isBaselineValid(expired, makeKey(), NOW)).toBe(false);
  });

  it('route change does NOT invalidate', () => {
    const snapshot = makeSnapshot();
    expect(isBaselineValid(snapshot, makeKey(), NOW)).toBe(true);
  });
});

describe('BaselineStore', () => {
  it('round-trips put/get and composes the snapshot', () => {
    const store = new BaselineStore({ now: () => NOW });
    const snapshot = makeSnapshot();
    store.put(makeKey(), snapshot);
    const out = store.get(makeKey());
    expect(out).toBeTruthy();
    expect(out?.appId).toBe('codex');
    expect(out?.rootCustomProperties?.['--cb-fg']).toBe('#fff');
    expect(out?.nodes?.length).toBe(1);
  });

  it('is isolated by appVersion/themeMode (version bump invalidates)', () => {
    const store = new BaselineStore({ now: () => NOW });
    store.put(makeKey(), makeSnapshot());
    // 同 appId 不同版本 → 应视为不同真值
    expect(store.get(makeKey({ appVersion: '2.11.0' }))).toBeNull();
    expect(store.get(makeKey())).toBeTruthy();
  });

  it('returns null for expired snapshot and prunes it', () => {
    const store = new BaselineStore({ now: () => NOW });
    store.put(makeKey(), makeSnapshot(makeKey(), { capturedAt: new Date(NOW - BASELINE_STALE_MS - 1000).toISOString() }));
    expect(store.get(makeKey())).toBeNull();
    expect(store.size).toBe(0);
  });

  it('supports targeted invalidation and full clear', () => {
    const store = new BaselineStore({ now: () => NOW });
    store.put(makeKey(), makeSnapshot());
    store.put(makeKey({ themeMode: 'light' }), makeSnapshot(makeKey({ themeMode: 'light' })));
    expect(store.size).toBe(2);
    const removed = store.invalidate({ appId: 'codex', themeMode: 'dark' });
    expect(removed).toBe(1);
    expect(store.get(makeKey({ themeMode: 'light' }))).toBeTruthy();
    expect(store.size).toBe(1);
    expect(store.clear()).toBe(1);
    expect(store.size).toBe(0);
  });

  it('evicts oldest entry beyond maxSlots', () => {
    const store = new BaselineStore({ now: () => NOW, maxSlots: 2 });
    store.put(makeKey({ themeMode: 'dark' }), makeSnapshot(makeKey({ themeMode: 'dark' })));
    store.put(makeKey({ themeMode: 'light' }), makeSnapshot(makeKey({ themeMode: 'light' })));
    store.put(makeKey({ appVersion: '2.11.0' }), makeSnapshot(makeKey({ appVersion: '2.11.0' })));
    expect(store.size).toBe(2);
    // 最老的 dark 被淘汰
    expect(store.get(makeKey({ themeMode: 'dark' }))).toBeNull();
  });
});