// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Wallpaper Injection
 *
 * Extracted from `cdp-inject.ts` (H2 of the god-object teardown).
 *
 * Owns the low-level CDP injection of full-bleed video and image wallpapers
 * into agent pages. These are independent of theme CSS injection — they run
 * on a separate lifecycle (wallpaper apply/remove vs. theme apply/restore)
 * and share only the CDP session transport.
 *
 * Two wallpaper types, mirror-structured:
 *   - video (low-memory + legacy blob paths):
 *       - {@link injectVideoWallpaper} — mount a video from a URL that is
 *         already playable inside the agent page (a loopback http URL served
 *         by `wallpaper-server`, or a `blob:` URL). Preferred for large files
 *         because the browser streams the media itself instead of ballooning
 *         the agent's JS heap.
 *       - {@link injectVideoWallpaperByBase64} — chunked base64 transfer that
 *         reassembles a Blob inside the agent page. Kept as the fallback for
 *         small files and when the local HTTP server is unavailable.
 *   - {@link injectImageWallpaper} / {@link removeImageWallpaper} —
 *     single-shot base64 for static images (≤20 MB).
 *   - {@link removeAllWallpapers} — convenience wrapper for restore.
 *
 * Both wallpaper types share a "punch-through" script ({@link WALLPAPER_PUNCH_JS})
 * that neutralizes the agent's opaque full-bleed shell so the wallpaper
 * (at z-index:-2) is actually visible. The punch-through is reversible:
 * the removal path strips the class and style element, restoring original
 * backgrounds.
 *
 * Call chain:
 *   wallpaper-injector.ts → injectVideoWallpaper / injectVideoWallpaperByBase64
 *                         / injectImageWallpaper / removeAllWallpapers
 */

import { readFileSync } from 'node:fs';
import type { CdpSession } from './cdp-client';
import {
  IMAGE_SCRIM_ID,
  IMAGE_WALLPAPER_ID,
  MAX_VIDEO_BLOB_BYTES,
  VIDEO_SCRIM_ID,
  VIDEO_WALLPAPER_ID,
  WALLPAPER_CHUNK_SIZE,
  WALLPAPER_CHUNKS_GLOBAL,
  WALLPAPER_GUARD_ID,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_PUNCH_CLASS,
  WALLPAPER_PUNCH_GLOBAL,
  WALLPAPER_PUNCH_STYLE_ID,
  WALLPAPER_STYLE_ID,
} from '../shared/injection-constants';

/** Derive a video MIME type from a file path's extension. */
export function videoMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

/** Derive a static-image MIME type from a file path's extension. */
function imageMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// Shared video mount (URL already valid inside the agent page)
// ---------------------------------------------------------------------------

interface MountVideoArgs {
  src: string;
  mime: string;
  speed: number;
  loop: boolean;
  scrimOpacity: number;
}

/**
 * Mount a video wallpaper whose `src` is already a playable URL in the agent
 * page (loopback http URL or `blob:` URL). Creates the fixed full-bleed
 * `<video>`, the readability scrim, the transparency style, and a
 * MutationObserver that re-inserts the wallpaper if React destroys it.
 */
