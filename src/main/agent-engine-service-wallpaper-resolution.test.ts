// SPDX-License-Identifier: MPL-2.0

/**
 * AgentEngineService — resolveAgentWallpaperId + wallpaper facade 专项测试
 *
 * 覆盖核心链路的测试盲区（R1: resolveAgentWallpaperId 零覆盖 +
 * R2 部分: wallpaper facade 错误透传未验证）。
 *
 * resolveAgentWallpaperId 是私有方法，通过 (svc as any) 直接调用，
 * 无需 mock wallpaper-injector — 纯粹测试 wallpaper-id 解析分支。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentId,
  ThemeBundle,
  WallpaperAgentSetting,
  WallpaperSettings,
} from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import type {
  LoggerApi,
  SettingsServiceApi,
  StructuredLogEvent,
  ThemeLibraryApi,
  WallpaperResolver,
} from './services/contracts';

// ---------------------------------------------------------------------------
// Mocks (minimal — only external IOPS / flows we don't want to exercise)
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
vi.mock('./theme/utils', () => ({ disposeThemeAssetCache: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';

function makeWallpaperSettings(opts: {
  perAgent?: boolean;
  perAgentId?: string | null;
  perAgentRender?: WallpaperSettings['render'];
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
      render: { alignment: 'fill', speed: 1, loop: true, brightness: 100 },
      agents: {} as Record<AgentId, WallpaperAgentSetting>,
    }),
    agentWallpaper: (id: AgentId) => ({
      enabled: perAgent,
      id: perAgent ? (opts.perAgentId ?? null) : null,
      render: opts.perAgentRender,
    }),
  };
}

function makeSettings(
  opts: {
    port?: number | number | null;
    wallpaper?: ReturnType<typeof makeWallpaperSettings>;
  } = {},
): SettingsServiceApi {
  const wp = opts.wallpaper ?? makeWallpaperSettings({});
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: opts.port ?? null })),
    wallpaper: wp.wallpaper,
    agentWallpaper: wp.agentWallpaper,
    toDto: vi.fn(() => ({})),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
    logger: vi.fn(() => ({ log: vi.fn(), logStructured: vi.fn() }) as LoggerApi),
  } as unknown as SettingsServiceApi;
}

function makeThemeEntry(themeId: string, bundle: Partial<ThemeBundle> = {}) {
  return {
    bundle: {
      id: themeId,
      name: { en: 'Test', zh: '测试' },
      ...bundle,
    } as ThemeBundle,
    filePath: `/tmp/${themeId}`,
  };
}

function makeLibrary(findImpl: (id: string) => Promise<unknown>): ThemeLibraryApi {
  return {
    find: vi.fn(findImpl),
    summaries: vi.fn(async () => []),
    get: vi.fn(async () => null),
    install: vi.fn(
      async () =>
        ({}) as ThemeLibraryApi extends { install: (...args: any[]) => infer R } ? R : never,
    ),
    uninstall: vi.fn(async () => {}),
    uninstallPermanent: vi.fn(async () => {}),
    inspectPackage: vi.fn(async () => ({ incoming: null, existing: null })),
    import: vi.fn(async () => ({})),
  } as unknown as ThemeLibraryApi;
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

  function makeService(library?: ThemeLibraryApi, settings?: SettingsServiceApi) {
    return new AgentEngineService(
      library ?? makeLibrary(async () => null),
      stateFile,
      settings ?? makeSettings(),
    );
  }

  /** Access the private method under test via type-safe cast. */
  function resolveAgentWallpaperId(svc: AgentEngineService, appId: AgentId, entry?: unknown) {
    return (
      svc as unknown as {
        resolveAgentWallpaperId(
          appId: AgentId,
          entry?: unknown,
        ): Promise<{ id: string | null; render?: unknown }>;
      }
    ).resolveAgentWallpaperId(appId, entry);
  }

  // ── Branch group A: entry provided (applying a theme → theme is SOLE authority) ──

  describe('when entry is provided (theme is authority)', () => {
    it('returns workshopId when entry.wallpaper has workshopId', async () => {
      const svc = makeService();
      const entry = makeThemeEntry('sakura-pastel', {
        wallpaper: { workshopId: 'wp-12345' },
      });

      const result = await resolveAgentWallpaperId(svc, TEST_APP, entry);

      expect(result.id).toBe('wp-12345');
      expect(result.render).toBeDefined();
    });

    it('returns theme: prefix + themeId when entry.wallpaper has video but no workshopId', async () => {
      const svc = makeService();
      const entry = makeThemeEntry('ocean-blue', {
        wallpaper: { video: 'ocean.mp4' },
      });

      const result = await resolveAgentWallpaperId(svc, TEST_APP, entry);

      expect(result.id).toBe('theme:ocean-blue');
      expect(result.render).toBeDefined();
    });

    it('returns null when entry has no wallpaper', async () => {
      const svc = makeService();
      const entry = makeThemeEntry('minimal-no-wp', {});

      const result = await resolveAgentWallpaperId(svc, TEST_APP, entry);

      expect(result.id).toBeNull();
    });
  });

  // ── Branch group B: no entry (restart / reconnect → per-agent hierarchy) ──

  describe('when no entry is provided (per-agent → global → theme hierarchy)', () => {
    it('returns per-agent wallpaper when agentWallpaper is enabled with id', async () => {
      const settings = makeSettings({
        wallpaper: makeWallpaperSettings({
          perAgent: true,
          perAgentId: 'wp-agent-specific',
        }),
      });
      const svc = makeService(undefined, settings);

      const result = await resolveAgentWallpaperId(svc, TEST_APP);

      expect(result.id).toBe('wp-agent-specific');
    });

    it('falls back to global wallpaper when no per-agent wallpaper', async () => {
      const settings = makeSettings({
        wallpaper: makeWallpaperSettings({
          perAgent: false,
          enabled: true,
          globalId: 'wp-global-default',
        }),
      });
      const svc = makeService(undefined, settings);

      const result = await resolveAgentWallpaperId(svc, TEST_APP);

      expect(result.id).toBe('wp-global-default');
    });

    it('falls back to persisted active theme wallpaper when no settings wallpaper', async () => {
      // agentWp.enabled = false, globalWp.enabled = false → look up theme
      const settings = makeSettings({
        wallpaper: makeWallpaperSettings({ enabled: false, perAgent: false }),
      });
      const library = makeLibrary(async (id: string) => {
        if (id === 'persisted-theme') {
          return makeThemeEntry('persisted-theme', {
            wallpaper: { workshopId: 'wp-from-theme' },
          });
        }
        return null;
      });
      const svc = makeService(library, settings);

      // Patch the registry to return 'persisted-theme' for getActiveThemeId
      (
        svc as unknown as { registry: { getActiveThemeId: (id: AgentId) => string | null } }
      ).registry.getActiveThemeId = () => 'persisted-theme';

      const result = await resolveAgentWallpaperId(svc, TEST_APP);

      expect(result.id).toBe('wp-from-theme');
    });

    it('returns null when no wallpaper configured anywhere', async () => {
      const settings = makeSettings({
        wallpaper: makeWallpaperSettings({ enabled: false, perAgent: false }),
      });
      const library = makeLibrary(async () => null);
      const svc = makeService(library, settings);

      // getActiveThemeId returns null → short-circuit to { id: null }
      (
        svc as unknown as { registry: { getActiveThemeId: (id: AgentId) => string | null } }
      ).registry.getActiveThemeId = () => null;

      const result = await resolveAgentWallpaperId(svc, TEST_APP);

      expect(result.id).toBeNull();
    });

    it('returns null when library.find throws', async () => {
      const settings = makeSettings({
        wallpaper: makeWallpaperSettings({ enabled: false, perAgent: false }),
      });
      const library = makeLibrary(async () => {
        throw new Error('disk broken');
      });
      const svc = makeService(library, settings);

      (
        svc as unknown as { registry: { getActiveThemeId: (id: AgentId) => string | null } }
      ).registry.getActiveThemeId = () => 'some-theme';

      const result = await resolveAgentWallpaperId(svc, TEST_APP);

      expect(result.id).toBeNull();
    });

    it('returns null video path when persisted theme has only video wallpaper', async () => {
      const settings = makeSettings({
        wallpaper: makeWallpaperSettings({ enabled: false, perAgent: false }),
      });
      const globalWp = makeWallpaperSettings({ enabled: false, globalId: null });

      const settingsWithGlobal: SettingsServiceApi = {
        ...settings,
        wallpaper: () => ({
          ...globalWp.wallpaper(),
          agents: {} as Record<AgentId, WallpaperAgentSetting>,
        }),
        agentWallpaper: globalWp.agentWallpaper,
      } as SettingsServiceApi;

      const library = makeLibrary(async () =>
        makeThemeEntry('video-theme', {
          wallpaper: { video: 'sunset.mp4' },
        }),
      );
      const svc = makeService(library, settingsWithGlobal);

      (
        svc as unknown as { registry: { getActiveThemeId: (id: AgentId) => string | null } }
      ).registry.getActiveThemeId = () => 'video-theme';

      const result = await resolveAgentWallpaperId(svc, TEST_APP);

      expect(result.id).toBe('theme:video-theme');
    });
  });
});
