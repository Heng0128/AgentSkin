// SPDX-License-Identifier: MPL-2.0

/**
 * # fidelity.ts — 还原度验证
 *
 * 调用注入引擎的 baseline-validator 评估主题应用的还原度。
 * ⚠️ 需要活 CDP session（在线验证，不阻塞离线管线）。
 *
 * fidelityGate 是本模块内部的局部辅助函数，封装阈值比较逻辑。
 * 不是外部依赖，不引入跨模块耦合。
 */

import type { BaselineCssCapture } from '../../cdp/baseline-css-capture';
import type { FidelityVerdict } from '../../cdp/baseline-validator';
import { validateBaselineCss } from '../../cdp/baseline-validator';
import type { CdpSession } from '../../cdp/cdp-client';
import type { AgentId } from '../adapt/registry';

/** 单端还原度结果 */
export interface FidelityResult {
  agentId: AgentId;
  verdict: FidelityVerdict;
  pass: boolean;
  degraded: boolean;
}

/** 多端还原度报告 */
export interface FidelityReport {
  results: FidelityResult[];
  overallMatchRatio: number;
  allPassed: boolean;
  anyDegraded: boolean;
  timestamp: number;
}

/** 还原度阈值（RFC §4.2 / §12 P2 验收条款） */
const MATCH_RATIO_THRESHOLD = 0.8;

/**
 * 局部辅助函数：封装阈值比较逻辑。
 * @param verdict 还原度裁决
 * @returns { pass, degraded } 元组
 */
export function fidelityGate(verdict: FidelityVerdict): {
  pass: boolean;
  degraded: boolean;
} {
  return {
    pass: verdict.matchRatio >= MATCH_RATIO_THRESHOLD && !verdict.degraded,
    degraded: verdict.degraded,
  };
}

/**
 * 对单个 agent 执行还原度验证。
 * @param session CDP session
 * @param agentId agent 标识
 * @param capture 原生基准捕获
 */
export async function checkFidelity(
  session: CdpSession,
  agentId: AgentId,
  capture: BaselineCssCapture,
): Promise<FidelityResult> {
  const verdict = await validateBaselineCss(session, capture);
  const gate = fidelityGate(verdict);

  return {
    agentId,
    verdict,
    pass: gate.pass,
    degraded: gate.degraded,
  };
}

/**
 * 对所有 6 端执行还原度验证。
 * @param sessions agentId → CdpSession 映射
 * @param captures agentId → BaselineCssCapture 映射
 */
export async function checkAllFidelity(
  sessions: Partial<Record<AgentId, CdpSession>>,
  captures: Partial<Record<AgentId, BaselineCssCapture>>,
): Promise<FidelityReport> {
  const results: FidelityResult[] = [];

  for (const [agentId, session] of Object.entries(sessions)) {
    if (session && captures[agentId as AgentId]) {
      const result = await checkFidelity(
        session,
        agentId as AgentId,
        captures[agentId as AgentId]!,
      );
      results.push(result);
    }
  }

  const overallMatchRatio =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.verdict.matchRatio, 0) / results.length
      : 0;

  return {
    results,
    overallMatchRatio,
    allPassed: results.every((r) => r.pass),
    anyDegraded: results.some((r) => r.degraded),
    timestamp: Date.now(),
  };
}
