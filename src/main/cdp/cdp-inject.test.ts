// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// Mocks — only mock filesystem so hero file reading can be controlled.
// All other dependencies (injection-runtime, injection-constants) are real
// pure functions, keeping the test close to actual behavior.
// ---------------------------------------------------------------------------

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const { existsSync, readFileSync } = await import('node:fs');
const { injectThemeViaCdp, removeEngineInjection } = await import('./cdp-inject');

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Build a mock CdpSession whose `evaluate` returns different values based on
 * the expression content. This lets us drive the multi-step injection flow
 * without mocking every internal helper.
 */
function makeMockSession(
  evaluateImpl?: (expression: string) => string,
  overrides: Partial<CdpSession> = {},
): CdpSession {
  const evaluate = vi.fn(
    evaluateImpl
      ? (expr: string) => Promise.resolve(evaluateImpl(expr))
      : () => Promise.resolve('ok:1'),
  );
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate,
    close: vi.fn(),
    ...overrides,
  };
}

/** A verification JSON string that verifyTheme() returns from evaluate. */
const VERIFY_SUCCESS = JSON.stringify({
  accent: '#0ff',
  agentskinArt: 'url(blob:abc)',
  heroBlobActive: true,
  adoptedSheetCount: 1,
});

const VERIFY_NO_HERO = JSON.stringify({
  accent: '#0ff',
  agentskinArt: '',
  heroBlobActive: false,
  adoptedSheetCount: 1,
});

/**
 * Smart evaluate that returns appropriate values based on expression content.
 * Recognises: host-class add, hero blob injection, CSS adopted, verification.
 */
function smartEvaluate(
  overrides?: Partial<{
    heroResult: string;
    cssResult: string;
    verifyResult: string;
    configResult: string;
    clearResult: string;
  }>,
): (expression: string) => string {
  const heroResult = overrides?.heroResult ?? 'ok';
  const cssResult = overrides?.cssResult ?? 'ok:5';
  const verifyResult = overrides?.verifyResult ?? VERIFY_SUCCESS;
  const configResult = overrides?.configResult ?? 'ok';
  const clearResult = overrides?.clearResult ?? 'cleaned';
  return (expression: string) => {
    // Host class add
    if (expression.includes('classList.add')) return 'ok';
    // Hero blob injection (small, direct path)
    if (expression.includes('URL.createObjectURL') && expression.includes('--agentskin-art')) {
      return heroResult;
    }
    // Hero chunk init
    if (expression.includes('__agentskinHeroChunks') && expression.includes('= []')) {
      return 'init';
    }
    // Hero chunk push
    if (expression.includes('__agentskinHeroChunks') && expression.includes('.push(')) {
      return 'pushed';
    }
    // Hero chunk assemble (has URL.createObjectURL but also join)
    if (expression.includes('__agentskinHeroChunks') && expression.includes('.join(')) {
      return heroResult;
    }
    // CSS adoptedStyleSheets injection
    if (expression.includes('adoptedStyleSheets') && expression.includes('replaceSync')) {
      return cssResult;
    }
    // Verification read-back
    if (expression.includes('--agentskin-accent') && expression.includes('heroBlobActive')) {
      return verifyResult;
    }
    // Config global set
    if (expression.includes('__AGENTSKIN_CONFIG__')) {
      return configResult;
    }
    // Adapter cleanup
    if (expression.includes('__agentskin_adapter')) {
      return clearResult;
    }
    // sessionStorage operations
    if (expression.includes('sessionStorage')) {
      return 'ok';
    }
    // Clear engine injection
    if (expression.includes('adoptedStyleSheets') && expression.includes('filter')) {
      return clearResult;
    }
    return 'ok';
  };
}

// Reset mocks between tests.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake-hero-data'));
});

// ===========================================================================
// injectThemeViaCdp
// ===========================================================================

