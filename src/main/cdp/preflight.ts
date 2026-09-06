// SPDX-License-Identifier: MPL-2.0

/**
 * # preflight — DOM 锚点预检（合并模块）
 *
 * 由 `landmark-preflight.ts` 与 `per-window-preflight.ts` 合并而成。
 *
 * ## 职责
 *
 * 本模块提供注入前的 landmark 预检能力，分为两个层次：
 *
 * ### 1. 单 session 预检（原 landmark-preflight.ts）
 *
 * 在实际注入 CSS 之前，验证目标页面是否有所需的 DOM 锚点（landmarks）。
 * 灵感来自 CodeDrobe/core 项目的预检机制。
 *
 * 设计要点：
 *   - 使用单个 `Runtime.evaluate` IIFE 批量检测所有 landmarks，减少 CDP 往返。
 *   - 每个 landmark 返回：`{ name, found, matchedSelector, count }`。
 *   - required 缺失时 `passed = false`，阻止注入。
 *   - 非 required 缺失时产生 warning 但不影响 `passed`。
 *   - 无效 CSS 选择器不抛错，标记为未命中（防御性）。
 *   - 内置 6 个适配器的默认 landmark 定义。
 *
 * ### 2. 多窗口分类预检（原 per-window-preflight.ts）
 *
 * 参考 CodeDrobe/core 的多窗口处理策略：对每个 CDP target 单独运行
 * landmark preflight，将 target 分为三类：
 *
 *   - `primary`  — 所有 required landmarks 存在，可注入
 *   - `skipped`  — 缺少 required landmarks 但 URL 匹配已知特殊路由
 *                  （如 Codex 的 avatar-overlay），不阻塞整体流程
 *   - `failed`   — 缺少 required landmarks 且非特殊路由，视为不兼容
 *
 * 只有当 zero 个 primary 且存在 failed 时，整体流程才失败。
 * skipped 窗口仅记录日志，不影响注入。
 *
 * ## 与现有模块的关系：
 *   - `reload-watchdog.ts`：页面重载守护（注入后）。
 *   - `baseline-validator.ts`：基准复刻校验（注入中）。
 *   - `engine-strategy.ts`：注入引擎，调用本模块的 `getDefaultLandmarks` 与 `runLandmarkPreflight`。
 *   - `cdp-fanout.ts`：hardeningPass 在注入前调用本模块的分类功能。
 */

import type { LandmarkDefinition } from '../../shared/landmarks';
import type { CdpSession } from './cdp-client';
import { connectCdp } from './cdp-client';
import type { CdpTarget } from './cdp-targets';

// ---------------------------------------------------------------------------
// 类型定义 — 单 session 预检
// ---------------------------------------------------------------------------

/** 命中的 landmark。 */
export interface LandmarkHit {
  name: string;
  /** 实际命中的选择器。 */
  matchedSelector: string;
  /** 匹配的元素数量。 */
  count: number;
}

/** 缺失的 required landmark。 */
export interface LandmarkMiss {
  name: string;
  selectors: string[];
  routeHint?: string;
}

/** 缺失的非 required landmark 警告。 */
export interface LandmarkWarning {
  name: string;
  selectors: string[];
  routeHint?: string;
}

/** 单 session 预检结果。 */
export interface PreflightResult {
  /** 所有 required landmarks 都存在。 */
  passed: boolean;
  /** 命中的 landmarks。 */
  hits: LandmarkHit[];
  /** 缺失的 required landmarks。 */
  misses: LandmarkMiss[];
  /** 缺失的非 required landmarks 警告。 */
  warnings: LandmarkWarning[];
}

// ---------------------------------------------------------------------------
// 类型定义 — 多窗口分类
// ---------------------------------------------------------------------------

/** 目标分类状态。 */
export type TargetPreflightStatus = 'primary' | 'skipped' | 'failed';

/** 单个目标分类结果。 */
export interface TargetClassification {
  status: TargetPreflightStatus;
  /** 分类原因（skipped/failed 时必有）。 */
  reason?: string;
}

/** 多窗口预检汇总结果。 */
export interface PerWindowPreflightResult {
  primary: CdpTarget[];
  skipped: CdpTarget[];
  failed: CdpTarget[];
}

// ---------------------------------------------------------------------------
// 核心实现 — 单 session 预检
// ---------------------------------------------------------------------------

/**
 * 构建批量检测的 IIFE 表达式。
 *
 * 在页面中执行，遍历所有 landmarks，对每个 landmark 按选择器列表
 * 优先级尝试匹配。第一个命中即停，返回命中信息；全部未命中则标记
 * 为 `found: false`。无效选择器被静默捕获（不抛错）。
 */
