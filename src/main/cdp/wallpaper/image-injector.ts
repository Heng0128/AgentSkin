// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/image-injector
 *
 * Static image wallpaper injection strategies via CDP. Two entry points:
 *
 *   - {@link injectImageWallpaper} — single-shot base64 transfer for local
 *     image files. The image is read, encoded as base64, transferred in
 *     chunks (~2 MB each), and reassembled as a `data:` URL in-page.
 *   - {@link injectImageWallpaperByUrl} — mount an image from a pre-built
 *     URL (loopback http served by `wallpaper-server`). Used for large
 *     images that exceed the in-page base64 blob cap.
 *
 * Both create a fixed full-bleed `<img>` at z-index -2, a readability scrim
 * at z-index -1, a transparency style element, and a MutationObserver guard
 * that re-inserts the wallpaper if React destroys it. A load-watchdog
 * verifies the image actually loads before reporting success.
 *
 * Uses shared helpers from {@link ./shared}: {@link bypassPageCsp} (CSP
 * bypass before mounting), {@link evaluateWithRetry} (chunked transfer
 * retry), {@link applyPunchThrough} (neutralize opaque agent shell).
 */

import { readFile, stat } from 'node:fs/promises';
import {
  IMAGE_SCRIM_ID,
  IMAGE_WALLPAPER_ID,
  VIDEO_SCRIM_ID,
  VIDEO_WALLPAPER_ID,
  WALLPAPER_CHUNK_SIZE,
  WALLPAPER_CHUNKS_GLOBAL,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_GUARD_ID,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_STYLE_ID,
} from '../../../shared/injection-constants';
import type { WallpaperRenderOptions } from '../../../shared/types';
import { getImageBlobThresholdBytes } from '../../config/settings';
import type { CdpSession } from '../cdp-client';
import { WALLPAPER_TRANSPARENCY_CSS } from './constants';
import { buildMediaElementCss, buildTileContainerCss } from './css-render';
import { buildWallpaperGuardJs } from './guard';
import { applyPunchThrough, verifyWallpaperVisibility } from './punch-through';
import { buildParallaxJs, bypassPageCsp, evaluateWithRetry, imageMimeForPath } from './shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max image size for blob injection. Larger images are streamed from the
 *  loopback HTTP media server instead (see {@link injectImageWallpaperByUrl}
 *  + the image branch in wallpaper-injector.ts). */
const MAX_IMAGE_BLOB_BYTES: number = getImageBlobThresholdBytes();

// ---------------------------------------------------------------------------
// Image wallpaper injection (base64 path — local file)
// ---------------------------------------------------------------------------

interface InjectImageWallpaperOptions {
  /** Absolute path to the image file. */
  imagePath: string;
  /** Scrim opacity 0-100 (default 45). */
  scrimOpacity?: number;
  /** Skip the size check and inject regardless of file size. Used by the
   *  HTTP stream fallback path in wallpaper-injector.ts when the loopback
   *  URL was blocked by CSP — better to risk a large base64 transfer than
   *  show no wallpaper at all. Default false. */
  forceInject?: boolean;
  /** 渲染设置（对齐/位置/翻转/滤镜/视差/tile）。默认空 = 历史行为
   *  （fill=cover、居中、无翻转、无滤镜、无视差）。 */
  render?: WallpaperRenderOptions;
}

/**
 * Inject a full-bleed static image wallpaper into an agent's page via CDP.
 * The image sits at z-index -2 (behind the art layer at -1) with a
 * readability scrim overlay. Best-effort: returns false on failure.
 */
