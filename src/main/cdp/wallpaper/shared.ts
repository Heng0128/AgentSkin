// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/shared
 *
 * Shared helpers used by all three wallpaper injection strategies
 * ({@link ./video-injector}, {@link ./image-injector},
 * {@link ./web-injector}).
 *
 * Contents:
 *   - **Retry**: `evaluateWithRetry` — wraps chunked CDP evaluate calls with
 *     transport-level retry (timeout / socket-closed), re-throws renderer
 *     exceptions immediately.
 *   - **MIME detection**: `videoMimeForPath`, `imageMimeForPath`.
 *   - **CSP bypass**: `bypassPageCsp` — three-layer CSP bypass (CDP
 *     setBypassCSP, meta-tag removal, diagnostic probe).
 *   - **Punch-through**: `WALLPAPER_PUNCH_JS` constant + `applyPunchThrough`
 *     helper — neutralizes the agent's opaque full-bleed shell so the
 *     wallpaper (at z-index:-2) is actually visible.
 *   - **Combined removal**: `removeAllWallpapers` — tears down all wallpaper
 *     types in a single CDP round-trip.
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
  WALLPAPER_PUNCH_CLASS,
  WALLPAPER_PUNCH_GLOBAL,
  WALLPAPER_PUNCH_STYLE_ID,
  WALLPAPER_RESIZE_GLOBAL,
  WALLPAPER_STYLE_ID,
  WEB_SCRIM_ID,
  WEB_WALLPAPER_ID,
} from '../../../shared/injection-constants';
import type { WallpaperRenderOptions } from '../../../shared/types';
import type { CdpSession } from '../cdp-client';

// ---------------------------------------------------------------------------
// Render-option → CSS mapping (alignment / position / flip / filters)
// ---------------------------------------------------------------------------

/**
 * 对齐方式 → object-fit 映射（对齐 Wallpaper Engine 渲染面板）：
 *   stretch → fill（拉伸填满，可能变形）
 *   fit     → contain（完整显示，留边）
 *   fill    → cover（裁剪铺满 —— 默认，与历史行为一致）
 *   center  → none（原尺寸居中，溢出裁切）
 *   tile    → none（交给容器 background-repeat 平铺，见 buildTileContainerCss）
 */
export function alignmentObjectFit(alignment: WallpaperRenderOptions['alignment']): string {
  switch (alignment) {
    case 'stretch':
      return 'fill';
    case 'fit':
      return 'contain';
    case 'center':
      return 'none';
    case 'tile':
      return 'none';
    case 'fill':
    default:
      return 'cover';
  }
}

/** 位置偏移 → object-position（默认 0 时 = 50% 50% 居中，与历史一致）。 */
export function buildObjectPosition(render: WallpaperRenderOptions): string {
  const x = render.positionX ?? 0;
  const y = render.positionY ?? 0;
  return `calc(50% + ${x}%) calc(50% + ${y}%)`;
}

/** 翻转 → transform（挂媒体元素自身；与容器的视差 transform 互不冲突）。 */
export function buildFlipTransform(render: WallpaperRenderOptions): string {
  const sx = render.flipH ? -1 : 1;
  const sy = render.flipV ? -1 : 1;
  if (sx === 1 && sy === 1) return '';
  return `scaleX(${sx}) scaleY(${sy})`;
}

/**
 * 滤镜 → filter（挂媒体元素自身，绝不挂 agent 壳 —— 壳的 filter 会被
 * WALLPAPER_TRANSPARENCY_CSS 的 filter:none 清除）。tint 用 sepia+saturate+
 * hue-rotate 组合近似主题色着色。默认全部缺省时返回 ''（无滤镜）。
 */
export function buildFilter(render: WallpaperRenderOptions): string {
  const parts: string[] = [];
  if (render.brightness !== undefined && render.brightness !== 100)
    parts.push(`brightness(${(render.brightness / 100).toFixed(2)})`);
  if (render.contrast !== undefined && render.contrast !== 100)
    parts.push(`contrast(${(render.contrast / 100).toFixed(2)})`);
  if (render.saturation !== undefined && render.saturation !== 100)
    parts.push(`saturate(${(render.saturation / 100).toFixed(2)})`);
  if (render.hueRotate !== undefined && render.hueRotate !== 0)
    parts.push(`hue-rotate(${render.hueRotate}deg)`);
  if (render.sepia !== undefined && render.sepia > 0)
    parts.push(`sepia(${(render.sepia / 100).toFixed(2)})`);
  if (render.grayscale !== undefined && render.grayscale > 0)
    parts.push(`grayscale(${(render.grayscale / 100).toFixed(2)})`);
  if (render.blur !== undefined && render.blur > 0) parts.push(`blur(${render.blur}px)`);
  if (render.tint) parts.push(buildTintFilter(render.tint));
  return parts.length ? parts.join(' ') : '';
}

