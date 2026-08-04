// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../adapters/base';
import type { ApplyThemeResult, RestoreThemeResult } from '../legacy/agentskin-core-runtime';
import type { AgentId, SystemStatus } from '../shared/types';
import type { SchemeSnapshot } from './agent-scheme';
import { type RestoreFlowDeps, restoreThemeFlow } from './theme-restore-flow';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';
const TEST_PORT = 9222;
const TEST_EPOCH = 7;
const STATUS: SystemStatus = { platform: 'win32', apps: [] };

/** Build a minimal ApplySkinResult for mocks (overrides optional). */
function makeApplySkinResult(overrides: Partial<ApplyThemeResult> = {}): ApplyThemeResult {
  return {
    action: 'apply',
    appId: TEST_APP,
    port: TEST_PORT,
    theme: { id: 'test-theme', displayName: 'Test Theme', version: '1.0.0' },
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

/** Build a mock ApplicationAdapter with a configurable restoreTheme implementation. */
function makeAdapter(restoreTheme: ApplicationAdapter['restoreTheme']): ApplicationAdapter {
  return {
    id: 'traework',
    name: 'Trae',
    type: 'agent',
    tier: 'active',
    coreId: 'trae',
    applyTheme: vi.fn(async () => makeApplySkinResult()) as ApplicationAdapter['applyTheme'],
    restoreTheme,
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
  schemeSnapshot?: SchemeSnapshot | null;
  restoreThemeImpl?: ApplicationAdapter['restoreTheme'];
}

function makeDeps(overrides: DepsOverrides = {}): RestoreFlowDeps {
  const adapter = makeAdapter(
    overrides.restoreThemeImpl ?? vi.fn(async () => makeRestoreSkinResult()),
  );
  return {
    adapter: () => adapter,
    isApplyingTheme: vi.fn(() => overrides.isApplyingTheme ?? false),
    lockAgent: vi.fn(),
    unlockAgent: vi.fn(),
    resolveLivePort: vi.fn(async () =>
      overrides.resolveLivePort === undefined ? TEST_PORT : overrides.resolveLivePort,
    ),
    bumpEpoch: vi.fn(() => TEST_EPOCH),
    getSchemeSnapshot: vi.fn(() => overrides.schemeSnapshot ?? null),
    clearActiveTheme: vi.fn(),
    persist: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    hardeningRemove: vi.fn(async () => {}),
    removeSecondaryTargets: vi.fn(async () => {}),
    removeAgentVideoWallpaper: vi.fn(async () => {}),
    restoreOriginalScheme: vi.fn(async () => {}),
    cleanupModuleStateForAgent: vi.fn(),
    status: vi.fn(async () => STATUS),
    log: vi.fn(),
    logStructured: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('restoreThemeFlow', () => {
  describe('success path', () => {
    it('returns the system status after a successful restore', async () => {
      const deps = makeDeps();
      const result = await restoreThemeFlow(TEST_APP, deps);
      expect(result).toBe(STATUS);
    });

    it('calls hardeningRemove before adapter.restoreTheme', async () => {
      const restoreTheme = vi.fn(async () => makeRestoreSkinResult());
      const deps = makeDeps({ restoreThemeImpl: restoreTheme });
      await restoreThemeFlow(TEST_APP, deps);
      const hardeningOrder = vi.mocked(deps.hardeningRemove).mock.invocationCallOrder[0];
      const restoreOrder = restoreTheme.mock.invocationCallOrder[0];
      expect(hardeningOrder).toBeLessThan(restoreOrder);
    });

    it('bumps epoch and passes it to hardeningRemove', async () => {
      const deps = makeDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.bumpEpoch).toHaveBeenCalledWith(TEST_APP);
      expect(deps.hardeningRemove).toHaveBeenCalledWith(TEST_APP, TEST_PORT, TEST_EPOCH);
    });

    it('calls removeSecondaryTargets and removeAgentVideoWallpaper after restore', async () => {
      const restoreTheme = vi.fn(async () => makeRestoreSkinResult());
      const deps = makeDeps({ restoreThemeImpl: restoreTheme });
      await restoreThemeFlow(TEST_APP, deps);
      const restoreOrder = restoreTheme.mock.invocationCallOrder[0];
      const secOrder = vi.mocked(deps.removeSecondaryTargets).mock.invocationCallOrder[0];
      const wpOrder = vi.mocked(deps.removeAgentVideoWallpaper).mock.invocationCallOrder[0];
      expect(restoreOrder).toBeLessThan(secOrder);
      expect(restoreOrder).toBeLessThan(wpOrder);
      expect(deps.removeSecondaryTargets).toHaveBeenCalledWith(TEST_APP, TEST_PORT, TEST_EPOCH);
      expect(deps.removeAgentVideoWallpaper).toHaveBeenCalledWith(TEST_APP, TEST_PORT, TEST_EPOCH);
    });

    it('calls restoreOriginalScheme with the captured snapshot', async () => {
      const snapshot: SchemeSnapshot = {
        agentId: TEST_APP,
        dataTheme: 'dark',
        storage: { 'trae-foundation-theme': JSON.stringify({ value: 'dark' }) },
      };
      const deps = makeDeps({ schemeSnapshot: snapshot });
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.restoreOriginalScheme).toHaveBeenCalledWith(
        TEST_APP,
        TEST_PORT,
        snapshot,
        TEST_EPOCH,
      );
    });

    it('clears active theme and persists state', async () => {
      const deps = makeDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.clearActiveTheme).toHaveBeenCalledWith(TEST_APP, TEST_PORT);
      expect(deps.persist).toHaveBeenCalledTimes(1);
    });

    it('calls cleanupModuleStateForAgent at the end', async () => {
      const deps = makeDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.cleanupModuleStateForAgent).toHaveBeenCalledWith(TEST_APP);
    });

    it('emits theme_restore structured event', async () => {
      const deps = makeDeps();
      await restoreThemeFlow(TEST_APP, deps);
      const events = vi.mocked(deps.logStructured).mock.calls.map((c) => c[0].type);
      expect(events).toContain('theme_restore');
    });

    it('releases the lock in finally on success', async () => {
      const deps = makeDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.unlockAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrency guard', () => {
    it('skips restore when isApplyingTheme returns true', async () => {
      const restoreTheme = vi.fn(async () => makeRestoreSkinResult());
      const deps = makeDeps({ isApplyingTheme: true, restoreThemeImpl: restoreTheme });
      const result = await restoreThemeFlow(TEST_APP, deps);
      expect(result).toBe(STATUS);
      expect(restoreTheme).not.toHaveBeenCalled();
      expect(deps.lockAgent).not.toHaveBeenCalled();
      expect(deps.bumpEpoch).not.toHaveBeenCalled();
    });
  });

  describe('no live CDP port', () => {
    it('clears persisted state only (no adapter.restoreTheme call)', async () => {
      const restoreTheme = vi.fn(async () => makeRestoreSkinResult());
      const deps = makeDeps({ resolveLivePort: null, restoreThemeImpl: restoreTheme });
      const result = await restoreThemeFlow(TEST_APP, deps);
      expect(restoreTheme).not.toHaveBeenCalled();
      expect(deps.clearActiveTheme).toHaveBeenCalledWith(TEST_APP, null);
      expect(deps.setAgentWallpaper).toHaveBeenCalledWith(TEST_APP, {
        enabled: false,
        id: null,
      });
      expect(deps.persist).toHaveBeenCalledTimes(1);
      expect(deps.cleanupModuleStateForAgent).toHaveBeenCalledWith(TEST_APP);
      expect(result).toBe(STATUS);
    });

    it('emits theme_restore even without a live port', async () => {
      const deps = makeDeps({ resolveLivePort: null });
      await restoreThemeFlow(TEST_APP, deps);
      const events = vi.mocked(deps.logStructured).mock.calls.map((c) => c[0].type);
      expect(events).toContain('theme_restore');
    });

    it('does not call hardeningRemove or restoreOriginalScheme', async () => {
      const deps = makeDeps({ resolveLivePort: null });
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.hardeningRemove).not.toHaveBeenCalled();
      expect(deps.restoreOriginalScheme).not.toHaveBeenCalled();
      expect(deps.lockAgent).not.toHaveBeenCalled();
    });
  });

  describe('P2-8: adapter.restoreTheme failure does not early-return', () => {
    const restoreError = new Error('restore boom');

    function makeFailingDeps(): RestoreFlowDeps {
      return makeDeps({
        restoreThemeImpl: vi.fn(async () => {
          throw restoreError;
        }),
      });
    }

    it('does not rethrow the adapter error', async () => {
      const deps = makeFailingDeps();
      await expect(restoreThemeFlow(TEST_APP, deps)).resolves.toBe(STATUS);
    });

    it('logs the failure and emits restore_failed event', async () => {
      const deps = makeFailingDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('restore boom'));
      const events = vi.mocked(deps.logStructured).mock.calls.map((c) => c[0].type);
      expect(events).toContain('restore_failed');
    });

    it('still calls removeSecondaryTargets after the failure', async () => {
      const deps = makeFailingDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.removeSecondaryTargets).toHaveBeenCalledWith(TEST_APP, TEST_PORT, TEST_EPOCH);
    });

    it('still calls removeAgentVideoWallpaper after the failure', async () => {
      const deps = makeFailingDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.removeAgentVideoWallpaper).toHaveBeenCalledWith(TEST_APP, TEST_PORT, TEST_EPOCH);
    });

    it('still calls restoreOriginalScheme after the failure', async () => {
      const deps = makeFailingDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.restoreOriginalScheme).toHaveBeenCalledWith(
        TEST_APP,
        TEST_PORT,
        expect.any(Object),
        TEST_EPOCH,
      );
    });

    it('still clears activeTheme and persists after the failure', async () => {
      const deps = makeFailingDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.clearActiveTheme).toHaveBeenCalledWith(TEST_APP, TEST_PORT);
      expect(deps.persist).toHaveBeenCalledTimes(1);
      expect(deps.cleanupModuleStateForAgent).toHaveBeenCalledWith(TEST_APP);
    });

    it('releases the lock in finally even on failure', async () => {
      const deps = makeFailingDeps();
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.unlockAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('P0-2: snapshot is null (synthetic fallback)', () => {
    it('calls restoreOriginalScheme with a synthetic fallback snapshot', async () => {
      const deps = makeDeps({ schemeSnapshot: null });
      await restoreThemeFlow(TEST_APP, deps);
      expect(deps.restoreOriginalScheme).toHaveBeenCalledWith(
        TEST_APP,
        TEST_PORT,
        { agentId: TEST_APP, dataTheme: null, storage: {} },
        TEST_EPOCH,
      );
    });

    it('does NOT skip restoreOriginalScheme when snapshot is null', async () => {
      const deps = makeDeps({ schemeSnapshot: null });
      await restoreThemeFlow(TEST_APP, deps);
      // The fix ensures restoreOriginalScheme is always called so the CDP
      // prefers-color-scheme emulation is cleared for no-strategy agents
      // (e.g. workbuddy) whose apply never produced a capturable snapshot.
      expect(deps.restoreOriginalScheme).toHaveBeenCalledTimes(1);
    });

    it('completes the full restore flow with a null snapshot', async () => {
      const deps = makeDeps({ schemeSnapshot: null });
      const result = await restoreThemeFlow(TEST_APP, deps);
      expect(deps.clearActiveTheme).toHaveBeenCalledWith(TEST_APP, TEST_PORT);
      expect(deps.persist).toHaveBeenCalledTimes(1);
      expect(deps.cleanupModuleStateForAgent).toHaveBeenCalledWith(TEST_APP);
      const events = vi.mocked(deps.logStructured).mock.calls.map((c) => c[0].type);
      expect(events).toContain('theme_restore');
      expect(result).toBe(STATUS);
    });
  });
});
