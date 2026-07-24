// SPDX-License-Identifier: MPL-2.0

import type { AppLocale } from './i18n';

export type Platform = 'darwin' | 'win32' | 'unsupported';

/** Platform-registered target agents. */
export type AgentId = 'workbuddy' | 'qoderwork' | 'traework' | 'doubao';

/**
 * Canonical product metadata for every recognized agent.
 *
 * This is the SINGLE SOURCE OF TRUTH for display names, official names,
 * regions, and tier classification. All other layers (AgentCatalog,
 * AgentEngineService, APP_META) derive their display strings from here —
 * never maintain parallel name maps.
 */
export interface AgentMeta {
  readonly id: AgentId;
  /** User-facing product name shown in the UI. */
  readonly displayName: string;
  /** Brand / official name (not translated). */
  readonly officialName: string;
  /** Market region for this agent build. */
  readonly region: 'CN' | 'International' | 'Global';
  /** Whether this agent is a formal product or experimental. */
  readonly tier: 'active' | 'experimental';
}

export const AGENT_META: Readonly<Record<AgentId, AgentMeta>> = Object.freeze({
  traework: Object.freeze({
    id: 'traework',
    displayName: 'TRAE Work CN',
    officialName: 'TRAE',
    region: 'CN',
    tier: 'active',
  }),
  qoderwork: Object.freeze({
    id: 'qoderwork',
    displayName: 'QoderWork CN',
    officialName: 'Qoder',
    region: 'CN',
    tier: 'active',
  }),
  workbuddy: Object.freeze({
    id: 'workbuddy',
    displayName: 'WorkBuddy',
    officialName: 'WorkBuddy',
    region: 'Global',
    tier: 'active',
  }),
  doubao: Object.freeze({
    id: 'doubao',
    displayName: '豆包',
    officialName: 'Doubao',
    region: 'CN',
    tier: 'active',
  }),
});

/** Formal product agents — shown in the main UI, checked for status, listed in settings. */
export const AGENT_IDS: readonly AgentId[] = Object.freeze(
  (Object.values(AGENT_META) as AgentMeta[]).filter((m) => m.tier === 'active').map((m) => m.id),
);

/** Experimental / non-formal agents — isolated from the main UI but still recognized by the theme system. */
export const EXPERIMENTAL_AGENT_IDS: readonly AgentId[] = Object.freeze(
  (Object.values(AGENT_META) as AgentMeta[])
    .filter((m) => m.tier === 'experimental')
    .map((m) => m.id),
);

/** All recognized agent ids (formal + experimental). Used by the theme system and validation. */
export const ALL_AGENT_IDS: readonly AgentId[] = Object.freeze([
  ...AGENT_IDS,
  ...EXPERIMENTAL_AGENT_IDS,
]);

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (ALL_AGENT_IDS as readonly string[]).includes(value);
}

export interface Agent {
  id: AgentId;
  name: string;
  category: 'domestic' | 'global' | 'experimental';
  icon: string;
  installed: boolean;
  status: InstallState;
}

export interface LocalizedText {
  en: string;
  zh: string;
}

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  targets: AgentId[];
  preview: string | null;
  icon?: string | null;
}

/**
 * Lightweight reference to a theme package on disk (UI-facing).
 *
 * NOT the same as @agentskin/core's `ThemePackage` (re-exported as `ThemeBundle`
 * from the runtime). This ref only carries the manifest + source path for display
 * purposes; the full parsed bundle with CSS targets lives in the main process.
 */
export interface ThemePackageRef {
  manifest: ThemeManifest;
  sourcePath: string;
}

// --- Installed themes (.agenttheme packages under userData/themes) ---

/**
 * Video wallpaper config bundled with a theme (v2.1+). Two reference modes:
 * - `workshopId`: Wallpaper Engine Steam workshop item id (takes precedence)
 * - `video`: video file bundled inside the theme package (relative path)
 */
