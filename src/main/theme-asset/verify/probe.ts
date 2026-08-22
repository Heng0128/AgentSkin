// SPDX-License-Identifier: MPL-2.0

/**
 * # probe.ts — 实时 DOM 探针
 *
 * 调用注入引擎的 validateSelectors() 进行只读探测。
 * 验证 CSS 选择器在目标应用中的命中情况。
 *
 * ⚠️ 需要活 CDP session（在线验证，不阻塞离线管线）。
 * P1 阶段不调用，P2 集成。
 */

import type { CdpSession } from '../../cdp/cdp-client';
import { validateSelectors } from '../../cdp/selector-validator';
import type { AgentId } from '../adapt/registry';

/** 每个 agent 的关键选择器（用于命中检测） */
const CRITICAL_SELECTORS: Record<AgentId, string[]> = {
  traework: ['.task-list-base', '.chat-input-v2-input-box-editable', '.solo-lite-layout'],
  qoderwork: ['.qoder-sidebar', '.qoder-chat-input', '.qoder-layout'],
  workbuddy: ['.workbuddy-sidebar', '.workbuddy-input', '.workbuddy-main'],
  doubao: ['.doubao-sidebar', '.doubao-input', '.doubao-conversation'],
  codex: [
    "main[class*='MainContentSurface']",
    'nav[class*="sidebar"]',
    'button[class*="composer"]',
  ],
  zcode: ['.zcode-sidebar', '.zcode-input', '.zcode-layout'],
};

/** 单端探针结果 */
export interface ProbeResult {
  agentId: AgentId;
  hitRate: number;
  totalSelectors: number;
  hitSelectors: number;
  details: Array<{ selector: string; hit: boolean }>;
}

/** 多端探针报告 */
export interface ProbeReport {
  results: ProbeResult[];
  overallHitRate: number;
  passed: boolean;
  timestamp: number;
}

/**
 * 对单个 agent 执行实时 DOM 探针。
 * @param session CDP session（存活连接）
 * @param agentId agent 标识
 */
export async function probeAgent(session: CdpSession, agentId: AgentId): Promise<ProbeResult> {
  const selectors = CRITICAL_SELECTORS[agentId];
  const report = await validateSelectors(session, agentId, selectors);

  const hitCount = report.results.filter((r) => r.count > 0).length;
  const hitRate = hitCount / selectors.length;

  return {
    agentId,
    hitRate,
    totalSelectors: selectors.length,
    hitSelectors: hitCount,
    details: report.results.map((r) => ({
      selector: r.selector,
      hit: r.count > 0,
    })),
  };
}

/**
 * 对所有 6 端执行实时 DOM 探针。
 * @param sessions agentId → CdpSession 映射（仅包含有 session 的端）
 */
export async function probeAll(
  sessions: Partial<Record<AgentId, CdpSession>>,
): Promise<ProbeReport> {
  const results: ProbeResult[] = [];

  for (const [agentId, session] of Object.entries(sessions)) {
    if (session) {
      const result = await probeAgent(session, agentId as AgentId);
      results.push(result);
    }
  }

  const overallHitRate =
    results.length > 0 ? results.reduce((sum, r) => sum + r.hitRate, 0) / results.length : 0;

  return {
    results,
    overallHitRate,
    passed: overallHitRate >= 0.85, // RFC 阈值：≥ 85%
    timestamp: Date.now(),
  };
}
