// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { ScannedApp } from '../../../../shared/types/agent';
import { StreamMerge } from './stream-merge';

function app(overrides: Partial<ScannedApp>): ScannedApp {
  return {
    id: 'x',
    exePath: 'C:\\Apps\\x\\x.exe',
    productName: 'X',
    companyName: '',
    adapterMatch: null,
    ...overrides,
  };
}

describe('StreamMerge', () => {
  it('emits add for a new product and keeps the group', () => {
    const m = new StreamMerge();
    const a = app({ id: 'q1', productName: 'Quark', version: '7.0.5.931' });
    expect(m.upsert(a)).toBe('add');
    expect(m.size).toBe(1);
  });

  it('emits update when a higher version arrives for the same product', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'q1', productName: 'Quark', version: '7.0.5.931', source: 'filesystem' }));
    const newer = app({
      id: 'q2',
      productName: 'Quark',
      version: '7.0.7.940',
      source: 'filesystem',
    });
    expect(m.upsert(newer)).toBe('update');
    expect(m.entries()[0].version).toBe('7.0.7.940');
  });

  it('emits discard for a lower version of an already-known product', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'q2', productName: 'Quark', version: '7.0.7.940', source: 'filesystem' }));
    const older = app({
      id: 'q1',
      productName: 'Quark',
      version: '7.0.5.931',
      source: 'filesystem',
    });
    expect(m.upsert(older)).toBe('discard');
    expect(m.size).toBe(1);
  });

  it('prefers a higher source rank even when its version is lower', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'fs', productName: 'Quark', version: '7.0.7.940', source: 'filesystem' }));
    const launcher = app({
      id: 'reg',
      productName: 'Quark',
      version: '7.0.5.931',
      source: 'registry',
    });
    expect(m.upsert(launcher)).toBe('update');
    expect(m.entries()[0].exePath).toBe('C:\\Apps\\x\\x.exe');
  });

  it('keeps distinct products separate', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'a', productName: 'Quark' }));
    expect(m.upsert(app({ id: 'b', productName: 'QwenWorkCN' }))).toBe('add');
    expect(m.size).toBe(2);
  });

  it('does not merge Codex and Codex CLI (distinct identity after normalization)', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'a', productName: 'Codex' }));
    expect(m.upsert(app({ id: 'b', productName: 'Codex CLI' }))).toBe('add');
    expect(m.size).toBe(2);
  });

  it('records every version seen, even discarded ones, in descending order', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'q1', productName: 'Quark', version: '7.0.5.931' }));
    m.upsert(app({ id: 'q2', productName: 'Quark', version: '7.0.7.940' }));
    m.upsert(app({ id: 'q3', productName: 'Quark', version: '7.0.5.931' })); // dup version
    const [merged] = m.finalize();
    expect(merged.versions).toEqual(['7.0.7.940', '7.0.5.931']);
    expect(merged.isDefaultEntry).toBe(true);
  });

  it('falls back to exe path identity when the product name is empty', () => {
    const m = new StreamMerge();
    m.upsert(app({ id: 'a', productName: '', exePath: 'C:\\A\\A.exe' }));
    expect(m.upsert(app({ id: 'b', productName: '', exePath: 'C:\\B\\B.exe' }))).toBe('add');
    expect(m.size).toBe(2);
  });

  it('finalize matches the accumulated entries (stream === final)', () => {
    const m = new StreamMerge();
    const apps = [
      app({ id: 'q1', productName: 'Quark', version: '7.0.5.931' }),
      app({ id: 'q2', productName: 'Quark', version: '7.0.7.940' }),
      app({ id: 'c', productName: 'Codex', version: '1.0.0' }),
    ];
    const ops = apps.map((a) => m.upsert(a));
    expect(ops).toEqual(['add', 'update', 'add']);
    expect(m.finalize().map((a) => a.version)).toEqual(['7.0.7.940', '1.0.0']);
    expect(m.entries().length).toBe(2);
  });
});
