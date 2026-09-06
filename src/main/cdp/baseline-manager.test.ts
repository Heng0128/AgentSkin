// SPDX-License-Identifier: MPL-2.0

/**
 * baseline-capture.ts merged unit tests.
 *
 * Combines the test suites from:
 *   - baseline-css-capture.test.ts
 *   - baseline-css-replay.test.ts
 *   - baseline-validator.test.ts
 *   - baseline-gate.test.ts
 *   - apply-baseline.test.ts
 */

import { describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../shared/types';
import {
  APPLY_BASELINE_LRU_CAPACITY,
  APPLY_BASELINE_TTL_MS,
  ApplyBaselineCache,
  assessFidelity,
  type BaselineCssCapture,
  type BaselineProbe,
  type BaselineSnapshot,
  buildReplayCss,
  type CapturedStyleSheet,
  captureBaselineCss,
  definesVar,
  extractVarDependencies,
  findStylesheetDefiningVar,
  hexToRgb,
  normalizedColorDistance,
  probeNativeBaseline,
  replayableComponents,
  replayBaseline,
  stopReplay,
  validateBaselineCss,
} from './baseline-capture';
import type { CdpSession } from './cdp-client';

// ===========================================================================
// baseline-css-capture tests
// ===========================================================================

function makeCaptureSession(
  docs: {
    matched?: Record<string, unknown[]>;
    texts?: Record<string, string>;
    queryResult?: (selector: string) => number | null;
  } = {},
): { session: CdpSession; calls: string[] } {
  const calls: string[] = [];
  const session: CdpSession = {
    async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push(method);
      switch (method) {
        case 'DOM.enable':
        case 'CSS.enable':
          return {} as T;
        case 'Debugger.setJavaScriptEnabled':
          return {} as T;
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } } as T;
        case 'DOM.querySelector': {
          const selector = String(params.selector ?? '');
          const nodeId = docs.queryResult?.(selector) ?? (selector === ':root' ? 99 : 2);
          return { nodeId } as T;
        }
        case 'CSS.getMatchedStylesForNode': {
          const nodeId = Number(params.nodeId);
          return { matchedCSSRules: docs.matched?.[nodeId] ?? [] } as T;
        }
        case 'CSS.getStyleSheetText': {
          const id = String(params.styleSheetId);
          return { text: docs.texts?.[id] ?? null } as T;
        }
        default:
          return {} as T;
      }
    },
    async evaluate(): Promise<string> {
      return 'null';
    },
    close(): void {
      /* noop */
    },
  };
  return { session, calls };
}

function rule(styleSheetId: string, origin = 'regular'): unknown {
  return { rule: { styleSheetId, origin } };
}

describe('baseline-css-capture pure helpers', () => {
  it('extracts var() custom-property names', () => {
    const css = `:root { --p: #fff; color: var(--text-a); background: var(--text-a, red) var(--b); }`;
    expect(extractVarDependencies(css)).toEqual(expect.arrayContaining(['--text-a', '--b']));
    const single = extractVarDependencies('a{color:var(--x)} b{color:var(--x)}');
    expect(single).toEqual(['--x']);
  });

  it('detects var definitions (definesVar)', () => {
    expect(definesVar(':root{--brand:#0ff;} *{color:var(--brand)}', '--brand')).toBe(true);
    expect(definesVar(':root{--brand:#0ff;}', '--missing')).toBe(false);
    expect(definesVar('a{color:red}', '--x')).toBe(false);
  });

  it('findStylesheetDefiningVar locates the defining sheet', () => {
    const sheets = [
      {
        styleSheetId: 'a',
        firstMatchedFor: 'x',
        cssText: '.c{color:var(--p)}',
        matchedSelectors: ['.c'],
      },
      {
        styleSheetId: 'b',
        firstMatchedFor: 'x',
        cssText: ':root{--p:#000}',
        matchedSelectors: [':root'],
      },
    ];
    expect(findStylesheetDefiningVar(sheets, '--p')?.styleSheetId).toBe('b');
    expect(findStylesheetDefiningVar(sheets, '--nope')).toBeNull();
  });
});

