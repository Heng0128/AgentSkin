// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper-color-engine — 壁纸→15-token 主题色生成引擎
 *
 * 封装 color-thief（主色提取）与 @material-color-utilities（HCT 色彩空间 +
 * Tonal Palette），把壁纸图片量化为一组符合 THEME_SPEC 亮度契约的
 * 15 个 `--agentskin-*` 设计 token + mode（14 基础 + accentMuted）。
 *
 * 流程：
 *   1. `colorthief.getPalette()` → 提取 N 个主色（RGB 数组）。
 *   2. 加权平均 → 代表色 → RGB 转 HCT（感知均匀色彩空间）。
 *   3. `TonalPalette.fromHueAndChroma(hue, chroma)` → 0-100 的 13 级色阶。
 *   4. 按 dark / light mode 映射到 15-token。
 *
 * 错误处理：任何步骤失败 → 返回 `null`，由调用方 fallback 到现有 median-cut
 * 管线（`theme-from-image.ts` 的 `deriveThemeFromImage`）。
 *
 * 参考：RFC 2026-08-21 FINAL §C4「自动主题生成管线」。
 */

import { argbFromRgb, Hct, TonalPalette } from '@material/material-color-utilities';
import { getPalette } from 'colorthief';
import type { ThemeColorsFromImage } from '../../shared/types/theme';
import type { Rgba } from '../profile/color-quantize';
import { mapTonalToTokens } from './token-generator';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** RGB 元组（公共 API 返回格式）。 */
type RgbTuple = [number, number, number];

/** RGB 对象（与 colorthief `Color.rgb()` / color-quantize `Rgba` 对齐）。 */
type Rgb = Pick<Rgba, 'r' | 'g' | 'b'>;

// ---------------------------------------------------------------------------
// 1. 主色提取
// ---------------------------------------------------------------------------

/**
 * 提取壁纸主色。返回 RGB 元组数组，按 dominance 降序。
 *
 * 使用 colorthief v3 的 `getPalette()`（OKLCH 空间 MMCQ 量化），
 * 比纯中轴 median-cut 感知更均匀。失败（非图片 / 解码空 / 读取异常）
 * 返回空数组，调用方据此 fallback。
 *
 * @param imagePath 图片文件绝对路径
 * @param count    提取颜色数（默认 8，够选 accent + 背景 + 辅色）
 */
