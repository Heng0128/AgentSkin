// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/video-injector
 *
 * Video wallpaper injection strategies via CDP. Two entry points:
 *
 *   - {@link injectVideoWallpaper} — mount a video from a URL already playable
 *     inside the agent page (loopback http URL served by `wallpaper-server`,
 *     or a `blob:` URL). Preferred for large files because the browser
 *     streams the media itself instead of ballooning the agent's JS heap.
 *   - {@link injectVideoWallpaperByBase64} — chunked base64 transfer that
 *     reassembles a data: URL inside the agent page. Fallback for small files
 *     and when the local HTTP server is unavailable.
 *
 * Both share {@link mountVideoWallpaper} for the actual DOM mounting (video
 * element + scrim + transparency style + MutationObserver guard) and the
 * load-watchdog that verifies the media actually starts playing.
 *
 * Uses shared helpers from {@link ./shared}: {@link bypassPageCsp} (CSP
 * bypass before mounting), {@link evaluateWithRetry} (chunked transfer
 * retry), {@link applyPunchThrough} (neutralize opaque agent shell).
 */

import { readFile } from 'node:fs/promises';
import {
  IMAGE_SCRIM_ID,
  IMAGE_WALLPAPER_ID,
  MAX_VIDEO_BLOB_BYTES,
  VIDEO_SCRIM_ID,
  VIDEO_WALLPAPER_ID,
  WALLPAPER_CHUNK_SIZE,
  WALLPAPER_CHUNKS_GLOBAL,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_DATA_URL_GLOBAL,
  WALLPAPER_GUARD_ID,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_STYLE_ID,
} from '../../../shared/injection-constants';
import type { WallpaperRenderOptions } from '../../../shared/types';
import type { CdpSession } from '../cdp-client';
import { WALLPAPER_TRANSPARENCY_CSS } from './constants';
import { buildMediaElementCss } from './css-render';
import { buildWallpaperGuardJs } from './guard';
import { applyPunchThrough, verifyWallpaperVisibility } from './punch-through';
import { buildParallaxJs, bypassPageCsp, evaluateWithRetry, videoMimeForPath } from './shared';

// ---------------------------------------------------------------------------
// Shared video mount (URL already valid inside the agent page)
// ---------------------------------------------------------------------------

interface MountVideoArgs {
  src: string;
  mime: string;
  speed: number;
  loop: boolean;
  scrimOpacity: number;
  /** 渲染设置（对齐/位置/翻转/滤镜/视差）。默认空 = 历史行为。 */
  render?: WallpaperRenderOptions;
  /**
   * Window global holding the fully-assembled media URL. When set, the mount
   * reads `window[srcGlobal]` in-page instead of embedding `src` into the
   * evaluate expression. Used by {@link injectVideoWallpaperByBase64} so the
   * multi-MB data: URL never crosses CDP as a return value (a 100MB+ return
   * can exceed the 8s command timeout and fail large library videos that fell
   * back from the HTTP stream path).
   */
  srcGlobal?: string;
}

/**
 * Mount a video wallpaper whose `src` is already a playable URL in the agent
 * page (loopback http URL or `blob:` URL). Creates the fixed full-bleed
 * `<video>`, the readability scrim, the transparency style, and a
 * MutationObserver that re-inserts the wallpaper if React destroys it.
 *
 * Returns the load verdict ('ok' | 'loadfail' | string) so callers can log
 * the precise failure reason instead of a generic boolean.
 */
