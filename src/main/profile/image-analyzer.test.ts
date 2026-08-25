// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  analyzeImage,
  detectFocus,
  extractDominantColors,
  inferSafeArea,
  type PixelData,
} from './image-analyzer';

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

/** 创建纯色像素数据。 */
function solidColor(width: number, height: number, r: number, g: number, b: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

/** 创建左暗右亮的像素数据。 */
function leftDarkRightBright(width: number, height: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x < width / 2) {
        data[i] = 10;
        data[i + 1] = 10;
        data[i + 2] = 15;
      } else {
        data[i] = 240;
        data[i + 1] = 240;
        data[i + 2] = 235;
      }
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** 创建左亮右暗的像素数据。 */
function leftBrightRightDark(width: number, height: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x < width / 2) {
        data[i] = 245;
        data[i + 1] = 245;
        data[i + 2] = 240;
      } else {
        data[i] = 15;
        data[i + 1] = 15;
        data[i + 2] = 20;
      }
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** 创建中心有主体的像素数据（中心亮、四周暗）。 */
function centerSubject(width: number, height: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.25;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < radius) {
        data[i] = 220;
        data[i + 1] = 180;
        data[i + 2] = 60;
      } else {
        data[i] = 30;
        data[i + 1] = 30;
        data[i + 2] = 40;
      }
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** 创建已知颜色分布的像素数据（用于主色提取测试）。 */
function knownColors(): PixelData {
  // 60% 红色 + 30% 蓝色 + 10% 绿色
  const width = 20;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const pixelIdx = i / 4;
    if (pixelIdx < 120) {
      // 60% 红色
      data[i] = 220;
      data[i + 1] = 30;
      data[i + 2] = 30;
    } else if (pixelIdx < 180) {
      // 30% 蓝色
      data[i] = 30;
      data[i + 1] = 60;
      data[i + 2] = 220;
    } else {
      // 10% 绿色
      data[i] = 50;
      data[i + 1] = 200;
      data[i + 2] = 80;
    }
    data[i + 3] = 255;
  }
  return { data, width, height };
}

// ---------------------------------------------------------------------------
// 焦点检测测试
// ---------------------------------------------------------------------------

describe('detectFocus', () => {
  it('returns center for solid color image', () => {
    const p = solidColor(32, 32, 128, 128, 128);
    const focus = detectFocus(p);
    expect(focus.x).toBeCloseTo(0.5, 1);
    expect(focus.y).toBeCloseTo(0.5, 1);
  });

  it('returns center for uniform white image', () => {
    const p = solidColor(16, 16, 255, 255, 255);
    const focus = detectFocus(p);
    expect(focus.x).toBeCloseTo(0.5, 1);
    expect(focus.y).toBeCloseTo(0.5, 1);
  });

  it('detects center subject position', () => {
    const p = centerSubject(64, 64);
    const focus = detectFocus(p);
    // 焦点应接近中心 (0.5, 0.5)
    expect(focus.x).toBeGreaterThan(0.4);
    expect(focus.x).toBeLessThan(0.6);
    expect(focus.y).toBeGreaterThan(0.4);
    expect(focus.y).toBeLessThan(0.6);
  });

  it('detects off-center subject (left side)', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    const cx = width * 0.25; // 主体在左侧
    const cy = height * 0.5;
    const radius = 12;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < radius) {
          data[i] = 200;
          data[i + 1] = 160;
          data[i + 2] = 40;
        } else {
          data[i] = 20;
          data[i + 1] = 20;
          data[i + 2] = 30;
        }
        data[i + 3] = 255;
      }
    }
    const focus = detectFocus({ data, width, height });
    // 焦点应偏左
    expect(focus.x).toBeLessThan(0.4);
  });

  it('handles very small images', () => {
    const p = solidColor(2, 2, 100, 100, 100);
    const focus = detectFocus(p);
    expect(focus.x).toBeCloseTo(0.5, 1);
    expect(focus.y).toBeCloseTo(0.5, 1);
  });
});

