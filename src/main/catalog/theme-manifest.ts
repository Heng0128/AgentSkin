// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeManifest — directory-based theme package manifest (P3.1 / v2)
 *
 * Represents the JSON metadata for a theme living inside a `themes/<id>/`
 * directory. Supports both v1 (legacy) and v2 (new) manifest schemas.
 *
 * ThemePackageLoader reads this manifest and produces an InstalledThemePackage
 * that feeds into the existing ThemeLibrary → ThemeCatalog → UI pipeline.
 *
 * ## Schema evolution
 *
 * - v1: Basic fields (id, name, version, colors, icon, preview, mode).
 * - v2: Adds `targets` (per-agent CSS + verification), `author`, `category`,
 *       `tags`, `license`, expanded `colors` (semantic tokens),
 *       `assets.background` (multi-resolution), `unofficial`.
 */

// --- v2 fields ---

export interface ThemeAuthor {
  name: string;
  url?: string;
}

export interface ThemeTargetConfig {
  /** Path to agent-specific CSS relative to manifest directory. */
  css: string;
  /** Verification anchors to confirm CSS targets the right DOM nodes. */
  verification?: {
    /** Selectors that MUST exist for the theme to be considered applied. */
    required?: Array<{ name: string; any: string[] }>;
    /** Selectors that SHOULD exist (warnings if missing). */
    recommended?: Array<{ name: string; any: string[] }>;
  };
}

/**
 * @deprecated Per-resolution background variants are NOT consumed by the
 * AgentSkin pipeline. The canonical art source is `manifest.hero`: the
 * installer embeds it into the bundle and the engine exposes it as
 * `--agentskin-art`, which the shipped CSS uses for the backdrop layer.
 * This type is kept only so third-party manifests that still declare
 * `assets.background` parse and validate; new themes should use `hero`.
 */
export interface ThemeBackgroundAssets {
  /** Default/resolution to use. */
  default: string;
  /** Per-aspect-ratio background images. */
  '16x10'?: string;
  '16x9'?: string;
  '4x3'?: string;
  /** Fallback when no exact match. */
  fallback: string;
}

export interface ThemeAssets {
  /** @deprecated Use `manifest.hero` instead — see ThemeBackgroundAssets. */
  background?: ThemeBackgroundAssets;
}

/**
 * CSS color tokens the theme ships with.
 * Supports both v1 (primary, text) and v2 (accent, foreground) naming.
 */
export interface ThemeColors {
  /** v1 compatibility alias for accent */
  primary?: string;
  /** v1 compatibility alias for text */
  text?: string;
  accent?: string;
  secondary?: string;
  background: string;
  foreground: string;
  muted?: string;
  surface?: string;
  surfaceElevated?: string;
  border?: string;
  codeBackground?: string;
  codeForeground?: string;
  inputBackground?: string;
  buttonBackground?: string;
  buttonForeground?: string;
  focusRing?: string;
}

// --- Unified manifest type (supports both v1 and v2) ---

export type ThemeSchemaVersion = 1 | 2;

export type ThemeMode = 'dark' | 'light' | 'auto';

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

/**
 * Dynamic visual effect type applied on top of the static theme.
 * - 'aurora': Animated aurora borealis gradient blobs
 * - 'particles': Floating particle field
 * - 'gradient': Animated gradient flow
 * - 'waves': Subtle wave animation
 * - false: Explicitly disable dynamic effects
 */
export type ThemeDynamicEffect = 'aurora' | 'particles' | 'gradient' | 'waves' | false;

/**
 * Video wallpaper configuration for themes that ship animated backgrounds.
 *
 * Two reference modes (mutually exclusive — workshopId takes precedence):
 * - `workshopId`: references a Wallpaper Engine Steam workshop item by its
 *   numeric id. The video is NOT bundled with the theme; the user must have
 *   the item subscribed in Wallpaper Engine. Activating the theme switches
 *   the dynamic background to that workshop item.
 * - `video`: a video file bundled inside the theme package (relative path),
 *   streamed in place via the agentskin-wallpaper:// protocol.
 */
export interface ThemeWallpaperConfig {
  /** Wallpaper Engine workshop item id (numeric string, e.g. "1234567890").
   *  Takes precedence over `video` when both are present. */
  workshopId?: string;
  /** Path to video file relative to package root (mp4/webm). */
  video?: string;
  /** Optional poster image shown before video loads (png/webp). */
  poster?: string;
  /** Playback speed multiplier (default 1.0). */
  speed?: number;
  /** Whether to loop the video (default true). */
  loop?: boolean;
  /** Overlay scrim opacity 0-100 (default 55). Higher = more readable, less visible. */
  scrimOpacity?: number;
}

