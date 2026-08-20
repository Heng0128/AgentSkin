// SPDX-License-Identifier: MPL-2.0

/**
 * # layering.ts — 层次补全（surface 3 级递进）
 *
 * 确保 surface 存在 3 级递进层次：surface → surfaceElevated → surfaceL1。
 * 缺失时按现有 surface 推导（明度递增/递减，取决于暗/亮模式）。
 *
 * 克制原则：色调不变（仅明度调整 ±8% 以内）。
 */

import type { ThemeColors } from '../../../main/catalog/theme-manifest';

/** 亮度计算（Rec.709） */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 调整明度（amount: -1~1，正=变亮，负=变暗） */
function adjustLightness(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  const adjust = (c: number): number => {
    if (amount > 0) {
      return Math.min(255, Math.round(c + (255 - c) * amount));
    }
    return Math.max(0, Math.round(c * (1 + amount)));
  };

  const rr = adjust(r).toString(16).padStart(2, '0');
  const gg = adjust(g).toString(16).padStart(2, '0');
  const bb = adjust(b).toString(16).padStart(2, '0');

  return `#${rr}${gg}${bb}`;
}

/**
 * 补全 surface 3 级递进层次。
 * - 暗色模式：surface < surfaceElevated < surfaceL1（明度递增）
 * - 亮色模式：surface > surfaceElevated > surfaceL1（明度递减）
 *
 * @param colors 输入色板（会被扩展）
 * @returns 补全后的色板
 */
export function completeSurfaceLayering(colors: ThemeColors): ThemeColors {
  const isDark = luminance(colors.background) < 0.5;
  const surface = colors.surface ?? colors.background;
  const surfaceElevated = colors.surfaceElevated ?? surface;

  // 推导 surfaceL1（比 surfaceElevated 再亮/暗一级）
  const step = 0.06; // 6% 明度步进

  let surfaceL1: string;
  if (isDark) {
    // 暗色：surfaceL1 比 surfaceElevated 更亮
    surfaceL1 = adjustLightness(surfaceElevated, step);
  } else {
    // 亮色：surfaceL1 比 surfaceElevated 更暗
    surfaceL1 = adjustLightness(surfaceElevated, -step);
  }

  // 确保层次顺序正确（暗色：surface < surfaceElevated < surfaceL1）
  if (isDark) {
    if (luminance(surface) >= luminance(surfaceElevated)) {
      // 顺序不对，重新推导
      colors.surface = adjustLightness(colors.background, step);
      colors.surfaceElevated = adjustLightness(colors.background, step * 2);
    }
  }

  return {
    ...colors,
    surface: colors.surface ?? surface,
    surfaceElevated: colors.surfaceElevated ?? surfaceElevated,
    extended: {
      ...colors.extended,
      surfaceL1,
      // 如果存在 surfaceL2/L3 也保留
      ...(colors.extended?.surfaceL2 ? { surfaceL2: colors.extended.surfaceL2 } : {}),
      ...(colors.extended?.surfaceL3 ? { surfaceL3: colors.extended.surfaceL3 } : {}),
    },
  };
}

/**
 * 检查 surface 层次是否完整。
 */
export function hasCompleteLayering(colors: ThemeColors): boolean {
  return !!(colors.surface && colors.surfaceElevated && colors.extended?.surfaceL1);
}
