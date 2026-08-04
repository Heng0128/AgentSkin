// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../adapters/base';
import {
  type ApplyThemeResult,
  ERROR_CODES,
  type RestoreThemeResult,
} from '../legacy/agentskin-core-runtime';
import type { AgentId, ApplyRequest, SystemStatus } from '../shared/types';
import type { CdpReadyResult } from './app-discovery';
import type { ThemeEntry } from './services/contracts';
import { type ApplyFlowDeps, applyThemeFlow } from './theme-apply-flow';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';
const TEST_PORT = 9222;
const TEST_THEME_ID = 'test-theme';
const STATUS: SystemStatus = { platform: 'win32', apps: [] };

/** Build a minimal ApplySkinResult for mocks (overrides optional). */
function makeApplySkinResult(overrides: Partial<ApplyThemeResult> = {}): ApplyThemeResult {
  return {
    action: 'apply',
    appId: TEST_APP,
    port: TEST_PORT,
    theme: { id: TEST_THEME_ID, displayName: 'Test Theme', version: '1.0.0' },
    launch: null,
    host: { supported: false },
    targets: [],
    ...overrides,
  };
}

/** Build a minimal RestoreSkinResult for mocks (overrides optional). */
function makeRestoreSkinResult(overrides: Partial<RestoreThemeResult> = {}): RestoreThemeResult {
  return {
    action: 'restore',
    appId: TEST_APP,
    port: TEST_PORT,
    renderer: { restored: true },
    host: { supported: false },
    ...overrides,
  };
}

/** Build a ThemeEntry with optional `theme.copy` overrides (wallpaper, mode). */
function makeEntry(copy?: Record<string, unknown>): ThemeEntry {
  return {
    bundle: {
      format: 'agentskin-theme' as const,
      schemaVersion: 1,
      theme: {
        id: TEST_THEME_ID,
        displayName: 'Test Theme',
        version: '1.0.0',
        ...(copy ? { copy } : {}),
      },
      targets: { traework: { css: 'body { color: red; }' } },
    },
    filePath: '/fake',
  };
}

/** Build a mock ApplicationAdapter with a configurable applyTheme implementation. */
function makeAdapter(applyTheme: ApplicationAdapter['applyTheme']): ApplicationAdapter {
  return {
    id: 'traework',
    name: 'Trae',
    type: 'agent',
    tier: 'active',
    coreId: 'trae',
    applyTheme,
    restoreTheme: vi.fn(async () => makeRestoreSkinResult()) as ApplicationAdapter['restoreTheme'],
    detect: vi.fn(async () => true),
    getPath: vi.fn(async () => null),
    discover: vi.fn(async () => null),
    findTargets: vi.fn(async () => []),
    findRunningPids: vi.fn(async () => []),
    resolveDebugPorts: vi.fn(async () => []),
    defaultPort: vi.fn(() => TEST_PORT),
    displayName: vi.fn(() => 'Trae'),
  } as unknown as ApplicationAdapter;
}

interface DepsOverrides {
  isApplyingTheme?: boolean;
  resolveLivePort?: number | null;
  ensureCdpPort?: number | null;
  ensureCdpReason?: 'not-installed' | 'spawn-error' | 'singleton-lock' | 'timeout' | null;
  bumpEpochResult?: number;
  applyThemeImpl?: ApplicationAdapter['applyTheme'];
  findThemeEntry?: ReturnType<typeof makeEntry>;
  getAppPath?: string | null;
}

function makeDeps(overrides: DepsOverrides = {}): ApplyFlowDeps {
  const adapter = makeAdapter(overrides.applyThemeImpl ?? vi.fn(async () => makeApplySkinResult()));
  return {
    adapter: () => adapter,
    isApplyingTheme: vi.fn(() => overrides.isApplyingTheme ?? false),
    lockAgent: vi.fn(),
    unlockAgent: vi.fn(),
    ensureCdpReady: vi.fn(async (): Promise<CdpReadyResult> => {
      if (overrides.ensureCdpPort !== null && overrides.ensureCdpPort !== undefined) {
        return { port: overrides.ensureCdpPort, reason: null };
      }
      return { port: null, reason: overrides.ensureCdpReason ?? 'timeout' };
    }),
    resolveLivePort: vi.fn(async () =>
      overrides.resolveLivePort === undefined ? TEST_PORT : overrides.resolveLivePort,
    ),
    inferRestartReason: vi.fn(async () => 'not-running' as const),
    findTheme: vi.fn(async () => overrides.findThemeEntry ?? makeEntry()),
    bumpEpoch: vi.fn(() => overrides.bumpEpochResult ?? 42),
    setActiveTheme: vi.fn(),
    persist: vi.fn(async () => {}),
    getAppPath: vi.fn(() => overrides.getAppPath ?? null),
    setAgentWallpaper: vi.fn(async () => {}),
    injectSecondaryTargets: vi.fn(async () => {}),
    hardeningPass: vi.fn(async () => {}),
    injectAgentWallpaperFromApply: vi.fn(async () => {}),
    syncSchemeWithStability: vi.fn(async () => {}),
    status: vi.fn(async () => STATUS),
    displayName: vi.fn(() => 'Trae'),
    log: vi.fn(),
    logStructured: vi.fn(),
  };
}

