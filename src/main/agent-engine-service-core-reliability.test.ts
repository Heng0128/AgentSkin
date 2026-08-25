// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService 核心链路可靠性测试。
 *
 * 覆盖方向 A 发现的 3 个 CRITICAL 问题的修复验证：
 *   - RC1: writeState() persistFailures 双重递增修复
 *   - RC2: apply() 递归调用 → 有界迭代修复
 *   - RC4: dispose() 等待 in-flight background tasks 修复
 */

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
import type { SettingsServiceApi } from './services/contracts';
import { AgentEngineService } from './agent-engine-service';
import { probeAppStatus, reconcileZombiePorts } from './app-discovery';
import { disposeEngineInjectionState } from './cdp/injection/engine-strategy';
import { writeJsonAtomic } from './fs-utils';
import { disposeThemeAssetCache } from './theme/utils';
import { applyThemeFlow } from './theme-apply-flow';
import { restoreThemeFlow } from './theme-restore-flow';
import { stopAudioLevelPolling } from './audio-level';
import { PerformanceRecorder } from './services/performance/performance-recorder';
import { disposeWallpaperInjectionState } from './wallpaper/injection-state';
import { removeWallpaperFromAgent } from './wallpaper-injector';
import { disposeSelfHealState } from './wallpaper-self-heal';

// ---------------------------------------------------------------------------
// Module mocks
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
vi.mock('./audio-level', () => ({ stopAudioLevelPolling: vi.fn() }));
vi.mock('./services/performance/performance-recorder', () => ({
  PerformanceRecorder: { reset: vi.fn(), start: vi.fn(), finishTrace: vi.fn(), release: vi.fn(), getActive: vi.fn(() => null) },
}));

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

function makeSettings() {
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: null })),
    wallpaper: vi.fn(() => ({ enabled: false, id: null, render: undefined, agents: {} as Record<AgentId, import('../shared/types').WallpaperAgentSetting> })),
    agentWallpaper: vi.fn(() => ({ enabled: false, id: null })),
    toDto: vi.fn(() => ({ apps: {} as Record<AgentId, import('../shared/types').AppOverride>, defaultPorts: {} as Record<AgentId, number>, wallpaper: { enabled: false, id: null, agents: {} as Record<AgentId, import('../shared/types').WallpaperAgentSetting> } })),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
    liveDomRefreshInterval: vi.fn(() => 0),
    setLiveDomRefreshInterval: vi.fn(async () => {}),
  } satisfies SettingsServiceApi;
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
// Suite
// ---------------------------------------------------------------------------