describe('captureBaselineCss (mock CDP)', () => {
  it('collects only regular-origin stylesheets & dedupes by id', async () => {
    const { session } = makeCaptureSession({
      matched: {
        2: [rule('sheet-main'), rule('sheet-main'), rule('sheet-ua', 'user-agent')],
      },
      texts: { 'sheet-main': ':root{--bg:#000} .panel{background:var(--bg)}' },
    });
    const cap = await captureBaselineCss(session, 'traework', {
      componentSelectors: ['.panel-container'],
    });
    expect(cap.stylesheets).toHaveLength(1);
    expect(cap.stylesheets[0].styleSheetId).toBe('sheet-main');
    expect(cap.stylesheets[0].cssText).toContain('--bg');
    expect(cap.stylesheets.map((s) => s.styleSheetId)).not.toContain('sheet-ua');
    expect(cap.complete).toBe(true);
    expect(cap.jsFrozen).toBe(true);
    expect(cap.varDependencies).toContain('--bg');
  });

  it('does NOT freeze JS when freezeJs=false', async () => {
    const { calls } = makeCaptureSession({ texts: {} });
    await captureBaselineCss(makeCaptureSession({ texts: {} }).session, 'zcode', {
      freezeJs: false,
    });
    expect(calls).not.toContain('Debugger.setJavaScriptEnabled');
  });

  it('marks jsFrozen=false and degrades gracefully when Debugger freeze throws', async () => {
    const { session } = makeCaptureSession({ texts: {} });
    const throwing: CdpSession = {
      send: async (method: string) => {
        if (method === 'Debugger.setJavaScriptEnabled') throw new Error('freeze fail');
        return session.send(method);
      },
      evaluate: session.evaluate,
      close: () => {},
    };
    const cap = await captureBaselineCss(throwing, 'traework');
    expect(cap.jsFrozen).toBe(false);
    expect(cap.stylesheets).toBeDefined();
  });

  it('marks complete=false when a hit stylesheet text cannot be fetched', async () => {
    const { session } = makeCaptureSession({
      matched: { 2: [rule('sheet-missing')] },
      texts: {},
    });
    const cap = await captureBaselineCss(session, 'doubao', {
      componentSelectors: ['#root'],
    });
    expect(cap.complete).toBe(false);
    expect(cap.stylesheets).toHaveLength(0);
  });

  it('returns empty (not throw) when getDocument yields no root', async () => {
    const session: CdpSession = {
      send: async <T = unknown>(method: string): Promise<T> => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 0 } } as T;
        return {} as T;
      },
      evaluate: async () => 'null',
      close: () => {},
    };
    const cap = await captureBaselineCss(session, 'codex');
    expect(cap.stylesheets).toHaveLength(0);
  });

  it('uses :root by default and dedupes var deps from repeated sheets', async () => {
    const { session, calls } = makeCaptureSession({
      matched: { 99: [rule('root-sheet')] },
      texts: { 'root-sheet': ':root{--a:#1;--b:#2} x{color:var(--a) var(--b) var(--a)}' },
    });
    const cap = await captureBaselineCss(session, 'workbuddy');
    expect(calls).toContain('CSS.getStyleSheetText');
    expect(cap.stylesheets).toHaveLength(1);
    expect(cap.varDependencies.filter((v) => v === '--a')).toHaveLength(1);
    expect(cap.varDependencies).toContain('--b');
  });
});

// ===========================================================================
// baseline-css-replay tests
// ===========================================================================

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
    expect(clears.length).toBe(1);
    expect(adopted.length).toBe(1);
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

// ===========================================================================
// baseline-validator tests
// ===========================================================================

function probe(p: Partial<BaselineProbe>): BaselineProbe {
  return {
    rootBg: '#000000',
    rootColor: '#ffffff',
    rootOverflowHidden: true,
    adoptedSheetCount: 0,
    carrierPresent: true,
    ...p,
  };
}

