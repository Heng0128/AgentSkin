// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/guard
 *
 * Enhanced wallpaper guard script builder. Replaces the fragile inline guard
 * previously embedded in each injector.
 *
 * Extracted from the split of {@link ./shared}.
 */

import {
  RENDERER_SELF_HEAL_INTERVAL_MS,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_HEAL_GLOBAL,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_RESIZE_GLOBAL,
  WALLPAPER_STYLE_ID,
  WALLPAPER_TRANSPARENCY_CSS,
} from './constants';

// ---------------------------------------------------------------------------
// Enhanced wallpaper guard (shared by video + image + web paths)
// ---------------------------------------------------------------------------

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
    ${isVideo ? "try{if(wp.tagName==='VIDEO'){wp.play().catch(function(){});}}catch(e){ console.warn('[wallpaper-guard] video play failed:', e); }" : ''}
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
    ${isVideo ? "if(currentWp&&currentWp.tagName==='VIDEO'&&currentWp.paused){try{currentWp.play().catch(function(){});}catch(e){ console.warn('[wallpaper-guard] heal video play failed:', e); }}" : ''}
  },${RENDERER_SELF_HEAL_INTERVAL_MS});
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