/**
 * Custom font configuration for themes that ship web fonts.
 */
export interface ThemeFontConfig {
  /** Font family name as used in CSS font-family. */
  family: string;
  /** Path to font file relative to package root (woff2/woff/ttf/otf). */
  src: string;
  /** Font weight (default 400). */
  weight?: number | string;
  /** Font style (default 'normal'). */
  style?: 'normal' | 'italic' | 'oblique';
  /** Whether to preload this font (default false). */
  preload?: boolean;
}

export interface ThemeManifest {
  /** Stable theme identifier (lowercase alphanumeric + hyphens). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Optional localized display name (e.g. "赛博霓虹"). */
  displayName?: string;
  /** Semantic version string. */
  version: string;
  /** Optional human-readable description. */
  description?: string;
  /** Schema version (1 = legacy, 2 = new expanded schema). */
  schemaVersion?: ThemeSchemaVersion;
  /** Filename (relative to manifest) pointing to the theme icon PNG. */
  icon: string;
  /** Filename (relative to manifest) pointing to the preview screenshot. */
  preview: string;
  /**
   * Optional filename (relative to manifest) pointing to the hero artwork
   * (png/webp/jpeg). Embedded as the bundle's `assets.images.hero`: the
   * engine exposes it to the injected CSS as `--agentskin-art` and the
   * catalog uses it as the theme cover. Falls back to `preview` when absent.
   */
  hero?: string;
  /**
   * Whether this theme ships hero artwork (default true). Flat / CSS-only
   * themes (e.g. the WeChat skin) set `art: false`: they intentionally have
   * no backdrop image, so the pipeline must not require their injected CSS
   * to reference `--agentskin-art`. The catalog cover still falls back to
   * `preview` for display purposes.
   */
  art?: boolean;
  /** Preferred color mode. */
  mode?: ThemeMode;
  /** CSS color tokens the theme ships with. */
  colors: ThemeColors;
  /** Optional asset references relative to the package root. */
  assets?: ThemeAssets;
  /** Per-agent target configurations (v2). */
  targets?: Record<string, ThemeTargetConfig>;
  /** Explicit supported agent ids (v2). When present, overrides deriving from `targets`. */
  supportedAgents?: string[];
  /** Theme author (v2). */
  author?: ThemeAuthor;
  /** Theme category slug (v2). */
  category?: ThemeCategory;
  /** Theme tags for search/filter (v2). */
  tags?: string[];
  /** License identifier (v2). */
  license?: string;
  /** Whether this is an unofficial/community theme (v2). */
  unofficial?: boolean;

  // --- v2.1+ extensions ---

  /**
   * Dynamic visual effect applied on top of the static theme.
   * When set, the renderer overlays an animated effect layer.
   * Set to `false` to explicitly disable dynamic effects.
   * @since 2.1.0
   */
  dynamic?: ThemeDynamicEffect;

  /**
   * Video wallpaper configuration. When present, the theme ships an
   * animated video background streamed via agentskin-wallpaper:// protocol.
   * Requires WallpaperService to be enabled.
   * @since 2.1.0
   */
  wallpaper?: ThemeWallpaperConfig;

  /**
   * Custom web fonts shipped with the theme. The installer registers
   * these via @font-face injection into the target agent.
   * @since 2.1.0
   */
  fonts?: ThemeFontConfig[];

  /**
   * Minimum AgentSkin desktop version required to use this theme.
   * Semver string (e.g. "2.1.0"). Themes using newer manifest features
   * should set this to prevent runtime errors on older clients.
   * @since 2.1.0
   */
  minAppVersion?: string;

  /**
   * Theme homepage URL (documentation, showcase, etc.).
   * @since 2.1.0
   */
  homepage?: string;

  /**
   * Source repository URL (GitHub, GitLab, etc.).
   * @since 2.1.0
   */
  repository?: string;
}

/** Re-export under an unambiguous name for consumers outside this file. */
export type DirectoryThemeManifest = ThemeManifest;

/**
 * Check if a manifest is v2 (has targets or schemaVersion >= 2).
 */
export function isV2Manifest(manifest: ThemeManifest): boolean {
  return !!(manifest.schemaVersion === 2 || manifest.targets);
}

/**
 * Extract a flat list of supported agent IDs from a v2 manifest's targets.
 * Falls back to derived from supportedAgents or targets.
 */
export function getSupportedAgents(manifest: ThemeManifest): string[] {
  if (manifest.supportedAgents && manifest.supportedAgents.length > 0) {
    return manifest.supportedAgents;
  }
  if (isV2Manifest(manifest) && manifest.targets) {
    return Object.keys(manifest.targets);
  }
  return [];
}
