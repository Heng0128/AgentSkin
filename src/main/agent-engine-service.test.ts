// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService 编排层测试。
 *
 * 执行细节（applyThemeFlow / restoreThemeFlow / app-discovery / 壁纸注入）
 * 已被各自的模块测试覆盖；这里只测编排器自身独有的语义：
 *   - initialize 的持久化状态加载与容错
 *   - apply/restore 的同类型去重与异类型排队
 *   - status 缓存与失效
 *   - reconcileActiveThemes 的对账与持久化
 *   - restoreAll 的壁纸-only agent 清理
 *   - dispose 的子模块释放
 */

import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentId,
  ApplyRequest,
  ApplyResponse,
  AppStatus,
  SystemStatus,
} from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import { probeAppStatus, reconcileZombiePorts } from './app-discovery';
import { disposeEngineInjectionState } from './cdp/injection/engine-strategy';
import { writeJsonAtomic } from './fs-utils';
import { disposeThemeAssetCache } from './theme/utils';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';
import { disposeWallpaperInjectionState } from './wallpaper/injection-state';
import { removeWallpaperFromAgent } from './wallpaper-injector';
import { disposeSelfHealState } from './wallpaper-self-heal';

// ---------------------------------------------------------------------------
// Module mocks — execution detail lives in dedicated module tests.
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => {
  // Minimal stand-in for the real LivePortCache — the service only calls
  // get/set/clear on it; resolution behavior is covered by the dedicated
  // app-discovery-cache.test.ts.
  class LivePortCache {
    private m = new Map<string, number>();
    get(a: string) {
      return this.m.get(a) ?? null;
    }
    set(a: string, p: number) {
      this.m.set(a, p);
    }
    clear(a: string) {
      this.m.delete(a);
    }
    clearAll() {
      this.m.clear();
    }
    size() {
      return this.m.size;
    }
  }
  return {
    LivePortCache,
    reconcileZombiePorts: vi.fn(async () => {}),
    probeAppStatus: vi.fn(),
    resolveLivePort: vi.fn(async () => null),
    ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
    inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' })),
  };
});
vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: vi.fn() }));
vi.mock('./theme-restore-flow', () => ({ restoreThemeFlow: vi.fn() }));
vi.mock('./fs-utils', () => ({
  writeJsonAtomic: vi.fn(async () => {}),
  appendLogLine: vi.fn(async () => {}),
}));
vi.mock('./wallpaper-injector', () => ({
  applyAgentWallpaperNow: vi.fn(async () => ({ ok: true })),
  applyWallpaperToAgent: vi.fn(async () => ({ ok: true })),
  injectAgentWallpaperFromApply: vi.fn(async () => {}),
  removeAgentVideoWallpaper: vi.fn(async () => {}),
  removeWallpaperFromAgent: vi.fn(async () => ({ ok: true })),
}));
vi.mock('./cdp/injection/engine-strategy', () => ({
  cleanupEngineInjectionForAgent: vi.fn(),
  disposeEngineInjectionState: vi.fn(),
}));
vi.mock('./wallpaper/injection-state', () => ({
  cleanupWallpaperStateForAgent: vi.fn(),
  disposeWallpaperInjectionState: vi.fn(),
}));
vi.mock('./wallpaper-self-heal', () => ({
  cleanupSelfHealForAgent: vi.fn(),
  disposeSelfHealState: vi.fn(),
}));
vi.mock('./theme/utils', () => ({ disposeThemeAssetCache: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';
const STATUS: SystemStatus = { platform: 'win32', apps: [] };
const APPLY_RESPONSE: ApplyResponse = { status: 'applied', message: 'ok', system: STATUS };
const APPLY_REQUEST: ApplyRequest = { appId: TEST_APP, themeId: 't1' };

function makeAppStatus(appId: AgentId): AppStatus {
  return {
    appId,
    displayName: appId,
    installed: true,
    running: false,
    debugReady: false,
    port: null,
    activeThemeId: null,
  } as AppStatus;
}

interface SettingsOverrides {
  port?: number | null;
  wallpaperAgents?: AgentId[];
}

/** Minimal SettingsServiceApi stub — only overridesFor/agentWallpaper matter here. */
function makeSettings(opts: SettingsOverrides = {}) {
  const wallpaperAgents = opts.wallpaperAgents ?? [];
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: opts.port ?? null })),
    wallpaper: vi.fn(() => ({ enabled: false, id: null, render: null })),
    agentWallpaper: vi.fn((appId: AgentId) => ({ enabled: wallpaperAgents.includes(appId) })),
    toDto: vi.fn(() => ({})),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
    // biome-ignore lint/suspicious/noExplicitAny: test stub satisfies the contract structurally
  } as any;
}