async function mountVideoWallpaper(
  session: CdpSession,
  { src, mime, speed, loop, scrimOpacity }: MountVideoArgs,
): Promise<boolean> {
  try {
    // Step 1: clean up any existing wallpaper elements + observer.
    await session.evaluate(`(() => {
      document.getElementById('${VIDEO_WALLPAPER_ID}')?.remove();
      document.getElementById('${VIDEO_SCRIM_ID}')?.remove();
      document.getElementById('${WALLPAPER_STYLE_ID}')?.remove();
      document.getElementById('${WALLPAPER_GUARD_ID}')?.remove();
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      return 'clean';
    })()`);

    // Step 2: mount the video (src is injected as a JSON-encoded string so
    // any URL characters are safely escaped).
    const result = await session.evaluate(`(async () => {
      try {
        const video = document.createElement('video');
        video.id = '${VIDEO_WALLPAPER_ID}';
        video.src = ${JSON.stringify(src)};
        video.type = '${mime}';
        video.autoplay = true;
        video.loop = ${loop};
        video.muted = true;
        video.playsInline = true;
        video.playbackRate = ${speed};
        video.setAttribute('disablepictureinpicture', '');
        video.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;pointer-events:none;';
        document.documentElement.prepend(video);

        const scrim = document.createElement('div');
        scrim.id = '${VIDEO_SCRIM_ID}';
        scrim.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:rgba(0,0,0,${(scrimOpacity / 100).toFixed(2)});';
        document.documentElement.insertBefore(scrim, video.nextSibling);

        const style = document.createElement('style');
        style.id = '${WALLPAPER_STYLE_ID}';
        style.textContent = 'html,body{background:transparent!important}#root,#app,[data-testid="root"],.app-root{background-color:transparent!important;background-image:none!important}';
        document.head.appendChild(style);

        const guard = document.createElement('script');
        guard.id = '${WALLPAPER_GUARD_ID}';
        guard.textContent = '(function(){if(window.${WALLPAPER_OBSERVER_GLOBAL})return;var v=document.getElementById("${VIDEO_WALLPAPER_ID}");var s=document.getElementById("${VIDEO_SCRIM_ID}");if(!v)return;var obs=new MutationObserver(function(muts){for(var m of muts){for(var r of m.removedNodes){if(r===v||r===s){document.documentElement.prepend(v);document.documentElement.insertBefore(s,v.nextSibling);return;}}}});obs.observe(document.documentElement,{childList:true});window.${WALLPAPER_OBSERVER_GLOBAL}=obs;})();';
        document.documentElement.appendChild(guard);

        video.play().catch(() => {});

        // Verify the media actually begins loading. A blocked media-src CSP
        // (or a bad/unsupported URL) leaves the element at readyState 0 with
        // networkState NO_SOURCE / an error — without this check the wallpaper
        // would be silently invisible while the caller reports success.
        const verdict = await new Promise((resolve) => {
          let settled = false;
          const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
          const WATCHDOG_MS = 7000;
          const onOk = () => finish('ok');
          const onErr = () => finish('loadfail');
          video.addEventListener('loadedmetadata', onOk, { once: true });
          video.addEventListener('loadeddata', onOk, { once: true });
          video.addEventListener('canplay', onOk, { once: true });
          video.addEventListener('playing', onOk, { once: true });
          video.addEventListener('error', onErr, { once: true });
          setTimeout(() => {
            if (video.readyState >= 1 || video.networkState === 2) finish('ok');
            else finish('loadfail');
          }, WATCHDOG_MS);
        });

        // On failure, tear down the dead element so a retry (or the absence of
        // one) doesn't leave a stuck invisible <video> spewing console errors.
        if (verdict !== 'ok') {
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
    try {
      await session.evaluate(WALLPAPER_PUNCH_JS);
    } catch {
      // best-effort
    }
    return result === 'ok';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Video wallpaper injection — public entry points
// ---------------------------------------------------------------------------

export interface InjectVideoWallpaperOptions {
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
}

/**
 * Mount a video wallpaper from a pre-built URL (loopback http or blob).
 * This is the low-memory path used for large videos streamed from
 * `wallpaper-server`.
 */
export async function injectVideoWallpaper(
  session: CdpSession,
  options: InjectVideoWallpaperOptions,
): Promise<boolean> {
  const { src, mime, speed = 1, loop = true, scrimOpacity = 55 } = options;
  return mountVideoWallpaper(session, { src, mime, speed, loop, scrimOpacity });
}

export interface InjectVideoWallpaperByBase64Options {
  /** Absolute path to the video file. */
  videoPath: string;
  /** Playback speed multiplier (default 1.0). */
  speed?: number;
  /** Whether to loop (default true). */
  loop?: boolean;
  /** Scrim opacity 0-100 (default 55). */
  scrimOpacity?: number;
}

/**
 * Legacy / fallback video injection: read the file, transfer it as chunked
 * base64 through CDP, and reassemble a Blob in the agent page. Used for
 * small files and whenever the local HTTP server is unavailable. Note this
 * keeps the full file in the agent's JS heap — prefer {@link injectVideoWallpaper}
 * with a streamed URL for large videos.
 */
export async function injectVideoWallpaperByBase64(
  session: CdpSession,
  options: InjectVideoWallpaperByBase64Options,
): Promise<boolean> {
  const { videoPath, speed = 1, loop = true, scrimOpacity = 55 } = options;
  try {
    const stat = readFileSync(videoPath);
    if (stat.length > MAX_VIDEO_BLOB_BYTES) return false;
    const base64 = stat.toString('base64');
    const mime = videoMimeForPath(videoPath);

    // Step 1: clean up existing wallpaper and initialize chunk accumulator.
    await session.evaluate(`(() => {
      document.getElementById('${VIDEO_WALLPAPER_ID}')?.remove();
      document.getElementById('${VIDEO_SCRIM_ID}')?.remove();
      document.getElementById('${WALLPAPER_STYLE_ID}')?.remove();
      document.getElementById('${WALLPAPER_GUARD_ID}')?.remove();
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      window.${WALLPAPER_CHUNKS_GLOBAL} = [];
      return 'init';
    })()`);

    // Step 2: transfer base64 in chunks (~2 MB each).
    const totalChunks = Math.ceil(base64.length / WALLPAPER_CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64.slice(i * WALLPAPER_CHUNK_SIZE, (i + 1) * WALLPAPER_CHUNK_SIZE);
      await session.evaluate(`window.${WALLPAPER_CHUNKS_GLOBAL}.push(${JSON.stringify(chunk)});`);
    }

    // Step 3: assemble a blob URL in-page, then mount.
    const url = await session.evaluate(`(async () => {
      try {
        const b64 = window.${WALLPAPER_CHUNKS_GLOBAL}.join('');
        delete window.${WALLPAPER_CHUNKS_GLOBAL};
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: '${mime}' });
        return URL.createObjectURL(blob);
      } catch (e) { return ''; }
    })()`);
    if (!url) return false;
    return mountVideoWallpaper(session, { src: url, mime, speed, loop, scrimOpacity });
  } catch {
    return false;
  }
}

/** Remove the injected video wallpaper from an agent's page. */
export async function removeVideoWallpaper(session: CdpSession): Promise<void> {
  try {
    await session.evaluate(`(() => {
      const v = document.getElementById('${VIDEO_WALLPAPER_ID}');
      const s = document.getElementById('${VIDEO_SCRIM_ID}');
      if (v) { if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src); v.remove(); }
      if (s) s.remove();
      document.getElementById('${WALLPAPER_STYLE_ID}')?.remove();
      const guard = document.getElementById('${WALLPAPER_GUARD_ID}');
      if (guard) guard.remove();
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      document.getElementById('${WALLPAPER_PUNCH_STYLE_ID}')?.remove();
      document.querySelectorAll('.${WALLPAPER_PUNCH_CLASS}').forEach((el) => el.classList.remove('${WALLPAPER_PUNCH_CLASS}'));
    })()`);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Static image wallpaper injection
// ---------------------------------------------------------------------------

/** Max image size for blob injection (20 MB). */
const MAX_IMAGE_BLOB_BYTES = 20 * 1024 * 1024;

export interface InjectImageWallpaperOptions {
  /** Absolute path to the image file. */
  imagePath: string;
  /** Scrim opacity 0-100 (default 45). */
  scrimOpacity?: number;
}

/**
 * Inject a full-bleed static image wallpaper into an agent's page via CDP.
 * The image sits at z-index -2 (behind the art layer at -1) with a
 * readability scrim overlay. Best-effort: returns false on failure.
 */
export async function injectImageWallpaper(
  session: CdpSession,
  options: InjectImageWallpaperOptions,
): Promise<boolean> {
  const { imagePath, scrimOpacity = 45 } = options;
  try {
    const buf = readFileSync(imagePath);
    if (buf.length > MAX_IMAGE_BLOB_BYTES) return false;
    const base64 = buf.toString('base64');
    const mime = imageMimeForPath(imagePath);

    const result = await session.evaluate(`(async () => {
      try {
        document.getElementById('${IMAGE_WALLPAPER_ID}')?.remove();
        document.getElementById('${IMAGE_SCRIM_ID}')?.remove();
        document.getElementById('${VIDEO_WALLPAPER_ID}')?.remove();
        document.getElementById('${VIDEO_SCRIM_ID}')?.remove();
        document.getElementById('${WALLPAPER_STYLE_ID}')?.remove();
        document.getElementById('${WALLPAPER_GUARD_ID}')?.remove();

        const b64 = "${base64}";
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: '${mime}' });
        const url = URL.createObjectURL(blob);

        const img = document.createElement('img');
        img.id = '${IMAGE_WALLPAPER_ID}';
        img.src = url;
        img.setAttribute('aria-hidden', 'true');
        img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;pointer-events:none;';
        document.documentElement.prepend(img);

        const scrim = document.createElement('div');
        scrim.id = '${IMAGE_SCRIM_ID}';
        scrim.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background:rgba(0,0,0,${(scrimOpacity / 100).toFixed(2)});';
        document.documentElement.insertBefore(scrim, img.nextSibling);

        const style = document.createElement('style');
        style.id = '${WALLPAPER_STYLE_ID}';
        style.textContent = 'html,body{background:transparent!important}#root,#app,[data-testid="root"],.app-root{background-color:transparent!important;background-image:none!important}';
        document.head.appendChild(style);

        const guard = document.createElement('script');
        guard.id = '${WALLPAPER_GUARD_ID}';
        guard.textContent = '(function(){if(window.${WALLPAPER_OBSERVER_GLOBAL})return;var el=document.getElementById("${IMAGE_WALLPAPER_ID}");var s=document.getElementById("${IMAGE_SCRIM_ID}");if(!el)return;var obs=new MutationObserver(function(muts){for(var m of muts){for(var r of m.removedNodes){if(r===el||r===s){document.documentElement.prepend(el);document.documentElement.insertBefore(s,el.nextSibling);return;}}}});obs.observe(document.documentElement,{childList:true});window.${WALLPAPER_OBSERVER_GLOBAL}=obs;})();';
        document.documentElement.appendChild(guard);

        return 'ok';
      } catch(e) { return 'err:' + e.message; }
    })()`);
    try {
      await session.evaluate(WALLPAPER_PUNCH_JS);
    } catch {
      // best-effort
    }
    return result === 'ok';
  } catch {
    return false;
  }
}

/** Remove the injected image wallpaper from an agent's page. */
export async function removeImageWallpaper(session: CdpSession): Promise<void> {
  try {
    await session.evaluate(`(() => {
      const img = document.getElementById('${IMAGE_WALLPAPER_ID}');
      const s = document.getElementById('${IMAGE_SCRIM_ID}');
      if (img) { if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src); img.remove(); }
      if (s) s.remove();
      document.getElementById('${WALLPAPER_STYLE_ID}')?.remove();
      const guard = document.getElementById('${WALLPAPER_GUARD_ID}');
      if (guard) guard.remove();
      if (window.${WALLPAPER_OBSERVER_GLOBAL}) { window.${WALLPAPER_OBSERVER_GLOBAL}.disconnect(); delete window.${WALLPAPER_OBSERVER_GLOBAL}; }
      document.getElementById('${WALLPAPER_PUNCH_STYLE_ID}')?.remove();
      document.querySelectorAll('.${WALLPAPER_PUNCH_CLASS}').forEach((el) => el.classList.remove('${WALLPAPER_PUNCH_CLASS}'));
    })()`);
  } catch {
    // best-effort
  }
}

/** Remove any injected wallpaper (video or image) from an agent's page. */
export async function removeAllWallpapers(session: CdpSession): Promise<void> {
  await removeVideoWallpaper(session);
  await removeImageWallpaper(session);
}

// ---------------------------------------------------------------------------
// Wallpaper "punch-through" script (shared by video + image paths)
// ---------------------------------------------------------------------------

/**
 * Wallpaper "punch-through" script.
 *
 * Injected into the agent page after a wallpaper is mounted. Its job is to
 * make the wallpaper actually VISIBLE: the media element sits at
 * `z-index:-2` behind the agent's own content, but most agents render an
 * opaque full-bleed shell (their own CSS, not AgentSkin's) that hides it.
 *
 * This walks the DOM and adds `.agentskin-wp-transparent` (a `!important`
 * transparent rule) to every element that (a) covers the viewport and
 * (b) has an opaque background — i.e. the agent's shell — without touching
 * smaller content cards. A debounced MutationObserver re-runs it so React
 * re-renders don't re-hide the wallpaper. The change is fully reversible:
 * the removal path strips the class and the style element, restoring the
 * agent's original backgrounds.
 *
 * Runs once per page load (guarded by {@link WALLPAPER_PUNCH_GLOBAL}).
 */
// prettier-ignore
const WALLPAPER_PUNCH_JS = `
(function(){
  var IDS=['${VIDEO_WALLPAPER_ID}','${IMAGE_WALLPAPER_ID}','${VIDEO_SCRIM_ID}','${IMAGE_SCRIM_ID}'];
  var STYLE_ID='${WALLPAPER_PUNCH_STYLE_ID}';
  var CLS='${WALLPAPER_PUNCH_CLASS}';
  var G='${WALLPAPER_PUNCH_GLOBAL}';
  function isWp(el){return el&&el.id&&IDS.indexOf(el.id)>=0;}
  function alpha(c){var m=(c||'').match(/rgba?\\(([^)]+)\\)/);if(!m)return 0;var p=m[1].split(',').map(function(s){return parseFloat(s);});if(p.length<3)return 0;return p.length>=4?p[3]:1;}
  function neutralize(){
    var vw=document.documentElement.clientWidth, vh=document.documentElement.clientHeight;
    (function walk(el){
      if(el.nodeType!==1||isWp(el))return;
      var r=el.getBoundingClientRect();
      if(r.width>=vw*0.95&&r.height>=vh*0.95){
        var cs=getComputedStyle(el);
        if(alpha(cs.backgroundColor)>0.05||(cs.backgroundImage&&cs.backgroundImage!=='none')){
          el.classList.add(CLS);
        }
        var ch=el.children;for(var i=0;i<ch.length;i++)walk(ch[i]);
      }
    })(document.documentElement);
  }
  var st=document.getElementById(STYLE_ID);
  if(!st){st=document.createElement('style');st.id=STYLE_ID;st.textContent='.'+CLS+'{background-color:transparent!important;background-image:none!important;}';document.head.appendChild(st);}
  neutralize();
  if(!window[G]){window[G]=true;var t=null;var mo=new MutationObserver(function(){if(t)return;t=setTimeout(function(){t=null;neutralize();},120);});mo.observe(document.documentElement,{childList:true,subtree:true});}
})();
`;
