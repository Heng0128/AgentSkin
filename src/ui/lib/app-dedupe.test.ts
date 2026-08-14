// SPDX-License-Identifier: MPL-2.0

import type { ScannedApp } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { compareVersions, dedupeByProductName, parseVersion } from './app-dedupe';

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
