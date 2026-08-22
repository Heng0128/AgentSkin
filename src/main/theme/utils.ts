// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Utilities
 *
 * Extracted from `theme-library.ts` (P4 of the god-object teardown).
 *
 * Pure(ish) utility functions for theme data transformation:
 *  - MIME / extension mapping
 *  - Cover/icon data URL extraction from bundles
 *  - Supported-agent and legacy-target detection
 *  - Semantic color token extraction and dark/light mode inference
 *  - Wallpaper config type-guarding
 *  - Cover/icon disk cache management (the one side-effecting area)
 *  - {@link toInstalledTheme} — the central ThemeEntry → InstalledTheme mapper
 *
 * The cover/icon cache is module-level (singleton) because there is only one
 * `ThemeLibrary` instance in the app, and `toInstalledTheme` is a standalone
 * function imported by several call sites that don't have a library reference.
 */

import fsSync from 'node:fs';
import path from 'node:path';
import type { ThemeBundle } from '../../legacy/agentskin-core-runtime';
import {
  type AgentId,
  type InstalledTheme,
  isAgentId,
  type ThemeColorScheme,
} from '../../shared/types';
import type { ThemeEntry } from '../services/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard upper bound on a single .agentskin-theme package size. P1 audit #5:
 * without this guard a user dragging in a multi-GB file (malicious or just
 * broken) would have `readFile` allocate a Buffer of that size and
 * `JSON.parse` allocate an equal-sized string before validation could run,
 * OOM-crashing the Electron main process. 50 MB is comfortably above the
 * largest legitimate theme we've seen (~12 MB with a base64 hero) while
 * still being small enough that the parse + validate step stays snappy.
 */
export const MAX_THEME_PACKAGE_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// MIME helpers
// ---------------------------------------------------------------------------

/** Map an image mime type to a file extension for the cover cache. */
export function extForMime(mime?: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'png';
  }
}

// ---------------------------------------------------------------------------
// Bundle data URL extractors
// ---------------------------------------------------------------------------

export function coverDataUrl(bundle: ThemeBundle): string | null {
  const image = bundle.assets?.images?.hero ?? bundle.assets?.art ?? null;
  if (!image?.base64) return null;
  return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
}

export function iconDataUrl(bundle: ThemeBundle): string | null {
  const image = bundle.assets?.images?.icon ?? null;
  if (!image?.base64) return null;
  return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
}

// ---------------------------------------------------------------------------
// Bundle inspectors
// ---------------------------------------------------------------------------

export function supportedAgents(bundle: ThemeBundle): AgentId[] {
  return Object.keys(bundle.targets).filter(isAgentId);
}

/**
 * Target keys that are NOT current AgentIds — e.g. themes targeting agents
 * AgentSkin no longer ships adapters for. These are preserved (not silently
 * dropped) so the migration layer and UI can surface them.
 */
export function legacyTargets(bundle: ThemeBundle): string[] {
  return Object.keys(bundle.targets).filter((key) => !isAgentId(key));
}

// ---------------------------------------------------------------------------
// Color extraction & mode inference
// ---------------------------------------------------------------------------

/** Extract semantic color tokens from a ThemeBundle's target CSS. */
export function extractColors(bundle: ThemeBundle): Record<string, string> | undefined {
  const cssEntries = Object.values(bundle.targets);
  const allCss = cssEntries.map((t) => (typeof t.css === 'string' ? t.css : '')).join('\n');
  if (!allCss) return undefined;
  const colorMap: Record<string, string> = {};
  const tokenRegex = /--agentskin-(\w[\w-]*):\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((match = tokenRegex.exec(allCss)) !== null) {
    const [, token, value] = match;
    const normalized = token.replace(/-/g, '');
    colorMap[normalized] = value.trim();
  }
  return Object.keys(colorMap).length > 0 ? colorMap : undefined;
}

