// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentEngineService 共享测试 Harness
 *
 * 为 `agent-engine-service*.test.ts` 系列提供统一的 mock fixture 与工厂函数，
 * 消除 5 个测试文件之间的重复 mock 代码，同时提升类型安全（消除 `as any`）。
 *
 * ## 设计原则
 *
 * 1. **真实实现优先**：对纯内存/无副作用模块保留真实实现（`vi.importActual`），
 *    仅在必要时注入可控替身，让测试覆盖更多业务逻辑。
 * 2. **类型完整**：所有 mock 对象满足接口类型约束，消除 `as any` / `as unknown as`。
 * 3. **标准化 mock**：提供 `installStandardMocks()` 一次性注册所有子模块 mock，
 *    与现有 5 个测试文件的 mock 契约保持一致。
 *
 * ## 使用方式
 *
 * ```ts
 * import {
 *   installStandardMocks,
 *   makeThemeLibraryStub,
 *   makeServiceStub,
 *   makeSettings,
 *   deferred,
 *   flushMicrotasks,
 * } from './agent-engine-service-test-harness';
 *
 * vi.mock('./app-discovery', installStandardMocks.appDiscovery);
 * // ... 其余 mock
 *
 * const library = makeThemeLibraryStub();
 * const svc = makeServiceStub(stateFile, { library, settings: makeSettings() });
 * ```
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import type {
  AgentId,
  ApplyResponse,
  SystemStatus,
  WallpaperAgentSetting,
  WallpaperSettings,
} from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import type { SettingsServiceApi, ThemeLibraryApi } from './services/contracts';

// ---------------------------------------------------------------------------
// 类型补充
// ---------------------------------------------------------------------------

/** Deferred promise 控制门 — 用于精确控制异步流程时序。 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

// ---------------------------------------------------------------------------
// 1. Deferred / Flush 工具
// ---------------------------------------------------------------------------

/** 创建一个受控的 deferred promise，用于测试异步时序。 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 刷新微任务 + macrotask 队列，确保 cleanup chain (.finally → Map.delete)
 * 在断言前完成。
 */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// 2. makeThemeLibraryStub — 类型安全的 ThemeLibraryApi 替身
// ---------------------------------------------------------------------------

/**
 * 创建一个类型完整的 ThemeLibraryApi 替身。
 *
 * 替代 `{} as any`，所有方法返回合理的默认值（空数组、null、resolved promise），
 * 可根据测试需要覆盖具体方法。
 *
 * @param overrides - 部分覆盖默认行为的属性
 */
export function makeThemeLibraryStub(overrides: Partial<ThemeLibraryApi> = {}): ThemeLibraryApi {
  const stub: ThemeLibraryApi = {
    initialize: vi.fn(async () => {}),
    entries: vi.fn(async () => []),
    summaries: vi.fn(async () => []),
    coverPathFor: vi.fn((_id: string) => null),
    iconPathFor: vi.fn((_id: string) => null),
    find: vi.fn(async (_themeId: string) => {
      throw new Error('ThemeLibraryStub.find: not implemented — override this method in your test');
    }),
    installFile: vi.fn(async (_sourcePath: string) => {
      throw new Error('ThemeLibraryStub.installFile: not implemented');
    }),
    installBytes: vi.fn(async (_bytes: Buffer, _suggestedId: string) => {
      throw new Error('ThemeLibraryStub.installBytes: not implemented');
    }),
    importPackage: vi.fn(async (_sourcePath: string) => {
      throw new Error('ThemeLibraryStub.importPackage: not implemented');
    }),
    inspectPackage: vi.fn(async (_sourcePath: string) => {
      throw new Error('ThemeLibraryStub.inspectPackage: not implemented');
    }) as unknown as ThemeLibraryApi['inspectPackage'],
    exportPackage: vi.fn(async (_themeId: string, _destination: string) => {}),
    delete: vi.fn(async (_themeId: string) => {}),
    ...overrides,
  };
  return stub;
}

// ---------------------------------------------------------------------------
// 3. makeSettings — 类型安全的 SettingsServiceApi 替身
// ---------------------------------------------------------------------------

export interface MakeSettingsOptions {
  port?: number | null;
  wallpaperAgents?: AgentId[];
  /** 自定义 wallpaper() 返回值 */
  wallpaper?: () => WallpaperSettings;
  /** 自定义 agentWallpaper() 返回值 */
  agentWallpaper?: (appId: AgentId) => WallpaperAgentSetting;
  /** 自定义 overridesFor() 返回值 */
  overridesFor?: (appId: AgentId) => { appPath: string | null; port: number | null };
}

/**
 * 创建一个类型完整的 SettingsServiceApi 替身。
 *
 * 与现有 5 个测试文件保持一致的契约：
 * - overridesFor 返回 `{ appPath: null, port: <opts.port ?? null> }`
 * - agentWallpaper 根据 wallpaperAgents 参数决定 enabled
 * - wallpaper 返回结构化的默认值
 */
