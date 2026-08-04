// SPDX-License-Identifier: MPL-2.0

import type { AppLocale } from './i18n';

export type Platform = 'darwin' | 'win32' | 'unsupported';

/** Platform-registered target agents — formal products backed by @agentskin/engine. */
export type AgentId = 'workbuddy' | 'qoderwork' | 'traework' | 'doubao' | 'codex' | 'zcode';

/**
 * Experimental agent ids — registered for discovery but NOT yet backed by
 * @agentskin/engine. Calling apply/restore/detect on these throws
 * AGENTSKIN_EXPERIMENTAL_ADAPTER. Kept as a separate union so the type
 * system can distinguish "formal" from "experimental" at call sites:
 * IPC validation only accepts `AgentId`, while the theme/registry layer
 * may accept `AnyAgentId`.
 */
export type ExperimentalAgentId =
  | 'codebuddy'
  | 'marscode'
  | 'comate'
  | 'tongyi_lingma'
  | 'tencent_ai_code';

/** All recognized agent ids (formal + experimental). */
export type AnyAgentId = AgentId | ExperimentalAgentId;

/**
 * Canonical product metadata for every recognized agent.
 *
 * This is the SINGLE SOURCE OF TRUTH for display names, official names,
 * regions, and tier classification. All other layers (AgentCatalog,
 * AgentEngineService, APP_META) derive their display strings from here —
 * never maintain parallel name maps.
 */
export interface AgentMeta {
  readonly id: AnyAgentId;
  /** User-facing product name shown in the UI. */
  readonly displayName: string;
  /** Brand / official name (not translated). */
  readonly officialName: string;
  /** Market region for this agent build. */
  readonly region: 'CN' | 'International' | 'Global';
  /** Whether this agent is a formal product or experimental. */
  readonly tier: 'active' | 'experimental';
}

export const AGENT_META: Readonly<Record<AnyAgentId, AgentMeta>> = Object.freeze({
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
  codex: Object.freeze({
    id: 'codex',
    displayName: 'OpenAI Codex',
    officialName: 'ChatGPT',
    region: 'Global',
    tier: 'active',
  }),
  zcode: Object.freeze({
    id: 'zcode',
    displayName: 'ZCode',
    officialName: 'ZCode',
    region: 'Global',
    tier: 'active',
  }),
  // AC1-B: Experimental adapters — registered for discovery, not yet wired
  // to @agentskin/engine. coreId is '' so apply/restore/detect throws
  // AGENTSKIN_EXPERIMENTAL_ADAPTER. Previously these ids were absent from
  // the type system entirely (EXPERIMENTAL_AGENT_IDS filtered AGENT_META
  // for tier==='experimental' but no experimental entries existed, so it
  // was always empty — a silent bug).
  codebuddy: Object.freeze({
    id: 'codebuddy',
    displayName: 'CodeBuddy',
    officialName: 'CodeBuddy',
    region: 'CN',
    tier: 'experimental',
  }),
  marscode: Object.freeze({
    id: 'marscode',
    displayName: '豆包 MarsCode',
    officialName: 'MarsCode',
    region: 'CN',
    tier: 'experimental',
  }),
  comate: Object.freeze({
    id: 'comate',
    displayName: '百度 Comate',
    officialName: 'Comate',
    region: 'CN',
    tier: 'experimental',
  }),
  tongyi_lingma: Object.freeze({
    id: 'tongyi_lingma',
    displayName: '通义灵码',
    officialName: 'Tongyi Lingma',
    region: 'CN',
    tier: 'experimental',
  }),
  tencent_ai_code: Object.freeze({
    id: 'tencent_ai_code',
    displayName: '腾讯云 AI Code',
    officialName: 'Tencent AI Code',
    region: 'CN',
    tier: 'experimental',
  }),
});

/** Formal product agents — shown in the main UI, checked for status, listed in settings. */
export const AGENT_IDS: readonly AgentId[] = Object.freeze(
  (Object.values(AGENT_META) as AgentMeta[])
    .filter((m) => m.tier === 'active')
    .map((m) => m.id as AgentId),
);

/** Experimental / non-formal agents — isolated from the main UI but still recognized by the theme system. */
export const EXPERIMENTAL_AGENT_IDS: readonly ExperimentalAgentId[] = Object.freeze(
  (Object.values(AGENT_META) as AgentMeta[])
    .filter((m) => m.tier === 'experimental')
    .map((m) => m.id as ExperimentalAgentId),
);

