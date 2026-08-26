// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  extractDominantColorsOnly,
  extractPalette,
  oklchToRgb,
  rgbToOklch,
  solveLightness,
  validateExtraction,
  wcagContrastRgb,
} from '../palette-extractor';
import { luminanceOf, parseColor } from '../profile/color-quantize';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** 暗色图片样本：深色主体 + 高饱和 accent 点缀。 */
function darkImageSample() {
  return {
    colors: [
      { r: 12, g: 14, b: 20, weight: 60 },
      { r: 22, g: 26, b: 36, weight: 30 },
      { r: 122, g: 162, b: 247, weight: 6 },
      { r: 158, g: 206, b: 106, weight: 4 },
    ],
  };
}

/** 亮色图片样本：浅色主体 + 深色 accent。 */
function lightImageSample() {
  return {
    colors: [
      { r: 244, g: 246, b: 250, weight: 70 },
      { r: 226, g: 232, b: 240, weight: 20 },
      { r: 37, g: 99, b: 235, weight: 6 },
    ],
  };
}

/** 多色图片样本：丰富的色彩分布。 */
function colorfulImageSample() {
  return {
    colors: [
      { r: 20, g: 20, b: 30, weight: 40 },
      { r: 45, g: 50, b: 65, weight: 25 },
      { r: 220, g: 80, b: 100, weight: 10 },
      { r: 80, g: 180, b: 120, weight: 8 },
      { r: 250, g: 200, b: 50, weight: 7 },
      { r: 140, g: 100, b: 200, weight: 5 },
      { r: 50, g: 150, b: 220, weight: 5 },
    ],
  };
}

/** 纯色图片样本。 */
function solidColorSample() {
  return {
    colors: [{ r: 100, g: 150, b: 200, weight: 100 }],
  };
}

// ---------------------------------------------------------------------------
// 模式检测
// ---------------------------------------------------------------------------

