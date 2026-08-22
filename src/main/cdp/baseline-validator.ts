// SPDX-License-Identifier: MPL-2.0

/**
 * # baseline-validator — 原生基准复刻校验器（RFC §6 / §8 序 6）
 *
 * 作用（对齐审计 §六 P1「实现基准复刻校验逻辑，复刻失败触发降级」）：
 *
 *   在允许加载任何**自定义**主题之前，引擎必须先能完整复刻该应用的原生
 *   亮 / 暗主题。本校验器采集一段原生基准（`BaselineCssCapture`），经
 *   {@link baseline-css-replay} 回注后做一次轻探针，对比「回注后页面实际
 *   计算样式」与「采集时的原生真值快照」，得到逐维度的**还原度匹配**。
 *
 *   判定规则：
 *     - 还原度 ≥ `minMatchRatio`（默认 0.8）且关键载体节点命中 → 复刻成功，
 *       允许继续加载自定义主题。
 *     - 否则 → 复刻失败，返回 `degraded=true`，由调用方**降级**（禁止加载
 *       自定义主题，回落原生）。
 *
 * 设计要点：
 *   - `assessFidelity` 为**纯函数**（无 CDP 依赖），可独立单测。它只比较
 *     两个快照的数据结构（采集时的真值 vs 回注后的实况），差分容差可通过
 *     options 注入。
 *   - 色彩比较使用归一化 RGB 距离（0..1，越小越接近），近似「ΔE」概念但
 *     无需引入色彩科学库；阈值对齐审计 §P0「高还原」标准（ΔE≈3 对应
 *     normalized ≈ 0.01，宽松取 0.05 以便跨设备稳定）。
 *   - CDP 编排 `validateBaselineCss` best-effort：任一探针 / 回注失败都会
 *     被捕获并视作「不可信」，倾向降级而不是误放行。
 */