describe('hexToRgb', () => {
  it('parses short and long hex', () => {
    expect(hexToRgb('#0af')).toEqual({ r: 0, g: 170, b: 255 });
    expect(hexToRgb('#112233')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
    expect(hexToRgb('112233')).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
    expect(hexToRgb('nope')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });
});

describe('normalizedColorDistance', () => {
  it('is 0 for identical colors', () => {
    expect(normalizedColorDistance('#ff0000', '#ff0000')).toBeCloseTo(0);
  });
  it('is 1 for opposite extremes', () => {
    expect(normalizedColorDistance('#000000', '#ffffff')).toBeCloseTo(1);
  });
  it('scales uniformly for mid colors', () => {
    const expected = Math.sqrt((128 * 128) / (3 * 255 * 255));
    expect(normalizedColorDistance('#000000', '#800000')).toBeCloseTo(expected, 5);
  });
  it('parses rgb() strings', () => {
    expect(normalizedColorDistance('rgb(0,0,0)', 'rgb(255,255,255)')).toBeCloseTo(1);
  });
  it('unparsable returns 1 (conservative)', () => {
    expect(normalizedColorDistance('unset', '#000000')).toBe(1);
  });
});

describe('assessFidelity', () => {
  it('passes when replay matches baseline', () => {
    const v = assessFidelity(probe({}), probe({ adoptedSheetCount: 1 }));
    expect(v.pass).toBe(true);
    expect(v.degraded).toBe(false);
    expect(v.matchRatio).toBe(1);
  });

  it('degrades when root bg color drifts beyond tolerance', () => {
    const v = assessFidelity(
      probe({ rootBg: '#000000' }),
      probe({ rootBg: '#ffffff', adoptedSheetCount: 1 }),
    );
    expect(v.degraded).toBe(true);
    expect(v.dimensions.find((d) => d.key === 'rootBg')?.pass).toBe(false);
  });

  it('degrades when carrier node is lost after replay', () => {
    const v = assessFidelity(
      probe({ carrierPresent: true }),
      probe({ carrierPresent: false, adoptedSheetCount: 1 }),
    );
    expect(v.degraded).toBe(true);
  });

  it('degrades when adoptedSheetCount is 0 (replay not mounted)', () => {
    const v = assessFidelity(probe({}), probe({}));
    expect(v.degraded).toBe(true);
  });

  it('honors minMatchRatio and colorTolerance options', () => {
    const strict = assessFidelity(
      probe({ rootBg: '#000000' }),
      probe({ rootBg: '#050505', adoptedSheetCount: 1 }),
      { colorTolerance: 0.001, minMatchRatio: 1 },
    );
    const diff = normalizedColorDistance('#000000', '#050505');
    expect(diff).toBeGreaterThan(0.01);
    expect(diff).toBeLessThan(0.05);
    expect(strict.degraded).toBe(true);
  });
});

describe('validateBaselineCss (mock CDP)', () => {
  function makeValCapture(): BaselineCssCapture {
    return {
      appId: 'traework',
      url: '',
      stylesheets: [
        {
          styleSheetId: 'a',
          firstMatchedFor: '.side',
          cssText: '.side{}',
          matchedSelectors: ['.side'],
        },
      ],
      varDependencies: [],
      jsFrozen: true,
      complete: true,
      capturedAt: 0,
    };
  }

  function makeValSession(
    opts: { probeResult?: Array<BaselineProbe | string>; throwOnProbe?: number } = {},
  ) {
    let probeCalls = 0;
    const session: CdpSession = {
      send: async <T = unknown>(): Promise<T> => ({}) as T,
      evaluate: async (expression: string): Promise<string> => {
        if (expression.includes('panel-container') && !expression.includes('CSSStyleSheet')) {
          if (opts.throwOnProbe === probeCalls) {
            probeCalls += 1;
            throw new Error('probe boom');
          }
          const idx = probeCalls;
          probeCalls += 1;
          if (opts.probeResult) {
            const r = opts.probeResult[idx];
            if (typeof r === 'string') return r;
            return JSON.stringify(r);
          }
          const r = {
            rootBg: 'rgb(0, 0, 0)',
            rootColor: 'rgb(255, 255, 255)',
            rootOverflowHidden: true,
            adoptedSheetCount: probeCalls >= 2 ? 1 : 0,
            carrierPresent: true,
          } as BaselineProbe;
          return JSON.stringify(r);
        }
        if (expression.includes('CSSStyleSheet')) return 'ok:1';
        if (expression.includes('clearInterval')) return 'ok';
        return 'ok';
      },
      close: () => {},
    };
    return session;
  }

  it('returns pass when replay restores native', async () => {
    const session = makeValSession();
    const v = await validateBaselineCss(session, makeValCapture());
    expect(v.pass).toBe(true);
    expect(v.degraded).toBe(false);
  });

  it('degrades when probe throws', async () => {
    const session = makeValSession({ throwOnProbe: 0 });
    const v = await validateBaselineCss(session, makeValCapture());
    expect(v.degraded).toBe(true);
    expect(v.pass).toBe(false);
  });

  it('degrades when replay reveals drift', async () => {
    const session = makeValSession({
      probeResult: [
        {
          rootBg: 'rgb(0, 0, 0)',
          rootColor: 'rgb(255, 255, 255)',
          rootOverflowHidden: true,
          adoptedSheetCount: 0,
          carrierPresent: true,
        },
        {
          rootBg: 'rgb(255, 255, 255)',
          rootColor: 'rgb(0, 0, 0)',
          rootOverflowHidden: true,
          adoptedSheetCount: 1,
          carrierPresent: true,
        },
      ],
    });
    const v = await validateBaselineCss(session, makeValCapture());
    expect(v.degraded).toBe(true);
  });

  it('probeNativeBaseline parses evaluate output', async () => {
    const session: CdpSession = {
      send: async <T = unknown>(): Promise<T> => ({}) as T,
      evaluate: async () =>
        JSON.stringify({
          rootBg: 'rgb(1, 2, 3)',
          rootColor: 'rgb(4, 5, 6)',
          rootOverflowHidden: false,
          adoptedSheetCount: 0,
          carrierPresent: false,
        }),
      close: () => {},
    };
    const p = await probeNativeBaseline(session);
    expect(p.rootBg).toBe('rgb(1, 2, 3)');
    expect(p.carrierPresent).toBe(false);
    expect(p.adoptedSheetCount).toBe(0);
  });
});

// ===========================================================================
// apply-baseline tests
// ===========================================================================

const APP: AgentId = 'workbuddy';

function snap(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  return {
    appId: APP,
    themeId: 'theme-a',
    url: 'app://main',
    accent: '#3355ff',
    adoptedSheetCount: 1,
    heroBlobActive: false,
    semanticNodeCount: 2500,
    capturedAt: Date.now(),
    ...overrides,
  };
}

describe('ApplyBaselineCache (RFC §4.5)', () => {
  it('returns null on an empty cache', () => {
    const cache = new ApplyBaselineCache();
    expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
  });

  it('returns a stored snapshot keyed by appId+url+themeId', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap());
    expect(cache.get(APP, 'app://main', 'theme-a')).toEqual(
      expect.objectContaining({ themeId: 'theme-a', accent: '#3355ff' }),
    );
  });

  it('does not leak entries across different agents', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap());
    expect(cache.get('traework' as AgentId, 'app://main', 'theme-a')).toBeNull();
  });

  it('differentiates by url — a navigation key is a distinct entry', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ url: 'app://main' }));
    expect(cache.get(APP, 'app://other', 'theme-a')).toBeNull();
  });

  it('differentiates by themeId — a theme switch is a distinct entry', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    expect(cache.get(APP, 'app://main', 'theme-b')).toBeNull();
  });

  it('expires entries after the 60s TTL', () => {
    vi.useFakeTimers();
    try {
      const cache = new ApplyBaselineCache();
      cache.put(snap({ capturedAt: Date.now() }));
      vi.advanceTimersByTime(APPLY_BASELINE_TTL_MS + 1);
      expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the least-recently-used entry when over the LRU(3) capacity', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.put(snap({ themeId: 'theme-b' }));
    cache.put(snap({ themeId: 'theme-c' }));
    cache.get(APP, 'app://main', 'theme-a');
    cache.put(snap({ themeId: 'theme-d' }));

    expect(cache.get(APP, 'app://main', 'theme-a')).not.toBeNull();
    expect(cache.get(APP, 'app://main', 'theme-b')).toBeNull();
    expect(cache.size(APP)).toBe(APPLY_BASELINE_LRU_CAPACITY);
  });

  it('invalidate() clears the whole agent cache when no theme is given', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.put(snap({ themeId: 'theme-b' }));
    cache.invalidate(APP);
    expect(cache.size(APP)).toBe(0);
    expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
  });

  it('invalidate() removes only matching themeId entries otherwise', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.put(snap({ themeId: 'theme-b' }));
    cache.invalidate(APP, 'theme-a');
    expect(cache.get(APP, 'app://main', 'theme-a')).toBeNull();
    expect(cache.get(APP, 'app://main', 'theme-b')).not.toBeNull();
  });

  it('clearAgent() removes all entries for an agent', () => {
    const cache = new ApplyBaselineCache();
    cache.put(snap({ themeId: 'theme-a' }));
    cache.clearAgent(APP);
    expect(cache.size(APP)).toBe(0);
  });
});