describe('extractPalette — mode detection', () => {
  it('detects dark mode from a dark image', () => {
    const result = extractPalette(darkImageSample());
    expect(result.mode).toBe('dark');
  });

  it('detects light mode from a light image', () => {
    const result = extractPalette(lightImageSample());
    expect(result.mode).toBe('light');
  });

  it('respects forceMode override', () => {
    const result = extractPalette(darkImageSample(), { forceMode: 'light' });
    expect(result.mode).toBe('light');
  });

  it('respects luminanceThreshold option', () => {
    // 使用亮色样本但设置高阈值，强制暗色
    const result = extractPalette(lightImageSample(), { luminanceThreshold: 0.99 });
    expect(result.mode).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// 主色提取
// ---------------------------------------------------------------------------

describe('extractPalette — dominant color extraction', () => {
  it('extracts the requested number of colors (clamped to 4-8)', () => {
    const result = extractPalette(colorfulImageSample(), { colorCount: 6 });
    expect(result.dominantColors.length).toBeGreaterThanOrEqual(4);
    expect(result.dominantColors.length).toBeLessThanOrEqual(8);
  });

  it('clamps colorCount to minimum 4', () => {
    const result = extractPalette(colorfulImageSample(), { colorCount: 2 });
    expect(result.dominantColors.length).toBeGreaterThanOrEqual(4);
  });

  it('clamps colorCount to maximum 8', () => {
    const result = extractPalette(colorfulImageSample(), { colorCount: 20 });
    expect(result.dominantColors.length).toBeLessThanOrEqual(8);
  });

  it('returns colors sorted by weight descending', () => {
    const result = extractPalette(colorfulImageSample());
    for (let i = 1; i < result.dominantColors.length; i++) {
      expect(result.dominantColors[i].weight).toBeLessThanOrEqual(
        result.dominantColors[i - 1].weight,
      );
    }
  });

  it('assigns semantic roles to extracted colors', () => {
    const result = extractPalette(darkImageSample());
    const roles = result.dominantColors.map((c) => c.role);
    expect(roles).toContain('background');
    expect(roles).toContain('foreground');
    expect(roles).toContain('accent');
  });

  it('produces valid hex color strings', () => {
    const result = extractPalette(darkImageSample());
    for (const c of result.dominantColors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('weights sum to approximately 1', () => {
    const result = extractPalette(colorfulImageSample());
    const totalWeight = result.dominantColors.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 1);
  });
});

// ---------------------------------------------------------------------------
// 14-token 主题派生
// ---------------------------------------------------------------------------

describe('extractPalette — 14-token theme derivation', () => {
  it('emits all 14 manifest color tokens', () => {
    const { theme } = extractPalette(darkImageSample());
    for (const key of [
      'accent',
      'accentMuted',
      'secondary',
      'background',
      'foreground',
      'muted',
      'surface',
      'surfaceElevated',
      'codeBackground',
      'codeForeground',
      'inputBackground',
      'buttonForeground',
    ] as const) {
      expect(theme[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // 带 alpha 的 token
    expect(theme.border).toMatch(/^#[0-9a-f]{8}$/i);
    expect(theme.focusRing).toMatch(/^#[0-9a-f]{8}$/i);
    expect(theme.buttonBackground).toMatch(/^#[0-9a-f]{8}$/i);
  });

  it('keeps dark theme backgrounds dark and text bright (THEME_SPEC)', () => {
    const { theme } = extractPalette(darkImageSample());
    const bgLum = luminanceOf(parseColor(theme.background)!);
    const fgLum = luminanceOf(parseColor(theme.foreground)!);
    expect(bgLum).toBeLessThanOrEqual(0.15);
    expect(fgLum).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps light theme backgrounds bright and text dark (THEME_SPEC)', () => {
    const { theme } = extractPalette(lightImageSample());
    const bgLum = luminanceOf(parseColor(theme.background)!);
    const fgLum = luminanceOf(parseColor(theme.foreground)!);
    expect(bgLum).toBeGreaterThanOrEqual(0.9);
    expect(fgLum).toBeLessThanOrEqual(0.3);
  });

  it('surface is brighter than background in dark mode', () => {
    const { theme } = extractPalette(darkImageSample());
    const bgLum = luminanceOf(parseColor(theme.background)!);
    const surfaceLum = luminanceOf(parseColor(theme.surface)!);
    expect(surfaceLum).toBeGreaterThan(bgLum);
  });

  it('surfaceElevated is brighter than surface in dark mode', () => {
    const { theme } = extractPalette(darkImageSample());
    const surfaceLum = luminanceOf(parseColor(theme.surface)!);
    const elevatedLum = luminanceOf(parseColor(theme.surfaceElevated)!);
    expect(elevatedLum).toBeGreaterThan(surfaceLum);
  });

  it('accent is distinct from background', () => {
    const { theme } = extractPalette(darkImageSample());
    const accent = parseColor(theme.accent)!;
    const bg = parseColor(theme.background)!;
    const dist = Math.abs(accent.r - bg.r) + Math.abs(accent.g - bg.g) + Math.abs(accent.b - bg.b);
    expect(dist).toBeGreaterThan(50);
  });

  it('border/focusRing/buttonBackground share accent RGB base', () => {
    const { theme } = extractPalette(darkImageSample());
    const accent = theme.accent.slice(1, 7);
    expect(theme.border.slice(1, 7)).toBe(accent);
    expect(theme.focusRing.slice(1, 7)).toBe(accent);
    expect(theme.buttonBackground.slice(1, 7)).toBe(accent);
  });
});

// ---------------------------------------------------------------------------
// 边界情况
// ---------------------------------------------------------------------------

describe('extractPalette — edge cases', () => {
  it('returns fallback for empty input', () => {
    const result = extractPalette({ colors: [] });
    expect(result.mode).toBe('dark');
    expect(result.dominantColors.length).toBeGreaterThan(0);
    expect(result.theme.background).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('handles single-color input', () => {
    const result = extractPalette(solidColorSample());
    expect(result.dominantColors.length).toBeGreaterThanOrEqual(1);
    expect(result.theme).toBeDefined();
  });

  it('handles two-color input', () => {
    const result = extractPalette({
      colors: [
        { r: 0, g: 0, b: 0, weight: 50 },
        { r: 255, g: 255, b: 255, weight: 50 },
      ],
    });
    expect(result.dominantColors.length).toBeGreaterThanOrEqual(2);
  });

  it('averageLuminance is between 0 and 1', () => {
    const result = extractPalette(darkImageSample());
    expect(result.averageLuminance).toBeGreaterThanOrEqual(0);
    expect(result.averageLuminance).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// extractDominantColorsOnly
// ---------------------------------------------------------------------------

describe('extractDominantColorsOnly', () => {
  it('returns only colors without theme derivation', () => {
    const colors = extractDominantColorsOnly(darkImageSample(), 5);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    expect(colors.length).toBeLessThanOrEqual(8);
    for (const c of colors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.weight).toBeGreaterThan(0);
    }
  });

  it('returns empty array for empty input', () => {
    const colors = extractDominantColorsOnly({ colors: [] });
    expect(colors).toEqual([]);
  });

  it('respects count parameter', () => {
    const colors = extractDominantColorsOnly(colorfulImageSample(), 4);
    expect(colors.length).toBeLessThanOrEqual(8);
    expect(colors.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// validateExtraction
// ---------------------------------------------------------------------------

describe('validateExtraction', () => {
  it('passes for valid dark theme extraction', () => {
    const result = extractPalette(darkImageSample());
    expect(validateExtraction(result)).toEqual([]);
  });

  it('passes for valid light theme extraction', () => {
    const result = extractPalette(lightImageSample());
    expect(validateExtraction(result)).toEqual([]);
  });

  it('detects background luminance violation', () => {
    const result = extractPalette(darkImageSample());
    // 手动破坏背景亮度
    result.theme = { ...result.theme, background: '#FFFFFF' };
    result.mode = 'dark';
    const issues = validateExtraction(result);
    expect(issues.some((i) => i.includes('background luminance'))).toBe(true);
  });

  it('detects foreground luminance violation', () => {
    const result = extractPalette(lightImageSample());
    // 亮色模式前景必须是深色（亮度 ≤0.3）；用灰色 #808080（亮度 ~0.5）触发违规
    result.theme = { ...result.theme, foreground: '#808080' };
    result.mode = 'light';
    const issues = validateExtraction(result);
    expect(issues.some((i) => i.includes('foreground luminance'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 选项验证
// ---------------------------------------------------------------------------

describe('extractPalette — options', () => {
  it('uses default colorCount of 6', () => {
    const result = extractPalette(colorfulImageSample());
    // 输入 7 种颜色，默认提取 6 种
    expect(result.dominantColors.length).toBeLessThanOrEqual(8);
    expect(result.dominantColors.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts custom colorCount within range', () => {
    const result = extractPalette(colorfulImageSample(), { colorCount: 5 });
    expect(result.dominantColors.length).toBeLessThanOrEqual(8);
  });

  it('handles colorful images with many distinct colors', () => {
    const result = extractPalette(colorfulImageSample(), { colorCount: 8 });
    expect(result.dominantColors.length).toBeGreaterThanOrEqual(4);
    // 验证角色分配
    const roles = new Set(result.dominantColors.map((c) => c.role));
    expect(roles.size).toBeGreaterThanOrEqual(3); // 至少 3 种不同角色
  });
});

// ---------------------------------------------------------------------------
// OKLCh 色彩空间转换
// ---------------------------------------------------------------------------

describe('OKLCh color space conversions', () => {
  it('converts pure black to OKLCh with L=0', () => {
    const [L, C, h] = rgbToOklch(0, 0, 0);
    expect(L).toBeCloseTo(0, 1);
    expect(C).toBeCloseTo(0, 1);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('converts pure white to OKLCh with L=1', () => {
    const [L, C, h] = rgbToOklch(255, 255, 255);
    expect(L).toBeCloseTo(1, 1);
    expect(C).toBeCloseTo(0, 1);
  });

  it('converts red to OKLCh with expected hue range', () => {
    const [L, C, h] = rgbToOklch(255, 0, 0);
    expect(L).toBeGreaterThan(0.3);
    expect(L).toBeLessThan(0.8);
    expect(C).toBeGreaterThan(0);
    // 红色色相应在 20-40 度附近（OKLCh 空间）
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(60);
  });

  it('round-trips RGB → OKLCh → RGB with low error for in-gamut colors', () => {
    const testColors = [
      { r: 122, g: 162, b: 247 },
      { r: 158, g: 206, b: 106 },
      { r: 250, g: 200, b: 50 },
      { r: 100, g: 150, b: 200 },
      { r: 200, g: 80, b: 100 },
    ];
    for (const { r, g, b } of testColors) {
      const [L, C, h] = rgbToOklch(r, g, b);
      const result = oklchToRgb(L, C, h);
      // 允许 ±2 的舍入误差。
      expect(Math.abs(result.r - r)).toBeLessThanOrEqual(2);
      expect(Math.abs(result.g - g)).toBeLessThanOrEqual(2);
      expect(Math.abs(result.b - b)).toBeLessThanOrEqual(2);
    }
  });

  it('round-trips OKLCh → RGB → OKLCh with low error for in-gamut values', () => {
    const testOklch: Array<[number, number, number]> = [
      [0.65, 0.13, 247],
      [0.7, 0.15, 140],
      [0.5, 0.2, 30],
    ];
    for (const [L, C, h] of testOklch) {
      const rgb = oklchToRgb(L, C, h);
      const [L2, C2, h2] = rgbToOklch(rgb.r, rgb.g, rgb.b);
      expect(Math.abs(L2 - L)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(C2 - C)).toBeLessThanOrEqual(0.02);
      // 色相在 chroma 接近 0 时不稳定，跳过低 chroma 的色相检查。
      if (C > 0.05) {
        const hueDiff = Math.abs(h2 - h);
        const wrappedDiff = Math.min(hueDiff, 360 - hueDiff);
        expect(wrappedDiff).toBeLessThanOrEqual(5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// WCAG 对比度计算
// ---------------------------------------------------------------------------

describe('wcagContrastRgb', () => {
  it('returns 1 for identical colors', () => {
    const contrast = wcagContrastRgb({ r: 128, g: 128, b: 128 }, { r: 128, g: 128, b: 128 });
    expect(contrast).toBeCloseTo(1, 5);
  });

  it('returns 21 for black vs white', () => {
    const contrast = wcagContrastRgb({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(contrast).toBeCloseTo(21, 0);
  });

  it('is symmetric (a,b) = (b,a)', () => {
    const a = { r: 37, g: 99, b: 235 };
    const b = { r: 244, g: 246, b: 250 };
    expect(wcagContrastRgb(a, b)).toBeCloseTo(wcagContrastRgb(b, a), 5);
  });

  it('returns higher contrast for more different luminances', () => {
    const dark = { r: 15, g: 20, b: 25 };
    const mid = { r: 128, g: 128, b: 128 };
    const bright = { r: 230, g: 237, b: 243 };
    const contrastDarkBright = wcagContrastRgb(dark, bright);
    const contrastMidBright = wcagContrastRgb(mid, bright);
    expect(contrastDarkBright).toBeGreaterThan(contrastMidBright);
  });
});

// ---------------------------------------------------------------------------
// solveLightness 二分搜索
// ---------------------------------------------------------------------------

describe('solveLightness', () => {
  it('finds a lightness that achieves target contrast for dark text on light bg', () => {
    const bg = { r: 244, g: 246, b: 250 };
    const [L, C, h] = rgbToOklch(30, 30, 40);
    const solvedL = solveLightness(4.5, bg, C, h, true);
    const result = oklchToRgb(solvedL, C, h);
    const contrast = wcagContrastRgb(result, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.4); // 允许微小误差
  });

  it('finds a lightness that achieves target contrast for light text on dark bg', () => {
    const bg = { r: 12, g: 14, b: 20 };
    const [L, C, h] = rgbToOklch(230, 230, 240);
    const solvedL = solveLightness(4.5, bg, C, h, false);
    const result = oklchToRgb(solvedL, C, h);
    const contrast = wcagContrastRgb(result, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.4); // 允许微小误差
  });

  it('returns background OKLCh L when target is 1', () => {
    const bg = { r: 100, g: 100, b: 100 };
    const bgOklchL = rgbToOklch(bg.r, bg.g, bg.b)[0];
    const solvedL = solveLightness(1, bg, 0.1, 180, false);
    // 目标对比度为1时直接返回背景的 OKLCh 亮度。
    expect(solvedL).toBeCloseTo(bgOklchL, 5);
  });

  it('produces monotonically increasing contrast with higher targets', () => {
    const bg = { r: 50, g: 50, b: 60 };
    const [L, C, h] = rgbToOklch(200, 200, 210);
    const solvedL3 = solveLightness(3, bg, C, h, false);
    const solvedL7 = solveLightness(7, bg, C, h, false);
    // 更高的目标对比度需要更远离背景的亮度。
    expect(solvedL7).toBeGreaterThan(solvedL3);
  });
});

// ---------------------------------------------------------------------------
// WCAG AA 对比度合规（端到端）
// ---------------------------------------------------------------------------

describe('WCAG AA contrast compliance (end-to-end)', () => {
  it('dark theme foreground meets 4.5:1 against background', () => {
    const { theme } = extractPalette(darkImageSample());
    const bg = parseColor(theme.background)!;
    const fg = parseColor(theme.foreground)!;
    const contrast = wcagContrastRgb(fg, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('light theme foreground meets 4.5:1 against background', () => {
    const { theme } = extractPalette(lightImageSample());
    const bg = parseColor(theme.background)!;
    const fg = parseColor(theme.foreground)!;
    const contrast = wcagContrastRgb(fg, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('colorful image theme foreground meets 4.5:1 against background', () => {
    const { theme } = extractPalette(colorfulImageSample());
    const bg = parseColor(theme.background)!;
    const fg = parseColor(theme.foreground)!;
    const contrast = wcagContrastRgb(fg, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('all generated themes pass validateExtraction', () => {
    const samples = [
      darkImageSample(),
      lightImageSample(),
      colorfulImageSample(),
      solidColorSample(),
    ];
    for (const sample of samples) {
      const result = extractPalette(sample);
      const issues = validateExtraction(result);
      expect(issues).toEqual([]);
    }
  });

  it('handles edge case: near-white image still produces compliant dark theme', () => {
    // 强制亮色图片生成暗色主题，测试对比度保证
    const nearWhite = {
      colors: [
        { r: 240, g: 240, b: 245, weight: 80 },
        { r: 220, g: 220, b: 230, weight: 20 },
      ],
    };
    const result = extractPalette(nearWhite, { forceMode: 'dark' });
    const bg = parseColor(result.theme.background)!;
    const fg = parseColor(result.theme.foreground)!;
    const contrast = wcagContrastRgb(fg, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });

  it('handles edge case: near-black image still produces compliant light theme', () => {
    // 强制暗色图片生成亮色主题，测试对比度保证
    const nearBlack = {
      colors: [
        { r: 5, g: 5, b: 10, weight: 70 },
        { r: 15, g: 15, b: 25, weight: 30 },
      ],
    };
    const result = extractPalette(nearBlack, { forceMode: 'light' });
    const bg = parseColor(result.theme.background)!;
    const fg = parseColor(result.theme.foreground)!;
    const contrast = wcagContrastRgb(fg, bg);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
