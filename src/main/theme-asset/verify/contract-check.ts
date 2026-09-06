// SPDX-License-Identifier: MPL-2.0

import type { ThemeColors } from '../../../main/catalog/theme-manifest';
import { COLOR_KEYS } from '../ir/normalize';
import type { AdapterResult, VerifyReport } from '../ir/types';

/**
 * 离线契约校验：检查 14-token 覆盖率。
 * 不依赖 CDP，仅做静态检查。
 *
 * @param result AdapterResult 或 inferredColors（ThemeColors）
 */
export function contractCheck(result: AdapterResult | ThemeColors): VerifyReport {
  const colors = 'colors' in result ? result.colors : result;
  let provided = 0;

  for (const key of COLOR_KEYS) {
    if (colors[key]) provided++;
  }

  const coverage = provided / COLOR_KEYS.length;
  const warnings: string[] = [];

  if (coverage < 1) {
    const missing = COLOR_KEYS.filter((k) => !colors[k]);
    warnings.push(`Missing tokens: ${missing.join(', ')}`);
  }

  // 检查 inference 标记
  if (colors.inference) {
    const defaultCount = Object.values(colors.inference).filter((v) => v === 'default').length;
    if (defaultCount > 0) {
      warnings.push(`${defaultCount} tokens are fallback defaults`);
    }
  }

  // 检查扩展层次
  if (!colors.extended?.surfaceL1) {
    warnings.push('Surface layering incomplete (missing surfaceL1)');
  }

  if ('confidence' in result && result.confidence !== undefined && result.confidence < 0.5) {
    warnings.push(`Low adapter confidence: ${result.confidence}`);
  }

  return {
    passed: coverage >= 0.8,
    tokenCoverage: coverage,
    agentStatus: {},
    warnings,
  };
}
