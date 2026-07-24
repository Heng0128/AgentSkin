// SPDX-License-Identifier: MPL-2.0

/**
 * # Service Contracts
 *
 * Named interfaces for the three main-process services that the orchestrator
 * (`AgentEngineService`), boot sequence, and IPC handlers depend on.
 *
 * ## Why interfaces for concrete classes?
 *
 * Before this module, `AgentEngineService` constructed with
 * `ThemeLibrary` / `SettingsService` as concrete-class parameters. That made
 * the orchestrator untestable in isolation — any unit test had to stand up
 * the real filesystem-backed `ThemeLibrary`. With these interfaces:
 *
 *   1. `AgentEngineService` and IPC handlers depend on `*Api` interfaces.
 *   2. Unit tests can inject in-memory mocks.
 *   3. Future replacements (e.g. `MarketplaceService implements ThemeLibraryApi`)
 *      drop in without touching the orchestrator.
 *
 * The concrete classes declare `implements *Api` so the compiler verifies
 * the contract at the class definition site — drift between interface and
 * implementation surfaces immediately, not at the first call site.
 *
 * ## Boundary
 *
 * These interfaces live under `main/services/` (not `shared/`) because they
 * are main-process-only contracts. The renderer never imports them — it
 * talks to these services via the IPC bridge (`AgentSkinApi` in
 * `shared/types.ts`).
 */

import type { AgentId, DesktopSettings, InstalledTheme, WallpaperAgentSetting, WallpaperSettings } from '../../shared/types';
import type { ThemeEntry, PackageInspection } from '../theme-library';

/**
 * Theme installation / persistence surface. Mirrors the public methods of
 * {@link ThemeLibrary}. `ThemeCatalog.ThemeDataProvider` is a narrow subset
 * of this (just `summaries()`).
 */
export interface ThemeLibraryApi {
  initialize(): Promise<void>;
  entries(): Promise<ThemeEntry[]>;
  summaries(): Promise<InstalledTheme[]>;
  find(themeId: string): Promise<ThemeEntry>;
  installFile(sourcePath: string): Promise<InstalledTheme>;
  installBytes(bytes: Buffer, suggestedId: string): Promise<InstalledTheme>;
  importPackage(sourcePath: string): Promise<InstalledTheme>;
  inspectPackage(sourcePath: string): Promise<PackageInspection>;
  exportPackage(themeId: string, destination: string): Promise<void>;
  delete(themeId: string): Promise<void>;
}

/**
 * User-set detection overrides and wallpaper preferences. Mirrors the public
 * methods of {@link SettingsService}.
 */
export interface SettingsServiceApi {
  initialize(): Promise<void>;
  overridesFor(appId: AgentId): { appPath: string | null; port: number | null };
  wallpaper(): WallpaperSettings;
  agentWallpaper(appId: AgentId): WallpaperAgentSetting;
  toDto(defaultPorts: Record<AgentId, number>): DesktopSettings;
  setAppPath(appId: AgentId, appPath: string | null): Promise<void>;
  setAppPort(appId: AgentId, port: number | null): Promise<void>;
  setWallpaper(wallpaper: Pick<WallpaperSettings, 'enabled' | 'id'>): Promise<void>;
  setAgentWallpaper(appId: AgentId, setting: WallpaperAgentSetting): Promise<void>;
}

/**
 * Wallpaper media discovery and CDP injection surface. Mirrors the public
 * methods of {@link WallpaperService}.
 *
 * `AgentEngineService` only needs `videoPathFor` + `mediaInfoFor` (the slice
 * it consumes via `setWallpaperService`); the full interface is exposed for
 * IPC handlers and the boot sequence.
 */
export interface WallpaperServiceApi {
  setCustomDir(dir: string): void;
  scan(): Promise<void>;
  list(): Promise<import('../../shared/types').WallpaperInfo[]>;
  registerThemeWallpaper(themeId: string, videoPath: string, title?: string): Promise<void>;
  importMedia(sourcePath: string): Promise<string | null>;
  deleteWallpaper(id: string): Promise<boolean>;
  mediaPathFor(id: string): Promise<string | null>;
  videoPathFor(id: string): Promise<string | null>;
  mediaInfoFor(id: string): Promise<{ type: 'video' | 'image'; path: string } | null>;
  isInstalled(): Promise<boolean>;
  count(): Promise<number>;
}

/**
 * Narrow slice of {@link WallpaperServiceApi} that `AgentEngineService`
 * consumes via `setWallpaperService`. Declared separately so the orchestrator
 * depends on the smallest possible surface (and tests can stub just these
 * two methods).
 */
export interface WallpaperResolver {
  videoPathFor(id: string): Promise<string | null>;
  mediaInfoFor(id: string): Promise<{ type: 'video' | 'image'; path: string } | null>;
}

// ---------------------------------------------------------------------------
// Logger contract
// ---------------------------------------------------------------------------

/**
 * Plain log-line sink. Every main-process module that emits diagnostics
 * accepts this shape so a single `LoggerApi` implementation can fan out a
 * line to the dev console, the engine log file, and the renderer's
 * runtime-log panel.
 */
export type LogCallback = (line: string) => void;

/**
 * Full union of structured event types emitted across the engine layer
 * (`AgentEngineService` + the extracted modules under `src/main/`).
 *
 * Each consuming module narrows this union to the subset it actually emits
 * (e.g. `app-discovery.ts` only emits the `cdp_*` events, `scheme-sync.ts`
 * only emits `scheme_sync`) so the orchestrator's wider `logStructured`
 * stays assignable via parameter contravariance.
 */
export interface StructuredLogEvent {
  type:
    | 'theme_apply' | 'theme_restore'
    | 'boot_start' | 'boot_done'
    | 'boot_agent_start' | 'boot_agent_done' | 'boot_agent_failed'
    | 'cdp_resolving' | 'cdp_killing' | 'cdp_spawning'
    | 'cdp_ready' | 'cdp_timeout' | 'cdp_spawn_failed'
    | 'inject_start' | 'inject_done' | 'inject_failed'
    | 'scheme_sync' | 'apply_failed' | 'restore_failed';
  agentId: string;
  themeId?: string;
  timestamp: string;
  /** Free-form phase discriminator within an event type (e.g. scheme_sync: start|stable|drifted|done). */
  phase?: string;
  /** 0..100 progress within the current agent's restore. */
  progress?: number;
  /** Free-form reason string for failure/timeout events. */
  reason?: string;
  /** Number of agents involved (only for boot_start / boot_done). */
  agentCount?: number;
}

/**
 * Combined logger surface that {@link AgentEngineService} implements.
 * Consumers (the boot sequence, future marketplace / cloud services, tests)
 * can depend on this interface rather than the concrete class so the
 * underlying sink can be swapped or mocked.
 *
 * Modules that emit only a subset of {@link StructuredLogEvent} should
 * declare their own narrower callback type (assignable to
 * `(event: StructuredLogEvent) => void` via parameter contravariance) — this
 * preserves compile-time exhaustiveness checks at the emit site.
 */
export interface LoggerApi {
  log(line: string): void;
  logStructured(event: StructuredLogEvent): void;
}
