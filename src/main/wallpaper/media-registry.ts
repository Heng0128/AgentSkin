// SPDX-License-Identifier: MPL-2.0

/**
 * # Media Registry — Loopback URL & Token Lifecycle
 *
 * Manages the three types of loopback media-server URLs (and their
 * unregister tokens) for wallpapers:
 *
 *  - **Preview**: still preview image (the media file itself for image
 *    wallpapers, or workshop preview.jpg/png/gif for dynamic ones).
 *  - **Video**: on-demand video stream for video wallpapers.
 *  - **Web**: iframe-servable URL for web/scene wallpapers.
 *
 * Each URL is backed by a media-server token that must be unregistered when
 * no longer needed. The registry tracks all active tokens so they can be
 * released in bulk (on rescan) or per-id (on delete).
 *
 * Extracted from the original `wallpaper-service.ts` where URL caching and
 * token management were mixed with scanning, importing, and the public API.
 */

import { renderSceneToHtmlAsync, renderSceneToStaticHtmlAsync } from '../scene-renderer-async';
import { detectWebGLCapability, resolveRenderTier } from '../scene-renderer-capability';
import { wallpaperMediaServer } from '../wallpaper-server';
import type { DiscoveredItem } from './types';
import { wallpaperMimeForPath } from './utils';

interface CachedUrl {
  url: string;
  token: string;
}

export class MediaRegistry {
  private previewUrls = new Map<string, CachedUrl>();
  private videoUrls = new Map<string, CachedUrl>();
  private webUrls = new Map<string, CachedUrl>();

  /**
   * Resolve (and cache) a loopback URL for a wallpaper's still preview image:
   * the media file itself for image wallpapers, or the workshop preview.jpg/
   * png/gif for video wallpapers. Returns null when no preview image exists
   * or the file cannot be registered with the media server.
   */
  async previewUrlForItem(item: DiscoveredItem): Promise<string | null> {
    const previewSource = item.type === 'image' ? item.mediaPath : item.previewPath;
    if (!previewSource) return null;
    const cached = this.previewUrls.get(item.id);
    if (cached) return cached.url;
    const registered = await wallpaperMediaServer.register(
      previewSource,
      wallpaperMimeForPath(previewSource),
    );
    if (!registered) return null;
    this.previewUrls.set(item.id, registered);
    return registered.url;
  }

  /**
   * Resolve (and cache) a loopback URL that streams a wallpaper's media file.
   * Because the media server streams with Range support, there is no size cap.
   * Returns null when the file cannot be registered.
   */
  async videoUrlFor(item: DiscoveredItem): Promise<string | null> {
    const cached = this.videoUrls.get(item.id);
    if (cached) return cached.url;
    const registered = await wallpaperMediaServer.register(
      item.mediaPath,
      wallpaperMimeForPath(item.mediaPath),
    );
    if (!registered) return null;
    this.videoUrls.set(item.id, registered);
    return registered.url;
  }

