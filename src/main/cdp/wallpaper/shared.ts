// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/shared
 *
 * Barrel module: re-exports the public API of the wallpaper sub-modules
 * and owns the functions that don't fit a dedicated module:
 *   - Retry (`evaluateWithRetry`) for chunked CDP evaluate calls.
 *   - MIME detection (`videoMimeForPath`, `imageMimeForPath`).
 *   - CSP bypass (`bypassPageCsp`).
 *   - Mouse parallax (`buildParallaxJs`).
 *   - Signal bridge (`buildWpSignalBridgeJs`).
 *   - Combined removal (`removeAllWallpapers`).
 *
 * For the focused sub-modules, see:
 *   - {@link ./constants}       — shared window property names + transparency CSS
 *   - {@link ./css-render}      — CSS render-option → style builders
 *   - {@link ./guard}           — enhanced wallpaper guard script builder
 *   - {@link ./punch-through}   — punch-through, teardown, visibility verification
 */

import {
  IMAGE_SCRIM_ID,
  IMAGE_WALLPAPER_ID,
  VIDEO_SCRIM_ID,
  VIDEO_WALLPAPER_ID,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_GUARD_ID,
  WALLPAPER_HEAL_GLOBAL,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_RESIZE_GLOBAL,
  WALLPAPER_STYLE_ID,
  WEB_SCRIM_ID,
  WEB_WALLPAPER_ID,
} from '../../../shared/injection-constants';
import type { CdpSession } from '../cdp-client';
import { WALLPAPER_BRIDGE_GLOBAL, WALLPAPER_MESSAGE_NS } from './constants';
import { WALLPAPER_PUNCH_TEARDOWN_JS } from './punch-through';

// ===========================================================================
// Re-exports — sub-module public API (preserves existing import contracts)
// ===========================================================================

// constants
export {
  WALLPAPER_BRIDGE_GLOBAL,
  WALLPAPER_PUNCH_CLASS,
  WALLPAPER_PUNCH_GLOBAL,
  WALLPAPER_PUNCH_STYLE_ID,
  WALLPAPER_TRANSPARENCY_CSS,
} from './constants';
// css-render
export {
  alignmentObjectFit,
  buildFilter,
  buildFlipTransform,
  buildMediaElementCss,
  buildObjectPosition,
  buildTileContainerCss,
  buildTintFilter,
  hexHue,
} from './css-render';
// guard
export { buildWallpaperGuardJs } from './guard';
// punch-through
export {
  applyPunchThrough,
  verifyWallpaperVisibility,
  WALLPAPER_PUNCH_TEARDOWN_JS,
} from './punch-through';

// ===========================================================================
// Retry helper for chunked CDP evaluate calls
// ===========================================================================

/**
 * Maximum retry attempts for a single chunked `session.evaluate` call.
 *
 * Chunked base64 transfer issues many sequential evaluate calls (~2 MB each).
 * Under load (agent still booting, GC pressure, multiple targets being
 * injected), individual calls can exceed the 8s command timeout or hit a
 * transient "WebSocket closed unexpectedly" when the agent reloads mid-
 * transfer. Without retry, a single timeout aborts the entire wallpaper
 * injection — the dominant source of "blob:throw:CDP request timed out" in
 * production logs (27 occurrences in a single day).
 *
 * 3 total attempts (1 initial + 2 retries) with 1s backoff balances
 * resilience against total wall-clock cost: worst case adds ~2s to a
 * transfer that was already going to fail, but salvages the common case
 * where the first attempt raced a transient.
 */
const CHUNK_EVAL_MAX_RETRIES = 2;
const CHUNK_EVAL_RETRY_DELAY_MS = 1000;

/**
 * Wrap a `session.evaluate` call with retry logic. Retries only on
 * transport-level failures (timeout, socket closed) — renderer exceptions
 * (syntax errors, reference errors) are re-thrown immediately because they
 * indicate a real bug in the injected script, not a transient glitch.
 *
 * Returns the evaluate result string, or throws the last error if all
 * attempts fail.
 *
 * Exported for unit testing (retry behavior is best tested in isolation
 * rather than through the full injection pipeline).
 */
