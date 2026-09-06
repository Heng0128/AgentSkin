// SPDX-License-Identifier: MPL-2.0

import codexCss from '@shared/theme/generators/codexCss.mjs';
import doubaoCss from '@shared/theme/generators/doubaoCss.mjs';
import qoderworkCss from '@shared/theme/generators/qoderworkCss.mjs';
import traeworkCss from '@shared/theme/generators/traeworkCss.mjs';
import workbuddyCss from '@shared/theme/generators/workbuddyCss.mjs';
import zcodeCss from '@shared/theme/generators/zcodeCss.mjs';
import { AGENT_IDS, type AgentId } from '@shared/types/agent';
import type { AdapterResult, GeneratorInput } from '../ir/types';
import { toGeneratorInput } from './toGeneratorInput';

export type { AgentId };

/** Generator function shape: consumes GeneratorInput, returns complete CSS string */
type GeneratorFn = (input: GeneratorInput) => string;

/**
 * Agent → GENERATOR 映射表。
 * 每个 generator 是 scripts/generators/<agent>Css.mjs 的 default export，
 * 接收 GeneratorInput 返回完整 CSS（tokenBlock + agent-specific 规则 + artLayer）。
 */
const GENERATORS: Record<AgentId, GeneratorFn> = {
  traework: traeworkCss,
  doubao: doubaoCss,
  workbuddy: workbuddyCss,
  qoderwork: qoderworkCss,
  codex: codexCss,
  zcode: zcodeCss,
};

/**
 * 为单个 agent 生成 CSS。
 * 调用对应 agent 的 GENERATOR 函数产出完整 CSS。
 */
export function generateForAgent(input: GeneratorInput, agentId: AgentId): string {
  const generator = GENERATORS[agentId];
  if (!generator) {
    // 防御性 fallback：理论上不会到达（AGENT_IDS 与 GENERATORS 一一对应）
    throw new Error(`No GENERATOR registered for agent: ${agentId}`);
  }
  return generator(input);
}

/**
 * 为 6 个 agent 生成 CSS。
 * @param result 适配器输出
 * @param themeId 主题 ID
 * @returns agentId → css 映射
 */
export function adaptAll(result: AdapterResult, themeId: string): Record<string, string> {
  const generatorInput = toGeneratorInput(result, themeId);
  const outputs: Record<string, string> = {};

  for (const agentId of AGENT_IDS) {
    outputs[agentId] = generateForAgent(generatorInput, agentId);
  }

  return outputs;
}
