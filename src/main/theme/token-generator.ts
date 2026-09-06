// SPDX-License-Identifier: MPL-2.0

/**
 * # token-generator — Tonal Palette → 14(+1)-token 映射器
 *
 * 把 Material Color Utilities 的 `TonalPalette`（HCT 色彩空间）映射为
 * AgentSkin 的 14 个语义色彩 token + `accentMuted`。与 `theme-from-image.ts`
 * 互补：后者走纯 TS 中轴切分（RGB 空间、零依赖），本模块走 HCT 感知均匀
 * 的 tone 阶梯——适合"给定一个主色、派生完整明暗主题"的场景（如 Studio
 * 调色板、动态壁纸取色）。
 *
 * 映射规则：
 *   - dark 模式：背景用低 tone（≤12），文字用高 tone（≥70），层级递增。
 *   - light 模式：方向相反——背景高 tone（≥84），文字低 tone（≤40）。
 *   - border / buttonBackground / focusRing 用 accent + alpha（8 位 hex 后缀）。
 *
 * 输出可直接写入 `manifest.colors` 或喂给 `theme-mapping.ts` 转 CSS 变量。
 */

import type { TonalPalette } from '@material/material-color-utilities';
import type { ThemeColorsFromImage } from '../../shared/types/theme';

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 从 Tonal Palette 生成完整的 14(+1)-token 主题色板。
 *
 * @param palette  Material HCT TonalPalette（由 `TonalPalette.fromInt` /
 *                 `fromHueAndChroma` 构造）。
 * @param mode     `'dark'` 或 `'light'`——决定 tone 方向。
 * @returns        可直接写入 `manifest.colors` 的语义 token 集。
 */
export function mapTonalToTokens(
  palette: TonalPalette,
  mode: 'dark' | 'light',
): ThemeColorsFromImage {
  const dark = mode === 'dark';

  return {
    mode,
    accent: hexFromTone(palette, dark ? 80 : 40),
    accentMuted: hexFromTone(palette, dark ? 60 : 50),
    secondary: hexFromTone(palette, dark ? 70 : 50),
    background: hexFromTone(palette, dark ? 8 : 92),
    foreground: hexFromTone(palette, dark ? 95 : 10),
    muted: hexFromTone(palette, dark ? 70 : 30),
    surface: hexFromTone(palette, dark ? 12 : 88),
    surfaceElevated: hexFromTone(palette, dark ? 16 : 84),
    border: hexFromAlpha(palette, dark ? 80 : 20, 0.18),
    codeBackground: hexFromTone(palette, dark ? 6 : 96),
    codeForeground: hexFromTone(palette, dark ? 70 : 40),
    inputBackground: hexFromTone(palette, dark ? 14 : 86),
    buttonBackground: hexFromAlpha(palette, dark ? 80 : 40, 0.2),
    buttonForeground: hexFromTone(palette, dark ? 90 : 30),
    focusRing: hexFromAlpha(palette, dark ? 80 : 40, 0.6),
  };
}

// ---------------------------------------------------------------------------
// 底层转换
// ---------------------------------------------------------------------------

/** 从 Tonal Tone 值（0-100）生成不透明 `#rrggbb`。 */
function hexFromTone(palette: TonalPalette, tone: number): string {
  const argb = palette.tone(Math.round(tone));
  return argbToHex(argb);
}

/** 从 Tonal Tone 值生成带透明度的 `#aarrggbb`。 */
function hexFromAlpha(palette: TonalPalette, tone: number, alpha: number): string {
  const argb = palette.tone(Math.round(tone));
  const a = Math.round(alpha * 255);
  return argbToHexWithAlpha(argb, a);
}

/** ARGB 整数 → `#rrggbb`（小写，与 `color-quantize.ts` `toHex` 一致）。 */
function argbToHex(argb: number): string {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `#${byte2hex(r)}${byte2hex(g)}${byte2hex(b)}`;
}

/** ARGB 整数 + alpha → `#aarrggbb`。 */
function argbToHexWithAlpha(argb: number, alpha: number): string {
  const a = alpha & 0xff;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `#${byte2hex(a)}${byte2hex(r)}${byte2hex(g)}${byte2hex(b)}`;
}

/** 0-255 → 两位小写 hex。 */
function byte2hex(v: number): string {
  return v.toString(16).padStart(2, '0');
}