/**
 * Infer dark/light mode from a theme's color palette using perceived
 * luminance (Rec. 709 weights). Threshold 0.4 → dark. Returns null if no
 * usable background color is found.
 *
 * This is the single source of truth for mode inference — both the catalog
 * (detectMode below) and the engine (agent-engine-service) call it, so the
 * two layers can never disagree on whether a given background is dark or
 * light.
 */
export function inferModeFromColors(colors?: Record<string, string>): 'dark' | 'light' | null {
  if (!colors) return null;
  const bg = colors.background ?? colors.bg ?? colors['--background'];
  if (!bg || typeof bg !== 'string') return null;
  // Parse hex (#rgb / #rrggbb) or rgb()/rgba().
  const hex = bg.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let r = 0,
    g = 0,
    b = 0;
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  } else {
    const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!rgb) return null;
    r = parseInt(rgb[1], 10);
    g = parseInt(rgb[2], 10);
    b = parseInt(rgb[3], 10);
  }
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.4 ? 'dark' : 'light';
}

/** Detect the color mode from semantic tokens. Delegates to
 *  {@link inferModeFromColors} so the catalog and engine always agree. */
export function detectMode(bundle: ThemeBundle): 'dark' | 'light' | 'auto' | undefined {
  return inferModeFromColors(extractColors(bundle)) ?? undefined;
}

// ---------------------------------------------------------------------------
// Wallpaper config type-guard
// ---------------------------------------------------------------------------

/** Type-guard the free-form wallpaper config from theme.copy into a safe shape.
 *  Requires at least one of workshopId / video to be present. */
export function extractWallpaper(raw: unknown): InstalledTheme['wallpaper'] {
  if (!raw || typeof raw !== 'object') return null;
  const wp = raw as Record<string, unknown>;
  const workshopId = typeof wp.workshopId === 'string' ? wp.workshopId : undefined;
  const video = typeof wp.video === 'string' ? wp.video : undefined;
  if (!workshopId && !video) return null;
  return {
    workshopId: workshopId || undefined,
    video: video || undefined,
    poster: typeof wp.poster === 'string' ? wp.poster : undefined,
    speed: typeof wp.speed === 'number' ? wp.speed : undefined,
    loop: typeof wp.loop === 'boolean' ? wp.loop : undefined,
    scrimOpacity: typeof wp.scrimOpacity === 'number' ? wp.scrimOpacity : undefined,
  };
}

// ---------------------------------------------------------------------------
// Cover / icon disk cache (module-level singleton)
// ---------------------------------------------------------------------------

/**
 * Module-level cover cache. `toInstalledTheme` is a standalone (non-method)
 * function imported by several call sites, so cover extraction state lives at
 * module scope rather than on the ThemeLibrary instance. There is a single
 * ThemeLibrary in the app, so a module singleton is safe.
 */
let coverDir = '';
const coverCache = new Map<string, string>();
const iconCache = new Map<string, string>();

/** Set the cover cache directory and create it. Called by ThemeLibrary.initialize(). */
export function setCoverDir(dir: string): void {
  coverDir = dir;
  fsSync.mkdirSync(dir, { recursive: true });
}

/**
 * Extract a theme's embedded cover image (hero/art base64) to a disk file and
 * return its path. Cached by theme id so repeat catalog builds don't re-decode.
 * Returns null when the bundle has no cover or extraction fails — callers fall
 * back to the inline base64 data URL. The renderer loads the path via
 * agentskin-theme://cover/{id}, keeping the base64 blob out of its JS heap.
 */
export function extractCover(id: string, bundle: ThemeBundle): string | null {
  const image = bundle.assets?.images?.hero ?? bundle.assets?.art ?? null;
  if (!image?.base64) return null;
  const cached = coverCache.get(id);
  if (cached && fsSync.existsSync(cached)) return cached;
  const target = path.join(coverDir, `${id}.${extForMime(image.mimeType)}`);
  try {
    fsSync.writeFileSync(target, Buffer.from(image.base64, 'base64'));
    coverCache.set(id, target);
    return target;
  } catch {
    return null;
  }
}

