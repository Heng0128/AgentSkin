// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { verifyTheme } from './shared';

// ---------------------------------------------------------------------------
// Mock the logger so verifyTheme's mainWarn calls don't pollute test output.
// ---------------------------------------------------------------------------
vi.mock('../../logger', () => ({
  mainWarn: vi.fn(),
}));

import { mainWarn } from '../../logger';

/**
 * Minimal CdpSession mock — only the `evaluate` method is exercised by
 * verifyTheme. The evaluate stub returns a JSON string simulating a real
 * CDP Runtime.evaluate response.
 */
function mockSession(evaluateResult: string | Error) {
  return {
    evaluate: vi.fn().mockImplementation(() => {
      if (evaluateResult instanceof Error) throw evaluateResult;
      return Promise.resolve(evaluateResult);
    }),
  } as unknown as Parameters<typeof verifyTheme>[0];
}

describe('verifyTheme', () => {
  it('parses a complete verification with per-layer rule counts', async () => {
    const raw = JSON.stringify({
      accent: '#ff7a6b',
      agentskinArt: 'url(blob:...)',
      heroBlobActive: true,
      adoptedSheetCount: 5,
      layers: { palette: 1, tokens: 45, cosmetic: 12, theme: 200, custom: 3 },
      assets: { '--agentskin-asset-hero': 'blob:...' },
      assetsActive: 1,
    });
    const session = mockSession(raw);
    const result = await verifyTheme(session);

    expect(result).not.toBeNull();
    expect(result?.accent).toBe('#ff7a6b');
    expect(result?.adoptedSheetCount).toBe(5);
    expect(result?.layers).toEqual({
      palette: 1,
      tokens: 45,
      cosmetic: 12,
      theme: 200,
      custom: 3,
    });
    expect(result?.heroBlobActive).toBe(true);
    expect(result?.assetsActive).toBe(1);
  });

  it('returns null when CDP evaluate throws', async () => {
    const session = mockSession(new Error('CDP timeout'));
    const result = await verifyTheme(session);
    expect(result).toBeNull();
  });

  it('handles missing layers field (legacy client fallback)', async () => {
    const raw = JSON.stringify({
      accent: '#abc',
      agentskinArt: '',
      heroBlobActive: false,
      adoptedSheetCount: 1,
    });
    const session = mockSession(raw);
    const result = await verifyTheme(session);

    expect(result).not.toBeNull();
    expect(result?.accent).toBe('#abc');
    expect(result?.adoptedSheetCount).toBe(1);
    expect(result?.layers).toBeUndefined();
  });

  it('reports empty accent when CSS variable is not set', async () => {
    const raw = JSON.stringify({
      accent: '',
      agentskinArt: '',
      heroBlobActive: false,
      adoptedSheetCount: 0,
      layers: {},
    });
    const session = mockSession(raw);
    const result = await verifyTheme(session);

    expect(result).not.toBeNull();
    expect(result?.accent).toBe('');
    expect(result?.adoptedSheetCount).toBe(0);
  });

  it('only collects --agentskin-asset-* variables', async () => {
    const raw = JSON.stringify({
      accent: '#fff',
      agentskinArt: '',
      heroBlobActive: false,
      adoptedSheetCount: 1,
      assets: {
        '--agentskin-asset-hero': 'blob:http://localhost/abc',
        '--agentskin-asset-mascot': 'blob:http://localhost/def',
      },
      assetsActive: 2,
    });
    const session = mockSession(raw);
    const result = await verifyTheme(session);

    expect(result?.assetsActive).toBe(2);
    expect(result?.assets?.['--agentskin-asset-hero']).toContain('blob:');
  });

  // -------------------------------------------------------------------------
  // REQ-G-003: isThemeVerification type-guard — malformed CDP responses
  // -------------------------------------------------------------------------

  it.each([
    ['plain string', 'hello'],
    ['array', [{ accent: '#fff', adoptedSheetCount: 1, heroBlobActive: false }]],
    ['null', null],
    ['undefined', undefined],
    ['missing accent', { adoptedSheetCount: 1, heroBlobActive: false }],
    ['missing adoptedSheetCount', { accent: '#fff', heroBlobActive: false }],
    ['missing heroBlobActive', { accent: '#fff', adoptedSheetCount: 1 }],
    [
      'adoptedSheetCount as string',
      { accent: '#fff', adoptedSheetCount: 'four', heroBlobActive: false },
    ],
    [
      'heroBlobActive as string true',
      { accent: '#fff', adoptedSheetCount: 1, heroBlobActive: 'true' },
    ],
  ])('should return null for malformed response: %s', async (_, malformedData) => {
    const session = mockSession(JSON.stringify(malformedData));
    const result = await verifyTheme(session);
    expect(result).toBeNull();
  });

  it('should log mainWarn when type-guard rejects malformed response', async () => {
    const session = mockSession('not-json');
    const result = await verifyTheme(session);

    expect(result).toBeNull();
    expect(mainWarn).toHaveBeenCalledWith(
      'Inject.Verify',
      expect.stringContaining('failed type-guard'),
    );
  });

  // -------------------------------------------------------------------------
  // REQ-G-010: verifyTheme evaluate exception fallback
  // -------------------------------------------------------------------------

  it('should return null and log warn when session.evaluate throws', async () => {
    const session = mockSession(new Error('Session closed'));
    const result = await verifyTheme(session);

    expect(result).toBeNull();
    expect(mainWarn).toHaveBeenCalledWith(
      'Inject.Verify',
      expect.stringContaining('Session closed'),
    );
  });
});