export async function evaluateWithRetry(
  session: CdpSession,
  expression: string,
  _label?: string,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= CHUNK_EVAL_MAX_RETRIES; attempt++) {
    try {
      return await session.evaluate(expression);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      // Renderer exceptions indicate a real bug in the injected script —
      // retrying won't help. Re-throw so the caller sees the actual error.
      if (msg.includes('Renderer evaluation failed')) throw error;
      // Transport-level failure (timeout, socket closed) — retry if we
      // haven't exhausted attempts.
      if (attempt < CHUNK_EVAL_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, CHUNK_EVAL_RETRY_DELAY_MS));
        // Brief delay before retry; the agent may be recovering from a
        // reload or GC pause.
      }
    }
  }
  throw lastError;
}

// ===========================================================================
// MIME type detection
// ===========================================================================

/** Derive a video MIME type from a file path's extension. */
export function videoMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

/** Derive a static-image MIME type from a file path's extension. */
export function imageMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

// ===========================================================================
// CSP bypass
// ===========================================================================

/**
 * Three-layer CSP bypass for injecting media into agent pages.
 *
 * Layer 1: Page.setBypassCSP (CDP-level, works on main pages)
 * Layer 2: Remove runtime CSP meta tags injected by SPA navigation
 * Layer 3: Diagnostic probe — checks whether CSP is actually active;
 *          does NOT bypass anything, only provides diagnostic context.
 *
 * Returns true when at least one bypass layer (1 or 2) succeeded.
 */
