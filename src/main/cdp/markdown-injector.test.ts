// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';
import { buildMarkdownCss, injectMarkdownStyles, removeMarkdownStyles } from './markdown-injector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock CdpSession with a configurable evaluate implementation.
 */
function mockSession(evaluateImpl: (expr: string) => string | Error): CdpSession {
  return {
    evaluate: vi.fn().mockImplementation((expr: string) => {
      const result = evaluateImpl(expr);
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    }),
    send: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
  } as unknown as CdpSession;
}

// ---------------------------------------------------------------------------
// buildMarkdownCss
// ---------------------------------------------------------------------------

describe('buildMarkdownCss', () => {
  it('returns empty string when no styles are provided', () => {
    const css = buildMarkdownCss({});
    expect(css).toBe('');
  });

  it('generates heading color rules for all heading levels', () => {
    const css = buildMarkdownCss({ headingColor: '#ff0000' });
    expect(css).toContain('h1');
    expect(css).toContain('h6');
    expect(css).toContain('#ff0000');
  });

  it('generates per-level heading overrides', () => {
    const css = buildMarkdownCss({
      headingColor: '#000',
      headingColorH1: '#f00',
      headingColorH2: '#0f0',
      headingColorH3: '#00f',
    });
    expect(css).toContain('h1 { color: #f00; }');
    expect(css).toContain('h2 { color: #0f0; }');
    expect(css).toContain('h3 { color: #00f; }');
  });

  it('generates link color rule', () => {
    const css = buildMarkdownCss({ linkColor: '#0969da' });
    expect(css).toContain('a { color: #0969da; }');
  });

  it('generates code block background and color rules', () => {
    const css = buildMarkdownCss({
      codeBackground: '#f6f8fa',
      codeColor: '#24292f',
    });
    expect(css).toContain('background-color: #f6f8fa');
    expect(css).toContain('color: #24292f');
    expect(css).toContain('pre');
  });

  it('generates inline code color rule', () => {
    const css = buildMarkdownCss({ inlineCodeColor: '#d73a49' });
    expect(css).toContain('code:not(pre code)');
    expect(css).toContain('#d73a49');
  });

  it('generates blockquote color rule', () => {
    const css = buildMarkdownCss({ blockquoteColor: '#6a737d' });
    expect(css).toContain('blockquote { color: #6a737d; }');
  });

  it('generates font-family rule with monospace fallback for code', () => {
    const css = buildMarkdownCss({ fontFamily: 'Inter' });
    expect(css).toContain('font-family: Inter');
    expect(css).toContain('Operator Mono');
    expect(css).toContain('monospace');
  });

  it('generates all rules when all fields are provided', () => {
    const css = buildMarkdownCss({
      headingColor: '#111',
      headingColorH1: '#222',
      headingColorH2: '#333',
      headingColorH3: '#444',
      linkColor: '#06c',
      codeBackground: '#eee',
      codeColor: '#333',
      inlineCodeColor: '#e83',
      blockquoteColor: '#999',
      fontFamily: 'Roboto',
    });
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain('#111');
    expect(css).toContain('#06c');
    expect(css).toContain('#eee');
    expect(css).toContain('Roboto');
  });
});

// ---------------------------------------------------------------------------
// injectMarkdownStyles
// ---------------------------------------------------------------------------

describe('injectMarkdownStyles', () => {
  it('returns success with ruleCount when evaluate returns ok:N', async () => {
    const session = mockSession(() => 'ok:12');
    const result = await injectMarkdownStyles(session, { headingColor: '#fff' });
    expect(result.success).toBe(true);
    expect(result.ruleCount).toBe(12);
  });

  it('returns success with ruleCount 0 when styles are empty', async () => {
    const session = mockSession(() => 'ok:0');
    const result = await injectMarkdownStyles(session, {});
    expect(result.success).toBe(true);
    expect(result.ruleCount).toBe(0);
  });

  it('returns failure when evaluate returns err: message', async () => {
    const session = mockSession(() => 'err:SyntaxError: invalid CSS');
    const result = await injectMarkdownStyles(session, { headingColor: '#fff' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SyntaxError');
  });

  it('returns failure when evaluate throws', async () => {
    const session = mockSession(() => new Error('CDP disconnected'));
    const result = await injectMarkdownStyles(session, { linkColor: '#06c' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('CDP disconnected');
  });

  it('returns failure when evaluate returns a non-string value', async () => {
    const session = mockSession(() => 'null');
    const result = await injectMarkdownStyles(session, { codeBackground: '#000' });
    expect(result.success).toBe(false);
  });

  it('includes the data-agentskin-markdown attribute in the expression', async () => {
    let capturedExpr = '';
    const session = {
      evaluate: vi.fn().mockImplementation((expr: string) => {
        capturedExpr = expr;
        return Promise.resolve('ok:5');
      }),
      send: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    } as unknown as CdpSession;

    await injectMarkdownStyles(session, { blockquoteColor: '#888' });

    expect(capturedExpr).toContain('data-agentskin-markdown');
    expect(capturedExpr).toContain('document.createElement');
    expect(capturedExpr).toContain('document.head');
  });

  it('removes previous style element before injecting new one', async () => {
    let capturedExpr = '';
    const session = {
      evaluate: vi.fn().mockImplementation((expr: string) => {
        capturedExpr = expr;
        return Promise.resolve('ok:3');
      }),
      send: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
    } as unknown as CdpSession;

    await injectMarkdownStyles(session, { inlineCodeColor: '#f00' });

    expect(capturedExpr).toContain('querySelector');
    expect(capturedExpr).toContain('prev.remove()');
  });
});

// ---------------------------------------------------------------------------
// removeMarkdownStyles
// ---------------------------------------------------------------------------

describe('removeMarkdownStyles', () => {
  it('calls evaluate with the removal expression', async () => {
    const session = mockSession(() => 'ok');
    await removeMarkdownStyles(session);
    expect(session.evaluate).toHaveBeenCalledTimes(1);
    expect(session.evaluate).toHaveBeenCalledWith(
      expect.stringContaining('data-agentskin-markdown'),
    );
  });

  it('silently ignores errors (best-effort)', async () => {
    const session = mockSession(() => new Error('Document not found'));
    await expect(removeMarkdownStyles(session)).resolves.toBeUndefined();
  });
});
