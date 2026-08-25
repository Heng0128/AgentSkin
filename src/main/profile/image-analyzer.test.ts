// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  analyzeImage,
  detectFocus,
  extractDominantColors,
  inferSafeArea,
  type PixelData,
} from './image-analyzer';

// 测试工具
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

function knownColors(): PixelData {
  const width = 20;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const pixelIdx = i / 4;
    if (pixelIdx < 120) {
      data[i] = 220;
      data[i + 1] = 30;
      data[i + 2] = 30;
    } else if (pixelIdx < 180) {
      data[i] = 30;
      data[i + 1] = 60;
      data[i + 2] = 220;
    } else {
      data[i] = 50;
      data[i + 1] = 200;
      data[i + 2] = 80;
    }
    data[i + 3] = 255;
  }
  return { data, width, height };
}

// 焦点检测测试
describe('detectFocus', () => {
  it('returns center for solid color image', () => {
    const focus = detectFocus(solidColor(32, 32, 128, 128, 128));
    expect(focus.x).toBeCloseTo(0.5, 1);
    expect(focus.y).toBeCloseTo(0.5, 1);
  });

  it('detects center subject position', () => {
    const focus = detectFocus(centerSubject(64, 64));
    expect(focus.x).toBeGreaterThan(0.4);
    expect(focus.x).toBeLessThan(0.6);
    expect(focus.y).toBeGreaterThan(0.4);
    expect(focus.y).toBeLessThan(0.6);
  });

  it('detects off-center subject (left side)', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    const cx = width * 0.25;
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
    expect(focus.x).toBeLessThan(0.4);
  });
});

// 安全区推断测试
describe('inferSafeArea', () => {
  it('returns left when left is dark and right is bright', () => {
    expect(inferSafeArea(leftDarkRightBright(64, 64), 'auto')).toBe('left');
  });

  it('returns right when left is bright and right is dark', () => {
    expect(inferSafeArea(leftBrightRightDark(64, 64), 'auto')).toBe('right');
  });

  it('returns center for uniform image', () => {
    expect(inferSafeArea(solidColor(32, 32, 128, 128, 128), 'auto')).toBe('center');
  });

  it('returns the specified mode when not auto', () => {
    const p = leftDarkRightBright(32, 32);
    expect(inferSafeArea(p, 'left')).toBe('left');
    expect(inferSafeArea(p, 'right')).toBe('right');
    expect(inferSafeArea(p, 'none')).toBe('none');
  });
});

// 主色调提取测试
describe('extractDominantColors', () => {
  it('returns correct dominant colors for known distribution', () => {
    const colors = extractDominantColors(knownColors(), 5);
    expect(colors.length).toBeGreaterThanOrEqual(3);
    expect(colors[0].role).toBe('accent');
    expect(colors[0].color.r).toBeGreaterThan(colors[0].color.b);
    expect(colors[1].role).toBe('secondary');
    expect(colors[1].color.b).toBeGreaterThan(colors[1].color.r);
    expect(colors[2].role).toBe('highlight');
    expect(colors[2].color.g).toBeGreaterThan(colors[2].color.r);
  });

  it('returns colors sorted by weight descending with hex format', () => {
    const colors = extractDominantColors(knownColors(), 2);
    expect(colors.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < colors.length; i++) {
      expect(colors[i - 1].weight).toBeGreaterThanOrEqual(colors[i].weight);
    }
    for (const c of colors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// 综合分析测试
describe('analyzeImage', () => {
  it('returns complete analysis result', () => {
    const result = analyzeImage(centerSubject(48, 48));
    expect(result).toHaveProperty('focus');
    expect(result).toHaveProperty('safeArea');
    expect(result).toHaveProperty('dominantColors');
    expect(result.focus.x).toBeGreaterThanOrEqual(0);
    expect(result.focus.x).toBeLessThanOrEqual(1);
  });

  it('respects safeArea mode parameter', () => {
    const result = analyzeImage(leftDarkRightBright(32, 32), 'auto');
    expect(result.safeArea).toBe('left');
  });
});
