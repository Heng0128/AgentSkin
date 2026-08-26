// SPDX-License-Identifier: MPL-2.0

/**
 * # palette-extractor — 自动调色板提取引擎
 *
 * 从图片像素样本中提取 4-8 种主色调，并生成符合 14-token 契约的主题色板。
 * 零运行时依赖（纯 TS），全部函数纯函数、无 I/O，方便单测与跨进程复用。
 *
 * ## 算法
 *
 * 1. **量化**：median-cut 聚类将颜色空间降至目标桶数（4-8）。
 * 2. **分类**：按亮度/饱和度对聚类桶排序，分配语义角色。
 * 3. **路由**：根据表面（背景）亮度自动决定生成亮色或暗色主题。
 * 4. **派生**：从主色派生完整的 14-token 色板，守 THEME_SPEC 亮度契约。
 *
 * ## 与现有模块的关系
 *
 * - `theme-from-image.ts`：更上层的流水线（含 HCT fallback），本模块是其纯 TS 量化核心。
 * - `color-quantize.ts`：提供 medianCut 聚类基础设施。
 * - `palette-analyzer.ts`：提供 Canvas 像素分析（浏览器侧），本模块面向主进程的样本输入。
 *
 * @packageDocumentation
 */

import type { ThemeColorsFromImage } from '../shared/types/theme';
import { luminanceOf, medianCut, parseColor, relativeLuminance, toHex } from './profile/color-quantize';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 提取结果：主色 + 完整主题色板。 */
export interface PaletteExtractionResult {
  /** 提取的主色调（按 dominance 降序）。 */
  dominantColors: ExtractedColor[];
  /** 完整的 14-token 主题色板。 */
  theme: ThemeColorsFromImage;
  /** 检测到的色模式。 */
  mode: 'light' | 'dark';
  /** 平均亮度 [0, 1]。 */
  averageLuminance: number;
}

/** 单个提取的主色。 */
export interface ExtractedColor {
  /** RGB 颜色值。 */
  r: number;
  g: number;
  b: number;
  /** 十六进制表示。 */
  hex: string;
  /** 在样本中的权重（归一化 0-1）。 */
  weight: number;
  /** 语义角色分类。 */
  role: ColorRole;
}

/** 颜色在主题中的角色。 */
export type ColorRole = 'background' | 'foreground' | 'accent' | 'secondary' | 'surface' | 'muted';

/** 提取选项。 */
export interface PaletteExtractionOptions {
  /** 目标提取颜色数（4-8，默认 6）。 */
  colorCount?: number;
  /** 强制指定模式（默认自动检测）。 */
  forceMode?: 'light' | 'dark';
  /** 亮度阈值（0-1，默认 0.45）。低于此值生成暗色主题。 */
  luminanceThreshold?: number;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_COLOR_COUNT = 6;
const MIN_COLOR_COUNT = 4;
const MAX_COLOR_COUNT = 8;
const DEFAULT_LUMINANCE_THRESHOLD = 0.45;

// 亮度契约边界（THEME_SPEC）
const DARK_BG_MAX_LUMINANCE = 0.15;
const DARK_FG_MIN_LUMINANCE = 0.85;
const LIGHT_BG_MIN_LUMINANCE = 0.9;
const LIGHT_FG_MAX_LUMINANCE = 0.3;

// WCAG AA 对比度阈值
const WCAG_AA_CONTRAST = 4.5;

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 饱和度（HSV 定义）。 */
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max === 0) return 0;
  return (max - min) / max;
}

/** 把颜色往 target 方向移动（darken/lighten）。 */
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

