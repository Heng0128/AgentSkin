// SPDX-License-Identifier: MPL-2.0

import type { ArchitectureProfile } from '../asar-architecture';
import type { AppLocale } from '../i18n';
import type {
  AgentCatalogItem,
  AgentId,
  AppRunState,
  ElectronScanResult,
  InstallState,
  LaunchResult,
  Platform,
  ScanProgressEvent,
} from './agent';
import type {
  CommunitySourceId,
  CommunitySourceProbeResult,
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  DownloadProgress,
  InstallationRecord,
  InstallResult,
} from './community';
import type { ConcurrencyMetrics } from './concurrency';
import type { DriftStatus, RegenResult } from './drift-status';
import type { EnvironmentPreset } from './environment';
import type { HealthCheckReport } from './health-check';
import type { LaunchRequest } from './launch';
import type { MarkdownStyles } from './markdown';
import type { ToolOverride, TweakSession } from './override';
import type { SelectorProbeResult, SelectorValidationReport } from './selector-probe';
import type {
  CatalogResult,
  InstalledTheme,
  StudioProject,
  StudioSnapshotOptions,
  ThemeCatalogItem,
  ThemeColorsFromImage,
  ThemeStudioExportRequest,
} from './theme';
import type { VisualAnalysisSummary } from './visual-analysis';
import type {
  DesktopSettings,
  WallpaperAgentSetting,
  WallpaperInfo,
  WallpaperSettings,
} from './wallpaper';

// --- System / app status ---

export interface AppStatus {
  appId: AgentId;
  displayName: string;
  installed: boolean;
  running: boolean;
  debugReady: boolean;
  port: number | null;
  activeThemeId: string | null;
  /** Active color-scheme id of the active theme (null/absent = default colors). */
  activeSchemeId?: string | null;
  /** Detected install version (AgentSkin-side; @agentskin/engine does not always report it). */
  version?: string | null;
  /** Detected install path (AgentSkin-side). */
  path?: string | null;
  /**
   * Whether the detected install can be CDP-injected by AgentSkin. True for
   * all installed apps including MSIX (Windows Store) packages — the launcher
   * uses a .lnk shortcut (via PowerShell WScript.Shell) to preserve CDP
   * arguments. Only undefined when the app is not installed.
   */
  injectable?: boolean;
}

export interface SystemStatus {
  platform: Platform;
  apps: AppStatus[];
}

export interface ApplyResult {
  state: InstallState;
  message: string;
}

// --- Apply / restore ---

