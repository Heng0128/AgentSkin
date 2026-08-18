// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-from-image — 图片→主题流水线（C1）
 *
 * 把任意图片（用户自有/AI 原创）量化为一组符合 THEME_SPEC 亮度契约的
 * 14 个 `--agentskin-*` 设计 token + mode。本模块是**纯 TS**：输入降采样
 * 后的像素样本（图像解码由调用方做——Electron `nativeImage` / sharp），
 * 输出可直接写进 `manifest.json.colors` 的字段。
 *
 * 算法（全属性驱动、零新依赖）：
 *   1. median-cut 聚类 → 主色桶。
 *   2. 亮度直方图（Rec.709）→ 定 mode（暗/亮）。
 *   3. 选 accent：饱和度最高、亮度适中的桶（暗色取偏亮 accent，亮色取偏深）。
 *   4. 派生 14 token，守 THEME_SPEC 亮度契约：
 *       暗色：bg ≤15% 亮度、text ≥85%、surface 比 bg 略亮；
 *       亮色：bg ≥90%、text ≤30%、surface 接近白。
 *   5. border/focus-ring/selection 用 accent + alpha。
 *
 * 输出是"草稿"：C3 的 Studio 人工微调兜底（方案 §8 风险缓解）。
 */

import type { ImagePixelSample, ThemeColorsFromImage } from '../../shared/types/theme';
import { luminanceOf, medianCut, parseColor, toHex } from '../profile/color-quantize';

// Re-export the shared types so existing importers (`wallpaper-theme.ts`, the
// vitest suite) keep working without a churn of import paths. The single source
// of truth is `src/shared/types/theme.ts`.
export type { ImagePixelSample, ThemeColorsFromImage };

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 把 {r,g,b} 转成带 alpha 的 rgba 字符串（用于 border/selection 等 accent 变体）。 */
function alphaHex(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** 按比例把颜色往 target 方向移动（darken/lighten）。 */
function shift(
  c: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  amount: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.round(c.r + (target.r - c.r) * amount),
    g: Math.round(c.g + (target.g - c.g) * amount),
    b: Math.round(c.b + (target.b - c.b) * amount),
  };
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/** 饱和度（HSV 定义）。 */
function saturation(c: { r: number; g: number; b: number }): number {
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 从图片像素样本派生主题色板。返回可直接写入 manifest.colors 的字段。
 */
export function deriveThemeFromImage(sample: ImagePixelSample): ThemeColorsFromImage {
  if (sample.colors.length === 0) {
    // 空输入 → 兜底中性暗色主题。
    return {
      mode: 'dark',
      accent: '#7aa2f7',
      secondary: '#9ece6a',
      background: '#0f1419',
      foreground: '#e6edf3',
      muted: '#8b949e',
      surface: '#161b22',
      surfaceElevated: '#21262d',
      border: '#30363d',
      codeBackground: '#0d1117',
      codeForeground: '#e6edf3',
      inputBackground: '#21262d',
      buttonBackground: '#7aa2f718',
      buttonForeground: '#e6edf3',
      focusRing: '#7aa2f760',
    };
  }

  // 1. 亮度直方图定 mode：看高频色（中位桶）的亮度。
  const buckets = medianCut(sample.colors, 8);
  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  const weightedLum =
    buckets.reduce(
      (s, b) => s + b.weight * luminanceOf({ r: b.color.r, g: b.color.g, b: b.color.b, a: 1 }),
      0,
    ) / totalWeight;
  const mode: 'dark' | 'light' = weightedLum < 0.45 ? 'dark' : 'light';

  // 2. 选 accent：饱和度最高且亮度适中（暗色取 0.35-0.75，亮色取 0.25-0.6）的桶。
  const accentTarget = mode === 'dark' ? 0.5 : 0.4;
  let accentBucket = buckets[0];
  let bestScore = -1;
  for (const b of buckets) {
    const lum = luminanceOf({ r: b.color.r, g: b.color.g, b: b.color.b, a: 1 });
    const sat = saturation(b.color);
    // 与目标亮度越近 + 饱和度越高 → 得分越高；跳过接近纯黑白灰的桶。
    const near = 1 - Math.abs(lum - accentTarget);
    const score = near * 0.6 + sat * 0.4;
    if (sat > 0.08 && score > bestScore) {
      bestScore = score;
      accentBucket = b;
    }
  }
  const accent = accentBucket.color;

  // 3. 主背景色：权重最高的桶（但排除过于饱和的 accent 桶）。
  const bgBucket = [...buckets]
    .filter((b) => b !== accentBucket || buckets.length < 2)
    .sort((a, b) => b.weight - a.weight)[0];
  const bg = bgBucket.color;

  // 4. 派生 14 token（守亮度契约）。
  const isLight = mode === 'light';
  // 背景往 mode 方向收紧：暗色压暗、亮色提亮。
  const bgPulled = shift(bg, isLight ? WHITE : BLACK, 0.25);
  // 层级方向：暗色 surface 比 bg 略亮（向白）、亮色 surface 比 bg 略暗（向黑）。
  const surface = shift(bgPulled, isLight ? BLACK : WHITE, 0.12);
  const elevated = shift(surface, isLight ? BLACK : WHITE, 0.08);
  const text = isLight
    ? shift(BLACK, { r: 30, g: 30, b: 40 }, 0)
    : shift(WHITE, { r: 230, g: 230, b: 240 }, 0);
  const muted = isLight ? shift(text, bg, 0.55) : shift(text, bg, 0.5);
  const codeBg = shift(bgPulled, isLight ? BLACK : WHITE, 0.08);
  const inputBg = isLight ? shift(elevated, BLACK, 0.06) : shift(elevated, WHITE, 0.06);

  return {
    mode,
    accent: toHex(accent),
    secondary: toHex(shift(accent, isLight ? BLACK : WHITE, 0.25)),
    background: toHex(bgPulled),
    foreground: toHex(text),
    muted: toHex(muted),
    surface: toHex(surface),
    surfaceElevated: toHex(elevated),
    border: alphaHex(toHex(accent), isLight ? 0.22 : 0.18),
    codeBackground: toHex(codeBg),
    codeForeground: toHex(isLight ? shift(accent, BLACK, 0.2) : shift(accent, WHITE, 0.35)),
    inputBackground: toHex(inputBg),
    buttonBackground: alphaHex(toHex(accent), 0.2),
    buttonForeground: toHex(isLight ? BLACK : WHITE),
    focusRing: alphaHex(toHex(accent), 0.6),
  };
}

/**
 * 校验派生色板是否满足 THEME_SPEC 亮度契约。返回不合规 token 的列表
 * （空 = 全部合规）。供 check-themes / 生成器调用。
 */
export function validateThemeBrightness(colors: ThemeColorsFromImage): string[] {
  const issues: string[] = [];
  const bg = parseColor(colors.background);
  const fg = parseColor(colors.foreground);
  if (!bg || !fg) return ['background/foreground unparseable'];
  const bgLum = luminanceOf(bg);
  const fgLum = luminanceOf(fg);
  if (colors.mode === 'dark') {
    if (bgLum > 0.15) issues.push(`dark background luminance ${bgLum.toFixed(2)} > 0.15`);
    if (fgLum < 0.85) issues.push(`dark foreground luminance ${fgLum.toFixed(2)} < 0.85`);
  } else {
    if (bgLum < 0.9) issues.push(`light background luminance ${bgLum.toFixed(2)} < 0.9`);
    if (fgLum > 0.3) issues.push(`light foreground luminance ${fgLum.toFixed(2)} > 0.3`);
  }
  return issues;
}