describe('injectThemeViaCdp', () => {
  it('returns failure when Runtime.enable throws', async () => {
    const session = makeMockSession(undefined, {
      send: vi.fn().mockRejectedValue(new Error('Runtime.enable failed')),
    });
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(false);
    expect(result.heroInjected).toBe(false);
    expect(result.success).toBe(false);
  });

  it('adds host class when provided', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      hostClass: 'agentskin-host-doubao',
      verifyDelayMs: 0,
    });
    const hostClassCall = evaluate.mock.calls.find(
      ([expr]) => expr.includes('classList.add') && expr.includes('agentskin-host-doubao'),
    );
    expect(hostClassCall).toBeDefined();
  });

  it('continues when host class evaluate fails (non-fatal)', async () => {
    const evaluate = vi.fn((expr: string) => {
      if (expr.includes('classList.add')) throw new Error('eval failed');
      return smartEvaluate()(expr);
    });
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      hostClass: 'agentskin-host-doubao',
      verifyDelayMs: 0,
    });
    // Should still succeed — host class is progressive enhancement.
    expect(result.cssInjected).toBe(true);
    expect(result.success).toBe(true);
  });

  it('injects hero from dataUrl successfully', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroDataUrl: 'data:image/webp;base64,SGVsbG8=',
      verifyDelayMs: 0,
    });
    expect(result.heroInjected).toBe(true);
    expect(result.verification?.heroBlobActive).toBe(true);
    expect(result.success).toBe(true);
  });

  it('injects hero from file path when heroPath is provided and file exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake-hero-binary'));
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroPath: '/fake/path/hero.webp',
      verifyDelayMs: 0,
    });
    expect(existsSync).toHaveBeenCalledWith('/fake/path/hero.webp');
    expect(readFileSync).toHaveBeenCalledWith('/fake/path/hero.webp');
    expect(result.heroInjected).toBe(true);
  });

  it('skips hero injection when neither heroPath nor heroDataUrl is provided', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.heroInjected).toBe(false);
    // No hero → success depends only on CSS.
    expect(result.cssInjected).toBe(true);
    expect(result.success).toBe(true);
  });

  it('skips hero from path when file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroPath: '/nonexistent/hero.webp',
      verifyDelayMs: 0,
    });
    expect(result.heroInjected).toBe(false);
    // hasHero is true (heroPath provided) but heroInjected is false → success=false.
    expect(result.success).toBe(false);
  });

  it('returns cssInjected=true when CSS adoptedStyleSheets injection succeeds', async () => {
    const evaluate = vi.fn(smartEvaluate({ cssResult: 'ok:12' }));
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(true);
  });

  it('returns cssInjected=false when CSS injection returns error', async () => {
    const evaluate = vi.fn(smartEvaluate({ cssResult: 'err:replaceSync failed' }));
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(false);
    expect(result.success).toBe(false);
  });

  it('returns cssInjected=false when CSS evaluate throws', async () => {
    const evaluate = vi.fn((expr: string) => {
      if (expr.includes('replaceSync'))
        throw new Error('Renderer evaluation failed: evaluate crashed');
      return smartEvaluate()(expr);
    });
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(false);
  });

  it('retries hero injection when verification shows heroBlobActive=false', async () => {
    let verifyCallCount = 0;
    const evaluate = vi.fn((expr: string) => {
      if (expr.includes('--agentskin-accent') && expr.includes('heroBlobActive')) {
        verifyCallCount++;
        // First verification: hero not active. Second (after retry): active.
        return verifyCallCount === 1 ? VERIFY_NO_HERO : VERIFY_SUCCESS;
      }
      return smartEvaluate()(expr);
    });
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroDataUrl: 'data:image/webp;base64,SGVsbG8=',
      retries: 2,
      verifyDelayMs: 0,
    });
    expect(verifyCallCount).toBe(2);
    expect(result.verification?.heroBlobActive).toBe(true);
    expect(result.success).toBe(true);
  });

  it('does not retry when hero was not injected', async () => {
    let verifyCallCount = 0;
    const evaluate = vi.fn((expr: string) => {
      if (expr.includes('--agentskin-accent') && expr.includes('heroBlobActive')) {
        verifyCallCount++;
        return VERIFY_NO_HERO;
      }
      return smartEvaluate({ heroResult: 'err:injection failed' })(expr);
    });
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroDataUrl: 'data:image/webp;base64,SGVsbG8=',
      retries: 3,
      verifyDelayMs: 0,
    });
    // heroInjected=false → no retry despite retries=3.
    expect(verifyCallCount).toBe(1);
    expect(result.heroInjected).toBe(false);
  });

  it('returns success=true on full success path with hero', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroDataUrl: 'data:image/webp;base64,SGVsbG8=',
      hostClass: 'agentskin-host-doubao',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(true);
    expect(result.heroInjected).toBe(true);
    expect(result.verification?.heroBlobActive).toBe(true);
    expect(result.success).toBe(true);
  });

  it('returns success=true on full success path without hero', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(true);
    expect(result.heroInjected).toBe(false);
    // No hero → !hasHero → success = cssInjected && true.
    expect(result.success).toBe(true);
  });

  it('returns success=false when CSS fails even if hero succeeds', async () => {
    const evaluate = vi.fn(smartEvaluate({ cssResult: 'err:failed' }));
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroDataUrl: 'data:image/webp;base64,SGVsbG8=',
      verifyDelayMs: 0,
    });
    expect(result.cssInjected).toBe(false);
    expect(result.heroInjected).toBe(true);
    expect(result.success).toBe(false);
  });

  it('returns verification=null when verify evaluate throws', async () => {
    const evaluate = vi.fn((expr: string) => {
      if (expr.includes('--agentskin-accent'))
        throw new Error('Renderer evaluation failed: verify crashed');
      return smartEvaluate()(expr);
    });
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      verifyDelayMs: 0,
    });
    expect(result.verification).toBeNull();
    // No hero → success = cssInjected && (!hasHero || ...) → cssInjected && true.
    expect(result.success).toBe(true);
  });

  it('handles large hero data URLs via chunked transfer', async () => {
    // Create a large base64 string (> 256KB threshold) to trigger chunking.
    const largeBase64 = 'A'.repeat(300 * 1024);
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    const result = await injectThemeViaCdp(session, {
      css: ':root { --primary: #0ff; }',
      heroDataUrl: `data:image/webp;base64,${largeBase64}`,
      verifyDelayMs: 0,
    });
    expect(result.heroInjected).toBe(true);
    // Chunked path makes: init + N pushes + assemble calls.
    const initCalls = evaluate.mock.calls.filter(
      ([expr]) => expr.includes('__agentskinHeroChunks') && expr.includes('= []'),
    );
    expect(initCalls.length).toBe(1);
  });
});

