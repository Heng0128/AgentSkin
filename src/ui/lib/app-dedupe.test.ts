// SPDX-License-Identifier: MPL-2.0

import type { ElectronScanResult, ScannedApp } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { applyScanEvent, compareVersions, dedupeByProductName, parseVersion } from './app-dedupe';

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

describe('parseVersion', () => {
  it('splits dotted versions into numeric segments', () => {
    expect(parseVersion('7.0.5.931')).toEqual([7, 0, 5, 931]);
    expect(parseVersion('1.106.1.0')).toEqual([1, 106, 1, 0]);
  });

  it('drops the build/date suffix after the first dash', () => {
    expect(parseVersion('0.1.3-26073107')).toEqual([0, 1, 3]);
  });

  it('returns an empty array for empty/garbage input', () => {
    expect(parseVersion('')).toEqual([]);
    expect(parseVersion('nope')).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders numeric versions correctly', () => {
    expect(compareVersions('7.0.7.940', '7.0.5.931')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3', '0.1.6')).toBeLessThan(0);
    expect(compareVersions('1.106.1.0', '1.106.1.0')).toBe(0);
  });

  it('treats a missing version as the lowest', () => {
    expect(compareVersions('', '7.0.0')).toBeLessThan(0);
    expect(compareVersions('7.0.0', '')).toBeGreaterThan(0);
  });

  it('breaks numeric ties with the dash suffix', () => {
    expect(compareVersions('0.1.3-26080701', '0.1.3-26073107')).toBeGreaterThan(0);
  });
});

describe('dedupeByProductName', () => {
  it('keeps only the highest version of a multi-version product', () => {
    const apps = [
      app({
        id: 'q1',
        exePath: 'C:\\PF\\Quark\\7.0.5.931\\Quark.exe',
        productName: 'Quark',
        version: '7.0.5.931',
      }),
      app({
        id: 'q2',
        exePath: 'C:\\PF\\Quark\\7.0.7.940\\Quark.exe',
        productName: 'Quark',
        version: '7.0.7.940',
      }),
    ];
    const result = dedupeByProductName(apps);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('7.0.7.940');
  });

  it('is case-insensitive on the product name', () => {
    const apps = [
      app({ id: 'a', productName: 'Quark', version: '7.0.5' }),
      app({ id: 'b', productName: 'quark', version: '7.0.7' }),
    ];
    const result = dedupeByProductName(apps);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('7.0.7');
  });

  it('never merges distinct product names', () => {
    const apps = [
      app({ id: 'a', productName: 'Quark', version: '7.0.5' }),
      app({ id: 'b', productName: 'QwenWorkCN', version: '0.1.6' }),
    ];
    expect(dedupeByProductName(apps)).toHaveLength(2);
  });

  it('falls back to exe path when the product name is empty (no accidental merge)', () => {
    const apps = [
      app({ id: 'a', productName: '', exePath: 'C:\\A\\A.exe' }),
      app({ id: 'b', productName: '', exePath: 'C:\\B\\B.exe' }),
    ];
    expect(dedupeByProductName(apps)).toHaveLength(2);
  });

  it('prefers a registry (launcher) hit over a higher-version filesystem hit', () => {
    // Quark: the root launcher (registry) vs. a newer inner version directory.
    const apps = [
      app({
        id: 'v1',
        exePath: 'C:\\PF\\Quark\\7.0.7.940\\quark.exe',
        productName: 'Quark',
        version: '7.0.7.940',
        source: 'filesystem',
      }),
      app({
        id: 'launcher',
        exePath: 'C:\\PF\\Quark\\quark.exe',
        productName: 'Quark',
        version: '7.0.5.931',
        source: 'registry',
      }),
    ];
    const result = dedupeByProductName(apps);
    expect(result).toHaveLength(1);
    expect(result[0].exePath).toBe('C:\\PF\\Quark\\quark.exe');
  });

  it('prefers an agent hit over a registry hit', () => {
    const apps = [
      app({ id: 'a', productName: 'Trae', version: '1.0.0', source: 'registry' }),
      app({ id: 'b', productName: 'Trae', version: '0.9.0', source: 'agent' }),
    ];
    const result = dedupeByProductName(apps);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('falls back to highest version within the same source', () => {
    const apps = [
      app({ id: 'f1', productName: 'Douyin', version: '7.7.0', source: 'filesystem' }),
      app({ id: 'f2', productName: 'Douyin', version: '8.2.303', source: 'filesystem' }),
    ];
    const result = dedupeByProductName(apps);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('f2');
  });
});

describe('applyScanEvent', () => {
  const empty: ElectronScanResult = { adapted: [], other: [] };

  it('add appends a new product to the right bucket', () => {
    const other = app({ id: 'q1', productName: 'Quark', version: '7.0.5.931' });
    const result = applyScanEvent(null, { op: 'add', app: other });
    expect(result.other).toHaveLength(1);
    expect(result.adapted).toHaveLength(0);
  });

  it('routes adapted apps into the adapted bucket', () => {
    const adapted = app({ id: 'a1', productName: 'Trae', adapterMatch: 'traework' });
    const result = applyScanEvent(empty, { op: 'add', app: adapted });
    expect(result.adapted).toEqual([adapted]);
  });

  it('add is a no-op when the identity is already present (defensive)', () => {
    const first = app({ id: 'q1', productName: 'Quark', version: '7.0.5.931' });
    const dup = app({
      id: 'q1b',
      exePath: 'C:\\B\\q.exe',
      productName: 'Quark',
      version: '7.0.5.931',
    });
    const once = applyScanEvent(null, { op: 'add', app: first });
    const twice = applyScanEvent(once, { op: 'add', app: dup });
    expect(twice.other).toHaveLength(1);
    expect(twice.other[0].id).toBe('q1');
  });

  it('update replaces the tile for the same identity', () => {
    const older = app({
      id: 'q1',
      productName: 'Quark',
      version: '7.0.5.931',
      source: 'filesystem',
    });
    const newer = app({
      id: 'q2',
      exePath: 'C:\\B\\q.exe',
      productName: 'Quark',
      version: '7.0.7.940',
      source: 'registry',
    });
    const withOld = applyScanEvent(null, { op: 'add', app: older });
    const result = applyScanEvent(withOld, { op: 'update', app: newer });
    expect(result.other).toHaveLength(1);
    expect(result.other[0].id).toBe('q2');
  });

  it('update appends when the identity is absent (defensive)', () => {
    const fresh = app({ id: 'q9', productName: 'Quark', version: '7.0.7.940' });
    const result = applyScanEvent(empty, { op: 'update', app: fresh });
    expect(result.other).toEqual([fresh]);
  });

  it('icon patches only the matching tile in other', () => {
    const a = app({ id: 'q1', productName: 'Quark' });
    const b = app({ id: 'c1', productName: 'Codex' });
    const seeded = applyScanEvent(applyScanEvent(null, { op: 'add', app: a }), {
      op: 'add',
      app: b,
    });
    const result = applyScanEvent(seeded, {
      op: 'icon',
      appId: 'q1',
      iconPath: 'data:image/png;base64,x',
    });
    expect(result.other.find((x) => x.id === 'q1')?.iconPath).toBe('data:image/png;base64,x');
    expect(result.other.find((x) => x.id === 'c1')?.iconPath).toBeUndefined();
  });

  it('icon does not touch adapted apps', () => {
    const adapted = app({ id: 'a1', productName: 'Trae', adapterMatch: 'traework' });
    const seeded = applyScanEvent(empty, { op: 'add', app: adapted });
    const result = applyScanEvent(seeded, {
      op: 'icon',
      appId: 'a1',
      iconPath: 'data:image/png;base64,x',
    });
    expect(result.adapted[0].iconPath).toBeUndefined();
  });
});