function buildPreflightExpression(landmarks: LandmarkDefinition[]): string {
  return `(() => {
    const landmarks = ${JSON.stringify(landmarks)};
    const results = landmarks.map((lm) => {
      for (const sel of lm.selectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            return { name: lm.name, found: true, matchedSelector: sel, count: els.length };
          }
        } catch {
          // 无效选择器 — 静默跳过，尝试下一个候选。
        }
      }
      return { name: lm.name, found: false, count: 0 };
    });
    return JSON.stringify(results);
  })()`;
}

/** IIFE 返回的原始结果形状。 */
interface RawLandmarkResult {
  name: string;
  found: boolean;
  matchedSelector?: string;
  count: number;
}

/**
 * 执行 landmark 预检。
 *
 * 使用单个 `Runtime.evaluate` IIFE 批量检测所有 landmarks，减少 CDP
 * 往返。返回结构化的 `PreflightResult`，调用方可据此决定是否继续注入。
 *
 * @param session — 目标页面的 CDP 会话。
 * @param landmarks — 要检测的 landmark 定义列表。
 */
export async function runLandmarkPreflight(
  session: CdpSession,
  landmarks: LandmarkDefinition[],
): Promise<PreflightResult> {
  const hits: LandmarkHit[] = [];
  const misses: LandmarkMiss[] = [];
  const warnings: LandmarkWarning[] = [];

  // 空数组快速路径 — 无 landmark 需要检测，直接通过。
  if (landmarks.length === 0) {
    return { passed: true, hits, misses, warnings };
  }

  const expression = buildPreflightExpression(landmarks);
  const raw = await session.evaluate(expression);

  let parsed: RawLandmarkResult[];
  try {
    parsed = JSON.parse(raw) as RawLandmarkResult[];
  } catch {
    // CDP 返回了不可解析的内容 — 保守处理：所有 required 标记为缺失。
    for (const lm of landmarks) {
      if (lm.required) {
        misses.push({ name: lm.name, selectors: lm.selectors, routeHint: lm.routeHint });
      } else {
        warnings.push({ name: lm.name, selectors: lm.selectors, routeHint: lm.routeHint });
      }
    }
    return { passed: misses.length === 0, hits, misses, warnings };
  }

  // 以 name 索引结果，便于按定义顺序遍历。
  const resultByName = new Map<string, RawLandmarkResult>();
  for (const r of parsed) {
    resultByName.set(r.name, r);
  }

  for (const lm of landmarks) {
    const result = resultByName.get(lm.name);
    if (result?.found) {
      hits.push({
        name: result.name,
        matchedSelector: result.matchedSelector ?? '',
        count: result.count,
      });
    } else if (lm.required) {
      misses.push({ name: lm.name, selectors: lm.selectors, routeHint: lm.routeHint });
    } else {
      warnings.push({ name: lm.name, selectors: lm.selectors, routeHint: lm.routeHint });
    }
  }

  return { passed: misses.length === 0, hits, misses, warnings };
}

// ---------------------------------------------------------------------------
// 特殊路由检测
// ---------------------------------------------------------------------------

/**
 * 已知特殊路由模式（按 agent 分类）。
 *
 * 这些路由页面缺少适配器的 landmark（如主内容区、输入框），但属于
 * 正常次级窗口（弹出面板、浮层等），不应阻塞注入流程。
 *
 * 匹配策略：URL 包含 pattern 子串即视为命中（兼顾 query string 变化）。
 */
const SPECIAL_ROUTES: ReadonlyArray<{
  agentPattern: string;
  urlPattern: string;
  description: string;
}> = [
  {
    // Codex avatar-overlay 次级窗口
    agentPattern: 'codex',
    urlPattern: 'initialRoute=%2Favatar-overlay',
    description: 'avatar-overlay secondary window',
  },
  {
    // Codex welcome/onboarding 页面
    agentPattern: 'codex',
    urlPattern: 'initialRoute=%2Fwelcome',
    description: 'welcome/onboarding page',
  },
];

/**
 * 检测目标 URL 是否匹配已知特殊路由。
 *
 * @param target  CDP target
 * @param appId   当前 agent id（用于缩小匹配范围）
 * @returns 匹配结果，包含描述；null 表示不匹配
 */
