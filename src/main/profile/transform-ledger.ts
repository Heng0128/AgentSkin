// SPDX-License-Identifier: MPL-2.0

/**
 * # transform-ledger — 变换台账（中轴阶段 3）
 *
 * 台账是"缺失参照物"的实体化：凡 AgentSkin 改变某元素渲染（打穿/毛玻璃/
 * 移除），记一条可命名、可量化、可单独开关的记录。**台账就是透明主题的
 * 地面真相**——从"说不清的视觉效果"变成"一组可描述、可回退的变换"。
 *
 * 设计要点（对齐 MATURATION-PLAN §2 阶段 3 + §7 决策 1）：
 *   - 每条 `LedgerEntry` 可单独开关（`enabled`），满足验收标准 3
 *     "可单独关闭一条并看到渲染回退"。
 *   - 稳定引用：`targetRef` 用结构路径 + 标签指纹（不依赖类名，见
 *     native-profile 的 buildRef），agent 升级改类名不失配。
 *   - 持久化：`toJson()`/`fromJson()` 纯序列化；磁盘读写由调用方负责
 *     （profiles/<agentId>/ledger.json），本模块保持纯内存。
 *   - `toCss()` 生成只含 enabled 条目的注入 CSS（回灌注入引擎的产物）。
 */

import { cssEscape } from '@shared/css-escape';
import type { Treatment } from './treatment-classifier';

export type LedgerAction = Treatment; // remove | transparentize | frost | keep

export interface LedgerParams {
  opacity?: number;
  blurPx?: number;
  washColor?: string;
  washStrength?: number;
}

export type LedgerSource = 'auto' | 'manual-add' | 'manual-override';

export interface LedgerBaseline {
  background?: string;
  color?: string;
}

export interface LedgerEntry {
  id: string;
  /** 稳定元素引用（结构路径 + 标签指纹，不依赖类名）。 */
  targetRef: string;
  action: LedgerAction;
  params?: LedgerParams;
  source: LedgerSource;
  /** 单条开关：false = 不注入，渲染回到基线。 */
  enabled: boolean;
  baseline: LedgerBaseline;
  /** 注入后的渲染值（由回灌引擎回填）。 */
  after?: LedgerBaseline;
}

export interface LedgerSummary {
  total: number;
  enabled: number;
  byAction: Record<LedgerAction, number>;
}

/** 台账：纯内存容器 + 序列化。 */
export class TransformLedger {
  private entries = new Map<string, LedgerEntry>();
  private counter = 0;

  /** 记录一条变换。同 targetRef + action 已存在 → 更新（保留原 id 与 enabled）。
   *  `enabled` 可省略，默认开启。 */
  upsert(
    entry: Omit<LedgerEntry, 'id' | 'enabled'> & { id?: string; enabled?: boolean },
  ): LedgerEntry {
    const existing = entry.id
      ? this.entries.get(entry.id)
      : this.findByRef(entry.targetRef, entry.action);
    if (existing) {
      const merged: LedgerEntry = {
        ...existing,
        params: entry.params,
        baseline: entry.baseline,
        after: entry.after,
        source: entry.source,
      };
      this.entries.set(existing.id, merged);
      return merged;
    }
    const id = entry.id ?? `ledger-${(++this.counter).toString(16)}`;
    const created: LedgerEntry = {
      id,
      targetRef: entry.targetRef,
      action: entry.action,
      params: entry.params,
      source: entry.source,
      enabled: entry.enabled ?? true,
      baseline: entry.baseline,
      after: entry.after,
    };
    this.entries.set(id, created);
    return created;
  }

  get(id: string): LedgerEntry | undefined {
    return this.entries.get(id);
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }

  /** 按 targetRef（可加 action 过滤）查找。 */
  findByRef(targetRef: string, action?: LedgerAction): LedgerEntry | undefined {
    return this.all().find(
      (e) => e.targetRef === targetRef && (action === undefined || e.action === action),
    );
  }

  /** 单条开关。返回切换后的状态。 */
  toggle(id: string, enabled?: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = enabled ?? !entry.enabled;
    return entry.enabled;
  }

  /** 按处置类型批量开关（整类 master switch，对应处置分档总控）。 */
  setActionEnabled(action: LedgerAction, enabled: boolean): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.action === action) {
        e.enabled = enabled;
        n++;
      }
    }
    return n;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  summary(): LedgerSummary {
    const all = this.all();
    const byAction: Record<LedgerAction, number> = {
      remove: 0,
      transparentize: 0,
      frost: 0,
      keep: 0,
    };
    for (const e of all) byAction[e.action]++;
    return {
      total: all.length,
      enabled: all.filter((e) => e.enabled).length,
      byAction,
    };
  }

  /** 生成只含 enabled 条目的注入 CSS（回灌注入引擎）。 */
  toCss(): string {
    const rules: string[] = [];
    for (const e of this.all()) {
      if (!e.enabled) continue;
      const selector = `[data-as-ref="${cssEscape(e.targetRef)}"]`;
      if (e.action === 'remove' || e.action === 'transparentize') {
        rules.push(`${selector} { background: transparent !important; }`);
      } else if (e.action === 'frost') {
        const opacity = e.params?.opacity ?? 0.65;
        const blurPx = e.params?.blurPx ?? 20;
        rules.push(
          `${selector} { background: rgba(255,255,255,${opacity.toFixed(2)}) !important; backdrop-filter: blur(${blurPx}px) !important; }`,
        );
      }
      // keep → 不产出规则（保持原样即无操作）。
    }
    return rules.join('\n');
  }

  /** 序列化（持久化用）。 */
  toJson(): string {
    return JSON.stringify({ version: 1, entries: this.all() }, null, 2);
  }

  /** 从序列化 JSON 恢复。损坏 → 返回空台账并保留原内容不变。 */
  static fromJson(raw: string, existing?: TransformLedger): TransformLedger {
    let parsed: { entries?: LedgerEntry[] } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return existing ?? new TransformLedger();
    }
    const ledger = existing ?? new TransformLedger();
    if (!Array.isArray(parsed?.entries)) return ledger;
    for (const e of parsed.entries) {
      if (!e || typeof e.targetRef !== 'string' || typeof e.action !== 'string') continue;
      ledger.upsert({
        id: e.id,
        targetRef: e.targetRef,
        action: e.action as LedgerAction,
        params: e.params,
        source: e.source ?? 'auto',
        enabled: e.enabled !== false,
        baseline: e.baseline ?? {},
        after: e.after,
      });
    }
    return ledger;
  }
}
