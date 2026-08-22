// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-wallpaper-inject (barrel)
 *
 * Low-level CDP wallpaper injection for agent pages. The implementation has
 * been split into focused strategy modules under {@link ./wallpaper/}:
 *
 *   - {@link ./wallpaper/shared}          — shared helpers (retry, MIME
 *     detection, CSP bypass, punch-through script, combined removal).
 *   - {@link ./wallpaper/video-injector}  — video wallpaper injection
 *     (streamed URL + chunked base64 fallback).
 *   - {@link ./wallpaper/image-injector}  — static image wallpaper injection
 *     (chunked base64 + streamed URL).
 *   - {@link ./wallpaper/web-injector}    — web / scene wallpaper injection
 *     (iframe-based).
 *
 * This file re-exports the public API for backward compatibility — all
 * existing imports from `./cdp-wallpaper-inject` or
 * `../cdp/cdp-wallpaper-inject` continue to work unchanged.
 *
 * Wallpaper injection runs on a separate lifecycle from theme injection
 * (wallpaper apply/remove vs. theme apply/restore) and shares only the CDP
 * session transport. Theme injection lives in {@link ./cdp-inject}.
 */

// ---------------------------------------------------------------------------
// Public API re-exports
// ---------------------------------------------------------------------------

// Image wallpaper injection
export {
  injectImageWallpaper,
  injectImageWallpaperByUrl,
} from './wallpaper/image-injector';
// Shared helpers (retry, MIME detection, CSP bypass, punch-through, removal)
export {
  applyPunchThrough,
  buildFilter,
  buildFlipTransform,
  buildMediaElementCss,
  buildParallaxJs,
  buildTileContainerCss,
  buildWpSignalBridgeJs,
  bypassPageCsp,
  evaluateWithRetry,
  hexHue,
  imageMimeForPath,
  removeAllWallpapers,
  verifyWallpaperVisibility,
  videoMimeForPath,
} from './wallpaper/shared';
// Video wallpaper injection
export {
  injectVideoWallpaper,
  injectVideoWallpaperByBase64,
} from './wallpaper/video-injector';
// Web / scene wallpaper injection
export { injectWebWallpaper } from './wallpaper/web-injector';
