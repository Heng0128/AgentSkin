// SPDX-License-Identifier: MPL-2.0

/**
 * # 壁纸渲染能力检测
 *
 * 根据设备 GPU 能力和用户设置，决定使用哪个渲染层级：
 * - L1: 静态高清（所有设备）
 * - L2: Canvas 2D 轻动画（有基本 GPU）
 * - L3: WebGL 预留（高端设备，当前 fallback 到 L2）
 */

export type RenderTier = 'L1' | 'L2' | 'L3';

/** 检测当前设备的渲染能力 */
export function detectRenderCapability(): RenderTier {
  // 在 Electron 主进程端检测比较有限
  // 主要依赖 app.getGPUFeatureStatus() 和命令行参数
  try {
    const { app } = require('electron');

    // 检查是否软件渲染（SwiftShader / 无 GPU）
    const gpuFeatures = app.getGPUFeatureStatus?.() || {};
    const hasSoftwareRendering = gpuFeatures.webgl?.toLowerCase?.includes('software') || false;

    if (hasSoftwareRendering) {
      return 'L1'; // 软件渲染 → 强制 L1 静态
    }

    // 检查命令行 flags
    if (
      app.commandLine.hasSwitch('ignore-gpu-blocklist') ||
      app.commandLine.hasSwitch('enable-gpu')
    ) {
      return 'L2'; // 用户强制启用 GPU → L2
    }

    // 默认 L2（Electron + 大多数设备都能跑 Canvas 2D）
    return 'L2';
  } catch {
    return 'L2'; // 出错时保守使用 L2
  }
}

/** 根据用户设置 + 设备能力决定最终 tier */
export function resolveRenderTier(
  userPreference: 'auto' | 'L1' | 'L2' | 'L3' = 'auto',
  deviceCapability: RenderTier = detectRenderCapability(),
): RenderTier {
  if (userPreference === 'auto') return deviceCapability;
  if (userPreference === 'L3') return 'L2'; // L3 预留，当前 fallback 到 L2
  return userPreference;
}