export interface ThemeWallpaper {
  /** Wallpaper Engine workshop item id (numeric string). Takes precedence over `video`. */
  workshopId?: string;
  /** Path to video file relative to package root (mp4/webm). */
  video?: string;
  /** Optional poster image shown before video loads (png/webp). */
  poster?: string;
  /** Playback speed multiplier (default 1.0). */
  speed?: number;
  /** Whether to loop the video (default true). */
  loop?: boolean;
  /** Overlay scrim opacity 0-100 (default 55). */
  scrimOpacity?: number;
}

export interface InstalledTheme {
  id: string;
  displayName: string;
  version: string;
  /** Theme author (from manifest). May be empty for legacy packages. */
  author?: string;
  /** Theme category slug (from manifest). */
  category?: string;
  /** Theme tags for search/filter. */
  tags?: string[];
  /** Theme license identifier. */
  license?: string;
  /** Whether this is an unofficial theme. */
  unofficial?: boolean;
  supportedAgents: AgentId[];
  legacyTargets?: string[];
  coverDataUrl: string | null;
  tagline: string | null;
  icon?: string | null;
  /** Base64 icon data URL injected by ThemeInstaller (P3.1). */
  iconDataUrl?: string | null;
  /** Color palette from theme manifest (primary, background, surface, text). */
  colors?: Record<string, string>;
  /** Preferred color mode. */
  mode?: 'dark' | 'light' | 'auto';
  /** Content hash of all CSS targets (detects content changes without version bump). */
  contentHash?: string;
  /** Video wallpaper config bundled with this theme (v2.1+). When present,
   *  applying the theme also activates the video background in AgentSkin. */
  wallpaper?: ThemeWallpaper | null;
}

// --- System / app status ---

export interface AppStatus {
  appId: AgentId;
  displayName: string;
  installed: boolean;
  running: boolean;
  debugReady: boolean;
  port: number | null;
  activeThemeId: string | null;
  /** Detected install version (AgentSkin-side; @agentskin/core does not always report it). */
  version?: string | null;
  /** Detected install path (AgentSkin-side). */
  path?: string | null;
}

export interface SystemStatus {
  platform: Platform;
  apps: AppStatus[];
}

export type InstallState =
  | 'IDLE'
  | 'DETECTING'
  | 'APPLYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REQUIRES_RESTART'
  | 'RESTORE_FAILED';

export interface ApplyResult {
  state: InstallState;
  message: string;
}

// --- Apply / restore ---

export interface ApplyRequest {
  themeId: string;
  appId: AgentId;
  port?: number;
  restartExisting?: boolean;
}

export interface ApplyResponse {
  status: 'applied' | 'requires-restart' | 'port-occupied';
  message: string;
  system: SystemStatus;
  /** Structured reason for `requires-restart` so the UI can show specific
   *  guidance (install / start manually / singleton lock / etc.) instead of
   *  a single generic "restart needed" message. */
  restartReason?:
    | 'not-installed'
    | 'not-running'
    | 'no-cdp'
    | 'spawn-failed'
    | 'singleton-lock'
    | 'cdp-timeout';
}

// --- File-open imports (double-click / drag-drop of theme packages) ---

export interface FileImportResult {
  theme: InstalledTheme;
  themes: InstalledTheme[];
}

/** Sent when an imported file would replace an already-installed theme. */
export interface FileImportConfirmRequest {
  path: string;
  incoming: InstalledTheme;
  existing: InstalledTheme;
}

/**
 * Sent when the user applies a theme from the tray menu. The renderer runs its
 * normal apply flow (which surfaces the restart-confirmation dialog when the
 * target app is running), so tray applies behave exactly like in-app applies.
 */
export interface TrayApplyRequest {
  themeId: string;
  themeName: string;
  appId: AgentId;
}

// --- Desktop settings (userData/settings.json) ---

export interface AppOverride {
  /** Manual install location when auto-detection fails (mainly Windows). */
  appPath: string | null;
  /** Debug-port override when the adapter default is occupied. */
  port: number | null;
}