/** Deferred helper for controlling in-flight operation timing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AgentEngineService (orchestration)', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(probeAppStatus).mockImplementation(async (appId: AgentId) => makeAppStatus(appId));
    vi.mocked(applyThemeFlow).mockResolvedValue({
      response: APPLY_RESPONSE,
      background: Promise.resolve(),
    });
    vi.mocked(restoreThemeFlow).mockResolvedValue(STATUS);
    vi.mocked(writeJsonAtomic).mockResolvedValue(undefined);
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-engine-svc-test-'));
    stateFile = path.join(tmpDir, 'agent-state.json');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeService() {
    // library 只经由被 mock 的 flow deps 消费，空桩即可
    // biome-ignore lint/suspicious/noExplicitAny: test stub — library is never exercised here
    return new AgentEngineService({} as any, stateFile, makeSettings());
  }

  /** Write persisted state and initialize the service from it. */
  async function makeInitializedService(apps: Record<string, unknown>) {
    writeFileSync(stateFile, JSON.stringify({ version: 2, apps }), 'utf8');
    const svc = makeService();
    await svc.initialize();
    return svc;
  }

  describe('initialize', () => {
    it('loads valid persisted state (theme id, scheme id, port)', async () => {
      const svc = await makeInitializedService({
        [TEST_APP]: { activeThemeId: 't1', activeSchemeId: 'amber', port: 9222 },
      });
      expect(svc.activeThemeId(TEST_APP)).toBe('t1');
      expect(svc.activeSchemeId(TEST_APP)).toBe('amber');
      expect(svc.portFor(TEST_APP)).toBe(9222);
      expect(reconcileZombiePorts).toHaveBeenCalledTimes(1);
    });

    it('falls back to defaults on corrupt state file', async () => {
      writeFileSync(stateFile, '{not-json!!', 'utf8');
      const svc = makeService();
      await svc.initialize();
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
      expect(svc.activeSchemeId(TEST_APP)).toBeNull();
      expect(svc.portFor(TEST_APP)).toBeNull();
    });

    it('falls back to defaults when state file does not exist', async () => {
      const svc = makeService();
      await svc.initialize();
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
    });

    it('rejects state with wrong schema version', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({ version: 1, apps: { [TEST_APP]: { activeThemeId: 't1', port: 1 } } }),
        'utf8',
      );
      const svc = makeService();
      await svc.initialize();
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
    });

    it('rejects state entries with unknown agent ids', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({ version: 2, apps: { 'not-an-agent': { activeThemeId: 't1', port: 1 } } }),
        'utf8',
      );
      const svc = makeService();
      await svc.initialize();
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
    });
  });

  describe('portFor', () => {
    it('prefers the user settings port override over persisted state', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({ version: 2, apps: { [TEST_APP]: { activeThemeId: null, port: 9222 } } }),
        'utf8',
      );
      const svc = new AgentEngineService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        {} as any,
        stateFile,
        makeSettings({ port: 5555 }),
      );
      await svc.initialize();
      expect(svc.portFor(TEST_APP)).toBe(5555);
    });
  });

  describe('status cache', () => {
    it('probes every agent once and serves repeat calls from cache', async () => {
      vi.useFakeTimers();
      const svc = makeService();
      const first = await svc.status();
      const second = await svc.status();
      expect(first.platform).toBe('win32');
      expect(second).toBe(first); // same cached object
      expect(vi.mocked(probeAppStatus).mock.calls.length).toBe(first.apps.length);
    });

    it('re-probes after the cache TTL expires', async () => {
      vi.useFakeTimers();
      const svc = makeService();
      const first = await svc.status();
      await vi.advanceTimersByTimeAsync(2100); // TTL = 2000ms
      const second = await svc.status();
      expect(second).not.toBe(first);
      expect(vi.mocked(probeAppStatus).mock.calls.length).toBe(first.apps.length * 2);
    });

    it('invalidates the cache when apply runs', async () => {
      vi.useFakeTimers();
      const svc = makeService();
      await svc.status();
      const before = vi.mocked(probeAppStatus).mock.calls.length;
      await svc.apply(APPLY_REQUEST);
      await svc.status();
      expect(vi.mocked(probeAppStatus).mock.calls.length).toBeGreaterThan(before);
    });
  });

  describe('apply/restore concurrency', () => {
    it('deduplicates same-kind applies onto one in-flight flow', async () => {
      const gate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockReturnValue(gate.promise);
      const svc = makeService();

      const p1 = svc.apply(APPLY_REQUEST);
      const p2 = svc.apply(APPLY_REQUEST);
      // 两个调用必须共享同一个 in-flight Promise，而不是触发第二次执行。
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);

      gate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(APPLY_RESPONSE);
      expect(r2).toBe(APPLY_RESPONSE);
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);

      // in-flight 清理后，下一次调用是全新的执行。
      await svc.apply(APPLY_REQUEST);
      expect(applyThemeFlow).toHaveBeenCalledTimes(2);
    });

    it('propagates a shared rejection to all deduplicated callers', async () => {
      const gate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockReturnValue(gate.promise);
      const svc = makeService();

      const p1 = svc.apply(APPLY_REQUEST);
      const p2 = svc.apply(APPLY_REQUEST);
      gate.reject(new Error('boom'));
      await expect(p1).rejects.toThrow('boom');
      await expect(p2).rejects.toThrow('boom');

      // 失败后 in-flight 必须已清理，新调用重新执行。
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });
      await expect(svc.apply(APPLY_REQUEST)).resolves.toBe(APPLY_RESPONSE);
      expect(applyThemeFlow).toHaveBeenCalledTimes(2);
    });

    it('queues restore behind an in-flight apply and keeps ordering deterministic', async () => {
      const gate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockReturnValue(gate.promise);
      const svc = makeService();
      const lines: string[] = [];
      svc.setLogListener((line) => lines.push(line));

      const applyPromise = svc.apply(APPLY_REQUEST);
      const restorePromise = svc.restore(TEST_APP);

      // restore 必须等待 apply cleanup（含 background），不能在 apply 完成前执行。
      expect(restoreThemeFlow).not.toHaveBeenCalled();
      expect(lines.some((l) => l.includes('queued behind'))).toBe(true);

      gate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      await applyPromise;
      await restorePromise;

      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
      expect(restoreThemeFlow).toHaveBeenCalledTimes(1);
      // apply 必须先于 restore 完成。
      const applyOrder = vi.mocked(applyThemeFlow).mock.invocationCallOrder[0];
      const restoreOrder = vi.mocked(restoreThemeFlow).mock.invocationCallOrder[0];
      expect(applyOrder).toBeLessThan(restoreOrder);
    });

    it('queues apply behind an in-flight restore', async () => {
      const gate = deferred<SystemStatus>();
      vi.mocked(restoreThemeFlow).mockReturnValue(gate.promise);
      const svc = makeService();

      const restorePromise = svc.restore(TEST_APP);
      const applyPromise = svc.apply(APPLY_REQUEST);

      expect(applyThemeFlow).not.toHaveBeenCalled();
      gate.resolve(STATUS);
      await restorePromise;
      await applyPromise;

      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
      expect(restoreThemeFlow).toHaveBeenCalledTimes(1);
      const restoreOrder = vi.mocked(restoreThemeFlow).mock.invocationCallOrder[0];
      const applyOrder = vi.mocked(applyThemeFlow).mock.invocationCallOrder[0];
      expect(restoreOrder).toBeLessThan(applyOrder);
    });

    it('deduplicates same-kind restores', async () => {
      const gate = deferred<SystemStatus>();
      vi.mocked(restoreThemeFlow).mockReturnValue(gate.promise);
      const svc = makeService();

      const p1 = svc.restore(TEST_APP);
      const p2 = svc.restore(TEST_APP);
      expect(restoreThemeFlow).toHaveBeenCalledTimes(1);
      gate.resolve(STATUS);
      await Promise.all([p1, p2]);
      expect(restoreThemeFlow).toHaveBeenCalledTimes(1);
    });
  });

  describe('reconcileActiveThemes', () => {
    it('drops references to removed themes and persists', async () => {
      const svc = await makeInitializedService({
        [TEST_APP]: { activeThemeId: 'gone', activeSchemeId: 'amber', port: 9222 },
      });
      await svc.reconcileActiveThemes(new Set(['other-theme']));
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
      expect(svc.activeSchemeId(TEST_APP)).toBeNull();
      expect(writeJsonAtomic).toHaveBeenCalledTimes(1);
      // 端口不属于主题引用，不应被对账清除。
      expect(svc.portFor(TEST_APP)).toBe(9222);
    });

    it('falls back to the default scheme when only the scheme variant was removed', async () => {
      const svc = await makeInitializedService({
        [TEST_APP]: { activeThemeId: 't1', activeSchemeId: 'amber', port: null },
      });
      // 基础主题在，但 t1--amber 变体不存在。
      await svc.reconcileActiveThemes(new Set(['t1']));
      expect(svc.activeThemeId(TEST_APP)).toBe('t1');
      expect(svc.activeSchemeId(TEST_APP)).toBeNull();
      expect(writeJsonAtomic).toHaveBeenCalledTimes(1);
    });

    it('keeps state and skips persist when everything still resolves', async () => {
      const svc = await makeInitializedService({
        [TEST_APP]: { activeThemeId: 't1', activeSchemeId: 'amber', port: null },
      });
      await svc.reconcileActiveThemes(new Set(['t1', 't1--amber']));
      expect(svc.activeThemeId(TEST_APP)).toBe('t1');
      expect(svc.activeSchemeId(TEST_APP)).toBe('amber');
      expect(writeJsonAtomic).not.toHaveBeenCalled();
    });

    it('swallows persist failures instead of throwing', async () => {
      const svc = await makeInitializedService({
        [TEST_APP]: { activeThemeId: 'gone', port: null },
      });
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));
      await expect(svc.reconcileActiveThemes(new Set())).resolves.toBeUndefined();
      // 内存态仍然被纠正，即使写盘失败。
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
    });
  });

  describe('restoreAll', () => {
    it('restores themed agents and clears wallpaper-only agents', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({ version: 2, apps: { [TEST_APP]: { activeThemeId: 't1', port: null } } }),
        'utf8',
      );
      // doubao 没有主题但有壁纸偏好 —— restoreAll 必须连它一起清理。
      const svc = new AgentEngineService(
        // biome-ignore lint/suspicious/noExplicitAny: test stub
        {} as any,
        stateFile,
        makeSettings({ wallpaperAgents: ['doubao'] }),
      );
      await svc.initialize();

      await svc.restoreAll();

      // traework（有主题）与 doubao（仅壁纸）都进入 restore 队列。
      const restoredApps = vi.mocked(restoreThemeFlow).mock.calls.map((c) => c[0]);
      expect(restoredApps).toContain(TEST_APP);
      expect(restoredApps).toContain('doubao');
      // 无主题但有壁纸的 agent 必须被显式移除壁纸（impl 会附带 deps 参数）。
      expect(removeWallpaperFromAgent).toHaveBeenCalledWith('doubao', expect.anything());
      expect(removeWallpaperFromAgent).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no agent has a theme or wallpaper preference', async () => {
      const svc = makeService();
      await svc.restoreAll();
      expect(restoreThemeFlow).not.toHaveBeenCalled();
      expect(removeWallpaperFromAgent).not.toHaveBeenCalled();
    });

    it('survives a failing per-agent restore', async () => {
      const svc = await makeInitializedService({
        [TEST_APP]: { activeThemeId: 't1', port: null },
        qoderwork: { activeThemeId: 't2', port: null },
      });
      vi.mocked(restoreThemeFlow).mockImplementation(async (appId: AgentId) => {
        if (appId === TEST_APP) throw new Error('cdp gone');
        return STATUS;
      });
      await expect(svc.restoreAll()).resolves.toBeUndefined();
      expect(restoreThemeFlow).toHaveBeenCalledTimes(2);
    });
  });

  describe('dispose', () => {
    it('releases sub-module state and clears orchestration maps', async () => {
      const svc = makeService();
      svc.dispose();
      expect(disposeWallpaperInjectionState).toHaveBeenCalledTimes(1);
      expect(disposeEngineInjectionState).toHaveBeenCalledTimes(1);
      expect(disposeSelfHealState).toHaveBeenCalledTimes(1);
      expect(disposeThemeAssetCache).toHaveBeenCalledTimes(1);

      // dispose 后仍可继续服务新请求（地图已清空，不会误判 in-flight）。
      await svc.apply(APPLY_REQUEST);
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup 双 Promise 架构', () => {
    it('apply 返回后 inflightOperations 条目仍存在，等待 background settle 后才清除', async () => {
      // 使用真实定时器（其他测试可能用 fake timers，必须显式还原）
      vi.useRealTimers();

      // mock: response 立即 resolve，background 需要 50ms 才 settle
      const backgroundPromise = new Promise<void>((resolve) => setTimeout(resolve, 50));
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: backgroundPromise,
      });

      const svc = makeService();
      const applyResult = await svc.apply(APPLY_REQUEST);

      // apply 返回的必须是 response 对象本身
      expect(applyResult).toBe(APPLY_RESPONSE);

      // apply 刚 resolve，background 尚未 settle → inflightOperations 条目仍存在
      // 通过再次 apply 触发相同 kind 去重来间接检查（若条目未清除，会走到 same-kind 分支）
      const probePromise = svc.apply(APPLY_REQUEST);
      // 去重分支直接共享原 promise，不会再次调用 applyThemeFlow
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
      // 共享的 promise resolve 后结果应该相同
      expect(await probePromise).toBe(APPLY_RESPONSE);

      // 清理这次 apply 触发的新条目（background 还是同一个）
      // 实际验证：等待 background settle 后 + cleanup 微任务 flush  → 条目被删除
      await backgroundPromise;
      // flush 微任务：cleanup.finally() 需要在 background settle 后执行
      await new Promise<void>(queueMicrotask);

      // 现在 inflightOperations 已清除：下一次 apply 会触发全新的 applyThemeFlow 调用
      vi.mocked(applyThemeFlow).mockClear();
      await svc.apply(APPLY_REQUEST);
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
    });

    it('background 异常抛出后 cleanup 仍 resolve (.catch + .finally 保证)', async () => {
      vi.useRealTimers();

      // mock: background 在 20ms 后 reject
      const backgroundPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('background failure')), 20),
      );
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: backgroundPromise,
      });

      const svc = makeService();
      const applyResult = await svc.apply(APPLY_REQUEST);

      // promise 部分正常返回（background 的异常不应影响主 response）
      expect(applyResult).toBe(APPLY_RESPONSE);

      // 等待足够时间让 background reject + cleanup 链执行
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      // flush cleanup.finally() 微任务
      await new Promise<void>(queueMicrotask);

      // cleanup 已 resolve → inflightOperations 清除 → 下一次 apply 触发全新执行
      vi.mocked(applyThemeFlow).mockClear();
      await svc.apply(APPLY_REQUEST);
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
    });

    it('same-kind 去重仍共享 promise 而非 cleanup', async () => {
      vi.useRealTimers();

      // mock: response 立即 resolve，background 50ms 后 settle
      const backgroundPromise = new Promise<void>((resolve) => setTimeout(resolve, 50));
      let callCount = 0;
      vi.mocked(applyThemeFlow).mockImplementation(async () => {
        callCount++;
        return { response: APPLY_RESPONSE, background: backgroundPromise };
      });

      const svc = makeService();

      // 第一次 apply → 调用 applyThemeFlow
      const p1 = svc.apply(APPLY_REQUEST);
      // 第二次相同 kind 的 apply → 必须共享同一个 promise，不触发新调用
      const p2 = svc.apply(APPLY_REQUEST);
      expect(callCount).toBe(1);

      // 两者都必须 resolve 到同一个 response
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(APPLY_RESPONSE);
      expect(r2).toBe(APPLY_RESPONSE);

      // 去重语义验证：apply 是 async 函数，每次调用返回新包装 Promise，
      // 但去重分支直接返回 existing.promise（resolve 到同一个 response）。
      // 通过 applyThemeFlow 仅调用一次 + 两者 resolve 相同 response 来间接证明。
      // 同时验证：background 尚未 settle 时，条目仍存在于 inflightOperations，
      // 后续相同 kind 的 apply 仍触发去重路径（不触发新 applyThemeFlow）。
      const p3 = svc.apply(APPLY_REQUEST);
      expect(callCount).toBe(1);
      expect(await p3).toBe(APPLY_RESPONSE);

      // 等待 background + cleanup 完全 settle
      await backgroundPromise;
      await new Promise<void>(queueMicrotask);
      // 清理微任务后再次 apply 触发全新调用
      await svc.apply(APPLY_REQUEST);
      expect(callCount).toBe(2);
    });
  });
});
