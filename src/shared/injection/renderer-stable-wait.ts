// SPDX-License-Identifier: MPL-2.0

/**
 * # renderer-stable-wait
 *
 * Renderer 稳定等待机制——轮询 CDP `/json/list`，直到目标页面 ID 连续稳定
 * 超过阈值后再返回，替代固定超时等待。
 *
 * ## 设计目标
 *
 * 当应用刚启动或正在导航时，CDP `/json/list` 返回的 target ID 可能频繁变化
 * （页面反复刷新、重定向、重新加载）。传统的固定超时等待（"等 N 秒再注入"）
 * 要么等得太久（注入慢），要么等不够（注入失败）。
 *
 * 本模块通过持续轮询检测 target ID 的**连续性稳定**：
 *   - 每次轮询提取目标页面 ID
 *   - 若 ID 与上次相同，累加稳定时间
 *   - 若 ID 变化，重置稳定计时器
 *   - 稳定时间 ≥ 阈值 → 返回 RendererInfo
 *   - 超过最大等待时间 → 抛出 RendererStableWaitTimeoutError
 *
 * ## 使用场景
 *
 * 仅适配 WorkBuddy 和 TRAE Work（通过 settings 中的 per-adapter 开关控制）。
 * 其他适配器继续使用现有的固定超时机制（`withPageSession` 的 retry 循环）。
 *
 * ## 可配置参数
 *
 *   - `stableThreshold` — 判定"稳定"的连续时长（默认 750ms）
 *   - `pollInterval` — 轮询间隔（默认 100ms）
 *   *   - `maxWait` — 最大等待时间（默认 10000ms）
 *
 * ## 依赖注入
 *
 * `listTargets` 作为参数注入（而非直接 import），使核心算法可在单元测试中
 * 用 mock 数据驱动，无需真实 CDP 端点。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 最小化的 CDP target 形态——仅 stable wait 所需的字段。 */
export interface CdpTargetMinimal {
  id: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

/** 稳定等待成功时返回的 renderer 信息。 */
export interface RendererInfo {
  /** 稳定命中时的 target ID。 */
  id: string;
  /** 命中时的页面 URL（可能为空）。 */
  url?: string;
  /** 命中时的 WebSocket 调试 URL（可能为空）。 */
  webSocketDebuggerUrl?: string;
  /** 从开始到稳定命中的实际耗时（ms）。 */
  elapsedMs: number;
}

/** 稳定等待的配置选项。 */
export interface RendererStableWaitOptions {
  /**
   * 判定"稳定"的连续时长（ms）。target ID 必须连续保持不变达到此阈值
   * 才算稳定。默认 750ms。
   */
  stableThreshold?: number;
  /** 轮询间隔（ms）。默认 100ms。 */
  pollInterval?: number;
  /**
   * 最大等待时间（ms）。超过此时间仍未稳定则抛出
   * {@link RendererStableWaitTimeoutError}。默认 10000ms。
   */
  maxWait?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEF_STABLE_THRESHOLD = 750;
const DEF_POLL_INTERVAL = 100;
const DEF_MAX_WAIT = 10_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * 稳定等待超时错误。当 target ID 在 `maxWait` 时间内未能连续稳定达到
 * `stableThreshold` 时抛出。
 */
export class RendererStableWaitTimeoutError extends Error {
  readonly code = 'RENDERER_STABLE_WAIT_TIMEOUT' as const;

  constructor(
    readonly maxWait: number,
    readonly stableThreshold: number,
    /** 超时前最后一轮观察到的 target ID（可能为 undefined）。 */
    readonly lastSeenId: string | undefined,
  ) {
    super(
      `Renderer stable wait timed out after ${maxWait}ms ` +
        `(stableThreshold=${stableThreshold}ms, lastSeenId=${lastSeenId ?? 'none'})`,
    );
    this.name = 'RendererStableWaitTimeoutError';
  }
}

/** 从 CDP target 列表中提取主页面 target。复用与 `pickPageTarget` 一致的逻辑：
 *   - type === 'page' 优先
 *   - 无 type 但 URL 看起来像真实页面（http/https/file）也接受 */
function pickStableTarget(targets: readonly CdpTargetMinimal[]): CdpTargetMinimal | undefined {
  return targets.find((t) => {
    if (t.type === 'page') return true;
    if (t.type === undefined || t.type === null) {
      const url = t.url ?? '';
      return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * 轮询 CDP `/json/list` 直到目标页面 ID 连续稳定超过阈值。
 *
 * @param listTargets  返回当前 CDP target 列表的异步函数。注入而非硬编码，
 *                     使核心算法可独立于真实 CDP 端点进行测试。
 * @param options      可配置参数（stableThreshold / pollInterval / maxWait）。
 * @returns 稳定命中时的 {@link RendererInfo}。
 * @throws {@link RendererStableWaitTimeoutError} 超过最大等待时间仍未稳定。
 */
export async function waitForRendererStable(
  listTargets: () => Promise<readonly CdpTargetMinimal[]>,
  options: RendererStableWaitOptions = {},
): Promise<RendererInfo> {
  const stableThreshold = options.stableThreshold ?? DEF_STABLE_THRESHOLD;
  const pollInterval = options.pollInterval ?? DEF_POLL_INTERVAL;
  const maxWait = options.maxWait ?? DEF_MAX_WAIT;

  const start = Date.now();
  let lastId: string | undefined;
  let stableSince = 0;

  while (Date.now() - start < maxWait) {
    const targets = await listTargets();
    const currentTarget = pickStableTarget(targets);
    const currentId = currentTarget?.id;

    if (currentId && currentId === lastId) {
      // ID 与上次相同——累加稳定时间
      if (Date.now() - stableSince >= stableThreshold) {
        return {
          id: currentId,
          url: currentTarget?.url,
          webSocketDebuggerUrl: currentTarget?.webSocketDebuggerUrl,
          elapsedMs: Date.now() - start,
        };
      }
    } else {
      // ID 变化或首次命中——重置稳定计时器
      lastId = currentId;
      stableSince = Date.now();
    }

    await sleep(pollInterval);
  }

  // 超时
  throw new RendererStableWaitTimeoutError(maxWait, stableThreshold, lastId);
}

/** 内部 sleep 函数——单独抽出以便测试时可通过 mock 控制。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
