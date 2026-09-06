// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { ComponentProfile } from './native-profile';
import { buildTreatmentCss, classifyAll, classifyComponent } from './treatment-classifier';

function component(
  over: Partial<ComponentProfile> & { quantified?: ComponentProfile['quantified'] },
): ComponentProfile {
  return {
    role: 'other',
    path: '',
    ref: 'div[0]/div[1]::div',
    boxModel: null,
    depth: 1,
    area: 200 * 200,
    areaRatio: 0.15,
    quantified: { background: { r: 30, g: 30, b: 44, a: 1 } },
    hasText: false,
    hasInteractiveDescendant: false,
    descendantCount: 0,
    zIndex: 0,
    ...over,
  } as ComponentProfile;
}

describe('classifyComponent — 四档处置', () => {
  it('keeps small foreground leaves (buttons, badges)', () => {
    const v = classifyComponent(component({ areaRatio: 0.001, hasText: true }));
    expect(v.treatment).toBe('keep');
  });

  it('removes a fullscreen brand layer: opaque, no text, depth 0', () => {
    const v = classifyComponent(
      component({
        depth: 0,
        areaRatio: 0.9,
        hasText: false,
        quantified: { background: { r: 0, g: 0, b: 0, a: 1 } },
      }),
    );
    expect(v.treatment).toBe('remove');
  });

  it('transparentizes a large plain shell WITHOUT text', () => {
    const v = classifyComponent(
      component({
        areaRatio: 0.5,
        hasText: false,
        quantified: { background: { r: 10, g: 10, b: 16, a: 1 } },
      }),
    );
    expect(v.treatment).toBe('transparentize');
  });

  it('keeps elements that already have backdrop-filter', () => {
    const v = classifyComponent(
      component({
        areaRatio: 0.5,
        hasText: true,
        quantified: { background: { r: 30, g: 30, b: 44, a: 0.85 }, blur: 20 },
      }),
    );
    expect(v.treatment).toBe('keep');
    expect(v.evidence.rule).toBe('already-frosted');
  });
});

describe('classifyComponent — GOV-4 文字可读性保护', () => {
  it('NEVER fully transparentizes a text-bearing large container — frost instead', () => {
    // 中央对话面板：大、有底色、承载文本 —— 正是 old punch-through 会全透明
    // 打掉导致文字被吞的场景（GOV-4 回归核心）。
    const v = classifyComponent(
      component({
        role: 'chatlist',
        areaRatio: 0.5,
        hasText: true,
        quantified: {
          background: { r: 13, g: 13, b: 20, a: 1 },
          color: { r: 235, g: 235, b: 245, a: 1 },
        },
      }),
    );
    expect(v.treatment).toBe('frost');
    expect(v.evidence.frost?.opacity).toBeCloseTo(0.65, 2);
    expect(v.evidence.frost?.blurPx).toBe(20);
  });

  it('frosts interactive containers (composer with textarea)', () => {
    const v = classifyComponent(
      component({
        role: 'composer',
        areaRatio: 0.16,
        hasText: true,
        hasInteractiveDescendant: true,
        quantified: { background: { r: 40, g: 40, b: 54, a: 0.9 } },
      }),
    );
    expect(v.treatment).toBe('frost');
  });

  it('deepens opacity when contrast gate fails (dark text, light surface, dark wallpaper)', () => {
    // 亮表面 + 暗文字 + 暗壁纸：低不透明度时合成背景接近暗壁纸，对比不足；
    // 加深 surface 不透明度 → 背景趋近亮表面 → 暗文字对比度回升并达标。
    const v = classifyComponent(
      component({
        role: 'chatlist',
        areaRatio: 0.5,
        hasText: true,
        quantified: {
          background: { r: 235, g: 235, b: 240, a: 1 },
          color: { r: 30, g: 30, b: 40, a: 1 },
        },
      }),
      { effectiveBackground: { r: 30, g: 30, b: 40 }, frostOpacity: 0.1 },
    );
    expect(v.treatment).toBe('frost');
    expect(v.evidence.contrastPass).toBe(true);
    // 从 0.1 自动加深，且不越过上限
    expect(v.evidence.opacityAfterContrastGate!).toBeGreaterThan(0.1);
    expect(v.evidence.opacityAfterContrastGate!).toBeLessThanOrEqual(0.92);
    expect(v.evidence.frost!.opacity).toBe(v.evidence.opacityAfterContrastGate);
  });

  it('keeps high-contrast frosting at baseline opacity', () => {
    // 亮色文字 + 暗壁纸 → 65% 已达标，不加深。
    const v = classifyComponent(
      component({
        role: 'chatlist',
        areaRatio: 0.5,
        hasText: true,
        quantified: {
          background: { r: 30, g: 30, b: 44, a: 1 },
          color: { r: 240, g: 240, b: 250, a: 1 },
        },
      }),
      { effectiveBackground: { r: 20, g: 20, b: 30 } },
    );
    expect(v.evidence.contrastPass).toBe(true);
    expect(v.evidence.opacityAfterContrastGate).toBeCloseTo(0.65, 2);
  });
});

describe('classifyAll + summary', () => {
  it('aggregates treatment counts', () => {
    const result = classifyAll([
      component({
        ref: 'a',
        depth: 0,
        areaRatio: 0.9,
        quantified: { background: { r: 0, g: 0, b: 0, a: 1 } },
      }),
      component({
        ref: 'b',
        areaRatio: 0.5,
        quantified: { background: { r: 1, g: 1, b: 1, a: 1 } },
      }),
      component({ ref: 'c', areaRatio: 0.5, hasText: true }),
      component({ ref: 'd', areaRatio: 0.001 }),
    ]);
    expect(result.summary.remove).toBe(1);
    expect(result.summary.transparentize).toBe(1);
    expect(result.summary.frost).toBe(1);
    expect(result.summary.keep).toBe(1);
  });
});

describe('buildTreatmentCss', () => {
  it('emits transparent and frosted rules with escaped refs', () => {
    const v1 = classifyComponent(
      component({
        ref: 'div[0]/div[1]::div',
        areaRatio: 0.5,
        quantified: { background: { r: 1, g: 1, b: 1, a: 1 } },
      }),
    );
    const v2 = classifyComponent(component({ ref: 'x::div', areaRatio: 0.5, hasText: true }));
    const css = buildTreatmentCss([v1, v2]);
    expect(css).toContain('background: transparent !important');
    expect(css).toContain('backdrop-filter: blur(20px)');
    // ref 中的 `/`、`[`、`]`、`:` 全部转义
    expect(css).toContain('div\\[0\\]\\/div\\[1\\]\\:\\:div');
  });

  it('emits nothing for keep verdicts', () => {
    const v = classifyComponent(component({ areaRatio: 0.001 }));
    expect(buildTreatmentCss([v])).toBe('');
  });
});
