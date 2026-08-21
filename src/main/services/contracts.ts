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

import type {
  AgentId,
  ApplyRequest,
  ApplyResponse,
  DesktopSettings,
  InstalledTheme,
  SystemStatus,
  WallpaperAgentSetting,
  WallpaperSettings,
} from '../../shared/types';
import type { ConcurrencyMetrics } from '../../shared/types/concurrency';
import type { ThemeBundle } from './theme-bundle';

// ---------------------------------------------------------------------------
// Theme library data shapes
// ---------------------------------------------------------------------------

/**
 * A parsed theme package on disk plus its filesystem path.
 *
 * Lives in the contracts module (not `theme-library.ts`) so the
 * {@link ThemeLibraryApi} interface is self-contained — consumers of the
 * interface don't transitively import the concrete `ThemeLibrary` class.
 */
export interface ThemeEntry {
  bundle: ThemeBundle;
  filePath: string;
}

/**
 * Result of inspecting a theme package file without installing it.
 *
 * `incoming` describes the package as it would be installed; `existing`
 * is the currently-installed theme with the same id (if any), so the UI
 * can show "this will replace X" before the user confirms.
 */
export interface PackageInspection {
  incoming: InstalledTheme;
  /** The installed theme this import would replace, when the id is taken. */
  existing: InstalledTheme | null;
}

/**
 * Theme installation / persistence surface. Mirrors the public methods of
 * {@link ThemeLibrary}. `ThemeCatalog.ThemeDataProvider` is a narrow subset
 * of this (just `summaries()`).
 */
export interface ThemeLibraryApi {
  initialize(): Promise<void>;
  entries(): Promise<ThemeEntry[]>;
  summaries(): Promise<InstalledTheme[]>;
  /** Resolve the extracted cover image path for a theme id (agentskin-theme://). */
  coverPathFor(id: string): string | null;
  iconPathFor(id: string): string | null;
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
  setWallpaper(wallpaper: Pick<WallpaperSettings, 'enabled' | 'id' | 'render'>): Promise<void>;
  setAgentWallpaper(appId: AgentId, setting: WallpaperAgentSetting): Promise<void>;
  /** Read the global user-authored theme CSS (empty string when unset). */
  customThemeCss(): string;
  /** Replace the global user-authored theme CSS. Empty string clears it. */
  setCustomThemeCss(css: string): Promise<void>;
}

/**
 * Wallpaper media discovery and CDP injection surface. Mirrors the public
 * methods of {@link WallpaperService}.
 *
 * `AgentEngineService` only needs `videoPathFor` + `mediaInfoFor` +
 * `webUrlFor` (the slice it consumes via `setWallpaperService`); the full
 * interface is exposed for IPC handlers and the boot sequence.
 */
export interface WallpaperServiceApi {
  setCustomDir(dir: string): void;
  scan(): Promise<void>;
  list(): Promise<import('../../shared/types').WallpaperInfo[]>;
  registerThemeWallpaper(themeId: string, videoPath: string, title?: string): Promise<void>;
  importMedia(sourcePath: string): Promise<string | null>;
  deleteWallpaper(id: string): Promise<boolean>;
  mediaPathFor(id: string): Promise<string | null>;
  /** Resolve a wallpaper's media as a streamable loopback HTTP URL so video
   *  wallpapers can play without buffering the whole file (no size cap).
   *  Returns null when the id is unknown. */
  videoUrlFor(id: string): Promise<string | null>;
  /** Resolve a web/scene wallpaper's rendered content as a loopback HTTP URL
   *  suitable for iframe injection. For web wallpapers, the URL points at
   *  index.html inside the registered directory tree. For scene wallpapers,
   *  the URL serves a self-contained HTML canvas renderer generated from
   *  scene.pkg. Returns null when the id is unknown or the wallpaper is not
   *  a web/scene type. */
  webUrlFor(id: string): Promise<string | null>;
  previewPathFor(id: string): Promise<string | null>;
  /**
   * Background warmup of L1 preview cache for the given wallpapers.
   * Called during the boot warm-up phase to pre-generate high-def previews
   * for wallpapers most likely to be visible in the grid.
   *
   * @param itemIds - Ordered list of wallpaper ids to warm up (visible first).
   * @param sourcePaths - Map of wallpaper id → absolute preview-source path.
   */
  warmupPreviewCache(itemIds: string[], sourcePaths: Map<string, string>): Promise<void>;
  /**
   * Resolve a streamable preview URL for a single wallpaper (L1 lazy load).
   * Uses PreviewCache for 1920px cached previews; falls back to the media
   * server loopback URL. Returns null when no preview exists.
   */
  previewUrlFor(id: string): Promise<string | null>;
  videoPathFor(id: string): Promise<string | null>;
  mediaInfoFor(id: string): Promise<{
    type: 'video' | 'image' | 'web' | 'scene';
    path: string;
    /** Absolute path to the wallpaper's still preview image (preview.jpg/png/gif),
     *  or null. Used for the wallpaper library UI. */
    previewPath: string | null;
    previewOnly: boolean;
  } | null>;
  isInstalled(): Promise<boolean>;
  count(): Promise<number>;
}

/**
 * Narrow slice of {@link WallpaperServiceApi} that `AgentEngineService`
 * consumes via `setWallpaperService`. Declared separately so the orchestrator
 * depends on the smallest possible surface (and tests can stub just these
 * methods).
 */
