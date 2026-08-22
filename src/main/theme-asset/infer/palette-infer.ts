// SPDX-License-Identifier: MPL-2.0

import type { ThemeColors } from '../../../main/catalog/theme-manifest';
import { normalizeColors } from '../ir/normalize';
import type { AdapterResult } from '../ir/types';

/**
 * 从部分 token 推导完整 14-token。
 * 当前实现：直接委托 normalizeColors（回退到 COLOR_FALLBACKS）。
 * P2 增强：接入 TonalPalette / CorePalette 推导（参考 theme-from-image.ts）。
 */
export function inferPalette(result: AdapterResult): ThemeColors {
  return normalizeColors(result);
}