  /**
   * Resolve (and cache) a loopback URL for web/scene wallpaper content
   * suitable for iframe injection.
   *
   * - **Web wallpapers**: the workshop directory is registered with the media
   *   server via `registerDirectory` so all relative URLs resolve correctly.
   * - **Scene wallpapers**: `scene.pkg` is parsed by `renderSceneToHtml` into
   *   a self-contained HTML canvas renderer, served via `registerHtml`.
   */
  async webUrlFor(item: DiscoveredItem): Promise<string | null> {
    if (item.type !== 'web' && item.type !== 'scene') return null;

    const cached = this.webUrls.get(item.id);
    if (cached) return cached.url;

    // Web wallpaper: register the directory tree.
    if (item.type === 'web' && item.dirPath) {
      const registered = await wallpaperMediaServer.registerDirectory(item.dirPath);
      if (!registered) {
        console.error('[wallpaper-service] registerDirectory failed for', item.dirPath);
        return null;
      }
      const url = `${registered.url}index.html`;
      this.webUrls.set(item.id, { token: registered.token, url });
      return url;
    }

    // Scene wallpaper: parse scene.pkg → HTML canvas renderer.
    // Render tier is determined by GPU capability analysis:
    //   L3 (WebGL, placeholder → falls back to L2 Canvas 2D)
    //   L2 (Canvas 2D, async worker-pooled)
    //   L1 (Static image, zero-runtime fallback)
    if (item.type === 'scene' && item.pkgPath) {
      const capability = detectWebGLCapability();
      const tier = resolveRenderTier('auto', capability.tier);

      console.log(
        `[wallpaper] Scene "${item.id}" render tier: ${tier} ` +
          `(software: ${capability.isSoftwareRenderer}, reason: ${capability.reason || 'n/a'})`,
      );

      let html: string | null;

      switch (tier) {
        case 'L1': {
          // L1: async static image (no rAF, no scripts).
          // Routed through the pooled scene render worker — parses via
          // extractScene (sync, off main thread) and outputs pure static
          // HTML with zero <script> tags. Shares the same worker pool and
          // FIFO queue as the L2 path.
          try {
            html = await renderSceneToStaticHtmlAsync(item.pkgPath);
          } catch (error) {
            console.error('[wallpaper-service] renderSceneToStaticHtmlAsync threw:', error);
            return null;
          }
          break;
        }
        default: {
          // L2: async render via worker pool (avoids blocking main process).
          // L3 (WebGL) currently falls back to this same L2 Canvas 2D path —
          // L3 and L2 share identical output.
          // TODO: Replace with real WebGL renderer when L3 is implemented.
          try {
            html = await renderSceneToHtmlAsync(item.pkgPath);
          } catch (error) {
            console.error('[wallpaper-service] renderSceneToHtmlAsync threw:', error);
            return null;
          }
          break;
        }
      }

      if (!html) {
        console.error('[wallpaper-service] Scene render returned null for', item.pkgPath);
        return null;
      }
      const registered = await wallpaperMediaServer.registerHtml(html);
      if (!registered) {
        console.error('[wallpaper-service] registerHtml failed for scene');
        return null;
      }
      this.webUrls.set(item.id, registered);
      return registered.url;
    }

    return null;
  }

  /**
   * Unregister all minted tokens and clear all URL caches. Called on rescan.
   * Each token is unregistered individually so one throw (server hiccup)
   * can't leak the remaining tokens — unregister is best-effort by contract.
   */
  releaseAll(): void {
    for (const { token } of this.previewUrls.values()) safeUnregister(token);
    for (const { token } of this.videoUrls.values()) safeUnregister(token);
    for (const { token } of this.webUrls.values()) safeUnregister(token);
    this.previewUrls.clear();
    this.videoUrls.clear();
    this.webUrls.clear();
  }

  /** Unregister tokens for a single wallpaper id. Called on delete or
   *  re-registration. */
  releaseForId(id: string): void {
    const cachedPreview = this.previewUrls.get(id);
    if (cachedPreview) {
      safeUnregister(cachedPreview.token);
      this.previewUrls.delete(id);
    }
    const cachedVideo = this.videoUrls.get(id);
    if (cachedVideo) {
      safeUnregister(cachedVideo.token);
      this.videoUrls.delete(id);
    }
    const cachedWeb = this.webUrls.get(id);
    if (cachedWeb) {
      safeUnregister(cachedWeb.token);
      this.webUrls.delete(id);
    }
  }
}

/** Unregister a media-server token without letting a throw abort a cleanup
 *  loop (releaseAll / releaseForId iterate multiple tokens). */
function safeUnregister(token: string): void {
  try {
    wallpaperMediaServer.unregister(token);
  } catch (error) {
    console.warn(`[wallpaper] failed to unregister media token: ${String(error)}`);
  }
}