function matchSpecialRoute(target: CdpTarget, appId: string): { description: string } | null {
  const url = target.url ?? '';
  for (const route of SPECIAL_ROUTES) {
    if (appId.includes(route.agentPattern) && url.includes(route.urlPattern)) {
      return { description: route.description };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 核心实现 — 多窗口分类
// ---------------------------------------------------------------------------

/** CDP 连接超时（ms）。 */
const CONNECT_TIMEOUT_MS = 5000;

/**
 * 预检超时（ms）：连接 + evaluate 总预算，避免单个慢目标阻塞整体。 */
const PREFLIGHT_TIMEOUT_MS = 5000;

/**
 * 对单个 target 运行 landmark preflight 并分类。
 *
 * 流程：
 *   1. 连接 target 的 CDP session（带超时）
 *   2. 运行 runLandmarkPreflight
 *   3. 所有 required landmarks 存在 → `primary`
 *   4. 缺少 required landmarks 但 URL 匹配特殊路由 → `skipped`
 *   5. 缺少 required landmarks 且非特殊路由 → `failed`
 *
 * 连接失败或 evaluate 异常时降级为 `failed`（保守处理）。
 *
 * @param target     CDP target 对象
 * @param landmarks  landmark 定义列表
 * @param appId      当前 agent id
 */
export async function classifyTarget(
  target: CdpTarget,
  landmarks: LandmarkDefinition[],
  appId: string,
): Promise<TargetClassification> {
  // 无 wsUrl 的目标无法连接，视为 failed
  if (!target.webSocketDebuggerUrl) {
    return { status: 'failed', reason: 'no webSocketDebuggerUrl' };
  }

  // 空 landmarks 快速路径 — 无约束时直接 primary
  if (landmarks.length === 0) {
    return { status: 'primary' };
  }

  const connectPromise = connectCdp(target.webSocketDebuggerUrl, CONNECT_TIMEOUT_MS);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('CDP connect timeout')), PREFLIGHT_TIMEOUT_MS),
  );

  let session: CdpSession;
  try {
    session = await Promise.race([connectPromise, timeoutPromise]);
  } catch {
    return { status: 'failed', reason: 'CDP connect failed or timed out' };
  }

  try {
    const preflightResult = await runLandmarkPreflight(session, landmarks);

    if (preflightResult.passed) {
      return { status: 'primary' };
    }

    // 缺少 required landmarks — 检查是否为已知特殊路由
    const special = matchSpecialRoute(target, appId);
    if (special) {
      return { status: 'skipped', reason: special.description };
    }

    // 非特殊路由 — 报告缺失的 landmark 名称
    const missingNames = preflightResult.misses.map((m) => m.name).join(', ');
    return { status: 'failed', reason: `missing required landmarks: ${missingNames}` };
  } catch {
    // evaluate 异常 — 保守降级为 failed
    return { status: 'failed', reason: 'landmark evaluation error' };
  } finally {
    try {
      session.close();
    } catch {
      /* ignore close errors */
    }
  }
}

/**
 * 对所有 DOM-bearing targets 运行 per-window preflight 并分类汇总。
 *
 * 每个 target 独立预检互不干扰（一个 target 失败不影响其他）。
 * 返回三分类结果供调用方决定注入策略：
 *   - 只对 `primary` 类别执行 engine 注入
 *   - `skipped` 类别记录日志但不注入
 *   - `primary` 为空且 `failed` 非空时调用方应抛出错误
 *
 * @param targets    DOM-bearing CDP targets 列表
 * @param landmarks  landmark 定义列表
 * @param appId      当前 agent id
 */
export async function runPerWindowPreflight(
  targets: CdpTarget[],
  landmarks: LandmarkDefinition[],
  appId: string,
): Promise<PerWindowPreflightResult> {
  const result: PerWindowPreflightResult = {
    primary: [],
    skipped: [],
    failed: [],
  };

  if (targets.length === 0) {
    return result;
  }

  // 所有 target 并行预检（各自有独立超时，互不阻塞）
  const classifications = await Promise.all(
    targets.map((target) => classifyTarget(target, landmarks, appId)),
  );

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const classification = classifications[i];
    switch (classification.status) {
      case 'primary':
        result.primary.push(target);
        break;
      case 'skipped':
        result.skipped.push(target);
        break;
      case 'failed':
        result.failed.push(target);
        break;
    }
  }

  return result;
}

/**
 * 根据 per-window preflight 结果决定是否应阻塞注入。
 *
 * 规则：zero 个 primary 且存在至少一个 failed → 阻塞。
 * 仅有 skipped（无 failed）时不阻塞。
 *
 * @param result per-window preflight 汇总结果
 */
export function shouldBlockInjection(result: PerWindowPreflightResult): boolean {
  return result.primary.length === 0 && result.failed.length > 0;
}

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export type { LandmarkDefinition } from '../../shared/landmarks';
export { getDefaultLandmarks } from '../../shared/landmarks';