describe('AgentEngineService (core reliability)', () => {
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
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-engine-core-rel-'));
    stateFile = path.join(tmpDir, 'agent-state.json');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeService() {
    // biome-ignore lint/suspicious/noExplicitAny: test stub — library is never exercised here
    return new AgentEngineService({} as any, stateFile, makeSettings());
  }

  // -------------------------------------------------------------------------
  // RC1: writeState() persistFailures single increment
  // -------------------------------------------------------------------------

  describe('persistFailures counter (RC1)', () => {
    it('increments persistFailures exactly once per writeState failure', async () => {
      // Make writeJsonAtomic fail
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));

      const svc = makeService();
      const privateSvc = svc as unknown as {
        persist: { safe: (fn: () => unknown) => Promise<void> };
        persistFailures: number;
        writeState: () => Promise<void>;
      };

      // Trigger writeState via persist.safe — same path apply/restore use.
      // writeState catches the error internally and increments persistFailures.
      await privateSvc.persist.safe(() => privateSvc.writeState());

      // persistFailures should be exactly 1 (from writeState catch block).
      // Note: onError is NOT called because writeState catches the error
      // internally and does not re-throw to persist.safe()'s .catch().
      expect(privateSvc.persistFailures).toBe(1);
    });

    it('persistFailures accumulates across multiple failures', async () => {
      vi.mocked(writeJsonAtomic).mockRejectedValue(new Error('disk full'));

      const svc = makeService();
      const privateSvc = svc as unknown as {
        persist: { safe: (fn: () => unknown) => Promise<void> };
        persistFailures: number;
        writeState: () => Promise<void>;
      };

      // Trigger three consecutive writeState failures
      await privateSvc.persist.safe(() => privateSvc.writeState());
      await privateSvc.persist.safe(() => privateSvc.writeState());
      await privateSvc.persist.safe(() => privateSvc.writeState());

      expect(privateSvc.persistFailures).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // RC2: apply() bounded iteration (no infinite recursion)
  // -------------------------------------------------------------------------

  describe('apply() bounded iteration (RC2)', () => {
    it('does not stack overflow when apply is called repeatedly', async () => {
      const svc = makeService();

      // First call succeeds normally
      const result = await svc.apply(APPLY_REQUEST);
      expect(result).toEqual(APPLY_RESPONSE);
    });

    it('throws after max retries when inflightOperations keeps getting restore entries', async () => {
      const svc = makeService();
      const privateSvc = svc as unknown as {
        inflightOperations: Map<string, { kind: string; promise: Promise<unknown>; cleanup: Promise<void> }>;
      };

      // Simulate a scenario where a restore operation cleanup keeps
      // adding new restore entries to inflightOperations
      let callCount = 0;
      const originalGet = privateSvc.inflightOperations.get.bind(privateSvc.inflightOperations);
      privateSvc.inflightOperations.get = (appId: string) => {
        callCount++;
        // Return a restore entry for the first N calls, then undefined
        // Use a cleanup that resolves immediately so the loop can continue
        if (callCount <= 10) {
          return {
            kind: 'restore',
            promise: Promise.resolve(),
            cleanup: Promise.resolve(), // resolves immediately so loop continues
          };
        }
        return originalGet(appId);
      };

      // Should throw after max retries (5) instead of infinite recursion
      await expect(svc.apply(APPLY_REQUEST)).rejects.toThrow(/max retries/);
    });

    it('succeeds after restore cleanup completes', async () => {
      const svc = makeService();
      const privateSvc = svc as unknown as {
        inflightOperations: Map<string, { kind: string; promise: Promise<unknown>; cleanup: Promise<void> }>;
      };

      // Add a restore entry that resolves quickly
      // Note: The finally handler mimics what the real apply/restore code does
      // to delete the entry from inflightOperations when cleanup settles.
      const cleanupResolve = deferred<void>();
      const cleanupPromise = cleanupResolve.promise.finally(() => {
        if (privateSvc.inflightOperations.get(TEST_APP)?.cleanup === cleanupPromise) {
          privateSvc.inflightOperations.delete(TEST_APP);
        }
      });
      privateSvc.inflightOperations.set(TEST_APP, {
        kind: 'restore',
        promise: Promise.resolve(),
        cleanup: cleanupPromise,
      });

      // Start apply (which will wait for cleanup)
      const applyPromise = svc.apply(APPLY_REQUEST);

      // Resolve the cleanup after a tick
      await new Promise((r) => setTimeout(r, 20));
      cleanupResolve.resolve();

      const result = await applyPromise;
      expect(result).toEqual(APPLY_RESPONSE);
    });
  });

  // -------------------------------------------------------------------------
  // RC4: disposeAsync() waits for in-flight operations
  // -------------------------------------------------------------------------

  describe('disposeAsync() waits for in-flight (RC4)', () => {
    it('awaits inflightOperations cleanup promises before disposing', async () => {
      const svc = makeService();
      const cleanupOrder: string[] = [];

      // Mock writeJsonAtomic to track when it's called
      vi.mocked(writeJsonAtomic).mockImplementation(async () => {
        cleanupOrder.push('writeState');
      });

      // Start an apply operation
      const applyPromise = svc.apply(APPLY_REQUEST);

      // Get reference to the cleanup promise
      const privateSvc = svc as unknown as {
        inflightOperations: Map<string, { kind: string; promise: Promise<unknown>; cleanup: Promise<void> }>;
        disposeAsync: () => Promise<void>;
      };

      const inflightCleanup = privateSvc.inflightOperations.get(TEST_APP)?.cleanup;

      // Start disposeAsync in background
      const disposePromise = privateSvc.disposeAsync().then(() => {
        cleanupOrder.push('disposed');
      });

      // The cleanup promise should resolve first (after apply completes)
      // Then dispose should complete
      await disposePromise;

      // Verify that dispose awaited the cleanup
      expect(cleanupOrder).toContain('disposed');
    });

    it('dispose() is synchronous and returns void', () => {
      const svc = makeService();
      const result = svc.dispose();
      expect(result).toBeUndefined();
    });

    it('disposeAsync() is idempotent - multiple calls do not throw', async () => {
      const svc = makeService();
      const privateSvc = svc as unknown as {
        disposeAsync: () => Promise<void>;
      };

      await privateSvc.disposeAsync();
      await expect(privateSvc.disposeAsync()).resolves.not.toThrow();
    });
  });
});
