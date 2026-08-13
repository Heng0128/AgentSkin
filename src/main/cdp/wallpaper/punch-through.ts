// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/punch-through
 *
 * Wallpaper "punch-through" script, application helper, visibility
 * verification, and teardown snippet. These pieces work together:
 * the punch-through neutralizes the agent's opaque full-bleed shell so
 * the wallpaper becomes visible; the teardown reverses it cleanly.
 *
 * Extracted from the split of {@link ./shared}.
 */

import {
  IMAGE_SCRIM_ID,
  IMAGE_WALLPAPER_ID,
  VIDEO_SCRIM_ID,
  VIDEO_WALLPAPER_ID,
  WALLPAPER_CONTAINER_ID,
  WEB_SCRIM_ID,
  WEB_WALLPAPER_ID,
} from '../../../shared/injection-constants';
import type { CdpSession } from '../cdp-client';
import {
  WALLPAPER_HEAL_GLOBAL,
  WALLPAPER_PUNCH_CLASS,
  WALLPAPER_PUNCH_GLOBAL,
  WALLPAPER_PUNCH_STYLE_ID,
  WALLPAPER_RESIZE_GLOBAL,
} from './constants';

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
 * Runs once per page load (guarded by WALLPAPER_PUNCH_GLOBAL).
 */
// prettier-ignore
export const WALLPAPER_PUNCH_JS = `
(function(){
  var IDS=['${VIDEO_WALLPAPER_ID}','${IMAGE_WALLPAPER_ID}','${WEB_WALLPAPER_ID}','${VIDEO_SCRIM_ID}','${IMAGE_SCRIM_ID}','${WEB_SCRIM_ID}','${WALLPAPER_CONTAINER_ID}'];
  var STYLE_ID='${WALLPAPER_PUNCH_STYLE_ID}';
  var CLS='${WALLPAPER_PUNCH_CLASS}';
  var G='${WALLPAPER_PUNCH_GLOBAL}';
  if(!window[G+'_els']){window[G+'_els']=new Set();}
  function track(el){window[G+'_els'].add(el);}
  function isWp(el){return el&&el.id&&IDS.indexOf(el.id)>=0;}
  function isSidebar(el){
    if(!el)return false;
    var tag=el.tagName;
    if(tag!=='DIV'&&tag!=='NAV'&&tag!=='ASIDE'&&tag!=='SECTION')return false;
    var id=el.id||'',cn=el.className||'',role=el.getAttribute('role')||'',dvid=el.getAttribute('data-view-id')||'',das=el.getAttribute('data-agentskin-sidebar')||'';
    if(typeof cn!=='string'){cn=cn.baseVal||'';}
    if(das==='1')return true;
    if(dvid==='sidebar')return true;
    if(id==='sidebar'||id==='Sidebar')return true;
    if(cn.indexOf('sidebar')>=0||cn.indexOf('Sidebar')>=0)return true;
    if(tag==='NAV')return true;
    if(tag==='ASIDE'&&role==='navigation')return true;
    if(role==='navigation'||role==='complementary')return true;
    var r=el.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
    if(r.left<60&&r.height>vh*0.5&&r.width<350&&r.width>40)return true;
    return false;
  }
  function insideSidebar(el){
    // Walk up to find a sidebar ancestor. 6 levels covers the typical
    // platform structures (e.g. workbuddy: sidebar>div>div>list>item>button
    // = 4 levels). If a future agent introduces deeper nesting, bump this
    // ceiling or switch to a tagged-pointer approach (set a marker on the
    // sidebar element once, then check for it in O(1)).
    var p=el.parentElement,d=0;
    while(p&&d<6){
      if(p===document.documentElement||p===document.body)return false;
      if(isSidebar(p))return true;
      p=p.parentElement;d++;
    }
    return false;
  }
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
      if(window[G+'_mo']){ try{ window[G+'_mo'].disconnect(); }catch(e){ console.warn('[wallpaper-punch] observer disconnect failed:', e); } delete window[G+'_mo']; }
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
          //
          // SIDEBAR EXEMPTION: sidebars (nav, aside, [data-*=sidebar]) depend
          // on transform/contain to establish scroll containers and stacking
          // contexts for their internal buttons. Stripping those properties
          // makes the sidebar buttons unclickable ("visible but inert"). We
          // preserve the full original logic for everything else, but skip
          // layout-property stripping on the sidebar and its descendants so
          // pointer-events / hit-testing remain intact.
          if(!isSidebar(el)&&!insideSidebar(el)){
            el.style.setProperty('transform','none','important');
            el.style.setProperty('filter','none','important');
            el.style.setProperty('perspective','none','important');
            el.style.setProperty('contain','none','important');
            el.style.setProperty('will-change','auto','important');
          }
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
    var mo=new MutationObserver(function(mutations){
      // Only re-run neutralize when a non-wallpaper element changed. Pure
      // wallpaper-container DOM churn or data-agentskin-* attribute updates
      // triggered by adapters must not force another DOM walk — doing so
      // re-applies transform:none / contain:none and re-breaks the sidebar.
      var shouldRun=false;
      for(var mi=0;mi<mutations.length;mi++){
        var m=mutations[mi];
        if(m.type!=='childList')continue;
        var nodes=m.addedNodes.length>=m.removedNodes.length?m.addedNodes:m.removedNodes;
        for(var ni=0;ni<nodes.length;ni++){
          var n=nodes[ni];
          if(n.nodeType===1&&!isWp(n)&&n.id&&n.id.indexOf('agentskin')<0){shouldRun=true;break;}
        }
        if(shouldRun)break;
      }
      if(!shouldRun)return;
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
// Punch-through teardown (shared by all removal paths)
// ---------------------------------------------------------------------------

/**
 * Punch-through teardown snippet — embedded inside CDP evaluate calls by
 * `removeAllWallpapers` and the individual `remove*Wallpaper` functions.
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
