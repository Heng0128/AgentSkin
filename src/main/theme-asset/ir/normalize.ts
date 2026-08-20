// SPDX-License-Identifier: MPL-2.0

import type { ThemeColors } from '../../../main/catalog/theme-manifest';
import type { AdapterResult } from './types';

/** 14 个标准 token 键（与 buildContext() 的 COLOR_KEYS 一致） */
export const COLOR_KEYS = [
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
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

/** 默认回退色（与 theme-utils.mjs COLOR_FALLBACKS 一致） */
const COLOR_FALLBACKS: Record<ColorKey, string> = {
  accent: '#4a90d9',
  secondary: '#7a8a99',
  background: '#1e1e1e',
  foreground: '#e0e0e0',
  muted: '#888888',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  inputBackground: '#2a2a2a',
  buttonBackground: '#4a90d918',
  buttonForeground: '#4a90d9',
  focusRing: '#4a90d960',
};

/** 简单颜色校验（#rgb / #rrggbb / rgba() 等） */
function isValidColor(value: string): boolean {
  return (
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
    /^rgba?\(/.test(value) ||
    /^hsla?\(/.test(value)
  );
}

/**
 * 规范化 AdapterResult.colors → 完整 14-token ThemeColors。
 * - 缺失 token 回退到 COLOR_FALLBACKS
 * - 无效颜色值回退到 COLOR_FALLBACKS
 * - 填充 inference 标记（provided / derived / default）
 */
export function normalizeColors(result: AdapterResult): ThemeColors {
  const input = result.colors;
  const colors: Record<string, string> = {} as Record<string, string>;
  const inference: Record<string, 'provided' | 'derived' | 'default'> = {};

  for (const key of COLOR_KEYS) {
    const val = input[key];
    if (val && isValidColor(val)) {
      colors[key] = val;
      inference[key] = 'provided';
    } else {
      colors[key] = COLOR_FALLBACKS[key as ColorKey];
      inference[key] = 'default';
    }
  }

  return {
    ...colors,
    extended: input.extended,
    inference,
  } as ThemeColors;
}
