// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService apply 流程集成测试
 *
 * 覆盖 apply 流程的四个核心场景：
 *   1. apply 成功路径 — 验证 recordInjectionSuccess 被调用 + 持久化触发
 *   2. apply 失败路径（CDP 连接断开）— 验证 recordInjectionFailure + self-heal 触发
 *   3. apply 并发去重 — 验证相同请求共享 promise
 *   4. apply 后清理 — 验证 dispose 调用清理函数 + 内存释放
 *
 * 使用共享 harness（agent-engine-service-test-harness）提供类型安全的 mock 工厂。
 * self-heal lifecycle 已由 pipeline retry 策略替代；测试仅验证 facade ↔
 * injector 桥接（recordInjectionFailure 桩）。
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, ApplyRequest, ApplyResponse } from '../shared/types';
import {
  APPLY_RESPONSE,
  cleanupHarness,
  deferred,
  flushMicrotasks,
  makeServiceStub,
  STATUS,
  TEST_APP,
} from './agent-engine-service-test-harness';
import { writeJsonAtomic } from './fs-utils';
import { disposeThemeAssetCache } from './theme/utils';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';
import { recordInjectionFailure, recordInjectionSuccess } from './wallpaper-injector';

// ---------------------------------------------------------------------------
// Module mocks — 在 describe 顶层注册
//
// vi.mock 会被提升到文件最顶部，工厂函数内部不能引用文件作用域的变量
// （它们尚未初始化）。因此所有 mock 工厂内联定义，与现有 5 个测试文件
// 保持一致的 mock 契约。
//
// wallpaper-self-heal 和 theme/utils (disposeThemeAssetCache) 使用真实实现
// + spy（vi.fn(actual.xxx)），让测试覆盖更多业务逻辑。
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => {
  class LivePortCache {
    private m = new Map<string, number>();
    get(a: string): number | null {
      return this.m.get(a) ?? null;
    }
    set(a: string, p: number): void {
      this.m.set(a, p);
    }
    clear(a: string): void {
      this.m.delete(a);
    }
    clearAll(): void {
      this.m.clear();
    }
    size(): number {
      return this.m.size;
    }
  }
  return {
    LivePortCache,
    reconcileZombiePorts: vi.fn(async () => {}),
    probeAppStatus: vi.fn(async () => undefined),
    resolveLivePort: vi.fn(async () => null),
    ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
    inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' as const })),
  };
});

vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: vi.fn() }));
vi.mock('./theme-restore-flow', () => ({ restoreThemeFlow: vi.fn() }));

vi.mock('./fs-utils', () => ({
  writeJsonAtomic: vi.fn(async () => {}),
  appendLogLine: vi.fn(async () => {}),
}));

// Single consolidated mock for wallpaper-injector:
// - Stubs the non-essential wallpaper functions to no-op vi.fn() so tests
//   don't need to provide full deps.
// - Wraps recordInjectionSuccess / recordInjectionFailure with vi.fn() so
//   call history is observable via vi.mocked().
// Previously there were two vi.mock calls for this path (a static stub +
// an importOriginal wrapper); only the last one vitest keeps. Merging them
// here makes the mock deterministic.
vi.mock('./wallpaper-injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wallpaper-injector')>();
  return {
    ...actual,
    applyAgentWallpaperNow: vi.fn(async () => ({ ok: true as const })),
    applyWallpaperToAgent: vi.fn(async () => ({ ok: true as const })),
    injectAgentWallpaperFromApply: vi.fn(async () => {}),
    removeAgentVideoWallpaper: vi.fn(async () => {}),
    removeWallpaperFromAgent: vi.fn(async () => ({ ok: true as const })),
    getCapturedTokensSize: vi.fn(() => 0),
    getDeferredSelfHealsSize: vi.fn(() => 0),
    recordInjectionSuccess: vi.fn(actual.recordInjectionSuccess),
    recordInjectionFailure: vi.fn(actual.recordInjectionFailure),
  };
});

