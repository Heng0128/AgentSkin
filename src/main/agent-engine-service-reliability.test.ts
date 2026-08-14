// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService 可靠性验证测试套件 v3
 *
 * 针对P0-2注入可靠性闭环的核心场景测试，覆盖：
 *   - Epoch管理正确性（与apply/restore流程交互）
 *   - 并发操作最终一致性保证
 *   - 持久化状态异常恢复路径
 *   - 结构化日志事件链路完整性
 *   - 壁纸服务集成
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
  SystemStatus,
  WallpaperAgentSetting,
} from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import { EpochManager } from './epoch-manager';
import type { SettingsServiceApi, ThemeLibraryApi, WallpaperResolver } from './services/contracts';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';
import type { WallpaperInjectorDeps } from './wallpaper/injector-types';

// ---------------------------------------------------------------------------
// Mock modules (consistent with main test suite)
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => ({
  reconcileZombiePorts: vi.fn(async () => {}),
  probeAppStatus: vi.fn(),
  resolveLivePort: vi.fn(async () => null),
  ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
  inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' })),
}));

vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: vi.fn() }));
vi.mock('./theme-restore-flow', () => ({ restoreThemeFlow: vi.fn() }));
vi.mock('./fs-utils', () => ({
  writeJsonAtomic: vi.fn(async () => {}),
  appendLogLine: vi.fn(async () => {}),
}));
vi.mock('./wallpaper-injector', () => ({
  applyAgentWallpaperNow: vi.fn(async () => ({ ok: true })),
  applyWallpaperToAgent: vi.fn(async () => ({ ok: true })),
  injectAgentWallpaper: vi.fn(async () => ({ ok: true })),
  injectAgentWallpaperFromApply: vi.fn(async () => {}),
  removeAgentVideoWallpaper: vi.fn(async () => {}),
  removeWallpaperFromAgent: vi.fn(async () => ({ ok: true })),
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

const TEST_APP: AgentId = 'traework';
const STATUS: SystemStatus = { platform: 'win32', apps: [] };
const APPLY_RESPONSE = { status: 'applied' as const, message: 'ok', system: STATUS };
const APPLY_REQUEST: ApplyRequest = { appId: TEST_APP, themeId: 't1' };

interface SettingsOverrides {
  port?: number | null;
  wallpaperAgents?: AgentId[];
}

function makeSettings(opts: SettingsOverrides = {}): SettingsServiceApi {
  const wallpaperAgents = opts.wallpaperAgents ?? [];
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: opts.port ?? null })),
    wallpaper: vi.fn(() => ({
      enabled: false,
      id: null,
      render: { alignment: 'fill', speed: 1, loop: true, brightness: 100 },
      agents: {} as Record<AgentId, WallpaperAgentSetting>,
    })),
    agentWallpaper: vi.fn((appId: AgentId) => ({
      enabled: wallpaperAgents.includes(appId),
      id: null,
    })),
    toDto: vi.fn(() => ({})),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
  } as unknown as SettingsServiceApi;
}

// Flush the microtask + macrotask queue so that the async cleanup chain
// (`cleanup.finally` → `Map.delete`) has a chance to execute before any
// assertion inspects the inflight map.
//
// Background: agent-engine-service deletes `inflightOperations` entries from
// a `.finally()` attached to an internal `cleanup` promise that only resolves
// after background follow-ups settle. A bare `await svc.apply()` resolves
// the response promise but does NOT drain the follow-up finally-chain, so an
// immediately-following assertion can still see a stale entry.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
// Test Suite: Reliability Verification (P0-2)
// ---------------------------------------------------------------------------

