// SPDX-License-Identifier: MPL-2.0

/**
 * # Injection Constants
 *
 * Single source of truth for all cross-process contract identifiers and
 * timing magic numbers used by the CDP theme/wallpaper injection pipeline.
 *
 * ## Contract with the engine layer
 *
 * The vendored `@agentskin/engine` engine (`src/engine/src/runtime/`) defines
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
 * Before this module, the same string literals (`agentskin-host-${appId}`,
 * `__AGENTSKIN_CONFIG__`, `__agentskin_disabled__`, etc.) were scattered
 * across 60+ call sites in `cdp-inject.ts`, `secondary-inject.ts`,
 * `agent-engine-service.ts`, and the engine. A single typo in any of
 * those would silently break injection or restore. Centralizing them
 * makes the contract explicit and typo-proof.
 */

import { AGENT_IDS, type AgentId } from './types';

// ---------------------------------------------------------------------------
// Host class (applied to <html> so theme CSS can scope by `.agentskin-host-X`)
// ---------------------------------------------------------------------------

/** Prefix for the host class added to <html> (e.g. `agentskin-host-doubao`). */
export const HOST_CLASS_PREFIX = 'agentskin-host-';

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
export const RENDERER_CONFIG_GLOBAL = '__AGENTSKIN_CONFIG__';

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
// DeepCore runtime globals (RFC 2026-08-20 §4.3/§4.4)
// ---------------------------------------------------------------------------

/**
 * DeepCore runtime handle global — each DeepCore instance writes
 * `window[DEEP_CORE_GLOBAL]` so cleanup can call dispose() before
 * the adapter marker is cleared. Mirrors the ADAPTER_MARKER_PREFIX/
 * SUFFIX convention for consistency.
 */
export const DEEP_CORE_GLOBAL = '__AGENTSKIN_DEEP_CORE__';

/**
 * Saved native attachShadow reference — DeepCore writes the original
 * `Element.prototype.attachShadow` here during install() so the
 * main-process removeEngineInjection can restore it on cleanup.
 */
export const SHADOW_ORIG_REF = '__agentskin_shadow_orig__';

// ---------------------------------------------------------------------------
// Wallpaper element IDs and globals
// ---------------------------------------------------------------------------

export const VIDEO_WALLPAPER_ID = '__agentskin_video_wallpaper__';
export const VIDEO_SCRIM_ID = '__agentskin_video_scrim__';
export const IMAGE_WALLPAPER_ID = '__agentskin_image_wallpaper__';
export const IMAGE_SCRIM_ID = '__agentskin_image_scrim__';
export const WEB_WALLPAPER_ID = '__agentskin_web_wallpaper__';
export const WEB_SCRIM_ID = '__agentskin_web_scrim__';

/** Container div wrapping the wallpaper media + scrim. Uses the same layout
 *  pattern as the desktop DynamicBackground component: a fixed full-viewport
 *  container with overflow:hidden, and the media absolutely positioned inside.
 *  This guarantees the wallpaper fills exactly the visible viewport regardless
 *  of containing-block quirks in different agent shells. */
export const WALLPAPER_CONTAINER_ID = '__agentskin_wallpaper_container__';

/** Continuation layer div injected on SECONDARY surfaces in a multi-surface
 *  unified background (RFC 2026-08-18 §4.3). Where the primary surface hosts
 *  the real full-bleed wallpaper, each secondary surface gets a lightweight
 *  copy positioned at the PRIMARY's host-window rect (via a computed offset)
 *  so the shared image continues seamlessly across the split. Never carries
 *  its own scrim/guard — those live only on the primary. */
export const WALLPAPER_CONTINUATION_ID = '__agentskin_wallpaper_continuation__';

/** <style> element ID for wallpaper CSS rules. */
export const WALLPAPER_STYLE_ID = '__agentskin_wallpaper_style__';
/** Guard <style> element ID for wallpaper base rules. */
export const WALLPAPER_GUARD_ID = '__agentskin_wallpaper_guard__';

/** Window global holding the MutationObserver for wallpaper self-heal. */
export const WALLPAPER_OBSERVER_GLOBAL = '__agentskinWpObserver';

/** Window global holding the setInterval ID for wallpaper periodic self-heal.
 *  The guard observer catches DOM removals, but some edge cases (element
 *  replacement rather than removal, adoptedStyleSheet eviction, CSS
 *  re-application by the agent) can leave the wallpaper invisible without
 *  triggering a childList mutation. The periodic self-heal checks every 2s
 *  that the wallpaper is still in the DOM and visible, re-inserting or
 *  fixing opacity as needed. */
export const WALLPAPER_HEAL_GLOBAL = '__agentskinWpHeal';

/** Window global holding the resize event handler for wallpaper container
 *  re-positioning. Re-enforces position:fixed;inset:0 on the container when
 *  the window is resized (taskbar show/hide, split-screen, DPI scaling change)
 *  to prevent stale dimensions from causing positioning drift. */
export const WALLPAPER_RESIZE_GLOBAL = '__agentskinWpResize';
/** Window global holding accumulated base64 chunks during video transfer. */
export const WALLPAPER_CHUNKS_GLOBAL = '__agentskinChunks';

/**
 * Window global holding the fully-assembled data: URL for a base64 video
 * wallpaper. The base64 path (`injectVideoWallpaperByBase64`) assembles the
 * multi-MB data: URL IN-PAGE (joining the transferred chunks) and stashes it
 * here instead of returning the giant string through CDP — a 100MB+ return
 * value can exceed the 8s command timeout, failing large video wallpapers.
 * The mount step reads it from this global and deletes it after use.
 */
export const WALLPAPER_DATA_URL_GLOBAL = '__agentskinWpDataUrl';

/** Window global holding accumulated base64 chunks during hero image transfer.
 *  Separate from WALLPAPER_CHUNKS_GLOBAL so a hero inject and a video inject
 *  running back-to-back don't clobber each other's accumulator. */
export const HERO_CHUNKS_GLOBAL = '__agentskinHeroChunks';

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

/**
 * Chunk size for base64 transfer. 2 MB-per-evaluate proved too large for
 * 4K/8K hero originals on slower CDP targets: a 5 MB JPEG → ~7 MB base64 →
 * 4×2 MB evaluates could individually exceed the 8 s CDP command timeout on
 * busy renderers (doubao/codex), failing hero injection while fast targets
 * (workbuddy) succeeded. 512 KB keeps each WebSocket message small enough to
 * complete well inside the timeout; a 5 MB hero now costs ~14 quick chunks
 * instead of 4 slow ones.
 */
export const WALLPAPER_CHUNK_SIZE = 512 * 1024;

/** Default verify delay after injection (ms). */
export const DEFAULT_VERIFY_DELAY_MS = 500;
