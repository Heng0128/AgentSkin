// SPDX-License-Identifier: MPL-2.0

/**
 * # DIAGNOSTICS_KILL_SWITCH — per-Agent 诊断开关（审计 A-18 / R-23）
 *
 * 语义/样式漂移检测是"诊断"维度，不参与注入主流程。当某个 Agent 的采集或
 * 结构在这一版本迭代中暂不稳定（例如 DOM 节点极少、宿主类名频繁变动）时，
 * 一键按 Agent（或按 feature）关闭对应诊断，避免"单 Agent 不稳定拖垮整条
 * 回归/校验链路"。其余 Agent 与注入主流程不受影响。
 *
 * 取值约定：
 *   - 未登记     → 全部启用（默认）
 *   - true       → 该 Agent 的全部诊断关闭（应急）
 *   - { feature } → 仅关闭列出的 feature（细粒度；feature 见下方注释）
 *
 * ## 支持的 feature
 *   - `styleSampling` : buildStyleSamplingSnippet 的样式漂移采样/判定。
 *                       关闭后该 Agent 不再产出 styleDrift 判定（视为通过）。
 *
 * 设计约束：本模块零依赖、纯配置+纯函数，不 import 任何模块（不触碰
 * semantic-quant / injector 等边界），因此可被 runtime 任意模块引用。
 */

/**
 * per-Agent 诊断开关表。
 * key = adapter.id；value = true | { [feature]: true }
 * 工程约定：任何写入必须带注释说明"谁在何时为何关闭"，可审计。
 * 用普通对象（非 frozen）以便运行期配置注入与单测可写入。
 * @type {Record<string, boolean | Record<string, boolean>>}
 */
export const DIAGNOSTICS_KILL_SWITCH = {
  // 示例（需真实场景才写入，当前默认全开）：
  // zcode: { styleSampling: true }, // @engine 2026-08-19: zcode 节点极少、采样不看门
};

/**
 * 查询某 Agent 的某诊断 feature 是否启用。
 * @param {string} agentId
 * @param {string} feature
 * @returns {boolean} true=启用（参与诊断）；false=已 kill-switch 关闭
 */
export function isDiagnosticsEnabled(agentId, feature) {
  const entry = DIAGNOSTICS_KILL_SWITCH[agentId];
  if (entry === undefined || entry === null) return true;
  if (entry === true) return false;
  if (typeof entry === 'object' && entry[feature] === true) return false;
  return true;
}

/**
 * 断言式读取：返回关闭理由（供日志/报告输出），启用时返回 null。
 * @param {string} agentId
 * @param {string} feature
 * @returns {string|null} 关闭原因说明；启用时为 null
 */
export function diagnosticsKillReason(agentId, feature) {
  const entry = DIAGNOSTICS_KILL_SWITCH[agentId];
  if (entry === true) return `kill-switch:all`;
  if (entry && typeof entry === 'object' && entry[feature] === true) {
    return `kill-switch:${feature}`;
  }
  return null;
}