import { toMessage } from '../../shared/errors';
import { mainWarn } from '../logger';
import type { BaselineCssCapture } from './baseline-css-capture';
import { replayBaseline, stopReplay } from './baseline-css-replay';
import type { CdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// 校验快照形状
// ---------------------------------------------------------------------------

/**
 * 一次「原生基准校验探针」采集到的关键计算样式（轻探针，不解析全部 DOM）。
 *
 * 通过 CDP `Runtime.evaluate` 从以下锚点读取：
 *   - 根元素：背景色 / 文字色 / 强调色（读取原生 -- 变量与 computed 值）
 *   - 是否存在已挂载的 AgentSkin owned styleSheet（adoptedSheetCount>0 表示
 *     replay 的规则确实进了 adoptedStyleSheets）
 *   - 关键 carrier 节点存在性（组件语义锚点）
 */
export interface BaselineProbe {
  /** 根元素 computed background-color（'rgb(...)' 或 ''） */
  rootBg: string;
  /** 根元素 computed color */
  rootColor: string;
  /** 根元素 computed overflow-x 是否为 hidden（侧边栏布局常态） */
  rootOverflowHidden: boolean;
  /** 挂载的 AgentSkin owned styleSheet 数量 */
  adoptedSheetCount: number;
  /** 关键 carrier 节点是否存在（组件语义锚点命中） */
  carrierPresent: boolean;
}

/** 校验维度差分结果。 */
export interface FidelityDimension {
  key: keyof BaselineProbe;
  /** 该维度是否在容差内通过 */
  pass: boolean;
  /** 归一化差异（0..1，0=完全一致）。非颜色维度用 0 / 1。 */
  diff: number;
}

/** 校验结论。 */
export interface FidelityVerdict {
  /** 是否复刻成功 */
  pass: boolean;
  /** 加权匹配率（pass 维度 / 总维度） */
  matchRatio: number;
  /** 是否触发降级（复刻失败） */
  degraded: boolean;
  /** 逐维度细节 */
  dimensions: FidelityDimension[];
  /** 编排/探针异常信息（可选，仅诊断用，不影响维度语义） */
  gateError?: string;
}

/** 校验阈值可配项。 */
export interface ValidateOptions {
  /** 匹配率达到该值判定 pass（默认 0.8） */
  minMatchRatio?: number;
  /** 色彩维度归一化距离阈值（默认 0.05，约对应视觉可感受差异边缘） */
  colorTolerance?: number;
  /** 「明显错乱」严重色偏阈值（默认 0.5，完整反色 ≈ 1）。超过即硬门控降级 */
  severeColorTolerance?: number;
}

// ---------------------------------------------------------------------------
// 纯逻辑：色彩距离
// ---------------------------------------------------------------------------

/**
 * 将 '#rgb' / '#rrggbb' 十六进制解析为 RGB 数值；解析失败返回 null。
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().toLowerCase();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => `${c}${c}`)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return {
    r: parseInt(`${h[0]}${h[1]}`, 16),
    g: parseInt(`${h[2]}${h[3]}`, 16),
    b: parseInt(`${h[4]}${h[5]}`, 16),
  };
}

/**
 * 归一化 RGB 距离：两点在 0..1 立方体中的欧氏距离（0=相同，1=极端相反）。
 * 非 `rgb(...)` / `#hex` 的字符串无法解析时返回 1（视为完全不可比 → 差异最大，
 * 以保守方向迫使降级）。
 */
export function normalizedColorDistance(a: string, b: string): number {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return 1;
  const dr = pa.r - pb.r;
  const dg = pa.g - pb.g;
  const db = pa.b - pb.b;
  // 分母 sqrt(3*255^2) 归一化到 0..1
  return Math.sqrt((dr * dr + dg * dg + db * db) / (3 * 255 * 255));
}

function parseColor(input: string): { r: number; g: number; b: number } | null {
  const s = (input ?? '').trim();
  const hex = hexToRgb(s);
  if (hex) return hex;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (!m) return null;
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  return { r: clamp(Number(m[1])), g: clamp(Number(m[2])), b: clamp(Number(m[3])) };
}

// ---------------------------------------------------------------------------
// 纯逻辑：还原度判定
// ---------------------------------------------------------------------------

/**
 * 判定「回注后实况探针」相对「采集时真值快照」的还原度（纯函数）。
 *
 * 每个维度独立计算 `diff` 与 `pass`：
 *   - 颜色维度（rootBg / rootColor）：normalizedColorDistance ≤ colorTolerance。
 *   - 布尔维度（rootOverflowHidden / carrierPresent）：完全相等才 pass。
 *   - adoptedSheetCount：≥1 才 pass（replay 规则确实挂载进 adoptedStyleSheets）。
 *
 * 降级语义（对齐审计「复刻失败即降级」的严格性）：
 *
 *   - **硬门控维度**：
 *     1. `carrierPresent`——原生载体节点丢失；
 *     2. `adoptedSheetCount`——注入根本没挂载进 adoptedStyleSheets；
 *     3. `severeColor`——背景或文字出现**严重色偏**（归一化距离 >
 *        `severeColorTolerance`，默认 0.5），即明显错乱（如完整反色）。
 *     三者任一触发 → 无条件 `degraded=true`，无论其它维度多吻合。
 *   - **柔性维度**：轻微颜色漂移（≤ colorTolerance）+ `rootOverflowHidden`。
 *     走比例，轻微漂移可容忍、明显漂移配合 `minMatchRatio` 触发降级。
 *
 * 匹配率 = pass 维度数 / 总维度数。`pass = matchRatio >= minMatchRatio`。
 */
export function assessFidelity(
  baseline: BaselineProbe,
  replayed: BaselineProbe,
  opts: ValidateOptions = {},
): FidelityVerdict {
  const colorTolerance = opts.colorTolerance ?? 0.05;
  const minMatchRatio = opts.minMatchRatio ?? 0.8;
  // 「明显错乱」阈值：超过该归一化距离即视为复刻失败（完整反色 ≈ 1）。
  const severeColorTolerance = opts.severeColorTolerance ?? 0.5;

  const bgDiff = normalizedColorDistance(baseline.rootBg, replayed.rootBg);
  const colorDiff = normalizedColorDistance(baseline.rootColor, replayed.rootColor);
  const flushOverflow = baseline.rootOverflowHidden === replayed.rootOverflowHidden;
  const flushCarrier = baseline.carrierPresent === replayed.carrierPresent;
  const sheetMounted = replayed.adoptedSheetCount >= 1;
  const severeColor = bgDiff > severeColorTolerance || colorDiff > severeColorTolerance;

  const dimensions: FidelityDimension[] = [
    { key: 'rootBg', pass: bgDiff <= colorTolerance, diff: bgDiff },
    { key: 'rootColor', pass: colorDiff <= colorTolerance, diff: colorDiff },
    { key: 'rootOverflowHidden', pass: flushOverflow, diff: flushOverflow ? 0 : 1 },
  ];

  // 硬门控维度单独加入（不参与柔性比例，但独立决定降级）
  const fatal: FidelityDimension[] = [
    { key: 'carrierPresent', pass: flushCarrier, diff: flushCarrier ? 0 : 1 },
    { key: 'adoptedSheetCount', pass: sheetMounted, diff: sheetMounted ? 0 : 1 },
  ];
  dimensions.push(...fatal);

  const passCount = dimensions.filter((d) => d.pass).length;
  const matchRatio = dimensions.length ? passCount / dimensions.length : 0;

  // 任一硬门控失配 → 无条件降级
  if (!flushCarrier || !sheetMounted || severeColor) {
    return { pass: false, matchRatio, degraded: true, dimensions };
  }

  const ok = matchRatio >= minMatchRatio;
  return { pass: ok, matchRatio, degraded: !ok, dimensions };
}

// ---------------------------------------------------------------------------
// CDP 探针表达式
// ---------------------------------------------------------------------------

/**
 * 在页面中执行轻探针，返回结构化结果；失败抛错（由编排器捕获）。
 */
export async function probeNativeBaseline(session: CdpSession): Promise<BaselineProbe> {
  const raw = await session.evaluate(`(() => {
    const root = getComputedStyle(document.documentElement);
    const carrier = {
      any: ['.panel-container','.agents-layout-root','.teams-container','#root','main.main-surface','body']
        .map(s => { try { return !!document.querySelector(s); } catch { return false; } }),
    }['any'].some(Boolean);
    return JSON.stringify({
      rootBg: root.backgroundColor,
      rootColor: root.color,
      rootOverflowHidden: root.overflowX === 'hidden' || root.overflowY === 'hidden',
      adoptedSheetCount: (document.adoptedStyleSheets || []).filter(s => s.__agentskin_owned === true).length,
      carrierPresent: carrier,
    });
  })()`);
  return JSON.parse(raw) as BaselineProbe;
}

// ---------------------------------------------------------------------------
// 编排器
// ---------------------------------------------------------------------------

/**
 * 校验「能否复刻原生基准」：
 *
 *   1. 先对当前页做一次真值探针（此时应处于原生未注入主题的状态）。
 *   2. 回注采集到的原生规则（replayBaseline）。
 *   3. 再探针实况。
 *   4. assessFidelity 判定还原度。
 *   5. finally 撤销回注（stopReplay 回落）。
 *
 * 返回 verdict；任何一步失败都会产生 `degraded=true` 的结论（保守降级）。
 * 调用方据此决定是否放行自定义主题加载。
 */
export async function validateBaselineCss(
  session: CdpSession,
  capture: BaselineCssCapture,
  opts: ValidateOptions = {},
): Promise<FidelityVerdict> {
  let baseline: BaselineProbe | null = null;
  let replayed: BaselineProbe | null = null;
  try {
    baseline = await probeNativeBaseline(session);
  } catch (error) {
    mainWarn('BaselineCss.Validate', `baseline probe failed, degrading: ${toMessage(error)}`);
    return { pass: false, matchRatio: 0, degraded: true, dimensions: [] };
  }

  try {
    const replayedOk = await replayBaseline(session, capture);
    if (!replayedOk) {
      mainWarn('BaselineCss.Validate', 'replay failed (no CSS adopted), degrading');
      return { pass: false, matchRatio: 0, degraded: true, dimensions: [] };
    }
    replayed = await probeNativeBaseline(session);
  } catch (error) {
    mainWarn('BaselineCss.Validate', `replay/probe failed, degrading: ${toMessage(error)}`);
    return {
      pass: false,
      matchRatio: 0,
      degraded: true,
      dimensions: [],
    };
  } finally {
    // 无论成功失败都撤销回注，回落原状态
    try {
      await stopReplay(session);
    } catch (error) {
      mainWarn('BaselineCss.Validate', `stopReplay failed: ${toMessage(error)}`);
    }
  }

  return assessFidelity(baseline, replayed, opts);
}
