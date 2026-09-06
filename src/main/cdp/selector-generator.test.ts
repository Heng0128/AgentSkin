// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';
import { buildGenerationIife, generateSelector, isUsefulClass } from './selector-utils';

// ---------------------------------------------------------------------------
// Mock CdpSession — controllable stand-in for the real CDP session.
//
// The selector-generator only uses `session.evaluate()`. We mock that method
// directly so tests can simulate the IIFE returning different JSON results
// without needing a full FakeWebSocket.
// ---------------------------------------------------------------------------

function createMockSession(evaluateImpl: (expr: string) => Promise<string>): CdpSession {
  return {
    evaluate: vi.fn(evaluateImpl),
    send: vi.fn(),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 1. generateSelector — strategy outcomes
// ---------------------------------------------------------------------------

describe('generateSelector', () => {
  it('returns id strategy result when IIFE returns an ID selector', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: '#my-button', strategy: 'id', unique: true }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).toEqual({
      selector: '#my-button',
      strategy: 'id',
      unique: true,
    });
  });

  // ---------------------------------------------------------------------

  it('returns class-combination strategy result', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: 'div.header.nav', strategy: 'class-combination', unique: true }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).toEqual({
      selector: 'div.header.nav',
      strategy: 'class-combination',
      unique: true,
    });
  });

  // ---------------------------------------------------------------------

  it('returns attribute strategy result', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: 'input[name="email"]', strategy: 'attribute', unique: true }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).toEqual({
      selector: 'input[name="email"]',
      strategy: 'attribute',
      unique: true,
    });
  });

  // ---------------------------------------------------------------------

  it('returns parent-context strategy result', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({
        selector: '#parent > div:nth-of-type(2)',
        strategy: 'parent-context',
        unique: true,
      }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).toEqual({
      selector: '#parent > div:nth-of-type(2)',
      strategy: 'parent-context',
      unique: true,
    });
  });

  // ---------------------------------------------------------------------

  it('returns position-fallback strategy result with unique=false', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({
        selector: 'body > div:nth-of-type(1) > span:nth-of-type(3)',
        strategy: 'position-fallback',
        unique: false,
      }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).toEqual({
      selector: 'body > div:nth-of-type(1) > span:nth-of-type(3)',
      strategy: 'position-fallback',
      unique: false,
    });
  });

  // ---------------------------------------------------------------------

  it('returns null when IIFE reports target not found', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: null, error: 'target element not found' }),
    );

    const result = await generateSelector(session, '.nonexistent');

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------

  it('returns null when session.evaluate rejects (CDP failure)', async () => {
    const session = createMockSession(async () => {
      throw new Error('CDP WebSocket closed unexpectedly');
    });

    const result = await generateSelector(session, '.target');

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------

  it('returns null when evaluate returns malformed JSON', async () => {
    const session = createMockSession(async () => 'not valid json {{{');

    const result = await generateSelector(session, '.target');

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------

  it('returns null when evaluate returns empty string', async () => {
    const session = createMockSession(async () => '');

    const result = await generateSelector(session, '.target');

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------

  it('defaults strategy to position-fallback when missing from result', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: 'div.foo', unique: true }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).not.toBeNull();
    expect(result?.strategy).toBe('position-fallback');
  });

  // ---------------------------------------------------------------------

  it('defaults unique to false when missing from result', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: 'div.foo', strategy: 'id' }),
    );

    const result = await generateSelector(session, '.target');

    expect(result).not.toBeNull();
    expect(result?.unique).toBe(false);
  });

  // ---------------------------------------------------------------------

  it('calls session.evaluate with the IIFE containing the target selector', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({ selector: '#x', strategy: 'id', unique: true }),
    );

    await generateSelector(session, '.my-target');

    expect(session.evaluate).toHaveBeenCalledTimes(1);
    const expr = (session.evaluate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(expr).toContain('.my-target');
  });

  // ---------------------------------------------------------------------

  it('handles data-testid attribute selector', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({
        selector: 'button[data-testid="submit-btn"]',
        strategy: 'attribute',
        unique: true,
      }),
    );

    const result = await generateSelector(session, '.target');

    expect(result?.strategy).toBe('attribute');
    expect(result?.selector).toBe('button[data-testid="submit-btn"]');
  });

  // ---------------------------------------------------------------------

  it('handles aria-label attribute selector', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({
        selector: 'div[aria-label="Navigation"]',
        strategy: 'attribute',
        unique: true,
      }),
    );

    const result = await generateSelector(session, '.target');

    expect(result?.strategy).toBe('attribute');
    expect(result?.selector).toBe('div[aria-label="Navigation"]');
  });
});