/** A wallpaper discovered from the Wallpaper Engine workshop library or local imports. */
export interface WallpaperInfo {
  /** Workshop item id (the numeric Steam workshop folder name) or local id. */
  id: string;
  /** Wallpaper title from project.json. */
  title: string;
  /** Wallpaper media type: video (dynamic) or image (static). */
  type: 'video' | 'image';
  /** Streamable URL served by the agentskin-wallpaper:// protocol (video or image). */
  videoUrl: string | null;
  /** Base64 data URL of the preview image, or null when unavailable. */
  previewDataUrl: string | null;
  /** Size of the source media file in bytes. */
  sizeBytes: number;
  /** Workshop tags (e.g. Anime, Animal). */
  tags: string[];
  /** Where this wallpaper was discovered from. */
  source: 'workshop' | 'local';
}

/** Per-agent wallpaper preference: whether a wallpaper is enabled for this
 *  agent and which wallpaper id to inject into its page via CDP. */
export interface WallpaperAgentSetting {
  /** Whether a video wallpaper should be injected into this agent's page. */
  enabled: boolean;
  /** Wallpaper id (WallpaperInfo.id), or null to follow the active theme's
   *  bundled wallpaper (theme.wallpaper) when present. */
  id: string | null;
}

/** Persisted dynamic-wallpaper preference. */
export interface WallpaperSettings {
  /** Whether the animated background is enabled for AgentSkin's own UI. */
  enabled: boolean;
  /** Selected wallpaper id (WallpaperInfo.id) for AgentSkin's own UI, or null for none. */
  id: string | null;
  /** Per-agent wallpaper settings. Each agent can have a different wallpaper
   *  injected into its page, independent of the AgentSkin UI background. */
  agents: Record<AgentId, WallpaperAgentSetting>;
}

export interface DesktopSettings {
  apps: Record<AgentId, AppOverride>;
  defaultPorts: Record<AgentId, number>;
  wallpaper: WallpaperSettings;
}

export interface SettingsUpdateResult {
  settings: DesktopSettings;
  status: SystemStatus;
}

// --- IPC results ---

export interface BootstrapData {
  themes: InstalledTheme[];
  status: SystemStatus;
  locale: AppLocale;
  appVersion: string;
}

export interface DialogResult {
  canceled: boolean;
  path?: string;
  theme?: InstalledTheme;
}

export interface DeleteThemeResult {
  themes: InstalledTheme[];
  status: SystemStatus;
}

// --- Catalog layer (Phase 4.1: product data abstraction) ---

export interface AgentCapabilities {
  theme: boolean;
  hotReload: boolean;
  extension: boolean;
}

export interface AgentCatalogStatus {
  installed: boolean;
  running: boolean;
  debugReady: boolean;
  version?: string;
}

export interface AgentCatalogItem {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  /** Brand/official name (e.g. "TRAE", "Qoder", "WorkBuddy") — not translated. */
  officialName: string;
  /** Market region for this agent build. */
  region: string;
  /** Engine adapter id (@agentskin/core) this agent maps to. */
  adapter: string;
  type: 'agent' | 'ide';
  icon: string;
  description: string;
  capabilities: AgentCapabilities;
  supported: boolean;
  status: AgentCatalogStatus;
}

/** Where a theme came from. */
export type ThemeSource = 'local' | 'community';

/** Theme categories recognized by the system. */
export type ThemeCategory =
  | 'cyberpunk'
  | 'minimal'
  | 'anime'
  | 'nature'
  | 'retro'
  | 'professional'
  | 'creative'
  | 'dark'
  | 'light'
  | string;

export interface ThemeCatalogItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  preview: string | null;
  icon?: string | null;
  supportedAgents: AgentId[];
  legacyTargets: string[];
  category: string;
  tags: string[];
  license?: string;
  mode?: 'dark' | 'light' | 'auto';
  unofficial?: boolean;
  source: ThemeSource;
  installed: boolean;
  /** Theme color palette from manifest (primary, background, surface, text). */
  colors?: Record<string, string>;
  /** Video wallpaper config bundled with this theme. When present, applying
   *  the theme also activates the video background in AgentSkin. */
  wallpaper?: ThemeWallpaper | null;
}

export interface CatalogResult<T> {
  version: number;
  updatedAt: string;
  items: T[];
}

// --- contextBridge surface ---

