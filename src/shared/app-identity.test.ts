// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { compareVersions, normalizeVersion, parseVersion, sourceRank } from './app-identity';
import type { ScannedApp } from './types/agent';

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

describe('normalizeVersion', () => {
  it('pads short versions to three segments', () => {
    expect(normalizeVersion('1.0')).toBe('1.0.0');
    expect(normalizeVersion('5')).toBe('5.0.0');
  });

  it('collapses trailing all-zero segments beyond three', () => {
    expect(normalizeVersion('1.0.0.0')).toBe('1.0.0');
    expect(normalizeVersion('3.2.1.0')).toBe('3.2.1');
  });

  it('keeps meaningful build segments', () => {
    expect(normalizeVersion('7.0.7.940')).toBe('7.0.7.940');
  });

  it('preserves non-numeric suffixes', () => {
    expect(normalizeVersion('1.2.3-beta')).toBe('1.2.3-beta');
    expect(normalizeVersion('1.0-beta')).toBe('1.0.0-beta');
  });

  it('passes through empty and non-numeric input untouched', () => {
    expect(normalizeVersion('')).toBe('');
    expect(normalizeVersion('unknown')).toBe('unknown');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeVersion('  1.0  ')).toBe('1.0.0');
  });
});

describe('sourceRank', () => {
  it('orders agent > registry > msix > shortcut > filesystem', () => {
    const rank = (source: ScannedApp['source']) => sourceRank(app({ source }));
    expect(rank('agent')).toBeGreaterThan(rank('registry'));
    expect(rank('registry')).toBeGreaterThan(rank('msix'));
    expect(rank('msix')).toBeGreaterThan(rank('shortcut'));
    expect(rank('shortcut')).toBeGreaterThan(rank('filesystem'));
  });

  it('defaults missing source to the filesystem rank', () => {
    expect(sourceRank(app({}))).toBe(sourceRank(app({ source: 'filesystem' })));
  });
});

describe('compareVersions', () => {
  it('still compares across formats that normalize to the same body', () => {
    expect(compareVersions('1.0.0.0', '1.0')).toBe(0);
    expect(compareVersions('7.0.7.940', '7.0.5.931')).toBeGreaterThan(0);
  });
});

describe('parseVersion', () => {
  it('splits numeric segments and drops non-numeric tails', () => {
    expect(parseVersion('1.2.3-beta')).toEqual([1, 2, 3]);
  });
});
