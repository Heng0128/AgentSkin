// SPDX-License-Identifier: MPL-2.0

/**
 * # baseline-gate
 *
 * 复刻校验 Gate（RFC §6 批 C / Step3）：自定义主题**加载前**的前置闸门。
 *
 * 两层分离：
 *   - `isBaselineFresh` / `assessBaselineGate` —— 纯函数：
 *     缺失真值 / 版本失配 / schema 失配 / 过期 → 禁止加载（降级）；
 *     新鲜 → 放行；复刻校验失败 → 降级。
 *   - `evaluateReplicationGate` —— 编排：给定 CDP 会话与一份真实采集到的
 *     `BaselineCssCapture`，跑「回注复刻 → 实况探针 → assessFidelity」，把结果
 *     归一为 `FidelityVerdict`（任何探针/复刻异常都保守降级）。
 *
 * 上层（apply 编排）把二者合并：先查是否有真值 → 有则新鲜性直判；
 * 否则跑 `evaluateReplicationGate` 拿 fidelity → 交给 `assessBaselineGate` 定闸。
 */

import { toMessage } from '../../shared/errors';
import type { BaselineCssCapture } from './baseline-css-capture';
import {
  assessFidelity,
  type FidelityVerdict,
  type ValidateOptions,
  validateBaselineCss,
} from './baseline-validator';
import type { CdpSession } from './cdp-client';

/** 快照新鲜期（ms）：≤此值免校验直用 */
export const BASELINE_GATE_FRESH_MS = 30 * 60 * 1000;

/**
 * 真值快照的最小元数据（门控判定所需）。
 */
export interface BaselineTruthMeta {
  appId: string;
  appVersion: string;
  themeMode: 'light' | 'dark';
  capturedAt: number;
  schemaVersion?: number;
}

/**
 * 复刻校验 Gate 结论。
 */
export type GateVerdict =
  | { gate: 'allow'; reason: 'fresh' | 'replication_ok'; matchRatio?: number }
  | {
      gate: 'degrade';
      reason: 'no_baseline' | 'expired' | 'replication_failed' | 'probe_failed' | 'schema_mismatch';
      message: string;
      matchRatio?: number;
    };

function degrade(
  reason: Extract<GateVerdict, { gate: 'degrade' }>['reason'],
  message: string,
  matchRatio?: number,
): GateVerdict {
  return { gate: 'degrade', reason, message, matchRatio };
}

/**
 * 判定真值快照是否在新鲜期内（≤ FRESH_MS）。
 *
 * @param truth 真值快照元数据；null 表示"无真值快照"
 * @param now 当前时间戳（ms）
 */
export function isBaselineFresh(truth: BaselineTruthMeta | null, now: number): boolean {
  if (!truth) return false;
  if (!Number.isFinite(truth.capturedAt)) return false;
  const age = now - truth.capturedAt;
  if (age < 0) return true;
  return age <= BASELINE_GATE_FRESH_MS;
}

/**
 * 纯函数门控判定（对齐 RFC Step3「缺失禁止加载闸」）。
 *
 * 顺序：
 *   1. 无真值快照          → `degrade:no_baseline`
 *   2. schema 失配         → `degrade:schema_mismatch`
 *   3. 已过期              → `degrade:expired`
 *   4. 新鲜且无需复刻校验   → `allow:fresh`
 *   5. 复刻校验失败        → `degrade:replication_failed`
 *   6. 复刻通过            → `allow:replication_ok`
 */
export function assessBaselineGate({
  truth,
  fidelity,
  now,
}: {
  truth: BaselineTruthMeta | null;
  fidelity: FidelityVerdict | null;
  now: number;
}): GateVerdict {
  if (!truth) {
    return degrade('no_baseline', 'no baseline truth snapshot for this app/version/theme mode');
  }
  if (truth.schemaVersion !== undefined && truth.schemaVersion !== 1) {
    return degrade(
      'schema_mismatch',
      `baseline schema mismatch (expected 1, got ${truth.schemaVersion})`,
    );
  }
  if (!isBaselineFresh(truth, now)) {
    return degrade('expired', 'baseline truth is stale; recapture before loading custom theme');
  }
  if (!fidelity) {
    return { gate: 'allow', reason: 'fresh' };
  }
  if (fidelity.degraded || !fidelity.pass) {
    return degrade(
      'replication_failed',
      `baseline replication fidelity ${Math.round(fidelity.matchRatio * 100)}% below gate threshold`,
      fidelity.matchRatio,
    );
  }
  return { gate: 'allow', reason: 'replication_ok', matchRatio: fidelity.matchRatio };
}

/**
 * 编排：执行真实复刻校验并归一为 `FidelityVerdict`。
 *
 * 复用它已含的 finally-stopReplay，任何探针/复刻异常都经 catch 保守降级。
 *
 * @param session CDP 会话
 * @param capture 采集到的原生基准
 * @param opts 复刻校验阈值
 */
export async function evaluateReplicationGate(
  session: CdpSession,
  capture: BaselineCssCapture,
  opts: ValidateOptions = {},
): Promise<FidelityVerdict> {
  try {
    const verdict = await validateBaselineCss(session, capture, opts);
    // validateBaselineCss 会在内部吞掉探针/复刻异常并以「无维度」的降级 verdict
    // 返回；此处补一条诊断信息，便于上层区分「真降级」与「内部失败」。
    if (verdict.degraded && verdict.dimensions.length === 0 && !verdict.gateError) {
      return {
        ...verdict,
        gateError: 'baseline replication degraded (internal probe/replay failure)',
      };
    }
    return verdict;
  } catch (error) {
    return {
      pass: false,
      matchRatio: 0,
      degraded: true,
      dimensions: [],
      gateError: toMessage(error),
    };
  }
}

export type { FidelityVerdict, ValidateOptions }; // eslint-disable-line @typescript-eslint/no-unused-vars
// 便捷重导出：下游仅需 fidelity 原语时不必再 import baseline-validator。
export { assessFidelity };
