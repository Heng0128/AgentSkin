// SPDX-License-Identifier: MPL-2.0

/**
 * # Shared Mock Services for Tests
 *
 * Type-safe factory functions for creating service stubs used across
 * AgentEngineService test files. Eliminates `as any` / `as unknown as`
 * casts in individual tests by providing properly typed mock objects.
 *
 * RC4-S4-A: Created to consolidate 5 test files' divergent mock patterns
 * into a single, type-safe source of truth.
 */

import { vi } from 'vitest';
import type {
  AgentId,
  DesktopSettings,
  InstalledTheme,
  WallpaperAgentSetting,
  WallpaperSettings,
} from '../../shared/types';
import type {
  LoggerApi,
  PackageInspection,
  SettingsServiceApi,
  ThemeEntry,
  ThemeLibraryApi,
  WallpaperResolver,
} from '../services/contracts';
import type { ThemeBundle } from '../services/theme-bundle';

// ---------------------------------------------------------------------------
// ThemeLibraryApi stub
// ---------------------------------------------------------------------------

/**
 * Create a type-safe ThemeLibraryApi stub.
 * All methods return safe defaults; override with vi.mocked(...).mockReturnValue(...).
 * Uses satisfies operator for compile-time type checking without `as any`.
 */
export function makeThemeLibraryStub(): ThemeLibraryApi {
  return {
    initialize: vi.fn(async () => {}),
    entries: vi.fn(async () => []),
    summaries: vi.fn(async () => []),
    coverPathFor: vi.fn((_id: string) => null),
    iconPathFor: vi.fn((_id: string) => null),
    find: vi.fn(async () => ({ bundle: {} as ThemeBundle, filePath: '/tmp/test' })),
    installFile: vi.fn(async () => ({}) as InstalledTheme),
    installBytes: vi.fn(async () => ({}) as InstalledTheme),
    importPackage: vi.fn(async () => ({}) as InstalledTheme),
    inspectPackage: vi.fn(
      async () => ({ incoming: {} as InstalledTheme, existing: null }) as PackageInspection,
    ),
    exportPackage: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  } satisfies ThemeLibraryApi;
}

// ---------------------------------------------------------------------------
// SettingsServiceApi stub
// ---------------------------------------------------------------------------

export interface MakeSettingsOptions {
  port?: number | null;
  appPath?: string | null;
  wallpaperAgents?: AgentId[];
}

/**
 * Create a type-safe SettingsServiceApi stub.
 * Uses `satisfies` to validate all interface methods at compile time,
 * eliminating `as unknown as SettingsServiceApi` double-cast pattern.
 */
export function makeSettingsStub(options: MakeSettingsOptions = {}): SettingsServiceApi {
  const wallpaperAgents = options.wallpaperAgents ?? [];
  const stub: SettingsServiceApi = {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({
      appPath: options.appPath ?? null,
      port: options.port ?? null,
    })),
    wallpaper: vi.fn(
      () =>
        ({
          enabled: false,
          id: null,
          render: { alignment: 'fill', speed: 1, loop: true, brightness: 100 },
          agents: {} as Record<AgentId, WallpaperAgentSetting>,
        }) as WallpaperSettings,
    ),
    agentWallpaper: vi.fn(
      (appId: AgentId) =>
        ({
          enabled: wallpaperAgents.includes(appId),
          id: null,
        }) as WallpaperAgentSetting,
    ),
    toDto: vi.fn(() => ({}) as DesktopSettings),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
    liveDomRefreshInterval: vi.fn(() => 0),
    setLiveDomRefreshInterval: vi.fn(async () => {}),
  };
  return stub;
}

// ---------------------------------------------------------------------------
// WallpaperResolver stub
// ---------------------------------------------------------------------------

/**
 * Create a type-safe WallpaperResolver stub.
 * Matches the WallpaperResolver interface in services/contracts.ts.
 * Uses satisfies operator for compile-time type checking.
 */
export function makeWallpaperResolverStub(): WallpaperResolver {
  return {
    videoPathFor: vi.fn(async () => null),
    mediaInfoFor: vi.fn(async () => null),
    webUrlFor: vi.fn(async () => null),
  } satisfies WallpaperResolver;
}

// ---------------------------------------------------------------------------
// LoggerApi stub
// ---------------------------------------------------------------------------

/**
 * Create a type-safe LoggerApi stub (spies for log/logStructured).
 */
export function makeLoggerStub(): LoggerApi {
  return {
    log: vi.fn(),
    logStructured: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// ThemeEntry minimal mock (for test fixtures)
// ---------------------------------------------------------------------------

/**
 * Create a minimal ThemeEntry for testing wallpaper resolution.
 * Provides the minimum fields needed by toInstalledTheme().
 */
export function makeThemeEntry(overrides: Partial<ThemeEntry> = {}): ThemeEntry {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    author: 'test',
    themesDir: '/tmp/test',
    manifest: {
      name: 'Test Theme',
      version: '1.0.0',
      author: 'test',
      description: 'Test theme for unit tests',
      compatibility: { agents: ['traework'] },
      theme: {
        colors: {},
        tokenMapping: {},
      },
    },
    wallpaper: null,
    ...overrides,
  } as ThemeEntry;
}
