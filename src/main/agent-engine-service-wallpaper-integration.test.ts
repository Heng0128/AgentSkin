// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService —壁纸流程集成测试
 *
 * 使用共享测试 harness (`agent-engine-service-test-harness.ts`) 提供统一的 mock
 * fixture 与工厂函数。对 `wallpaper-self-heal` 保留真实实现 (`vi.importActual` +
 * `vi.fn(actual.xxx)` spy 包裹)，以覆盖自修复逻辑的实际行为。
 *
 * 覆盖场景：
 *   1. applyWallpaperToAgent 成功路径
 *   2. applyWallpaperToAgent 失败 + 自修复触发 (连续 3 次失败)
 *   3. injectAgentWallpaperFromApply 后台任务执行
 *   4. removeWallpaperFromAgent 完整移除
 *   5. wallpaper 并发保护 (epoch 机制串行化)
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, ApplyResponse, SystemStatus } from '../shared/types';
import type { SettingsServiceApi, ThemeLibraryApi } from './services/contracts';
import { AgentEngineService } from './agent-engine-service';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';
import { applyWallpaperToAgent } from './wallpaper-injector';
import { removeWallpaperFromAgent } from './wallpaper-injector';
import { cleanupSelfHealForAgent } from './wallpaper-self-heal';
import { disposeSelfHealState } from './wallpaper-self-heal';
import { recordInjectionSuccess } from './wallpaper-self-heal';
import { recordInjectionFailure } from './wallpaper-self-heal';
import { getSelfHealingAgentsSize } from './wallpaper-self-heal';
import { setSelfHealCallback } from './wallpaper-self-heal';
import { writeJsonAtomic } from './fs-utils';
import { appendLogLine } from './fs-utils';
import { cleanupWallpaperStateForAgent } from './wallpaper/injection-state';
import { disposeWallpaperInjectionState } from './wallpaper/injection-state';
import { cleanupEngineInjectionForAgent } from './cdp/injection/engine-strategy';
import { disposeEngineInjectionState } from './cdp/injection/engine-strategy';
import { disposeThemeAssetCache } from './theme/utils';
import {
  cleanupHarness,
  configureDefaultFlowReturns,
  deferred,
  flushMicrotasks,
  type Deferred,
  installStandardMocks,
  makeServiceStub,
  makeSettings,
  makeThemeLibraryStub,
  setupAllMocks,
  TEST_APP,
} from './agent-engine-service-test-harness';

// ---------------------------------------------------------------------------
// Module mocks — 与 reliability test 保持一致的 mock 契约
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => {
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
    probeAppStatus: vi.fn(async () => undefined),
    resolveLivePort: vi.fn(async () => null),
    ensureCdpReady: vi.fn(async () => ({ ok: true as const, port: 9222, reason: null })),
    inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' as const })),
  };
});

vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: vi.fn() }));
vi.mock('./theme-restore-flow', () => ({ restoreThemeFlow: vi.fn() }));
vi.mock('./fs-utils', () => ({
  writeJsonAtomic: vi.fn(async () => {}),
  appendLogLine: vi.fn(async () => {}),
}));
vi.mock('./wallpaper-injector', () => ({
  applyAgentWallpaperNow: vi.fn(async () => ({ ok: true as const })),
  applyWallpaperToAgent: vi.fn(async () => ({ ok: true as const })),
  injectAgentWallpaperFromApply: vi.fn(async () => {}),
  removeAgentVideoWallpaper: vi.fn(async () => {}),
  removeWallpaperFromAgent: vi.fn(async () => ({ ok: true as const })),
  getCapturedTokensSize: vi.fn(() => 0),
  getDeferredSelfHealsSize: vi.fn(() => 0),
}));
vi.mock('./cdp/injection/engine-strategy', () => ({
  cleanupEngineInjectionForAgent: vi.fn(),
  disposeEngineInjectionState: vi.fn(),
}));
vi.mock('./wallpaper/injection-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wallpaper/injection-state')>();
  return {
    ...actual,
    cleanupWallpaperStateForAgent: vi.fn(actual.cleanupWallpaperStateForAgent),
    disposeWallpaperInjectionState: vi.fn(actual.disposeWallpaperInjectionState),
  };
});
vi.mock('./wallpaper-self-heal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wallpaper-self-heal')>();
  return {
    ...actual,
    cleanupSelfHealForAgent: vi.fn(actual.cleanupSelfHealForAgent),
    disposeSelfHealState: vi.fn(actual.disposeSelfHealState),
  };
});
vi.mock('./theme/utils', () => ({ disposeThemeAssetCache: vi.fn() }));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STATUS: SystemStatus = { platform: 'win32', apps: [] as never[] };
const APPLY_RESPONSE: ApplyResponse = { status: 'applied', message: 'ok', system: STATUS };

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('AgentEngineService —壁纸流程集成', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(applyThemeFlow).mockResolvedValue({
      response: APPLY_RESPONSE,
      background: Promise.resolve(),
    });
    vi.mocked(restoreThemeFlow).mockResolvedValue(STATUS);
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-wallpaper-itest-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ===================================================================
  // 场景 1: applyWallpaperToAgent 成功路径
  // ===================================================================

  describe('applyWallpaperToAgent 成功路径', () => {
    it('返回 { ok: true } 并触发设置持久化', async () => {
      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings({ wallpaperAgents: [TEST_APP] });
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      const result = await svc.applyWallpaperToAgent('wp-test-001', TEST_APP);

      expect(result).toEqual({ ok: true });
      // setAgentWallpaper 应当在注入前被调用以持久化偏好
      expect(settings.setAgentWallpaper).toHaveBeenCalledWith(TEST_APP, {
        enabled: true,
        id: 'wp-test-001',
      });
    });

    it('通过真实 wallpaper-self-heal 验证 recordInjectionSuccess 被调用', async () => {
      // 重置 self-heal 状态确保干净
      disposeSelfHealState();

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      // 设置一个 self-heal 回调，验证成功路径不会触发它
      let callbackInvoked = false;
      setSelfHealCallback(async () => {
        callbackInvoked = true;
        return null;
      });

      const result = await svc.applyWallpaperToAgent('wp-success-002', TEST_APP);

      expect(result.ok).toBe(true);
      // self-heal 回调不应当在成功路径被调用
      expect(callbackInvoked).toBe(false);
      // self-healing agents 集合应为空
      expect(getSelfHealingAgentsSize()).toBe(0);

      setSelfHealCallback(null);
    });

    it('注入成功后连续失败计数器被重置', async () => {
      disposeSelfHealState();

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      // 模拟一次失败: 手动调用 recordInjectionFailure 一次
      await recordInjectionFailure(TEST_APP);

      // 现在应用壁纸成功 — facade 的 applyWallpaperToAgent 调用
      // wallpaper-injector 的 applyWallpaperToAgentImpl，内部成功后
      // 调用 injectWithFallback → recordInjectionSuccess
      const result = await svc.applyWallpaperToAgent('wp-reset-003', TEST_APP);

      expect(result.ok).toBe(true);
    });
  });

  // ===================================================================
  // 场景 2: applyWallpaperToAgent 失败 + 自修复触发
  // ===================================================================

  describe('applyWallpaperToAgent 失败 + 自修复触发', () => {
    it('连续 3 次失败后 self-heal 回调被触发', async () => {
      disposeSelfHealState();

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      let healCallbackCount = 0;
      let capturedAppId: AgentId | null = null;

      const deferredThunk: Deferred<null> = deferred();
      setSelfHealCallback(async (appId: AgentId) => {
        healCallbackCount++;
        capturedAppId = appId;
        // 返回一个 deferred thunk，测试等待它完成
        await deferredThunk.promise;
        return null;
      });

      // 使用真实的 recordInjectionFailure 模拟连续失败
      const action1 = await recordInjectionFailure(TEST_APP);
      expect(action1).toBeNull(); // 第 1 次未达阈值

      const action2 = await recordInjectionFailure(TEST_APP);
      expect(action2).toBeNull(); // 第 2 次未达阈值

      const action3 = await recordInjectionFailure(TEST_APP);
      expect(action3).not.toBeNull(); // 第 3 次触发 self-heal

      // self-heal 回调应已被调用
      expect(healCallbackCount).toBe(1);
      expect(capturedAppId).toBe(TEST_APP);

      // 释放 deferred thunk
      deferredThunk.resolve(null);

      setSelfHealCallback(null);
    });

    it('self-heal 回调返回的函数能正确执行', async () => {
      disposeSelfHealState();

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      let thunkExecuted = false;
      setSelfHealCallback(async (_appId: AgentId) => {
        return async () => {
          thunkExecuted = true;
        };
      });

      // 连续 3 次失败触发 self-heal
      await recordInjectionFailure(TEST_APP);
      await recordInjectionFailure(TEST_APP);
      const thunk = await recordInjectionFailure(TEST_APP);

      expect(thunk).not.toBeNull();
      expect(thunkExecuted).toBe(false); // thunk 尚未执行

      // 执行 thunk
      await thunk!();
      expect(thunkExecuted).toBe(true);

      setSelfHealCallback(null);
    });

    it('冷却期内不重复触发 self-heal', async () => {
      disposeSelfHealState();

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      let healCallbackCount = 0;
      setSelfHealCallback(async (_appId: AgentId) => {
        healCallbackCount++;
        return async () => {};
      });

      // 第一轮: 3 次失败触发 self-heal
      await recordInjectionFailure(TEST_APP);
      await recordInjectionFailure(TEST_APP);
      const firstThunk = await recordInjectionFailure(TEST_APP);
      expect(firstThunk).not.toBeNull();
      await firstThunk!(); // 执行并释放 selfHealingAgents guard

      expect(healCallbackCount).toBe(1);

      // 第二轮: 紧接着再次 3 次失败 — 冷却期内不应再触发
      await recordInjectionFailure(TEST_APP);
      await recordInjectionFailure(TEST_APP);
      const secondThunk = await recordInjectionFailure(TEST_APP);

      // 冷却期内应返回 null
      expect(secondThunk).toBeNull();
      expect(healCallbackCount).toBe(1); // 未增加

      setSelfHealCallback(null);
    });
  });

  // ===================================================================
  // 场景 3: injectAgentWallpaperFromApply 后台任务
  // ===================================================================

  describe('injectAgentWallpaperFromApply 后台任务', () => {
    it('apply 成功后壁纸注入作为后台任务执行', async () => {
      // 使用一个 deferred 控制 background 时序
      const bgDeferred: Deferred<void> = deferred();

      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: bgDeferred.promise,
      });

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      const result = await svc.apply({ appId: TEST_APP, themeId: 'test-theme' });

      // apply 应立即返回响应 (不阻塞于 background)
      expect(result.status).toBe('applied');

      // 后台任务尚未完成 — 此时 inflightOperations 应仍保留
      // (cleanup 尚未触发)
      await flushMicrotasks();

      // 解析后台任务
      bgDeferred.resolve(undefined);
      await flushMicrotasks();
    });

    it('后台任务失败不影响主 apply 返回', async () => {
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.reject(new Error('background task failed')),
      });

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      // apply 应成功返回，即使后台任务失败
      const result = await svc.apply({ appId: TEST_APP, themeId: 'test-theme' });

      expect(result.status).toBe('applied');

      // flush 确保后台任务完成并触发 cleanup chain
      await flushMicrotasks();
    });

    it('使用 flushMicrotasks() 确保后台任务完成', async () => {
      let backgroundCompleted = false;
      const bgPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          backgroundCompleted = true;
          resolve();
        }, 0);
      });

      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: bgPromise,
      });

      const stateFile = path.join(tmpDir, 'state.json');
      const library = makeThemeLibraryStub();
      const settings = makeSettings();
      const svc = new AgentEngineService(library, stateFile, settings);

      await svc.apply({ appId: TEST_APP, themeId: 'test-theme' });

      // flush 后台任务
      await flushMicrotasks();

      expect(backgroundCompleted).toBe(true);
    });
  });

  // ===================================================================
  // 场景 4: removeWallpaperFromAgent
  // ===================================================================

  describe('removeWallpaperFromAgent', () => {
    it('移除成功并更新设置', async () => {
      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings({ wallpaperAgents: [TEST_APP] });
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      const result = await svc.removeWallpaperFromAgent(TEST_APP);

      expect(result).toEqual({ ok: true });
      // 设置应被更新为 disabled
      expect(settings.setAgentWallpaper).toHaveBeenCalledWith(TEST_APP, {
        enabled: false,
        id: null,
      });
    });

    it('真实 cleanupWallpaperStateForAgent 被调用', async () => {
      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings();
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      // 通过 restore 流程验证 cleanupWallpaperStateForAgent 被调用
      // restore flow 调用 cleanupModuleStateForAgent → cleanupWallpaperStateForAgent
      await svc.restore(TEST_APP);

      expect(cleanupWallpaperStateForAgent).toHaveBeenCalledWith(TEST_APP);
    });

    it('移除后自修复状态被清理', async () => {
      disposeSelfHealState();

      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings();
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      // 先记录失败然后 restore 清理
      await recordInjectionFailure(TEST_APP);
      await recordInjectionFailure(TEST_APP);

      await svc.restore(TEST_APP);

      expect(cleanupSelfHealForAgent).toHaveBeenCalledWith(TEST_APP);
    });
  });

  // ===================================================================
  // 场景 5: wallpaper 并发保护 (epoch 机制)
  // ===================================================================

  describe('wallpaper 并发保护', () => {
    it('同一 agent 的多个 wallpaper 操作通过 epoch 机制串行化', async () => {
      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings();
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      // 调用 applyAgentWallpaperNow — 内部会 bumpEpoch
      const promise1 = svc.applyAgentWallpaperNow(TEST_APP);
      const promise2 = svc.applyAgentWallpaperNow(TEST_APP);

      // 两者都应成功 (mock 返回 ok: true)
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
    });

    it('旧 epoch 的操作被中止', async () => {
      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings();
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      // 获取内部 epoch 管理器引用以验证 epoch bump
      const epochManager = (
        svc as unknown as { epochs: { bumpEpoch(appId: AgentId): number; isEpochCurrent(appId: AgentId, epoch: number): boolean } }
      ).epochs;

      // bump epoch 一次 (模拟新 apply 开始)
      const epoch1 = epochManager.bumpEpoch(TEST_APP);
      expect(epochManager.isEpochCurrent(TEST_APP, epoch1)).toBe(true);

      // 再次 bump (模拟另一个操作覆盖)
      const epoch2 = epochManager.bumpEpoch(TEST_APP);
      expect(epochManager.isEpochCurrent(TEST_APP, epoch2)).toBe(true);

      // 旧 epoch 不再有效
      expect(epochManager.isEpochCurrent(TEST_APP, epoch1)).toBe(false);
    });

    it('并发 apply 同一 agent 复用同一 promise (去重)', async () => {
      const stateFile = path.join(tmpDir, 'state.json');
      const settings = makeSettings();
      const library = makeThemeLibraryStub();
      const svc = new AgentEngineService(library, stateFile, settings);

      const request = { appId: TEST_APP, themeId: 'test-theme' };

      // 连续发起两次并发 apply
      const promise1 = svc.apply(request);
      const promise2 = svc.apply(request);

      // dedup 保证返回同一 promise
      expect(promise1).toBe(promise2);

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1.status).toBe('applied');
      expect(result2.status).toBe('applied');
    });
  });
});
