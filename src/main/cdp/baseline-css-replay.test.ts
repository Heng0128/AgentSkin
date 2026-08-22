// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { CapturedStyleSheet } from './baseline-css-capture';
import {
  buildReplayCss,
  replayableComponents,
  replayBaseline,
  stopReplay,
} from './baseline-css-replay';
import type { CdpSession } from './cdp-client';

function sheet(
  id: string,
  firstMatchedFor: string,
  cssText: string,
  selectors: string[] | null = null,
): CapturedStyleSheet {
  return {
    styleSheetId: id,
    firstMatchedFor,
    cssText,
    matchedSelectors: selectors ?? [firstMatchedFor],
  };
}

describe('buildReplayCss (pure)', () => {
  it('concatenates stylesheets in original order', () => {
    const capture = {
      stylesheets: [
        sheet('a', '.side', 'A{}'),
        sheet('b', '.input', 'B{}'),
        sheet('c', '.chat', 'C{}'),
      ],
    };
    expect(buildReplayCss(capture)).toBe('A{}\nB{}\nC{}');
  });

  it('skips empty / missing cssText', () => {
    const capture = { stylesheets: [sheet('a', 'x', 'A{}'), sheet('b', 'x', '')] };
    expect(buildReplayCss(capture)).toBe('A{}');
  });

  it('filters by onlyFor (component), keeping full cssText of matched sheets', () => {
    const capture = {
      stylesheets: [
        sheet('a', '.side', ':root{--x:1}\n.side{width:10px}'),
        sheet('b', '.input', '.input{width:20px}'),
      ],
    };
    expect(buildReplayCss(capture, { onlyFor: '.side' })).toBe(':root{--x:1}\n.side{width:10px}');
  });

  it('onlyFor also matches via matchedSelectors', () => {
    const capture = {
      stylesheets: [sheet('a', '.side', 'S{}', ['.side', '.alt-root'])],
    };
    expect(buildReplayCss(capture, { onlyFor: '.alt-root' })).toBe('S{}');
  });
});

describe('replayableComponents', () => {
  it('collects unique firstMatchedFor and matchedSelectors', () => {
    const capture = {
      stylesheets: [
        sheet('a', '.side', 'A{}', ['.side']),
        sheet('b', '.side', 'B{}', ['.side']),
        sheet('c', '.input', 'C{}', ['.input', '.combo']),
      ],
    };
    const comps = replayableComponents(capture);
    expect(comps.sort()).toEqual(['.combo', '.input', '.side']);
  });
});

describe('replayBaseline / stopReplay (mock CDP)', () => {
  function makeSession(): {
    session: CdpSession;
    evals: string[];
    adopted: string[];
    clears: string[];
  } {
    const evals: string[] = [];
    const adopted: string[] = [];
    const clears: string[] = [];
    const session: CdpSession = {
      send: async <T = unknown>(): Promise<T> => ({}) as T,
      evaluate: async (expression: string): Promise<string> => {
        evals.push(expression);
        // 回注表达式含 `new CSSStyleSheet()`；清理表达式含 `clearInterval`
        if (expression.includes('new CSSStyleSheet()')) adopted.push(expression);
        if (expression.includes('clearInterval')) clears.push(expression);
        return 'ok:1';
      },
      close: () => {},
    };
    return { session, evals, adopted, clears };
  }

  it('clears engine injection then adopts replay css', async () => {
    const { session, evals, adopted, clears } = makeSession();
    const capture = { stylesheets: [sheet('a', 'x', 'A{}')] };
    const ok = await replayBaseline(session, capture);
    expect(ok).toBe(true);
    // 一次清理 + 一次注入
    expect(clears.length).toBe(1);
    expect(adopted.length).toBe(1);
    // 清理表达式出现在注入之前
    const clearIdx = evals.findIndex((e) => e.includes('clearInterval'));
    const adoptIdx = evals.findIndex((e) => e.includes('new CSSStyleSheet()'));
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(adoptIdx).toBeGreaterThan(clearIdx);
  });

  it('returns false and does NOT adopt when replay css is empty', async () => {
    const { session, adopted } = makeSession();
    const capture = { stylesheets: [sheet('a', 'x', '')] };
    const ok = await replayBaseline(session, capture);
    expect(ok).toBe(false);
    expect(adopted).toHaveLength(0);
  });

  it('stopReplay clears engine injection', async () => {
    const { session, clears } = makeSession();
    await stopReplay(session);
    expect(clears.length).toBeGreaterThanOrEqual(1);
  });
});
