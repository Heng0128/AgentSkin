// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeVisualSnapshot } from '../../shared/types';
import { isIpcTimeoutError } from '../../shared/withTimeout';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing the module under test.
// ---------------------------------------------------------------------------

const TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskin-studio-ipc-test-'));
const TEST_APP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskin-studio-app-root-'));

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'userData' ? TEST_USER_DATA : os.tmpdir())),
    getAppPath: vi.fn(() => TEST_APP_ROOT),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

const snapshotThemeVisuals = vi.fn();
const startInspect = vi.fn();
const findDomTargets = vi.fn();

vi.mock('../cdp/snapshot-theme', () => ({
  snapshotThemeVisuals: (...args: unknown[]) => snapshotThemeVisuals(...args),
}));
vi.mock('../cdp/inspect-session', () => ({
  startInspect: (...args: unknown[]) => startInspect(...args),
}));
vi.mock('../cdp/cdp-targets', () => ({
  findDomTargets: (...args: unknown[]) => findDomTargets(...args),
}));

const { registerStudioIpc } = await import('./studio-ipc');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, ...args) as T;
}

function makeDeps() {
  return {
    applyTheme: vi.fn().mockResolvedValue({ ok: true }),
    restoreApp: vi.fn().mockResolvedValue({}),
    getActiveThemeId: vi.fn().mockResolvedValue(null),
    resolveLivePort: vi.fn().mockResolvedValue(9336),
    getThemeName: vi.fn().mockResolvedValue('Amber Dusk'),
    log: vi.fn(),
    push: vi.fn(),
  };
}

function makeSnapshot(partial: Partial<ThemeVisualSnapshot> = {}): ThemeVisualSnapshot {
  return {
    themeId: 'amber-dusk',
    themeName: '',
    agentId: 'traework',
    timestamp: '2026-08-08T00:00:00.000Z',
    landmarks: [],
    summary: {
      totalLandmarks: 0,
      visibleLandmarks: 0,
      selectorsTried: 0,
      boxModelAvailable: true,
      cascadeAvailable: true,
    },
    ...partial,
  };
}

