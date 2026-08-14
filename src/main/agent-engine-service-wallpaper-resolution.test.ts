// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService — resolveAgentWallpaperId + wallpaper facade 专项测试
 *
 * 覆盖核心链路的测试盲区：
 *   - R1: resolveAgentWallpaperId 所有分支零覆盖
 *   - 补充测试: wallpaper facade 错误透传未验证
 *
 * resolveAgentWallpaperId 是私有方法，通过 (svc as any) 直接调用，
 * 无需 mock wallpaper-injector — 纯粹测试 wallpaper-id 解析分支逻辑。
 */

import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId, WallpaperRenderOptions, WallpaperSettings } from '../shared/types';
import type { WallpaperAgentSetting } from '../shared/types/wallpaper';
// Real toInstalledTheme requires deep ThemeBundle; we mock it below.
import { AgentEngineService } from './agent-engine-service';
import type { PackageInspection, SettingsServiceApi, ThemeLibraryApi } from './services/contracts';

// ---------------------------------------------------------------------------
// Mocks (与 reliability test 保持一致)
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
  appendLogLine: vi.fn(),
}));
vi.mock('./wallpaper-injector', () => ({
  applyAgentWallpaperNow: vi.fn(),
  applyWallpaperToAgent: vi.fn(),
  injectAgentWallpaperFromApply: vi.fn(async () => {}),
  removeAgentVideoWallpaper: vi.fn(async () => {}),
  removeWallpaperFromAgent: vi.fn(),
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
vi.mock('./theme/utils', () => ({
  disposeThemeAssetCache: vi.fn(),
  inferModeFromColors: vi.fn(() => 'dark'),
  toInstalledTheme: vi.fn((entry: { bundle: { id: string; wallpaper?: unknown } }) => ({
    id: entry.bundle.id,
    wallpaper: entry.bundle.wallpaper ?? null,
  })),
}));
vi.mock('./services/agent-engine-options', () => ({
  themeRenderOptions: vi.fn(() => ({
    alignment: 'fill' as const,
    speed: 1,
    loop: true,
    brightness: 100,
  })),
  mergeRenderOptions: vi.fn((_a: unknown, b: unknown) => b),
}));

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';

const DEFAULT_RENDER: WallpaperRenderOptions = {
  alignment: 'fill',
  speed: 1,
  loop: true,
  brightness: 100,
};

function wallpaperSettings(opts: {
  perAgent?: boolean;
  perAgentId?: string | null;
  enabled?: boolean;
  globalId?: string | null;
}): {
  wallpaper: () => WallpaperSettings;
  agentWallpaper: (id: AgentId) => WallpaperAgentSetting;
} {
  const enabled = opts.enabled ?? false;
  const perAgent = opts.perAgent ?? false;
  return {
    wallpaper: () => ({
      enabled,
      id: opts.globalId ?? null,
      render: DEFAULT_RENDER,
      agents: {} as Record<AgentId, WallpaperAgentSetting>,
    }),
    agentWallpaper: () => ({
      enabled: perAgent,
      id: perAgent ? (opts.perAgentId ?? null) : null,
      render: undefined,
    }),
  };
}

function makeSettings(wp?: ReturnType<typeof wallpaperSettings>): SettingsServiceApi {
  const wpApi = wp ?? wallpaperSettings({});
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: null })),
    wallpaper: wpApi.wallpaper,
    agentWallpaper: wpApi.agentWallpaper,
    toDto: vi.fn(() => ({}) as ReturnType<SettingsServiceApi['toDto']>),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
  } as SettingsServiceApi;
}

interface TestThemeBundle {
  id: string;
  name: { en: string; zh: string };
  wallpaper?: unknown;
}

interface TestThemeEntry {
  bundle: TestThemeBundle;
  filePath: string;
}

function themeEntry(themeId: string, bundle: Partial<TestThemeBundle> = {}): TestThemeEntry {
  return {
    bundle: { id: themeId, name: { en: 'Test', zh: '测试' }, ...bundle },
    filePath: `/tmp/${themeId}`,
  };
}

