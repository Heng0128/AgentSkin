// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  identityKey,
  normalizeProductName,
  parseVersion,
} from '../../../../shared/app-identity';
import type { ScannedApp } from '../../../../shared/types/agent';
import { mergeByIdentity } from './merge';

let seq = 0;

function makeApp(
  overrides: Partial<ScannedApp> & { productName: string; companyName: string },
): ScannedApp {
  seq += 1;
  const { productName, companyName, ...rest } = overrides;
  return {
    id: `app-${seq}`,
    exePath: `C:\\Apps\\${productName}\\${seq}.exe`,
    productName,
    companyName,
    adapterMatch: null,
    ...rest,
  };
}

describe('normalizeProductName', () => {
  it('collapses Quark version strings to the same identity', () => {
    expect(normalizeProductName('Quark 7.0.5.931')).toBe('quark');
    expect(normalizeProductName('Quark 7.0.7.940')).toBe('quark');
  });

  it('strips spacing/hyphen/dot runs and trailing versions', () => {
    expect(normalizeProductName('Codex')).toBe('codex');
    expect(normalizeProductName('Codex CLI')).toBe('codexcli');
    expect(normalizeProductName('QwenWork CN')).toBe('qwenworkcn');
    expect(normalizeProductName('My-App_1.0')).toBe('myapp');
  });
});

describe('parseVersion', () => {
  it('splits numeric segments', () => {
    expect(parseVersion('7.0.5.931')).toEqual([7, 0, 5, 931]);
  });

  it('returns [] for an empty version', () => {
    expect(parseVersion('')).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders by numeric segments', () => {
    expect(compareVersions('7.0.7.940', '7.0.5.931')).toBeGreaterThan(0);
    expect(compareVersions('7.0.5.931', '7.0.7.940')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
  });

  it('tie-breaks on the build suffix after the first dash', () => {
    expect(compareVersions('9.9.31-49738', '9.9.31-49739')).toBeLessThan(0);
    expect(compareVersions('9.9.31-49739', '9.9.31-49738')).toBeGreaterThan(0);
  });
});

describe('identityKey', () => {
  it('combines normalized product and company names', () => {
    const app = makeApp({ productName: 'Quark 7.0.5.931', companyName: 'Quark Inc' });
    expect(identityKey(app)).toBe('quark|quarkinc');
  });

  it('falls back to the exe path when product name is empty', () => {
    const app = makeApp({ productName: '', companyName: '' });
    app.exePath = 'Foo';
    expect(identityKey(app)).toBe('foo|');
  });
});

describe('mergeByIdentity', () => {
  it('collapses two Quark versions into one entry with both versions, highest first', () => {
    const older = makeApp({
      productName: 'Quark 7.0.5.931',
      companyName: 'Quark Inc',
      version: '7.0.5.931',
      source: 'filesystem',
    });
    const newer = makeApp({
      productName: 'Quark 7.0.7.940',
      companyName: 'Quark Inc',
      version: '7.0.7.940',
      source: 'filesystem',
    });

    const merged = mergeByIdentity([older, newer]);

    expect(merged).toHaveLength(1);
    expect(merged[0].isDefaultEntry).toBe(true);
    expect(merged[0].versions).toEqual(['7.0.7.940', '7.0.5.931']);
  });

  it('keeps different products separate', () => {
    const quark = makeApp({
      productName: 'Quark 7.0.5.931',
      companyName: 'Quark Inc',
      version: '7.0.5.931',
    });
    const codex = makeApp({ productName: 'Codex', companyName: 'OpenAI', version: '1.0.0' });

    expect(mergeByIdentity([quark, codex])).toHaveLength(2);
  });

  it('keeps Codex vs Codex CLI separate', () => {
    const codex = makeApp({ productName: 'Codex', companyName: 'OpenAI', version: '1.0.0' });
    const codexCli = makeApp({ productName: 'Codex CLI', companyName: 'OpenAI', version: '1.0.0' });

    expect(mergeByIdentity([codex, codexCli])).toHaveLength(2);
  });

  it('prefers an agent-source entry over a filesystem-source entry of the same identity', () => {
    const fs = makeApp({
      productName: 'Quark 7.0.7.940',
      companyName: 'Quark Inc',
      version: '7.0.7.940',
      source: 'filesystem',
    });
    const agent = makeApp({
      productName: 'Quark 7.0.5.931',
      companyName: 'Quark Inc',
      version: '7.0.5.931',
      source: 'agent',
      adapterMatch: 'qoderwork',
    });

    const merged = mergeByIdentity([fs, agent]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('agent');
    expect(merged[0].version).toBe('7.0.5.931');
    expect(merged[0].adapterMatch).toBe('qoderwork');
    // Versions still reflect the whole group, highest first.
    expect(merged[0].versions).toEqual(['7.0.7.940', '7.0.5.931']);
  });

  it('dedupes identical versions within a group', () => {
    const a = makeApp({
      productName: 'Quark 7.0.7.940',
      companyName: 'Quark Inc',
      version: '7.0.7.940',
      source: 'filesystem',
    });
    const b = makeApp({
      productName: 'Quark 7.0.7.940',
      companyName: 'Quark Inc',
      version: '7.0.7.940',
      source: 'registry',
    });

    const merged = mergeByIdentity([a, b]);

    expect(merged).toHaveLength(1);
    expect(merged[0].versions).toEqual(['7.0.7.940']);
  });
});
