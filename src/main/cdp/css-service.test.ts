// SPDX-License-Identifier: MPL-2.0

/**
 * # css-service.test
 *
 * Unit tests for the CSS domain service. Uses a mock CdpSession that records
 * calls and returns scripted responses, mirroring the pattern established by
 * baseline-css-capture.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { CdpSession } from './cdp-client';
import { getStyleSheetText, listStyleSheets } from './css-service';

/** Build a mock CdpSession. evaluateMock receives the expression string. */
function makeSession(evaluateMock: (expr: string) => string): {
  session: CdpSession;
  calls: string[];
} {
  const calls: string[] = [];
  const session: CdpSession = {
    async send<T = unknown>(method: string): Promise<T> {
      calls.push(method);
      // CSS.enable is the only send() call we make.
      return {} as T;
    },
    async evaluate(expression: string): Promise<string> {
      calls.push('evaluate');
      return evaluateMock(expression);
    },
    close(): void {
      /* noop */
    },
  };
  return { session, calls };
}

// ---------------------------------------------------------------------------
// listStyleSheets
// ---------------------------------------------------------------------------

describe('listStyleSheets', () => {
  it('calls CSS.enable then evaluate', async () => {
    const { session, calls } = makeSession(() => '[]');
    await listStyleSheets(session);
    expect(calls).toContain('CSS.enable');
    expect(calls).toContain('evaluate');
  });

  it('parses a JSON array of stylesheet metadata', async () => {
    const mockData = JSON.stringify([
      {
        url: 'https://example.com/style.css',
        disabled: false,
        isInline: false,
        sourceURL: 'https://example.com/style.css',
        length: 1024,
        title: '',
      },
      { url: '', disabled: false, isInline: true, sourceURL: '', length: 512, title: '' },
    ]);
    const { session } = makeSession(() => mockData);

    const result = await listStyleSheets(session);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      styleSheetId: 'sheet-index-0',
      url: 'https://example.com/style.css',
      isInline: false,
      length: '1024',
      label: 'style.css',
    });
    expect(result[1]).toMatchObject({
      styleSheetId: 'sheet-index-1',
      url: '',
      isInline: true,
      length: '512',
      label: '(inline)',
    });
  });

  it('handles CORS-blocked sheets (length: -1 → "unknown")', async () => {
    const mockData = JSON.stringify([
      {
        url: '',
        disabled: false,
        isInline: false,
        sourceURL: '',
        length: -1,
        title: 'CORS-blocked',
      },
    ]);
    const { session } = makeSession(() => mockData);

    const result = await listStyleSheets(session);

    expect(result).toHaveLength(1);
    expect(result[0].length).toBe('unknown');
  });

  it('derives label from URL basename (strips query string)', async () => {
    const mockData = JSON.stringify([
      {
        url: 'https://cdn.test.com/assets/main.css?v=abc123',
        disabled: false,
        isInline: false,
        sourceURL: 'https://cdn.test.com/assets/main.css?v=abc123',
        length: 2048,
        title: '',
      },
    ]);
    const { session } = makeSession(() => mockData);

    const result = await listStyleSheets(session);

    expect(result[0].label).toBe('main.css');
  });

  it('returns empty array on JSON.parse failure', async () => {
    const { session } = makeSession(() => 'not valid json');

    const result = await listStyleSheets(session);

    expect(result).toEqual([]);
  });

  it('continues even when CSS.enable throws', async () => {
    const { session } = makeSession(() => '[]');
    // Override send to throw for CSS.enable.
    session.send = (async (method: string) => {
      if (method === 'CSS.enable') throw new Error('session closed');
      return {};
    }) as CdpSession['send'];

    const result = await listStyleSheets(session);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getStyleSheetText
// ---------------------------------------------------------------------------

describe('getStyleSheetText', () => {
  it('returns empty string for invalid id format', async () => {
    const { session, calls } = makeSession(() => {
      throw new Error('should not be called');
    });

    const result = await getStyleSheetText(session, 'invalid-id');

    expect(result).toBe('');
    expect(calls).not.toContain('evaluate');
  });

  it('returns empty string for non-numeric index', async () => {
    const { session, calls } = makeSession(() => {
      throw new Error('should not be called');
    });

    const result = await getStyleSheetText(session, 'sheet-index-abc');

    expect(result).toBe('');
    expect(calls).not.toContain('evaluate');
  });

  it('reconstructs CSS text from cssRules', async () => {
    const mockText = '.foo { color: red; }\n.bar { display: none; }';
    const { session, calls } = makeSession(() => mockText);

    const result = await getStyleSheetText(session, 'sheet-index-0');

    expect(result).toBe(mockText);
    expect(calls).toContain('evaluate');
  });

  it('returns empty string when evaluate throws (CORS-blocked sheet)', async () => {
    const { session } = makeSession(() => {
      throw new Error('cssRules access denied');
    });

    const result = await getStyleSheetText(session, 'sheet-index-2');

    expect(result).toBe('');
  });

  it('returns empty string when evaluate returns "null"', async () => {
    const { session } = makeSession(() => 'null');

    const result = await getStyleSheetText(session, 'sheet-index-0');

    expect(result).toBe('');
  });

  it('uses the correct index in the evaluate expression', async () => {
    let capturedExpr = '';
    const { session } = makeSession((expr) => {
      capturedExpr = expr;
      return '';
    });

    await getStyleSheetText(session, 'sheet-index-5');

    expect(capturedExpr).toContain('document.styleSheets[5]');
  });
});