/** 主题配色 tint → filter 片段（sepia 全色 + 高饱和 + 色相旋转到目标色相）。 */
export function buildTintFilter(tint: string): string {
  const hue = hexHue(tint);
  return `sepia(1) saturate(2.5) hue-rotate(${Math.round(hue)}deg)`;
}

/** 解析 hex 色的色相角（0-360），用于 tint 的 hue-rotate。非法值 → 0。 */
export function hexHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const deg = h * 60;
  return deg < 0 ? deg + 360 : deg;
}

/**
 * 构建媒体元素（img/video）的完整 style cssText，参数化对齐/位置/翻转/滤镜。
 * 默认（无 render）输出与历史完全一致的 CSS：object-fit:cover、居中、
 * 无 transform、无 filter。
 */
export function buildMediaElementCss(render: WallpaperRenderOptions | undefined): string {
  const r = render ?? {};
  const fit = alignmentObjectFit(r.alignment);
  const objectPosition = buildObjectPosition(r);
  const flip = buildFlipTransform(r);
  const filter = buildFilter(r);
  return (
    'position:absolute!important;inset:0!important;width:100%!important;height:100%!important;' +
    `object-fit:${fit}!important;` +
    `object-position:${objectPosition}!important;` +
    'pointer-events:none!important;opacity:0;transition:opacity 0.3s ease;' +
    (flip ? `transform:${flip}!important;` : '') +
    (filter ? `filter:${filter}!important;` : '')
  );
}

/**
 * tile 平铺模式（仅图片）：把 src 设到容器 background-repeat，隐藏媒体元素。
 * 返回 { containerBackground, hideElement }。
 */
export function buildTileContainerCss(
  src: string,
  render: WallpaperRenderOptions,
): { containerBackground: string; hideElement: boolean } {
  const x = render.positionX ?? 0;
  const y = render.positionY ?? 0;
  const background = `url("${src}") ${x}% ${y}% / auto repeat`;
  return { containerBackground: background, hideElement: true };
}

/**
 * 鼠标视差脚本（image/video 在 agent 主页面直接监听 window.mousemove —
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

/**
 * 桥接脚本（注入 agent 主页面）— scene/web 壁纸 iframe 因 pointer-events:none
 * 收不到鼠标事件，也拿不到主进程的音频电平。该脚本在 agent 页面监听
 * window.mousemove + 暴露 window.AGENTSKIN_WP_AUDIO(level)，通过 postMessage
 * 跨域转发给壁纸 iframe；scene 渲染器用 message 监听接收（pointer → 视差，
 * audio → 呼吸/律动）。
 *
 * 每次 send 重新 querySelector iframe，避免 React 重建后引用失效。
 */
export const WALLPAPER_BRIDGE_GLOBAL = '__agentskinWpBridge';
export const WALLPAPER_MESSAGE_NS = '__agentskin';

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