export async function injectImageWallpaper(
  session: CdpSession,
  options: InjectImageWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { imagePath, scrimOpacity = 45, forceInject = false, render } = options;
  try {
    // Fast-fail check: determine file size before reading into memory.
    // forceInject skips this check — used by the HTTP stream fallback path
    // where the image is larger than the normal blob threshold but we'd
    // rather risk a large base64 transfer than show no wallpaper at all.
    const statInfo = await stat(imagePath);
    if (!forceInject && statInfo.size > MAX_IMAGE_BLOB_BYTES) {
      return { ok: false, verdict: 'oversize' };
    }
    const buf = await readFile(imagePath);
    const base64 = buf.toString('base64');
    const mime = imageMimeForPath(imagePath);

    // Disable CSP so the assembled data: URL loads regardless of img-src.
    // Even though data: URLs are inline (not fetched), some agents with
    // strict img-src 'self' policies block data: URLs too. This was missing
    // from the image path (video and image-by-URL both had bypassPageCsp),
    // causing image wallpapers to fail silently on agents with strict CSP
    // while video wallpapers on the same agents succeeded.
    await bypassPageCsp(session);

    // Use querySelectorAll rather than getElementById — the latter only
    // returns the first matching element. If the DOM has duplicate IDs
    // (historical injection remnants, or elements re-inserted by the
    // MutationObserver guard), getElementById would miss them. Duplicate
    // scrim overlays cause the wallpaper to be over-darkened (two 0.45
    // scrums stacked = 0.70, wallpaper nearly invisible).
    await session.evaluate(`(() => {
      // Step 1: clean up existing wallpaper and initialize chunk accumulator.
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      document.querySelectorAll('[id="${WALLPAPER_CONTAINER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_GUARD_ID}"]').forEach(function(el){ el.remove(); });
      window.${WALLPAPER_CHUNKS_GLOBAL} = [];
      return 'init';
    })()`);

    // Step 2: transfer base64 in chunks (~2 MB each) to avoid a single
    // massive CDP payload that can exceed message-size limits.
    const totalChunks = Math.ceil(base64.length / WALLPAPER_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64.slice(i * WALLPAPER_CHUNK_SIZE, (i + 1) * WALLPAPER_CHUNK_SIZE);
      await evaluateWithRetry(
        session,
        `(() => {
        if (!window.${WALLPAPER_CHUNKS_GLOBAL}) {
          window.${WALLPAPER_CHUNKS_GLOBAL} = [];
        }
        window.${WALLPAPER_CHUNKS_GLOBAL}.push(${JSON.stringify(chunk)});
      })()`,
        `image-chunk-${i}/${totalChunks}`,
      );
    }

    // Use data: URL rather than blob: URL — VSCode-fork applications
    // (traework/qoderwork) use the vscode-file:// webview protocol.
    // URL.createObjectURL(blob) generates a blob URL that gets mangled into
    // "blob:vscode-file://vscode-app/..." which <img> cannot parse/load,
    // causing wallpaper injection to succeed but be invisible.
    // data: URLs are self-contained, not affected by the page origin protocol,
    // and work in all Chromium contexts.
    const result = await session.evaluate(`(async () => {
      // Step 3: assemble data URL in-page, then mount the image.
      try {
        const b64 = window.${WALLPAPER_CHUNKS_GLOBAL}.join('');
        delete window.${WALLPAPER_CHUNKS_GLOBAL};
        const url = 'data:${mime};base64,' + b64;

        // Container pattern (matches desktop DynamicBackground): fixed
        // full-viewport wrapper with overflow:hidden ensures the wallpaper
        // fills exactly the visible viewport in all agent shells.
        var container = document.createElement('div');
        container.id = '${WALLPAPER_CONTAINER_ID}';
        container.style.cssText = 'position:fixed!important;inset:0!important;overflow:hidden!important;z-index:-2!important;pointer-events:none!important;';
        document.documentElement.prepend(container);

        // tile 平铺模式：把图片设到容器 background-repeat，隐藏 <img>。
        const tileCss = ${JSON.stringify(render?.alignment === 'tile' ? buildTileContainerCss('URL_PLACEHOLDER', render) : null)};
        if (tileCss) {
          container.style.setProperty('background-image', tileCss.containerBackground.replace('URL_PLACEHOLDER', url), 'important');
        }

        const img = document.createElement('img');
        img.id = '${IMAGE_WALLPAPER_ID}';
        img.src = url;
        img.setAttribute('aria-hidden', 'true');
        img.style.cssText = ${JSON.stringify(buildMediaElementCss(render))};
        if (tileCss) img.style.setProperty('opacity', '0', 'important');
        container.appendChild(img);
        // opacity stays 0 until the image loads (see load handler below).
        // Previously, requestAnimationFrame set opacity:1 immediately — a
        // failed load (CSP block, corrupt base64, unsupported format) showed
        // a "broken image" icon on a white background for up to 8s.

        const scrim = document.createElement('div');
        scrim.id = '${IMAGE_SCRIM_ID}';
        scrim.style.cssText = 'position:absolute!important;inset:0!important;pointer-events:none!important;background:rgba(0,0,0,${(scrimOpacity / 100).toFixed(2)})!important;opacity:0;transition:opacity 0.3s ease;';
        container.appendChild(scrim);

        const style = document.createElement('style');
        style.id = '${WALLPAPER_STYLE_ID}';
        style.textContent = ${JSON.stringify(WALLPAPER_TRANSPARENCY_CSS)};
        document.head.appendChild(style);

        const guard = document.createElement('script');
        guard.id = '${WALLPAPER_GUARD_ID}';
        guard.textContent = ${JSON.stringify(buildWallpaperGuardJs(IMAGE_WALLPAPER_ID, IMAGE_SCRIM_ID, false))};
        document.documentElement.appendChild(guard);

        // 鼠标视差（render.parallax > 0 时注入）。
        if (${JSON.stringify(!!(render && render.parallax && render.parallax > 0))}) {
          var ps = document.createElement('script');
          ps.textContent = ${JSON.stringify(render && render.parallax && render.parallax > 0 ? buildParallaxJs(render.parallax / 100) : '')};
          document.documentElement.appendChild(ps);
        }

        // Wait for the image to actually load. A blocked img-src CSP
        // (even after bypass, some agents have additional restrictions)
        // or a corrupt/unsupported image leaves the element at 0x0 with
        // an error state — without this check the wallpaper would be
        // silently invisible while the caller reports success.
        var verdict = await new Promise(function(resolve) {
          var done = false;
          function finish(v) { if (!done) { done = true; resolve(v); } }
          function reveal() {
            // tile 平铺模式：img 保持隐藏（容器 background 负责显示）。
            if (!tileCss) img.style.setProperty('opacity','1','important');
            scrim.style.setProperty('opacity','1','important');
          }
          img.addEventListener('load', function() { reveal(); finish('ok'); }, { once: true });
          img.addEventListener('error', function() {
            // Capture the precise error reason. Unlike <video>, <img> has no
            // .error.code numeric enum, but we can still distinguish a CSP
            // block (img.naturalWidth===0 && src present) from a decode
            // failure via the event. We surface the state for diagnosis.
            var detail = img.naturalWidth === 0 ? 'csp-or-unsupported' : 'unknown';
            finish('loadfail:' + detail);
          }, { once: true });
          setTimeout(function() {
            if (img.complete && img.naturalWidth > 0) { reveal(); finish('ok'); }
            else finish('loadfail:timeout(naturalWidth='+img.naturalWidth+')');
          }, 8000);
        });
        if (verdict !== 'ok') {
          img.remove();
          scrim.remove();
          style.remove();
          guard.remove();
        }
        return verdict;
      } catch(e) { return 'err:' + e.message; }
    })()`);

    await applyPunchThrough(session, 'injectImageWallpaper');

    // Post-injection visibility verification (same rationale as video).
    if (result === 'ok') {
      const vis = await verifyWallpaperVisibility(session, IMAGE_WALLPAPER_ID);
      if (!vis.visible) {
        return { ok: false, verdict: `invisible:${vis.reason}` };
      }
    }

    return { ok: result === 'ok', verdict: String(result) };
  } catch (error) {
    return {
      ok: false,
      verdict: `throw:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Image wallpaper injection (URL path — streamed from wallpaper-server)
// ---------------------------------------------------------------------------

/**
 * Inject a full-bleed static image wallpaper into an agent's page from a
 * pre-built URL (loopback http served by `wallpaper-server`). Used for
 * large images that exceed the in-page base64 blob cap. Same scrim +
 * punch-through as {@link injectImageWallpaper}; the only difference is the
 * source is an `http://127.0.0.1` URL the browser streams itself rather than
 * a `data:` URL assembled in-page.
 */
export async function injectImageWallpaperByUrl(
  session: CdpSession,
  options: { url: string; scrimOpacity?: number; render?: WallpaperRenderOptions },
): Promise<{ ok: boolean; verdict: string }> {
  const { url, scrimOpacity = 45, render } = options;
  // Basic validation: ensure url is a non-empty string before proceeding
  if (!url || typeof url !== 'string') {
    return { ok: false, verdict: 'invalid-url:empty-or-not-string' };
  }
  try {
    // Disable CSP so the loopback http URL loads regardless of img-src.
    await bypassPageCsp(session);

    await session.evaluate(`(() => {
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      document.querySelectorAll('[id="${WALLPAPER_CONTAINER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_GUARD_ID}"]').forEach(function(el){ el.remove(); });
      return 'clean';
    })()`);

    const result = await session.evaluate(`(async () => {
      try {
        // Container pattern (matches desktop DynamicBackground): fixed
        // full-viewport wrapper with overflow:hidden ensures the wallpaper
        // fills exactly the visible viewport in all agent shells.
        var container = document.createElement('div');
        container.id = '${WALLPAPER_CONTAINER_ID}';
        container.style.cssText = 'position:fixed!important;inset:0!important;overflow:hidden!important;z-index:-2!important;pointer-events:none!important;';
        document.documentElement.prepend(container);

        // tile 平铺模式：把图片设到容器 background-repeat，隐藏 <img>。
        const tileCss = ${JSON.stringify(render?.alignment === 'tile' ? buildTileContainerCss('URL_PLACEHOLDER', render) : null)};
        if (tileCss) {
          container.style.setProperty('background-image', tileCss.containerBackground.replace('URL_PLACEHOLDER', ${JSON.stringify(url)}), 'important');
        }

        const img = document.createElement('img');
        img.id = '${IMAGE_WALLPAPER_ID}';
        img.src = ${JSON.stringify(url)};
        img.setAttribute('aria-hidden', 'true');
        img.style.cssText = ${JSON.stringify(buildMediaElementCss(render))};
        if (tileCss) img.style.setProperty('opacity', '0', 'important');
        container.appendChild(img);
        // opacity stays 0 until the image loads (see load handler below).
        // Previously, requestAnimationFrame set opacity:1 immediately — a
        // failed load showed a "broken image" icon on a white background.

        const scrim = document.createElement('div');
        scrim.id = '${IMAGE_SCRIM_ID}';
        scrim.style.cssText = 'position:absolute!important;inset:0!important;pointer-events:none!important;background:rgba(0,0,0,${(scrimOpacity / 100).toFixed(2)})!important;opacity:0;transition:opacity 0.3s ease;';
        container.appendChild(scrim);

        const style = document.createElement('style');
        style.id = '${WALLPAPER_STYLE_ID}';
        style.textContent = ${JSON.stringify(WALLPAPER_TRANSPARENCY_CSS)};
        document.head.appendChild(style);

        const guard = document.createElement('script');
        guard.id = '${WALLPAPER_GUARD_ID}';
        guard.textContent = ${JSON.stringify(buildWallpaperGuardJs(IMAGE_WALLPAPER_ID, IMAGE_SCRIM_ID, false))};
        document.documentElement.appendChild(guard);

        // 鼠标视差（render.parallax > 0 时注入）。
        if (${JSON.stringify(!!(render && render.parallax && render.parallax > 0))}) {
          var ps = document.createElement('script');
          ps.textContent = ${JSON.stringify(render && render.parallax && render.parallax > 0 ? buildParallaxJs(render.parallax / 100) : '')};
          document.documentElement.appendChild(ps);
        }

        // Wait for the image to load — same rationale as injectImageWallpaper.
        var verdict = await new Promise(function(resolve) {
          var done = false;
          function finish(v) { if (!done) { done = true; resolve(v); } }
          function reveal() {
            if (!tileCss) img.style.setProperty('opacity','1','important');
            scrim.style.setProperty('opacity','1','important');
          }
          img.addEventListener('load', function() { reveal(); finish('ok'); }, { once: true });
          img.addEventListener('error', function() {
            var detail = img.naturalWidth === 0 ? 'csp-or-unsupported' : 'unknown';
            finish('loadfail:' + detail);
          }, { once: true });
          setTimeout(function() {
            if (img.complete && img.naturalWidth > 0) { reveal(); finish('ok'); }
            else finish('loadfail:timeout(naturalWidth='+img.naturalWidth+')');
          }, 8000);
        });
        if (verdict !== 'ok') {
          img.remove();
          scrim.remove();
          style.remove();
          guard.remove();
        }
        return verdict;
      } catch(e) { return 'err:' + e.message; }
    })()`);

    await applyPunchThrough(session, 'injectImageWallpaperByUrl');

    // Post-injection visibility verification (same rationale as video).
    if (result === 'ok') {
      const vis = await verifyWallpaperVisibility(session, IMAGE_WALLPAPER_ID);
      if (!vis.visible) {
        return { ok: false, verdict: `invisible:${vis.reason}` };
      }
    }

    return { ok: result === 'ok', verdict: String(result) };
  } catch (error) {
    return {
      ok: false,
      verdict: `throw:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
