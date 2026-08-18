// SPDX-License-Identifier: MPL-2.0

import type { AppLocale } from '../i18n';
import type {
  AgentCatalogItem,
  AgentId,
  ElectronScanResult,
  InstallState,
  LaunchResult,
  Platform,
  ScanProgressEvent,
} from './agent';
import type { ConcurrencyMetrics } from './concurrency';
import type { EnvironmentPreset } from './environment';
import type { LaunchRequest } from './launch';
import type { ToolOverride, TweakSession } from './override';
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
  // --- Dynamic wallpapers (Wallpaper Engine integration) ---
  listWallpapers(): Promise<WallpaperInfo[]>;
  /** Extract a wallpaper's dominant colors into a generated `.agentskin-theme`
   *  package, install it into the library, and return the installed theme —
   *  pywal-style wallpaper→theme linkage. Throws when the wallpaper has no
   *  decodable preview image. */
  extractThemeFromWallpaper(wallpaperId: string): Promise<InstalledTheme>;
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
  /** Pushed once after the main window is ready, listing boot steps that were
   *  degraded during startup (each entry is a human-readable warning). */
  onBootWarnings(listener: (warnings: string[]) => void): () => void;
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
      finishedAt: string;
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
  /** Subscribe to running-status changes for scanned Electron apps (launch /
   *  exit). The main process pushes the full `getRunningApps()` snapshot via
   *  `ELECTRON_STATUS` whenever a launch succeeds or an app exits. Returns an
   *  unsubscribe function. */
  onElectronStatus(
    cb: (status: Map<string, { pid: number; port: number | null }>) => void,
  ): () => void;
  /** Subscribe to streaming scan progress (identity-merged `add`/`update`
   *  events plus async `icon` upgrades). Pushed via `ELECTRON_SCAN_PROGRESS`
   *  while the scan walks the filesystem and icons extract. Returns an
   *  unsubscribe function. */
  onElectronScanProgress(cb: (event: ScanProgressEvent) => void): () => void;
}
