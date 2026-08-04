// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-watcher — 新窗口/新 webview 自动注入（B3 — CDP-1）
 *
 * 现状：`Target.getTargets` / HTTP `/json/list` 轮询，apply 后新开的
 * window/webview 不会自动上主题。watcher 通过 **browser 级 CDP 连接**
 * （`ws://host:port/devtools/browser/<token>`，token 来自 DevToolsActivePort
 * line2）订阅 `Target.setDiscoverTargets` 的 **事件流**：新 page/webview/
 * iframe 一出现就回调注入，无需轮询。
 *
 * 关键设计：
 *   - **去重**：`targetCreated` 事件可能重复（auto-attach + discovery 双通道），
 *     用 targetId 集合去重，注入成功后才加入已见集合。
 *   - **probe 白名单**：只注入 DOM 型（page/webview/iframe）且 URL 属于目标
 *     app 的 target（`app://` 或非 127.0.0.1 的 http/file）——跳过 devtools
 *     面板、service worker、AgentSkin 自己的壁纸 iframe。
 *   - **退避重连**：browser 端点断开（app 重启）→ 按 1s/2s/4s 指数退避重连，
 *     期间不清已见集合（避免重连后重复注入）。
 *   - **epoch 守卫**：注入回调带 epoch，被新 apply/restore 覆盖时自动跳过。
 *   - **降级**：browser 端点不可用（个别 agent 不暴露）→ 返回 `degraded`，
 *     调用方回退现状（轮询 /json/list），不回归。
 *
 * 纯编排：CDP 连接复用 `connectEventCdp`（B2 已提供事件感知客户端），
 * 注入动作通过 deps 注入，可单测。
 */

