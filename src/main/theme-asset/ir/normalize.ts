// SPDX-License-Identifier: MPL-2.0

import type { ThemeColors } from '../../../main/catalog/theme-manifest';
import type { AdapterResult } from './types';

/**
 * 13 canonical manifest color keys — must align with
 * `MANIFEST_COLOR_KEYS` in `src/main/catalog/theme-contract.ts`.
 *
 * `selection` is derived from accent at CSS generation time (not in manifest).
 * `buttonForeground` is not part of the 14-token contract.
 */
export const COLOR_KEYS = [
  'background',
  'surface',
  'surfaceElevated',
  'foreground',
  'muted',
  'accent',
  'secondary',
  'border',
  'codeBackground',
  'codeForeground',
  'focusRing',
  'buttonBackground',
  'inputBackground',
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

/** 默认回退色（与 theme-utils.mjs COLOR_FALLBACKS 一致） */
const COLOR_FALLBACKS: Record<ColorKey, string> = {
  background: '#1e1e1e',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  foreground: '#e0e0e0',
  muted: '#888888',
  accent: '#4a90d9',
  secondary: '#7a8a99',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  focusRing: '#4a90d960',
  buttonBackground: '#4a90d918',
  inputBackground: '#2a2a2a',
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
