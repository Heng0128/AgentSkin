// SPDX-License-Identifier: MPL-2.0

/**
 * # presets.ts — 质感预设库（可选增强）
 *
 * 克制原则：
 * 1. 色调个性保留：增强不动主色/强调色，只补结构/层次/可选质感
 * 2. 默认保守：质感不自动强推（pywal 教训：自动生成"和谐但平庸"）
 * 3. 单源铁律：增强必须走生成器（signature 分支），禁止手改单端
 */

import type { ThemeColors } from '../../../main/catalog/theme-manifest';

/** 质感预设标识 */
export type PresetId = 'aurora-glass' | 'frosted' | 'minimal';

/** 预设定义 */
export interface PresetDefinition {
  id: PresetId;
  name: string;
  description: string;
  /** 是否为默认推荐 */
  recommended?: boolean;
}

/** 可用预设列表 */
export const PRESETS: PresetDefinition[] = [
  {
    id: 'minimal',
    name: '极简',
    description: '仅 surface 层次补全，无额外质感',
    recommended: true,
  },
  {
    id: 'frosted',
    name: '磨砂',
    description: 'backdrop-filter blur + 半透明 surface',
  },
  {
    id: 'aurora-glass',
    name: '极光琉璃',
    description: '高饱和 + 渐变 art layer + 玻璃质感',
  },
];

/**
 * 应用质感预设到色板。
 * 当前实现：仅扩展 extended 中的质感 CSS 变量引用。
 *
 * @param colors 输入色板
 * @param presetId 预设标识
 * @returns 处理后的色板
 */
export function applyPreset(colors: ThemeColors, presetId: PresetId): ThemeColors {
  switch (presetId) {
    case 'minimal':
      // 极简模式：不做额外处理，仅保留现有 extended
      return colors;

    case 'frosted': {
      // 磨砂模式：追加 backdrop-filter 相关变量引用
      return {
        ...colors,
        extended: {
          ...colors.extended,
          'backdrop-blur': 'blur(12px) saturate(1.1)',
          'surface-opacity': '0.85',
        },
      };
    }

    case 'aurora-glass': {
      // 极光琉璃模式：高饱和强调 + 渐变变量
      return {
        ...colors,
        extended: {
          ...colors.extended,
          'backdrop-blur': 'blur(24px) saturate(1.15)',
          'surface-opacity': '0.75',
          'art-glow': '0 0 80px',
        },
      };
    }

    default:
      return colors;
  }
}

/**
 * 获取预设定义。
 */
export function getPreset(id: PresetId): PresetDefinition | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * 获取默认推荐预设。
 */
export function getDefaultPreset(): PresetDefinition {
  return PRESETS.find((p) => p.recommended) ?? PRESETS[0];
}
