// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  generate14TokenPalette,
  generateFromHue,
  generateLeonardoTheme,
  suggestForeground,
} from './leonardo-wrapper.mjs';

// ---------------------------------------------------------------------------
// WCAG contrast ratio helper (mirrors the module's internal formula)
// ---------------------------------------------------------------------------

function relativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// generate14TokenPalette
// ---------------------------------------------------------------------------

describe('generate14TokenPalette', () => {
  const EXPECTED_KEYS = [
    'accent',
    'secondary',
    'background',
    'foreground',
    'muted',
    'surface',
    'surfaceElevated',
    'border',
    'codeBackground',
    'codeForeground',
    'inputBackground',
    'buttonBackground',
    'buttonForeground',
    'focusRing',
  ];

  it('返回全部 14 个 token key', () => {
    const palette = generate14TokenPalette('#6366f1');
    for (const key of EXPECTED_KEYS) {
      expect(palette, `missing key: ${key}`).toHaveProperty(key);
    }
    expect(Object.keys(palette)).toHaveLength(14);
  });

  it('dark 与 light 主题返回不同调色板', () => {
    const base = '#6366f1';
    const darkPalette = generate14TokenPalette(base, { theme: 'dark' });
    const lightPalette = generate14TokenPalette(base, { theme: 'light' });

    // 背景必然不同：dark 接近黑，light 接近白
    expect(darkPalette.background).not.toBe(lightPalette.background);

    // 至少 foreground 和 surface 也应不同
    expect(darkPalette.foreground).not.toBe(lightPalette.foreground);
    expect(darkPalette.surface).not.toBe(lightPalette.surface);
  });

  it('无效 hex 时返回 fallback 调色板', () => {
    const palette = generate14TokenPalette('not-a-color');
    // safeHex 将非法输入归一化为 '#000000'，触发 fallback
    expect(palette.background).toBe('#1e1e1e');
    expect(palette.foreground).toBe('#e0e0e0');
    expect(palette.accent).toBe('#4a90d9');
  });

  it('空字符串 hex 时返回 fallback 调色板', () => {
    const palette = generate14TokenPalette('');
    expect(palette.background).toBe('#1e1e1e');
    expect(palette.foreground).toBe('#e0e0e0');
  });

  it('自定义 ratios 覆盖默认值', () => {
    const palette = generate14TokenPalette('#6366f1', {
      ratios: { foreground: 7.0 },
    });
    // 仅验证返回完整结构，不约束具体色值
    expect(Object.keys(palette)).toHaveLength(14);
    expect(palette.foreground).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('所有 token 值为合法 hex 格式', () => {
    const palette = generate14TokenPalette('#4a90d9');
    for (const [key, value] of Object.entries(palette)) {
      expect(value, `key: ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// generateFromHue
// ---------------------------------------------------------------------------

describe('generateFromHue', () => {
  const TOKEN_NAMES = [
    'accent',
    'secondary',
    'background',
    'foreground',
    'muted',
    'surface',
    'surfaceElevated',
    'border',
    'codeBackground',
    'codeForeground',
    'inputBackground',
    'buttonBackground',
    'buttonForeground',
    'focusRing',
  ];

  it('返回全部 14 个 token（dark 模式）', () => {
    const palette = generateFromHue(145, 'dark');
    expect(Object.keys(palette)).toHaveLength(14);
    for (const name of TOKEN_NAMES) {
      expect(palette).toHaveProperty(name);
    }
  });

  it('返回全部 14 个 token（light 模式）', () => {
    const palette = generateFromHue(210, 'light');
    expect(Object.keys(palette)).toHaveLength(14);
  });

  it('所有 token 值为合法 hex 格式', () => {
    const palette = generateFromHue(0, 'dark');
    for (const [key, value] of Object.entries(palette)) {
      expect(value, `key: ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('hue 包装：380 等价 20', () => {
    const a = generateFromHue(380, 'dark');
    const b = generateFromHue(20, 'dark');
    expect(a.accent).toBe(b.accent);
  });

  it('负 hue 包装：-30 等价 330', () => {
    const a = generateFromHue(-30, 'dark');
    const b = generateFromHue(330, 'dark');
    expect(a.accent).toBe(b.accent);
  });

  it('dark 与 light 模式产生不同背景', () => {
    const dark = generateFromHue(145, 'dark');
    const light = generateFromHue(145, 'light');
    expect(dark.background).not.toBe(light.background);
    expect(relativeLuminance(dark.background)).toBeLessThan(relativeLuminance(light.background));
  });

  it('多种 hue (0/120/240) 均返回完整 token', () => {
    for (const h of [0, 120, 240]) {
      const palette = generateFromHue(h, 'dark');
      expect(Object.keys(palette)).toHaveLength(14);
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `hue ${h}, key ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('无效 hue (NaN) 时返回 fallback 调色板', () => {
    const palette = generateFromHue(NaN, 'dark');
    expect(palette.background).toBe('#1e1e1e');
  });
});

// ---------------------------------------------------------------------------
// suggestForeground
// ---------------------------------------------------------------------------

describe('suggestForeground', () => {
  it('返回的颜色在背景上满足 WCAG AA (4.5:1)', () => {
    // Use a dark enough background that 4.5:1 is achievable:
    // bg luminance must be < ~0.18 for white to reach 4.5:1.
    const bg = '#4338ca';
    const fg = suggestForeground(bg, 4.5);
    const ratio = contrastRatio(bg, fg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('浅背景返回深色文字', () => {
    const bg = '#ffffff';
    const fg = suggestForeground(bg, 4.5);
    // 白色背景上的前景必须是深色（低亮度）
    expect(relativeLuminance(fg)).toBeLessThan(0.3);
  });

  it('深背景返回浅色文字', () => {
    const bg = '#1a1a2e';
    const fg = suggestForeground(bg, 4.5);
    // 深色背景上的前景必须是浅色（高亮度）
    expect(relativeLuminance(fg)).toBeGreaterThan(0.5);
  });

  it('自定义 targetRatio 产生可验证的对比度', () => {
    // Use a dark enough background that 7.0:1 is achievable:
    // bg luminance must be < ~0.10 for white to reach 7.0:1.
    const bg = '#3730a3';
    const fg = suggestForeground(bg, 7.0);
    const ratio = contrastRatio(bg, fg);
    expect(ratio).toBeGreaterThanOrEqual(7.0);
  });

  it('无效 hex 时返回 fallback 前景色', () => {
    const fg = suggestForeground('invalid');
    expect(fg).toBe('#e0e0e0');
  });
});

// ---------------------------------------------------------------------------
// generateLeonardoTheme
// ---------------------------------------------------------------------------

describe('generateLeonardoTheme', () => {
  it('返回 contrastColors 数组', () => {
    const result = generateLeonardoTheme({ base: '#6366f1' });
    expect(result).toHaveProperty('contrastColors');
    expect(Array.isArray(result.contrastColors)).toBe(true);
    expect(result.contrastColors.length).toBeGreaterThan(0);
  });

  it('返回 contrastColorPairs 对象', () => {
    const result = generateLeonardoTheme({ base: '#6366f1' });
    expect(result).toHaveProperty('contrastColorPairs');
    expect(typeof result.contrastColorPairs).toBe('object');
    expect(Object.keys(result.contrastColorPairs).length).toBeGreaterThan(0);
  });

  it('自定义 colorConfigs 生成多色主题', () => {
    const result = generateLeonardoTheme({
      base: '#6366f1',
      colorConfigs: [
        {
          name: 'primary',
          colorKeys: ['#6366f1'],
          ratios: [3, 4.5, 7],
        },
        {
          name: 'secondary',
          colorKeys: ['#a855f7'],
          ratios: [3, 4.5],
        },
      ],
    });
    expect(result.contrastColors.length).toBeGreaterThanOrEqual(2);
  });

  it('无 colorConfigs 时生成默认 primary 主题', () => {
    const result = generateLeonardoTheme({ base: '#4a90d9' });
    // 默认应包含 primary 的 contrast 输出
    const pairs = result.contrastColorPairs;
    const hasPrimary = Object.keys(pairs).some((k) => k.startsWith('primary'));
    expect(hasPrimary).toBe(true);
  });

  it('light 背景下生成包含 background 的主题', () => {
    const result = generateLeonardoTheme({
      base: '#6366f1',
      light: '#ffffff',
    });
    const pairs = result.contrastColorPairs;
    expect(pairs).toHaveProperty('background');
  });
});