/** 带 alpha 的十六进制颜色。 */
function alphaHex(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

// ---------------------------------------------------------------------------
// OKLCh 色彩空间（感知均匀配色推导）
// ---------------------------------------------------------------------------

/**
 * sRGB 通道线性化（gamma 解码）。
 * 将 0-255 的 sRGB 值转换为线性光（0-1）。
 */
function linearizeChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 线性光 sRGB 通道 gamma 编码。
 * 将线性光（0-1）转换回 sRGB 值（0-255）。
 */
function gammaEncode(linear: number): number {
  const c = Math.max(0, Math.min(1, linear));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * 线性光 RGB → OKLab。
 * 基于 Björn Ottosson (2020) 的 OKLab 色彩空间。
 */
function linearToOklab(
  r: number,
  g: number,
  b: number,
): [L: number, a: number, b: number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * OKLab → 线性光 RGB。
 * 可能产生色域外的值（需 fitGamut 裁剪）。
 */
function oklabToLinear(
  L: number,
  a: number,
  b: number,
): [r: number, g: number, b: number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * OKLab → OKLCh（极坐标形式）。
 * 返回 [L, C, h]，其中 h 为角度（0-360）。
 */
function oklabToOklch(
  L: number,
  a: number,
  b: number,
): [L: number, C: number, h: number] {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

/**
 * OKLCh → OKLab（直角坐标形式）。
 */
function oklchToOklab(
  L: number,
  C: number,
  h: number,
): [L: number, a: number, b: number] {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

/**
 * 将 RGB（0-255）转换为 OKLCh。
 */
export function rgbToOklch(
  r: number,
  g: number,
  b: number,
): [L: number, C: number, h: number] {
  const rl = linearizeChannel(r);
  const gl = linearizeChannel(g);
  const bl = linearizeChannel(b);
  return oklabToOklch(...linearToOklab(rl, gl, bl));
}

/**
 * 将 OKLCh 转换回 RGB（0-255），带色域裁剪。
 * 使用二分搜索降低 chroma 直到颜色在 sRGB 色域内。
 */
export function oklchToRgb(
  L: number,
  C: number,
  h: number,
): { r: number; g: number; b: number } {
  const [la, aa, ba] = oklchToOklab(L, C, h);
  const [rl, gl, bl] = oklabToLinear(la, aa, ba);
  // 快速路径：已在色域内。
  if (
    rl >= -1e-4 &&
    rl <= 1 + 1e-4 &&
    gl >= -1e-4 &&
    gl <= 1 + 1e-4 &&
    bl >= -1e-4 &&
    bl <= 1 + 1e-4
  ) {
    return {
      r: Math.round(Math.max(0, Math.min(255, gammaEncode(rl) * 255))),
      g: Math.round(Math.max(0, Math.min(255, gammaEncode(gl) * 255))),
      b: Math.round(Math.max(0, Math.min(255, gammaEncode(bl) * 255))),
    };
  }
  // 二分搜索降低 chroma 直到色域内。
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const [ml, ma, mb] = oklchToOklab(L, mid, h);
    const [mrl, mgl, mbl] = oklabToLinear(ml, ma, mb);
    if (
      mrl >= -1e-4 &&
      mrl <= 1 + 1e-4 &&
      mgl >= -1e-4 &&
      mgl <= 1 + 1e-4 &&
      mbl >= -1e-4 &&
      mbl <= 1 + 1e-4
    ) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const [fl, fa, fb] = oklchToOklab(L, lo, h);
  const [frl, fgl, fbl] = oklabToLinear(fl, fa, fb);
  return {
    r: Math.round(Math.max(0, Math.min(255, gammaEncode(frl) * 255))),
    g: Math.round(Math.max(0, Math.min(255, gammaEncode(fgl) * 255))),
    b: Math.round(Math.max(0, Math.min(255, gammaEncode(fbl) * 255))),
  };
}

/**
 * 计算两个 RGB 颜色之间的 WCAG 2.1 对比度。
 */
export function wcagContrastRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const la = relativeLuminance({ ...a, a: 1 });
  const lb = relativeLuminance({ ...b, a: 1 });
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 二分搜索求解满足目标对比度的 OKLCh 亮度值。
 *
 * 在 OKLCh 色彩空间中，固定色相（h）和彩度（C），通过二分搜索找到
 * 满足目标对比度（相对于背景）的亮度（L）。这是构造性求解：直接计算
 * 出满足对比度要求的颜色，而非事后校验修正。
 *
 * @param targetContrast 目标对比度（WCAG AA = 4.5）。
 * @param backdrop        背景色 RGB。
 * @param C               彩度（chroma）。
 * @param h               色相（hue，0-360）。
 * @param darker          是否求解比背景更暗的亮度。
 * @returns 满足目标对比度的亮度值 L（0-1）。
 */
export function solveLightness(
  targetContrast: number,
  backdrop: { r: number; g: number; b: number },
  C: number,
  h: number,
  darker: boolean,
): number {
  const bgOklchL = rgbToOklch(backdrop.r, backdrop.g, backdrop.b)[0];
  // 目标对比度 ≤1 时返回背景的 OKLCh 亮度（无需调整）。
  if (targetContrast <= 1.0001) return bgOklchL;
  // inside: 满足对比度的极端（暗端或亮端）；outside: 背景亮度（对比度=1）。
  let inside = darker ? 0 : 1;
  let outside = bgOklchL;
  for (let i = 0; i < 28; i++) {
    const mid = (inside + outside) / 2;
    const rgb = oklchToRgb(mid, C, h);
    if (wcagContrastRgb(rgb, backdrop) >= targetContrast) {
      inside = mid;
    } else {
      outside = mid;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// 核心提取
// ---------------------------------------------------------------------------

/**
 * 从像素样本中提取主色调并生成 14-token 主题色板。
 *
 * 主流程：
 *   1. median-cut 量化 → 4-8 个主色桶。
 *   2. 按权重排序，分配语义角色。
 *   3. 根据平均亮度路由到亮/暗色模式。
 *   4. 派生完整 14-token 色板。
 *
 * @param sample 像素样本（colors 含 RGB + weight）。
 * @param opts   提取选项（颜色数、强制模式等）。
 * @returns       提取结果（主色 + 主题 + 元信息）。
 */
export function extractPalette(
  sample: { colors: Array<{ r: number; g: number; b: number; weight: number }> },
  opts: PaletteExtractionOptions = {},
): PaletteExtractionResult {
  const colorCount = clampColorCount(opts.colorCount ?? DEFAULT_COLOR_COUNT);
  const threshold = opts.luminanceThreshold ?? DEFAULT_LUMINANCE_THRESHOLD;

  // 空输入 → 兜底。
  if (sample.colors.length === 0) {
    return fallbackResult();
  }

  // 1. median-cut 量化。
  const buckets = medianCut(sample.colors, colorCount);
  if (buckets.length === 0) {
    return fallbackResult();
  }

  // 2. 归一化权重并排序。
  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  const sorted = [...buckets]
    .sort((a, b) => b.weight - a.weight)
    .map((b) => ({
      r: b.color.r,
      g: b.color.g,
      b: b.color.b,
      hex: toHex(b.color),
      weight: b.weight / totalWeight,
    }));

  // 3. 计算平均亮度。
  const avgLuminance = sorted.reduce(
    (s, c) => s + c.weight * luminanceOf({ r: c.r, g: c.g, b: c.b, a: 1 }),
    0,
  );

  // 4. 模式路由。
  const mode: 'light' | 'dark' = opts.forceMode ?? (avgLuminance < threshold ? 'dark' : 'light');

  // 5. 分配语义角色。
  const classified = assignRoles(sorted, mode);

  // 6. 派生 14-token 色板。
  const theme = deriveThemeTokens(classified, mode);

  return {
    dominantColors: classified,
    theme,
    mode,
    averageLuminance: avgLuminance,
  };
}

// ---------------------------------------------------------------------------
// 角色分配
// ---------------------------------------------------------------------------

/**
 * 为提取的颜色分配语义角色。
 *
 * 策略：
 *   - 按亮度排序，最暗/最亮的分别作为背景/前景候选。
 *   - 饱和度最高且亮度适中的作为 accent。
 *   - 次饱和的作为 secondary。
 *   - 中间亮度的作为 surface/muted。
 */
function assignRoles(
  sorted: Array<{ r: number; g: number; b: number; hex: string; weight: number }>,
  mode: 'light' | 'dark',
): ExtractedColor[] {
  const colors = sorted.map((c) => ({
    ...c,
    lum: luminanceOf({ r: c.r, g: c.g, b: c.b, a: 1 }),
    sat: saturation(c.r, c.g, c.b),
  }));

  const result: ExtractedColor[] = sorted.map((c) => ({
    r: c.r,
    g: c.g,
    b: c.b,
    hex: c.hex,
    weight: c.weight,
    role: 'surface', // 默认角色，后面覆盖
  }));

  // 按亮度排序的索引。
  const byLum = colors.map((c, i) => ({ i, lum: c.lum })).sort((a, b) => a.lum - b.lum);

  // 背景：亮度极端（暗色取最暗，亮色取最亮）。
  const bgIdx = mode === 'dark' ? byLum[0].i : byLum[byLum.length - 1].i;
  result[bgIdx].role = 'background';

  // 前景：与背景相反的极端。
  const fgIdx = mode === 'dark' ? byLum[byLum.length - 1].i : byLum[0].i;
  if (fgIdx !== bgIdx) {
    result[fgIdx].role = 'foreground';
  }

  // accent：饱和度最高且亮度适中（排除已分配的 bg/fg）。
  const accentTarget = mode === 'dark' ? 0.5 : 0.4;
  let bestAccentIdx = -1;
  let bestAccentScore = -1;
  for (let i = 0; i < colors.length; i++) {
    if (i === bgIdx || i === fgIdx) continue;
    const c = colors[i];
    if (c.sat < 0.08) continue;
    const near = 1 - Math.abs(c.lum - accentTarget);
    const score = near * 0.6 + c.sat * 0.4;
    if (score > bestAccentScore) {
      bestAccentScore = score;
      bestAccentIdx = i;
    }
  }
  if (bestAccentIdx >= 0) {
    result[bestAccentIdx].role = 'accent';
  }

  // secondary：次高饱和度（排除已分配）。
  let bestSecondaryIdx = -1;
  let bestSecondaryScore = -1;
  for (let i = 0; i < colors.length; i++) {
    if (i === bgIdx || i === fgIdx || i === bestAccentIdx) continue;
    const c = colors[i];
    if (c.sat < 0.05) continue;
    const score = c.sat * 0.7 + c.weight * 0.3;
    if (score > bestSecondaryScore) {
      bestSecondaryScore = score;
      bestSecondaryIdx = i;
    }
  }
  if (bestSecondaryIdx >= 0) {
    result[bestSecondaryIdx].role = 'secondary';
  }

  // 剩余未分配的：标记为 surface 或 muted。
  for (let i = 0; i < result.length; i++) {
    if (result[i].role === 'surface') {
      // 中间亮度的作为 muted，其余保持 surface。
      const c = colors[i];
      const midLum = mode === 'dark' ? 0.35 : 0.6;
      if (Math.abs(c.lum - midLum) < 0.15) {
        result[i].role = 'muted';
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 主题派生
// ---------------------------------------------------------------------------

/**
 * 从已分类的颜色派生完整的 14-token 主题色板。
 *
 * 守 THEME_SPEC 亮度契约：
 *   - 暗色：bg ≤15%、text ≥85%、surface 比 bg 略亮。
 *   - 亮色：bg ≥90%、text ≤30%、surface 接近白。
 */
function deriveThemeTokens(
  classified: ExtractedColor[],
  mode: 'light' | 'dark',
): ThemeColorsFromImage {
  const isLight = mode === 'light';

  // 查找各角色的颜色。
  const bg = classified.find((c) => c.role === 'background');
  const fg = classified.find((c) => c.role === 'foreground');
  const accent = classified.find((c) => c.role === 'accent');
  const secondary = classified.find((c) => c.role === 'secondary');
  const muted = classified.find((c) => c.role === 'muted');

  // 背景：往 mode 方向收紧。
  const bgRaw = bg ?? (isLight ? WHITE : BLACK);
  const bgPulled = shift(bgRaw, isLight ? WHITE : BLACK, 0.25);

  // 前景：暗色取白、亮色取黑。
  const _fgRaw = fg ?? (isLight ? BLACK : WHITE);
  const text = isLight
    ? shift(BLACK, { r: 30, g: 30, b: 40 }, 0)
    : shift(WHITE, { r: 230, g: 230, b: 240 }, 0);

  // accent：使用分类结果或派生。
  const accentRaw = accent ?? (isLight ? { r: 37, g: 99, b: 235 } : { r: 122, g: 162, b: 247 });

  // secondary：accent 的偏移变体。
  const secondaryRaw = secondary ?? shift(accentRaw, isLight ? BLACK : WHITE, 0.25);

  // muted：前景与背景的混合。
  const mutedRaw = muted ?? (isLight ? shift(text, bgPulled, 0.55) : shift(text, bgPulled, 0.5));

  // surface 层级。
  const surface = shift(bgPulled, isLight ? BLACK : WHITE, 0.12);
  const elevated = shift(surface, isLight ? BLACK : WHITE, 0.08);

  // code 背景。
  const codeBg = shift(bgPulled, isLight ? BLACK : WHITE, 0.08);

  // input 背景。
  const inputBg = isLight ? shift(elevated, BLACK, 0.06) : shift(elevated, WHITE, 0.06);

  // 校验并修正亮度契约（OKLCh 构造性求解）。
  const finalBg = enforceBackgroundLuminance(bgPulled, mode);
  const finalFg = enforceForegroundLuminance(text, mode, finalBg);

  return {
    mode,
    accent: toHex(accentRaw),
    accentMuted: toHex(shift(accentRaw, isLight ? BLACK : WHITE, 0.15)),
    secondary: toHex(secondaryRaw),
    background: toHex(finalBg),
    foreground: toHex(finalFg),
    muted: toHex(mutedRaw),
    surface: toHex(surface),
    surfaceElevated: toHex(elevated),
    border: alphaHex(toHex(accentRaw), isLight ? 0.22 : 0.18),
    codeBackground: toHex(codeBg),
    codeForeground: toHex(isLight ? shift(accentRaw, BLACK, 0.2) : shift(accentRaw, WHITE, 0.35)),
    inputBackground: toHex(inputBg),
    buttonBackground: alphaHex(toHex(accentRaw), 0.2),
    buttonForeground: toHex(isLight ? BLACK : WHITE),
    focusRing: alphaHex(toHex(accentRaw), 0.6),
  };
}

// ---------------------------------------------------------------------------
// 亮度契约强制（OKLCh 构造性求解）
// ---------------------------------------------------------------------------

/**
 * 使用 OKLCh 构造性求解确保背景亮度符合 THEME_SPEC 契约。
 *
 * 将背景色转换到 OKLCh 色彩空间，保持色相和彩度不变，通过二分搜索
 * 找到满足亮度边界的最优亮度值。这是构造性求解：直接计算出满足
 * 契约的颜色，而非事后校验修正。
 */
function enforceBackgroundLuminance(
  bg: { r: number; g: number; b: number },
  mode: 'light' | 'dark',
): { r: number; g: number; b: number } {
  const [L, C, h] = rgbToOklch(bg.r, bg.g, bg.b);
  const lum = luminanceOf({ ...bg, a: 1 });

  if (mode === 'dark') {
    if (lum > DARK_BG_MAX_LUMINANCE) {
      // 需要压暗：二分搜索找到满足亮度 ≤ DARK_BG_MAX_LUMINANCE 的最大 L。
      const solvedL = solveBackgroundLightness(L, C, h, DARK_BG_MAX_LUMINANCE, true);
      return oklchToRgb(solvedL, C, h);
    }
  } else {
    if (lum < LIGHT_BG_MIN_LUMINANCE) {
      // 需要提亮：二分搜索找到满足亮度 ≥ LIGHT_BG_MIN_LUMINANCE 的最小 L。
      const solvedL = solveBackgroundLightness(L, C, h, LIGHT_BG_MIN_LUMINANCE, false);
      return oklchToRgb(solvedL, C, h);
    }
  }
  return bg;
}

/**
 * 使用 OKLCh 构造性求解确保前景亮度符合 THEME_SPEC 契约，
 * 同时保证与背景的 WCAG AA 对比度。
 *
 * 将前景色转换到 OKLCh 色彩空间，保持色相和彩度不变，通过二分搜索
 * 找到满足以下两个条件的最优亮度值：
 *   1. THEME_SPEC 亮度边界
 *   2. WCAG AA 对比度（4.5:1）
 */
function enforceForegroundLuminance(
  fg: { r: number; g: number; b: number },
  mode: 'light' | 'dark',
  bg: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  const [L, C, h] = rgbToOklch(fg.r, fg.g, fg.b);
  const lum = luminanceOf({ ...fg, a: 1 });

  if (mode === 'dark') {
    if (lum < DARK_FG_MIN_LUMINANCE) {
      // 需要提亮：找到满足亮度 ≥ DARK_FG_MIN_LUMINANCE 的最小 L。
      const minL = solveBackgroundLightness(L, C, h, DARK_FG_MIN_LUMINANCE, false);
      // 同时满足 WCAG AA 对比度。
      const contrastL = solveLightness(WCAG_AA_CONTRAST, bg, C, h, false);
      // 取两者中较大的（更亮的）以确保同时满足两个约束。
      const solvedL = Math.max(minL, contrastL);
      return oklchToRgb(solvedL, C, h);
    }
    // 即使亮度满足边界，也检查对比度。
    if (wcagContrastRgb(fg, bg) < WCAG_AA_CONTRAST) {
      const contrastL = solveLightness(WCAG_AA_CONTRAST, bg, C, h, false);
      return oklchToRgb(contrastL, C, h);
    }
  } else {
    if (lum > LIGHT_FG_MAX_LUMINANCE) {
      // 需要压暗：找到满足亮度 ≤ LIGHT_FG_MAX_LUMINANCE 的最大 L。
      const maxL = solveBackgroundLightness(L, C, h, LIGHT_FG_MAX_LUMINANCE, true);
      // 同时满足 WCAG AA 对比度。
      const contrastL = solveLightness(WCAG_AA_CONTRAST, bg, C, h, true);
      // 取两者中较小的（更暗的）以确保同时满足两个约束。
      const solvedL = Math.min(maxL, contrastL);
      return oklchToRgb(solvedL, C, h);
    }
    // 即使亮度满足边界，也检查对比度。
    if (wcagContrastRgb(fg, bg) < WCAG_AA_CONTRAST) {
      const contrastL = solveLightness(WCAG_AA_CONTRAST, bg, C, h, true);
      return oklchToRgb(contrastL, C, h);
    }
  }
  return fg;
}

/**
 * 二分搜索求解满足亮度边界的 OKLCh 亮度值。
 *
 * @param currentL  当前亮度。
 * @param C         彩度（保持不变）。
 * @param h         色相（保持不变）。
 * @param target    目标亮度边界值。
 * @param darker    是否求解更暗的亮度（true = 求解 ≤ target 的最大 L）。
 * @returns 满足边界条件的亮度值 L。
 */
function solveBackgroundLightness(
  currentL: number,
  C: number,
  h: number,
  target: number,
  darker: boolean,
): number {
  if (darker) {
    // 求解满足 luminance ≤ target 的最大 L。
    let lo = 0;
    let hi = currentL;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      const rgb = oklchToRgb(mid, C, h);
      const midLum = luminanceOf({ ...rgb, a: 1 });
      if (midLum <= target) {
        lo = mid; // 满足约束，尝试更大的 L。
      } else {
        hi = mid; // 不满足，需要更小的 L。
      }
    }
    return lo;
  }
  // 求解满足 luminance ≥ target 的最小 L。
  let lo = currentL;
  let hi = 1;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const rgb = oklchToRgb(mid, C, h);
    const midLum = luminanceOf({ ...rgb, a: 1 });
    if (midLum >= target) {
      hi = mid; // 满足约束，尝试更小的 L。
    } else {
      lo = mid; // 不满足，需要更大的 L。
    }
  }
  return hi;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function clampColorCount(n: number): number {
  return Math.min(MAX_COLOR_COUNT, Math.max(MIN_COLOR_COUNT, Math.round(n)));
}

/** 空输入时的兜底结果。 */
function fallbackResult(): PaletteExtractionResult {
  return {
    dominantColors: [
      { r: 15, g: 20, b: 25, hex: '#0F1419', weight: 0.6, role: 'background' },
      { r: 230, g: 237, b: 243, hex: '#E6EDF3', weight: 0.2, role: 'foreground' },
      { r: 122, g: 162, b: 247, hex: '#7AA2F7', weight: 0.1, role: 'accent' },
      { r: 158, g: 206, b: 106, hex: '#9ECE6A', weight: 0.05, role: 'secondary' },
      { r: 139, g: 148, b: 158, hex: '#8B949E', weight: 0.03, role: 'muted' },
      { r: 22, g: 27, b: 34, hex: '#161B22', weight: 0.02, role: 'surface' },
    ],
    theme: {
      mode: 'dark',
      accent: '#7AA2F7',
      accentMuted: '#5A7FD4',
      secondary: '#9ECE6A',
      background: '#0F1419',
      foreground: '#E6EDF3',
      muted: '#8B949E',
      surface: '#161B22',
      surfaceElevated: '#21262D',
      border: '#7AA2F72E',
      codeBackground: '#0D1117',
      codeForeground: '#E6EDF3',
      inputBackground: '#21262D',
      buttonBackground: '#7AA2F733',
      buttonForeground: '#E6EDF3',
      focusRing: '#7AA2F799',
    },
    mode: 'dark',
    averageLuminance: 0.1,
  };
}

// ---------------------------------------------------------------------------
// 便捷 API
// ---------------------------------------------------------------------------

/**
 * 仅提取主色调（不含主题派生），用于需要自定义主题生成的场景。
 *
 * @param sample 像素样本。
 * @param count  目标颜色数（4-8，默认 6）。
 * @returns       按 dominance 降序排列的主色数组。
 */
export function extractDominantColorsOnly(
  sample: { colors: Array<{ r: number; g: number; b: number; weight: number }> },
  count: number = DEFAULT_COLOR_COUNT,
): ExtractedColor[] {
  if (sample.colors.length === 0) return [];

  const colorCount = clampColorCount(count);
  const buckets = medianCut(sample.colors, colorCount);
  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  if (totalWeight === 0) return [];

  return buckets
    .sort((a, b) => b.weight - a.weight)
    .map((b) => ({
      r: b.color.r,
      g: b.color.g,
      b: b.color.b,
      hex: toHex(b.color),
      weight: b.weight / totalWeight,
      role: 'surface' as const,
    }));
}

/**
 * 校验提取结果是否满足 THEME_SPEC 亮度契约。
 * 返回不合规 token 的列表（空 = 全部合规）。
 */
export function validateExtraction(result: PaletteExtractionResult): string[] {
  const issues: string[] = [];
  const { theme, mode } = result;

  const bg = parseColor(theme.background);
  const fg = parseColor(theme.foreground);
  if (!bg || !fg) {
    return ['background/foreground unparseable'];
  }

  const bgLum = luminanceOf(bg);
  const fgLum = luminanceOf(fg);

  if (mode === 'dark') {
    if (bgLum > DARK_BG_MAX_LUMINANCE) {
      issues.push(`dark background luminance ${bgLum.toFixed(2)} > ${DARK_BG_MAX_LUMINANCE}`);
    }
    if (fgLum < DARK_FG_MIN_LUMINANCE) {
      issues.push(`dark foreground luminance ${fgLum.toFixed(2)} < ${DARK_FG_MIN_LUMINANCE}`);
    }
  } else {
    if (bgLum < LIGHT_BG_MIN_LUMINANCE) {
      issues.push(`light background luminance ${bgLum.toFixed(2)} < ${LIGHT_BG_MIN_LUMINANCE}`);
    }
    if (fgLum > LIGHT_FG_MAX_LUMINANCE) {
      issues.push(`light foreground luminance ${fgLum.toFixed(2)} > ${LIGHT_FG_MAX_LUMINANCE}`);
    }
  }

  return issues;
}