export async function extractDominantColors(imagePath: string, count = 8): Promise<RgbTuple[]> {
  try {
    const palette = await getPalette(imagePath, { colorCount: count });
    if (!palette || palette.length === 0) return [];
    // Color 通过 rgb() 方法暴露 {r,g,b}（0-255），规范化钳制后输出。
    return palette.map((c) => {
      const { r, g, b } = c.rgb();
      return [clampByte(r), clampByte(g), clampByte(b)] as RgbTuple;
    });
  } catch {
    // colorthief 失败（格式不支持 / 文件不存在 / Node 解码异常） → 返回空。
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. RGB → HCT 转换
// ---------------------------------------------------------------------------

/**
 * 将 RGB 转换为 HCT 色彩空间。
 *
 * HCT（Hue-Chroma-Tone）是 Google Material You 的感知均匀色彩空间：
 *   - Hue（色相）：0-360°，与 HSL 色相环一致。
 *   - Chroma（饱和度）：0-150+，感知均匀的灰度强度。
 *   - Tone（亮度）：0-100，感知均匀的明度（类似 L*）。
 *
 * 比 RGB/OKLCH 更适合主题系统：Tone 直接对应感知亮度、Chroma 控制
 * 鲜艳程度，生成 Tonal Palette 时保持色相与饱和度一致。
 */
export function rgbToHct(r: number, g: number, b: number): Hct {
  const argb = argbFromRgb(clampByte(r), clampByte(g), clampByte(b));
  return Hct.fromInt(argb);
}

// ---------------------------------------------------------------------------
// 3. Tonal Palette 生成
// ---------------------------------------------------------------------------

/**
 * 从 HCT 生成 Tonal Palette（13 级色阶）。
 *
 * `TonalPalette.fromHueAndChroma(hue, chroma)` 保持色相与饱和度不变，
 * 在 Tone 维度生成 0-100 均匀分布的 13 个色阶，覆盖从极暗到极亮的
 * 完整范围。主题 token 映射时按 mode 从中选取合适的档位。
 */
export function generateTonalPalette(hct: Hct): TonalPalette {
  return TonalPalette.fromHueAndChroma(hct.hue, hct.chroma);
}

// ---------------------------------------------------------------------------
// 4. Tone Mode 检测
// ---------------------------------------------------------------------------

/**
 * 判断壁纸是暗色还是亮色风格。
 *
 * 计算加权平均亮度（Rec.709 系数加权的感知亮度，与 `color-quantize.ts`
 * 的 `luminanceOf` 同源）。阈值 128（8-bit 中点）。
 *   - 均值 < 128 → 'dark'（暗色壁纸，生成暗色主题）
 *   - 均值 ≥ 128 → 'light'（亮色壁纸，生成亮色主题）
 */
export function detectToneMode(colors: RgbTuple[]): 'dark' | 'light' {
  if (colors.length === 0) return 'dark';
  const avgLuminance =
    colors.reduce((sum, [r, g, b]) => sum + (0.299 * r + 0.587 * g + 0.114 * b), 0) / colors.length;
  return avgLuminance < 128 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// 5. 15-token 主题色生成
// ---------------------------------------------------------------------------

/**
 * 从壁纸图片生成 15-token 主题色板。
 *
 * 完整管线：color-thief 主色提取 → HCT 转换 → Tonal Palette → 15-token 映射。
 * 返回 `ThemeColorsFromImage`（与 `theme-from-image.ts` 的 `deriveThemeFromImage`
 * 输出同构），失败返回 `null`（调用方 fallback 到 median-cut）。
 *
 * 15-token 映射规则（守 THEME_SPEC 亮度契约）：
 *   - dark  : bg tone ≤ 15%、text tone ≥ 85%、surface 比 bg 略亮。
 *   - light : bg tone ≥ 88%、text tone ≤ 32%、surface 接近白。
 *   - accent: chroma 最高的代表色，tone 75（dark）/ 45（light）。
 *   - accentMuted: 低饱和 accent 变体（chroma 降 55%），用于 badge/标签。
 *   - border / button / focus-ring: accent + alpha（避免引入新色相）。
 *
 * @param imagePath 壁纸图片文件绝对路径
 */
export async function generateThemeFromWallpaper(
  imagePath: string,
): Promise<ThemeColorsFromImage | null> {
  try {
    // Step 1: 提取主色。
    const colorTuples = await extractDominantColors(imagePath, 8);
    if (colorTuples.length === 0) return null;

    // 转为 Rgb 对象，便于内部处理。
    const colors: Rgb[] = colorTuples.map(([r, g, b]) => ({ r, g, b }));

    // Step 2: 加权平均 → 代表色。权重按 dominance 降序（color-thief 已排序）。
    const representative = weightedAverage(colors);
    const mode = detectToneMode(colorTuples);

    // Step 3: RGB → HCT → Tonal Palette。
    const hct = rgbToHct(representative.r, representative.g, representative.b);
    const palette = generateTonalPalette(hct);

    // Step 4: 15-token 映射（委托 token-generator 的 mapTonalToTokens，
    // 与 Studio 调色板 / 动态壁纸取色保持同一映射规则）。
    return mapTonalToTokens(palette, mode);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 内部：加权平均
// ---------------------------------------------------------------------------

/**
 * 按 dominance 降序加权平均（第 1 个颜色权重 N，第 N 个权重 1）。
 * color-thief 返回的 palette 已按 dominance 降序排列。
 */
function weightedAverage(colors: Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let totalW = 0;
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const w = n - i; // 降序权重：第 0 个最重。
    r += colors[i].r * w;
    g += colors[i].g * w;
    b += colors[i].b * w;
    totalW += w;
  }
  return {
    r: Math.round(r / totalW),
    g: Math.round(g / totalW),
    b: Math.round(b / totalW),
  };
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 钳制到 0-255 字节。 */
function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}