export interface WallpaperResolver {
  videoPathFor(id: string): Promise<string | null>;
  mediaInfoFor(id: string): Promise<{
    type: 'video' | 'image' | 'web' | 'scene';
    path: string;
    /** Absolute path to the wallpaper's still preview image (preview.jpg/png/gif),
     *  or null. Used for the wallpaper library UI. */
    previewPath: string | null;
    previewOnly: boolean;
  } | null>;
  /** Resolve a web/scene wallpaper's rendered content URL for iframe
   *  injection. Returns null for non-web/scene wallpapers. */
  webUrlFor(id: string): Promise<string | null>;
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
    | 'theme_apply'
    | 'theme_restore'
    | 'boot_start'
    | 'boot_done'
    | 'boot_agent_start'
    | 'boot_agent_done'
    | 'boot_agent_failed'
    | 'cdp_resolving'
    | 'cdp_killing'
    | 'cdp_spawning'
    | 'cdp_ready'
    | 'cdp_timeout'
    | 'cdp_spawn_failed'
    | 'inject_start'
    | 'inject_done'
    | 'inject_failed'
    | 'scheme_sync'
    | 'apply_failed'
    | 'restore_failed';
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

// ---------------------------------------------------------------------------
// Agent engine orchestrator contract
// ---------------------------------------------------------------------------

/**
 * Orchestrator surface that wires together theme apply/restore, CDP injection,
 * wallpaper injection, scheme sync, and app discovery. Mirrors the public
 * methods of {@link AgentEngineService}.
 *
 * Declared as an interface so:
 *   1. `MainContext.core` can be typed against this contract instead of the
 *      concrete class — `main-context.ts` no longer needs to type-import
 *      `AgentEngineService`, breaking a type-level coupling.
 *   2. Unit tests for IPC handlers / boot sequence can inject a stub
 *      orchestrator without standing up the real CDP + filesystem stack.
 *
 * The concrete class declares `implements AgentEngineServiceApi` so the
 * compiler verifies the contract at the class definition site. The boot
 * sequence is the only place that instantiates the concrete class; every
 * other consumer depends on this interface.
 */
export interface AgentEngineServiceApi {
  /** Wire the wallpaper resolver before {@link initialize}. */
  setWallpaperService(svc: WallpaperResolver): void;
  /** Wire the log line sink before {@link initialize}. */
  setLogListener(listener: (line: string) => void): void;
  /** Expose the logger as a {@link LoggerApi} for consumers. */
  asLogger(): LoggerApi;

  /** Boot-time initialization (restore active themes, etc.). */
  initialize(): Promise<void>;
  /** Drop active-theme references for ids no longer in the library (upgrade path). */
  reconcileActiveThemes(availableIds: Set<string>): Promise<void>;

  /** Snapshot of every agent's install/running/debug/theme status. */
  status(): Promise<SystemStatus>;
  /** Apply a theme to an agent (user-initiated). */
  apply(request: ApplyRequest): Promise<ApplyResponse>;
  /** Restore an agent to its default look (user-initiated). Returns updated status. */
  restore(appId: AgentId): Promise<SystemStatus>;
  /** Restore all agents to their defaults (boot / "restore all" tray action). */
  restoreAll(): Promise<void>;

  /** Immediately push the per-agent wallpaper preference into the agent.
   *  When `restartExisting` is false/absent, only probes for an existing CDP
   *  port — returns `{ ok: false, reason: 'requires-restart' }` if the agent
   *  is running without `--remote-debugging-port`. Pass `restartExisting:
   *  true` ONLY after the user has explicitly confirmed a restart. */
  applyAgentWallpaperNow(
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }>;
  /** Apply a specific wallpaper to a specific agent (one-shot).
   *  Same `restartExisting` two-phase CDP discovery as
   *  {@link applyAgentWallpaperNow}. */
  applyWallpaperToAgent(
    wallpaperId: string,
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }>;
  /** Remove the wallpaper from a specific agent. */
  removeWallpaperFromAgent(appId: AgentId): Promise<{ ok: boolean }>;

  /**
   * Collect current concurrency metrics from all main-process sources
   * (inflightOperations, persistChain depth, selfHealingAgents,
   * capturedTokens, deferredSelfHeals) plus the two cached renderer-side
   * values (companionBusyByAgent, switchEpochByAgent).
   */
  collectConcurrencyMetrics(): ConcurrencyMetrics;
  /**
   * Update the cached sizes of renderer-side concurrency primitives so the
   * next metrics broadcast includes them. Fire-and-forget from the renderer
   * via IPC.
   */
  updateConcurrencyMetricsFromRenderer(companionBusy: number, switchEpoch: number): void;
  /**
   * Start the 5-second periodic broadcast of concurrency metrics to the
   * renderer. The `sender` callback delivers each payload. Idempotent.
   */
  startConcurrencyMetricsTimer(sender: (metrics: ConcurrencyMetrics) => void): void;
  /** Stop the periodic metrics broadcast. Safe to call multiple times. */
  stopConcurrencyMetricsTimer(): void;

  /**
   * Release all module-scoped state retained by sub-modules (CDP
   * persistence-script ids, wallpaper media-server tokens, self-heal
   * counters, cover/icon caches, etc.). Called once at before-quit so the
   * process exits cleanly with no dangling streaming file handles or
   * retained references.
   */
  dispose(): void;
}