/** All recognized agent ids (formal + experimental). Used by the theme system and validation. */
export const ALL_AGENT_IDS: readonly AnyAgentId[] = Object.freeze([
  ...AGENT_IDS,
  ...EXPERIMENTAL_AGENT_IDS,
]);

/**
 * Type guard for formal agent ids only. Used at IPC boundaries so
 * experimental adapters can never be targeted by renderer apply/restore
 * requests — they must go through discovery first.
 */
export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

/** Type guard for any recognized agent id (formal + experimental). */
export function isAnyAgentId(value: unknown): value is AnyAgentId {
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
 * NOT the same as @agentskin/engine's `ThemePackage` (re-exported as `ThemeBundle`
 * from the runtime). This ref only carries the manifest + source path for display
 * purposes; the full parsed bundle with CSS targets lives in the main process.
 */
export interface ThemePackageRef {
  manifest: ThemeManifest;
  sourcePath: string;
}

// --- Installed themes (.agenttheme packages under userData/themes) ---

/**
 * 壁纸渲染选项 — 对齐 Wallpaper Engine 渲染面板的规范化配置。
 *
 * 全部可选；未设置的项落到 CDP 注入器的内置默认值（fill=cover、无滤镜、
 * 无翻转、无视差）。解析优先级（由高到低）：per-agent 设置 →
 * 全局默认（WallpaperSettings.render）→ 主题 manifest（ThemeWallpaper.render）
 * → 内置默认。这样同一个壁纸在桌面 UI 背景与注入的 agent 窗口共享同一套
 * 渲染语义 —— "同一壁纸在桌面与 agent 效果一致"的核心保证。
 */
export interface WallpaperRenderOptions {
  /** 播放速度倍数（仅视频）。0.25-2.0，默认 1。 */
  speed?: number;
  /** 是否循环播放（仅视频）。默认 true。 */
  loop?: boolean;
  /** 可读性 scrim 遮罩透明度 0-100（图片默认 45 / 视频默认 55）。 */
  scrimOpacity?: number;
  /** 对齐方式（对齐 WE/Sucrose 渲染面板）：stretch=拉伸填满、fit=完整
   *  显示留边、fill=cover 裁剪铺满（默认，同现状）、center=原尺寸居中、
   *  tile=平铺（仅图片）。 */
  alignment?: 'stretch' | 'fit' | 'fill' | 'center' | 'tile';
  /** 位置水平偏移 %（-100..100，默认 0）。 */
  positionX?: number;
  /** 位置垂直偏移 %（-100..100，默认 0）。 */
  positionY?: number;
  /** 水平翻转。 */
  flipH?: boolean;
  /** 垂直翻转。 */
  flipV?: boolean;
  /** 鼠标视差强度 0-100（0=关闭，默认 0）。 */
  parallax?: number;
  /** 亮度滤镜 0-200（100=正常）。 */
  brightness?: number;
  /** 对比度滤镜 0-200（100=正常）。 */
  contrast?: number;
  /** 饱和度滤镜 0-200（100=正常）。 */
  saturation?: number;
  /** 色相旋转 -180..180（默认 0）。 */
  hueRotate?: number;
  /** 棕褐化 0-100（默认 0）。 */
  sepia?: number;
  /** 灰度化 0-100（默认 0）。 */
  grayscale?: number;
  /** 高斯模糊 0-50px（默认 0）。 */
  blur?: number;
  /** 主题配色着色（hex，如 "#c41e2a"）。 */
  tint?: string;
  /** 音频响应灵敏度 0-100（0=关闭，默认 0）。 */
  audioLevel?: number;
}

/** 对齐方式取值（UI 下拉 + 配置校验共用）。 */
export const WALLPAPER_ALIGNMENTS = ['stretch', 'fit', 'fill', 'center', 'tile'] as const;
export type WallpaperAlignment = (typeof WALLPAPER_ALIGNMENTS)[number];

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
  /** 主题自带的渲染设置（对齐/位置/翻转/滤镜/视差/音频等）。优先级低于
   *  全局默认与 per-agent 设置。 */
  render?: WallpaperRenderOptions;
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
  /** On-disk path of the extracted cover image (served via agentskin-theme://). */
  coverPath?: string | null;
  tagline: string | null;
  icon?: string | null;
  /** On-disk path of the extracted icon image (served via agentskin-theme://). */
  iconPath?: string | null;
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

