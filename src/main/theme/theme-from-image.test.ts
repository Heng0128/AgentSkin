// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { luminanceOf, parseColor } from '../profile/color-quantize';
import {
  deriveThemeFromImage,
  type ImagePixelSample,
  validateThemeBrightness,
} from './theme-from-image';

/** 构造暗色图片样本：深色主体 + 高饱和 accent 点缀。 */
function darkImageSample(): ImagePixelSample {
  return {
    colors: [
      { r: 12, g: 14, b: 20, weight: 60 }, // 深色背景
      { r: 22, g: 26, b: 36, weight: 30 }, // 略亮的表面
      { r: 122, g: 162, b: 247, weight: 6 }, // 蓝紫 accent
      { r: 158, g: 206, b: 106, weight: 4 }, // 绿 accent 点缀
    ],
    width: 800,
    height: 600,
  };
}

/** 构造亮色图片样本：浅色主体 + 深色 accent。 */
function lightImageSample(): ImagePixelSample {
  return {
    colors: [
      { r: 244, g: 246, b: 250, weight: 70 }, // 浅色背景
      { r: 226, g: 232, b: 240, weight: 20 }, // 略暗的表面
      { r: 37, g: 99, b: 235, weight: 6 }, // 深蓝 accent
    ],
    width: 800,
    height: 600,
  };
}

describe('deriveThemeFromImage — mode 判定', () => {
  it('detects dark mode from a dark image', () => {
    const theme = deriveThemeFromImage(darkImageSample());
    expect(theme.mode).toBe('dark');
  });

  it('detects light mode from a light image', () => {
    const theme = deriveThemeFromImage(lightImageSample());
    expect(theme.mode).toBe('light');
  });

  it('falls back to a neutral dark theme on empty input', () => {
    const theme = deriveThemeFromImage({ colors: [] });
    expect(theme.mode).toBe('dark');
    expect(theme.background).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('deriveThemeFromImage — 14 token 派生', () => {
  it('emits all 14 manifest color tokens as hex', () => {
    const theme = deriveThemeFromImage(darkImageSample());
    for (const key of [
      'accent',
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

  it('keeps dark theme backgrounds dark and text bright (THEME_SPEC contract)', () => {
    const theme = deriveThemeFromImage(darkImageSample());
    const bgLum = luminanceOf(parseColor(theme.background)!);
    const fgLum = luminanceOf(parseColor(theme.foreground)!);
    expect(bgLum).toBeLessThanOrEqual(0.15);
    expect(fgLum).toBeGreaterThanOrEqual(0.85);
    expect(luminanceOf(parseColor(theme.surface)!)).toBeGreaterThan(bgLum);
  });

  it('keeps light theme backgrounds bright and text dark', () => {
    const theme = deriveThemeFromImage(lightImageSample());
    const bgLum = luminanceOf(parseColor(theme.background)!);
    const fgLum = luminanceOf(parseColor(theme.foreground)!);
    expect(bgLum).toBeGreaterThanOrEqual(0.9);
    expect(fgLum).toBeLessThanOrEqual(0.3);
  });

  it('picks a saturated accent distinct from near-neutral background', () => {
    const theme = deriveThemeFromImage(darkImageSample());
    const accent = parseColor(theme.accent)!;
    const bg = parseColor(theme.background)!;
    // accent 与背景要有明显色差
    const dist = Math.abs(accent.r - bg.r) + Math.abs(accent.g - bg.g) + Math.abs(accent.b - bg.b);
    expect(dist).toBeGreaterThan(100);
  });

  it('derives button/focus/border alpha variants from the accent', () => {
    const theme = deriveThemeFromImage(darkImageSample());
    // border/focusRing/buttonBackground 都从 accent 加 alpha —— 同 RGB 前 6 位
    const accent = theme.accent.slice(1, 7);
    expect(theme.border.slice(1, 7)).toBe(accent);
    expect(theme.focusRing.slice(1, 7)).toBe(accent);
    expect(theme.buttonBackground.slice(1, 7)).toBe(accent);
  });
});

describe('validateThemeBrightness', () => {
  it('passes for derived dark themes', () => {
    expect(validateThemeBrightness(deriveThemeFromImage(darkImageSample()))).toEqual([]);
  });

  it('passes for derived light themes', () => {
    expect(validateThemeBrightness(deriveThemeFromImage(lightImageSample()))).toEqual([]);
  });

  it('flags violations', () => {
    const broken = { ...deriveThemeFromImage(darkImageSample()), background: '#ffffff' };
    const issues = validateThemeBrightness(broken);
    expect(issues.some((i) => i.includes('background luminance'))).toBe(true);
  });
});
