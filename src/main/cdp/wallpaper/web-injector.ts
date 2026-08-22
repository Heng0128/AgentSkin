// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/web-injector
 *
 * Web / scene wallpaper injection via CDP. Uses an `<iframe>` to load a URL
 * (typically a loopback http URL served by `wallpaper-server` that hosts an
 * animated scene / HTML+JS wallpaper). The iframe sits at z-index -2 behind
 * the readability scrim at -1.
 *
 * The iframe sandbox includes `allow-scripts allow-same-origin` so the web
 * wallpaper can execute its own JavaScript (canvas animations, WebGL scenes,
 * etc.). CSP is bypassed first so the loopback http URL loads regardless of
 * the agent's frame-src / child-src directives.
 *
 * A load-watchdog verifies the iframe actually loads before reporting
 * success — if the content URL is blocked by CSP or the media server returns
 * an error, the load event never fires and we return false instead of
 * reporting success on an empty (black-screen) iframe.
 *
 * Uses shared helpers from {@link ./shared}: {@link bypassPageCsp} (CSP
 * bypass before mounting), {@link applyPunchThrough} (neutralize opaque
 * agent shell).
 */

import {
  IMAGE_SCRIM_ID,
  IMAGE_WALLPAPER_ID,
  VIDEO_SCRIM_ID,
  VIDEO_WALLPAPER_ID,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_DATA_URL_GLOBAL,
  WALLPAPER_GUARD_ID,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_STYLE_ID,
  WEB_SCRIM_ID,
  WEB_WALLPAPER_ID,
} from '../../../shared/injection-constants';
import type { WallpaperRenderOptions } from '../../../shared/types';
import type { CdpSession } from '../cdp-client';
import { WALLPAPER_TRANSPARENCY_CSS } from './constants';
import { buildFilter, buildFlipTransform } from './css-render';
import { buildWallpaperGuardJs } from './guard';
import { applyPunchThrough, verifyWallpaperVisibility } from './punch-through';
import { buildWpSignalBridgeJs, bypassPageCsp } from './shared';

// ---------------------------------------------------------------------------
// Web / scene wallpaper injection (iframe-based)
// ---------------------------------------------------------------------------

/** Build the iframe-extra CSS suffix (filter + flip) from render options.
 *  iframes have no object-fit concept (they stretch full-bleed), so only
 *  the outer-frame filter and flip apply here. */
function iframeExtras(render: WallpaperRenderOptions | undefined): string {
  if (!render) return '';
  const filter = buildFilter(render);
  const flip = buildFlipTransform(render);
  return (
    (filter ? `filter:${filter}!important;` : '') + (flip ? `transform:${flip}!important;` : '')
  );
}

interface InjectWebWallpaperOptions {
  /** The URL to load in the iframe (loopback HTTP URL served by
   *  wallpaper-server that hosts an animated scene / HTML+JS wallpaper). */
  url: string;
  /** Scrim opacity 0-100 (default 45). */
  scrimOpacity?: number;
  /** 渲染设置。iframe 无 object-fit 概念（拉伸铺满），只应用外框级别的
   *  滤镜（filter）+ 翻转（transform）—— 对齐/位置对 web 壁纸不适用，
   *  保持拉伸铺满。 */
  render?: WallpaperRenderOptions;
}

/**
 * Inject a full-bleed web/scene wallpaper into an agent's page via an iframe.
 * The iframe loads the provided URL (typically a loopback http URL served by
 * wallpaper-server that hosts an animated scene / HTML+JS wallpaper). The
 * iframe sits at z-index -2 behind the readability scrim at -1.
 *
 * The iframe sandbox includes `allow-scripts allow-same-origin` so the web
 * wallpaper can execute its own JavaScript (canvas animations, WebGL scenes,
 * etc.). CSP is bypassed first so the loopback http URL loads regardless of
 * the agent's frame-src / child-src directives.
 *
 * Same scrim + punch-through pattern as image/video injection.
 * Best-effort: returns false on failure.
 */
