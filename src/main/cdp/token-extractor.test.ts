// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';
import { normalizeColor, TokenExtractor } from './token-extractor';

// ---------------------------------------------------------------------------
// Test harness: a minimal mock session that returns a canned JSON string
// from evaluate() so we can focus on the token-extraction logic without
// standing up a real CDP connection.
// ---------------------------------------------------------------------------

interface MockSession {
  evaluate: { (...args: unknown[]): unknown; mock: { calls: unknown[][] } };
}

function createMockSession(evaluateResult: string | null): MockSession {
  const mockFn = vi.fn().mockResolvedValue(evaluateResult);
  return {
    evaluate: mockFn as unknown as MockSession['evaluate'],
  };
}

// ---------------------------------------------------------------------------
// Fixture data — mimics what the page-side sampling script would produce
// for a small 3-element DOM. Designed to exercise every token category.
// ---------------------------------------------------------------------------

// Keys use camelCase to match what the page-side sampling script produces
// (the script maps CSS kebab-case property names to camelCase object keys).
const FIXTURE_ELEMENTS = [
  {
    tag: 'div',
    colors: {
      color: 'rgb(255, 69, 58)',
      backgroundColor: '#141418',
      borderTopColor: '#FF453A',
      outlineColor: 'rgb(255, 69, 58)',
    },
    shadows: {
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    },
    radii: {
      borderTopLeftRadius: '4px',
      borderTopRightRadius: '4px',
    },
    fonts: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontSize: '14px',
      fontWeight: '400',
    },
    spacings: {
      paddingTop: '16px',
      paddingLeft: '16px',
      marginTop: '8px',
      gap: '12px',
    },
  },
  {
    tag: 'span',
    colors: {
      color: '#E30613',
      backgroundColor: '#141418',
      borderBottomColor: '#FF453A',
    },
    shadows: {},
    radii: {
      borderTopLeftRadius: '4px',
      borderBottomLeftRadius: '2px',
    },
    fonts: {
      fontFamily: '"Space Grotesk", sans-serif',
      fontSize: '12px',
      fontWeight: '500',
    },
    spacings: {
      paddingTop: '8px',
      marginTop: '8px',
    },
  },
  {
    tag: 'button',
    colors: {
      color: '#FFFFFF',
      backgroundColor: 'rgb(255, 69, 58)',
      columnRuleColor: 'hsl(0, 100%, 50%)',
    },
    shadows: {
      textShadow: '0 1px 2px rgba(0,0,0,0.2)',
    },
    radii: {
      borderTopLeftRadius: '4px',
      borderTopRightRadius: '4px',
    },
    fonts: {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '14px',
      fontWeight: '400',
    },
    spacings: {
      paddingTop: '16px',
      paddingLeft: '16px',
      gap: '12px',
    },
  },
];

const FIXTURE_JSON = JSON.stringify(FIXTURE_ELEMENTS);

// ---------------------------------------------------------------------------
// normalizeColor unit tests
// ---------------------------------------------------------------------------