// ===========================================================================
// removeEngineInjection
// ===========================================================================

describe('removeEngineInjection', () => {
  it('calls Page.removeScriptToEvaluateOnNewDocument when agent is provided', async () => {
    const send = vi.fn().mockResolvedValue({});
    const session = makeMockSession(undefined, { send });
    await removeEngineInjection(session, 'doubao');
    // Should call Page.removeScriptToEvaluateOnNewDocument (best-effort).
    // Also calls Runtime.enable and Page.* — at minimum send was called.
    expect(send).toHaveBeenCalled();
  });

  it('sets sessionStorage disable flag', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    await removeEngineInjection(session, 'doubao');
    const sessionStorageCall = evaluate.mock.calls.find(
      ([expr]) => expr.includes('sessionStorage') && expr.includes('__agentskin_disabled__'),
    );
    expect(sessionStorageCall).toBeDefined();
  });

  it('clears engine injection from the document', async () => {
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate);
    await removeEngineInjection(session, 'doubao');
    // The clear expression removes adoptedStyleSheets with __agentskin flag
    // and clears adapter markers.
    const clearCall = evaluate.mock.calls.find(
      ([expr]) => expr.includes('adoptedStyleSheets') && expr.includes('__agentskin'),
    );
    expect(clearCall).toBeDefined();
  });

  it('works without agent parameter (no persistence script removal)', async () => {
    const send = vi.fn().mockResolvedValue({});
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate, { send });
    await removeEngineInjection(session);
    // Should still set sessionStorage and clear injection.
    const sessionStorageCall = evaluate.mock.calls.find(([expr]) =>
      expr.includes('sessionStorage'),
    );
    expect(sessionStorageCall).toBeDefined();
  });

  it('handles Runtime.enable failure gracefully (best-effort)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Runtime.enable failed'));
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate, { send });
    // Should not throw.
    await expect(removeEngineInjection(session, 'doubao')).resolves.toBeUndefined();
  });

  it('handles evaluate failure gracefully (best-effort)', async () => {
    const evaluate = vi.fn(() => {
      throw new Error('Renderer evaluation failed: evaluate crashed');
    });
    const session = makeMockSession(evaluate);
    // Should not throw.
    await expect(removeEngineInjection(session, 'doubao')).resolves.toBeUndefined();
  });

  it('handles send failure for persistence script removal gracefully', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Page.remove failed'));
    const evaluate = vi.fn(smartEvaluate());
    const session = makeMockSession(evaluate, { send });
    // Should not throw — persistence script removal is best-effort.
    await expect(removeEngineInjection(session, 'doubao')).resolves.toBeUndefined();
  });
});