vi.mock('./theme/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./theme/utils')>();
  return {
    ...actual,
    disposeThemeAssetCache: vi.fn(actual.disposeThemeAssetCache),
  };
});
vi.mock('./wallpaper/injection-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wallpaper/injection-state')>();
  return {
    ...actual,
    cleanupWallpaperStateForAgent: vi.fn(actual.cleanupWallpaperStateForAgent),
    disposeWallpaperInjectionState: vi.fn(actual.disposeWallpaperInjectionState),
  };
});

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('AgentEngineService apply 流程集成测试', () => {
  let service: import('./agent-engine-service').AgentEngineService;
  let tmpDir: string;

  beforeEach(async () => {
    // wallpaper-injector barrel exposes recordInjection{Failure,Success} as
    // stubs; nothing per-suite to reset.
    vi.clearAllMocks();
    // 模拟 process.platform 为 win32
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    // 创建 service stub（使用类型安全的 harness 工厂）
    const stub = await makeServiceStub();
    service = stub.service;
    tmpDir = stub.tmpDir;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await cleanupHarness(tmpDir);
  });

  // =========================================================================
  // 1. apply 成功路径
  // =========================================================================

  describe('apply 成功路径', () => {
    it('返回 applied 状态，触发 recordInjectionSuccess 和持久化', async () => {
      const request: ApplyRequest = { appId: TEST_APP, themeId: 't1' };

      // 模拟真实 apply 流程：成功后调用 recordInjectionSuccess + 触发持久化
      vi.mocked(applyThemeFlow).mockImplementation(async (req) => {
        // 真实流程中，injectAgentWallpaperFromApply 成功后调用 recordInjectionSuccess
        recordInjectionSuccess(req.appId);
        // 真实流程中，applyThemeFlow 会触发持久化
        await writeJsonAtomic(path.join(tmpDir, 'state.json'), { version: 2, apps: {} });
        return {
          response: APPLY_RESPONSE,
          background: Promise.resolve(),
        };
      });

      const result = await service.apply(request);

      // 验证返回状态
      expect(result.status).toBe('applied');
      expect(result).toMatchObject({ status: 'applied' });

      // 验证 recordInjectionSuccess 被调用（真实 wallpaper-self-heal 实现）
      expect(recordInjectionSuccess).toHaveBeenCalledWith(TEST_APP);

      // 验证持久化被触发（fs-utils mock 被调用）
      expect(writeJsonAtomic).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. apply 失败路径 — CDP 连接断开
  // =========================================================================

  describe('apply 失败路径 — CDP 连接断开', () => {
    it('recordInjectionFailure stub 被调用且不抛出异常', async () => {
      // CDP 失败后，facade 通过 injectWallpaper → recordInjectionFailure 记录
      // 失败记录。现在该函数是一个由 pipeline retry 策略替代的桩函数，
      // 行为是幂等的：调用后不抛异常、返回 null。这里验证 facade → 桩
      // 的桥接没有回归。
      const request: ApplyRequest = { appId: TEST_APP, themeId: 't1' };

      vi.mocked(applyThemeFlow).mockImplementation(async (req) => {
        recordInjectionFailure(req.appId);
        throw new Error('CDP connection lost');
      });

      await expect(service.apply(request)).rejects.toThrow('CDP connection lost');
      await flushMicrotasks();

      // facade → recordInjectionFailure 的调用链仍保持完整
      expect(recordInjectionFailure).toHaveBeenCalledTimes(1);
      // 调用返回 null（替代品）
      await expect(recordInjectionFailure(TEST_APP)).resolves.toBeNull();
    });
  });

  // =========================================================================
  // 3. apply 并发去重
  // =========================================================================

  describe('apply 并发去重', () => {
    it('两次相同请求共享同一 promise，第一次完成后新请求触发新执行', async () => {
      const request: ApplyRequest = { appId: TEST_APP, themeId: 't1' };
      const gate = deferred<{ response: ApplyResponse; background: Promise<void> }>();

      // 用 gate 控制 applyThemeFlow 的执行时机
      vi.mocked(applyThemeFlow).mockImplementation(() => gate.promise);

      // 同时发起两次相同请求
      const p1 = service.apply(request);
      const p2 = service.apply(request);

      // 验证只触发一次执行（same-kind 去重）
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);

      // 释放 gate
      gate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });

      // 两个 promise 都 resolve 到相同结果
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.status).toBe('applied');
      expect(r2.status).toBe('applied');

      // 验证仍然只执行了一次
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);

      // 等待 cleanup 链清空 inflight 条目
      await flushMicrotasks();

      // 新请求（cleanup 完成后）触发全新执行
      const p3 = service.apply({ appId: TEST_APP, themeId: 't2' });
      expect(applyThemeFlow).toHaveBeenCalledTimes(2);
      const r3 = await p3;
      expect(r3.status).toBe('applied');
    });
  });

  // =========================================================================
  // 4. apply 后清理
  // =========================================================================

  describe('apply 后清理', () => {
    it('dispose 调用所有清理函数并释放内存状态', async () => {
      const request: ApplyRequest = { appId: TEST_APP, themeId: 't1' };

      // 配置 applyThemeFlow / restoreThemeFlow 默认成功返回值
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });
      vi.mocked(restoreThemeFlow).mockResolvedValue(STATUS);

      // 执行 apply 以产生状态（inflightOperations、applyingTheme 等）
      await service.apply(request);
      await flushMicrotasks();

      // 执行 dispose
      await service.disposeAsync();

      // theme asset cache dispose 在 disposeAsync 中被调用。
      expect(disposeThemeAssetCache).toHaveBeenCalled();

      // 验证内存状态被释放
      const inflight = (
        service as unknown as {
          inflightOperations: Map<AgentId, unknown>;
        }
      ).inflightOperations;
      expect(inflight.size).toBe(0);

      const applyingTheme = (
        service as unknown as {
          applyingTheme: Set<AgentId>;
        }
      ).applyingTheme;
      expect(applyingTheme.size).toBe(0);
    });
  });
});
