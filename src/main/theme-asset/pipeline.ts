// SPDX-License-Identifier: MPL-2.0

/**
 * # pipeline.ts — 管线编排器
 *
 * 定义 stage 顺序、错误边界，编排 7 个阶段：
 * detect → parse → infer → adapt → deepen → enhance → verify → install
 *
 * 设计约束：
 * 1. 每个 stage 独立可测
 * 2. 严格单向流动（probe/baseline 结果只进 verify 报告）
 * 3. 新增 stage 文件不改已有文件（开闭原则）
 * 4. 纯/不纯边界：GENERATORS 只读 ThemeColors
 */

import { adaptAll } from './adapt/registry';
import { detectAndParse } from './adapters/index';
import { deepenAll } from './deepen/index';
import { completeSurfaceLayering } from './enhance/layering';
import { inferPalette } from './infer/palette-infer';
import { ThemeAssetError } from './ir/errors';
import type { AdapterInput, PipelineContext, VerifyReport } from './ir/types';
import { contractCheck } from './verify/contract-check';

/** 管线选项 */
export interface PipelineOptions {
  /** 主题 ID（用于生成输出文件名） */
  themeId: string;
  /** 跳过 deepen 阶段（P1 默认跳过，缺陷修正留给主题自带 CSS） */
  skipDeepen?: boolean;
  /** 跳过 enhance 阶段（P1 默认跳过） */
  skipEnhance?: boolean;
}

/** 管线输出 */
export interface PipelineOutput {
  /** 最终上下文 */
  context: PipelineContext;
  /** 验证报告 */
  report: VerifyReport;
  /** 6 端 CSS 输出 */
  cssOutputs: Record<string, string>;
}

/**
 * 执行完整管线。
 * @param input 适配器输入（path 或 buffer）
 * @param options 管线选项
 * @returns 管线输出（上下文 + 报告 + CSS）
 */
export async function runPipeline(
  input: AdapterInput,
  options: PipelineOptions,
): Promise<PipelineOutput> {
  const ctx: PipelineContext = { input };

  // Stage 1-2: detect + parse（适配器自动探测并解析）
  try {
    ctx.adapterResult = await detectAndParse(input);
  } catch (error) {
    throw new ThemeAssetError(`detect/parse failed: ${(error as Error).message}`, 'parse', false);
  }

  // Stage 3: infer（部分 token → 完整 14-token）
  ctx.inferredColors = inferPalette(ctx.adapterResult);

  // Stage 4: adapt（1→6 缺端生成）
  ctx.cssOutputs = adaptAll(ctx.adapterResult, options.themeId);

  // Stage 5: deepen（浅→深，可选）
  if (!options.skipDeepen) {
    ctx.cssOutputs = deepenAll(ctx.cssOutputs);
  }

  // Stage 6: enhance（P2：surface 层次补全，默认必做）
  if (!options.skipEnhance && ctx.inferredColors) {
    ctx.inferredColors = completeSurfaceLayering(ctx.inferredColors);
  }

  // Stage 7: verify（只读校验）
  ctx.verifyReport = contractCheck(ctx.inferredColors ?? ctx.adapterResult);

  return {
    context: ctx,
    report: ctx.verifyReport,
    cssOutputs: ctx.cssOutputs,
  };
}
