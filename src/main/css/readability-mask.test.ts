// SPDX-License-Identifier: MPL-2.0

/**
 * # readability-mask 单元测试
 *
 * 覆盖阅读遮罩算法的各个层面：
 *   - 颜色解析（HEX / RGB / HSL）
 *   - 亮度与对比度计算
 *   - 暗色背景 + 亮色文字场景
 *   - 亮色背景 + 暗色文字场景
 *   - 低对比度 / 高对比度场景
 *   - CSS 变量生成
 *   - 边界值
 */

import { describe, expect, it } from 'vitest';
import {
  calculateReadabilityMask,
  contrastRatio,
  generateCSSVariables,
  hslToRgb,
  parseColor,
  relativeLuminance,
  rgbToHex,
} from './readability-mask';

// ---------------------------------------------------------------------------
// 颜色解析
// ---------------------------------------------------------------------------

describe('parseColor', () => {
  it('parses 6-digit HEX', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseColor('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
    expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses 3-digit HEX', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseColor('#00f')).toEqual({ r: 0, g: 0, b: 255 });
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('parses rgb() / rgba()', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('rgb(0, 255, 0)')).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseColor('rgba(128, 64, 32, 0.5)')).toEqual({ r: 128, g: 64, b: 32 });
    expect(parseColor('rgba(10, 20, 30, 1)')).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('parses hsl() / hsla()', () => {
    // hsl(0, 100%, 50%) = 纯红
    const red = parseColor('hsl(0, 100%, 50%)');
    expect(red).not.toBeNull();
    expect(red!.r).toBeGreaterThan(250);
    expect(red!.g).toBeLessThan(5);
    expect(red!.b).toBeLessThan(5);

    // hsl(120, 100%, 50%) = 纯绿
    const green = parseColor('hsl(120, 100%, 50%)');
    expect(green).not.toBeNull();
    expect(green!.r).toBeLessThan(5);
    expect(green!.g).toBeGreaterThan(250);
    expect(green!.b).toBeLessThan(5);

    // hsl(0, 0%, 100%) = 白色
    const white = parseColor('hsl(0, 0%, 100%)');
    expect(white).toEqual({ r: 255, g: 255, b: 255 });

    // hsl(0, 0%, 0%) = 黑色
    const black = parseColor('hsl(0, 0%, 0%)');
    expect(black).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('returns null for invalid input', () => {
    expect(parseColor('')).toBeNull();
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('#gggggg')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('hsl(red, 50%, 50%)')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HSL → RGB 转换
// ---------------------------------------------------------------------------

describe('hslToRgb', () => {
  it('converts primary colors', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb(120, 1, 0.5)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslToRgb(240, 1, 0.5)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('converts black / white / gray', () => {
    expect(hslToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hslToRgb(0, 0, 1)).toEqual({ r: 255, g: 255, b: 255 });
    expect(hslToRgb(0, 0, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('does not wrap negative hue (caller responsibility)', () => {
    // hslToRgb 本身不处理负色相，负色相在 parseHsl 中已归一化。
    // h = -60 直接传入时按 h < 60 分支处理（红色区域）。
    const result = hslToRgb(-60, 1, 0.5);
    expect(result.r).toBeGreaterThan(250);
    expect(result.g).toBeLessThan(5);
    expect(result.b).toBeLessThan(5);
  });
});

// ---------------------------------------------------------------------------
// 亮度计算
// ---------------------------------------------------------------------------

describe('relativeLuminance', () => {
  it('returns 0 for black and 1 for white', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBe(1);
  });

  it('computes Rec. 609 weighted luminance', () => {
    // 纯绿亮度最高（人眼对绿色最敏感）
    const green = relativeLuminance(0, 255, 0);
    const red = relativeLuminance(255, 0, 0);
    const blue = relativeLuminance(0, 0, 255);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it('returns mid-gray ~0.502 for #808080', () => {
    // L = (0.299*128 + 0.587*128 + 0.114*128) / 255 = 128/255 ≈ 0.502
    expect(relativeLuminance(128, 128, 128)).toBeCloseTo(0.502, 2);
  });
});

// ---------------------------------------------------------------------------
// 对比度计算
// ---------------------------------------------------------------------------

describe('contrastRatio', () => {
  it('returns 21 for black vs white', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 5);
  });

  it('returns 1 for identical luminance', () => {
    expect(contrastRatio(0.5, 0.5)).toBeCloseTo(1, 5);
    expect(contrastRatio(0, 0)).toBeCloseTo(1, 5);
    expect(contrastRatio(1, 1)).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio(0.2, 0.8)).toBeCloseTo(contrastRatio(0.8, 0.2), 10);
  });

  it('returns known WCAG pairs (Rec. 609 luminance)', () => {
    // 注意：本模块使用 Rec. 609 亮度（L = 0.299R + 0.587G + 0.114B），
    // 与 WCAG 2.1 的 gamma 校正亮度不同，因此对比度值也不同。
    // #767676 → L = 118/255 ≈ 0.463，与白色对比度 ≈ 2.05
    const grayLum = relativeLuminance(0x76, 0x76, 0x76);
    const whiteLum = relativeLuminance(255, 255, 255);
    expect(contrastRatio(whiteLum, grayLum)).toBeCloseTo(2.05, 1);
  });
});

// ---------------------------------------------------------------------------
// RGB → HEX
// ---------------------------------------------------------------------------

describe('rgbToHex', () => {
  it('converts to hex string', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('pads single-digit channels', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
    expect(rgbToHex(16, 32, 48)).toBe('#102030');
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 暗色背景 + 亮色文字
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — dark background + light text', () => {
  it('returns dark mask for dark bg + light text with low contrast', () => {
    // 使用真正低对比度的组合：暗蓝灰底 + 灰字
    const mask = calculateReadabilityMask({
      backgroundColor: '#1a1a2e',
      textColor: '#5a5a6e',
      imageLuminance: 0.3,
    });
    // 暗色背景 + 暗灰文字 → 需要遮罩
    expect(mask.opacity).toBeGreaterThan(0);
    expect(mask.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns transparent when dark bg + light text has high contrast', () => {
    // #1a1a2e + #e0e0e0 实际对比度 ≈ 5.77（>= 4.5），无需遮罩
    const mask = calculateReadabilityMask({
      backgroundColor: '#1a1a2e',
      textColor: '#e0e0e0',
      imageLuminance: 0.3,
    });
    expect(mask.opacity).toBe(0);
    expect(mask.backgroundColor).toBe('transparent');
  });

  it('returns transparent when contrast is already sufficient', () => {
    // 暗底(#000) + 亮字(#fff) → 对比度 21，无需遮罩
    const mask = calculateReadabilityMask({
      backgroundColor: '#000000',
      textColor: '#ffffff',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBe(0);
    expect(mask.backgroundColor).toBe('transparent');
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 亮色背景 + 暗色文字
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — light background + dark text', () => {
  it('returns light mask for light bg + dark text with low contrast', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#f0f0f0',
      textColor: '#909090',
      imageLuminance: 0.7,
    });
    expect(mask.opacity).toBeGreaterThan(0);
    expect(mask.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns transparent when contrast is already sufficient', () => {
    // 亮底(#fff) + 暗字(#000) → 对比度 21，无需遮罩
    const mask = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#000000',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBe(0);
    expect(mask.backgroundColor).toBe('transparent');
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 低对比度场景
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — low contrast scenarios', () => {
  it('produces stronger mask for very low contrast', () => {
    // 灰底(#808080) + 灰字(#909090) → 极低对比度
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBeGreaterThan(0.1);
  });

  it('produces stronger mask for bright image with low contrast', () => {
    // 相同颜色组合，亮照片应产生更强遮罩
    const darkImage = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 0.1,
    });
    const brightImage = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 0.9,
    });
    expect(brightImage.opacity).toBeGreaterThan(darkImage.opacity);
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 高对比度场景
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — high contrast scenarios', () => {
  it('returns transparent for black-on-white', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#000000',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBe(0);
  });

  it('returns transparent for white-on-black', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#000000',
      textColor: '#ffffff',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBe(0);
  });

  it('returns mask for brand colors with insufficient contrast', () => {
    // 深蓝(#003366) + 黄色(#ffcc00) → Rec. 609 对比度 ≈ 3.84（< 4.5）
    const mask = calculateReadabilityMask({
      backgroundColor: '#003366',
      textColor: '#ffcc00',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBeGreaterThan(0);
  });

  it('returns transparent for high-contrast brand colors', () => {
    // 深蓝(#000066) + 黄色(#ffff00) → Rec. 609 对比度 > 4.5
    const mask = calculateReadabilityMask({
      backgroundColor: '#000066',
      textColor: '#ffff00',
      imageLuminance: 0.5,
    });
    expect(mask.opacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 自定义 maskStrength
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — explicit maskStrength', () => {
  it('uses provided maskStrength even when contrast is high', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#000000',
      imageLuminance: 0.5,
      maskStrength: 0.5,
    });
    expect(mask.opacity).toBeCloseTo(0.5, 2);
  });

  it('clamps maskStrength to [0, 1]', () => {
    const over = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#000000',
      imageLuminance: 0.5,
      maskStrength: 2,
    });
    expect(over.opacity).toBeLessThanOrEqual(1);

    const under = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#000000',
      imageLuminance: 0.5,
      maskStrength: -1,
    });
    expect(under.opacity).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 无效输入
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — invalid input fallback', () => {
  it('returns safe default for unparseable background', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: 'invalid',
      textColor: '#ffffff',
      imageLuminance: 0.5,
    });
    expect(mask.backgroundColor).toBe('#000000');
    expect(mask.opacity).toBe(0.5);
  });

  it('returns safe default for unparseable text color', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#000000',
      textColor: 'not-a-color',
      imageLuminance: 0.5,
    });
    expect(mask.backgroundColor).toBe('#000000');
    expect(mask.opacity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// 遮罩计算 — 强遮罩时 backdrop-filter
// ---------------------------------------------------------------------------

describe('calculateReadabilityMask — backdrop-filter', () => {
  it('adds backdrop-filter for strong masks', () => {
    // 使用高 maskStrength 触发 backdrop-filter
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 0.5,
      maskStrength: 0.8,
    });
    expect(mask.backdropFilter).toBeDefined();
    expect(mask.backdropFilter).toContain('blur');
  });

  it('omits backdrop-filter for weak masks', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 0.1,
      maskStrength: 0.1,
    });
    expect(mask.backdropFilter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CSS 变量生成
// ---------------------------------------------------------------------------

describe('generateCSSVariables', () => {
  it('generates required CSS variables', () => {
    const vars = generateCSSVariables({
      backgroundColor: '#000000',
      opacity: 0.5,
    });
    expect(vars['--agentskin-mask-bg']).toBe('#000000');
    expect(vars['--agentskin-mask-opacity']).toBe('0.5');
  });

  it('includes optional variables when present', () => {
    const vars = generateCSSVariables({
      backgroundColor: '#333333',
      opacity: 0.7,
      backdropFilter: 'blur(2px) saturate(1.2)',
      borderRadius: '4px',
    });
    expect(vars['--agentskin-mask-backdrop']).toBe('blur(2px) saturate(1.2)');
    expect(vars['--agentskin-mask-radius']).toBe('4px');
  });

  it('omits optional variables when absent', () => {
    const vars = generateCSSVariables({
      backgroundColor: 'transparent',
      opacity: 0,
    });
    expect(vars).not.toHaveProperty('--agentskin-mask-backdrop');
    expect(vars).not.toHaveProperty('--agentskin-mask-radius');
  });
});

// ---------------------------------------------------------------------------
// 边界值
// ---------------------------------------------------------------------------

describe('boundary values', () => {
  it('handles imageLuminance = 0 (darkest)', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 0,
    });
    expect(mask.opacity).toBeGreaterThanOrEqual(0);
    expect(mask.opacity).toBeLessThanOrEqual(1);
  });

  it('handles imageLuminance = 1 (brightest)', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 1,
    });
    expect(mask.opacity).toBeGreaterThanOrEqual(0);
    expect(mask.opacity).toBeLessThanOrEqual(1);
  });

  it('handles same background and text color', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#808080',
      imageLuminance: 0.5,
    });
    // 对比度 = 1，需要强遮罩
    expect(mask.opacity).toBeGreaterThan(0.3);
  });

  it('handles near-threshold contrast (Rec. 609)', () => {
    // 注意：Rec. 609 亮度公式下，#767676/#777777 与白色的对比度均 ≈ 2.0
    // （远低于 4.5），因此都需要遮罩。
    const mask1 = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#767676',
      imageLuminance: 0.5,
    });
    expect(mask1.opacity).toBeGreaterThan(0);

    const mask2 = calculateReadabilityMask({
      backgroundColor: '#ffffff',
      textColor: '#777777',
      imageLuminance: 0.5,
    });
    expect(mask2.opacity).toBeGreaterThan(0);
  });

  it('respects MAX_MASK_OPACITY ceiling for auto-calculated opacity', () => {
    // 自动计算时，opacity 受 MAX_MASK_OPACITY (0.85) 限制
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 1,
    });
    expect(mask.opacity).toBeLessThanOrEqual(0.85);
  });

  it('clamps explicit maskStrength to [0, 1]', () => {
    const mask = calculateReadabilityMask({
      backgroundColor: '#808080',
      textColor: '#909090',
      imageLuminance: 1,
      maskStrength: 1,
    });
    // 显式 maskStrength 被限制在 [0, 1]
    expect(mask.opacity).toBeLessThanOrEqual(1);
    expect(mask.opacity).toBeGreaterThanOrEqual(0);
  });
});
