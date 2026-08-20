// SPDX-License-Identifier: MPL-2.0

/**
 * # index.ts — Theme Asset Engine 编排器入口
 *
 * 对外暴露统一的 convert() 接口，编排完整管线：
 * detect → parse → infer → adapt → deepen → enhance → verify
 *
 * P1 阶段仅支持离线转换（不依赖 CDP probe）。
 * P2 阶段新增 vscode-json / raw-css adapter + probe + fidelity 在线验证。
 */

import type { AdapterInput } from './ir/types';
import { type PipelineOptions, type PipelineOutput, runPipeline } from './pipeline';

export type { AgentId } from './adapt/registry';
export { toGeneratorInput } from './adapt/toGeneratorInput';
export { detectAndParse, registerAllAdapters } from './adapters/index';
export { buildNativeDefectCss, extractStructuralTemplate } from './bridge/index';
export { completeSurfaceLayering } from './enhance/layering';
export { applyPreset, getDefaultPreset, PRESETS } from './enhance/presets';
export type {
  DriftResult,
  DriftSignal,
  RegenResult,
  ThemeFingerprint,
  ThemeFingerprintBundle,
} from './fingerprint';
// P3 自愈闭环 — 指纹模块
export {
  captureFingerprint,
  computeCssHash,
  computeDriftScore,
  computeTokenHash,
  DRIFT_THRESHOLD,
  FINGERPRINT_VERSION,
  FingerprintCaptureError,
  loadBaseline,
  migrateFingerprint,
  normalizedColorDistance,
  REGEN_COOLDOWN_MS,
  REQUIRED_CONSECUTIVE_DRIFT,
  RegenError,
  regenerateTheme,
  saveBaseline,
  shouldAutoRegen,
} from './fingerprint';
export { inferPalette } from './infer/palette-infer';
// Re-export 错误类型
export {
  AdapterParseError,
  InferenceError,
  InputTooLargeError,
  InvalidInputError,
  ThemeAssetError,
  UnsupportedFormatError,
} from './ir/errors';
export { normalizeColors } from './ir/normalize';
// Re-export 主要类型
export type { AdapterInput, AdapterResult, GeneratorInput, VerifyReport } from './ir/types';
export type { PipelineOptions, PipelineOutput } from './pipeline';
export { contractCheck } from './verify/contract-check';
export type { FidelityReport, FidelityResult } from './verify/fidelity';
export { checkAllFidelity, checkFidelity, fidelityGate } from './verify/fidelity';
export type { ProbeReport, ProbeResult } from './verify/probe';
// P2 在线验证接口
export { probeAgent, probeAll } from './verify/probe';

/**
 * 转换外部主题为 AgentSkin 内部格式。
 *
 * @param input 适配器输入（path 或 buffer）
 * @param options 管线选项
 * @returns 管线输出（CSS × 6 + 验证报告）
 *
 * @example
 * ```typescript
 * const result = await convert(
 *   { path: '/path/to/theme.codedrobe-theme' },
 *   { themeId: 'my-theme' }
 * );
 * // result.cssOutputs.traework → CSS for TRAE Work
 * // result.report.passed → boolean
 * ```
 */
export async function convert(
  input: AdapterInput,
  options: PipelineOptions,
): Promise<PipelineOutput> {
  return runPipeline(input, options);
}

export { runPipeline } from './pipeline';
