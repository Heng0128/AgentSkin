// SPDX-License-Identifier: MPL-2.0

/**
 * # renderer-guardian
 *
 * CDP Renderer 稳定检测与自动重注入：
 *   1. 稳定检测 — 轮询 /json/list，同一 target id 持续 stableMs 后返回。
 *   2. 重建监听 — 监听 Target.targetDestroyed/Created，防抖后触发重注入。
 *   3. 健康检查 — 定期检查注入状态，丢失时补充注入；超阈值后停止。
 *
 * 副作用通过参数注入，核心算法可测试。复用 connectEventCdp。
 */

import { connectEventCdp, type EventCdpSession } from './cdp-client';
import { type CdpTarget, listTargets } from './cdp-targets';

export interface RendererGuardianOptions {
  port: number;
  rendererHint: string;
  stableMs?: number;
  pollMs?: number;
  maxFailures?: number;
  timeoutMs?: number;
  onRendererStable?: (targetId: string) => Promise<void>;
  onRendererRecreated?: (oldId: string, newId: string) => Promise<void>;
  onInjectionLost?: () => Promise<void>;
}

export type RendererResolver = (targets: readonly CdpTarget[], hint: string) => string | undefined;
export type SleepFn = (ms: number) => Promise<void>;
export type InjectionChecker = (session: EventCdpSession | null) => Promise<boolean>;

const DEF_STABLE_MS = 1000;
const DEF_POLL_MS = 250;
const DEF_MAX_FAILURES = 5;
const DEF_TIMEOUT_MS = 30_000;
const RECREATE_DEBOUNCE_MS = 500;
const HEALTH_INTERVAL_MS = 5000;

export function defaultRendererResolver(
  targets: readonly CdpTarget[],
  hint: string,
): string | undefined {
  const h = hint.toLowerCase();
  return targets.find(
    (t) =>
      t.type === 'page' && (t.url?.toLowerCase().includes(h) || t.title?.toLowerCase().includes(h)),
  )?.id;
}

export function targetExists(targets: readonly CdpTarget[], id: string): boolean {
  return targets.some((t) => t.id === id);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractTargetId(params: unknown): string | undefined {
  if (params && typeof params === 'object' && 'targetId' in params) {
    const id = (params as Record<string, unknown>).targetId;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

export class RendererGuardian {
  private readonly port: number;
  private readonly rendererHint: string;
  private readonly stableMs: number;
  private readonly pollMs: number;
  private readonly maxFailures: number;
  private readonly timeoutMs: number;
  private readonly onRendererStable?: (targetId: string) => Promise<void>;
  private readonly onRendererRecreated?: (oldId: string, newId: string) => Promise<void>;
  private readonly onInjectionLost?: () => Promise<void>;
  private readonly resolveRenderer: RendererResolver;
  private readonly sleepFn: SleepFn;
  private readonly checkInjection: InjectionChecker;

  private _failureCount = 0;
  private _isHealthy = true;
  private _watching = false;
  private session: EventCdpSession | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private stableTargetId: string | null = null;
  private destroyHandler: ((params: unknown) => void) | null = null;
  private createHandler: ((params: unknown) => void) | null = null;
  private recreateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOldId: string | null = null;

  constructor(
    options: RendererGuardianOptions,
    deps: {
      resolveRenderer?: RendererResolver;
      sleepFn?: SleepFn;
      checkInjection?: InjectionChecker;
    } = {},
  ) {
    this.port = options.port;
    this.rendererHint = options.rendererHint;
    this.stableMs = options.stableMs ?? DEF_STABLE_MS;
    this.pollMs = options.pollMs ?? DEF_POLL_MS;
    this.maxFailures = options.maxFailures ?? DEF_MAX_FAILURES;
    this.timeoutMs = options.timeoutMs ?? DEF_TIMEOUT_MS;
    this.onRendererStable = options.onRendererStable;
    this.onRendererRecreated = options.onRendererRecreated;
    this.onInjectionLost = options.onInjectionLost;
    this.resolveRenderer = deps.resolveRenderer ?? defaultRendererResolver;
    this.sleepFn = deps.sleepFn ?? sleep;
    this.checkInjection = deps.checkInjection ?? (async () => true);
  }

  get isHealthy(): boolean {
    return this._isHealthy;
  }
  get failureCount(): number {
    return this._failureCount;
  }
  get isWatching(): boolean {
    return this._watching;
  }

  async waitForStableRenderer(): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    let lastId: string | undefined;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const targets = await listTargets(this.port);
      const currentId = this.resolveRenderer(targets, this.rendererHint);
      if (currentId && currentId === lastId) {
        if (Date.now() - stableSince >= this.stableMs) {
          this.stableTargetId = currentId;
          return currentId;
        }
      } else {
        lastId = currentId;
        stableSince = Date.now();
      }
      await this.sleepFn(this.pollMs);
    }
    throw new Error(`waitForStableRenderer timed out after ${this.timeoutMs}ms`);
  }

  async startWatching(): Promise<void> {
    if (this._watching) return;
    const wsUrl = await this.getRendererWsUrl();
    if (!wsUrl) return;

    try {
      this.session = await connectEventCdp(wsUrl);
    } catch {
      this._failureCount++;
      return;
    }
    this._watching = true;
    this.installHandlers();
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, HEALTH_INTERVAL_MS);
  }

  async stopWatching(): Promise<void> {
    if (!this._watching) return;
    this._watching = false;
    if (this.recreateTimer) clearTimeout(this.recreateTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.session) {
      if (this.destroyHandler) this.session.off('Target.targetDestroyed', this.destroyHandler);
      if (this.createHandler) this.session.off('Target.targetCreated', this.createHandler);
      try {
        this.session.close();
      } catch {
        /* already closed */
      }
      this.session = null;
    }
    this.destroyHandler = null;
    this.createHandler = null;
  }

  private async getRendererWsUrl(): Promise<string | undefined> {
    const targets = await listTargets(this.port);
    const id = this.resolveRenderer(targets, this.rendererHint);
    return id ? targets.find((t) => t.id === id)?.webSocketDebuggerUrl : undefined;
  }

  private installHandlers(): void {
    if (!this.session) return;
    this.destroyHandler = (p: unknown) => {
      const tid = extractTargetId(p);
      if (tid && tid === this.stableTargetId) this.pendingOldId = tid;
    };
    this.createHandler = (p: unknown) => {
      const tid = extractTargetId(p);
      if (!tid) return;
      if (this.recreateTimer) clearTimeout(this.recreateTimer);
      this.recreateTimer = setTimeout(() => {
        this.recreateTimer = null;
        const oldId = this.pendingOldId;
        this.pendingOldId = null;
        if (oldId) void this.onRendererRecreated?.(oldId, tid);
      }, RECREATE_DEBOUNCE_MS);
    };
    this.session.on('Target.targetDestroyed', this.destroyHandler);
    this.session.on('Target.targetCreated', this.createHandler);
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.stableTargetId) return;
    const targets = await listTargets(this.port);
    if (!targetExists(targets, this.stableTargetId)) return;
    if (await this.checkInjection(this.session)) return;
    this._isHealthy = false;
    await this.onInjectionLost?.();
    this._failureCount++;
    if (this._failureCount >= this.maxFailures) void this.stopWatching();
  }
}
