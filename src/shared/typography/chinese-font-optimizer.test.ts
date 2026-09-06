// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  chineseTextRatio,
  generateChineseFontStack,
  generateChineseTypographyCSS,
  getChineseStackForPlatform,
  getChineseTypography,
  getOptimizedFontWeight,
  getOptimizedLineHeight,
  isChineseText,
  LINUX_CHINESE_STACK,
  MACOS_CHINESE_STACK,
  shouldApplyChineseTypography,
  WINDOWS_CHINESE_STACK,
} from './chinese-font-optimizer';

// ---------------------------------------------------------------------------
// Font stack generation
// ---------------------------------------------------------------------------

describe('generateChineseFontStack', () => {
  it('generates a macOS font stack starting with Latin fonts', () => {
    const stack = generateChineseFontStack('macos');
    expect(stack).toContain('Inter');
    expect(stack).toContain('PingFang SC');
    expect(stack).toContain('sans-serif');
  });

  it('generates a Windows font stack with Microsoft YaHei', () => {
    const stack = generateChineseFontStack('windows');
    expect(stack).toContain('Microsoft YaHei');
    expect(stack).toContain('SimSun');
    expect(stack).toContain('sans-serif');
  });

  it('generates a Linux font stack with Noto Sans CJK', () => {
    const stack = generateChineseFontStack('linux');
    expect(stack).toContain('Noto Sans CJK SC');
    expect(stack).toContain('WenQuanYi Micro Hei');
    expect(stack).toContain('sans-serif');
  });

  it('orders Latin fonts before Chinese fonts', () => {
    const stack = generateChineseFontStack('macos');
    const interPos = stack.indexOf('Inter');
    const pingfangPos = stack.indexOf('PingFang SC');
    expect(interPos).toBeLessThan(pingfangPos);
  });

  it('respects custom latinStack option', () => {
    const stack = generateChineseFontStack('macos', {
      latinStack: ['Custom Font'],
    });
    expect(stack).toContain('Custom Font');
    expect(stack).not.toContain('Inter');
  });

  it('respects custom genericFallback option', () => {
    const stack = generateChineseFontStack('macos', {
      genericFallback: 'serif',
    });
    expect(stack).toContain('serif');
    expect(stack).not.toContain('sans-serif');
  });
});

describe('getChineseStackForPlatform', () => {
  it('returns macOS stack for macos', () => {
    expect(getChineseStackForPlatform('macos')).toEqual(MACOS_CHINESE_STACK);
  });

  it('returns Windows stack for windows', () => {
    expect(getChineseStackForPlatform('windows')).toEqual(WINDOWS_CHINESE_STACK);
  });

  it('returns Linux stack for linux', () => {
    expect(getChineseStackForPlatform('linux')).toEqual(LINUX_CHINESE_STACK);
  });
});

// ---------------------------------------------------------------------------
// Line height optimization
// ---------------------------------------------------------------------------

describe('getOptimizedLineHeight', () => {
  it('returns 1.75 for body context', () => {
    expect(getOptimizedLineHeight('body')).toBe(1.75);
  });

  it('returns 1.6 for heading context', () => {
    expect(getOptimizedLineHeight('heading')).toBe(1.6);
  });

  it('returns 1.7 for code context', () => {
    expect(getOptimizedLineHeight('code')).toBe(1.7);
  });

  it('returns 1.6 for ui context', () => {
    expect(getOptimizedLineHeight('ui')).toBe(1.6);
  });

  it('defaults to body when no context given', () => {
    expect(getOptimizedLineHeight()).toBe(1.75);
  });
});

