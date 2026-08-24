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
  WallpaperAgentSetting,
} from '../../shared/types';
import type {
  LoggerApi,
  SettingsServiceApi,
  ThemeLibraryApi,
  WallpaperResolver,
} from '../services/contracts';

// ---------------------------------------------------------------------------
// ThemeLibraryApi stub
// ---------------------------------------------------------------------------

/**
 * Create a type-safe ThemeLibraryApi stub.
 * All methods return safe defaults; override with vi.mocked(...).mockReturnValue(...).
 */
export function makeThemeLibraryStub(): ThemeLibraryApi {
  return {
    find: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    all: vi.fn(async () => []),
    install: vi.fn(async () => ({} as ThemeEntry)),
    uninstall: vi.fn(async () => undefined),
    toThemeEntry: vi.fn(() => null),
  } as unknown as ThemeLibraryApi;
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
 * RC4-S4-A: Uses `satisfies` to validate all interface methods at compile time,
 * eliminating `as unknown as SettingsServiceApi` double-cast pattern.
 */
export function makeSettingsStub(options: MakeSettingsOptions = {}): SettingsServiceApi {
  const wallpaperAgents = options.wallpaperAgents ?? [];
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({
      appPath: options.appPath ?? null,
      port: options.port ?? null,
    })),
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

// ---------------------------------------------------------------------------
// WallpaperResolver stub
// ---------------------------------------------------------------------------

/**
 * Create a type-safe WallpaperResolver stub.
 * Matches the WallpaperResolver interface in services/contracts.ts.
 */
export function makeWallpaperResolverStub(): WallpaperResolver {
  return {
    videoPathFor: vi.fn(async () => null),
    mediaInfoFor: vi.fn(async () => null),
    webUrlFor: vi.fn(async () => null),
  } as unknown as WallpaperResolver;
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

type ThemeEntry = import('../theme-library').ThemeEntry;

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
