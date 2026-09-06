// SPDX-License-Identifier: MPL-2.0 OR MIT

import { describe, expect, it } from 'vitest';
import {
  normalizeColor,
  validateRuntimeQuality,
  wcagContrastRatio,
} from '../../scripts/lib/runtime-validator.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface CdpConnection {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * Build a mock CDP connection whose `send` routes by the expression content
 * inside `Runtime.evaluate` params.
 */
function createMockCdp(options: {
  contrastSamples?: Array<{ fg: string; bg: string }>;
  overflow?: boolean;
  selectorResults?: Array<{ selector: string; count: number }>;
}): CdpConnection {
  return {
    async send(method: string, params: Record<string, unknown>) {
      if (method === 'Runtime.evaluate') {
        const expr = params.expression as string;
        if (expr.includes('scrollWidth')) {
          return { result: { value: options.overflow ?? false } };
        }
        if (expr.includes('const sels =')) {
          return { result: { value: options.selectorResults ?? [] } };
        }
        if (expr.includes('const nodes = document.querySelectorAll')) {
          return { result: { value: options.contrastSamples ?? [] } };
        }
      }
      return { result: { value: undefined } };
    },
  };
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

describe('wcagContrastRatio', () => {
  it('returns 21.0 for black on white', () => {
    expect(wcagContrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('returns 1.0 for identical colors', () => {
    expect(wcagContrastRatio('#7f7f7f', '#7f7f7f')).toBe(1);
  });

  it('returns a mid-range ratio for gray on white', () => {
    const r = wcagContrastRatio('#949494', '#ffffff');
    expect(r).toBeGreaterThan(2);
    expect(r).toBeLessThan(5);
  });
});

describe('normalizeColor', () => {
  it('expands #rgb to #rrggbb', () => {
    expect(normalizeColor('#f00')).toBe('#ff0000');
  });

  it('normalizes #RRGGBB to lowercase', () => {
    expect(normalizeColor('#FF7A6B')).toBe('#ff7a6b');
  });

  it('parses rgb() to hex', () => {
    expect(normalizeColor('rgb(255, 122, 107)')).toBe('#ff7a6b');
  });

  it('parses rgba() ignoring alpha', () => {
    expect(normalizeColor('rgba(255, 122, 107, 0.5)')).toBe('#ff7a6b');
  });

  it('returns null for invalid string', () => {
    expect(normalizeColor('notacolor')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateRuntimeQuality — happy path
// ---------------------------------------------------------------------------

describe('validateRuntimeQuality', () => {
  it('returns overall "pass" when all checks succeed', async () => {
    const cdp = createMockCdp({
      contrastSamples: [
        { fg: '#000000', bg: '#ffffff' },
        { fg: '#333333', bg: '#f0f0f0' },
      ],
      overflow: false,
      selectorResults: [
        { selector: '#composer', count: 1 },
        { selector: '#sidebar', count: 1 },
      ],
    });
    const result = await validateRuntimeQuality(cdp, ['#composer', '#sidebar']);
    expect(result.overall).toBe('pass');
    expect(result.contrast.passed).toBe(true);
    expect(result.viewport.passed).toBe(true);
    expect(result.component.passed).toBe(true);
  });

  it('returns overall "fail" when contrast is insufficient', async () => {
    const cdp = createMockCdp({
      contrastSamples: [
        { fg: '#949494', bg: '#ffffff' }, // ratio ≈ 2.86 — fails AA
      ],
      overflow: false,
      selectorResults: [{ selector: '#composer', count: 1 }],
    });
    const result = await validateRuntimeQuality(cdp, ['#composer']);
    expect(result.overall).toBe('fail');
    expect(result.contrast.passed).toBe(false);
    expect(result.contrast.failedCount).toBe(1);
  });

  it('returns overall "fail" when horizontal overflow detected', async () => {
    const cdp = createMockCdp({
      contrastSamples: [],
      overflow: true,
      selectorResults: [{ selector: '#composer', count: 1 }],
    });
    const result = await validateRuntimeQuality(cdp, ['#composer']);
    expect(result.overall).toBe('fail');
    expect(result.viewport.passed).toBe(false);
  });

  it('returns overall "fail" when a selector misses', async () => {
    const cdp = createMockCdp({
      contrastSamples: [{ fg: '#000000', bg: '#ffffff' }],
      overflow: false,
      selectorResults: [
        { selector: '#composer', count: 1 },
        { selector: '#nonexistent', count: 0 },
      ],
    });
    const result = await validateRuntimeQuality(cdp, ['#composer', '#nonexistent']);
    expect(result.overall).toBe('fail');
    expect(result.component.passed).toBe(false);
    expect(result.component.selectors.find((s) => s.selector === '#nonexistent')?.matched).toBe(
      false,
    );
  });

  it('reports correct score for partially-passing component check', async () => {
    const cdp = createMockCdp({
      contrastSamples: [],
      overflow: false,
      selectorResults: [
        { selector: '#composer', count: 1 },
        { selector: '#sidebar', count: 1 },
        { selector: '#miss', count: 0 },
      ],
    });
    const result = await validateRuntimeQuality(cdp, ['#composer', '#sidebar', '#miss']);
    expect(result.component.score).toBe(67); // 2/3 ≈ 67
    expect(result.details.componentMiss).toBe(1);
  });
});
