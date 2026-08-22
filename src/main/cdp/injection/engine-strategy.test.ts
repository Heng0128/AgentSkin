// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from '../cdp-client';

// ---------------------------------------------------------------------------
// Mocks — hero-inject has filesystem + Blob dependency, mock it entirely so
// the test doesn't touch the filesystem or construct real Blob URLs.
// ---------------------------------------------------------------------------

vi.mock('./hero-inject', () => ({
  injectHeroBlob: vi.fn().mockResolvedValue(true),
  injectHeroFromDataUrl: vi.fn().mockResolvedValue(true),
  transferImageSet: vi.fn().mockResolvedValue({ injectedIds: ['hero'], heroInjected: true }),
}));

const { injectThemeViaEngine } = await import('./engine-strategy');

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Verification JSON that satisfies isThemeFullyApplied (all 3 required layers + accent). */
const VERIFY_FULL = JSON.stringify({
  accent: '#ff7a6b',
  agentskinArt: 'url(blob:abc)',
  heroBlobActive: true,
  adoptedSheetCount: 4,
  layers: { palette: 1, tokens: 45, cosmetic: 12, theme: 200 },
});

/** Verification JSON for partial injection (missing tokens layer). */
const VERIFY_PARTIAL = JSON.stringify({
  accent: '#ff7a6b',
  agentskinArt: '',
  heroBlobActive: false,
  adoptedSheetCount: 2,
  layers: { palette: 1, cosmetic: 12 },
});

/**
 * Build a mock CdpSession whose `evaluate` returns values based on the
 * expression content. Recognizes:
 *   - CSS layer adoption (contains `CSSStyleSheet`) → 'ok:10'
 *   - Verification (contains `getComputedStyle`) → configurable JSON
 *   - Adapter / config (contains `function` or `__AGENTSKIN_CONFIG__`) → adapterResult
 *   - Anything else → 'ok'
 */
function makeMockSession(
  opts: { adapterResult?: string; verifyResult?: string; throwOnSend?: boolean } = {},
): CdpSession {
  const { adapterResult = 'applied', verifyResult = VERIFY_FULL, throwOnSend } = opts;

  const evaluate = vi.fn().mockImplementation((expr: string) => {
    if (expr.includes('CSSStyleSheet')) return Promise.resolve('ok:10');
    if (expr.includes('getComputedStyle')) return Promise.resolve(verifyResult);
    if (expr.includes('__AGENTSKIN_CONFIG__') || expr.includes('function')) {
      return Promise.resolve(adapterResult);
    }
    return Promise.resolve('ok');
  });

  const send = throwOnSend
    ? vi.fn().mockRejectedValue(new Error('session closed'))
    : vi.fn().mockResolvedValue({});

  return {
    send,
    evaluate,
    close: vi.fn(),
  } as unknown as CdpSession;
}

/** Base options shared by most tests (no hero, fast verify). */
const baseOptions = {
  paletteCss: '--agentskin-accent: #ff7a6b;',
  tokensCss: '--dbx-text-primary: #fff;',
  cosmeticCss: 'body { margin: 0; }',
  adapterJs: '(function() { return "applied"; })()',
  agent: 'doubao',
  themeId: 'aurora-dusk',
  verifyDelayMs: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('injectThemeViaEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success when all layers adopt and adapter applies', async () => {
    const session = makeMockSession({ adapterResult: 'applied' });
    const result = await injectThemeViaEngine(session, baseOptions);

    expect(result.success).toBe(true);
    expect(result.layersInjected).toBe(3); // palette + tokens + cosmetic
    expect(result.adapterApplied).toBe(true);
    expect(result.verification).not.toBeNull();
    expect(result.verification?.accent).toBe('#ff7a6b');
    expect(result.verification?.layers?.tokens).toBe(45);
  });

  it('returns success=false when adapter returns non-"applied"', async () => {
    const session = makeMockSession({ adapterResult: 'error: no DOM' });
    const result = await injectThemeViaEngine(session, baseOptions);

    expect(result.success).toBe(false);
    expect(result.adapterApplied).toBe(false);
    // Layers still injected even if adapter fails
    expect(result.layersInjected).toBe(3);
  });

  it('returns success=false when Runtime.enable throws', async () => {
    const session = makeMockSession({ throwOnSend: true });
    const result = await injectThemeViaEngine(session, baseOptions);

    expect(result.success).toBe(false);
    expect(result.layersInjected).toBe(0);
    expect(result.adapterApplied).toBe(false);
  });

  it('returns success=false when verification shows partial injection', async () => {
    const session = makeMockSession({ verifyResult: VERIFY_PARTIAL });
    const result = await injectThemeViaEngine(session, {
      ...baseOptions,
      verifyDelayMs: 0,
      verifyTimeoutMs: 200, // Short timeout keeps the test fast
    });

    // waitForTheme returns the (partial) verification, but
    // isThemeFullyApplied() detects the missing tokens layer → success false
    expect(result.verification).not.toBeNull();
    expect(result.verification?.layers?.tokens).toBeUndefined(); // tokens missing
    expect(result.success).toBe(false);
  });

  it('counts themeCss as an additional layer when provided', async () => {
    const session = makeMockSession({ adapterResult: 'applied' });
    const result = await injectThemeViaEngine(session, {
      ...baseOptions,
      themeCss: 'html { --dbx-bg: #000; }',
    });

    // palette + tokens + cosmetic + theme = 4 layers
    expect(result.layersInjected).toBe(4);
    expect(result.success).toBe(true);
  });

  it('counts customCss as the final layer when both themeCss and customCss provided', async () => {
    const session = makeMockSession({ adapterResult: 'applied' });
    const result = await injectThemeViaEngine(session, {
      ...baseOptions,
      themeCss: 'html { }',
      customCss: '.user-override { color: red; }',
    });

    // palette + tokens + cosmetic + theme + custom = 5 layers
    expect(result.layersInjected).toBe(5);
    expect(result.success).toBe(true);
  });

  it('treats "already-applied" as adapter success', async () => {
    const session = makeMockSession({ adapterResult: 'already-applied' });
    const result = await injectThemeViaEngine(session, baseOptions);

    expect(result.adapterApplied).toBe(true);
    expect(result.success).toBe(true);
  });

  it('calls session.send(Runtime.enable) once before injecting', async () => {
    const session = makeMockSession();
    await injectThemeViaEngine(session, baseOptions);

    expect(session.send).toHaveBeenCalledWith('Runtime.enable');
    expect(session.send).toHaveBeenCalledTimes(1);
  });

  it('clears previous adapter before injecting new layers', async () => {
    const session = makeMockSession();
    await injectThemeViaEngine(session, baseOptions);

    // First evaluate call should be the CLEAR_ADAPTERS_BODY cleanup
    const evaluateMock = vi.mocked(session.evaluate);
    const firstEvaluateCall = evaluateMock.mock.calls[0]![0] as string;
    expect(firstEvaluateCall).toContain('__agentskin');
  });
});