/**
 * Extract a theme's embedded icon image (base64) to a disk file and return
 * its path. Mirrors {@link extractCover} but for the small app-mark icon,
 * served via agentskin-theme://icon/{id} so the renderer never holds the
 * base64 blob in its JS heap. Cached by theme id.
 */
export function extractIcon(id: string, bundle: ThemeBundle): string | null {
  const image = bundle.assets?.images?.icon ?? null;
  if (!image?.base64) return null;
  const cached = iconCache.get(id);
  if (cached && fsSync.existsSync(cached)) return cached;
  const target = path.join(coverDir, `${id}.icon.${extForMime(image.mimeType)}`);
  try {
    fsSync.writeFileSync(target, Buffer.from(image.base64, 'base64'));
    iconCache.set(id, target);
    return target;
  } catch {
    return null;
  }
}

/** Resolve the cached cover file path for a theme id (scheme handler).
 *  Populated during catalog builds by {@link extractCover}. */
export function getCachedCoverPath(id: string): string | null {
  const cached = coverCache.get(id);
  if (cached && fsSync.existsSync(cached)) return cached;
  return null;
}

/** Resolve the cached icon file path for a theme id (scheme handler). */
export function getCachedIconPath(id: string): string | null {
  const cached = iconCache.get(id);
  if (cached && fsSync.existsSync(cached)) return cached;
  return null;
}

/** Remove a theme's cover from the disk cache. Called by ThemeLibrary.delete()
 *  so a re-added theme with the same id refreshes. */
export function clearCoverCache(id: string): void {
  const cached = coverCache.get(id);
  if (cached) {
    fsSync.rmSync(cached, { force: true });
    coverCache.delete(id);
  }
}

// ---------------------------------------------------------------------------
// ThemeEntry → InstalledTheme mapper
// ---------------------------------------------------------------------------