export function makeSettings(opts: MakeSettingsOptions = {}): SettingsServiceApi {
  const wallpaperAgents = opts.wallpaperAgents ?? [];

  // NOTE: The `agents: {}` default intentionally omits all 6 AgentId keys —
  // the same relaxation the sibling agent-engine-service*.test.ts files use
  // (they pass `agents: {}` through `as unknown as SettingsServiceApi`).
  // `wallpaper()` is typed as `() => WallpaperSettings` in the interface,
  // but at runtime only `enabled`/`id`/`render` are ever read by the service.
  return {
    initialize: vi.fn(async () => {}),
    overridesFor:
      opts.overridesFor ?? vi.fn((_appId: AgentId) => ({ appPath: null, port: opts.port ?? null })),
    wallpaper:
      opts.wallpaper ??
      vi.fn(() => ({
        enabled: false,
        id: null,
        render: undefined,
        agents: {} as Record<AgentId, WallpaperAgentSetting>,
      })),
    agentWallpaper:
      opts.agentWallpaper ??
      vi.fn((appId: AgentId) => ({
        enabled: wallpaperAgents.includes(appId),
        id: null,
      })),
    toDto: vi.fn(
      () =>
        ({
          apps: {},
          defaultPorts: {},
          wallpaper: {
            enabled: false,
            id: null,
            agents: {} as Record<AgentId, WallpaperAgentSetting>,
          },
        }) as ReturnType<SettingsServiceApi['toDto']>,
    ),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
    liveDomRefreshInterval: vi.fn(() => 0),
    setLiveDomRefreshInterval: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// 4. makeServiceStub — AgentEngineService 工厂
// ---------------------------------------------------------------------------

export interface MakeServiceStubOptions {
  /** ThemeLibraryApi 实例（默认 makeThemeLibraryStub()） */
  library?: ThemeLibraryApi;
  /** SettingsServiceApi 实例（默认 makeSettings()） */
  settings?: SettingsServiceApi;
  /** 状态文件路径（默认在 os.tmpdir() 下随机生成） */
  stateFile?: string;
}

/**
 * 创建一个 AgentEngineService 实例，使用给定的（或默认的）library 和 settings。
 *
 * 替代 `new AgentEngineService({} as any, stateFile, settings)`，提供默认的
 * 状态文件路径（基于 os.tmpdir() 的随机子目录），避免真实 I/O。
 */
export async function makeServiceStub(opts: MakeServiceStubOptions = {}): Promise<{
  service: AgentEngineService;
  stateFile: string;
  tmpDir: string;
  library: ThemeLibraryApi;
  settings: SettingsServiceApi;
}> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-engine-harness-'));
  const stateFile = opts.stateFile ?? path.join(tmpDir, 'agent-state.json');
  const library = opts.library ?? makeThemeLibraryStub();
  const settings = opts.settings ?? makeSettings();
  const service = new AgentEngineService(library, stateFile, settings);
  return { service, stateFile, tmpDir, library, settings };
}

/** 便捷版：直接返回 service（不返回附属信息）。 */
export async function makeService(opts: MakeServiceStubOptions = {}): Promise<AgentEngineService> {
  const { service } = await makeServiceStub(opts);
  return service;
}

// ---------------------------------------------------------------------------
// 5. cleanupHarness — 测试后清理
// ---------------------------------------------------------------------------

/**
 * 清理 makeServiceStub 产生的临时目录。
 * 在 afterEach 中调用，避免磁盘残留。
 */
export async function cleanupHarness(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 6. 标准化 Mock 工厂 — 与 5 个测试文件保持一致的模块 mock 集合
// ---------------------------------------------------------------------------

/**
 * 标准化的 LivePortCache mock — app-discovery 模块使用。
 * 提供真实 Map-based 实现，满足 AgentEngineService 对 LivePortCache 的
 * get/set/clear/clearAll/size 调用需求。
 */
export class LivePortCacheStub {
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

/**
 * 一次性注册所有子模块 mock。
 *
 * 与现有 5 个测试文件的 mock 契约完全一致：
 * - app-discovery: mock reconcileZombiePorts / probeAppStatus / resolveLivePort / ensureCdpReady / inferRestartReason
 * - theme-apply-flow: mock applyThemeFlow
 * - theme-restore-flow: mock restoreThemeFlow
 * - fs-utils: mock writeJsonAtomic / appendLogLine
 * - wallpaper-injector: mock 全部公开接口
 * - cdp/injection/engine-strategy: 使用真实实现（no-op 函数）
 * - wallpaper/injection-state: 使用真实实现 + spy
 * - wallpaper-self-heal: 使用真实实现 + spy
 * - theme/utils: mock disposeThemeAssetCache
 *
 * @returns 包含所有 mock 引用的对象，方便后续 `vi.mocked(...).mockImplementation(...)`。
 */
export function installStandardMocks() {
  // ── app-discovery ──
  const appDiscoveryMocks = {
    LivePortCache: LivePortCacheStub,
    reconcileZombiePorts: vi.fn(async () => {}),
    probeAppStatus: vi.fn(async (_appId: AgentId) => undefined),
    resolveLivePort: vi.fn(async () => null),
    ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
    inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' as const })),
  };

  // ── theme-apply-flow ──
  const applyThemeFlowMock = vi.fn();

  // ── theme-restore-flow ──
  const restoreThemeFlowMock = vi.fn();

  // ── fs-utils ──
  const fsUtilsMocks = {
    writeJsonAtomic: vi.fn(async () => {}),
    appendLogLine: vi.fn(async () => {}),
  };

  // ── wallpaper-injector ──
  const wallpaperInjectorMocks = {
    applyAgentWallpaperNow: vi.fn(async () => ({ ok: true as const })),
    applyWallpaperToAgent: vi.fn(async () => ({ ok: true as const })),
    injectAgentWallpaperFromApply: vi.fn(async () => {}),
    removeAgentVideoWallpaper: vi.fn(async () => {}),
    removeWallpaperFromAgent: vi.fn(async () => ({ ok: true as const })),
    getCapturedTokensSize: vi.fn(() => 0),
    getDeferredSelfHealsSize: vi.fn(() => 0),
  };

  // ── cdp/injection/engine-strategy — 使用真实实现 ──
  // cleanupEngineInjectionForAgent 和 disposeEngineInjectionState 是 no-op，
  // 保留真实实现即可，无需 mock。

  // ── wallpaper/injection-state — 使用真实实现 + spy ──
  // cleanupWallpaperStateForAgent / disposeWallpaperInjectionState 是纯内存操作，
  // vi.fn(actual.xxx) 包裹后既可 spy 又不丢失真实行为。

  // ── wallpaper-self-heal — 使用真实实现 + spy ──
  // cleanupSelfHealForAgent / disposeSelfHealState / getSelfHealingAgentsSize
  // 都是纯内存操作。

  // ── theme/utils ──
  const disposeThemeAssetCacheMock = vi.fn();

  return {
    appDiscovery: appDiscoveryMocks,
    applyThemeFlow: applyThemeFlowMock,
    restoreThemeFlow: restoreThemeFlowMock,
    fsUtils: fsUtilsMocks,
    wallpaperInjector: wallpaperInjectorMocks,
    disposeThemeAssetCache: disposeThemeAssetCacheMock,
  };
}

// ---------------------------------------------------------------------------
// 7. 便捷批量注册 — 在 describe 顶层调用一次即可完成全部 mock 注册
// ---------------------------------------------------------------------------

/**
 * 在测试套件开始前调用，一次性注册所有标准 mock。
 *
 * 注意：必须在 `vi.mock()` 工厂函数内使用返回值，因为 vi.mock 是 hoisted 的。
 *
 * @example
 * ```ts
 * const mocks = setupAllMocks();
 *
 * vi.mock('./app-discovery', () => mocks.appDiscovery);
 * vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: mocks.applyThemeFlow }));
 * // ...
 * ```
 */
export function setupAllMocks() {
  const mocks = installStandardMocks();
  return mocks;
}

// ---------------------------------------------------------------------------
// 8. Mock 默认返回值预设
// ---------------------------------------------------------------------------

/**
 * 为 applyThemeFlow / restoreThemeFlow mock 配置默认的成功返回值。
 *
 * 与现有测试文件保持一致的默认行为：
 * - applyThemeFlow → resolved { response, background: Promise.resolve() }
 * - restoreThemeFlow → resolved STATUS
 */
export function configureDefaultFlowReturns(
  mocks: ReturnType<typeof installStandardMocks>,
  defaults: {
    applyResponse?: ApplyResponse;
    systemStatus?: SystemStatus;
  } = {},
): void {
  const system = defaults.systemStatus ?? { platform: 'win32', apps: [] as never[] };
  const applyResponse = defaults.applyResponse ?? {
    status: 'applied' as const,
    message: 'ok',
    system,
  };

  mocks.applyThemeFlow.mockResolvedValue({
    response: applyResponse,
    background: Promise.resolve(),
  });
  mocks.restoreThemeFlow.mockResolvedValue(system);
}

// ---------------------------------------------------------------------------
// 9. 测试辅助：常用 fixture 对象
// ---------------------------------------------------------------------------

/** 测试用的标准 AgentId。 */
export const TEST_APP: AgentId = 'traework';

/** 测试用的标准 STATUS 对象。 */
export const STATUS: SystemStatus = { platform: 'win32', apps: [] };

/** 测试用的标准 APPLY_RESPONSE。 */
export const APPLY_RESPONSE: ApplyResponse = { status: 'applied', message: 'ok', system: STATUS };

/** 创建指定 appId 的 AppStatus stub。 */
export function makeAppStatus(appId: AgentId) {
  return {
    appId,
    displayName: appId,
    installed: true,
    running: false,
    debugReady: false,
    port: null,
    activeThemeId: null,
  } as const;
}