export interface AgentSkinApi {
  getBootstrap(): Promise<BootstrapData>;
  setLocale(locale: AppLocale): Promise<void>;
  refreshStatus(): Promise<SystemStatus>;
  applyTheme(request: ApplyRequest): Promise<ApplyResponse>;
  restoreApp(appId: AgentId): Promise<SystemStatus>;
  importTheme(): Promise<DialogResult>;
  importThemeFromPath(path: string): Promise<FileImportResult>;
  importThemeBytes(bytes: Uint8Array, suggestedId: string): Promise<FileImportResult>;
  openThemeFile(path: string): Promise<void>;
  getPathForFile(file: File): string;
  exportTheme(themeId: string): Promise<DialogResult>;
  deleteTheme(themeId: string): Promise<DeleteThemeResult>;
  // --- Catalog (read-only product data layer) ---
  catalog: {
    agents: {
      list(): Promise<CatalogResult<AgentCatalogItem>>;
    };
    themes: {
      list(): Promise<CatalogResult<ThemeCatalogItem>>;
      get(id: string): Promise<ThemeCatalogItem | null>;
      search(query: string): Promise<CatalogResult<ThemeCatalogItem>>;
      filter(agentId: AgentId): Promise<CatalogResult<ThemeCatalogItem>>;
    };
  };
  getSettings(): Promise<DesktopSettings>;
  pickAppPath(appId: AgentId): Promise<SettingsUpdateResult & { canceled: boolean }>;
  clearAppPath(appId: AgentId): Promise<SettingsUpdateResult>;
  setAppPort(appId: AgentId, port: number | null): Promise<SettingsUpdateResult>;
  // --- Dynamic wallpapers (Wallpaper Engine integration) ---
  listWallpapers(): Promise<WallpaperInfo[]>;
  /** Persist the AgentSkin UI wallpaper preference (enabled + id). Per-agent
   *  settings are preserved server-side and not overwritten by this call. */
  setWallpaper(settings: Pick<WallpaperSettings, 'enabled' | 'id'>): Promise<DesktopSettings>;
  importWallpaper(): Promise<WallpaperInfo[]>;
  /** Persist a per-agent wallpaper preference (enabled + id). The wallpaper is
   *  NOT immediately injected — call {@link applyAgentWallpaper} to trigger CDP
   *  injection into the agent's running page. */
  setAgentWallpaper(appId: AgentId, setting: WallpaperAgentSetting): Promise<DesktopSettings>;
  /** Immediately inject (or remove) the resolved wallpaper into a running
   *  agent's page via CDP. Returns `{ ok, reason }` so the UI can surface errors. */
  applyAgentWallpaper(appId: AgentId): Promise<{ ok: boolean; reason?: string }>;
  /** Delete a locally-imported wallpaper by id. Only items imported by the user
   *  (id starts with `local:`) can be deleted; workshop and theme-bundled
   *  wallpapers are read-only. Returns the updated wallpaper list. */
  deleteWallpaper(id: string): Promise<WallpaperInfo[]>;
  /** Apply a wallpaper (video or image) to a specific agent via CDP injection. */
  applyWallpaperToAgent(
    wallpaperId: string,
    agentId: AgentId,
  ): Promise<{ ok: boolean; reason?: string }>;
  /** Remove the injected wallpaper from a specific agent. */
  removeWallpaperFromAgent(agentId: AgentId): Promise<{ ok: boolean }>;
  /** Detect whether Wallpaper Engine is installed on this machine. */
  weDetect(): Promise<{ installed: boolean; wallpaperCount: number }>;
  showInFolder(path: string): Promise<void>;
  onRuntimeLog(listener: (line: string) => void): () => void;
  onFileImported(listener: (result: FileImportResult) => void): () => void;
  onFileImportConfirm(listener: (request: FileImportConfirmRequest) => void): () => void;
  onFileImportFailed(listener: (message: string) => void): () => void;
  onTrayApply(listener: (request: TrayApplyRequest) => void): () => void;
  // --- Window controls (custom title bar) ---
  windowMinimize(): void;
  windowToggleMaximize(): Promise<boolean>;
  windowClose(): void;
  windowIsMaximized(): Promise<boolean>;
  onWindowMaximizeChange(listener: (maximized: boolean) => void): () => void;
}