export function toInstalledTheme(entry: ThemeEntry): InstalledTheme {
  const { bundle } = entry;
  const copy = (bundle.theme.copy ?? null) as Record<string, unknown> | null;
  const themeMeta = bundle.theme as unknown as Record<string, unknown>;
  // Display metadata lives in theme.copy (engine-safe free-form record).
  // Fall back to legacy top-level theme fields for bundles from older
  // installers / imported .agentskin-theme packages.
  const pick = (key: string): unknown => {
    if (copy && key in copy) return copy[key];
    return themeMeta[key];
  };

  const tagline = typeof pick('tagline') === 'string' ? (pick('tagline') as string) : null;

  // Author: string, or { name, url } object, or absent.
  const authorRaw = pick('author');
  let author: string | undefined;
  if (typeof authorRaw === 'string') author = authorRaw;
  else if (authorRaw && typeof authorRaw === 'object' && 'name' in authorRaw) {
    const name = (authorRaw as { name?: unknown }).name;
    author = typeof name === 'string' ? name : undefined;
  }

  const category = typeof pick('category') === 'string' ? (pick('category') as string) : undefined;
  const tags = Array.isArray(pick('tags')) ? (pick('tags') as string[]) : undefined;
  const license = typeof pick('license') === 'string' ? (pick('license') as string) : undefined;
  const unofficial =
    typeof pick('unofficial') === 'boolean' ? (pick('unofficial') as boolean) : undefined;
  const mode =
    typeof pick('mode') === 'string' ? (pick('mode') as 'dark' | 'light' | 'auto') : undefined;
  // Color-scheme variant this bundle represents. Present only for themes
  // installed by the scheme-aware installer (v2.2+); legacy/imported bundles
  // have no scheme marker and are treated as 'default'.
  const schemeRaw = pick('scheme');
  const scheme = typeof schemeRaw === 'string' && schemeRaw !== 'default' ? schemeRaw : 'default';
  const colorSchemes = Array.isArray(pick('colorSchemes'))
    ? (pick('colorSchemes') as string[])
    : undefined;

  // Prefer an explicit supportedAgents list (the agent ids this theme
  // targets); else derive from target keys.
  const copySupported = Array.isArray(pick('supportedAgents'))
    ? (pick('supportedAgents') as unknown[]).filter(
        (x): x is AgentId => typeof x === 'string' && isAgentId(x),
      )
    : null;
  const supported = copySupported?.length ? copySupported : supportedAgents(bundle);

  // Prefer colors extracted from embedded CSS; fall back to manifest colors.
  const colors =
    extractColors(bundle) ??
    (copy?.colors && typeof copy.colors === 'object'
      ? (copy.colors as Record<string, string>)
      : undefined);

  // Full scheme metadata (id/name/mode for every variant, default first).
  // The catalog uses this to build the UI's scheme picker. Colors are
  // placeholders for THIS bundle; the catalog merge step overwrites each
  // variant's colors with the colors from its own bundle.
  const schemesRaw = pick('schemes');
  const schemes = Array.isArray(schemesRaw)
    ? (schemesRaw as Array<{ id?: unknown; name?: unknown; mode?: unknown }>)
        .filter((s) => s && typeof s === 'object' && typeof s.id === 'string')
        .map(
          (s): ThemeColorScheme => ({
            id: s.id as string,
            name: typeof s.name === 'string' ? s.name : (s.id as string),
            mode: s.mode === 'dark' || s.mode === 'light' || s.mode === 'auto' ? s.mode : undefined,
            colors: colors ?? {},
          }),
        )
    : undefined;

  return {
    id: bundle.theme.id,
    displayName: bundle.theme.displayName,
    version: bundle.theme.version,
    author,
    category,
    tags,
    license,
    unofficial,
    supportedAgents: supported,
    legacyTargets: legacyTargets(bundle),
    coverDataUrl: coverDataUrl(bundle),
    coverPath: extractCover(entry.bundle.theme.id, entry.bundle),
    tagline,
    iconDataUrl: iconDataUrl(bundle),
    icon: iconDataUrl(bundle),
    iconPath: extractIcon(entry.bundle.theme.id, entry.bundle),
    colors,
    mode: mode ?? detectMode(bundle),
    contentHash:
      typeof pick('contentHash') === 'string' ? (pick('contentHash') as string) : undefined,
    wallpaper: extractWallpaper(pick('wallpaper')),
    scheme,
    // Flatten the declared color-scheme ids for the catalog merge step; each
    // variant carries the full list so the default entry knows every scheme
    // the theme ships (and each variant knows its own id via `scheme`).
    colorSchemes,
    // Full scheme metadata (id/name/mode for every variant, default first).
    schemes,
    // Directory-package root (absolute) — recorded by the installer for
    // themes installed from a directory package, so wallpaper registration
    // can resolve video paths outside the app's built-in themes dir.
    packageRoot:
      typeof pick('packageRoot') === 'string' ? (pick('packageRoot') as string) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle cleanup (module-scoped cover/icon caches)
// ---------------------------------------------------------------------------

/**
 * Drop cover + icon cache entries for a single theme id. Called from the
 * theme uninstall path so a deleted theme's extracted cover/icon files are
 * no longer pinned by the runtime cache (the on-disk files are also removed
 * by the installer; this just frees the runtime entries).
 */
export function cleanupThemeAssetCacheFor(themeId: string): void {
  coverCache.delete(themeId);
  iconCache.delete(themeId);
}

/**
 * Drop ALL runtime cover/icon cache state. Called only at app shutdown.
 * On-disk files under `coverDir` are NOT touched (they survive restarts and
 * are warmed back up on the next catalog build); only the in-memory path
 * lookups are cleared to release references before process exit.
 */
export function disposeThemeAssetCache(): void {
  coverCache.clear();
  iconCache.clear();
}