function makeThemeLibrary(impl: (id: string) => Promise<unknown>): ThemeLibraryApi {
  return {
    initialize: vi.fn(async () => {}),
    entries: vi.fn(async () => []),
    summaries: vi.fn(async () => []),
    coverPathFor: vi.fn(() => null),
    iconPathFor: vi.fn(() => null),
    find: vi.fn(impl),
    installFile: vi.fn(async () => ({}) as never),
    installBytes: vi.fn(async () => ({}) as never),
    importPackage: vi.fn(async () => ({}) as never),
    inspectPackage: vi.fn(
      async () => ({ incoming: null, existing: null }) as unknown as PackageInspection,
    ),
    exportPackage: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  } as ThemeLibraryApi;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('AgentEngineService — resolveAgentWallpaperId', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-wpres-'));
    stateFile = path.join(tmpDir, 'state.json');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeSvc(library?: ThemeLibraryApi, settings?: SettingsServiceApi) {
    return new AgentEngineService(
      library ?? makeThemeLibrary(async () => null),
      stateFile,
      settings ?? makeSettings(),
    );
  }

  function callResolve(svc: AgentEngineService, appId: AgentId, entry?: unknown) {
    return (
      svc as unknown as {
        resolveAgentWallpaperId(
          appId: AgentId,
          entry?: unknown,
        ): Promise<{
          id: string | null;
          render?: WallpaperRenderOptions;
        }>;
      }
    ).resolveAgentWallpaperId(appId, entry);
  }

  // ── A: entry provided (theme is SOLE authority) ────────────────────────

  describe('when entry provided (applying theme)', () => {
    it('returns workshopId when theme.wallpaper has workshopId', async () => {
      const svc = makeSvc();
      const entry = themeEntry('sakura-pastel', { wallpaper: { workshopId: 'wp-12345' } });

      const result = await callResolve(svc, TEST_APP, entry);

      expect(result.id).toBe('wp-12345');
      expect(result.render).toBeDefined();
    });

    it('returns theme: prefixed id when theme.wallpaper has video only', async () => {
      const svc = makeSvc();
      const entry = themeEntry('ocean-blue', { wallpaper: { video: 'ocean.mp4' } });

      const result = await callResolve(svc, TEST_APP, entry);

      expect(result.id).toBe('theme:ocean-blue');
      expect(result.render).toBeDefined();
    });

    it('returns null when theme has no wallpaper', async () => {
      const svc = makeSvc();
      const entry = themeEntry('minimal-no-wp');

      const result = await callResolve(svc, TEST_APP, entry);

      expect(result.id).toBeNull();
    });
  });

  // ── B: no entry (restart/reconnect — per-agent → global → persisted) ────

  describe('when no entry provided (per-agent → global hierarchy)', () => {
    it('returns per-agent wallpaper id when agentWallpaper.enabled', async () => {
      const settings = makeSettings(
        wallpaperSettings({ perAgent: true, perAgentId: 'wp-agent-x' }),
      );
      const svc = makeSvc(undefined, settings);

      const result = await callResolve(svc, TEST_APP);

      expect(result.id).toBe('wp-agent-x');
    });

    it('returns null when agentWallpaper disabled and no active theme (no global fallback for id)', async () => {
      // Production code reads globalWp only for render mergeOptions;
      // globalWp.id is NOT used as a fallback wallpaper id.
      const settings = makeSettings(
        wallpaperSettings({ enabled: true, globalId: 'wp-global-default' }),
      );
      const svc = makeSvc(undefined, settings);

      // getActiveThemeId returns null → returns { id: null }
      const result = await callResolve(svc, TEST_APP);

      expect(result.id).toBeNull();
    });

    it('falls back to persisted active theme wallpaper workshopId', async () => {
      // Write a valid persisted state so initialize() loads the active theme
      writeFileSync(
        stateFile,
        JSON.stringify({
          version: 2,
          apps: {
            [TEST_APP]: {
              activeThemeId: 'persisted-t',
              activeSchemeId: null,
              port: null,
              schemeSnapshot: null,
              detectedPath: null,
            },
          },
        }),
        'utf8',
      );

      const settings = makeSettings(wallpaperSettings({}));
      const library = makeThemeLibrary(async () =>
        themeEntry('persisted-t', { wallpaper: { workshopId: 'wp-from-theme' } }),
      );
      const svc = makeSvc(library, settings);
      await svc.initialize();

      const result = await callResolve(svc, TEST_APP);

      expect(result.id).toBe('wp-from-theme');
    });

    it('returns null when no wallpaper configured anywhere (no active theme)', async () => {
      const settings = makeSettings(wallpaperSettings({}));
      const library = makeThemeLibrary(async () => null);
      const svc = makeSvc(library, settings);

      (svc as unknown as { registry: { getActiveThemeId: () => null } }).registry.getActiveThemeId =
        () => null;

      const result = await callResolve(svc, TEST_APP);

      expect(result.id).toBeNull();
    });

    it('returns null when library.find throws (disk/parse error)', async () => {
      const settings = makeSettings(wallpaperSettings({}));
      const library = makeThemeLibrary(async () => {
        throw new Error('EACCES: disk broken');
      });
      const svc = makeSvc(library, settings);

      (
        svc as unknown as { registry: { getActiveThemeId: () => string } }
      ).registry.getActiveThemeId = () => 'some-theme';

      const result = await callResolve(svc, TEST_APP);

      expect(result.id).toBeNull();
    });

    it('returns theme: prefix when persisted theme has video-only wallpaper', async () => {
      writeFileSync(
        stateFile,
        JSON.stringify({
          version: 2,
          apps: {
            [TEST_APP]: {
              activeThemeId: 'video-t',
              activeSchemeId: null,
              port: null,
              schemeSnapshot: null,
              detectedPath: null,
            },
          },
        }),
        'utf8',
      );

      const settings = makeSettings(wallpaperSettings({}));
      const library = makeThemeLibrary(async () =>
        themeEntry('video-t', { wallpaper: { video: 'sunset.mp4' } }),
      );
      const svc = makeSvc(library, settings);
      await svc.initialize();

      const result = await callResolve(svc, TEST_APP);

      expect(result.id).toBe('theme:video-t');
    });
  });
});