// ---------------------------------------------------------------------------
// 安全区推断测试
// ---------------------------------------------------------------------------

describe('inferSafeArea', () => {
  it('returns left when left is dark and right is bright', () => {
    const p = leftDarkRightBright(64, 64);
    const area = inferSafeArea(p, 'auto');
    expect(area).toBe('left');
  });

  it('returns right when left is bright and right is dark', () => {
    const p = leftBrightRightDark(64, 64);
    const area = inferSafeArea(p, 'auto');
    expect(area).toBe('right');
  });

  it('returns center for uniform image', () => {
    const p = solidColor(32, 32, 128, 128, 128);
    const area = inferSafeArea(p, 'auto');
    expect(area).toBe('center');
  });

  it('returns the specified mode when not auto', () => {
    const p = leftDarkRightBright(32, 32);
    expect(inferSafeArea(p, 'left')).toBe('left');
    expect(inferSafeArea(p, 'right')).toBe('right');
    expect(inferSafeArea(p, 'center')).toBe('center');
    expect(inferSafeArea(p, 'none')).toBe('none');
  });

  it('returns center for nearly symmetric information', () => {
    // 左右两侧使用相同颜色
    const p = solidColor(48, 48, 200, 50, 50);
    const area = inferSafeArea(p, 'auto');
    expect(area).toBe('center');
  });
});

// ---------------------------------------------------------------------------
// 主色调提取测试
// ---------------------------------------------------------------------------

describe('extractDominantColors', () => {
  it('returns correct dominant colors for known distribution', () => {
    const p = knownColors();
    const colors = extractDominantColors(p, 5);
    expect(colors.length).toBeGreaterThanOrEqual(3);
    // 红色权重最高（60%），应为 accent
    expect(colors[0].role).toBe('accent');
    expect(colors[0].color.r).toBeGreaterThan(colors[0].color.b);
    // 蓝色次之（30%），应为 secondary
    expect(colors[1].role).toBe('secondary');
    expect(colors[1].color.b).toBeGreaterThan(colors[1].color.r);
    // 绿色最低（10%），应为 highlight
    expect(colors[2].role).toBe('highlight');
    expect(colors[2].color.g).toBeGreaterThan(colors[2].color.r);
  });

  it('returns colors sorted by weight descending', () => {
    const p = knownColors();
    const colors = extractDominantColors(p, 5);
    for (let i = 1; i < colors.length; i++) {
      expect(colors[i - 1].weight).toBeGreaterThanOrEqual(colors[i].weight);
    }
  });

  it('returns hex format for each color', () => {
    const p = knownColors();
    const colors = extractDominantColors(p, 3);
    for (const c of colors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('respects maxColors parameter', () => {
    const p = knownColors();
    const colors = extractDominantColors(p, 2);
    expect(colors.length).toBeLessThanOrEqual(2);
  });

  it('handles solid color image', () => {
    const p = solidColor(16, 16, 200, 100, 50);
    const colors = extractDominantColors(p, 5);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    expect(colors[0].role).toBe('accent');
    // 颜色应接近输入
    expect(colors[0].color.r).toBeGreaterThan(colors[0].color.b);
  });
});

// ---------------------------------------------------------------------------
// 综合分析测试
// ---------------------------------------------------------------------------

describe('analyzeImage', () => {
  it('returns complete analysis result', () => {
    const p = centerSubject(48, 48);
    const result = analyzeImage(p);
    expect(result).toHaveProperty('focus');
    expect(result).toHaveProperty('safeArea');
    expect(result).toHaveProperty('dominantColors');
    expect(result.focus.x).toBeGreaterThanOrEqual(0);
    expect(result.focus.x).toBeLessThanOrEqual(1);
    expect(result.dominantColors.length).toBeGreaterThan(0);
  });

  it('respects safeArea mode parameter', () => {
    const p = leftDarkRightBright(32, 32);
    const result = analyzeImage(p, 'auto');
    expect(result.safeArea).toBe('left');
  });
});