function makeInspectController() {
  return { stop: vi.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('registerStudioIpc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    snapshotThemeVisuals.mockResolvedValue(makeSnapshot());
    startInspect.mockResolvedValue(makeInspectController());
    findDomTargets.mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools' }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('studio:snapshot', () => {
    it('validates agentId', async () => {
      registerStudioIpc(makeDeps());
      await expect(
        call('studio:snapshot', { agentId: 'not-an-agent', themeId: undefined }),
      ).rejects.toThrow();
      expect(snapshotThemeVisuals).not.toHaveBeenCalled();
    });

    it('rejects unsafe theme ids', async () => {
      registerStudioIpc(makeDeps());
      await expect(
        call('studio:snapshot', { agentId: 'traework', themeId: '../evil' }),
      ).rejects.toThrow();
      expect(snapshotThemeVisuals).not.toHaveBeenCalled();
    });

    it('captures without a theme and returns the snapshot', async () => {
      const deps = makeDeps();
      registerStudioIpc(deps);
      const result = await call<ThemeVisualSnapshot>('studio:snapshot', {
        agentId: 'traework',
        themeId: undefined,
        options: { extraSelectors: ['.custom'] },
      });
      expect(snapshotThemeVisuals).toHaveBeenCalledWith('traework', undefined, expect.anything(), {
        extraSelectors: ['.custom'],
      });
      expect(result.agentId).toBe('traework');
      // No theme → no name resolution
      expect(deps.getThemeName).not.toHaveBeenCalled();
      expect(result.themeName).toBe('');
    });

    it('fills themeName from the catalog when a theme is applied', async () => {
      const deps = makeDeps();
      registerStudioIpc(deps);
      const result = await call<ThemeVisualSnapshot>('studio:snapshot', {
        agentId: 'traework',
        themeId: 'amber-dusk',
      });
      expect(snapshotThemeVisuals).toHaveBeenCalledWith(
        'traework',
        'amber-dusk',
        expect.anything(),
        undefined,
      );
      expect(deps.getThemeName).toHaveBeenCalledWith('amber-dusk');
      expect(result.themeName).toBe('Amber Dusk');
    });

    it('falls back to empty name when the theme is not in the catalog', async () => {
      const deps = makeDeps();
      deps.getThemeName.mockResolvedValue(null);
      registerStudioIpc(deps);
      const result = await call<ThemeVisualSnapshot>('studio:snapshot', {
        agentId: 'traework',
        themeId: 'amber-dusk',
      });
      expect(result.themeName).toBe('');
    });
  });

  describe('studio:export', () => {
    it('builds the theme package via the build script', async () => {
      // Stub the dynamic-imported build script under the mocked app root.
      const scriptsDir = path.join(TEST_APP_ROOT, 'scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });
      const _buildThemePackage = vi.fn().mockResolvedValue('/out/pkg');
      fs.writeFileSync(
        path.join(scriptsDir, 'build-theme-package.mjs'),
        `export async function buildThemePackage(req, outDir) {
          globalThis.__lastBuildRequest = req;
          return ${JSON.stringify('/out/pkg')};
        }`,
      );

      registerStudioIpc(makeDeps());
      const result = await call<{ packageDir: string }>('studio:export', { themeId: 'x' });
      expect(result.packageDir).toBe('/out/pkg');
    });
  });

  describe('studio:inspect:start / stop', () => {
    it('starts inspect with the resolved port and target', async () => {
      const deps = makeDeps();
      registerStudioIpc(deps);
      const result = await call<{ ok: boolean }>('studio:inspect:start', { agentId: 'traework' });
      expect(result.ok).toBe(true);
      expect(deps.resolveLivePort).toHaveBeenCalledWith('traework');
      expect(findDomTargets).toHaveBeenCalledWith(9336);
      expect(startInspect).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'traework',
          webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools',
        }),
      );
    });

    it('validates agentId', async () => {
      registerStudioIpc(makeDeps());
      await expect(call('studio:inspect:start', { agentId: 'nope' })).rejects.toThrow();
      expect(startInspect).not.toHaveBeenCalled();
    });

    it('throws when no debug port is available', async () => {
      const deps = makeDeps();
      deps.resolveLivePort.mockResolvedValue(null);
      registerStudioIpc(deps);
      await expect(call('studio:inspect:start', { agentId: 'traework' })).rejects.toThrow(
        /No debug port/,
      );
    });

    it('throws when no DOM-bearing CDP target is found', async () => {
      findDomTargets.mockResolvedValue([]);
      registerStudioIpc(makeDeps());
      await expect(call('studio:inspect:start', { agentId: 'traework' })).rejects.toThrow(
        /No DOM-bearing CDP target/,
      );
    });

    it('stops the previous session before starting a new one', async () => {
      const first = makeInspectController();
      startInspect.mockResolvedValueOnce(first);
      registerStudioIpc(makeDeps());
      await call('studio:inspect:start', { agentId: 'traework' });
      await call('studio:inspect:start', { agentId: 'traework' });
      expect(first.stop).toHaveBeenCalledTimes(1);
      expect(startInspect).toHaveBeenCalledTimes(2);
    });

    it('stop returns ok with no active session', async () => {
      registerStudioIpc(makeDeps());
      const result = await call<{ ok: boolean }>('studio:inspect:stop');
      expect(result.ok).toBe(true);
    });

    it('stop tears down the active session', async () => {
      const controller = makeInspectController();
      startInspect.mockResolvedValueOnce(controller);
      registerStudioIpc(makeDeps());
      await call('studio:inspect:start', { agentId: 'traework' });
      const result = await call<{ ok: boolean }>('studio:inspect:stop');
      expect(result.ok).toBe(true);
      expect(controller.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopAllInspects (window-closed cleanup)', () => {
    it('is idempotent when no session is active', async () => {
      const { stopAllInspects } = registerStudioIpc(makeDeps());
      await expect(stopAllInspects()).resolves.toBeUndefined();
      await expect(stopAllInspects()).resolves.toBeUndefined();
    });

    it('stops the active session and clears the reference', async () => {
      const controller = makeInspectController();
      startInspect.mockResolvedValueOnce(controller);
      const { stopAllInspects } = registerStudioIpc(makeDeps());
      await call('studio:inspect:start', { agentId: 'traework' });
      await stopAllInspects();
      expect(controller.stop).toHaveBeenCalledTimes(1);
      // A second cleanup must not call stop again (reference already cleared).
      await stopAllInspects();
      expect(controller.stop).toHaveBeenCalledTimes(1);
    });

    it('logs instead of throwing when stop fails', async () => {
      const controller = makeInspectController();
      controller.stop.mockRejectedValue(new Error('ws gone'));
      startInspect.mockResolvedValueOnce(controller);
      const deps = makeDeps();
      const { stopAllInspects } = registerStudioIpc(deps);
      await call('studio:inspect:start', { agentId: 'traework' });
      await expect(stopAllInspects()).resolves.toBeUndefined();
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('ws gone'));
    });
  });

  describe('studio:snapshot:baseline', () => {
    it('captures native look, restores, and re-applies the previous theme', async () => {
      const deps = makeDeps();
      deps.getActiveThemeId.mockResolvedValue('graphite-code');
      snapshotThemeVisuals.mockResolvedValue(makeSnapshot({ themeId: '' }));
      registerStudioIpc(deps);

      const result = await call<ThemeVisualSnapshot>('studio:snapshot:baseline', {
        agentId: 'traework',
      });

      expect(deps.restoreApp).toHaveBeenCalledWith('traework');
      expect(snapshotThemeVisuals).toHaveBeenCalledWith(
        'traework',
        undefined,
        expect.anything(),
        undefined,
      );
      expect(deps.applyTheme).toHaveBeenCalledWith({ themeId: 'graphite-code', appId: 'traework' });
      expect(result.agentId).toBe('traework');
    });

    it('skips restore when no theme is active', async () => {
      const deps = makeDeps();
      deps.getActiveThemeId.mockResolvedValue(null);
      registerStudioIpc(deps);
      await call<ThemeVisualSnapshot>('studio:snapshot:baseline', { agentId: 'traework' });
      expect(deps.restoreApp).not.toHaveBeenCalled();
      expect(deps.applyTheme).not.toHaveBeenCalled();
    });

    it('re-applies the previous theme even when the snapshot capture throws', async () => {
      const deps = makeDeps();
      deps.getActiveThemeId.mockResolvedValue('graphite-code');
      snapshotThemeVisuals.mockRejectedValue(new Error('capture boom'));
      registerStudioIpc(deps);
      await expect(call('studio:snapshot:baseline', { agentId: 'traework' })).rejects.toThrow(
        'capture boom',
      );
      expect(deps.applyTheme).toHaveBeenCalledWith({ themeId: 'graphite-code', appId: 'traework' });
    });

    it('validates agentId', async () => {
      registerStudioIpc(makeDeps());
      await expect(call('studio:snapshot:baseline', { agentId: 'nope' })).rejects.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: THEME_STUDIO_SNAPSHOT_BASELINE — dependency passthrough + timeout
// ---------------------------------------------------------------------------

describe('THEME_STUDIO_SNAPSHOT_BASELINE regression', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    // Default mocks so registerStudioIpc can complete without errors.
    snapshotThemeVisuals.mockResolvedValue(makeSnapshot());
    startInspect.mockResolvedValue(makeInspectController());
    findDomTargets.mockResolvedValue([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools' }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('dependency failure passes through original error (not wrapped as IpcTimeoutError)', async () => {
    const deps = makeDeps();
    deps.getActiveThemeId.mockResolvedValue(null); // skip restore / re-apply path
    snapshotThemeVisuals.mockRejectedValue(new Error('CDP capture boom'));
    registerStudioIpc(deps);

    await expect(call('studio:snapshot:baseline', { agentId: 'traework' })).rejects.toThrow(
      'CDP capture boom',
    );
    try {
      await call('studio:snapshot:baseline', { agentId: 'traework' });
    } catch (err) {
      expect(isIpcTimeoutError(err)).toBe(false);
    }
  });

  it('rejects with IpcTimeoutError when the handler exceeds 60s', async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    deps.getActiveThemeId.mockResolvedValue('graphite-code');
    deps.restoreApp.mockResolvedValue({});
    // Multi-step CDP mock: snapshotThemeVisuals never settles → triggers the 60s timeout.
    // After the fix, the outer watchdog fires the compensation re-apply immediately
    // without waiting for the inner pending function to settle.
    snapshotThemeVisuals.mockReturnValue(new Promise<never>(() => {}));
    registerStudioIpc(deps);

    const promise = call<ThemeVisualSnapshot>('studio:snapshot:baseline', { agentId: 'traework' });
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });

  it('re-applies the previous theme even when snapshot baseline times out', async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    deps.getActiveThemeId.mockResolvedValue('graphite-code');
    deps.restoreApp.mockResolvedValue({});
    // snapshotThemeVisuals never settles → triggers the 60s timeout.
    snapshotThemeVisuals.mockReturnValue(new Promise<never>(() => {}));
    registerStudioIpc(deps);

    const promise = call<ThemeVisualSnapshot>('studio:snapshot:baseline', { agentId: 'traework' });
    const assertion = expect(promise).rejects.toSatisfy((r: unknown) => isIpcTimeoutError(r));
    await vi.runAllTimersAsync();
    await assertion;

    // The watchdog compensation path must fire — applyTheme is called with the
    // previously active theme, even though the inner snapshot function is still pending.
    expect(deps.applyTheme).toHaveBeenCalledWith({ themeId: 'graphite-code', appId: 'traework' });
    vi.useRealTimers();
  });
});
