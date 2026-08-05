// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { sampleFromBitmap } from './wallpaper-theme';

/** 构造 BGRA 位图：背景红 + 左上角蓝块 + 右下角全透明。 */
function makeBgra(width: number, height: number): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (x < 4 && y < 4) {
        // 蓝块（BGRA：b=255, g=0, r=0）
        px[o] = 255;
        px[o + 1] = 0;
        px[o + 2] = 0;
        px[o + 3] = 255;
      } else if (x >= width - 4 && y >= height - 4) {
        // 全透明
        px[o + 3] = 0;
      } else {
        // 红色背景（BGRA：b=0, g=0, r=200）
        px[o + 2] = 200;
        px[o + 3] = 255;
      }
    }
  }
  return px;
}

describe('sampleFromBitmap — 像素采样', () => {
  it('skips fully-transparent pixels', () => {
    const sample = sampleFromBitmap(8, 8, makeBgra(8, 8));
    // 4×4 透明块 = 16 像素被跳过；总像素 64 → 参与 48。
    const totalWeight = sample.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBe(48);
  });

  it('aggregates same-quantized colors into weighted buckets', () => {
    const sample = sampleFromBitmap(8, 8, makeBgra(8, 8));
    // 红块（4×4 之外减去蓝块和透明）= 48-16=32 像素 → 一个红桶 weight 32。
    const redBucket = sample.find((c) => c.r > 150 && c.g < 50 && c.b < 50);
    expect(redBucket).toBeDefined();
    expect(redBucket!.weight).toBe(32);
    // 蓝块 16 像素 → 一个蓝桶 weight 16。
    const blueBucket = sample.find((c) => c.b > 200 && c.r < 50);
    expect(blueBucket).toBeDefined();
    expect(blueBucket!.weight).toBe(16);
  });

  it('returns an empty list for a fully-transparent bitmap', () => {
    const px = new Uint8Array(16 * 16 * 4); // all zeros → alpha 0
    expect(sampleFromBitmap(16, 16, px)).toEqual([]);
  });

  it('averages channel values within a quantized bucket', () => {
    // 两个同量化桶（r>>4 相同）但亮度略有差异 → 均值还原。
    const px = new Uint8Array(2 * 4);
    // 像素 0：r=200 → 200>>4 = 12
    px[2] = 200;
    px[3] = 255;
    // 像素 1：r=208 → 208>>4 = 13（不同桶）
    px[6] = 208;
    px[7] = 255;
    const sample = sampleFromBitmap(2, 1, px);
    // 两个桶各 weight 1，r 分别 200 / 208。
    expect(sample).toHaveLength(2);
    const r200 = sample.find((c) => c.r === 200);
    const r208 = sample.find((c) => c.r === 208);
    expect(r200?.weight).toBe(1);
    expect(r208?.weight).toBe(1);
  });

  it('merges near-identical colors into one weighted bucket', () => {
    // 200 与 201 的 r>>4 都是 12 → 合并为一个桶，weight 2，r 均值 ~200.5。
    const px = new Uint8Array(2 * 4);
    px[2] = 200;
    px[3] = 255;
    px[6] = 201;
    px[7] = 255;
    const sample = sampleFromBitmap(2, 1, px);
    expect(sample).toHaveLength(1);
    expect(sample[0].weight).toBe(2);
    expect(sample[0].r).toBeGreaterThanOrEqual(200);
    expect(sample[0].r).toBeLessThanOrEqual(201);
  });
});
