// SPDX-License-Identifier: MPL-2.0

/**
 * # IR 类型定义 — Theme Asset Engine 管线内部类型
 *
 * 定义适配器、推导器、适配层之间的数据结构契约。
 * 这些类型仅在 theme-asset 模块内部使用，不对外暴露。
 */

import type { ThemeColors } from '../../../main/catalog/theme-manifest';

/** 适配器输入：支持文件路径或内存 buffer */
export interface AdapterInput {
  /** 主题包路径（文件/目录） */
  path?: string;
  /** 内存 buffer（优先级低于 path） */
  buffer?: Buffer;
  /** 原始文件名（用于格式嗅探） */
  filename?: string;
}

/** 适配器输出：统一的中间表示 */
export interface AdapterResult {
  /** 14-token + 扩展色集 */
  colors: ThemeColors;
  /** 可选元数据 */
  meta?: {
    name?: string;
    author?: string;
    license?: string;
    /** 源格式标识（如 'codedrobe'、'legacy-codex'） */
    sourceFormat: string;
    /** 源 URL（可选） */
    sourceUrl?: string;
  };
  /** 适配器置信度（0-1），低置信度时 verify 阶段标记 */
  confidence?: number;
}

/** 适配器接口：每个输入格式实现此契约 */
export interface ThemeAdapter {
  /** 优先级（数字越小优先级越高） */
  priority: number;
  /** 探测输入是否匹配本适配器 */
  detect(input: AdapterInput): Promise<boolean> | boolean;
  /** 解析输入 → AdapterResult */
  parse(input: AdapterInput): Promise<AdapterResult> | AdapterResult;
}

/** GENERATORS 消费的标准输入形状（与 buildContext() 输出一致） */
export interface GeneratorInput {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  isLight: boolean;
  colors: ThemeColors;
  signature?: Record<string, unknown> | null;
  /** Optional double-layer variable bridge: client-native CSS var → agentskin token / literal */
  variableBridge?: Record<string, string> | null;
}

/** 管线上下文：在 stage 间传递 */
export interface PipelineContext {
  /** 原始输入 */
  input: AdapterInput;
  /** adapter 输出（parse 阶段后填充） */
  adapterResult?: AdapterResult;
  /** 推导后的完整 14-token（infer 阶段后填充） */
  inferredColors?: ThemeColors;
  /** 6 端 CSS 输出（adapt 阶段后填充） */
  cssOutputs?: Record<string, string>;
  /** 验证报告（verify 阶段后填充） */
  verifyReport?: VerifyReport;
}

/** 验证报告 */
export interface VerifyReport {
  /** 是否通过 */
  passed: boolean;
  /** 14-token 覆盖率（0-1） */
  tokenCoverage: number;
  /** 各端生成状态 */
  agentStatus: Record<string, 'ok' | 'skipped' | 'failed'>;
  /** 警告信息 */
  warnings: string[];
}