export interface ApplyRequest {
  themeId: string;
  /** Optional color-scheme id to apply (v2.2+). Omit to apply the theme's
   *  default (manifest) colors. Resolved to the `<themeId>--<schemeId>`
   *  bundle id by the apply flow. */
  schemeId?: string;
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
  | 'kill-denied'
  | 'cdp-timeout';

/**
 * Result of applying a wallpaper to an agent via CDP injection.
 *
 * Originally defined in `wallpaperStore.ts`, moved to shared/types so both
 * main and renderer layers can reference the same contract without the store
 * being the sole owner of a cross-layer type (RC3: type deduplication).
 */
export interface ApplyAgentWallpaperResult {
  /** Whether the operation succeeded. */
  ok: boolean;
  /** Machine-readable failure reason (e.g. 'not-installed', 'no-cdp'). */
  reason?: string;
  /** Human-readable failure detail for debugging. */
  detail?: string;
  /** Structured restart reason for UI-specific guidance. */
  restartReason?: RestartReason;
}

export interface ApplyResponse {
  /** `skipped-concurrent` (RFC §4.10) distinguishes a real apply from a
   *  concurrent call that was deduplicated against an in-flight one. */
  status: 'applied' | 'requires-restart' | 'port-occupied' | 'skipped-concurrent';
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

// --- IPC results ---

export interface BootstrapData {
  themes: InstalledTheme[];
  status: SystemStatus;
  locale: AppLocale;
  appVersion: string;
  /** Real runtime versions from the main process (`process.versions`) —
   *  Chromium/Electron/Node. The renderer UA cannot provide Node, and the
   *  About page must show facts, not UA-parse guesses. */
  runtime?: BootstrapRuntime;
}

/** Main-process runtime versions surfaced on the About page (all optional so
 *  older main-process payloads and test stubs without the field stay valid). */
export interface BootstrapRuntime {
  chromium: string;
  electron: string;
  node: string;
}

export interface DialogResult {
  canceled: boolean;
  path?: string;
  theme?: InstalledTheme;
}

/** Result of creating an `.agentskin-bundle` combo package (save dialog). */
export interface BundleCreateResult {
  canceled: boolean;
  path?: string;
}

/** Result of installing an `.agentskin-bundle` combo package. */
export interface BundleInstallResult {
  canceled: boolean;
  theme?: InstalledTheme;
}

export interface DeleteThemeResult {
  themes: InstalledTheme[];
  status: SystemStatus;
}

export interface SettingsUpdateResult {
  settings: DesktopSettings;
  status: SystemStatus;
}

// --- contextBridge surface ---

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
  /** Viewport geometry — used by native-profile saliency calc. */
  rect: { w: number; h: number; x: number; y: number };
  children: DomTreeNode[];
}

/** The input for THEME_STUDIO_LIVE_DOM. */
export interface StudioLiveDomRequest {
  agentId: AgentId;
}

/** The input for STUDIO_LIVE_DOM_CACHE_WRITE */
export interface StudioLiveDomCacheWriteRequest {
  agentId: AgentId;
  domTree: DomTreeNode;
}

/** The input for STUDIO_LIVE_DOM_CACHE_READ */
export interface StudioLiveDomCacheReadRequest {
  agentId: AgentId;
}

/** The output for STUDIO_LIVE_DOM_CACHE_READ */
export interface StudioLiveDomCacheReadResponse {
  domTree: DomTreeNode | null;
  timestamp: number;
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
  /**
   * Native `:root` CSS custom properties captured live from the agent at
   * snapshot time, keyed by variable name (e.g. `--color-background`). These
   * are the agent's REAL CSS variables (not our injected `--agentskin-*`
   * unless a theme was applied), used by the RAW (native-look) preview to
   * resolve `var()` references authentically instead of rendering against an
   * empty `:root`. Optional — absent on snapshots captured before this field
   * existed, in which case the preview falls back to an empty map.
   */
  rootVars?: Record<string, string>;
  summary: {
    totalLandmarks: number;
    visibleLandmarks: number;
    selectorsTried: number;
    boxModelAvailable: boolean;
    /** True when the devtools-grade CSS/DOM capture (cascade + platform fonts) succeeded. */
    cascadeAvailable: boolean;
  };
}

// ---------------------------------------------------------------------------
// Quick Apply Types — shared across main/IPC/renderer boundary
// Moved from main/quick-apply/quick-apply-engine.ts to enforce C4 architecture boundary
// ---------------------------------------------------------------------------

/** Full 14-token palette derived from an image (string values). */
export type QuickApplyTokens = Record<string, string>;

/** Pipeline progress phases pushed to the renderer. */
export type QuickApplyPhase =
  | 'decoding'
  | 'analyzing'
  | 'extracting'
  | 'building'
  | 'installing'
  | 'applying'
  | 'verifying'
  | 'done'
  | 'error';

export interface QuickApplyProgress {
  phase: QuickApplyPhase;
  message?: string;
}

export interface QuickApplyRequest {
  /** Absolute path to the image file. */
  imagePath: string;
  /** Target agent for theme application. */
  targetAppId: AgentId;
  /** Number of dominant colors to extract (4-8, default 6). */
  colorCount?: number;
  /** Force a specific mode instead of auto-detection. */
  forceMode?: 'light' | 'dark';
  /** Whether to verify injection after apply (default true). */
  verifyAfterApply?: boolean;
}

export interface QuickApplyAnalysis {
  dominantColors: string[];
  safeArea: 'left' | 'right' | 'center' | 'none' | 'auto';
  mode: 'light' | 'dark';
  averageLuminance: number;
}

export interface QuickApplyResult {
  success: boolean;
  themeId?: string;
  tokens?: QuickApplyTokens;
  analysis?: QuickApplyAnalysis;
  appliedAt?: number;
  error?: string;
}

export interface AgentSkinApi {
  getBootstrap(): Promise<BootstrapData>;
  setLocale(locale: AppLocale): Promise<void>;
  setThemeMode(mode: 'dark' | 'light' | 'system'): Promise<void>;
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
  /** Create an `.agentskin-bundle` combo package from a theme's directory
   *  package (pywal wallpaper-themes / built-in themes) via a save dialog. */
  createBundle(themeId: string): Promise<BundleCreateResult>;
  /** Install an `.agentskin-bundle` combo package via an open dialog. */
  installBundle(): Promise<BundleInstallResult>;
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
  /** Read the global user-authored theme CSS (custom.css). */
  getCustomThemeCss(): Promise<string>;
  /** Replace the global user-authored theme CSS. Empty string clears it. */
  setCustomThemeCss(css: string): Promise<SettingsUpdateResult>;
  /** Set the live DOM auto-refresh interval (ms). 0 disables auto-refresh. */
  setLiveDomRefreshInterval(interval: number): Promise<SettingsUpdateResult>;
  /** Get the persisted runtime Markdown style configuration. */
  getMarkdownStyles(): Promise<MarkdownStyles>;
  /** Persist the runtime Markdown style configuration. */
  saveMarkdownStyles(styles: MarkdownStyles): Promise<SettingsUpdateResult>;
  // --- Dynamic wallpapers (Wallpaper Engine integration) ---
  listWallpapers(): Promise<WallpaperInfo[]>;
  /** Extract a wallpaper's dominant colors into a generated `.agentskin-theme`
   *  package, install it into the library, and return the installed theme —
   *  pywal-style wallpaper→theme linkage. Throws when the wallpaper has no
   *  decodable preview image. */
  extractThemeFromWallpaper(wallpaperId: string): Promise<InstalledTheme>;
  /** Preview a wallpaper's derived 14-token palette without installing or
   *  applying anything. Returns null when the wallpaper has no decodable
   *  preview image. Lightweight — runs the pixel-sampling + derivation
   *  pipeline in-memory, no filesystem writes. */
  previewThemeFromWallpaper(wallpaperId: string): Promise<ThemeColorsFromImage | null>;
  /** Build + install + optionally apply a wallpaper-derived theme. Generates
   *  the `.agentskin-theme` package, installs it into the library, and returns
   *  the installed theme. When `appId` is provided, also applies the theme to
   *  that agent (pywal-style one-click from Studio). */
  applyThemeFromWallpaper(wallpaperId: string, appId?: AgentId): Promise<InstalledTheme>;
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
  // --- Environment presets (main-process persisted, v2+) ---
  /** Load all persisted environment presets from the main process. */
  getEnvironmentPresets(): Promise<EnvironmentPreset[]>;
  /** Persist the full environment preset array (renderer is source of truth). */
  saveEnvironmentPresets(presets: EnvironmentPreset[]): Promise<{ ok: boolean }>;
  /** Detect whether Wallpaper Engine is installed on this machine. */
  weDetect(): Promise<{ installed: boolean; wallpaperCount: number }>;
  /** Push current override set to a running agent in real time — no full
   *  theme re-apply. Returns true if the CDP layer was injected. */
  pushTweak(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
  /** Persist the current tweak overrides into customThemeCss so they survive
   *  restart without consuming a theme-library slot. Returns true on save. */
  saveTweakAsCustomCss(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
  /** Discard live overrides for an agent — clears the temporary tweak layer
   *  without disturbing the applied theme. Returns true on reset. */
  resetTweak(session: TweakSession): Promise<boolean>;
  // --- CSS source editor ---
  /** List stylesheets (metadata only) for a running agent by port. */
  listStyleSheets(port: number): Promise<
    Array<{
      styleSheetId: string;
      url: string;
      disabled: boolean;
      isInline: boolean;
      sourceURL: string;
      length: string;
      label: string;
    }>
  >;
  /** Read the CSS text of a specific stylesheet by its synthetic id. */
  getStyleSheetText(port: number, styleSheetId: string): Promise<string>;
  /**
   * Inject edited raw CSS through the workspace-tweak layer. The CSS is
   * sanitized before injection. Returns true on success.
   */
  applyRawCssEdit(
    port: number,
    agentId: AgentId,
    css: string,
  ): Promise<{ ok: boolean; error?: string }>;
  /** Subscribe to CDP CSS domain events (styleSheetChanged / styleSheetAdded
   *  / styleSheetRemoved) pushed from the main process for a running agent.
   *  Returns an unsubscribe function. No ipcMain.handle is registered —
   *  this is a main→renderer push event sent via webContents.send. */
  /** Resolve a wallpaper's media as a streamable loopback HTTP URL (served by
   *  the wallpaper media server) so video wallpapers can play without buffering
   *  the whole file. Returns null when the id is unknown. */
  wallpaperVideoUrl(id: string): Promise<string | null>;
  /** Resolve a scene/web wallpaper's loopback renderer URL (the same iframe
   *  renderer injected into agent windows), so the desktop UI background can
   *  render the wallpaper identically. Returns null when the id is unknown. */
  wallpaperWebUrl(id: string): Promise<string | null>;
  /** Resolve a wallpaper's still preview image as a loopback HTTP URL. Used
   *  for scene/web/image wallpapers whose previewUrl is deferred to null by
   *  the list() method — the UI fetches the preview on card scroll-into-view.
   *  Returns null when no preview is available. */
  wallpaperPreviewUrl(id: string): Promise<string | null>;
  /** Extract a static frame from a Wallpaper Engine scene.pkg for preview.
   *  Uses degradation chain: main texture → preview.jpg → solid color → transparent.
   *  Returns a base64 PNG data URL with dimensions, or null on failure. */
  wallpaperStaticFrame(
    pkgPath: string,
    previewPath?: string,
  ): Promise<{ dataUrl: string; width: number; height: number } | null>;
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
  /** Pushed once after the main window is ready, listing boot steps that were
   *  degraded during startup (each entry is a human-readable warning). */
  onBootWarnings(listener: (warnings: string[]) => void): () => void;
  /** Subscribe to deep-link events pushed from the main process when an
   *  agentskin:// URI is received and parsed. The renderer handles UI navigation,
   *  apply confirmations, and install prompts. Returns an unsubscribe function.
   *  No ipcMain.handle is registered — this is a main→renderer push event sent
   *  via webContents.send. */
  onDeepLink(
    listener: (event: import('../../main/deep-link-handler').DeepLinkEvent) => void,
  ): () => void;
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
  /** Extract a color palette from an uploaded image → theme (pywal-style).
   *  Returns a normalized 14-key `--agentskin-*` palette + recommended mode. */
  extractThemeFromImage(base64Data: string): Promise<{
    palette: ThemeColorsFromImage;
    mode: 'light' | 'dark';
  }>;
  // --- Theme Studio: Bundles (workspace-scoped, no dialog passthrough) ---
  /** List all installed `.agentskin-bundle` entries. */
  listBundles(): Promise<
    Array<{ id: string; name: string; themeId?: string; hasWallpaper: boolean; createdAt: string }>
  >;
  /** Open an `.agentskin-bundle` file → install (reuses existing flow).
   *  Returns null if canceled. */
  importBundle(): Promise<{ id: string; name: string } | null>;
  /** Install an existing bundle by id (re-applies its theme). */
  installBundleById(id: string): Promise<{ ok: boolean; error?: string }>;
  /** Delete an installed bundle by id (filesystem rm). */
  deleteBundle(id: string): Promise<{ ok: boolean; error?: string }>;
  // --- Diagnostics (Performance panel) ---
  /** Fetch recent theme-apply traces and aggregate statistics for the
   *  Diagnostics tab. `count` caps at 50; defaults to 10. */
  getPerformanceHistory(count?: number): Promise<{
    recent: Array<{
      id: string;
      agentId: string;
      themeId?: string;
      finishedAt: number;
      duration: number;
      success: boolean;
      steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
      error?: string;
    }>;
    stats: {
      totalApplies: number;
      avgDurationMs: number;
      perAgentAvg: Record<string, number>;
      overflowCount: number;
    };
  }>;
  // --- Diagnostics: IPC timeout events ---
  /** Fetch recent IPC timeout events for the Diagnostics tab. `count` caps at 50; defaults to 10. */
  getPerformanceTimeouts(
    count?: number,
  ): Promise<Array<{ id: string; channel: string; ms: number; timestamp: number }>>;
  /** Clear all stored IPC timeout events. Returns `{ ok: true }`. */
  clearPerformanceTimeouts(): Promise<{ ok: true }>;
  /** Fetch main-process memory trend samples (oldest-first). Each sample
   *  carries `ts` (epoch ms) and byte counts for `heapUsed`/`rss`/`external`. */
  getPerformanceMemory(): Promise<
    Array<{ ts: number; heapUsed: number; rss: number; external: number }>
  >;
  /** Subscribe to live concurrency metrics pushed from the main process
   *  every 5 seconds. The payload covers all concurrency-subsystem maps/sets
   *  (see ConcurrencyMetrics in shared/types/concurrency).
   *  Returns an unsubscribe function. No ipcMain.handle is registered —
   *  this is a main->renderer push event sent via webContents.send. */
  onDiagnosticsConcurrencyMetrics(listener: (metrics: ConcurrencyMetrics) => void): () => void;
  /** Subscribe to new theme-apply trace records pushed from the main process
   *  when a trace is finalized. The payload is the completed ThemeApplyTrace.
   *  Returns an unsubscribe function. No ipcMain.handle is registered —
   *  this is a main→renderer push event sent via webContents.send. */
  onPerformanceNewTrace(
    listener: (trace: {
      id: string;
      agentId: string;
      themeId?: string;
      startedAt: number;
      finishedAt: number;
      duration: number;
      success: boolean;
      steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
      error?: string;
    }) => void,
  ): () => void;
  /** Subscribe to CDP session metrics pushed from the main process when
   *  session state changes (connect / disconnect / reconnect). The payload
   *  carries the current active session count and whether a reconnect just
   *  occurred. Returns an unsubscribe function. No ipcMain.handle is
   *  registered — this is a main->renderer push event sent via
   *  webContents.send. */
  onPerformanceCdpMetrics(
    listener: (metrics: { sessionCount: number; reconnected: boolean }) => void,
  ): () => void;
  /** Subscribe to persist-failure warnings pushed from the main process when
   *  persistFailures reaches threshold. The payload carries the current
   *  failureCount so the UI can surface a destructive toast. Returns an
   *  unsubscribe function. No ipcMain.handle is registered — this is a
   *  main->renderer push event sent via webContents.send. */
  onPersistFailureWarning(listener: (warning: { failureCount: number }) => void): () => void;
  /** Push renderer-side concurrency primitive sizes to the main process so
   * it can include them in the unified metrics broadcast. Fire-and-forget
   * (no ack). Called by the renderer's periodic self-report timer. */
  sendRendererConcurrencyMetrics(companionBusy: number, switchEpoch: number): void;
  // --- Secondary target injection trace ---
  /** Subscribe to per-target secondary-injection progress events. Pushed after
   * each webview/iframe completes (success or fail) during theme apply.
   * Returns an unsubscribe function. No ipcMain.handle is registered —
   * this is a main→renderer push event sent via webContents.send. */
  onSecondaryInjectProgress(
    listener: (event: {
      agent: string;
      targetId: string;
      targetType: string;
      title?: string;
      success: boolean;
      error?: string;
      elapsed: number;
    }) => void,
  ): () => void;
  /** Subscribe to the secondary-injection summary event. Pushed once after
   * all targets have been attempted for an apply. Returns an unsubscribe
   * function. */
  onSecondaryInjectSummary(
    listener: (event: {
      agent: string;
      injected: number;
      failed: number;
      total: number;
      duration: number;
    }) => void,
  ): () => void;
  // --- Theme health check ---
  /** Subscribe to theme health-check reports pushed from the main process after
   *  each injection cycle. The report carries the health score, blocking layer
   *  count, and art/sheet status for diagnostics display. Returns an unsubscribe
   *  function. No ipcMain.handle is registered — this is a main→renderer push
   *  event sent via webContents.send. */
  onThemeHealthReport(listener: (report: HealthCheckReport) => void): () => void;
  // --- P3 Self-Healing drift status ---
  /** Subscribe to per-agent drift detection status pushed from the main process
   *  after each fingerprint capture + drift cycle. Returns an unsubscribe
   *  function. No ipcMain.handle is registered — this is a main→renderer push
   *  event sent via webContents.send. */
  onThemeDriftStatus(listener: (status: DriftStatus) => void): () => void;
  /** Trigger a manual theme regeneration for a specific agent + theme.
   *  Returns the regen result (success / failed / skipped). */
  triggerManualRegen(agentId: AgentId, themeId: string): Promise<RegenResult>;
  // --- Theme Studio: Wallpaper picker (workspace-scoped) ---
  /** List wallpapers for the Studio WALLPAPER tab. */
  listWallpapersForStudio(): Promise<
    Array<{
      id: string;
      name: string;
      type: 'scene' | 'video' | 'web' | 'preset';
      thumbUrl?: string;
    }>
  >;
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
  /** Real-time DOM tree capture (no store, returns directly to useLiveDom hook). */
  captureLiveDom(agentId: AgentId): Promise<DomTreeNode>;
  /** 写入 domTree 磁盘缓存 */
  writeLiveDomCache(req: StudioLiveDomCacheWriteRequest): Promise<void>;
  /** 读取 domTree 磁盘缓存 */
  readLiveDomCache(req: StudioLiveDomCacheReadRequest): Promise<StudioLiveDomCacheReadResponse>;
  // --- Visual Analysis ---
  /** Get a visual analysis target by name. Returns null if not found. */
  getVisualAnalysisTarget(agentName: string): Promise<Record<string, unknown> | null>;
  /** List all visual analysis target names. */
  listVisualAnalysisTargets(): Promise<string[]>;
  /** List visual analysis targets with a compact summary (brand color + stats). */
  listVisualAnalysisSummaries(): Promise<VisualAnalysisSummary[]>;
  /** Detect whether a specific agent is currently running (CDP-accessible). */
  detectVisualAnalysisAgent(
    agentName: string,
  ): Promise<{ running: boolean; port?: number; title?: string }>;
  /** Subscribe to progress updates for an ongoing visual analysis extraction. */
  onVisualAnalysisProgress(
    cb: (progress: { agent: string; step: string; progress: number }) => void,
  ): () => void;
  /** Export visual analysis theme data as a standalone theme package. */
  exportVisualAnalysisTheme(
    agentName: string,
    themeData: Record<string, unknown>,
  ): Promise<{ ok: boolean; path?: string }>;
  // --- Electron app discovery & launch ---
  scanElectronApps(force?: boolean): Promise<ElectronScanResult>;
  launchElectronApp(request: LaunchRequest): Promise<LaunchResult>;
  /** Subscribe to streaming scan progress (identity-merged `add`/`update`
   *  events plus async `icon` upgrades). Pushed via `ELECTRON_SCAN_PROGRESS`
   *  while the scan walks the filesystem and icons extract. Returns an
   *  unsubscribe function. */
  onElectronScanProgress(cb: (event: ScanProgressEvent) => void): () => void;
  /** Register a custom exe path to the launch whitelist (called after
   *  addCustomApp so the user can launch what they manually added). */
  registerCustomExe(exePath: string): Promise<boolean>;
  // --- AppRunStateCoordinator ---
  /** Subscribe to coordinator state changes (app launched, exited, port changed,
   *  debugReady flipped). Pushed via `COORDINATOR_STATUS` whenever the coordinator
   *  state changes. Returns an unsubscribe function. */
  onCoordinatorStatus(cb: (event: { appId: string; state: AppRunState }) => void): () => void;
  /** One-shot full snapshot on renderer boot / window restore.
   *  Returns Map<appId, AppRunState>. */
  getCoordinatorSnapshot(): Promise<Map<string, AppRunState>>;
  /** Point query for a single app (used by detail panels, dialogs).
   *  Returns AppRunState | null. */
  queryCoordinatorState(appId: string): Promise<AppRunState | null>;
  // --- Selector probe (selector-validator.ts) ---
  /** Probe a single CSS selector against a running agent by port. */
  probeSelector(port: number, selector: string): Promise<SelectorProbeResult>;
  /** Validate multiple selectors for an agent by port. */
  validateSelectors(
    port: number,
    agentId: string,
    selectors: string[],
  ): Promise<SelectorValidationReport>;
  // --- MCP (Model Context Protocol) ---
  /** Get current MCP HTTP server status (running, url). */
  getMcpStatus(): Promise<{ running: boolean; url: string | null }>;
  /** Start the MCP HTTP server. Returns the server URL on success. */
  startMcp(): Promise<{ ok: boolean; url?: string; error?: string; alreadyRunning?: boolean }>;
  /** Stop the MCP HTTP server. */
  stopMcp(): Promise<{ ok: boolean; error?: string; alreadyStopped?: boolean }>;
  // --- Community Theme (DreamSkin + CodeDrobe, routed by sourceId) ---
  /** Fetch a paginated, filterable list of community themes. */
  listCommunityThemes(
    params?: CommunityThemeListParams,
  ): Promise<{ success: true; data: CommunityThemeListResult } | { success: false; error: string }>;
  /** Fetch the full detail of a single community theme.
   *  @param sourceId - 'codedrobe' routes to CodeDrobe API; otherwise DreamSkin. */
  getCommunityTheme(
    themeId: string,
    sourceId?: CommunitySourceId,
  ): Promise<{ success: true; data: CommunityThemeDetail } | { success: false; error: string }>;
  /** Download, verify, and install a community theme into the local library.
   *  @param sourceId - 'codedrobe' routes to CodeDrobe API; otherwise DreamSkin. */
  downloadCommunityTheme(
    themeId: string,
    sourceId?: CommunitySourceId,
  ): Promise<{ success: true; data: InstallResult } | { success: false; data: InstallResult }>;
  /** Cancel an in-progress community theme download. */
  cancelCommunityDownload(themeId: string): Promise<{ success: boolean; error?: string }>;
  /** Probe a community source's API health from the main process (net.fetch HEAD).
   *  Unactivated placeholder sources report `activated: false`. */
  probeCommunitySource(sourceId: CommunitySourceId): Promise<CommunitySourceProbeResult>;
  /** Load the persisted community install history ([] when absent or corrupt). */
  loadCommunityInstallLog(): Promise<
    { success: true; data: InstallationRecord[] } | { success: false; error: string }
  >;
  /** Persist the community install history. Returns success. */
  saveCommunityInstallLog(records: InstallationRecord[]): Promise<{ success: boolean }>;
  /** Subscribe to download progress events pushed from the main process.
   *  Returns an unsubscribe function. */
  onCommunityDownloadProgress(listener: (progress: DownloadProgress) => void): () => void;
  /** Subscribe to engine-injection-failure events pushed from the main process
   *  when the multi-layer engine injection fails partway and falls back to the
   *  legacy single-CSS injection. The renderer surfaces this as a non-blocking
   *  toast so the user knows the engine path degraded. Payload carries the agent,
   *  themeId, and a human-readable error message. Returns an unsubscribe function.
   *  No ipcMain.handle is registered — this is a main→renderer push event sent
   *  via webContents.send. */
  onThemeEngineInjectFailure(
    listener: (event: { agent: string; themeId: string; message: string }) => void,
  ): () => void;
  /** Subscribe to background-task failure events pushed from the main process
   *  when a non-critical follow-up task (hardening, wallpaper injection, scheme
   *  sync) fails during theme apply. The renderer surfaces this as a
   *  non-blocking destructive toast. Payload carries the agent, themeId, and a
   *  human-readable error message. Returns an unsubscribe function. No
   *  ipcMain.handle is registered — this is a main→renderer push event sent
   *  via webContents.send. */
  onThemeBackgroundTaskFailure(
    listener: (event: { agent: string; themeId: string; message: string }) => void,
  ): () => void;
  /** Subscribe to theme hot-reload events pushed from the main process after
   *  a theme hot-reload completes. The renderer uses this to update its UI
   *  (token preview, scheme picker, drift status) without a full page reload.
   *  Returns an unsubscribe function. No ipcMain.handle is registered —
   *  this is a main→renderer push event sent via webContents.send. */
  onThemeHotReload(
    listener: (payload: import('./theme').ThemeHotReloadPayload) => void,
  ): () => void;
  // --- Theme Usage Frequency Tracking ---
  /** Get LRU-sorted theme ids for an agent's quick-switch menu.
   *  Sorts by count descending, then lastUsed descending as tiebreaker.
   *  Returns at most `limit` ids (default 4). */
  themeUsageGet(appId: AgentId, allThemes: string[], limit?: number): Promise<string[]>;
  // --- Native Profile Pipeline (native-profile.ts) ---
  /** Build AgentNativeProfile from a DomTreeNode (renderer → main). */
  buildNativeProfile(
    domTree: DomTreeNode,
    options: {
      agentId: AgentId;
      appVersion?: string;
      scheme?: string;
      viewport?: { w: number; h: number };
    },
  ): Promise<{
    agentId: string;
    componentCount: number;
    roleDistribution: Record<string, number>;
    elevationLadder: string[];
  }>;
  /** Subscribe to native-profile-ready events (main → renderer push). */
  onNativeProfileReady(
    listener: (profile: {
      agentId: string;
      componentCount: number;
      roleDistribution: Record<string, number>;
    }) => void,
  ): () => void;
  // --- Treatment Classifier (treatment-classifier.ts) ---
  /** Classify component profiles into four treatment verdicts. */
  classifyComponents(
    profiles: Array<{
      role: string;
      ref: string;
      areaRatio: number;
      hasText: boolean;
      zIndex: number;
    }>,
  ): Promise<{
    verdicts: Array<{ ref: string; action: string; confidence: number; evidence: string[] }>;
    summary: Record<string, number>;
  }>;
  /** Generate treatment CSS from classify result. */
  generateTreatmentCss(
    verdicts: Array<{ ref: string; action: string; params?: Record<string, number> }>,
  ): Promise<string>;
  // --- Transform Ledger (transform-ledger.ts) ---
  /** Upsert a transform ledger entry. */
  upsertLedgerEntry(entry: {
    targetRef: string;
    action: string;
    params?: Record<string, number>;
    source?: string;
    enabled?: boolean;
  }): Promise<{ ok: boolean }>;
  /** Toggle a single ledger entry on/off. */
  toggleLedgerEntry(targetRef: string): Promise<{ ok: boolean; enabled: boolean }>;
  /** Set entire action class enabled/disabled. */
  setLedgerActionEnabled(action: string, enabled: boolean): Promise<{ ok: boolean }>;
  /** Get CSS from all enabled ledger entries. */
  getLedgerCss(): Promise<string>;
  /** Get full ledger state (entries + summary). */
  getLedgerState(): Promise<{
    entries: Array<{ targetRef: string; action: string; enabled: boolean; source: string }>;
    summary: Record<string, number>;
  }>;
  // --- Human-in-the-loop Overrides (overrides-store.ts) ---
  /** Add element to whitelist (fix false-negative). */
  addToWhitelist(targetRef: string, treatment: string, note?: string): Promise<{ ok: boolean }>;
  /** Add element to blacklist (fix false-positive). */
  addToBlacklist(targetRef: string, treatment: string, note?: string): Promise<{ ok: boolean }>;
  /** Confirm a classifier treatment as correct (for precision tracking). */
  confirmTreatment(targetRef: string, action: string): Promise<{ ok: boolean }>;
  /** Get current precision/recall metrics. */
  getOverrideMetrics(): Promise<{
    precision: number;
    recall: number;
    tp: number;
    fp: number;
    fn: number;
  } | null>;
  // --- Theme Asset Engine (theme-asset/index.ts) ---
  /** Convert an external theme format to AgentSkin 6-agent CSS. */
  convertThemeAsset(
    input: { kind: 'path' | 'bytes' | 'json'; data: string | Uint8Array; filename?: string },
    options?: { detectFormat?: boolean; agentIds?: AgentId[] },
  ): Promise<{
    ok: boolean;
    adapter?: string;
    confidence?: number;
    tokens?: Record<string, string>;
    agentCss?: Record<string, string>;
    error?: string;
  }>;
  /** List available theme import adapters. */
  listThemeAdapters(): Promise<
    Array<{ id: string; name: string; extensions: string[]; description: string }>
  >;
  // --- Studio Theme Templates (studio-theme-templates.ts) ---
  /** List available studio theme templates. */
  listStudioTemplates(): Promise<
    Array<{
      id: string;
      name: string;
      mode: 'light' | 'dark';
      category: string;
      description: string;
    }>
  >;
  /** Get a single template by id with full palette. */
  getStudioTemplate(templateId: string): Promise<{
    id: string;
    name: string;
    mode: 'light' | 'dark';
    palette: Record<string, string>;
    overrides?: Record<string, number>;
  } | null>;

  // --- ASAR extraction (engine update workflow) ---
  /** Discover ASAR files. Auto-detects install dir from agentId if appPath not provided.
   *  Returns layout='loose' for apps without asar (TRAE SOLO CN, Doubao). */
  discoverAsar(request: {
    appPath?: string;
    agentId?: string;
  }): Promise<
    Array<{ path: string; size: number; role: 'root' | 'webview'; layout: 'asar' | 'loose' }>
  >;
  /** Extract an ASAR file to a temp directory. Returns the extraction directory path. */
  extractAsar(
    asarPath: string,
    destDir: string,
  ): Promise<{ extractedTo: string; skipped: string[] }>;
  /**
   * Scan extracted ASAR directory for topology, strings, tokens, and fragility
   * seeds. Pass `agentId` to also return the structural `architecture` profile
   * (entry points, dependency graph, CDP surfaces, CSP grade) that the joint
   * analysis consumes.
   */
  scanAsar(
    extractDir: string,
    family: 'react' | 'vscode',
    agentId?: string,
  ): Promise<{
    topology: {
      entries: Array<{ file: string; scripts: string[] }>;
      preloadScripts: string[];
      chunks: string[];
    };
    strings: {
      dataAttrs: Array<{ value: string; count: number }>;
      dataTestids: Array<{ value: string; count: number }>;
      ids: Array<{ value: string; count: number }>;
      ipcTypes: Array<{ value: string; count: number }>;
      i18nKeys: Array<{ value: string; count: number }>;
    };
    tokens: {
      namespaces: Record<
        string,
        { varCount: number; vars: Array<{ value: string; count: number }> }
      >;
      varCount: number;
      cssBytes: number;
      sheets: number;
    };
    fragilitySeeds: Array<{ anchor: string; kind: string; stability: string }>;
    security: {
      contextIsolation: boolean | null;
      webSecurity: boolean | null;
      sandbox: boolean | null;
      csp: { from: string; directives: Record<string, string[]> };
    };
    surfaces: {
      preloadExposed: Array<{ value: string; count: number }>;
      ipc: {
        handle: Array<{ value: string; count: number }>;
        invoke: Array<{ value: string; count: number }>;
        send: Array<{ value: string; count: number }>;
        on: Array<{ value: string; count: number }>;
      };
    };
    architecture?: ArchitectureProfile;
  }>;
  /** Read a text file from extracted ASAR contents (for source inspection). */
  readAsarFile(
    extractDir: string,
    filePath: string,
  ): Promise<{ content: string; size: number } | null>;
  /** Run joint analysis combining ASAR static data with CDP real-time validation. */
  jointAnalysis(req: { agentId: string; extractDir: string; cachedScanResult?: unknown }): Promise<{
    scanResult: {
      topology: unknown;
      strings: unknown;
      tokens: unknown;
      fragilitySeeds: Array<{ anchor: string; kind: string; stability: string }>;
      security: {
        contextIsolation: boolean | null;
        webSecurity: boolean | null;
        sandbox: boolean | null;
        csp: { from: string; directives: Record<string, string[]> };
      };
      surfaces: {
        preloadExposed: Array<{ value: string; count: number }>;
        ipc: {
          handle: Array<{ value: string; count: number }>;
          invoke: Array<{ value: string; count: number }>;
          send: Array<{ value: string; count: number }>;
          on: Array<{ value: string; count: number }>;
        };
      };
    };
    health: {
      total: number;
      staticScore: number;
      dynamicScore: number;
      hitRate: number;
      landmarkPassed: boolean;
      noCdpReason?: string;
    };
    readiness: {
      canInject: boolean;
      blocks: string[];
      warnings: string[];
      recommendations: string[];
    };
    /** Present only when a live CDP session was established. */
    cdp?: {
      port: number;
      targetId: string;
      title?: string;
      url?: string;
      surfaces: Array<{
        role: string;
        entry: string;
        matched: boolean;
        title?: string;
        url?: string;
      }>;
      mechanism?: 'adoptedStyleSheets' | 'inline-style';
    };
  }>;
  // --- Pet (floating desktop companion) ---
  /** Show the floating pet window with the given pet id. */
  petShow(petId: string): void;
  /** Hide the floating pet window. */
  petHide(): void;
  /** Move the floating pet window to a new position. */
  petMove(req: { x: number; y: number }): void;
  /** Switch the active pet. */
  petSet(req: { petId: string }): void;
  // --- Quick Apply (quick-apply-ipc.ts) ---
  /** Submit an image for instant theme extraction + apply. */
  quickApplySubmit(req: QuickApplyRequest): Promise<QuickApplyResult>;
  /** Undo the last quick-apply by restoring the target agent to its native look. */
  quickApplyUndo(appId: AgentId): Promise<{ success: boolean; error?: string }>;
  /** Subscribe to quick-apply pipeline progress events. */
  onQuickApplyProgress(listener: (progress: QuickApplyProgress) => void): () => void;
}
