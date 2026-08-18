// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp/renderer-rank
 *
 * 主 renderer 语义锚点判定（RFC 2026-08-18 多 renderer 目标编排，P0）。
 *
 * 当一个应用暴露**多个兼容的 page target**（codex 的 avatar-overlay、doubao 的
 * boot 页 + 主窗口、workbuddy 的多 target）时，「哪个是可见主窗口」不应依赖
 * `/json/list` 的返回顺序（顺序不可靠），而应由适配器的 {@link RendererHints}
 * 语义锚点稳定决定。本模块提供纯函数：rank / pickPrimary / partition。
 *
 * 口径约定：
 *   - 无 hints（未配置）时退化为现状：第一个 page target 即主 renderer。
 *   - `secondaryPatterns` 命中 → 显式判为次 renderer（后台/boot/浮层），不参与主窗口注入。
 *   - `preferredUrlPatterns`（有序）→ 首个命中的 target 为主 renderer。
 *   - `score` 回调 → 数值最高者为优先级最高的主 renderer。
 *   - 优先级：secondary 排除 > preferredUrlPatterns 有序命中 > score 排序 > 退化(第一个 page)。
 *
 * 本模块只做**排序/判定**，不打乱调用方的兼容目标集合（matchTarget 已过滤），
 * 且仅基于 CDP target 元数据（url/title/type），不依赖运行时 DOM。
 */

export interface RendererHints {
  /** 按序尝试的 URL 形态（正则）。首个命中的 target 即为主 renderer。 */
  preferredUrlPatterns?: string[];
  /** 主 renderer 判定回调：返回值越大，优先级越高。 */
  score?: (target: CdpTargetInfo) => number;
  /** 明确判为"次 renderer"（后台页/boot/浮层）的 URL 形态，不参与主窗口注入。 */
  secondaryPatterns?: string[];
}

/** 最小 CDP target 元数据形态（对应 engine types 的 CdpTarget 缺省字段）。 */
export interface CdpTargetInfo {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

export interface RendereredRankResult<T extends CdpTargetInfo = CdpTargetInfo> {
  /** 主 renderer，无任何候选时返回 undefined。 */
  primary: T | undefined;
  /** 候选主 renderer（排除 secondary 后、按 hint 排序的非主列表）。 */
  candidates: T[];
  /** 被 secondaryPatterns 显式排除的 target（后台/boot/浮层）。 */
  secondaries: T[];
  /** 命中的优先 pattern（用于诊断）。 */
  matchedPreferredPattern?: string;
}

const toPattern = (p: string): RegExp => {
  try {
    return new RegExp(p, 'i');
  } catch {
    // 非法正则按字面匹配退化（绝不抛错，避免污染注入主链路）。
    return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
};

/** 判断 target 是否为显式声明的次 renderer。 */
export function isSecondaryRenderer(
  hints: RendererHints | undefined,
  target: CdpTargetInfo,
): boolean {
  if (!hints?.secondaryPatterns || hints.secondaryPatterns.length === 0) return false;
  const url = String(target.url ?? '');
  const title = String(target.title ?? '');
  if (!url && !title) return false;
  return hints.secondaryPatterns.some((p) => toPattern(p).test(url) || toPattern(p).test(title));
}

/**
 * 对兼容 page target 集合执行主 renderer 判定。返回主/候选/次三分类。
 *
 * 仅应作用于**已通过 matchTarget 过滤的 page 类目标**。非 page 目标（webview/
 * iframe）不在此判定范围，调用方自行处理。
 */
export function partitionRenderers<T extends CdpTargetInfo>(
  hints: RendererHints | undefined,
  targets: readonly T[],
): RendereredRankResult<T> {
  const secondaries: T[] = [];
  const candidates: T[] = [];

  for (const target of targets) {
    if (isSecondaryRenderer(hints, target)) {
      secondaries.push(target);
      continue;
    }
    candidates.push(target);
  }

  if (candidates.length === 0) {
    return { primary: undefined, candidates, secondaries };
  }

  const orderedPreferred = hints?.preferredUrlPatterns ?? [];
  if (orderedPreferred.length > 0) {
    for (const pattern of orderedPreferred) {
      const re = toPattern(pattern);
      const hit = candidates.find((t) => {
        const url = String(t.url ?? '');
        const title = String(t.title ?? '');
        return re.test(url) || re.test(title);
      });
      if (hit) {
        return {
          primary: hit,
          candidates: candidates.filter((t) => t.id !== hit.id),
          secondaries,
          matchedPreferredPattern: pattern,
        };
      }
    }
  }

  if (typeof hints?.score === 'function') {
    let best = candidates[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const target of candidates) {
      const s = hints.score(target);
      if (s > bestScore) {
        bestScore = s;
        best = target;
      }
    }
    return {
      primary: best,
      candidates: candidates.filter((t) => t.id !== best.id),
      secondaries,
    };
  }

  // 退化：第一个 page target 即主 renderer。
  const primary = candidates[0];
  return { primary, candidates: candidates.slice(1), secondaries };
}

/** 便捷封装：仅返回主 renderer。 */
export function pickPrimaryRenderer<T extends CdpTargetInfo>(
  hints: RendererHints | undefined,
  targets: readonly T[],
): T | undefined {
  return partitionRenderers(hints, targets).primary;
}