// ---------------------------------------------------------------------------
// 2. isUsefulClass — class name filtering
// ---------------------------------------------------------------------------

describe('isUsefulClass', () => {
  it('returns true for a normal class name', () => {
    expect(isUsefulClass('header')).toBe(true);
  });

  // ---------------------------------------------------------------------

  it('returns false for class names starting with __ (CSS Modules)', () => {
    expect(isUsefulClass('__abc123')).toBe(false);
  });

  // ---------------------------------------------------------------------

  it('returns false for hash-based class names matching the pattern', () => {
    expect(isUsefulClass('abc-1f2d3c')).toBe(false);
  });

  // ---------------------------------------------------------------------

  it('returns false for class names longer than 25 characters', () => {
    expect(isUsefulClass('a'.repeat(26))).toBe(false);
  });

  // ---------------------------------------------------------------------

  it('returns true for class names exactly 25 characters', () => {
    expect(isUsefulClass('a'.repeat(25))).toBe(true);
  });

  // ---------------------------------------------------------------------

  it('returns false for empty class name', () => {
    expect(isUsefulClass('')).toBe(false);
  });

  // ---------------------------------------------------------------------

  it('returns true for class names with special characters', () => {
    expect(isUsefulClass('nav-item')).toBe(true);
    expect(isUsefulClass('btn_primary')).toBe(true);
  });

  // ---------------------------------------------------------------------

  it('returns false for class names with double underscore prefix', () => {
    expect(isUsefulClass('__theme_dark')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. buildGenerationIife — IIFE structure validation
// ---------------------------------------------------------------------------

describe('buildGenerationIife', () => {
  it('produces a string that starts with the IIFE pattern', () => {
    const iife = buildGenerationIife('.target');
    expect(iife.startsWith('(() => {')).toBe(true);
    expect(iife.endsWith('})()')).toBe(true);
  });

  // ---------------------------------------------------------------------

  it('embeds the target selector as a JSON-stringified literal', () => {
    const iife = buildGenerationIife('.my-button');
    expect(iife).toContain('".my-button"');
  });

  // ---------------------------------------------------------------------

  it('contains the testSelector helper function', () => {
    const iife = buildGenerationIife('.target');
    expect(iife).toContain('function testSelector(');
  });

  // ---------------------------------------------------------------------

  it('contains the cssEscape helper function', () => {
    const iife = buildGenerationIife('.target');
    expect(iife).toContain('function cssEscape(');
  });

  // ---------------------------------------------------------------------

  it('contains all 5 strategy markers', () => {
    const iife = buildGenerationIife('.target');
    expect(iife).toContain('id');
    expect(iife).toContain('class-combination');
    expect(iife).toContain('attribute');
    expect(iife).toContain('parent-context');
    expect(iife).toContain('position-fallback');
  });

  // ---------------------------------------------------------------------

  it('contains the class filtering regex', () => {
    const iife = buildGenerationIife('.target');
    expect(iife).toContain('isUsefulClass');
  });

  // ---------------------------------------------------------------------

  it('contains the attribute list for strategy 3', () => {
    const iife = buildGenerationIife('.target');
    expect(iife).toContain('data-testid');
    expect(iife).toContain('aria-label');
  });

  // ---------------------------------------------------------------------

  it('handles selectors with special characters via JSON.stringify', () => {
    const iife = buildGenerationIife('[data-testid="my-btn"]');
    // JSON.stringify will escape the quotes
    expect(iife).toContain('[data-testid=\\"my-btn\\"]');
  });
});
