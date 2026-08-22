// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp/cdp-client';

const { checkThemeHealth, parseBgAlpha, isSemiTransparent } = await import('./theme-health-check');

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Build a mock CdpSession that simulates a themed page.
 * `evaluate` returns values based on expression content:
 *   - status probe (contains `adapterMarker`) → status JSON
 *   - opaque layer walk (contains `walk(root`) → layers JSON
 *   - overridden-variable detection (contains `selectorText !== ':root'`) → mismatches JSON
 */
function makeMockSession(
  opts: { statusResult?: string; overrideResult?: string; throwOnProbe?: boolean } = {},
): CdpSession {
  const {
    statusResult = JSON.stringify({
      heroArtActive: true,
      themeSheetPresent: true,
      accentToken: '#ff7043',
      hostClassPresent: true,
      adapterPresent: true,
      nativeTokens: { '--semi-color-bg-0': '#1a1a1a' },
    }),
    overrideResult = '[]',
    throwOnProbe = false,
  } = opts;

  const evaluate = vi.fn().mockImplementation((expr: string) => {
    if (throwOnProbe) throw new Error('CDP closed');
    // Status probe
    if (expr.includes('adapterMarker')) return Promise.resolve(statusResult);
    // Overridden-variable detection
    if (expr.includes("selectorText !== ':root'") || expr.includes("selectorText !== ':root'")) {
      return Promise.resolve(overrideResult);
    }
    // Opaque layer walk (contains walk()
    if (expr.includes('walk(root')) return Promise.resolve('[]');
    return Promise.resolve('[]');
  });

  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate,
    close: vi.fn(),
  } as unknown as CdpSession;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkThemeHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a complete report with overriddenVariables array', async () => {
    const session = makeMockSession();
    const report = await checkThemeHealth(session, 'doubao');

    expect(report.agentId).toBe('doubao');
    expect(report.heroArtActive).toBe(true);
    expect(report.themeSheetPresent).toBe(true);
    expect(report.accentToken).toBe('#ff7043');
    expect(report.hostClassPresent).toBe(true);
    expect(report.adapterPresent).toBe(true);
    expect(report.overriddenVariables).toEqual([]);
    expect(report.score).toBe(100);
  });

  it('reports overridden variables when theme values are suppressed', async () => {
    const overrides = JSON.stringify([
      {
        name: '--agentskin-accent',
        declared: '#ff7043',
        computed: '#1890ff',
      },
    ]);
    const session = makeMockSession({ overrideResult: overrides });
    const report = await checkThemeHealth(session, 'doubao');

    expect(report.overriddenVariables).toHaveLength(1);
    expect(report.overriddenVariables[0]!.name).toBe('--agentskin-accent');
    expect(report.overriddenVariables[0]!.declared).toBe('#ff7043');
    expect(report.overriddenVariables[0]!.computed).toBe('#1890ff');
    // Score should be penalized: 100 - 10 = 90
    expect(report.score).toBe(90);
  });

  it('caps override penalty at 30 points', async () => {
    const overrides = JSON.stringify([
      { name: '--a', declared: '1', computed: 'x' },
      { name: '--b', declared: '2', computed: 'y' },
      { name: '--c', declared: '3', computed: 'z' },
      { name: '--d', declared: '4', computed: 'w' },
    ]);
    const session = makeMockSession({ overrideResult: overrides });
    const report = await checkThemeHealth(session, 'doubao');

    expect(report.overriddenVariables).toHaveLength(4);
    // 4 overrides * 10 = 40, capped at 30 → score = 100 - 30 = 70
    expect(report.score).toBe(70);
  });

  it('returns empty report (score=-1) when Runtime.enable fails', async () => {
    const session = {
      send: vi.fn().mockRejectedValue(new Error('closed')),
      evaluate: vi.fn(),
      close: vi.fn(),
    } as unknown as CdpSession;

    const report = await checkThemeHealth(session, 'traework');
    expect(report.score).toBe(-1);
    expect(report.overriddenVariables).toEqual([]);
  });

  it('returns empty report when status probe throws', async () => {
    const session = makeMockSession({ throwOnProbe: true });
    const report = await checkThemeHealth(session, 'doubao');
    expect(report.score).toBe(-1);
  });
});

describe('parseBgAlpha', () => {
  it('returns 0 for transparent', () => {
    expect(parseBgAlpha('transparent')).toBe(0);
    expect(parseBgAlpha('rgba(0, 0, 0, 0)')).toBe(0);
  });

  it('returns 1 for opaque rgb()', () => {
    expect(parseBgAlpha('rgb(255, 0, 0)')).toBe(1);
  });

  it('parses fractional alpha from rgba()', () => {
    expect(parseBgAlpha('rgba(255, 0, 0, 0.5)')).toBe(0.5);
    expect(parseBgAlpha('rgba(0,0,0,0.89)')).toBeCloseTo(0.89, 5);
  });

  it('returns 0 for empty/undefined (treated as transparent)', () => {
    expect(parseBgAlpha('')).toBe(0);
    expect(parseBgAlpha(undefined)).toBe(0);
  });

  it('returns 1 for unparseable named colors', () => {
    expect(parseBgAlpha('red')).toBe(1);
  });
});

describe('isSemiTransparent', () => {
  it('returns true for rgba with alpha < 1', () => {
    expect(isSemiTransparent('rgba(0, 0, 0, 0.5)')).toBe(true);
    expect(isSemiTransparent('rgba(0,0,0,0)')).toBe(true);
  });

  it('returns false for fully opaque', () => {
    expect(isSemiTransparent('rgb(0, 0, 0)')).toBe(false);
    expect(isSemiTransparent('rgba(0, 0, 0, 1)')).toBe(false);
    expect(isSemiTransparent('transparent')).toBe(true); // alpha=0 < 1
  });
});