// ---------------------------------------------------------------------------
// Retry helper for chunked CDP evaluate calls
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// MIME type detection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CSP bypass
// ---------------------------------------------------------------------------

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
  // Some agents inject <meta http-equiv="Content-Security-Policy">
  // after Page.setBypassCSP has run (SPA navigations re-inject CSP).
  try {
    await session.evaluate(`(() => {
      document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(function(m){ m.remove(); });
      return 'csp-meta-removed';
    })()`);
    anySucceeded = true;
  } catch (error) {
    // Best-effort only — but log so a persistent evaluate failure (detached
    // session, navigation mid-inject) is visible instead of silently swallowed.
    console.warn(
      `[cdp-wallpaper] bypassPageCsp Layer 2 (CSP meta removal) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Layer 3: Diagnostic probe — check whether CSP is actually active on
  // this page. This layer does NOT bypass anything; it only provides
  // diagnostic context so the caller knows whether blob/data: URL fallback
  // is needed.
  //
  // Chromium enforces header-based CSP at the browser-process level, so
  // no amount of JS can neutralize it on an already-loaded page. The only
  // real fix for header-based CSP on webview targets (where Layer 1 is
  // unsupported) is to use blob/data: URLs — these embed media inline
  // (not fetched), so they bypass network-level CSP entirely.
  //
  // DO NOT set anySucceeded here — this is a diagnostic probe, not a bypass.
  // Previously, Layer 3 falsely set anySucceeded=true, causing bypassPageCsp
  // to report success even when no real bypass was applied. This masked the
  // root cause of multi-agent injection failures: callers thought CSP was
  // neutralized when it wasn't, and didn't trigger the blob/data: fallback.
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

// ---------------------------------------------------------------------------
// Enhanced wallpaper guard (shared by video + image + web paths)
// ---------------------------------------------------------------------------

/**
 * Transparency CSS text injected by all wallpaper strategies. Extracted as a
 * shared constant so the guard function can re-create the `<style>` element
 * with identical content if the agent removes it.
 *
 * Both `html,body` AND root wrappers (`#root`, `#app`, `.app-root`) must
 * neutralize containing-block-creating properties (`transform`, `filter`,
 * `perspective`, `will-change`, `contain`). When any ancestor of a
 * `position:fixed` wallpaper element has one of these properties set, it
 * becomes the containing block — the wallpaper is then positioned relative
 * to that ancestor instead of the viewport, causing offset / clipped /
 * wrong-position rendering. This is the root cause of the "display position
 * incorrect" symptom across agent shells that apply transforms or filters to
 * their root wrappers for UI effects.
 */
// prettier-ignore
export const WALLPAPER_TRANSPARENCY_CSS =
  'html,body{background:transparent!important;background-color:transparent!important;background-image:none!important;contain:none!important;overflow:visible!important;transform:none!important;will-change:auto!important;filter:none!important;perspective:none!important}#root,#app,[data-testid="root"],.app-root,[role="application"],.monaco-workbench,.monaco-workbench>.part,.workspace-shell,.chat-container,.main-container,.app-shell,.webview-wrap{background-color:transparent!important;background-image:none!important;background:none!important;contain:none!important;overflow:visible!important;transform:none!important;will-change:auto!important;filter:none!important;perspective:none!important}';

/**
 * Build an enhanced wallpaper guard script that replaces the fragile inline
 * guard previously embedded in each injector.
 *
 * The previous guard had several issues causing the "wallpaper turns black
 * after a second" symptom:
 * 1. Only watched `childList` on `document.documentElement` (not `subtree`),
 *    so removals triggered by framework-level DOM reconstruction were missed.
 * 2. Did NOT watch for removal of the `<style>` element — if the agent's
 *    framework cleared `<head>`, the transparency CSS was lost and the
 *    wallpaper became hidden behind the agent's opaque background.
 * 3. Did NOT re-apply `play()` after re-inserting a `<video>` — browsers
 *    pause video elements when they're removed from the DOM, and the
 *    re-inserted video stayed paused (frozen on the last frame, then black).
 * 4. Did NOT re-apply `opacity:1` with `!important` — the agent's CSS could
 *    override the inline `opacity:1` (set without `!important` by the load
 *    watchdog) with an `opacity:0 !important` rule.
 * 5. Had no periodic self-heal — if the MutationObserver missed a removal
 *    (element replacement, adoptedStyleSheet eviction), the wallpaper stayed
 *    invisible permanently.
 *
 * The enhanced guard fixes all five issues:
 * 1. Watches with `childList:true, subtree:true`.
 * 2. Watches for removal of wallpaper element, scrim, AND style element.
 * 3. Re-applies `play()` for video wallpapers after re-insertion.
 * 4. Re-applies `opacity:1 !important` via `setProperty`.
 * 5. Runs a periodic self-heal check every 2s.
 *
 * @param wallpaperId  DOM id of the wallpaper element (video/img/iframe).
 * @param scrimId      DOM id of the scrim overlay.
 * @param isVideo      Whether the wallpaper is a `<video>` (needs play() calls).
 * @returns            The guard script source, ready for a `<script>` element.
 */
// prettier-ignore
export function buildWallpaperGuardJs(
  wallpaperId: string,
  scrimId: string,
  isVideo: boolean,
): string {
  return `(function(){
  if(window.${WALLPAPER_OBSERVER_GLOBAL})return;
  var ct=document.getElementById("${WALLPAPER_CONTAINER_ID}");
  var wp=document.getElementById("${wallpaperId}");
  var sc=document.getElementById("${scrimId}");
  if(!wp)return;
  var STYLE_CSS=${JSON.stringify(WALLPAPER_TRANSPARENCY_CSS)};
  function ensureStyle(){
    var st=document.getElementById("${WALLPAPER_STYLE_ID}");
    if(!st){
      st=document.createElement('style');
      st.id="${WALLPAPER_STYLE_ID}";
      st.textContent=STYLE_CSS;
      (document.head||document.documentElement).appendChild(st);
    }
    return st;
  }
  var st=ensureStyle();
  function reinsert(){
    if(ct&&!document.documentElement.contains(ct)){document.documentElement.prepend(ct);}
    else if(!ct){
      if(!document.documentElement.contains(wp)){document.documentElement.prepend(wp);}
      if(sc&&!document.documentElement.contains(sc)){document.documentElement.insertBefore(sc,wp.nextSibling);}
    }
    ensureStyle();
    wp.style.setProperty('opacity','1','important');
    if(sc)sc.style.setProperty('opacity','1','important');
    ${isVideo ? "try{if(wp.tagName==='VIDEO'){wp.play().catch(function(){});}}catch(e){}" : ''}
  }
  var obs=new MutationObserver(function(muts){
    for(var m of muts){
      for(var r of m.removedNodes){
        if(r===ct||r===wp||r===sc||r===st){reinsert();return;}
      }
    }
  });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  window.${WALLPAPER_OBSERVER_GLOBAL}=obs;
  var healInterval=setInterval(function(){
    var currentWp=document.getElementById("${wallpaperId}");
    if(!currentWp){reinsert();return;}
    var cs=getComputedStyle(currentWp);
    var op=parseFloat(cs.opacity);
    if(isNaN(op)||op<=0){currentWp.style.setProperty('opacity','1','important');}
    var currentSc=document.getElementById("${scrimId}");
    if(currentSc){
      var scs=getComputedStyle(currentSc);
      var sop=parseFloat(scs.opacity);
      if(isNaN(sop)||sop<=0){currentSc.style.setProperty('opacity','1','important');}
    }
    ${isVideo ? "if(currentWp&&currentWp.tagName==='VIDEO'&&currentWp.paused){try{currentWp.play().catch(function(){});}catch(e){}}" : ''}
  },2000);
  window.${WALLPAPER_HEAL_GLOBAL}=healInterval;
  // Re-enforce container positioning on window resize / DPI change.
  // When the window is resized (taskbar show/hide, split-screen, DPI scaling),
  // the container's position:fixed;inset:0 should auto-update — but if an
  // ancestor created a containing block before neutralize() ran, the stale
  // dimensions can persist. This forces a reflow of the container's inline
  // styles on every resize, ensuring it always tracks the real viewport.
  var resizeHandler=function(){
    var c=document.getElementById("${WALLPAPER_CONTAINER_ID}");
    if(!c)return;
    c.style.setProperty('position','fixed','important');
    c.style.setProperty('inset','0','important');
    c.style.setProperty('overflow','hidden','important');
    c.style.setProperty('z-index','-2','important');
    c.style.setProperty('pointer-events','none','important');
    var w=document.getElementById("${wallpaperId}");
    if(w){
      w.style.setProperty('position','absolute','important');
      w.style.setProperty('inset','0','important');
      w.style.setProperty('width','100%','important');
      w.style.setProperty('height','100%','important');
    }
  };
  window.addEventListener('resize',resizeHandler);
  window.${WALLPAPER_RESIZE_GLOBAL}=resizeHandler;
})();`;
}

// ---------------------------------------------------------------------------
// Punch-through (shared by video + image + web paths)
// ---------------------------------------------------------------------------

/**
 * Wallpaper "punch-through" script.
 *
 * Injected into the agent page after a wallpaper is mounted. Its job is to
 * make the wallpaper actually VISIBLE: the media element sits at
 * `z-index:-2` behind the agent's own content, but most agents render an
 * opaque full-bleed shell (their own CSS, not AgentSkin's) that hides it.
 *
 * This walks the DOM and neutralizes every element that (a) covers the
 * viewport and (b) has an opaque background — i.e. the agent's shell —
 * without touching smaller content cards. Neutralization sets INLINE
 * `!important` `background-color:transparent` / `background-image:none` on
 * the element (the class `.agentskin-wp-transparent` is kept only for
 * `::before`/`::after` pseudo-element transparency, which cannot be set
 * inline). Inline !important is required because agent shells paint their
 * background via id-level / !important CSS rules; a class rule would lose
 * the cascade and the wallpaper (z-index:-2) would stay hidden. A debounced
 * MutationObserver re-runs it so React re-renders don't re-hide the
 * wallpaper. The change is fully reversible: the removal path strips the
 * class and the style element, restoring the agent's original backgrounds.
 *
 * NOTE: The punch-through ONLY neutralizes opaque backgrounds. It does NOT
 * strip borders, shadows, or outlines from UI elements — those are part of
 * the theme's visual design and should be preserved when a wallpaper is
 * active. Stripping them caused severe over-rendering (all UI elements
 * looked like floating wireframes over the wallpaper).
 *
 * Runs once per page load (guarded by {@link WALLPAPER_PUNCH_GLOBAL}).
 */
// prettier-ignore
const WALLPAPER_PUNCH_JS = `
(function(){
  var IDS=['${VIDEO_WALLPAPER_ID}','${IMAGE_WALLPAPER_ID}','${WEB_WALLPAPER_ID}','${VIDEO_SCRIM_ID}','${IMAGE_SCRIM_ID}','${WEB_SCRIM_ID}','${WALLPAPER_CONTAINER_ID}'];
  var STYLE_ID='${WALLPAPER_PUNCH_STYLE_ID}';
  var CLS='${WALLPAPER_PUNCH_CLASS}';
  var G='${WALLPAPER_PUNCH_GLOBAL}';
  if(!window[G+'_els']){window[G+'_els']=new Set();}
  function track(el){window[G+'_els'].add(el);}
  function isWp(el){return el&&el.id&&IDS.indexOf(el.id)>=0;}
  // Class-name substrings for UI mask/overlay elements that should be
  // FORCE-neutralized regardless of the size threshold. These are narrow
  // strips (e.g. top/bottom gradient fades) that cover < 50% of the
  // viewport height, so the standard size filter skips them — but they
  // still have an opaque/gradient background that blocks the wallpaper.
  //   '__mask' — BEM-style mask/overlay (e.g. TRAEWork's
  //     user-message-navigator__mask--top/bottom). A gradient fade strip
  //     at the top/bottom of the chat message list. ~40-60px tall,
  //     full viewport width — the 50% height filter skips it, leaving
  //     the black gradient visible over the wallpaper.
  var FORCE_NEUTRALIZE_CLASS_SUBSTRINGS=['__mask'];
  function shouldForceNeutralize(el){
    var cn=el.className;
    if(!cn)return false;
    if(typeof cn!=='string'){ cn=cn.baseVal||''; }
    for(var i=0;i<FORCE_NEUTRALIZE_CLASS_SUBSTRINGS.length;i++){
      if(cn.indexOf(FORCE_NEUTRALIZE_CLASS_SUBSTRINGS[i])>=0)return true;
    }
    return false;
  }
  function alpha(c){var m=(c||'').match(/rgba?\\(([^)]+)\\)/);if(!m)return 0;var p=m[1].split(',').map(function(s){return parseFloat(s);});if(p.length<3)return 0;return p.length>=4?p[3]:1;}
  function opaqueBg(cs){
    // Check backgroundColor alpha — the primary signal. getComputedStyle
    // resolves var() references, so "background: var(--bg)" where --bg is
    // an opaque color will show up here.
    if(alpha(cs.backgroundColor)>0.05) return true;
    // Check backgroundImage (includes gradients set via shorthand)
    if(cs.backgroundImage && cs.backgroundImage!=='none') return true;
    // Fallback: check the shorthand background property. Some agents set
    // "background: #fff" which correctly sets backgroundColor, but others
    // use "background: var(--bg)" where the shorthand resolves differently
    // across Chromium versions. This catches any non-transparent shorthand.
    var bg=cs.background;
    if(bg && bg!=='none' && bg!==''){
      if(!/transparent|rgba\\(0,\\s*0,\\s*0,\\s*0\\)/.test(bg)) return true;
    }
    return false;
  }
  function neutralize(){
    // Guard: if teardown already ran (deleted window[G]), do NOT re-apply
    // styles. The 250ms debounce timer can fire after teardown completes —
    // without this guard it would re-neutralize elements, leaving inline
    // transparent styles that manifest as white blocks on theme restore.
    if(!window[G])return;
    var vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
    // Self-cleanup: if no wallpaper element exists anymore (wallpaper was
    // removed via removeAllWallpapers), disconnect the observer and bail.
    // This prevents the observer from running forever after the wallpaper is
    // gone, doing unnecessary DOM walks on every React re-render.
    var hasWp=false;
    for(var i=0;i<3;i++){ if(document.getElementById(IDS[i])){ hasWp=true; break; } }
    if(!hasWp){
      if(window[G+'_mo']){ try{ window[G+'_mo'].disconnect(); }catch(e){} delete window[G+'_mo']; }
      return;
    }
    // html and body are ALWAYS full-bleed and are the #1 opaque blocker.
    // Neutralize them unconditionally — even if getComputedStyle claims
    // they're transparent, some browsers report 'transparent' for
    // inherited backgrounds.
    // NOTE: we set INLINE !important (not just the class rule) because agent
    // shells paint their background via id-level / !important CSS. A class
    // rule (specificity 0,1,0) loses that cascade battle and the shell stays
    // opaque — the historic "success but nothing visible" bug. Inline
    // !important has the highest author-declaration priority and wins.
    document.documentElement.classList.add(CLS);
    document.documentElement.style.setProperty('background-color','transparent','important');
    document.documentElement.style.setProperty('background-image','none','important');
    document.documentElement.style.setProperty('background','none','important');
    track(document.documentElement);
    if(document.body){
      document.body.classList.add(CLS);
      document.body.style.setProperty('background-color','transparent','important');
      document.body.style.setProperty('background-image','none','important');
      document.body.style.setProperty('background','none','important');
      track(document.body);
    }
    (function walk(el){
      if(el.nodeType!==1||isWp(el))return;
      if(el!==document.documentElement && el!==document.body){
        var r=el.getBoundingClientRect();
        var force=shouldForceNeutralize(el);
        // Size threshold: neutralize elements that cover a significant portion
        // of the viewport. Two paths:
        //   1. Large elements: width AND height ≥ 50% — catches full-bleed
        //      shells and main content panels.
        //   2. Area-based: element area ≥ 10% of viewport — catches tall
        //      narrow sidebars (e.g. TRAEWork's .task-list-base is 300px
        //      wide × full height = 24% area, but only 25% width so path 1
        //      misses it) and wide short bars. 10% is high enough to skip
        //      individual cards/buttons (a 350×350 card on 1920×1080 ≈ 6%).
        // FORCE_NEUTRALIZE elements (e.g. __mask gradient strips) bypass
        // the size check entirely — they're narrow but still block the wallpaper.
        var area=r.width*r.height;
        var vwa=vw*vh;
        if(force){
          // FORCE path: unconditionally neutralize + hide. These are known
          // overlay/mask elements (e.g. TraeWork gradient fade strips) that
          // must be invisible when a wallpaper is active, regardless of their
          // computed background value.
          el.classList.add(CLS);
          el.style.setProperty('background-color','transparent','important');
          el.style.setProperty('background-image','none','important');
          el.style.setProperty('background','none','important');
          el.style.setProperty('opacity','0','important');
          track(el);
        } else if((r.width>=vw*0.5 && r.height>=vh*0.5) || area>=vwa*0.1){
          var cs=getComputedStyle(el);
          var pb=getComputedStyle(el,'::before');
          var pa=getComputedStyle(el,'::after');
          if(opaqueBg(cs)||opaqueBg(pb)||opaqueBg(pa)){
            el.classList.add(CLS);
            // Same inline-!important rationale as html/body above: beat the
            // agent's own !important shell background so the wallpaper shows.
            el.style.setProperty('background-color','transparent','important');
            el.style.setProperty('background-image','none','important');
            el.style.setProperty('background','none','important');
            track(el);
          }
          // CRITICAL: neutralize containing-block-creating properties on
          // large elements. When an ancestor of the wallpaper container has
          // transform/filter/perspective/contain/will-change set, it becomes
          // the containing block for position:fixed — the wallpaper is then
          // positioned relative to that ancestor instead of the viewport,
          // causing offset/clipped/wrong-position rendering.
          //
          // WALLPAPER_TRANSPARENCY_CSS only handles html/body/#root/#app,
          // but agent shells have additional wrapper divs (.workspace-shell,
          // .monaco-workbench, .chat-container, etc.) that also set these
          // properties for GPU acceleration or layout containment.
          // Neutralizing them on large elements is safe because:
          //   - These properties don't affect visual appearance (only layout
          //     containment and GPU compositing)
          //   - The element is already being transparentized (background removed)
          //   - The wallpaper container is prepended to documentElement, so
            //     any ancestor with these properties breaks its positioning
          el.style.setProperty('transform','none','important');
          el.style.setProperty('filter','none','important');
          el.style.setProperty('perspective','none','important');
          el.style.setProperty('contain','none','important');
          el.style.setProperty('will-change','auto','important');
        }
      }
      var ch=el.children;
      for(var i=0;i<ch.length;i++) walk(ch[i]);
      // Traverse shadow root for deeper penetration into Shadow DOM
      if (el.shadowRoot) {
        for (var node = el.shadowRoot.firstChild; node; node = node.nextSibling) {
          if (node.nodeType === 1) walk(node);
        }
      }
    })(document.documentElement);
  }
  /* Use adoptedStyleSheets instead of <style> tag — agent adapters inject
     their CSS via adoptedStyleSheets which ALWAYS beats document <style> in
     the cascade. A <style> rule for ::before/::after can never win against
     an adoptedSheet rule like "html.agentskin-host-* #root::before { background: ... !important }".
     By using adoptedStyleSheets ourselves (appended AFTER the adapter sheets),
     we get same-origin cascade priority and win on source order + specificity. */
  if(!window[G+'_sheet']){
    var sheet=new CSSStyleSheet();
    sheet.replaceSync(
      '.'+CLS+',.'+CLS+'::before,.'+CLS+'::after{background-color:transparent!important;background-image:none!important;background:none!important;}'+
      'html body.'+CLS+'::before,html body.'+CLS+'::after,'+
      'html #root.'+CLS+'::before,html #root.'+CLS+'::after,'+
      'html #app.'+CLS+'::before,html #app.'+CLS+'::after,'+
      'html .'+CLS+'[id]::before,html .'+CLS+'[id]::after'+
      '{background-color:transparent!important;background-image:none!important;background:none!important;content:none!important;}'+
      '[class*="user-message-navigator__mask"]{background-color:transparent!important;background-image:none!important;background:none!important;opacity:0!important;}'+
      'html{--agentskin-art:none!important;}'+
      'html #root::before,html body::before{background:none!important;background-color:transparent!important;background-image:none!important;}'
    );
    document.adoptedStyleSheets=Array.from(document.adoptedStyleSheets||[]).concat([sheet]);
    window[G+'_sheet']=sheet;
  }
  neutralize();
  if(!window[G]){
    window[G]=true;
    var t=null;
    var mo=new MutationObserver(function(){
      if(t)return;
      t=setTimeout(function(){t=null;neutralize();},250);
    });
    mo.observe(document.documentElement,{childList:true,subtree:true});
    // Store observer reference so neutralize()'s self-cleanup can disconnect
    // it when the wallpaper is removed.
    window[G+'_mo']=mo;
    // The observer stays alive permanently — some agents (WorkBuddy, Doubao)
    // re-render well after boot and re-apply opaque backgrounds that re-hide
    // the wallpaper. The 250ms debounce limits CPU impact: at most one DOM
    // walk per 250ms even under heavy mutation. The self-cleanup in
    // neutralize() disconnects the observer when the wallpaper is removed,
    // so it doesn't leak after the wallpaper is gone.
  }
})();
`;

/**
 * Evaluate the punch-through script in the agent page. Logs a warning on
 * failure instead of throwing — a punch-through failure leaves the wallpaper
 * hidden behind an opaque agent shell, but the wallpaper elements themselves
 * are already mounted and the caller should still report success (the user
 * can re-apply to retry the punch-through).
 *
 * @param session  CDP session to the agent page.
 * @param label    Function name for the warning message (e.g. 'mountVideoWallpaper').
 */
export async function applyPunchThrough(session: CdpSession, label: string): Promise<void> {
  try {
    await session.evaluate(WALLPAPER_PUNCH_JS);
  } catch (error) {
    // Punch-through failure leaves the wallpaper hidden behind an opaque
    // agent shell — log so this silent failure mode is traceable.
    console.warn(
      `[cdp-wallpaper] punch-through (${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Post-injection visibility verification
// ---------------------------------------------------------------------------

/**
 * Verify that the wallpaper is actually VISIBLE after injection + punch-through.
 *
 * The load-watchdog verdict ('ok') only confirms the media element loaded — it
 * does NOT confirm the wallpaper is visible to the user. Common failure modes
 * that leave the wallpaper invisible despite a 'ok' verdict:
 *   - Punch-through failed (opaque agent shell still covers z-index:-2)
 *   - React re-render removed the element between mount and verification
 *   - A containing-block property (contain/transform) on html/body clips the
 *     fixed element to zero visible area
 *
 * This probe runs AFTER applyPunchThrough and checks three conditions:
 *   1. The wallpaper element exists in the DOM.
 *   2. It has non-zero computed width AND height (not clipped to 0×0).
 *   3. Its computed opacity is > 0 (the load watchdog set opacity:1).
 *
 * If any check fails, the caller should treat the injection as failed (even
 * though the media technically loaded) so the fallback mechanism can fire.
 *
 * @param session     CDP session to the agent page.
 * @param wallpaperId The DOM id of the wallpaper element to verify.
 * @returns `{ visible: true }` or `{ visible: false, reason: '...' }`.
 */
export async function verifyWallpaperVisibility(
  session: CdpSession,
  wallpaperId: string,
): Promise<{ visible: boolean; reason?: string }> {
  try {
    const probe = await session.evaluate(`(() => {
      var el = document.getElementById('${wallpaperId}');
      if (!el) return 'missing';
      var cs = getComputedStyle(el);
      var w = parseFloat(cs.width) || 0;
      var h = parseFloat(cs.height) || 0;
      if (w < 1 || h < 1) return 'zero-size:' + Math.round(w) + 'x' + Math.round(h);
      var op = parseFloat(cs.opacity);
      if (isNaN(op) || op <= 0) return 'opacity-zero';
      return 'visible';
    })()`);
    if (probe === 'visible') return { visible: true };
    return { visible: false, reason: String(probe) };
  } catch (error) {
    // Probe evaluation failed (session detached, navigation, etc.) — treat
    // as not-visible so the caller can report failure and trigger fallback.
    return {
      visible: false,
      reason: `probe-error:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Punch-through teardown (shared by all removal paths)
// ---------------------------------------------------------------------------

/**
 * Punch-through teardown snippet — embedded inside CDP evaluate calls by
 * {@link removeAllWallpapers} and the individual `remove*Wallpaper` functions.
 *
 * Removes:
 *   - adoptedStyleSheet (punch-through CSSStyleSheet for ::before/::after)
 *   - MutationObserver (stops re-neutralizing DOM mutations)
 *   - `<style>` element (legacy punch-through style tag)
 *   - `.agentskin-wp-transparent` class (restores CSS cascade)
 *   - **INLINE `!important` background styles** set by `neutralize()` on
 *     `html`, `body`, and large opaque elements
 *
 * The inline style removal is the critical fix for the "residual white block"
 * bug: `neutralize()` calls `el.style.setProperty('background','none','important')`
 * (and `background-color` / `background-image`) directly on elements to beat
 * the agent's own `!important` shell backgrounds. Without `removeProperty`
 * during teardown, these inline declarations persist after wallpaper removal,
 * keeping elements transparent — the browser's default white background then
 * shows through where the agent's themed background should be (most visible
 * in title bars / header areas, e.g. QoderWork's title layer).
 *
 * `removeProperty` works regardless of `!important` priority — it removes the
 * declaration entirely, restoring the element to its CSS-specified value.
 */
// prettier-ignore
export const WALLPAPER_PUNCH_TEARDOWN_JS = `
      var G='${WALLPAPER_PUNCH_GLOBAL}';
      if(window[G+'_sheet']){
        document.adoptedStyleSheets=Array.from(document.adoptedStyleSheets||[]).filter(function(s){return s!==window[G+'_sheet'];});
        delete window[G+'_sheet'];
      }
      if(window[G+'_mo']){ try{ window[G+'_mo'].disconnect(); }catch(e){} delete window[G+'_mo']; }
      delete window[G];
      /* Clean up wallpaper guard self-heal interval */
      if(window.${WALLPAPER_HEAL_GLOBAL}){clearInterval(window.${WALLPAPER_HEAL_GLOBAL});delete window.${WALLPAPER_HEAL_GLOBAL};}
      /* Clean up wallpaper resize listener */
      if(window.${WALLPAPER_RESIZE_GLOBAL}){window.removeEventListener('resize',window.${WALLPAPER_RESIZE_GLOBAL});delete window.${WALLPAPER_RESIZE_GLOBAL};}
      document.querySelectorAll('[id="${WALLPAPER_PUNCH_STYLE_ID}"]').forEach(function(el){ el.remove(); });
      /* Primary cleanup: iterate the tracked element Set. This is reliable
         even when React re-renders remove the CSS class from DOM nodes — the
         Set holds direct object references so querySelector is not needed.
         Without this, inline !important styles survive teardown and the
         browser default white shows through (e.g. QoderWork title layer). */
      if(window[G+'_els']){
        window[G+'_els'].forEach(function(el){
          try{
            el.classList.remove('${WALLPAPER_PUNCH_CLASS}');
            el.style.removeProperty('background-color');
            el.style.removeProperty('background-image');
            el.style.removeProperty('background');
            el.style.removeProperty('opacity');
            // Also remove containing-block properties set by neutralize()
            el.style.removeProperty('transform');
            el.style.removeProperty('filter');
            el.style.removeProperty('perspective');
            el.style.removeProperty('contain');
            el.style.removeProperty('will-change');
          }catch(e){}
        });
        delete window[G+'_els'];
      }
      /* Fallback: class-based query catches any elements neutralized by an
         older version of the punch script that didn't track into the Set. */
      document.querySelectorAll('.${WALLPAPER_PUNCH_CLASS}').forEach(function(el){
        el.classList.remove('${WALLPAPER_PUNCH_CLASS}');
        el.style.removeProperty('background-color');
        el.style.removeProperty('background-image');
        el.style.removeProperty('background');
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
        el.style.removeProperty('filter');
        el.style.removeProperty('perspective');
        el.style.removeProperty('contain');
        el.style.removeProperty('will-change');
      });
`;

// ---------------------------------------------------------------------------
// Combined removal (all wallpaper types in a single CDP round-trip)
// ---------------------------------------------------------------------------

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
