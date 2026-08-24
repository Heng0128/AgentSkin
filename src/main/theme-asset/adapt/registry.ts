// SPDX-License-Identifier: MPL-2.0

import type { AdapterResult, GeneratorInput } from '../ir/types';
import { toGeneratorInput } from './toGeneratorInput';
import { AGENT_IDS, type AgentId } from '@shared/types/agent';

export type { AgentId };

/**
 * 为单个 agent 生成 CSS。
 * 当前实现：返回 GeneratorInput（后续接入 GENERATORS 时扩展）。
 * TODO P1: 接入 scripts/generators/ 的 6 个 GENERATORS 函数
 */
export function generateForAgent(input: GeneratorInput, agentId: AgentId): string {
  // P1 placeholder: 返回 tokenBlock 形式的 CSS 变量
  // TODO: 调用对应 agent 的 GENERATOR 函数
  const c = input.colors;
  const host = `html.agentskin-host-${agentId}`;
  return `${host} {
  color-scheme: ${input.isLight ? 'light' : 'dark'};
  --agentskin-accent: ${c.accent};
  --agentskin-secondary: ${c.secondary};
  --agentskin-bg: ${c.background};
  --agentskin-surface: ${c.surface};
  --agentskin-surface-elevated: ${c.surfaceElevated};
  --agentskin-text: ${c.foreground};
  --agentskin-muted: ${c.muted};
  --agentskin-border: ${c.border};
  --agentskin-code-bg: ${c.codeBackground};
  --agentskin-code-fg: ${c.codeForeground};
  --agentskin-input-bg: ${c.inputBackground};
  --agentskin-button-bg: ${c.buttonBackground};
  --agentskin-button-fg: ${c.buttonForeground};
  --agentskin-focus-ring: ${c.focusRing}`;
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