describe('normalizeColor', () => {
  it('normalizes 6-digit hex to uppercase', () => {
    expect(normalizeColor('#ff453a')).toBe('#FF453A');
    expect(normalizeColor('#E30613')).toBe('#E30613');
  });

  it('normalizes 3-digit hex to expanded uppercase', () => {
    expect(normalizeColor('#fff')).toBe('#FFFFFF');
    expect(normalizeColor('#000')).toBe('#000000');
  });

  it('normalizes rgb()', () => {
    expect(normalizeColor('rgb(255, 69, 58)')).toBe('#FF453A');
    expect(normalizeColor('rgb(0, 0, 0)')).toBe('#000000');
    expect(normalizeColor('rgb(255, 255, 255)')).toBe('#FFFFFF');
  });

  it('normalizes rgba() with non-trivial alpha', () => {
    expect(normalizeColor('rgba(255, 69, 58, 0.8)')).toBe('#FF453A');
    expect(normalizeColor('rgba(0, 128, 255, 0.5)')).toBe('#0080FF');
  });

  it('returns null for fully-transparent rgba()', () => {
    expect(normalizeColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(normalizeColor('rgba(255, 69, 58, 0)')).toBeNull();
  });

  it('normalizes hsl()', () => {
    // hsl(0, 100%, 50%) = pure red = #FF0000
    expect(normalizeColor('hsl(0, 100%, 50%)')).toBe('#FF0000');
    // hsl(120, 100%, 50%) = pure green = #00FF00
    expect(normalizeColor('hsl(120, 100%, 50%)')).toBe('#00FF00');
    // hsl(240, 100%, 50%) = pure blue = #0000FF
    expect(normalizeColor('hsl(240, 100%, 50%)')).toBe('#0000FF');
  });

  it('normalizes hsla() with non-trivial alpha', () => {
    expect(normalizeColor('hsla(0, 100%, 50%, 0.9)')).toBe('#FF0000');
  });

  it('returns null for fully-transparent hsla()', () => {
    expect(normalizeColor('hsla(0, 100%, 50%, 0)')).toBeNull();
  });

  it('normalizes named colors', () => {
    expect(normalizeColor('white')).toBe('#FFFFFF');
    expect(normalizeColor('black')).toBe('#000000');
    expect(normalizeColor('red')).toBe('#FF0000');
    expect(normalizeColor('blue')).toBe('#0000FF');
    expect(normalizeColor('cyan')).toBe('#00FFFF');
  });

  it('returns null for transparent / none / empty', () => {
    expect(normalizeColor('transparent')).toBeNull();
    expect(normalizeColor('none')).toBeNull();
    expect(normalizeColor('initial')).toBeNull();
    expect(normalizeColor('inherit')).toBeNull();
    expect(normalizeColor('currentcolor')).toBeNull();
    expect(normalizeColor('')).toBeNull();
  });

  it('extracts the first embedded color from a compound value (shadow / gradient)', () => {
    expect(normalizeColor('0 2px 8px rgba(0, 0, 0, 0.3)')).toBe('#000000');
    expect(normalizeColor('linear-gradient(135deg, #FF453A, #E30613)')).toBe('#FF453A');
  });

  it('returns null for unparseable values', () => {
    expect(normalizeColor('var(--my-color)')).toBeNull();
    expect(normalizeColor('color-mix(in srgb, red 50%, blue)')).toBeNull();
    expect(normalizeColor('3px solid')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TokenExtractor.sample() integration tests
// ---------------------------------------------------------------------------

describe('TokenExtractor.sample', () => {
  let session: ReturnType<typeof createMockSession>;
  let extractor: TokenExtractor;

  beforeEach(() => {
    session = createMockSession(FIXTURE_JSON);
    extractor = new TokenExtractor(session as unknown as Pick<CdpSession, 'evaluate'>, 'workbuddy');
  });

  it('returns a well-formed ExtractedTokens object', async () => {
    const result = await extractor.sample();
    expect(result.agentId).toBe('workbuddy');
    expect(typeof result.extractedAt).toBe('string');
    expect(() => new Date(result.extractedAt)).not.toThrow();
    expect(Array.isArray(result.colors)).toBe(true);
    expect(Array.isArray(result.fonts)).toBe(true);
    expect(Array.isArray(result.spacings)).toBe(true);
    expect(Array.isArray(result.shadows)).toBe(true);
    expect(Array.isArray(result.radii)).toBe(true);
  });

  it('calls session.evaluate once with the sampling script', async () => {
    await extractor.sample();
    expect(session.evaluate).toHaveBeenCalledTimes(1);
    const callArg = session.evaluate.mock.calls[0][0] as string;
    expect(callArg).toContain('document.querySelectorAll');
    expect(callArg).toContain('getComputedStyle');
  });

  it('respects the maxNodes option', async () => {
    await extractor.sample({ maxNodes: 5 });
    const callArg = session.evaluate.mock.calls[0][0] as string;
    expect(callArg).toContain('(5)');
  });

  describe('color clustering', () => {
    it('normalizes rgb and hex with the same value into a single bucket', async () => {
      const result = await extractor.sample();
      // rgb(255, 69, 58) + #FF453A + outline rgb(255, 69, 58) + border #FF453A + bg rgb(255, 69, 58) = 5 occurrences
      const accent = result.colors.find((c) => c.hex === '#FF453A');
      expect(accent).toBeDefined();
      expect(accent!.frequency).toBeGreaterThanOrEqual(5);
      expect(accent!.contexts).toContain('color');
      expect(accent!.contexts).toContain('border-top-color');
      expect(accent!.contexts).toContain('background-color');
    });

    it('recognizes hsl(0, 100%, 50%) as the same hue family as #FF453A / #E30613', async () => {
      const result = await extractor.sample();
      // hsl(0,100%,50%) is pure red (#FF0000). #E30613 is a slightly different
      // red. They should be separate buckets but both present.
      const pure = result.colors.find((c) => c.hex === '#FF0000');
      expect(pure).toBeDefined();
      expect(pure!.frequency).toBe(1); // only columnRuleColor
    });

    it('sorts colors by frequency descending', async () => {
      const result = await extractor.sample();
      for (let i = 1; i < result.colors.length; i++) {
        expect(result.colors[i - 1].frequency).toBeGreaterThanOrEqual(result.colors[i].frequency);
      }
    });

    it('includes the background color as a high-frequency token', async () => {
      const result = await extractor.sample();
      const bg = result.colors.find((c) => c.hex === '#141418');
      expect(bg).toBeDefined();
      // backgroundColor appears on div and span = at least 2
      expect(bg!.frequency).toBeGreaterThanOrEqual(2);
    });
  });

  describe('font classification', () => {
    it('classifies font-family by frequency with distinct sizes', async () => {
      const result = await extractor.sample();
      const spaceGrotesk = result.fonts.find((f) => f.family === 'Space Grotesk');
      expect(spaceGrotesk).toBeDefined();
      expect(spaceGrotesk!.frequency).toBe(2); // div + span
      expect(spaceGrotesk!.sizes).toContain('14px');
      expect(spaceGrotesk!.sizes).toContain('12px');
    });

    it('quotes are stripped from font family names', async () => {
      const result = await extractor.sample();
      const mono = result.fonts.find((f) => f.family === 'IBM Plex Mono');
      expect(mono).toBeDefined();
      expect(mono!.frequency).toBe(1); // only button
    });
  });

  describe('spacing classification', () => {
    it('ranks spacing values by frequency', async () => {
      const result = await extractor.sample();
      // padding-top: 16px appears on div + button = 2; padding-left: 16px also 2
      const top16 = result.spacings.find((s) => s.value === '16px');
      expect(top16).toBeDefined();
      expect(top16!.frequency).toBeGreaterThanOrEqual(2);
    });

    it('excludes zero and auto spacings', async () => {
      const result = await extractor.sample();
      const zeros = result.spacings.filter((s) => s.value === '0px' || s.value === 'auto');
      expect(zeros).toHaveLength(0);
    });
  });

  describe('shadow and radius collection', () => {
    it('collects deduplicated shadow strings', async () => {
      const result = await extractor.sample();
      expect(result.shadows).toContain('0 2px 8px rgba(0, 0, 0, 0.3)');
      expect(result.shadows).toContain('0 1px 2px rgba(0,0,0,0.2)');
    });

    it('collects deduplicated radius strings', async () => {
      const result = await extractor.sample();
      expect(result.radii).toContain('4px');
      expect(result.radii).toContain('2px');
      // No duplicates
      const unique = new Set(result.radii);
      expect(unique.size).toBe(result.radii.length);
    });
  });
});

// ---------------------------------------------------------------------------
// Edge-case and robustness tests
// ---------------------------------------------------------------------------

describe('TokenExtractor — edge cases', () => {
  it('returns empty arrays when evaluate returns null (page not ready)', async () => {
    const session = createMockSession(null);
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'zcode',
    );
    const result = await extractor.sample();
    expect(result.colors).toEqual([]);
    expect(result.fonts).toEqual([]);
    expect(result.spacings).toEqual([]);
    expect(result.shadows).toEqual([]);
    expect(result.radii).toEqual([]);
    expect(result.agentId).toBe('zcode');
  });

  it('returns empty arrays when evaluate returns the string "null"', async () => {
    const session = createMockSession('null');
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'doubao',
    );
    const result = await extractor.sample();
    expect(result.colors).toEqual([]);
    expect(result.fonts).toEqual([]);
  });

  it('returns empty arrays when evaluate throws', async () => {
    const session = {
      evaluate: vi.fn().mockRejectedValue(new Error('page gone')),
    };
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'traework',
    );
    const result = await extractor.sample();
    expect(result.colors).toEqual([]);
    expect(result.spacings).toEqual([]);
  });

  it('returns empty arrays when evaluate returns malformed JSON', async () => {
    const session = createMockSession('{not valid json');
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'codex',
    );
    const result = await extractor.sample();
    expect(result.colors).toEqual([]);
  });

  it('returns empty arrays when evaluate returns a non-array JSON', async () => {
    const session = createMockSession('{"oops": true}');
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'qoderwork',
    );
    const result = await extractor.sample();
    expect(result.colors).toEqual([]);
  });

  it('handles an empty element array gracefully', async () => {
    const session = createMockSession('[]');
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'workbuddy',
    );
    const result = await extractor.sample();
    expect(result.colors).toEqual([]);
    expect(result.fonts).toEqual([]);
    expect(result.spacings).toEqual([]);
    expect(result.shadows).toEqual([]);
    expect(result.radii).toEqual([]);
  });

  it('samples only up to maxNodes (does not process more than requested)', async () => {
    // 10 elements for a sample of maxNodes=3 — verify the script encodes the cap
    // (the page-side script is what enforces this; here we verify evaluate is called
    // with the correct bound).
    const manyElements = Array.from({ length: 10 }, () => ({
      tag: 'div',
      colors: { backgroundColor: '#AABBCC' },
      shadows: {},
      radii: {},
      fonts: {},
      spacings: {},
    }));
    const session = createMockSession(JSON.stringify(manyElements));
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'doubao',
    );
    await extractor.sample({ maxNodes: 3 });
    const callArg = session.evaluate.mock.calls[0][0] as string;
    // The IIFE ends with "(${maxNodes})" — e.g. "(3)"
    expect(callArg).toContain('(3)');
  });

  it('tracks CSS contexts per color across multiple properties', async () => {
    // rgb(255,69,58) on a single element used as color + background-color + border-top-color
    const singleEl = [
      {
        tag: 'div',
        colors: {
          color: 'rgb(255, 69, 58)',
          backgroundColor: '#FF453A',
          borderTopColor: 'rgb(255,69,58)',
        },
        shadows: {},
        radii: {},
        fonts: {},
        spacings: {},
      },
    ];
    const session = createMockSession(JSON.stringify(singleEl));
    const extractor = new TokenExtractor(
      session as unknown as Pick<CdpSession, 'evaluate'>,
      'workbuddy',
    );
    const result = await extractor.sample();
    const accent = result.colors.find((c) => c.hex === '#FF453A');
    expect(accent).toBeDefined();
    expect(accent!.frequency).toBe(3); // color + background-color + border-top-color
    expect(accent!.contexts).toContain('color');
    expect(accent!.contexts).toContain('background-color');
    expect(accent!.contexts).toContain('border-top-color');
  });
});