/** A themed environment snapshot across multiple applications. */
export interface ThemeProfile {
  /** Unique identifier (slug). */
  id: string;
  /** User-facing name. */
  displayName: string;
  /** Timestamp when profile was created. */
  createdAt: string;
  /** Optional description. */
  description?: string;
  /** Mapping from appId to themeId for this profile. */
  mappings: Record<AgentId, string>; // appId -> themeId
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
  /** Detected install version (AgentSkin-side; @agentskin/engine does not always report it). */
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

/**
 * Structured reason for a `requires-restart` CDP result, so the UI can show
 * specific guidance (install / start the app / singleton lock / etc.) instead
 * of a single generic "restart needed" message.
 *
 * Shared by the theme apply flow and the wallpaper apply flow so both surfaces
 * present the same restart/launch dialog semantics.
 */
export type RestartReason =
  | 'not-installed'
  | 'not-running'
  | 'no-cdp'
  | 'spawn-failed'
  | 'singleton-lock'
  | 'cdp-timeout';

export interface ApplyResponse {
  status: 'applied' | 'requires-restart' | 'port-occupied';
  message: string;
  system: SystemStatus;
  /** Structured reason for `requires-restart` so the UI can show specific
   *  guidance (install / start manually / singleton lock / etc.) instead of
   *  a single generic "restart needed" message. */
  restartReason?: RestartReason;
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

/** How a wallpaper preview should be rendered in the UI. */
export type WallpaperPlayback = 'video' | 'gif' | 'image' | 'web' | 'scene';

/** The original Wallpaper Engine project type from project.json. */
export type WallpaperProjectType = 'video' | 'image' | 'web' | 'scene' | 'application';

/** A wallpaper discovered from the Wallpaper Engine workshop library or local imports. */
export interface WallpaperInfo {
  /** Workshop item id (the numeric Steam workshop folder name) or local id. */
  id: string;
  /** Wallpaper title from project.json. */
  title: string;
  /** Wallpaper media type for injection dispatch: video, image, web (iframe),
   *   or scene (canvas renderer). */
  type: 'video' | 'image' | 'web' | 'scene';
  /** The original Wallpaper Engine project type from project.json. */
  projectType: WallpaperProjectType;
  /** How the preview is rendered in the UI grid. */
  playback: WallpaperPlayback;
  /** Streamable loopback preview image URL served by the wallpaper media
   *   server. For image wallpapers this is the media file itself. For video
   *   wallpapers this is the workshop preview image (preview.jpg/png/gif) when
   *   available. Null when no preview image exists. */
  previewUrl: string | null;
  /** Size of the source media file in bytes. */
  sizeBytes: number;
  /** Workshop tags (e.g. Anime, Animal). */
  tags: string[];
  /** Where this wallpaper was discovered from. */
  source: 'workshop' | 'local';
  /** True when the wallpaper has no real media asset — only a low-res
   *   preview thumbnail (preview.jpg). This is now rare since scene and web
   *   wallpapers are fully supported via their own renderers. Only applies to
   *   wallpapers whose project type is unrecognized and no media file exists. */
  previewOnly: boolean;
}

/** Per-agent wallpaper preference: whether a wallpaper is enabled for this
 *  agent and which wallpaper id to inject into its page via CDP. */
export interface WallpaperAgentSetting {
  /** Whether a video wallpaper should be injected into this agent's page. */
  enabled: boolean;
  /** Wallpaper id (WallpaperInfo.id), or null to follow the active theme's
   *  bundled wallpaper (theme.wallpaper) when present. */
  id: string | null;
  /** Per-agent 渲染覆盖（对齐/位置/翻转/滤镜/视差/音频等）。未设置则用
   *  全局默认（WallpaperSettings.render）→ 主题 manifest → 内置默认。 */
  render?: WallpaperRenderOptions;
}

/** Persisted dynamic-wallpaper preference. */
export interface WallpaperSettings {
  /** Whether the animated background is enabled for AgentSkin's own UI. */
  enabled: boolean;
  /** Selected wallpaper id (WallpaperInfo.id) for AgentSkin's own UI, or null for none. */
  id: string | null;
  /** 全局默认渲染设置，所有 agent 与桌面 UI 背景共用；per-agent 设置优先。 */
  render?: WallpaperRenderOptions;
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
  /** Engine adapter id (@agentskin/engine) this agent maps to. */
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
  setWallpaper(
    settings: Pick<WallpaperSettings, 'enabled' | 'id' | 'render'>,
  ): Promise<DesktopSettings>;
  importWallpaper(): Promise<WallpaperInfo[]>;
  /** Persist a per-agent wallpaper preference (enabled + id + optional render
   *  override). The wallpaper is NOT immediately injected — call
   *  {@link applyAgentWallpaper} to trigger CDP injection into the agent's
   *  running page. */
  setAgentWallpaper(appId: AgentId, setting: WallpaperAgentSetting): Promise<DesktopSettings>;
  /** Immediately inject (or remove) the resolved wallpaper into a running
   *  agent's page via CDP. Returns `{ ok, reason, detail }` so the UI can
   *  surface errors. `detail` carries the per-target verdicts (e.g.
   *  `image:loadfail:csp-or-unsupported`) for precise diagnosis.
   *
   *  When `restartExisting` is false/absent, only probes for an existing CDP
   *  port — returns `{ ok: false, reason: 'requires-restart' }` if the agent
   *  is running without `--remote-debugging-port`. Pass `restartExisting:
   *  true` ONLY after the user has explicitly confirmed a restart. */
  applyAgentWallpaper(
    appId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string; restartReason?: RestartReason }>;
  /** Delete a locally-imported wallpaper by id. Only items imported by the user
   * (id starts with `local:`) can be deleted; workshop and theme-bundled
   * wallpapers are read-only. Returns the updated wallpaper list. */
  deleteWallpaper(id: string): Promise<WallpaperInfo[]>;
  /** Apply a wallpaper (video or image) to a specific agent via CDP injection.
   *  Same `restartExisting` two-phase CDP discovery as
   *  {@link applyAgentWallpaper}. */
  applyWallpaperToAgent(
    wallpaperId: string,
    agentId: AgentId,
    options?: { restartExisting?: boolean },
  ): Promise<{ ok: boolean; reason?: string; detail?: string; restartReason?: RestartReason }>;
  /** Remove the injected wallpaper from a specific agent. */
  removeWallpaperFromAgent(agentId: AgentId): Promise<{ ok: boolean }>;
  /** Detect whether Wallpaper Engine is installed on this machine. */
  weDetect(): Promise<{ installed: boolean; wallpaperCount: number }>;
  /** Resolve a wallpaper's media as a streamable loopback HTTP URL (served by
   *  the wallpaper media server) so video wallpapers can play without buffering
   *  the whole file. Returns null when the id is unknown. */
  wallpaperVideoUrl(id: string): Promise<string | null>;
  /** Resolve a scene/web wallpaper's loopback renderer URL (the same iframe
   *  renderer injected into agent windows), so the desktop UI background can
   *  render the wallpaper identically. Returns null when the id is unknown. */
  wallpaperWebUrl(id: string): Promise<string | null>;
  showInFolder(path: string): Promise<void>;
  onRuntimeLog(listener: (line: string) => void): () => void;
  onFileImported(listener: (result: FileImportResult) => void): () => void;
  onFileImportConfirm(listener: (request: FileImportConfirmRequest) => void): () => void;
  onFileImportFailed(listener: (message: string) => void): () => void;
  onTrayApply(listener: (request: TrayApplyRequest) => void): () => void;
  /** Pushed by the main process when SystemStatus changes outside the poll
   *  cadence (after apply/restore, agent launch/exit detection). The
   *  renderer refreshes immediately instead of waiting for the next poll. */
  onStatusChanged(listener: () => void): () => void;
  // --- Window controls (custom title bar) ---
  windowMinimize(): void;
  windowToggleMaximize(): Promise<boolean>;
  windowClose(): void;
  windowIsMaximized(): Promise<boolean>;
  onWindowMaximizeChange(listener: (maximized: boolean) => void): () => void;
  // --- Theme Studio ---
  snapshotThemeDom(
    agentId: AgentId,
    themeId?: string,
    options?: StudioSnapshotOptions,
  ): Promise<ThemeVisualSnapshot>;
  exportStudioTheme(payload: ThemeStudioExportRequest): Promise<{ packageDir: string }>;
  /** Enter DevTools-style live inspect mode on the running agent. */
  startInspect(agentId: AgentId): Promise<{ ok: boolean }>;
  /** Exit live inspect mode. */
  stopInspect(): Promise<{ ok: boolean }>;
  /** Subscribe to picked-node results while in live inspect mode. */
  onInspectResult(listener: (node: InspectedNode | { error: string }) => void): () => void;
  /** Open (or focus, if already open) the dedicated Theme Studio window. */
  openStudioWindow(): Promise<{ ok: boolean }>;
  // --- Theme Studio: projects (self-contained, no installed-theme dependency) ---
  /** List all saved Studio projects (persisted to disk). */
  listStudioProjects(): Promise<StudioProject[]>;
  /** Create a new, empty Studio project. */
  createStudioProject(req: {
    name: string;
    author: string;
    agentId: AgentId;
  }): Promise<StudioProject>;
  /** Persist (or update) a Studio project. */
  saveStudioProject(project: StudioProject): Promise<StudioProject>;
  /** Delete a Studio project (removes its directory). */
  deleteStudioProject(id: string): Promise<{ ok: boolean }>;
  /** Open a directory picker and import either a Studio project JSON or a
   *  `.agentskin-theme` package as a new project. Returns null if canceled. */
  importStudioProject(): Promise<StudioProject | null>;
  /** Persist the captured real-DOM snapshot for a project (stored separately
   *  from `project.json` so the lightweight project metadata stays small).
   *  `kind` selects which capture to store: `'current'` (themed render) or
   *  `'baseline'` (native/un-themed). Returns `{ ok: false }` on missing
   *  arguments / write failure. */
  saveStudioSnapshot(
    projectId: string,
    snapshot: ThemeVisualSnapshot,
    kind?: 'current' | 'baseline',
  ): Promise<{ ok: boolean }>;
  /** Load a previously persisted snapshot for a project, or null if none.
   *  `kind` mirrors `saveStudioSnapshot`. */
  loadStudioSnapshot(
    projectId: string,
    kind?: 'current' | 'baseline',
  ): Promise<ThemeVisualSnapshot | null>;
  /** Capture the agent's NATIVE (un-themed) appearance — restores the agent to
   *  its default look, captures the live DOM, then re-applies the previously
   *  active theme. Returns the native snapshot for side-by-side comparison. */
  snapshotBaseline(agentId: AgentId, options?: StudioSnapshotOptions): Promise<ThemeVisualSnapshot>;
}

/** Payload sent by the Theme Studio renderer when exporting a crafted theme
 *  package. The main process forwards it to `build-theme-package.mjs` which
 *  writes a directory-based `.agentskin-theme` package. */
export interface ThemeStudioExportRequest {
  meta?: { id?: string; name?: string; author?: string };
  agentId: AgentId;
  /** Root token overrides (color values as CSS strings). */
  root?: Record<string, string>;
  /** Per-agent craft overrides (selectors → declarations). */
  signature?: Record<string, unknown>;
  /** Canvas-rendered preview image as a data URL. */
  previewDataUrl?: string;
  /** Canvas-rendered icon image as a data URL. */
  iconDataUrl?: string;
}

/** A Theme Studio "工程" (project) — a self-contained theme-under-development.
 *  Persisted to `theme-workbench/projects/<id>/project.json`. Unlike the app's
 *  installed themes, a project is created/imported *within* the Studio and
 *  carries the crafted palette + 8-dimension signature + tool overrides for
 *  round-trip editing. The large DOM snapshots are persisted separately
 *  (`snapshot.json` = current render, `baseline.json` = native/un-themed), so
 *  the crafted preview survives a window close / reload without re-capturing. */
export interface StudioProject {
  schema: 'agentskin-studio-project/v1';
  id: string;
  name: string;
  author: string;
  agentId: AgentId;
  createdAt: string;
  updatedAt: string;
  /** Whether the "current render" DOM snapshot has been captured. */
  hasSnapshot: boolean;
  /** Whether the native (un-themed) baseline snapshot has been captured. */
  hasBaseline?: boolean;
  /** Last export output directory (a `.agentskin-theme` package). */
  exportedDir?: string;
  /** Crafted `--agentskin-*` palette tokens. */
  palette?: Record<string, string>;
  /** 8-dimension signature (radius / spacing / shadow / blur / font / motion…). */
  signature?: Record<string, unknown>;
  /** Toolbox overrides applied on top of the snapshot. */
  overrides?: Record<string, unknown>;
}

/** Shape of a full DOM visual snapshot produced by CDP probe. Re-exported here
 *  so the renderer's `AgentSkinApi` contract has it without importing main. */

/** A single CSS declaration as captured from the cascade. */
export interface CssDeclaration {
  name: string;
  value: string;
  important: boolean;
}

/** One rule in a node's cascade (DevTools "Styles" panel row).
 *  `selector` is null for inline styles. `origin` mirrors the CDP CSS
 *  style origin; `source` is a human label ("inline", "user agent
 *  stylesheet", or a short stylesheet id). */
export interface CssMatchedRule {
  selector: string | null;
  origin: 'inline' | 'regular' | 'user-agent' | 'user' | 'keyframes';
  source: string;
  styleSheetId?: string;
  declarations: CssDeclaration[];
}

/** Full devtools-grade probe of a single DOM node. */
export interface NodeCascade {
  /** Authoritative final computed values (all longhands) via CSS.getComputedStyleForNode. */
  computed: Array<{ property: string; value: string }>;
  /** Cascade in specificity order (most specific first), like DevTools Styles. */
  matchedRules: CssMatchedRule[];
  /** Actually rendered font family names (resolves @font-face) via CSS.getPlatformFontsForNode. */
  platformFonts: string[];
  /** Protocol-level geometry (absolute coords, transform/scroll aware) via DOM.getBoxModel. */
  boxModel: {
    width?: number;
    height?: number;
    left?: number;
    top?: number;
  } | null;
  backendNodeId?: number;
}

/** Payload pushed from main when the user clicks an element in live-inspect mode. */
export interface InspectedNode {
  agentId: AgentId;
  tag: string;
  /** The selector path that best identifies the clicked node (best-effort). */
  path: string;
  cascade: NodeCascade;
}

/** Options controlling how deep the Theme Studio's DOM/style probe goes. */
export interface StudioSnapshotOptions {
  /** Extra CSS selectors to capture beyond the agent's default landmark set. */
  extraSelectors?: string[];
  /** Pseudo-classes to force and capture (e.g. `['hover','focus','active']`). */
  pseudoStates?: string[];
  /** Also capture light/dark scheme variants via emulated media. */
  captureSchemes?: boolean;
}

export interface ThemeVisualSnapshot {
  themeId: string;
  themeName: string;
  agentId: AgentId;
  timestamp: string;
  landmarks: ThemeVisualLandmark[];
  /** Full real DOM subtree of the agent (structure + text + inlined computed
   *  styles + geometry), used to render an authentic preview. Optional — may
   *  be absent if the DOM probe is unavailable. */
  domTree?: DomTreeNode;
  summary: {
    totalLandmarks: number;
    visibleLandmarks: number;
    selectorsTried: number;
    boxModelAvailable: boolean;
    /** True when the devtools-grade CSS/DOM capture (cascade + platform fonts) succeeded. */
    cascadeAvailable: boolean;
  };
}

/** A node in the captured real DOM subtree (see `dom-tree.ts`). */
export interface DomTreeNode {
  tag: string;
  /** Element class attribute, kept as a styling hook for the preview. */
  cls: string;
  /** Inlined image source (data URL) for `<img>` nodes, when available. */
  imgSrc?: string;
  /** Truncated direct text content (no descendant markup). */
  text?: string;
  /** Computed-style subset as resolved (concrete) values. */
  style: Record<string, string>;
  /** Whitelisted SVG geometry/paint attributes (for faithful icon replay). */
  attrs?: Record<string, string>;
  /** Protocol/viewport geometry. */
  rect: { w: number; h: number; x: number; y: number };
  children: DomTreeNode[];
}

export interface ThemeVisualLandmark {
  selector: string;
  tag: string;
  /** Computed-style subset (kept for backward compatibility with the replica renderer). */
  styles: Array<{ property: string; value: string }>;
  /** DevTools-grade cascade: which selector/stylesheet set each property. */
  matchedRules: CssMatchedRule[];
  /** Actually rendered fonts for this node. */
  platformFonts: string[];
  boxModel: {
    width?: number;
    height?: number;
    left?: number;
    top?: number;
  } | null;
  visible: boolean;
  /** True when captured from a user-pinned/extra selector (not a default landmark). */
  custom?: boolean;
  /** Per-pseudo-class full cascade, captured by forcing the pseudo state. */
  pseudo?: Record<string, NodeCascade>;
  /** Light/dark scheme variant captures (forced via emulated media). */
  scheme?: Record<
    'light' | 'dark',
    { styles: Array<{ property: string; value: string }>; matchedRules: CssMatchedRule[] }
  >;
}

/** Alias retained for the snapshot probe module / existing importers. */
export type LandmarkSnapshot = ThemeVisualLandmark;