function makeRequest(overrides: Partial<ApplyRequest> = {}): ApplyRequest {
  return {
    themeId: TEST_THEME_ID,
    appId: TEST_APP,
    port: TEST_PORT,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyThemeFlow', () => {
  describe('success path', () => {
    it('returns status=applied on successful adapter.applyTheme', async () => {
      const deps = makeDeps();
      const response = await applyThemeFlow(makeRequest(), deps);
      expect(response.status).toBe('applied');
      expect(response.system).toBe(STATUS);
    });

    it('bumps epoch before calling adapter.applyTheme', async () => {
      const applyTheme = vi.fn(async () => makeApplySkinResult());
      const deps = makeDeps({ applyThemeImpl: applyTheme });
      await applyThemeFlow(makeRequest(), deps);
      const bumpEpochOrder = vi.mocked(deps.bumpEpoch).mock.invocationCallOrder[0];
      const applyThemeOrder = applyTheme.mock.invocationCallOrder[0];
      expect(bumpEpochOrder).toBeLessThan(applyThemeOrder);
    });

    it('passes the new epoch to injectSecondaryTargets and hardeningPass', async () => {
      const deps = makeDeps({ bumpEpochResult: 99 });
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.injectSecondaryTargets).toHaveBeenCalledWith(
        TEST_APP,
        TEST_PORT,
        expect.any(Object),
        99,
      );
      expect(deps.hardeningPass).toHaveBeenCalledWith(TEST_APP, TEST_PORT, expect.any(Object), 99);
    });

    it('calls lockAgent before applyTheme and unlockAgent after (success)', async () => {
      const applyTheme = vi.fn(async () => makeApplySkinResult());
      const deps = makeDeps({ applyThemeImpl: applyTheme });
      await applyThemeFlow(makeRequest(), deps);
      const lockOrder = vi.mocked(deps.lockAgent).mock.invocationCallOrder[0];
      const applyOrder = applyTheme.mock.invocationCallOrder[0];
      const unlockOrder = vi.mocked(deps.unlockAgent).mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(applyOrder);
      expect(applyOrder).toBeLessThan(unlockOrder);
    });

    it('invokes hardeningPass and injectSecondaryTargets (non-blocking)', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.injectSecondaryTargets).toHaveBeenCalledTimes(1);
      expect(deps.hardeningPass).toHaveBeenCalledTimes(1);
    });

    it('invokes injectAgentWallpaperFromApply after success', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.injectAgentWallpaperFromApply).toHaveBeenCalledWith(
        TEST_APP,
        TEST_PORT,
        expect.any(Object),
        42,
      );
    });

    it('persists active theme via setActiveTheme + persist', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.setActiveTheme).toHaveBeenCalledWith(TEST_APP, TEST_THEME_ID, TEST_PORT);
      expect(deps.persist).toHaveBeenCalledTimes(1);
    });

    it('emits inject_start, inject_done and theme_apply structured events', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest(), deps);
      const events = vi.mocked(deps.logStructured).mock.calls.map((c) => c[0].type);
      expect(events).toContain('inject_start');
      expect(events).toContain('inject_done');
      expect(events).toContain('theme_apply');
    });
  });

  describe('concurrency guard', () => {
    it('skips apply when isApplyingTheme returns true', async () => {
      const applyTheme = vi.fn(async () => makeApplySkinResult());
      const deps = makeDeps({ isApplyingTheme: true, applyThemeImpl: applyTheme });
      const response = await applyThemeFlow(makeRequest(), deps);
      expect(response.status).toBe('applied');
      expect(applyTheme).not.toHaveBeenCalled();
      expect(deps.lockAgent).not.toHaveBeenCalled();
      expect(deps.bumpEpoch).not.toHaveBeenCalled();
    });
  });

  describe('CDP discovery', () => {
    it('uses the port provided in the request (skips discovery)', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest({ port: 9333 }), deps);
      expect(deps.resolveLivePort).not.toHaveBeenCalled();
      expect(deps.ensureCdpReady).not.toHaveBeenCalled();
    });

    it('probes via resolveLivePort when no port and restartExisting=false', async () => {
      const deps = makeDeps({ resolveLivePort: 9444 });
      await applyThemeFlow(makeRequest({ port: undefined, restartExisting: false }), deps);
      expect(deps.resolveLivePort).toHaveBeenCalledWith(TEST_APP);
      expect(deps.ensureCdpReady).not.toHaveBeenCalled();
    });

    it('returns requires-restart when resolveLivePort returns null', async () => {
      const deps = makeDeps({ resolveLivePort: null });
      const response = await applyThemeFlow(
        makeRequest({ port: undefined, restartExisting: false }),
        deps,
      );
      expect(response.status).toBe('requires-restart');
      expect(response.restartReason).toBe('not-running');
      expect(deps.inferRestartReason).toHaveBeenCalledWith(TEST_APP, null);
    });

    it('uses ensureCdpReady when restartExisting is true', async () => {
      const deps = makeDeps({ ensureCdpPort: 9555 });
      const response = await applyThemeFlow(
        makeRequest({ port: undefined, restartExisting: true }),
        deps,
      );
      // The unified CDP-readiness helper (cdp/cdp-ready.ts) passes the 30s
      // default timeout explicitly.
      expect(deps.ensureCdpReady).toHaveBeenCalledWith(TEST_APP, 30000);
      expect(response.status).toBe('applied');
    });

    it('returns requires-restart when ensureCdpReady fails (null port)', async () => {
      const deps = makeDeps({
        ensureCdpPort: null,
        ensureCdpReason: 'singleton-lock',
      });
      const response = await applyThemeFlow(
        makeRequest({ port: undefined, restartExisting: true }),
        deps,
      );
      expect(response.status).toBe('requires-restart');
      expect(deps.inferRestartReason).toHaveBeenCalledWith(TEST_APP, 'singleton-lock');
    });
  });

  describe('error mapping', () => {
    it('maps RESTART_REQUIRED to requires-restart', async () => {
      const applyTheme = vi.fn(async () => {
        throw Object.assign(new Error('restart needed'), {
          code: ERROR_CODES.RESTART_REQUIRED,
        });
      });
      const deps = makeDeps({ applyThemeImpl: applyTheme });
      const response = await applyThemeFlow(makeRequest(), deps);
      expect(response.status).toBe('requires-restart');
      // Lock must still be released via the finally block.
      expect(deps.unlockAgent).toHaveBeenCalledTimes(1);
      // No active theme should be persisted on error.
      expect(deps.setActiveTheme).not.toHaveBeenCalled();
    });

    it('emits apply_failed structured event on error', async () => {
      const applyTheme = vi.fn(async () => {
        throw Object.assign(new Error('restart needed'), {
          code: ERROR_CODES.RESTART_REQUIRED,
        });
      });
      const deps = makeDeps({ applyThemeImpl: applyTheme });
      await applyThemeFlow(makeRequest(), deps);
      const events = vi.mocked(deps.logStructured).mock.calls.map((c) => c[0].type);
      expect(events).toContain('apply_failed');
    });

    it('maps PORT_OCCUPIED to port-occupied (uses error.port when present)', async () => {
      const applyTheme = vi.fn(async () => {
        throw Object.assign(new Error('port occupied'), {
          code: ERROR_CODES.PORT_OCCUPIED,
          port: 8888,
        });
      });
      const deps = makeDeps({ applyThemeImpl: applyTheme });
      const response = await applyThemeFlow(makeRequest(), deps);
      expect(response.status).toBe('port-occupied');
      expect(deps.unlockAgent).toHaveBeenCalledTimes(1);
    });

    it('rethrows unknown errors after releasing the lock', async () => {
      const applyTheme = vi.fn(async () => {
        throw new Error('unexpected failure');
      });
      const deps = makeDeps({ applyThemeImpl: applyTheme });
      await expect(applyThemeFlow(makeRequest(), deps)).rejects.toThrow('unexpected failure');
      expect(deps.unlockAgent).toHaveBeenCalledTimes(1);
      expect(deps.setActiveTheme).not.toHaveBeenCalled();
    });
  });

  describe('wallpaper sync', () => {
    it('sets enabled wallpaper when theme has workshopId wallpaper', async () => {
      const entry = makeEntry({ wallpaper: { workshopId: '12345' } });
      const deps = makeDeps({ findThemeEntry: entry });
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.setAgentWallpaper).toHaveBeenCalledWith(TEST_APP, {
        enabled: true,
        id: '12345',
      });
    });

    it('uses theme:<id> when wallpaper has video but no workshopId', async () => {
      const entry = makeEntry({ wallpaper: { video: 'bg.mp4' } });
      const deps = makeDeps({ findThemeEntry: entry });
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.setAgentWallpaper).toHaveBeenCalledWith(TEST_APP, {
        enabled: true,
        id: `theme:${TEST_THEME_ID}`,
      });
    });

    it('clears wallpaper setting when theme has no wallpaper', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.setAgentWallpaper).toHaveBeenCalledWith(TEST_APP, {
        enabled: false,
        id: null,
      });
    });
  });

  describe('scheme sync', () => {
    it('calls syncSchemeWithStability when theme has a resolvable mode', async () => {
      const entry = makeEntry({ mode: 'dark' });
      const deps = makeDeps({ findThemeEntry: entry });
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.syncSchemeWithStability).toHaveBeenCalledWith(
        TEST_APP,
        expect.any(Number),
        'dark',
        expect.any(Number),
      );
    });

    it('skips syncSchemeWithStability when mode is unresolved', async () => {
      const deps = makeDeps();
      await applyThemeFlow(makeRequest(), deps);
      expect(deps.syncSchemeWithStability).not.toHaveBeenCalled();
    });
  });
});
