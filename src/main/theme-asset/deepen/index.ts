// SPDX-License-Identifier: MPL-2.0

import { buildNativeDefectCss } from '../bridge/native-defect';

/**
 * 浅→深：为每个 agent 的 CSS 追加 native-defect 修正。
 * @param cssMap agentId → css 的映射
 * @returns 追加缺陷修正后的 cssMap
 */
export function deepenAll(cssMap: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [agentId, css] of Object.entries(cssMap)) {
    const hostScope = getHostScope(agentId);
    const defectCss = buildNativeDefectCss(agentId, hostScope);
    result[agentId] = `${css}\n${defectCss}`;
  }

  return result;
}

/** 获取 agent 的 CSS host scope */
function getHostScope(agentId: string): string {
  const hostMap: Record<string, string> = {
    traework: 'html.agentskin-host-traework',
    qoderwork: 'html.agentskin-host-qoderwork',
    workbuddy: 'html.agentskin-host-workbuddy',
    doubao: 'html.agentskin-host-doubao',
    codex: 'html.agentskin-host-codex',
    zcode: 'html.agentskin-host-zcode',
  };
  return hostMap[agentId] ?? `html.agentskin-host-${agentId}`;
}