async function mountVideoWallpaper(
  session: CdpSession,
  { src, mime, speed, loop, scrimOpacity, render, srcGlobal }: MountVideoArgs,
): Promise<{ ok: boolean; verdict: string }> {
  try {
    // Security check: ensure src does not contain quote characters that
    // could break the evaluate template string. Skipped for the srcGlobal
    // path — the URL is assembled in-page from base64 chunks (charset-safe
    // by construction) and never interpolated into an evaluate expression.
    if (!srcGlobal && (src.includes("'") || src.includes('"'))) {
      throw new Error('Invalid wallpaper URL: contains unescaped quote character');
    }
    // Disable CSP so `blob:` and `http://127.0.0.1` media sources load
    // regardless of the agent's media-src directive. Without this, every
    // agent renderer (Doubao/TRAE/QoderWork/WorkBuddy) blocks the wallpaper
    // media element and the load-watchdog reports 'loadfail'.
    const cspOk = await bypassPageCsp(session);
    if (!cspOk) {
      // Log warning but proceed — some agents may still allow the media
      // through their own CSP exceptions or service-worker overrides.
    }

    // Step 1: clean up any existing wallpaper elements + observer.
    await session.evaluate(`(() => {
      document.querySelectorAll('[id="${WALLPAPER_CONTAINER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${IMAGE_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_GUARD_ID}"]').forEach(function(el){ el.remove(); });
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      return 'clean';
    })()`);

    // Step 2: mount the video (src is injected as a JSON-encoded string so
    // any URL characters are safely escaped).
    const result = await session.evaluate(`(async () => {
      try {
        // Container pattern (matches desktop DynamicBackground): a fixed
        // full-viewport wrapper with overflow:hidden clips any overflow, and
        // the media is absolutely positioned inside. This guarantees correct
        // positioning across all agent shells regardless of containing-block
        // quirks (transform/contain/filter on ancestors).
        var container = document.createElement('div');
        container.id = '${WALLPAPER_CONTAINER_ID}';
        container.style.cssText = 'position:fixed!important;inset:0!important;overflow:hidden!important;z-index:-2!important;pointer-events:none!important;';
        document.documentElement.prepend(container);

        const video = document.createElement('video');
        video.id = '${VIDEO_WALLPAPER_ID}';
        ${
          srcGlobal
            ? `var srcValue = window['${srcGlobal}'];
        if (!srcValue) throw new Error('no assembled data url');
        video.src = srcValue;
        try { delete window['${srcGlobal}']; } catch(e) {}`
            : `video.src = ${JSON.stringify(src)};`
        }
        video.type = '${mime}';
        video.autoplay = true;
        video.loop = ${loop};
        video.muted = true;
        video.playsInline = true;
        video.playbackRate = ${speed};
        video.setAttribute('disablepictureinpicture', '');
        video.style.cssText = ${JSON.stringify(buildMediaElementCss(render))};
        container.appendChild(video);

        // opacity stays 0 until the media loads (see onOk/timeout below).
        // Previously, requestAnimationFrame set opacity:1 immediately — if
        // the video failed to load (CSP block, codec issue, corrupt data),
        // the browser showed a "broken media" icon on a white background for
        // 8-12 seconds when loading fails.
        const scrim = document.createElement('div');
        scrim.id = '${VIDEO_SCRIM_ID}';
        scrim.style.cssText = 'position:absolute!important;inset:0!important;pointer-events:none!important;background:rgba(0,0,0,${(scrimOpacity / 100).toFixed(2)})!important;opacity:0;transition:opacity 0.3s ease;';
        container.appendChild(scrim);

        const style = document.createElement('style');
        style.id = '${WALLPAPER_STYLE_ID}';
        style.textContent = ${JSON.stringify(WALLPAPER_TRANSPARENCY_CSS)};
        document.head.appendChild(style);

        const guard = document.createElement('script');
        guard.id = '${WALLPAPER_GUARD_ID}';
        guard.textContent = ${JSON.stringify(buildWallpaperGuardJs(VIDEO_WALLPAPER_ID, VIDEO_SCRIM_ID, true))};
        document.documentElement.appendChild(guard);

        // 鼠标视差（render.parallax > 0 时注入）。
        if (${JSON.stringify(!!(render?.parallax && render.parallax > 0))}) {
          var ps = document.createElement('script');
          ps.textContent = ${JSON.stringify(render?.parallax && render.parallax > 0 ? buildParallaxJs(render.parallax / 100) : '')};
          document.documentElement.appendChild(ps);
        }

        video.play().catch(() => {});

        // Expose a global pause/resume hook so the AgentSkin main process can
        // suspend decoding (e.g. on system suspend / battery) without tearing
        // down the wallpaper. See wallpaper-lifecycle.ts.
        window.AGENTSKIN_WP_PAUSE = function(p){
          try {
            var vid = document.getElementById('${VIDEO_WALLPAPER_ID}');
            if (!vid) return;
            p ? vid.pause() : vid.play().catch(function(){});
          } catch(e) {}
        };

        // Verify the media actually begins loading. A blocked media-src CSP
        // (or a bad/unsupported URL) leaves the element at readyState 0 with
        // networkState NO_SOURCE / an error — without this check the wallpaper
        // would be silently invisible while the caller reports success.
        const verdict = await new Promise((resolve) => {
          let settled = false;
          const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
          // 12s watchdog: large videos (especially HEVC/4K) streamed over
          // loopback HTTP may take several seconds to buffer enough data for
          // loadedmetadata. The previous 7s watchdog was too short for
          // 100MB+ files on slower machines, causing false 'loadfail'
          // verdicts that triggered the base64 fallback path which then
          // also timed out (CDP command timeout). 12s gives the browser's
          // media stack enough time to demux the first frame.
          const WATCHDOG_MS = 12000;
          var errDetail = '';
          const onOk = () => { video.style.setProperty('opacity','1','important'); scrim.style.setProperty('opacity','1','important'); finish('ok'); };
          const onErr = () => {
            // Capture the precise error code so the caller can distinguish
            // codec issues (MEDIA_ERR_DECODE) from network/CSP issues
            // (MEDIA_ERR_SRC_NOT_SUPPORTED) etc.
            var codes = {1:'aborted',2:'network',3:'decode',4:'src-not-supported'};
            var c = video.error ? codes[video.error.code] || ('code:'+video.error.code) : 'no-error-obj';
            errDetail = c;
            finish('loadfail:' + c);
          };
          video.addEventListener('loadedmetadata', onOk, { once: true });
          video.addEventListener('loadeddata', onOk, { once: true });
          video.addEventListener('canplay', onOk, { once: true });
          video.addEventListener('playing', onOk, { once: true });
          video.addEventListener('error', onErr, { once: true });
          setTimeout(() => {
            if (video.readyState >= 1 || video.networkState === 2) { video.style.setProperty('opacity','1','important'); scrim.style.setProperty('opacity','1','important'); finish('ok'); }
            else finish('loadfail:timeout(rs='+video.readyState+',ns='+video.networkState+')');
          }, WATCHDOG_MS);
        });

        // On failure, tear down the dead element so a retry (or the absence of
        // one) doesn't leave a stuck invisible <video> spewing console errors.
        if (verdict !== 'ok') {
          // P1 perf: revoke any blob: URL so the browser can release the
          // backing memory. A failed injection that doesn't revoke leaks the
          // blob (often 50-200MB) until the agent process exits. Only blob:
          // URLs need revocation — http(s): URLs are served by the loopback
          // server and are stateless.
          try {
            if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
          } catch (e) {}
          video.remove();
          scrim.remove();
          style.remove();
          guard.remove();
        }
        return verdict;
      } catch(e) { return 'err:' + e.message; }
    })()`);

    // Punch through any opaque full-bleed agent shell so the wallpaper is
    // actually visible (the media sits at z-index:-2 behind the agent UI).
    await applyPunchThrough(session, 'mountVideoWallpaper');

    // Post-injection visibility verification: the load-watchdog 'ok' only
    // confirms the media element loaded — NOT that it's visible. If the
    // punch-through failed or React removed the element, report failure so
    // the fallback mechanism can fire.
    if (result === 'ok') {
      const vis = await verifyWallpaperVisibility(session, VIDEO_WALLPAPER_ID);
      if (!vis.visible) {
        return { ok: false, verdict: `invisible:${vis.reason}` };
      }
    }

    const ok = result === 'ok';
    return { ok, verdict: String(result) };
  } catch (error) {
    return {
      ok: false,
      verdict: `throw:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Video wallpaper injection public entry points
// ---------------------------------------------------------------------------

interface InjectVideoWallpaperOptions {
  /** A URL already playable inside the agent page: a loopback http URL
   *  (streamed, low renderer memory) or a `blob:` URL assembled in-page. */
  src: string;
  /** MIME type of the media (used for the `<video type>` hint). */
  mime: string;
  /** Playback speed multiplier (default 1.0). */
  speed?: number;
  /** Whether to loop (default true). */
  loop?: boolean;
  /** Scrim opacity 0-100 (default 55). */
  scrimOpacity?: number;
  /** 渲染设置（对齐/位置/翻转/滤镜/视差）。默认空 = 历史行为。 */
  render?: WallpaperRenderOptions;
}

/**
 * Mount a video wallpaper from a pre-built URL (loopback http or blob).
 * This is the low-memory path used for large videos streamed from
 * `wallpaper-server`. Returns the verdict so the caller can log the precise
 * failure reason when `ok` is false.
 */
export async function injectVideoWallpaper(
  session: CdpSession,
  options: InjectVideoWallpaperOptions,
): Promise<{ ok: boolean; verdict: string }> {
  const { src, mime, speed = 1, loop = true, scrimOpacity = 55, render } = options;
  return mountVideoWallpaper(session, { src, mime, speed, loop, scrimOpacity, render });
}

interface InjectVideoWallpaperByBase64Options {
  /** Absolute path to the video file. */
  videoPath: string;
  /** Playback speed multiplier (default 1.0). */
  speed?: number;
  /** Whether to loop (default true). */
  loop?: boolean;
  /** Scrim opacity 0-100 (default 55). */
  scrimOpacity?: number;
  /** 渲染设置（对齐/位置/翻转/滤镜/视差）。默认空 = 历史行为。 */
  render?: WallpaperRenderOptions;
}

/**
 * Legacy / fallback video injection: read the file, transfer it as chunked
 * base64 through CDP, and reassemble a data: URL in the agent page. Used for
 * small files and whenever the local HTTP server is unavailable. Note this
 * keeps the full file in the agent's JS heap — prefer {@link injectVideoWallpaper}
 * with a streamed URL for large videos. Returns the verdict so callers can
 * log the precise failure reason.
 */
export async function injectVideoWallpaperByBase64(
  session: CdpSession,
  options: InjectVideoWallpaperByBase64Options,
): Promise<{ ok: boolean; verdict: string }> {
  const { videoPath, speed = 1, loop = true, scrimOpacity = 55, render } = options;
  try {
    const stat = await readFile(videoPath);
    if (stat.length > MAX_VIDEO_BLOB_BYTES) {
      return { ok: false, verdict: `oversize:${stat.length}>${MAX_VIDEO_BLOB_BYTES}` };
    }
    const base64 = stat.toString('base64');
    const mime = videoMimeForPath(videoPath);

    // Disable CSP so the assembled data: URL loads regardless of media-src.
    await bypassPageCsp(session);

    // Step 1: clean up existing wallpaper and initialize chunk accumulator.
    // Use querySelectorAll to clean up all duplicate-id elements (see
    // injectImageWallpaper comments in image-injector.ts).
    await session.evaluate(`(() => {
      document.querySelectorAll('[id="${VIDEO_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${VIDEO_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_GUARD_ID}"]').forEach(function(el){ el.remove(); });
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      window.${WALLPAPER_CHUNKS_GLOBAL} = [];
      return 'init';
    })()`);

    // Step 2: transfer base64 in chunks (~2 MB each).
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
        `video-chunk-${i}/${totalChunks}`,
      );
    }

    // Assemble the data: URL IN-PAGE (mirroring the image path) instead of
    // returning the multi-MB URL through CDP. A 100MB+ base64 return value
    // can exceed the 8s command timeout (and the CDP message-size limits),
    // failing large library videos that fell back from the HTTP stream. The
    // assembled URL is stashed on a window global; mountVideoWallpaper reads
    // it there (via srcGlobal) and deletes it after wiring video.src.
    const assembled = await session.evaluate(`(() => {
      try {
        const b64 = window.${WALLPAPER_CHUNKS_GLOBAL}.join('');
        delete window.${WALLPAPER_CHUNKS_GLOBAL};
        window.${WALLPAPER_DATA_URL_GLOBAL} = 'data:${mime};base64,' + b64;
        return 'ok';
      } catch (e) { return 'err:' + e.message; }
    })()`);
    if (assembled !== 'ok') return { ok: false, verdict: `assemble-failed:${assembled}` };
    return mountVideoWallpaper(session, {
      src: '',
      srcGlobal: WALLPAPER_DATA_URL_GLOBAL,
      mime,
      speed,
      loop,
      scrimOpacity,
      render,
    });
  } catch (error) {
    return {
      ok: false,
      verdict: `throw:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
