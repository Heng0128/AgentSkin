// SPDX-License-Identifier: MPL-2.0

/**
 * # overrides-store — 人工纠错与持久化（中轴阶段 5）
 *
 * 阶段 2 分类器输出处置 + evidence，但"错了没法修"（GOV-3）——本模块提供
 * 持久化的纠错闭环：
 *
 *   - **白名单（漏报→补）**：手动把元素补进处置集（分类器漏了它）。
 *   - **黑名单（误报→剔）**：把被误判的元素剔除处置集。
 *   - **阈值覆盖**：按 role 覆盖分类器阈值（阶段 5 的"阈值滑杆"数据源）。
 *   - **精确率/召回率**：人工确认视为 ground truth，对比分类器预测可算
 *     precision/recall —— 阶段 4 面板的"过度识别/漏识别计数"。
 *
 * 纯内存容器 + 序列化（`profiles/<agentId>/overrides.json`），磁盘读写由
 * 调用方负责（与 transform-ledger 同款契约）。
 */

import type { ComponentRole } from './native-profile';
import type { Treatment } from './treatment-classifier';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type OverrideKind = 'whitelist-add' | 'blacklist-remove';

export interface ElementOverride {
  /** 稳定元素引用（结构路径 + 标签指纹）。 */
  targetRef: string;
  kind: OverrideKind;
  treatment: Treatment;
  note?: string;
}

export interface ThresholdOverride {
  role: ComponentRole;
  /** 覆盖后的参数（只覆盖提供的字段）。 */
  params: Partial<{
    areaRatio: number;
    frostOpacity: number;
    frostBlurPx: number;
    contrastThreshold: number;
  }>;
}

export interface OverridesState {
  version: 1;
  agentId: string;
  elements: ElementOverride[];
  thresholds: ThresholdOverride[];
  /** 人工确认样本（true positive / false positive / false negative）。 */
  confirmations: Array<{
    targetRef: string;
    predicted: Treatment;
    confirmed: Treatment;
    timestamp: number;
  }>;
}

/** 精确率/召回率统计（阶段 4 面板的指标）。 */
export interface Metrics {
  /** 精确率 = TP / (TP + FP) —— 误报占比的反面。 */
  precision: number;
  /** 召回率 = TP / (TP + FN) —— 漏报占比的反面。 */
  recall: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class OverridesStore {
  private state: OverridesState;

  constructor(agentId: string, initial: Partial<Omit<OverridesState, 'agentId' | 'version'>> = {}) {
    this.state = {
      version: 1,
      agentId,
      elements: initial.elements ?? [],
      thresholds: initial.thresholds ?? [],
      confirmations: initial.confirmations ?? [],
    };
  }

  // -- 白/黑名单 ------------------------------------------------------------

  /** 加白：把漏报元素补进处置集。返回是否新增（同 ref+kind 去重）。 */
  whitelist(
    entry: Omit<ElementOverride, 'kind' | 'treatment'> & { treatment: Treatment },
  ): boolean {
    if (
      this.state.elements.some((e) => e.targetRef === entry.targetRef && e.kind === 'whitelist-add')
    ) {
      return false;
    }
    this.state.elements.push({ ...entry, kind: 'whitelist-add' });
    return true;
  }

  /** 加黑：把误报元素剔除处置集。 */
  blacklist(targetRef: string, note?: string): boolean {
    if (
      this.state.elements.some((e) => e.targetRef === targetRef && e.kind === 'blacklist-remove')
    ) {
      return false;
    }
    this.state.elements.push({ targetRef, kind: 'blacklist-remove', treatment: 'keep', note });
    return true;
  }

  /** 移除一条覆盖（误操作回退）。 */
  removeOverride(targetRef: string, kind?: OverrideKind): boolean {
    const before = this.state.elements.length;
    this.state.elements = this.state.elements.filter(
      (e) => !(e.targetRef === targetRef && (kind === undefined || e.kind === kind)),
    );
    return this.state.elements.length !== before;
  }

  listElements(): ElementOverride[] {
    return [...this.state.elements];
  }

  /** 查一条元素的覆盖（白名单优先返回）。 */
  overrideFor(targetRef: string): ElementOverride | undefined {
    return (
      this.state.elements.find((e) => e.targetRef === targetRef && e.kind === 'whitelist-add') ??
      this.state.elements.find((e) => e.targetRef === targetRef)
    );
  }

  // -- 阈值覆盖 -------------------------------------------------------------

  setThreshold(role: ComponentRole, params: ThresholdOverride['params']): void {
    const existing = this.state.thresholds.find((t) => t.role === role);
    if (existing) {
      existing.params = { ...existing.params, ...params };
    } else {
      this.state.thresholds.push({ role, params });
    }
  }

  getThreshold(role: ComponentRole): ThresholdOverride['params'] {
    return this.state.thresholds.find((t) => t.role === role)?.params ?? {};
  }

  listThresholds(): ThresholdOverride[] {
    return [...this.state.thresholds];
  }

  // -- 人工确认 + 指标 ------------------------------------------------------

  /** 记录一次人工确认（predicted = 分类器输出，confirmed = 用户判定）。 */
  confirm(targetRef: string, predicted: Treatment, confirmed: Treatment): void {
    this.state.confirmations.push({ targetRef, predicted, confirmed, timestamp: Date.now() });
  }

  /** 基于确认样本计算精确率/召回率。无样本 → 返回 null。 */
  metrics(): Metrics | null {
    const c = this.state.confirmations;
    if (c.length === 0) return null;
    // 将"处置为 frost/remove/transparentize（有变换）"视为正样本，
    // "keep" 视为负样本 —— 与阶段 2 的语义一致。
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const { predicted, confirmed } of c) {
      const predictedPositive = predicted !== 'keep';
      const confirmedPositive = confirmed !== 'keep';
      if (confirmedPositive && predictedPositive) tp++;
      else if (!confirmedPositive && predictedPositive) fp++;
      else if (confirmedPositive && !predictedPositive) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    return { precision, recall, truePositive: tp, falsePositive: fp, falseNegative: fn };
  }

  listConfirmations(): OverridesState['confirmations'] {
    return [...this.state.confirmations];
  }

  // -- 序列化 ---------------------------------------------------------------

  toJson(): string {
    return JSON.stringify(this.state, null, 2);
  }

  static fromJson(raw: string, fallbackAgentId: string): OverridesStore | null {
    try {
      const parsed = JSON.parse(raw) as OverridesState;
      if (!parsed || typeof parsed !== 'object') return null;
      const store = new OverridesStore(parsed.agentId || fallbackAgentId);
      store.state.elements = Array.isArray(parsed.elements) ? parsed.elements : [];
      store.state.thresholds = Array.isArray(parsed.thresholds) ? parsed.thresholds : [];
      store.state.confirmations = Array.isArray(parsed.confirmations) ? parsed.confirmations : [];
      return store;
    } catch {
      return null;
    }
  }
}