export async function bypassPageCsp(session: CdpSession): Promise<boolean> {
  let anySucceeded = false;

  // Layer 1: CDP Page.setBypassCSP
  try {
    await session.send('Page.enable');
    await session.send('Page.setBypassCSP', { enabled: true });
    anySucceeded = true;
  } catch (error) {
    // Not supported on this target (webview, service worker page, etc.)
    // Log so CSP-bypass failures are traceable — a silent failure here can
    // mask the root cause of downstream "loadfail:csp-or-unsupported" verdicts.
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 1 (Page.setBypassCSP) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Layer 2: Remove runtime CSP meta tags
  try {
    await session.evaluate(`(() => {
      document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(function(m){ m.remove(); });
      return 'csp-meta-removed';
    })()`);
    anySucceeded = true;
  } catch (error) {
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 2 (CSP meta removal) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Layer 3: Diagnostic probe — check whether CSP is actually active.
  // Does NOT bypass anything; only provides diagnostic context.
  try {
    const cspStatus = await session.evaluate(`(() => {
      try {
        var meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return meta ? 'meta-csp-present' : 'no-meta-csp';
      } catch(e) { return 'probe-failed:' + e.message; }
    })()`);
    if (cspStatus === 'no-meta-csp' && !anySucceeded) {
      console.warn(
        '[cdp-wallpaper] bypassPageCsp: all bypass layers failed — CSP is header-based on a webview target. Blob/data: URL fallback is the only path that can load media.',
      );
    }
  } catch (error) {
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 3 (CSP probe) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return anySucceeded;
}

// ===========================================================================
// Mouse parallax (shared by video + image paths)
// ===========================================================================

/**
 * Mouse parallax script (image/video 在 agent 主页面直接监听 window.mousemove —
 * pointer-events:none 只挡元素命中，不挡 window 监听）。容器放大 1.1 防
 * 露边（WE 官方同样建议放大背景图），按鼠标偏移做反向 translate。
 * strength 0-1（render.parallax/100）；0 时不注入。
 *
 * 守卫检查容器是否仍在 DOM：每次注入重建容器后（壁纸切换/重注入）都会
 * 重新挂载监听，避免闭包引用已被移除的旧容器。
 */
export function buildParallaxJs(strength: number): string {
  const s = Math.max(0, Math.min(1, strength));
  if (s <= 0) return '';
  return `(function(){
  var G='__agentskinWpParallax';
  var el=document.getElementById('${WALLPAPER_CONTAINER_ID}');
  if(!el)return;
  if(window[G]&&window[G].container===el)return;
  if(window[G]){window.removeEventListener('mousemove',window[G].handler);}
  var strength=${s.toFixed(3)};
  var MAX_OFFSET=40;
  function handler(e){
    var x=(e.clientX/window.innerWidth-0.5)*2;
    var y=(e.clientY/window.innerHeight-0.5)*2;
    el.style.setProperty('transform','scale(1.1) translate('+(-x*strength*MAX_OFFSET)+'px,'+(-y*strength*MAX_OFFSET)+'px)','important');
  }
  window.addEventListener('mousemove',handler);
  window[G]={handler:handler,container:el};
})();`;
}

// ===========================================================================
// Signal bridge (for web/scene wallpaper iframes)
// ===========================================================================

/**
 * 桥接脚本（注入 agent 主页面）— scene/web 壁纸 iframe 因 pointer-events:none
 * 收不到鼠标事件，也拿不到主进程的音频电平。该脚本在 agent 页面监听
 * window.mousemove + 暴露 window.AGENTSKIN_WP_AUDIO(level)，通过 postMessage
 * 跨域转发给壁纸 iframe；scene 渲染器用 message 监听接收（pointer → 视差，
 * audio → 呼吸/律动）。
 *
 * 每次 send 重新 querySelector iframe，避免 React 重建后引用失效。
 */
export function buildWpSignalBridgeJs(): string {
  return `(function(){
  var G='${WALLPAPER_BRIDGE_GLOBAL}';
  if(window[G])return;
  function send(type,data){
    try{
      var f=document.getElementById('${WEB_WALLPAPER_ID}');
      if(f&&f.contentWindow)f.contentWindow.postMessage({${JSON.stringify(WALLPAPER_MESSAGE_NS)}:true,type:type,data:data},'*');
    }catch(e){}
  }
  window.addEventListener('mousemove',function(e){
    send('pointer',{x:e.clientX/(window.innerWidth||1),y:e.clientY/(window.innerHeight||1)});
  },{passive:true});
  window.AGENTSKIN_WP_AUDIO=function(level){send('audio',{level:level});};
  window[G]=true;
})();`;
}

// ===========================================================================
// Combined removal (all wallpaper types in a single CDP round-trip)
// ===========================================================================

/**
 * Remove any injected wallpaper (video, image, or web) from an agent's page.
 * Combines all three removal paths into a single CDP evaluate call to avoid
 * three sequential round-trips (each ~5-15ms over loopback WebSocket).
 */
export async function removeAllWallpapers(session: CdpSession): Promise<void> {
  try {
    await session.evaluate(`(() => {
      // Clean up container (wraps media + scrim; removing it removes children)
      document.querySelectorAll('[id="${WALLPAPER_CONTAINER_ID}"]').forEach(function(el){ el.remove(); });
      // Clean up video wallpaper elements (fallback for older injections without container)
      document.querySelectorAll('[id="${VIDEO_WALLPAPER_ID}"]').forEach(function(v){
        if (v.src && v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
        v.remove();
      });
      document.querySelectorAll('[id="${VIDEO_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      // Clean up image wallpaper elements
      document.querySelectorAll('[id="${IMAGE_WALLPAPER_ID}"]').forEach(function(img){
        if (img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
        img.remove();
      });
      document.querySelectorAll('[id="${IMAGE_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      // Clean up web wallpaper elements
      document.querySelectorAll('[id="${WEB_WALLPAPER_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WEB_SCRIM_ID}"]').forEach(function(el){ el.remove(); });
      // Clean up shared elements
      document.querySelectorAll('[id="${WALLPAPER_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      document.querySelectorAll('[id="${WALLPAPER_GUARD_ID}"]').forEach(function(el){ el.remove(); });
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      if (window.${WALLPAPER_HEAL_GLOBAL}) { clearInterval(window.${WALLPAPER_HEAL_GLOBAL}); delete window.${WALLPAPER_HEAL_GLOBAL}; }
      if (window.${WALLPAPER_RESIZE_GLOBAL}) { window.removeEventListener('resize', window.${WALLPAPER_RESIZE_GLOBAL}); delete window.${WALLPAPER_RESIZE_GLOBAL}; }
      // Clean up punch-through: adoptedStyleSheet, observer, style element, class + inline styles
      ${WALLPAPER_PUNCH_TEARDOWN_JS}
    })()`);
  } catch {
    // best-effort
  }
}