describe('getOptimizedFontWeight', () => {
  it('returns 400 for body text', () => {
    expect(getOptimizedFontWeight('body')).toBe(400);
  });

  it('returns 500 for headings', () => {
    expect(getOptimizedFontWeight('heading')).toBe(500);
  });

  it('returns 400 for code', () => {
    expect(getOptimizedFontWeight('code')).toBe(400);
  });

  it('returns 400 for ui', () => {
    expect(getOptimizedFontWeight('ui')).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Chinese text detection
// ---------------------------------------------------------------------------

describe('isChineseText', () => {
  it('returns true for pure Chinese text', () => {
    expect(isChineseText('你好世界')).toBe(true);
  });

  it('returns true for mixed Chinese and Latin text', () => {
    expect(isChineseText('Hello 你好')).toBe(true);
  });

  it('returns false for pure Latin text', () => {
    expect(isChineseText('Hello World')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isChineseText('')).toBe(false);
  });

  it('returns true for CJK punctuation', () => {
    expect(isChineseText('。')).toBe(true);
    expect(isChineseText('，')).toBe(true);
  });

  it('returns true for fullwidth forms', () => {
    expect(isChineseText('Ａ')).toBe(true); // Fullwidth Latin A
  });

  it('returns false for numbers and symbols', () => {
    expect(isChineseText('12345!@#$%')).toBe(false);
  });
});

describe('chineseTextRatio', () => {
  it('returns 1.0 for pure Chinese text', () => {
    expect(chineseTextRatio('你好世界')).toBe(1);
  });

  it('returns 0.0 for pure Latin text', () => {
    expect(chineseTextRatio('Hello')).toBe(0);
  });

  it('returns correct ratio for mixed text', () => {
    // '你好' (2 CJK) + 'AB' (2 Latin) = 2/4 = 0.5
    expect(chineseTextRatio('你好AB')).toBeCloseTo(0.5, 1);
  });

  it('returns 0 for empty string', () => {
    expect(chineseTextRatio('')).toBe(0);
  });
});

describe('shouldApplyChineseTypography', () => {
  it('returns true when Chinese ratio exceeds threshold', () => {
    expect(shouldApplyChineseTypography('你好世界 ABC')).toBe(true);
  });

  it('returns false when Chinese ratio is below threshold', () => {
    // '你' (1 CJK) + 'Hello World' (10 Latin) = 1/11 ≈ 0.09
    expect(shouldApplyChineseTypography('你Hello World')).toBe(false);
  });

  it('uses default threshold of 0.3', () => {
    // '你好' (2 CJK) + 'AB' (2 Latin) = 0.5 ≥ 0.3
    expect(shouldApplyChineseTypography('你好AB')).toBe(true);
  });

  it('respects custom threshold', () => {
    // '你好' (2 CJK) + 'AB' (2 Latin) = 0.5 < 0.6
    expect(shouldApplyChineseTypography('你好AB', 0.6)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Complete typography config
// ---------------------------------------------------------------------------

describe('getChineseTypography', () => {
  it('returns a complete config for body context', () => {
    const config = getChineseTypography('body', 'macos');
    expect(config.fontFamily).toContain('PingFang SC');
    expect(config.fontWeight).toBe(400);
    expect(config.lineHeight).toBe(1.75);
    expect(config.letterSpacing).toBe('0.01em');
  });

  it('returns a complete config for heading context', () => {
    const config = getChineseTypography('heading', 'windows');
    expect(config.fontFamily).toContain('Microsoft YaHei');
    expect(config.fontWeight).toBe(500);
    expect(config.lineHeight).toBe(1.6);
  });

  it('uses zero letter-spacing for code context', () => {
    const config = getChineseTypography('code', 'linux');
    expect(config.letterSpacing).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

describe('generateChineseTypographyCSS', () => {
  it('generates valid CSS with all four variables', () => {
    const css = generateChineseTypographyCSS('macos', 'body');
    expect(css).toContain('--agentskin-zh-font-family:');
    expect(css).toContain('--agentskin-zh-font-weight:');
    expect(css).toContain('--agentskin-zh-line-height:');
    expect(css).toContain('--agentskin-zh-letter-spacing:');
  });

  it('wraps rules in :root selector', () => {
    const css = generateChineseTypographyCSS('windows', 'body');
    expect(css).toContain(':root {');
  });

  it('includes platform-specific fonts in output', () => {
    const css = generateChineseTypographyCSS('linux', 'body');
    expect(css).toContain('Noto Sans CJK SC');
  });

  it('includes correct weight for heading context', () => {
    const css = generateChineseTypographyCSS('macos', 'heading');
    expect(css).toContain('--agentskin-zh-font-weight: 500');
  });

  it('includes correct line-height for body context', () => {
    const css = generateChineseTypographyCSS('macos', 'body');
    expect(css).toContain('--agentskin-zh-line-height: 1.75');
  });
});

// ---------------------------------------------------------------------------
// Cross-platform coverage
// ---------------------------------------------------------------------------

describe('cross-platform font stack coverage', () => {
  it('macOS stack includes PingFang SC as primary', () => {
    expect(MACOS_CHINESE_STACK[0]).toBe('PingFang SC');
  });

  it('Windows stack includes Microsoft YaHei as primary', () => {
    expect(WINDOWS_CHINESE_STACK[0]).toBe('Microsoft YaHei');
  });

  it('Linux stack includes Noto Sans CJK SC as primary', () => {
    expect(LINUX_CHINESE_STACK[0]).toBe('Noto Sans CJK SC');
  });

  it('all platform stacks end with at least one fallback font', () => {
    expect(MACOS_CHINESE_STACK.length).toBeGreaterThanOrEqual(3);
    expect(WINDOWS_CHINESE_STACK.length).toBeGreaterThanOrEqual(3);
    expect(LINUX_CHINESE_STACK.length).toBeGreaterThanOrEqual(3);
  });
});
