// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import { verifyTheme } from './shared';

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
});