export async function injectWebWallpaper(
  session: CdpSession,
  options: InjectWebWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { url, scrimOpacity = 45, render } = options;
  // Basic validation: ensure url is a non-empty string before proceeding
  if (!url || typeof url !== 'string') {
    return { ok: false, verdict: 'invalid-url:empty-or-not-string' };
  }
  try {
    // Disable CSP so the loopback http URL loads regardless of frame-src.
    await bypassPageCsp(session);

    // Step 1: clean up any existing wallpaper elements (video, image, web).
    // Use querySelectorAll (not getElementById) to catch duplicate elements
    // left over from previous injections or re-inserted by the guard.
    await session.evaluate(`(() => {
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      document.querySelectorAll('[id="${WALLPAPER_CONTAINER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WEB_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WEB_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_GUARD_ID}"]').forEach(function(el){ el.remove(); });
      return 'clean';
    })()`);

    // Step 2: mount the iframe, scrim, style, and guard. The URL is stashed
    // on a window global first and read in-page — scene wallpaper HTML can be
    // tens of MB (base64 textures embedded in the document), and interpolating
    // it into the evaluate expression risks exceeding CDP message-size limits
    // and the 8s command timeout. Wait for the iframe's load event before
    // reporting success — if the content URL is blocked by CSP (bypass may not
    // work on all targets) or the media server returns an error, the load
    // event never fires and we return false instead of reporting success on an
    // empty (black-screen) iframe.
    await session.evaluate(`(() => {
      window['${WALLPAPER_DATA_URL_GLOBAL}'] = ${JSON.stringify(url)};
      return 'stashed';
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

        const iframe = document.createElement('iframe');
        iframe.id = '${WEB_WALLPAPER_ID}';
        ${`var webSrc = window['${WALLPAPER_DATA_URL_GLOBAL}'];
        if (!webSrc) throw new Error('no assembled web url');
        iframe.src = webSrc;
        try { delete window['${WALLPAPER_DATA_URL_GLOBAL}']; } catch(e) {}`}
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:absolute!important;inset:0!important;width:100%!important;height:100%!important;border:none!important;pointer-events:none!important;' + ${JSON.stringify(iframeExtras(render))};
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        container.appendChild(iframe);

        const scrim = document.createElement('div');
        scrim.id = '${WEB_SCRIM_ID}';
        scrim.style.cssText = 'position:absolute!important;inset:0!important;pointer-events:none!important;background:rgba(0,0,0,${(scrimOpacity / 100).toFixed(2)})!important;opacity:0;transition:opacity 0.3s ease;';
        // opacity stays 0 until the iframe loads (see load handler below).
        container.appendChild(scrim);

        const style = document.createElement('style');
        style.id = '${WALLPAPER_STYLE_ID}';
        style.textContent = ${JSON.stringify(WALLPAPER_TRANSPARENCY_CSS)};
        document.head.appendChild(style);

        const guard = document.createElement('script');
        guard.id = '${WALLPAPER_GUARD_ID}';
        guard.textContent = ${JSON.stringify(buildWallpaperGuardJs(WALLPAPER_CONTAINER_ID, WEB_SCRIM_ID, false))};
        document.documentElement.appendChild(guard);

        // Wait for the iframe to load (or timeout). The load event fires
        // when the response is received — for cross-origin iframes we can't
        // inspect contentDocument, but the absence of a load event within
        // the timeout indicates CSP blocking or server unreachable.
        var loadOk = await new Promise(function(resolve) {
          var done = false;
          function finish(v) { if (!done) { done = true; if (v === 'ok') scrim.style.setProperty('opacity','1','important'); resolve(v); } }
          iframe.addEventListener('load', function() { finish('ok'); }, { once: true });
          iframe.addEventListener('error', function() { finish('loadfail:error'); }, { once: true });
          setTimeout(function() {
            // Check if the iframe has any content at all. For same-origin
            // iframes we can inspect contentDocument; for cross-origin we
            // check readyState as a best-effort signal.
            // 12s timeout: scene wallpapers embed all textures as base64
            // data URLs in the HTML document. Large scenes (50+ textures)
            // can take 8-10s to decode on slower machines. 8s was too
            // short, causing false 'loadfail:timeout' that triggered
            // unnecessary retries.
            try {
              if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') finish('ok');
              else finish('loadfail:timeout');
            } catch(e) {
              // Cross-origin: can't access contentDocument. If the load
              // event hasn't fired, assume failure.
              finish('loadfail:timeout');
            }
          }, 12000);
        });

        if (loadOk !== 'ok') {
          // Don't remove the iframe — the load may still succeed after the
          // timeout (e.g. slow network). But report the failure so the
          // caller knows the content may not be visible yet.
          return loadOk;
        }
        return 'ok';
      } catch(e) { return 'err:' + e.message; }
    })()`);

    // Install the signal bridge (mousemove + audio forwarding into the
    // iframe) so scene/web wallpapers receive pointer parallax and audio
    // levels even though the iframe is pointer-events:none.
    await session.evaluate(
      `${buildWpSignalBridgeJs()}; return window.__agentskinWpBridge ? 'bridge-installed' : 'bridge-failed';`,
    );

    await applyPunchThrough(session, 'injectWebWallpaper');

    // Post-injection visibility verification (same rationale as video/image).
    if (result === 'ok') {
      const vis = await verifyWallpaperVisibility(session, WEB_WALLPAPER_ID);
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