import type { AgentId } from '../../shared/types';
import { connectEventCdp, type EventCdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** CDP `Target.targetCreated` 的 targetInfo 子集（够用即可）。 */
export interface WatcherTargetInfo {
  targetId: string;
  type: string;
  url?: string;
  title?: string;
  attached?: boolean;
}

export interface CdpWatcherDeps {
  /** 解析 browser 级 WS 端点；无端点（不可用）返回 null。 */
  resolveBrowserWsUrl: (port: number) => Promise<string | null> | string | null;
  /** 判断一个 target 是否需要注入（DOM 型 + URL 白名单）。 */
  shouldInject: (target: WatcherTargetInfo) => boolean;
  /** 对单个新 target 执行注入（复用 injectSingleDomTarget）。返回是否成功。 */
  inject: (target: WatcherTargetInfo, epoch: number) => Promise<boolean>;
  /** 当前 epoch（守卫：新 apply/restore 覆盖后跳过）。 */
  currentEpoch: (appId: AgentId) => number;
  /** 日志。 */
  log: (line: string) => void;
  /** 状态回调（连接/重连/降级事件，供 UI）。 */
  onStatus?: (status: { connected: boolean; degraded: boolean; targetsSeen: number }) => void;
}

/** DOM 型 target 类型集合（与 cdp-targets 的 findDomTargets 一致）。 */
export const DOM_TARGET_TYPES = new Set(['page', 'webview', 'iframe']);

/** 重连退避（ms）。 */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

export class CdpWatcher {
  private session: EventCdpSession | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private backoffIndex = 0;
  /** 已见过的 targetId（注入成功才记入，避免重连后重复注入）。 */
  private seenTargets = new Set<string>();
  private connected = false;
  private degraded = false;

  constructor(
    private readonly appId: AgentId,
    private readonly port: number,
    private readonly deps: CdpWatcherDeps,
  ) {}

  /** 建立 browser 级连接并订阅 target 事件。降级返回 false（调用方回退轮询）。 */
  async start(): Promise<boolean> {
    const wsUrl = await this.deps.resolveBrowserWsUrl(this.port);
    if (!wsUrl) {
      this.degraded = true;
      this.deps.log(
        `[cdp-watcher] ${this.appId}: browser endpoint unavailable — degraded (polling fallback)`,
      );
      this.emitStatus();
      return false;
    }
    this.stopped = false;
    return this.connect(wsUrl);
  }

  private async connect(wsUrl: string): Promise<boolean> {
    try {
      const session = await connectEventCdp(wsUrl, 4000, 8000);
      this.session = session;
      this.connected = true;
      this.degraded = false;
      this.backoffIndex = 0;
      this.deps.log(`[cdp-watcher] ${this.appId}: browser CDP connected`);

      session.on('Target.targetCreated', (params) => {
        const info = (params as { targetInfo?: WatcherTargetInfo }).targetInfo;
        if (info) void this.onTarget(info);
      });
      session.on('Target.targetDestroyed', (params) => {
        const id = (params as { targetId?: string }).targetId;
        if (id) this.seenTargets.delete(id);
      });
      session.on('Target.targetInfoChanged', (params) => {
        const info = (params as { targetInfo?: WatcherTargetInfo }).targetInfo;
        if (info && this.seenTargets.has(info.targetId)) {
          // 已注入 target 的 URL 变化（SPA 导航到新页面）→ 重新注入。
          void this.onTarget(info, true);
        }
      });

      try {
        await session.send('Target.setDiscoverTargets', { discover: true });
      } catch (error) {
        this.deps.log(
          `[cdp-watcher] ${this.appId}: setDiscoverTargets failed — ${error instanceof Error ? error.message : String(error)}`,
        );
        this.disconnect();
        return false;
      }

      // Socket 意外关闭 → 退避重连（除非 stop()）。
      // 在 open 之后 attach 一个 close 处理：connectEventCdp 的 core 已把
      // pending 全部 reject，这里只需处理"重连"逻辑。
      this.emitStatus();
      return true;
    } catch {
      this.deps.log(`[cdp-watcher] ${this.appId}: browser connect failed — scheduling reconnect`);
      this.connected = false;
      this.scheduleReconnect(wsUrl);
      this.emitStatus();
      return false;
    }
  }

  /** 处理一个新 target。`reInject` 为 true 表示已注入 target 的 URL 变了。 */
  private async onTarget(info: WatcherTargetInfo, reInject = false): Promise<void> {
    if (!this.deps.shouldInject(info)) return;
    if (this.seenTargets.has(info.targetId) && !reInject) return;
    if (!this.deps.currentEpoch) return; // 无 epoch 直接跳过（防御）

    const ok = await this.deps.inject(info, this.deps.currentEpoch(this.appId));
    if (ok) {
      this.seenTargets.add(info.targetId);
      this.deps.log(
        `[cdp-watcher] ${this.appId}: auto-injected ${info.type} "${info.title ?? info.url ?? info.targetId}"`,
      );
    } else {
      this.deps.log(
        `[cdp-watcher] ${this.appId}: inject failed for ${info.type} "${info.targetId}"`,
      );
    }
    this.emitStatus();
  }

  private scheduleReconnect(wsUrl: string): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay =
      RECONNECT_BACKOFF_MS[Math.min(this.backoffIndex, RECONNECT_BACKOFF_MS.length - 1)];
    this.backoffIndex++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      void this.connect(wsUrl);
    }, delay);
  }

  /** 关闭连接与定时器。幂等。 */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.connected = false;
    this.emitStatus();
  }

  getState(): { connected: boolean; degraded: boolean; targetsSeen: number } {
    return {
      connected: this.connected,
      degraded: this.degraded,
      targetsSeen: this.seenTargets.size,
    };
  }

  private disconnect(): void {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.connected = false;
  }

  private emitStatus(): void {
    try {
      this.deps.onStatus?.(this.getState());
    } catch {
      // UI 回调失败不打断 watcher。
    }
  }
}

/**
 * 默认 probe 白名单：DOM 型且 URL 属于目标 app（`app://` 或非回环 http/file），
 * 跳过 devtools 面板 / worker / AgentSkin 自己的回环壁纸。
 */
export function defaultShouldInject(info: WatcherTargetInfo): boolean {
  if (!DOM_TARGET_TYPES.has(info.type)) return false;
  const url = info.url ?? '';
  // 127.0.0.1 回环 = 本地服务（AgentSkin 壁纸 server / 自托管页面）——跳过。
  if (url.includes('127.0.0.1')) return false;
  if (url.startsWith('app://')) return true;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}
