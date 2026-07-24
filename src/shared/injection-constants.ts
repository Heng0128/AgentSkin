// SPDX-License-Identifier: MPL-2.0

/**
 * # Injection Constants
 *
 * Single source of truth for all cross-process contract identifiers and
 * timing magic numbers used by the CDP theme/wallpaper injection pipeline.
 *
 * ## Contract with the engine layer
 *
 * The vendored `@agentskin/core` engine (`src/engine/src/runtime/`) defines
 * its own equivalents of some of these constants (notably `safeHostClass`
 * in `renderer-payload.mjs`). The engine is the runtime truth for what
 * gets executed inside the renderer process; this module is the truth for
 * what the main process assembles before sending it over CDP.
 *
 * The two must agree. `scripts/check-injection-contract.mjs` asserts at
 * build time that the engine's `safeHostClass` output format matches
 * {@link HOST_CLASS_PREFIX} here.
 *
 * ## Why centralize
 *
 * Before this module, the same string literals (`codedrobe-host-${appId}`,
 * `__CODEDROBE_CONFIG__`, `__agentskin_disabled__`, etc.) were scattered
 * across 60+ call sites in `cdp-inject.ts`, `secondary-inject.ts`,
 * `agent-engine-service.ts`, and the engine. A single typo in any of
 * those would silently break injection or restore. Centralizing them
 * makes the contract explicit and typo-proof.
 */

import { AGENT_IDS, type AgentId } from './types';

// ---------------------------------------------------------------------------
// Host class (applied to <html> so theme CSS can scope by `.codedrobe-host-X`)
// ---------------------------------------------------------------------------

/** Prefix for the host class added to <html> (e.g. `codedrobe-host-doubao`). */
export const HOST_CLASS_PREFIX = 'codedrobe-host-';

/**
 * Build the host class for an agent. Mirrors `safeHostClass(appId)` in
 * `src/engine/src/runtime/renderer-payload.mjs` — keep in sync.
 */
export function hostClassFor(appId: AgentId | string): string {
  return `${HOST_CLASS_PREFIX}${String(appId).replace(/[^a-z0-9_-]/gi, '-')}`;
}

// ---------------------------------------------------------------------------
// Renderer global / sessionStorage keys
// ---------------------------------------------------------------------------

/** Global window property holding the active theme config for the renderer. */
export const RENDERER_CONFIG_GLOBAL = '__CODEDROBE_CONFIG__';

/** sessionStorage flag set during restore to suppress re-injection on reload. */
export const SESSION_DISABLED_KEY = '__agentskin_disabled__';

/** Property flag on adoptedStyleSheets marking them as AgentSkin-managed. */
export const SHEET_OWNED_FLAG = '__agentskin';

/** Property on adoptedStyleSheets naming the layer (palette/tokens/cosmetic/theme). */
export const SHEET_LAYER_FLAG = '__agentskin_layer';

// ---------------------------------------------------------------------------
// Adapter markers (window globals set by each adapter.mjs)
// ---------------------------------------------------------------------------

/**
 * Adapter marker template — each adapter sets `window[__agentskin_<id>_adapter__]`
 * to its runtime state (observer, interval) so subsequent injects can clean up.
 */
const ADAPTER_MARKER_PREFIX = '__agentskin_';
const ADAPTER_MARKER_SUFFIX = '_adapter__';

/** Build the adapter marker name for an agent (e.g. `__agentskin_doubao_adapter__`). */
export function adapterMarkerFor(appId: AgentId | string): string {
  return `${ADAPTER_MARKER_PREFIX}${String(appId)}${ADAPTER_MARKER_SUFFIX}`;
}

/** All adapter markers for the active agents (used by cleanup loops). */
export const ADAPTER_MARKERS: readonly string[] = Object.freeze(
  AGENT_IDS.map((id) => adapterMarkerFor(id)),
);

// ---------------------------------------------------------------------------
// Wallpaper element IDs and globals
// ---------------------------------------------------------------------------

export const VIDEO_WALLPAPER_ID = '__agentskin_video_wallpaper__';
export const VIDEO_SCRIM_ID = '__agentskin_video_scrim__';
export const IMAGE_WALLPAPER_ID = '__agentskin_image_wallpaper__';
export const IMAGE_SCRIM_ID = '__agentskin_image_scrim__';

/** <style> element ID for wallpaper CSS rules. */
export const WALLPAPER_STYLE_ID = '__agentskin_wallpaper_style__';
/** Guard <style> element ID for wallpaper base rules. */
export const WALLPAPER_GUARD_ID = '__agentskin_wallpaper_guard__';

/** Window global holding the MutationObserver for wallpaper self-heal. */
export const WALLPAPER_OBSERVER_GLOBAL = '__agentskinWpObserver';
/** Window global holding accumulated base64 chunks during video transfer. */
export const WALLPAPER_CHUNKS_GLOBAL = '__agentskinChunks';

/**
 * Window global flag ensuring the wallpaper background "punch-through"
 * observer is installed at most once per page load.
 */
export const WALLPAPER_PUNCH_GLOBAL = '__agentskinWpPunch';

/** <style> element id holding the `.agentskin-wp-transparent` rule. */
export const WALLPAPER_PUNCH_STYLE_ID = '__agentskin_wallpaper_punch_style__';

/** Class added to opaque full-bleed agent shells so the wallpaper shows through. */
export const WALLPAPER_PUNCH_CLASS = 'agentskin-wp-transparent';

// ---------------------------------------------------------------------------
// Timing / size magic numbers
// ---------------------------------------------------------------------------

/** Interval for the engine's renderer self-heal loop (matches renderer-payload.mjs). */
export const RENDERER_SELF_HEAL_INTERVAL_MS = 5000;

/** Max video size for chunked blob injection (500 MB). */
export const MAX_VIDEO_BLOB_BYTES = 500 * 1024 * 1024;

/** Chunk size for base64 transfer (~2 MB raw per evaluate call). */
export const WALLPAPER_CHUNK_SIZE = 2 * 1024 * 1024;

/** Default verify delay after injection (ms). */
export const DEFAULT_VERIFY_DELAY_MS = 500;