describe('AgentEngineService Reliability Verification', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(applyThemeFlow).mockResolvedValue({
      response: APPLY_RESPONSE,
      background: Promise.resolve(),
    });
    vi.mocked(restoreThemeFlow).mockResolvedValue(STATUS);
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-rel-'));
    stateFile = path.join(tmpDir, 'state.json');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeService() {
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    return new AgentEngineService({} as any, stateFile, makeSettings());
  }

  // =========================================================================
  // Section 1: Epoch Manager Correctness
  // =========================================================================

  describe('Epoch manager correctness', () => {
    it('bumps epoch monotonically per agent', () => {
      const mgr = new EpochManager();

      const e1 = mgr.bumpEpoch(TEST_APP);
      const e2 = mgr.bumpEpoch(TEST_APP);
      const e3 = mgr.bumpEpoch(TEST_APP);

      expect(e1).toBe(1);
      expect(e2).toBe(2);
      expect(e3).toBe(3);
    });

    it('isolates epochs across different agents', () => {
      const mgr = new EpochManager();

      const a1 = mgr.bumpEpoch('workbuddy');
      const b1 = mgr.bumpEpoch('qoderwork');
      const a2 = mgr.bumpEpoch('workbuddy');

      expect(a1).toBe(1);
      expect(b1).toBe(1); // independent counter per agent
      expect(a2).toBe(2);
      expect(mgr.isEpochCurrent('workbuddy', a1)).toBe(false); // a1 superseded by a2
      expect(mgr.isEpochCurrent('qoderwork', b1)).toBe(true); // b1 still current
    });

    it('marks stale epochs as non-current after newer bump', () => {
      const mgr = new EpochManager();
      const captured = mgr.bumpEpoch(TEST_APP);

      expect(mgr.isEpochCurrent(TEST_APP, captured)).toBe(true);

      mgr.bumpEpoch(TEST_APP); // bump again, captured becomes stale

      expect(mgr.isEpochCurrent(TEST_APP, captured)).toBe(false);
    });

    it('handles implicit epoch 0 for unbumped agents', () => {
      const mgr = new EpochManager();

      // Never bumped - implicit epoch is 0
      expect(mgr.isEpochCurrent(TEST_APP, 0)).toBe(true);
      expect(mgr.isEpochCurrent(TEST_APP, 1)).toBe(false);
    });

    it('survives 1000+ bumps without integer wrapping', () => {
      const mgr = new EpochManager();
      for (let i = 0; i < 1000; i++) mgr.bumpEpoch(TEST_APP);
      const captured = mgr.bumpEpoch(TEST_APP);
      expect(captured).toBe(1001);
      expect(mgr.isEpochCurrent(TEST_APP, captured)).toBe(true);

      mgr.bumpEpoch(TEST_APP);
      expect(mgr.isEpochCurrent(TEST_APP, captured)).toBe(false);
    });
  });

  // =========================================================================
  // Section 2: Concurrency Final Consistency
  // =========================================================================

  describe('Concurrency final consistency', () => {
    it('deduplicates same-kind concurrent applies into one execution', async () => {
      const gate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockImplementation(() => gate.promise);
      const svc = makeService();

      const p1 = svc.apply(APPLY_REQUEST);
      const p2 = svc.apply(APPLY_REQUEST);

      // Both promises should resolve to the same result
      gate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.status).toBe('applied');
      expect(r2.status).toBe('applied');

      // Only one execution should have occurred
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
    });

    it('queues restore behind in-flight apply with deterministic ordering', async () => {
      const gate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockImplementation(() => gate.promise);
      const svc = makeService();

      const applyPromise = svc.apply(APPLY_REQUEST);
      const restorePromise = svc.restore(TEST_APP);

      // restore should wait for apply cleanup (background follow-ups) to finish
      expect(restoreThemeFlow).not.toHaveBeenCalled();

      gate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      await applyPromise;
      await restorePromise;

      // verify apply executed before restore
      const applyOrder = vi.mocked(applyThemeFlow).mock.invocationCallOrder[0];
      const restoreOrder = vi.mocked(restoreThemeFlow).mock.invocationCallOrder[0];
      expect(applyOrder).toBeLessThan(restoreOrder!);
    });

    it('queues apply behind in-flight restore with deterministic ordering', async () => {
      const gate = deferred<SystemStatus>();
      vi.mocked(restoreThemeFlow).mockImplementation(() => gate.promise);
      const svc = makeService();

      const restorePromise = svc.restore(TEST_APP);
      const applyPromise = svc.apply(APPLY_REQUEST);

      // apply should wait for restore to complete
      expect(applyThemeFlow).not.toHaveBeenCalled();

      gate.resolve(STATUS);
      await restorePromise;
      await applyPromise;

      // verify restore executed before apply
      const restoreOrder = vi.mocked(restoreThemeFlow).mock.invocationCallOrder[0];
      const applyOrder = vi.mocked(applyThemeFlow).mock.invocationCallOrder[0];
      expect(restoreOrder).toBeLessThan(applyOrder);
    });

    it('cleans up inflight operations map after completion', async () => {
      const svc = makeService();

      await svc.apply(APPLY_REQUEST);

      // Wait for the async cleanup promise chain (.finally → Map.delete)
      // to settle so the inflight entry is actually removed before we assert.
      await flushMicrotasks();

      // After completion (including background cleanup), no in-flight
      // operations should remain
      const inflight = (
        svc as unknown as {
          inflightOperations: Map<
            AgentId,
            { kind: 'apply' | 'restore'; promise: Promise<unknown>; cleanup: Promise<void> }
          >;
        }
      ).inflightOperations;
      expect(inflight.has(TEST_APP)).toBe(false);
    });

    it('maintains state consistency during interrupted restore', async () => {
      const svc = makeService();

      // Start a restore but keep it in-flight
      const restorePromise = svc.restore(TEST_APP);

      // While restore is in-flight, verify state consistency
      const inflight = (
        svc as unknown as {
          inflightOperations: Map<
            AgentId,
            { kind: 'apply' | 'restore'; promise: Promise<unknown>; cleanup: Promise<void> }
          >;
        }
      ).inflightOperations;
      expect(inflight.has(TEST_APP)).toBe(true);
      expect(inflight.get(TEST_APP)?.kind).toBe('restore');

      // Complete the restore
      vi.mocked(restoreThemeFlow).mockResolvedValue(STATUS);
      await restorePromise;

      // State should be fully cleaned up
      expect(inflight.has(TEST_APP)).toBe(false);
    });
  });

  // =========================================================================
  // Section 3: Persistence State Resilience
  // =========================================================================

  describe('Persistence state resilience', () => {
    it('recovers from corrupted JSON state file', async () => {
      writeFileSync(stateFile, '{corrupted-json', 'utf8');

      const svc = makeService();

      // Should not throw - should fall back to defaults gracefully
      await expect(svc.initialize()).resolves.toBeUndefined();
      expect(svc.activeThemeId(TEST_APP)).toBeNull();
      expect(svc.activeSchemeId(TEST_APP)).toBeNull();
    });

    it('handles state with invalid port type gracefully', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({
          version: 2,
          apps: { [TEST_APP]: { activeThemeId: 't1', port: 'invalid' as unknown as number } },
        }),
        'utf8',
      );

      const svc = makeService();
      await svc.initialize();

      // Invalid port type should be rejected, falling back to null
      expect(svc.portFor(TEST_APP)).toBeNull();
    });

    it('preserves valid state across multiple service initialization cycles', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({
          version: 2,
          apps: { [TEST_APP]: { activeThemeId: 'theme-x', port: 9222 } },
        }),
        'utf8',
      );

      const svc1 = makeService();
      await svc1.initialize();
      expect(svc1.activeThemeId(TEST_APP)).toBe('theme-x');

      // Second instance loading same state file
      const svc2 = makeService();
      await svc2.initialize();
      expect(svc2.activeThemeId(TEST_APP)).toBe('theme-x');
      expect(svc2.portFor(TEST_APP)).toBe(9222);
    });

    it('handles empty apps object in persisted state', async () => {
      writeFileSync(stateFile, JSON.stringify({ version: 2, apps: {} }), 'utf8');

      const svc = makeService();
      await svc.initialize();

      expect(svc.activeThemeId(TEST_APP)).toBeNull();
    });
  });

  // =========================================================================
  // Section 4: Error Handling & Recovery Paths
  // =========================================================================

  describe('Error handling and recovery paths', () => {
    it('recovers from partial apply failure and remains operational', async () => {
      const svc = makeService();

      // First apply succeeds
      vi.mocked(applyThemeFlow).mockResolvedValueOnce({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });
      await svc.apply(APPLY_REQUEST);

      // Flush the cleanup microtask chain so the inflight entry from the
      // first apply is actually removed. Otherwise the second apply() will
      // match the still-present entry via same-kind dedup and return the
      // first apply's resolved promise instead of executing the failing mock.
      await flushMicrotasks();

      // Second apply fails with an error
      vi.mocked(applyThemeFlow).mockRejectedValueOnce(new Error('CDP connection lost'));
      await expect(svc.apply({ ...APPLY_REQUEST, themeId: 't2' })).rejects.toThrow('CDP');

      // Service should still be operational after failure
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });
      await expect(svc.apply({ ...APPLY_REQUEST, themeId: 't3' })).resolves.toBeDefined();
    });

    it('handles restore when no theme was previously applied', async () => {
      const svc = makeService();

      vi.mocked(restoreThemeFlow).mockResolvedValue(STATUS);
      const result = await svc.restore(TEST_APP);

      expect(result.platform).toBe('win32');
    });

    it('gracefully handles service disposal during in-flight operation', async () => {
      const svc = makeService();

      // Start an operation
      const applyPromise = svc.apply(APPLY_REQUEST);

      // Dispose while operation is in-flight
      svc.dispose();

      // Should not throw - dispose clears maps but doesn't break in-flight
      await expect(applyPromise).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Section 5: Structured Logging Integration
  // =========================================================================

  describe('Structured logging integration', () => {
    it('provides logger API with log and logStructured methods', () => {
      const settings = makeSettings();
      const svc = new AgentEngineService({} as unknown as ThemeLibraryApi, stateFile, settings);

      const logger = svc.asLogger();
      expect(typeof logger.log).toBe('function');
      expect(typeof logger.logStructured).toBe('function');
    });

    it('collects a full concurrency metrics snapshot', () => {
      const svc = makeService();
      const m = svc.collectConcurrencyMetrics();

      expect(m).toHaveProperty('companionBusyByAgent');
      expect(m).toHaveProperty('inflightOperations');
      expect(m).toHaveProperty('selfHealingAgents');
      expect(m).toHaveProperty('capturedTokens');
      expect(m).toHaveProperty('persistChainDepth');
      expect(m).toHaveProperty('deferredSelfHeals');
      expect(m).toHaveProperty('switchEpochByAgent');
      expect(m.inflightOperations).toBe(0);
    });

    it('updates companionBusy and switchEpoch from renderer inputs', () => {
      const svc = makeService();
      svc.updateConcurrencyMetricsFromRenderer(7, 4);
      const m = svc.collectConcurrencyMetrics();
      expect(m.companionBusyByAgent).toBe(7);
      expect(m.switchEpochByAgent).toBe(4);
    });

    it('includes timestamp structure in logger events', () => {
      const settings = makeSettings();
      const svc = new AgentEngineService({} as unknown as ThemeLibraryApi, stateFile, settings);

      const logger = svc.asLogger();

      // Verify logger accepts properly structured events
      expect(() => {
        logger.logStructured({
          type: 'theme_apply',
          agentId: TEST_APP,
          themeId: 't1',
          timestamp: new Date().toISOString(),
        });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Section 6: Wallpaper Service Integration
  // =========================================================================

  describe('Wallpaper service integration', () => {
    it('accepts wallpaper service resolver before initialize', () => {
      const mockResolver = {
        videoPathFor: vi.fn(async () => null),
        mediaInfoFor: vi.fn(async () => null),
        webUrlFor: vi.fn(async () => null),
      };

      const svc = makeService();

      // Should not throw
      expect(() =>
        svc.setWallpaperService(mockResolver as unknown as WallpaperResolver),
      ).not.toThrow();
    });

    it('delegates applyAgentWallpaperNow to wallpaper injector', async () => {
      const svc = makeService();
      const result = await svc.applyAgentWallpaperNow(TEST_APP);

      expect(result.ok).toBe(true);
    });

    it('delegates removeWallpaperFromAgent to wallpaper injector', async () => {
      const svc = makeService();
      const result = await svc.removeWallpaperFromAgent(TEST_APP);

      expect(result.ok).toBe(true);
    });

    it('delegates applyWallpaperToAgent with specific ID', async () => {
      const svc = makeService();
      const result = await svc.applyWallpaperToAgent('wp-123', TEST_APP);

      expect(result.ok).toBe(true);
    });

    it('propagates applyAgentWallpaperNow failure from injector', async () => {
      const { applyAgentWallpaperNow: impl } = await import('./wallpaper-injector');
      vi.mocked(impl).mockResolvedValueOnce({
        ok: false,
        reason: 'disposed',
        detail: 'Service already disposed',
      });

      const svc = makeService();
      const result = await svc.applyAgentWallpaperNow(TEST_APP);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('disposed');
    });

    it('propagates applyWallpaperToAgent failure from injector', async () => {
      const { applyWallpaperToAgent: impl } = await import('./wallpaper-injector');
      vi.mocked(impl).mockResolvedValueOnce({
        ok: false,
        reason: 'not-found',
        detail: 'Wallpaper id not found',
      });

      const svc = makeService();
      const result = await svc.applyWallpaperToAgent('wp-missing', TEST_APP);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('not-found');
    });

    it('propagates removeWallpaperFromAgent failure from injector', async () => {
      const { removeWallpaperFromAgent: impl } = await import('./wallpaper-injector');
      vi.mocked(impl).mockResolvedValueOnce({ ok: false });

      const svc = makeService();
      const result = await svc.removeWallpaperFromAgent(TEST_APP);

      expect(result.ok).toBe(false);
    });
  });

  // =========================================================================
  // Section 7: Health Score Preparation (Future P0-2 Implementation)
  // =========================================================================

  describe('Health score preparation (P0-2 future work)', () => {
    it('allows service to track operations without error', async () => {
      const svc = makeService();

      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });
      const result = await svc.apply(APPLY_REQUEST);

      // Service should complete successfully with applied status
      expect(result.status).toBe('applied');
    });

    it('maintains operational state after failed operations', async () => {
      const svc = makeService();

      vi.mocked(applyThemeFlow).mockRejectedValue(new Error('Test failure'));

      await expect(svc.apply(APPLY_REQUEST)).rejects.toThrow();

      // Service should still be usable
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });
      await expect(svc.apply(APPLY_REQUEST)).resolves.toBeDefined();
    });

    it('stopConcurrencyMetricsTimer is safe to call without prior start', () => {
      const svc = makeService();
      // Calling stop before start should be a no-op, not throw
      expect(() => svc.stopConcurrencyMetricsTimer()).not.toThrow();
    });
  });

  // =========================================================================
  // Section 8: Disposed Three-Layer Guard (Batch B)
  // =========================================================================

  describe('Disposed three-layer guard (Batch B)', () => {
    let realInjectAgentWallpaper: typeof import('./wallpaper-injector')['injectAgentWallpaper'];
    let realInjectWithFallback: typeof import('./wallpaper-injector')['injectWithFallback'];
    let realRecordInjectionFailure: typeof import('./wallpaper-self-heal')['recordInjectionFailure'];
    let realSetSelfHealCallback: typeof import('./wallpaper-self-heal')['setSelfHealCallback'];
    let realDisposeSelfHealState: typeof import('./wallpaper-self-heal')['disposeSelfHealState'];
    let realResetDeferredSelfHealsForTest: () => void;

    beforeEach(async () => {
      // importActual bypasses the vi.mock factory loaded above so we get the
      // real guard code paths (the vi.mock stubs replace the whole module,
      // erasing injectAgentWallpaper / injectWithFallback / recordInjectionFailure).
      realInjectAgentWallpaper = (
        await vi.importActual<typeof import('./wallpaper-injector')>('./wallpaper-injector')
      ).injectAgentWallpaper;
      realInjectWithFallback = (
        await vi.importActual<typeof import('./wallpaper-injector')>('./wallpaper-injector')
      ).injectWithFallback;
      const selfHeal =
        await vi.importActual<typeof import('./wallpaper-self-heal')>('./wallpaper-self-heal');
      realRecordInjectionFailure = selfHeal.recordInjectionFailure;
      realSetSelfHealCallback = selfHeal.setSelfHealCallback;
      realDisposeSelfHealState = selfHeal.disposeSelfHealState;
      realResetDeferredSelfHealsForTest = (
        await vi.importActual<typeof import('./wallpaper-injector')>('./wallpaper-injector')
      )._resetDeferredSelfHealsForTest;
      // Reset module-scoped maps so FAILURE_THRESHOLD starts cold.
      realDisposeSelfHealState();
      realResetDeferredSelfHealsForTest();
    });

    afterEach(() => {
      realDisposeSelfHealState();
      realResetDeferredSelfHealsForTest();
      realSetSelfHealCallback(async () => null);
    });

    it('injectAgentWallpaper returns { ok: false, detail: disposed } immediately when disposed', async () => {
      // The isDisposed guard is line 1 in injectAgentWallpaper -- it must
      // short-circuit BEFORE any wallpaperService / epoch / CDP interaction.
      const result = await realInjectAgentWallpaper(TEST_APP, 9222, 'some-wallpaper-id', {}, 1, {
        isDisposed: () => true,
      } as unknown as WallpaperInjectorDeps);

      expect(result.ok).toBe(false);
      expect(result.detail).toBe('disposed');
    });

    it('injectWithFallback skips self-heal trigger when disposed even after 3 consecutive failures', async () => {
      vi.useFakeTimers();
      try {
        let selfHealThunkExecuted = false;
        realSetSelfHealCallback(async () => async () => {
          selfHealThunkExecuted = true;
        });

        // Pre-seed 2 failures so the next call (issued internally by
        // injectWithFallback) crosses FAILURE_THRESHOLD=3 and would
        // normally produce a non-null selfHealAction thunk.
        await realRecordInjectionFailure(TEST_APP); // count = 1
        await realRecordInjectionFailure(TEST_APP); // count = 2

        const deps = {
          isDisposed: () => true,
          isApplyingTheme: () => false,
          isEpochCurrent: () => true,
          wallpaperService: null, // -> 'wallpaper-service-unavailable'
          bumpEpoch: () => 1,
          resolveAgentWallpaperId: async () => ({ id: null }),
          ensureCdpReady: async () => ({ port: 0, reason: 'test' }),
          resolveLivePort: async () => null,
          inferRestartReason: async () => 'no-cdp' as const,
          findAgentTargets: async () => [],
          setAgentWallpaper: async () => {},
          log: () => {},
        } as unknown as WallpaperInjectorDeps;

        // injectWithFallback flow for a non-existent wallpaper id:
        //   1. injectAgentWallpaper -> { ok: false, detail: 'disposed' }
        //   2. No last-successful fallback -> recordInjectionFailure
        //      (internal count crosses 3 -> returns a non-null thunk)
        //   3. Guard !deps.isDisposed?.() -> false -> skip self-heal entirely
        await realInjectWithFallback(TEST_APP, 9222, 'failing-wallpaper', {}, 1, deps);
        await vi.advanceTimersByTimeAsync(50);

        // The disposed guard must suppress the self-heal action entirely.
        expect(selfHealThunkExecuted).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cross-kind: apply queues behind in-flight restore and proceeds after cleanup', async () => {
      const restoreGate = deferred<SystemStatus>();
      vi.mocked(restoreThemeFlow).mockImplementation(() => restoreGate.promise);
      const svc = makeService();

      // Start restore, then attempt apply while restore is in-flight
      const restorePromise = svc.restore(TEST_APP);
      const applyPromise = svc.apply(APPLY_REQUEST);

      // apply must NOT execute until restore cleanup completes
      expect(applyThemeFlow).not.toHaveBeenCalled();

      // Restore completes normally — this triggers its cleanupResolve
      restoreGate.resolve(STATUS);
      await restorePromise;
      await flushMicrotasks();

      // Now apply should proceed
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
      const applyResult = await applyPromise;
      expect(applyResult.status).toBe('applied');
    });

    it('cross-kind: restore queues behind in-flight apply and proceeds after cleanup', async () => {
      const applyGate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockImplementation(() => applyGate.promise);
      const svc = makeService();

      // Start apply, then attempt restore while apply is in-flight
      const applyPromise = svc.apply(APPLY_REQUEST);
      const restorePromise = svc.restore(TEST_APP);

      // restore must NOT execute until apply cleanup completes
      expect(restoreThemeFlow).not.toHaveBeenCalled();

      // Apply completes normally — triggers its cleanupResolve
      applyGate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      await applyPromise;

      // Ensure the cleanup chain (.finally → Map.delete) drains
      await flushMicrotasks();
      await flushMicrotasks();

      // Now restore should proceed
      expect(restoreThemeFlow).toHaveBeenCalledTimes(1);
      const restoreResult = await restorePromise;
      expect(restoreResult.platform).toBe('win32');
    });

    it('writeState swallows persist failures and logs "persist failed"', async () => {
      const { writeJsonAtomic } = await import('./fs-utils');
      vi.mocked(writeJsonAtomic).mockReset();
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('EACCES: permission denied'));

      const svc = makeService();
      const logSpy = vi.spyOn(svc as unknown as { log: (line: string) => void }, 'log');

      // writeState catches writeJsonAtomic rejection and logs instead of throwing
      await (svc as unknown as { writeState: () => Promise<void> }).writeState();

      // Should have logged the failure, NOT thrown
      const logCalls = logSpy.mock.calls.flat();
      expect(logCalls.some((line: string) => line.includes('persist failed'))).toBe(true);
    });

    it('does not crash when dispose interrupts in-flight background cleanup', async () => {
      vi.useFakeTimers();
      try {
        const svc = makeService();

        // Hand-gate the background follow-up promise so dispose() can fire
        // while it is still in-flight (settlement deferred to us).
        const backgroundGate = deferred<void>();
        vi.mocked(applyThemeFlow).mockResolvedValue({
          response: APPLY_RESPONSE,
          background: backgroundGate.promise,
        });

        // applyResponse is resolved immediately; the internal cleanup promise
        // stays pending until the background follow-up settles.
        const applyPromise = svc.apply(APPLY_REQUEST);
        await vi.advanceTimersByTimeAsync(0);

        // Dispose now -- mid-flight (cleanup has NOT yet observed background).
        svc.dispose();
        const disposedFlag = (svc as unknown as { disposed: boolean }).disposed;
        expect(disposedFlag).toBe(true);

        // Settle the originally-pending background. The
        //   void background.catch(() => undefined).finally(cleanupResolve)
        // chain must be safe: dispose() already dropped the inflightOperations
        // entry, so cleanup's Map.delete must be a no-op, not a crash.
        backgroundGate.resolve();
        await vi.advanceTimersByTimeAsync(0);

        // apply() itself had already resolved with the response before dispose.
        await expect(applyPromise).resolves.toBeDefined();

        // Drain remaining timers -- any unhandledRejection surfaces here.
        await vi.advanceTimersByTimeAsync(100);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================================
  // Section 9: Cross-Agent Concurrency
  // =========================================================================

  describe('Cross-agent concurrency', () => {
    /**
     * Verifies that the inflightOperations map is keyed per-agent, so
     * concurrent apply operations on two different agents execute in parallel
     * rather than being serialized through a single global lock.
     */
    it('concurrent apply to different agents runs in parallel', async () => {
      type ApplyFlowArg = { appId: AgentId; themeId?: string };
      const gated = {
        traework: deferred<{ response: ApplyResponse; background: Promise<void> }>(),
        workbuddy: deferred<{ response: ApplyResponse; background: Promise<void> }>(),
      };
      vi.mocked(applyThemeFlow).mockImplementation((req: ApplyFlowArg) => {
        const appId = req.appId;
        if (appId === 'traework') return gated.traework.promise;
        if (appId === 'workbuddy') return gated.workbuddy.promise;
        throw new Error(`unexpected appId: ${appId as string}`);
      });

      const svc = makeService();

      // Fire both applies concurrently — each targets a different agent
      const p1 = svc.apply({ appId: 'traework', themeId: 't1' });
      const p2 = svc.apply({ appId: 'workbuddy', themeId: 't2' });

      // Both operations should be tracked independently in the inflight map
      const inflight = (
        svc as unknown as {
          inflightOperations: Map<AgentId, { kind: string; promise: unknown; cleanup: unknown }>;
        }
      ).inflightOperations;
      expect(inflight.size).toBe(2);
      expect(inflight.has('traework')).toBe(true);
      expect(inflight.has('workbuddy')).toBe(true);

      // Resolve both
      gated.traework.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      gated.workbuddy.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.status).toBe('applied');
      expect(r2.status).toBe('applied');

      // Both applyThemeFlow calls were issued — confirming parallel execution
      expect(applyThemeFlow).toHaveBeenCalledTimes(2);

      // Wait for cleanup chain to drain
      await flushMicrotasks();

      // Both entries should be cleaned up
      expect(inflight.size).toBe(0);
    });

    /**
     * Verifies that inflight dedup is per-agent — the same agent's concurrent
     * applies are deduplicated, but different agents are completely independent.
     *
     * Strategy: gate traework's applyThemeFlow so the operation stays in-flight,
     * then fire a dup apply on traework AND an apply on workbuddy. The dup must NOT
     * trigger a second applyThemeFlow call (dedup), and workbuddy's apply must
     * complete without waiting for traework's gate to release.
     */
    it('inflight dedup is per-agent not global', async () => {
      type ApplyFlowArg = { appId: AgentId; themeId?: string };
      const traeworkGate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      vi.mocked(applyThemeFlow).mockImplementation((req: ApplyFlowArg) => {
        if (req.appId === 'traework') return traeworkGate.promise;
        // workbuddy resolves immediately
        return Promise.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      });

      const svc = makeService();

      const p1 = svc.apply({ appId: 'traework', themeId: 't1' });
      // Second apply to the SAME agent — must be deduplicated internally.
      // The async wrapper always creates a new Promise identity, so we verify
      // dedup via call count, not promise identity.
      svc.apply({ appId: 'traework', themeId: 't1' }).catch(() => {});
      // Apply to a DIFFERENT agent — must execute independently.
      const p2 = svc.apply({ appId: 'workbuddy', themeId: 't2' });

      // After 3 apply() calls, applyThemeFlow should have been called exactly
      // twice: once for traework (dedup absorbed the duplicate) and once for
      // workbuddy (different agent, no dedup).
      expect(applyThemeFlow).toHaveBeenCalledTimes(2);

      // workbuddy should have already executed without waiting for traework's
      // gate to be released.
      const r2 = await p2;
      expect(r2.status).toBe('applied');

      // Both inflight entries should be tracked independently.
      const inflight = (
        svc as unknown as {
          inflightOperations: Map<AgentId, { kind: string; promise: unknown; cleanup: unknown }>;
        }
      ).inflightOperations;
      expect(inflight.size).toBe(2);
      expect(inflight.get('traework')?.kind).toBe('apply');
      expect(inflight.get('workbuddy')?.kind).toBe('apply');

      // Release traework so its in-flight operation can complete.
      traeworkGate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      const r1 = await p1;
      expect(r1.status).toBe('applied');

      await flushMicrotasks();

      // traework should be cleaned up; workbuddy was already cleaned.
      expect(inflight.size).toBe(0);
    });

    /**
     * Verifies that collectConcurrencyMetrics() correctly reflects the
     * per-agent inflight count, and that cross-agent operations are tracked
     * independently.
     */
    it('metrics reflect per-agent concurrency', async () => {
      type ApplyFlowArg = { appId: AgentId; themeId?: string };
      const traeworkGate = deferred<{ response: ApplyResponse; background: Promise<void> }>();
      const workbuddyGate = deferred<{ response: ApplyResponse; background: Promise<void> }>();

      // Gate both agents so we can inspect mid-flight metrics
      vi.mocked(applyThemeFlow).mockImplementation((req: ApplyFlowArg) => {
        if (req.appId === 'traework') return traeworkGate.promise;
        if (req.appId === 'workbuddy') return workbuddyGate.promise;
        throw new Error(`unexpected appId: ${req.appId as string}`);
      });

      const svc = makeService();

      // Initially no inflight operations
      expect(svc.collectConcurrencyMetrics().inflightOperations).toBe(0);

      // Start apply on traework
      const p1 = svc.apply({ appId: 'traework', themeId: 't1' });
      expect(svc.collectConcurrencyMetrics().inflightOperations).toBe(1);

      // Start apply on workbuddy — now two independent inflight operations
      const p2 = svc.apply({ appId: 'workbuddy', themeId: 't2' });
      expect(svc.collectConcurrencyMetrics().inflightOperations).toBe(2);

      // Complete traework first
      traeworkGate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      await p1;
      await flushMicrotasks();

      // Only workbuddy should remain in-flight now
      expect(svc.collectConcurrencyMetrics().inflightOperations).toBe(1);

      // Complete workbuddy
      workbuddyGate.resolve({ response: APPLY_RESPONSE, background: Promise.resolve() });
      await p2;
      await flushMicrotasks();

      // All cleaned up
      expect(svc.collectConcurrencyMetrics().inflightOperations).toBe(0);
    });

    /**
     * Verifies that a restore on agent A does not block an apply on agent B.
     * Cross-kind operations (restore vs apply) on different agents must run
     * concurrently since the inflight dedup is keyed by agent.
     */
    it('restore and apply can run concurrently on different agents', async () => {
      const restoreGate = deferred<SystemStatus>();

      // Gate traework's restore so we can observe concurrent execution
      vi.mocked(restoreThemeFlow).mockImplementation((appId: AgentId) => {
        if (appId === 'traework') return restoreGate.promise;
        throw new Error(`unexpected restore appId: ${appId as string}`);
      });
      // workbuddy's apply resolves immediately
      vi.mocked(applyThemeFlow).mockResolvedValue({
        response: APPLY_RESPONSE,
        background: Promise.resolve(),
      });

      const svc = makeService();

      // Restore traework (gated) and apply workbuddy concurrently
      const restorePromise = svc.restore('traework');
      const applyPromise = svc.apply({ appId: 'workbuddy', themeId: 't1' });

      // Both should be tracked in the inflight map
      const inflight = (
        svc as unknown as {
          inflightOperations: Map<AgentId, { kind: string; promise: unknown; cleanup: unknown }>;
        }
      ).inflightOperations;
      expect(inflight.size).toBe(2);
      expect(inflight.get('traework')?.kind).toBe('restore');
      expect(inflight.get('workbuddy')?.kind).toBe('apply');

      // workbuddy apply should complete without waiting for traework restore
      const applyResult = await applyPromise;
      expect(applyResult.status).toBe('applied');
      expect(applyThemeFlow).toHaveBeenCalledTimes(1);
      // restoreThemeFlow should still be pending for traework
      expect(restoreThemeFlow).toHaveBeenCalledTimes(1);

      // Release traework restore
      restoreGate.resolve(STATUS);
      const restoreResult = await restorePromise;
      expect(restoreResult.platform).toBe('win32');

      await flushMicrotasks();

      expect(inflight.size).toBe(0);
    });
  });
});
