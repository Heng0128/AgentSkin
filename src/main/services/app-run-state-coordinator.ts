// SPDX-License-Identifier: MPL-2.0

/**
 * # AppRunStateCoordinator — 运行时状态协调器
 *
 * 统一管理外部 Electron 应用的运行时状态，解决 appsStore 与
 * AgentEngineService 之间的状态分裂问题。
 *
 * ## 职责边界
 *
 * - **持有**: 运行时状态 (running/debugReady/pid/port)
 * - **分发**: 状态变更事件 (EventEmitter)
 * - **不持有**: 主题域数据、持久化数据、适配器元数据
 *
 * ## 设计借鉴
 *
 * - Browserless Session 模型: 连接即服务，超时清理
 * - Puppeteer Connection 层: 分层管理 CDP 连接
 * - chromedp Context 取消传播: 连接断开时级联清理
 *
 * ## 使用方式
 *
 * ```typescript
 * // 订阅状态变更
 * const unsub = coordinator.onStatusChange((appId, state) => {
 *   console.log(`${appId} is now ${state.running ? 'running' : 'stopped'}`);
 * });
 *
 * // 更新状态
 * coordinator.updateState(appId, { running: true, pid: 1234, port: 9222 });
 * ```
 */

import { EventEmitter } from 'node:events';
import type { AppRunState } from '../../shared/types/agent';

// ---------------------------------------------------------------------------
// Types — AppRunState is defined in shared/types/agent.ts (single source of truth)
// ---------------------------------------------------------------------------

/** Re-export for backward compatibility (consumers importing from this file). */
export type { AppRunState } from '../../shared/types/agent';

/** 状态变更事件 payload */
export interface StatusChangeEvent {
  appId: string;
  state: AppRunState;
  prevState: AppRunState | null;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export interface AppRunStateCoordinatorOptions {
  /** 空闲会话超时 (ms)，超时后自动标记为 disconnected。默认 5 分钟。 */
  idleTTL?: number;
  /** 日志输出 sink (默认 no-op) */
  log?: (line: string) => void;
}

const DEFAULT_IDLE_TTL = 0; // 0 = disabled (avoid false-positive "running=false" for long-running apps)

export class AppRunStateCoordinator {
  /** 运行时状态存储: appId → state */
  private readonly stateMap = new Map<string, AppRunState>();

  /** 事件发射器 */
  private readonly emitter = new EventEmitter();

  /** 空闲会话超时计时器 */
  private readonly timers = new Map<string, NodeJS.Timeout>();

  private readonly idleTTL: number;
  private readonly log: (line: string) => void;

  constructor(options: AppRunStateCoordinatorOptions = {}) {
    this.idleTTL = options.idleTTL ?? DEFAULT_IDLE_TTL;
    this.log = options.log ?? (() => {});
    // R7: 设置合理上限（16），保留足够余量给多 store 订阅，同时不屏蔽泄漏警告
    this.emitter.setMaxListeners(16);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * 订阅状态变更事件。
   * @param listener 回调函数，接收 appId 和新旧状态
   * @returns 取消订阅函数
   */
  onStatusChange(listener: (event: StatusChangeEvent) => void): () => void {
    this.emitter.emit; // no-op, ensure initialized
    this.emitter.on('status-change', listener);
    return () => this.emitter.off('status-change', listener);
  }

  /**
   * 更新应用状态并触发事件分发。
   * 变更检测：如果所有运行时字段均未变化，则跳过 emit 以减少不必要的 re-render。
   * @param appId 应用 ID
   * @param partial 部分状态字段（未提供的字段保持原值）
   */
  updateState(appId: string, partial: Partial<AppRunState>): void {
    const prev = this.stateMap.get(appId) ?? null;
    const next: AppRunState = {
      running: partial.running ?? prev?.running ?? false,
      pid: partial.pid ?? prev?.pid ?? 0,
      port: partial.port ?? prev?.port ?? null,
      debugReady: partial.debugReady ?? prev?.debugReady ?? false,
      updatedAt: Date.now(),
    };

    // 变更检测：比较除 updatedAt 外的所有字段
    if (
      prev &&
      prev.running === next.running &&
      prev.pid === next.pid &&
      prev.port === next.port &&
      prev.debugReady === next.debugReady
    ) {
      // 无变化，跳过 emit（仅更新时间戳）
      prev.updatedAt = next.updatedAt;
      return;
    }

    this.stateMap.set(appId, next);
    this.resetIdleTimer(appId, next);

    const event: StatusChangeEvent = { appId, state: next, prevState: prev };
    this.emitter.emit('status-change', event);
  }

  /**
   * 获取单个应用的运行时状态。
   * @returns 状态副本（浅拷贝），或 null（未知应用）。返回的对象可安全修改。
   */
  getState(appId: string): AppRunState | null {
    const state = this.stateMap.get(appId);
    return state ? { ...state } : null;
  }

  /**
   * 获取所有运行时状态的快照副本。
   * @returns Map 和值的深拷贝（外部修改不影响内部）。
   */
  getSnapshot(): Map<string, AppRunState> {
    return new Map(Array.from(this.stateMap, ([k, v]) => [k, { ...v }]));
  }

  /**
   * 移除应用状态（应用退出或卸载时调用）。
   */
  removeState(appId: string): void {
    this.stateMap.delete(appId);
    this.clearIdleTimer(appId);
    this.log(`[AppRunStateCoordinator] removed: ${appId}`);
  }

  /**
   * 清理所有状态（应用退出时调用）。
   * R7: 置空单例引用，防止 dispose 后外部持有旧实例。
   */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.stateMap.clear();
    this.emitter.removeAllListeners();
    // R7: 置空单例，确保下次 getAppRunStateCoordinator() 创建新实例
    _instance = null;
    this.log('[AppRunStateCoordinator] disposed');
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** 重置空闲超时计时器。idleTTL=0 时禁用（不启动计时器）。 */
  private resetIdleTimer(appId: string, state: AppRunState): void {
    if (!state.running || this.idleTTL <= 0) return;
    this.clearIdleTimer(appId);
    const timer = setTimeout(() => {
      this.updateState(appId, { running: false, debugReady: false });
      this.log(`[AppRunStateCoordinator] idle timeout: ${appId}`);
    }, this.idleTTL);
    this.timers.set(appId, timer);
  }

  /** 清除空闲超时计时器 */
  private clearIdleTimer(appId: string): void {
    const timer = this.timers.get(appId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(appId);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance (process-wide)
// ---------------------------------------------------------------------------

let _instance: AppRunStateCoordinator | null = null;

/** 获取协调器单例（进程级唯一） */
export function getAppRunStateCoordinator(): AppRunStateCoordinator {
  if (!_instance) {
    _instance = new AppRunStateCoordinator();
  }
  return _instance;
}
