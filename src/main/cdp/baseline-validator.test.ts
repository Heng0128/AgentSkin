// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { BaselineCssCapture } from './baseline-css-capture';
import {
  assessFidelity,
  type BaselineProbe,
  hexToRgb,
  normalizedColorDistance,
  probeNativeBaseline,
  validateBaselineCss,
} from './baseline-validator';
import type { CdpSession } from './cdp-client';

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
    // R:0 vs 128 → diff_r=128; normalized = sqrt(128^2/(3*255^2)) = 128/255/sqrt(3)
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
    // adoptedSheetCount=0 fails despite colors matching
    expect(v.degraded).toBe(true);
  });

  it('honors minMatchRatio and colorTolerance options', () => {
    const strict = assessFidelity(
      probe({ rootBg: '#000000' }),
      probe({ rootBg: '#050505', adoptedSheetCount: 1 }),
      { colorTolerance: 0.001, minMatchRatio: 1 },
    );
    // diff = sqrt(3*(5/255)^2/3) = 5/255/sqrt(3) ≈ 0.0196，确属轻微漂移
    const diff = normalizedColorDistance('#000000', '#050505');
    expect(diff).toBeGreaterThan(0.01);
    expect(diff).toBeLessThan(0.05);
    // 0.001 too strict → bg fails, ratio 4/5 = 0.8 < 1 → degrade
    expect(strict.degraded).toBe(true);
  });
});

describe('validateBaselineCss (mock CDP)', () => {
  function makeCapture(): BaselineCssCapture {
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

  function makeSession(
    opts: { probeResult?: Array<BaselineProbe | string>; throwOnProbe?: number } = {},
  ) {
    let probeCalls = 0;
    const session: CdpSession = {
      send: async <T = unknown>(): Promise<T> => ({}) as T,
      evaluate: async (expression: string): Promise<string> => {
        // 注入/清理表达式返回引擎期望的 'ok' 前缀；探针表达式返回 JSON
        if (expression.includes('panel-container') && !expression.includes('CSSStyleSheet')) {
          // 第 throwOnProbe 次探针调用直接抛错（模拟 CDP 失败）
          if (opts.throwOnProbe === probeCalls) {
            probeCalls += 1;
            throw new Error('probe boom');
          }
          const idx = probeCalls;
          probeCalls += 1;
          // 显式提供的结果按调用次序（0=真值快照，1=实况回注）取用
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
    const session = makeSession();
    const v = await validateBaselineCss(session, makeCapture());
    expect(v.pass).toBe(true);
    expect(v.degraded).toBe(false);
  });

  it('degrades when probe throws', async () => {
    const session = makeSession({ throwOnProbe: 0 });
    const v = await validateBaselineCss(session, makeCapture());
    expect(v.degraded).toBe(true);
    expect(v.pass).toBe(false);
  });

  it('degrades when replay reveals drift', async () => {
    // 真值快照为深色背景；实况回注后变浅色 → 严重色偏，硬门控降级
    const session = makeSession({
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
    const v = await validateBaselineCss(session, makeCapture());
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
