// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  blendOver,
  classifyAlpha,
  luminanceOf,
  medianCut,
  parseColor,
  toHex,
  wcagContrast,
} from './color-quantize';

describe('parseColor', () => {
  it('parses hex forms', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('parses rgb()/rgba() with commas or spaces', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgb(255 255 255)')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(255, 255, 255, 50%)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });

  it('parses named colors and clamps channels', () => {
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgb(300, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('returns null for unresolvable values', () => {
    expect(parseColor('var(--x)')).toBeNull();
    expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('luminance / contrast', () => {
  it('computes Rec.709 luminance', () => {
    expect(luminanceOf(parseColor('#000000')!)).toBeCloseTo(0, 5);
    expect(luminanceOf(parseColor('#ffffff')!)).toBeCloseTo(1, 5);
    // 中灰（128）→ ~0.502
    expect(luminanceOf(parseColor('#808080')!)).toBeCloseTo(0.502, 2);
  });

  it('computes WCAG contrast ratios', () => {
    const white = parseColor('#ffffff')!;
    const black = parseColor('#000000')!;
    expect(wcagContrast(black, white)).toBeCloseTo(21, 5);
    expect(wcagContrast(white, white)).toBeCloseTo(1, 5);
    // 已知对：白字 / 灰底(#767676) ≈ 4.54
    expect(wcagContrast(white, parseColor('#767676')!)).toBeGreaterThan(4.5);
  });
});

describe('blendOver', () => {
  it('blends a translucent fg over an opaque bg', () => {
    const fg = { r: 255, g: 0, b: 0, a: 0.5 };
    const bg = { r: 0, g: 0, b: 255, a: 1 };
    expect(blendOver(fg, bg)).toEqual({ r: 128, g: 0, b: 128, a: 1 });
  });

  it('handles fully opaque / fully transparent fg', () => {
    expect(blendOver({ r: 1, g: 2, b: 3, a: 1 }, { r: 9, g: 9, b: 9, a: 1 })).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 1,
    });
    expect(blendOver({ r: 1, g: 2, b: 3, a: 0 }, { r: 9, g: 9, b: 9, a: 1 })).toEqual({
      r: 9,
      g: 9,
      b: 9,
      a: 1,
    });
  });
});

describe('medianCut', () => {
  it('splits two distant clusters deterministically when medians land between them', () => {
    // 4 个暗色 + 4 个红色：沿 r 通道排序后中位索引正好劈在簇间，
    // 两个桶各自是纯色簇。
    const colors = [
      { r: 10, g: 10, b: 12, weight: 1 },
      { r: 11, g: 11, b: 13, weight: 1 },
      { r: 12, g: 12, b: 14, weight: 1 },
      { r: 13, g: 13, b: 15, weight: 1 },
      { r: 240, g: 30, b: 30, weight: 1 },
      { r: 238, g: 28, b: 28, weight: 1 },
      { r: 242, g: 32, b: 32, weight: 1 },
      { r: 241, g: 31, b: 31, weight: 1 },
    ];
    const buckets = medianCut(colors, 2);
    expect(buckets).toHaveLength(2);
    const total = buckets.reduce((s, b) => s + b.weight, 0);
    expect(total).toBe(8); // 总权重守恒
    for (const b of buckets) {
      // 每个桶的平均色应落在其簇内
      expect(b.color.r).toBeGreaterThan(0);
      expect(b.color.r).toBeLessThan(255);
      expect(b.weight).toBe(4);
    }
  });

  it('collapses identical colors into a single bucket', () => {
    const buckets = medianCut(
      [
        { r: 5, g: 5, b: 5 },
        { r: 5, g: 5, b: 5 },
      ],
      4,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].color).toEqual({ r: 5, g: 5, b: 5 });
    expect(buckets[0].weight).toBe(2);
  });

  it('handles empty input and single color', () => {
    expect(medianCut([], 4)).toEqual([]);
    const one = medianCut([{ r: 5, g: 5, b: 5 }], 4);
    expect(one).toHaveLength(1);
    expect(one[0].color).toEqual({ r: 5, g: 5, b: 5 });
  });
});

describe('toHex / classifyAlpha', () => {
  it('formats hex with padding', () => {
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(toHex({ r: 255, g: 16, b: 1 })).toBe('#ff1001');
  });

  it('classifies alpha into transparent/translucent/opaque', () => {
    expect(classifyAlpha(0)).toBe('transparent');
    expect(classifyAlpha(0.04)).toBe('transparent');
    expect(classifyAlpha(0.06)).toBe('translucent');
    expect(classifyAlpha(0.5)).toBe('translucent');
    expect(classifyAlpha(0.6)).toBe('opaque');
    expect(classifyAlpha(1)).toBe('opaque');
  });
});
