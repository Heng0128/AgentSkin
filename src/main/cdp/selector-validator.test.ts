// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';
import { probeSelector, validateSelectors } from './selector-validator';

// ---------------------------------------------------------------------------
// Mock CdpSession — controllable stand-in for the real CDP session.
//
// The selector-validator only uses `session.evaluate()`. We mock that method
// directly so tests can simulate hit / miss / invalid / timeout outcomes
// without needing a full FakeWebSocket. This is simpler than the
// cdp-client.test.ts approach because the validator is a pure consumer of
// the CdpSession interface.
// ---------------------------------------------------------------------------

function createMockSession(evaluateImpl: (expr: string) => Promise<string>): CdpSession {
  return {
    evaluate: vi.fn(evaluateImpl),
    send: vi.fn(),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 1. probeSelector — valid selector, hit
// ---------------------------------------------------------------------------

describe('probeSelector', () => {
  it('returns kind=hit with count and bounding box when selector matches', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({
        kind: 'hit',
        count: 3,
        boundingBox: { x: 10, y: 20, width: 100, height: 50 },
      }),
    );

    const result = await probeSelector(session, '.panel-container');

    expect(result).toEqual({
      selector: '.panel-container',
      kind: 'hit',
      count: 3,
      boundingBox: { x: 10, y: 20, width: 100, height: 50 },
    });
  });

  // ---------------------------------------------------------------------

  it('returns kind=miss with count=0 when selector matches nothing', async () => {
    const session = createMockSession(async () => JSON.stringify({ kind: 'miss', count: 0 }));

    const result = await probeSelector(session, '.nonexistent-class');

    expect(result.kind).toBe('miss');
    expect(result.count).toBe(0);
    expect(result.selector).toBe('.nonexistent-class');
    expect(result.boundingBox).toBeUndefined();
  });

  // ---------------------------------------------------------------------

  it('returns kind=invalid with error message when selector syntax is bad', async () => {
    const session = createMockSession(async () =>
      JSON.stringify({
        kind: 'invalid',
        count: 0,
        error: 'SyntaxError: Failed to execute querySelector',
      }),
    );

    const result = await probeSelector(session, '[[invalid');

    expect(result.kind).toBe('invalid');
    expect(result.count).toBe(0);
    expect(result.error).toContain('SyntaxError');
  });

  // ---------------------------------------------------------------------

  it('returns kind=timeout when session.evaluate rejects', async () => {
    // Note: this test is for validateSelectors (which catches the rejection).
    // probeSelector itself propagates the rejection — the caller handles it.
    const session = createMockSession(async () => {
      throw new Error('CDP request timed out: Runtime.evaluate');
    });

    await expect(probeSelector(session, '.any')).rejects.toThrow('CDP request timed out');
  });

  // ---------------------------------------------------------------------

  it('returns hit without bounding box when getBoundingClientRect fails', async () => {
    const session = createMockSession(async () =>
      // The IIFE suppresses bounding-box errors and omits the field.
      JSON.stringify({ kind: 'hit', count: 1 }),
    );

    const result = await probeSelector(session, '#root');

    expect(result.kind).toBe('hit');
    expect(result.count).toBe(1);
    expect(result.boundingBox).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. validateSelectors — batch validation
// ---------------------------------------------------------------------------

describe('validateSelectors', () => {
  it('returns a report with correct summary for mixed results', async () => {
    const selectors = ['.a', '.b', '.c', '.d'];
    const outcomes: Record<string, object> = {
      '.a': { kind: 'hit', count: 1 },
      '.b': { kind: 'miss', count: 0 },
      '.c': { kind: 'invalid', count: 0, error: 'bad' },
      '.d': { kind: 'hit', count: 5, boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
    };

    const session = createMockSession(async (expr) => {
      // Extract the selector from the IIFE — it's JSON.stringify'd inside.
      for (const [sel, outcome] of Object.entries(outcomes)) {
        if (expr.includes(JSON.stringify(sel))) {
          return JSON.stringify(outcome);
        }
      }
      return JSON.stringify({ kind: 'miss', count: 0 });
    });

    const report = await validateSelectors(session, 'traework', selectors);

    expect(report.agentId).toBe('traework');
    expect(report.summary.total).toBe(4);
    expect(report.summary.hit).toBe(2);
    expect(report.summary.miss).toBe(1);
    expect(report.summary.invalid).toBe(1);
    expect(report.summary.timeout).toBe(0);
    expect(report.results).toHaveLength(4);
    expect(report.timestamp).toBeTypeOf('number');
  });

  // ---------------------------------------------------------------------

  it('returns an empty report for an empty selectors array', async () => {
    const session = createMockSession(async () => JSON.stringify({ kind: 'miss', count: 0 }));

    const report = await validateSelectors(session, 'traework', []);

    expect(report.results).toEqual([]);
    expect(report.summary).toEqual({
      total: 0,
      hit: 0,
      miss: 0,
      invalid: 0,
      timeout: 0,
    });
  });

  // ---------------------------------------------------------------------

  it('captures CDP-level failures as timeout results', async () => {
    const session = createMockSession(async () => {
      throw new Error('CDP WebSocket closed unexpectedly');
    });

    const report = await validateSelectors(session, 'traework', ['.a', '.b'], 1);

    expect(report.summary.timeout).toBe(2);
    expect(report.results.every((r) => r.kind === 'timeout')).toBe(true);
  });

  // ---------------------------------------------------------------------

  it('respects concurrency limit — never more than maxConcurrent in-flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const session = createMockSession(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Simulate async work.
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return JSON.stringify({ kind: 'miss', count: 0 });
    });

    const selectors = Array.from({ length: 10 }, (_, i) => `.el-${i}`);
    await validateSelectors(session, 'traework', selectors, 3);

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------

  it('preserves input order regardless of completion order', async () => {
    // Return results with varying delays to simulate out-of-order completion.
    const session = createMockSession(async (expr) => {
      // Extract delay from selector name: .fast resolves immediately,
      // .slow takes 30ms.
      if (expr.includes('slow')) {
        await new Promise((r) => setTimeout(r, 30));
      }
      return JSON.stringify({ kind: 'hit', count: 1 });
    });

    const selectors = ['.slow-1', '.fast-1', '.slow-2', '.fast-2'];
    const report = await validateSelectors(session, 'traework', selectors, 2);

    // Results must be in the same order as input.
    expect(report.results.map((r) => r.selector)).toEqual(selectors);
  });
});
