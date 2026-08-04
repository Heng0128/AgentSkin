// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-watchdog — 周期主题自愈（B5 — CDP-3）
 *
 * 健康检查此前只在 apply 时跑一次（`hardeningPass` 内的 `checkThemeHealth`），
 * apply 之后 agent 升级/崩溃/被用户改动会静默破坏主题，无人发现。
 *
 * watchdog 以固定周期（默认 60s）对"已应用主题"的 agent 做**轻量探针**：
 *   - hostClass（`agentskin-host-<id>` 在 `<html>` 上）
 *   - adapter marker（`window.__agentskin_<id>_adapter__`）
 *   - adoptedStyleSheets 存在（theme sheet 未被 app 清除）
 *
 * 失败即触发自愈（重新 apply 主题 + hardening），但受频控约束：
 * **自愈 ≤3 次/小时**，避免循环失败把 CPU/端口打满。状态经回调推给 UI
 * （IPC），实时反映 `healthy | self-healing | degraded`。
 *
 * 本模块是**纯编排**：探针/自愈的具体动作通过 deps 注入（可单测），
 * 不直接持有 CDP 连接。
 */

import type { AgentId } from '../../shared/types';

export type WatchdogStatus = 'healthy' | 'self-healing' | 'degraded';

export interface WatchdogState {
  agentId: AgentId;
  status: WatchdogStatus;
  lastCheckAt: number;
  lastHealthyAt: number | null;
  consecutiveFailures: number;
  /** 自愈次数（滚动窗口内）。 */
  healsInWindow: number;
  windowStartedAt: number;
  lastError: string | null;
}

export interface WatchdogDeps {
  /** 该 agent 当前是否启用了主题（未启用则不探）。 */
  isThemeActive: (appId: AgentId) => boolean;
  /** 轻量探针：hostClass + adapter marker + sheet 存在。抛错/返回 false = 不健康。 */
  probe: (appId: AgentId) => Promise<boolean>;
  /** 触发自愈（重新 apply + hardening）。失败时抛错。 */
  heal: (appId: AgentId) => Promise<void>;
  /** 状态变更回调（IPC 推给 UI）。 */
  onState: (state: WatchdogState) => void;
  /** 日志。 */
  log: (line: string) => void;
}

/** 自愈频控：滚动窗口（毫秒）内的自愈次数上限。 */
export const HEAL_WINDOW_MS = 60 * 60 * 1000; // 1 小时
export const MAX_HEALS_PER_WINDOW = 3;
/** 连续失败超过该阈值 → 状态降级为 degraded（不再自愈，等用户介入）。 */
export const MAX_CONSECUTIVE_FAILURES = 3;

export class ThemeWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: WatchdogState;

  constructor(
    private readonly agentId: AgentId,
    private readonly deps: WatchdogDeps,
    private readonly intervalMs = 60_000,
  ) {
    this.state = {
      agentId,
      status: 'healthy',
      lastCheckAt: 0,
      lastHealthyAt: null,
      consecutiveFailures: 0,
      healsInWindow: 0,
      windowStartedAt: Date.now(),
      lastError: null,
    };
  }

  /** 立即探一次（启动时可用）。 */
  async checkNow(): Promise<WatchdogState> {
    this.state.lastCheckAt = Date.now();
    // 滚动窗口：窗口过期则清零自愈计数。
    if (Date.now() - this.state.windowStartedAt >= HEAL_WINDOW_MS) {
      this.state.windowStartedAt = Date.now();
      this.state.healsInWindow = 0;
    }

    if (!this.deps.isThemeActive(this.agentId)) {
      this.state.consecutiveFailures = 0;
      this.state.status = 'healthy';
      this.emit();
      return { ...this.state };
    }

    let healthy = false;
    try {
      healthy = await this.deps.probe(this.agentId);
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
    }

    if (healthy) {
      this.state.consecutiveFailures = 0;
      this.state.status = 'healthy';
      this.state.lastHealthyAt = Date.now();
      this.state.lastError = null;
      this.emit();
      return { ...this.state };
    }

    // 不健康 → 自愈（受频控约束）。
    this.state.consecutiveFailures++;
    if (
      this.state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
      this.state.healsInWindow >= MAX_HEALS_PER_WINDOW
    ) {
      this.state.status = 'degraded';
      this.state.lastError ??= 'exceeded heal budget';
      this.deps.log(
        `[watchdog] ${this.agentId}: degraded after ${this.state.consecutiveFailures} consecutive failures / ${this.state.healsInWindow} heals this hour`,
      );
      this.emit();
      return { ...this.state };
    }

    this.state.status = 'self-healing';
    this.emit();
    try {
      await this.deps.heal(this.agentId);
      this.state.healsInWindow++;
      this.state.consecutiveFailures = 0;
      this.state.status = 'healthy';
      this.state.lastHealthyAt = Date.now();
      this.state.lastError = null;
      this.deps.log(`[watchdog] ${this.agentId}: self-healed`);
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.deps.log(`[watchdog] ${this.agentId}: heal failed — ${this.state.lastError}`);
      // 自愈失败保持 self-healing，下一周期再试（频控兜底）。
    }
    this.emit();
    return { ...this.state };
  }

  /** 启动周期探针。幂等（重复调用不叠加定时器）。 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.checkNow().catch(() => undefined);
    }, this.intervalMs);
  }

  /** 停止探针并清理定时器。 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getState(): WatchdogState {
    return { ...this.state };
  }

  private emit(): void {
    try {
      this.deps.onState({ ...this.state });
    } catch {
      // UI 回调失败不打断探针循环。
    }
  }
}
