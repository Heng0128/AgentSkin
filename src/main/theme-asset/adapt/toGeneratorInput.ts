// SPDX-License-Identifier: MPL-2.0

import { normalizeColors } from '../ir/normalize';
import type { AdapterResult, GeneratorInput } from '../ir/types';

/** 判断亮度（暗色背景返回 true） */
function isDarkBackground(background: string): boolean {
  const hex = background.replace('#', '');
  if (hex.length < 6) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Rec.709 亮度
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5;
}

/**
 * AdapterResult → GeneratorInput 适配层。
 * 与 buildContext() 的区别：buildContext(id, scheme) 从 manifest ID 查库读取；
 * toGeneratorInput(adapterResult) 消费管线内存中的 AdapterResult（导入期无 catalog 入口）。
 */
export function toGeneratorInput(result: AdapterResult, themeId: string): GeneratorInput {
  const colors = normalizeColors(result);
  const isDark = isDarkBackground(colors.background);

  return {
    id: themeId,
    name: result.meta?.name ?? themeId,
    mode: isDark ? 'dark' : 'light',
    isLight: !isDark,
    colors,
    signature: null,
  };
}
