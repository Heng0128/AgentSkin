// SPDX-License-Identifier: MPL-2.0

/**
 * # 壁纸渲染能力检测
 *
 * 根据设备 GPU 能力和用户设置，决定使用哪个渲染层级：
 * - L1: 静态高清（所有设备）
 * - L2: Canvas 2D 轻动画（有基本 GPU）
 * - L3: WebGL 预留（高端设备，当前 fallback 到 L2）
 *
 * 提供两套检测 API：
 * - {@link detectRenderCapability} / {@link resolveRenderTier} — 快速分 tier（保持向后兼容）
 * - {@link detectWebGLCapability} — 详细 GPU  capability 报告（用于诊断和日志）
 */

export type RenderTier = 'L1' | 'L2' | 'L3';

// ---------------------------------------------------------------------------
// WebGL 详细能力报告
// ---------------------------------------------------------------------------

/** WebGL 能力详细报告 */
export interface WebGLCapability {
  /** WebGL 是否可用（非软件渲染、未被禁用） */
  available: boolean;
  /** 设备支持的渲染层级 */
  tier: 'L1' | 'L2' | 'L3';
  /** GPU 厂商信息（如 "NVIDIA"、"AMD"、"Intel"） */
  renderer?: string;
  /** GPU 供应商字符串 */
  vendor?: string;
  /** 最大纹理尺寸（像素） */
  maxTextureSize?: number;
  /** 是否为软件渲染（SwiftShader、llvmpipe 等） */
  isSoftwareRenderer: boolean;
  /** 不可用的原因（当 available=false 时） */
  reason?: string;
}

/**
 * 详细检测 WebGL 能力。
 *
 * 使用 Electron 的 `app.getGPUFeatureStatus()` 和命令行参数综合判断。
 * 优先检测 SwiftShader / llvmpipe 软件渲染，其次检查 GPU 功能是否被禁用，
 * 最后返回详细的 GPU capability 信息。
 */
export function detectWebGLCapability(): WebGLCapability {
  try {
    const { app } = require('electron');
    const gpuFeatures = app.getGPUFeatureStatus?.() || {};

    // 检查软件渲染（SwiftShader / llvmpipe / Microsoft Basic Render Driver）
    const webglStatus = gpuFeatures.webgl?.toLowerCase() || '';
    const webgl2Status = gpuFeatures.webgl2?.toLowerCase() || '';
    const isSoftware =
      webglStatus.includes('software') ||
      webglStatus.includes('swiftshader') ||
      webglStatus.includes('llvmpipe') ||
      webglStatus.includes('microsoft basic') ||
      webgl2Status.includes('software') ||
      webgl2Status.includes('swiftshader');

    if (isSoftware) {
      return {
        available: false,
        tier: 'L1',
        isSoftwareRenderer: true,
        reason: 'Software rendering detected (SwiftShader / llvmpipe / Basic Render)',
      };
    }

    // 检查 GPU 功能被禁用
    if (gpuFeatures.webgl === 'disabled' || gpuFeatures.webgl2 === 'disabled') {
      return {
        available: false,
        tier: 'L1',
        isSoftwareRenderer: false,
        reason: 'WebGL disabled via GPU feature status',
      };
    }

    // 检查 GPU 进程是否被禁用
    if (gpuFeatures.gpu_compositing === 'disabled') {
      return {
        available: false,
        tier: 'L1',
        isSoftwareRenderer: false,
        reason: 'GPU compositing disabled',
      };
    }

    // 命令行强制启用 GPU
    if (
      app.commandLine.hasSwitch('ignore-gpu-blocklist') ||
      app.commandLine.hasSwitch('enable-gpu')
    ) {
      return {
        available: true,
        tier: 'L3',
        isSoftwareRenderer: false,
        reason: 'User forced GPU enablement via command line',
        renderer: getRendererString(),
        vendor: getVendorString(),
        maxTextureSize: getMaxTextureSize(),
      };
    }

    // 正常设备：默认 L2（Canvas 2D 总是可用，WebGL 可用性待进一步验证）
    // TODO: 未来可创建离屏 WebGL context 进行实际能力探测
    return {
      available: true,
      tier: 'L2',
      isSoftwareRenderer: false,
      renderer: getRendererString(),
      vendor: getVendorString(),
      maxTextureSize: getMaxTextureSize(),
    };
  } catch {
    return {
      available: false,
      tier: 'L1',
      isSoftwareRenderer: false,
      reason: 'Detection failed (Electron app not available)',
    };
  }
}

/** 尝试获取 GPU renderer 字符串 */
function getRendererString(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return undefined;
    const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    return ext
      ? (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 尝试获取 GPU vendor 字符串 */
function getVendorString(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return undefined;
    const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    return ext ? (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined;
  } catch {
    return undefined;
  }
}

/** 尝试获取最大纹理尺寸 */
function getMaxTextureSize(): number | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return gl
      ? (gl as WebGLRenderingContext).getParameter((gl as WebGLRenderingContext).MAX_TEXTURE_SIZE)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 检测当前设备的渲染能力 */
export function detectRenderCapability(): RenderTier {
  return detectWebGLCapability().tier;
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
