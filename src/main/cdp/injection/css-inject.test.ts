// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { CdpSession } from '../cdp-client';
import { injectCssAdopted, injectCssLayer } from './css-inject';

/**
 * Minimal CdpSession mock — only evaluate and send are exercised by
 * the css-inject functions.
 */
function mockSession(evaluateImpl: (expr: string) => string | Error) {
  return {
    evaluate: vi.fn().mockImplementation((expr: string) => {
      const result = evaluateImpl(expr);
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    }),
    send: vi.fn().mockResolvedValue({}),
  } as unknown as CdpSession;
}

describe('injectCssLayer', () => {
  it('returns true when evaluate returns ok:<count>', async () => {
    const session = mockSession(() => 'ok:42');
    const result = await injectCssLayer(session, 'palette', '--agentskin-accent: red;');
    expect(result).toBe(true);
    expect(session.evaluate).toHaveBeenCalledTimes(1);
  });

  it('returns false when evaluate returns err:', async () => {
    const session = mockSession(() => 'err:Invalid CSS');
    const result = await injectCssLayer(session, 'tokens', '!!!invalid');
    expect(result).toBe(false);
  });

  it('returns false when evaluate throws', async () => {
    const session = mockSession(() => new Error('CDP disconnected'));
    const result = await injectCssLayer(session, 'cosmetic', 'body { }');
    expect(result).false;
  });

  it('passes layerName into the expression for scoping', async () => {
    let capturedExpr = '';
    const session = {
      evaluate: vi.fn().mockImplementation((expr: string) => {
        capturedExpr = expr;
        return Promise.resolve('ok:1');
      }),
      send: vi.fn().mockResolvedValue({}),
    } as unknown as CdpSession;

    await injectCssLayer(session, 'myLayer', 'body { color: red; }');

    // The expression should reference the layer name for __agentskin_layer
    expect(capturedExpr).toContain('myLayer');
    expect(capturedExpr).toContain('__agentskin_layer');
  });
});

describe('injectCssAdopted', () => {
  it('returns true when evaluate returns ok:<count>', async () => {
    const session = mockSession(() => 'ok:10');
    const result = await injectCssAdopted(session, 'body { background: blue; }');
    expect(result).toBe(true);
  });

  it('returns false when evaluate returns err:', async () => {
    const session = mockSession(() => 'err:CSS parse error');
    const result = await injectCssAdopted(session, 'body { broken }');
    expect(result).toBe(false);
  });

  it('returns false when evaluate throws', async () => {
    const session = mockSession(() => new Error('timeout'));
    const result = await injectCssAdopted(session, 'body { }');
    expect(result).toBe(false);
  });

  it('clears only unnamed owned sheets (preserves engine layers)', async () => {
    let capturedExpr = '';
    const session = {
      evaluate: vi.fn().mockImplementation((expr: string) => {
        capturedExpr = expr;
        return Promise.resolve('ok:1');
      }),
      send: vi.fn().mockResolvedValue({}),
    } as unknown as CdpSession;

    await injectCssAdopted(session, 'body { color: red; }');

    // The filter should preserve sheets with __agentskin_layer
    expect(capturedExpr).toContain('__agentskin_layer');
    // Should clear ONLY unnamed owned sheets, not all owned sheets
    expect(capturedExpr).toContain('!');
    expect(capturedExpr).toContain('__agentskin');
  });
});
