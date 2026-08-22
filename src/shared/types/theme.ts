// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from './agent';
import type { ThemeWallpaper } from './wallpaper';

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  supportedAgents: AgentId[];
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
  /** Color-scheme variant this entry represents. 'default' (or absent) is the
   *  theme's own manifest colors; other values are alternative color schemes
   *  declared via `manifest.colorSchemes`. Scheme variants install as
   *  `<themeId>--<schemeId>` bundle ids and are merged back into a single
   *  catalog entry. */
  scheme?: 'default' | string;
  /** Declared color-scheme ids for this theme (excluding the implicit
   *  'default'). Present on bundles installed by the scheme-aware installer;
   *  used by the catalog to merge variants into a single entry. */
  colorSchemes?: string[];
  /** Full color-scheme metadata (id/name/mode for every variant, default
   *  first). Present on bundles installed by the scheme-aware installer;
   *  used by the catalog to build the UI scheme picker. */
  schemes?: ThemeColorScheme[];
  /** Directory-package root (absolute) for themes installed from a directory
   *  package (pywal wallpaper-themes, .agentskin-bundle installs). Used by
   *  wallpaper registration to resolve `theme.wallpaper.video` relative
   *  paths. Built-in themes lack this and fall back to the app themes dir. */
  packageRoot?: string;
}

/**
 * A named alternative color-scheme variant of a theme (v2.2+). Each entry
 * corresponds to a `color-schemes/<id>.json` file whose `colors` match the
 * manifest colors shape. The id `'default'` always refers to the theme's own
 * colors and is implicit (no file).
 */
export interface ThemeColorScheme {
  id: string;
  name: string;
  mode?: 'dark' | 'light' | 'auto';
  colors: Record<string, string>;
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
  | 'light';

export interface ThemeCatalogItem {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  preview: string | null;
  icon?: string | null;
  supportedAgents: AgentId[];
  /**
   * @deprecated Use `supportedAgents` instead. Kept for backward compatibility
   *   with legacy catalog entries that predate the unified AgentId-based
   *   naming. Will be removed in a future schema version.
   */
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
  /** Alternative color-scheme variants (v2.2+). Always includes the implicit
   *  'default' entry first, followed by each declared scheme. When absent the
   *  theme ships a single color set. */
  schemes?: ThemeColorScheme[];
  /** Video wallpaper config bundled with this theme. When present, applying
   *  the theme also activates the video background in AgentSkin. */
  wallpaper?: ThemeWallpaper | null;
}

export interface CatalogResult<T> {
  version: number;
  updatedAt: string;
  items: T[];
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

/** Options controlling how deep the Theme Studio's DOM/style probe goes. */
export interface StudioSnapshotOptions {
  /** Extra CSS selectors to capture beyond the agent's default landmark set. */
  extraSelectors?: string[];
  /** Pseudo-classes to force and capture (e.g. `['hover','focus','active']`). */
  pseudoStates?: string[];
  /** Also capture light/dark scheme variants via emulated media. */
  captureSchemes?: boolean;
}

// ---------------------------------------------------------------------------
// Image → Theme extraction (pywal-style)
// ---------------------------------------------------------------------------

/** Pixel sampler output for image-to-theme extraction (renderer→main IPC). */
export interface ImagePixelSample {
  /** De-duplicated colors + occurrence count (avoids same-color sample bloat). */
  colors: Array<{ r: number; g: number; b: number; weight: number }>;
  /** Resolution (used to decide cluster bucket count, optional). */
  width?: number;
  height?: number;
}

/** 14-token palette derived from an image (aligns with ThemeManifest.colors). */
export interface ThemeColorsFromImage {
  mode: 'light' | 'dark';
  accent: string;
  /** accent 的低饱和变体，用于次级强调（标签、badge、subtle 高亮）。 */
  accentMuted: string;
  secondary: string;
  background: string;
  foreground: string;
  muted: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  codeBackground: string;
  codeForeground: string;
  inputBackground: string;
  buttonBackground: string;
  buttonForeground: string;
  focusRing: string;

  /**
   * 扩展色集（26 色级，Catppuccin 风格）。
   * - 由 GENERATORS 消费 → 生成 per-agent CSS 变量 --agentskin-ext-*
   * - 缺失时回退到 14-token 推导
   */
  extended?: Record<string, string>;

  /**
   * 每个色值的推导来源标记（可追溯 / 可审计）。
   */
  inference?: Record<string, 'provided' | 'derived' | 'default'>;
}
