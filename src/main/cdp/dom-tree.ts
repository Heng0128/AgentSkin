// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Real DOM Subtree Capture
 *
 * Unlike `snapshot-theme.ts` (which only samples a handful of *landmark*
 * selectors for the Inspector), this walks the agent's **entire** rendered
 * DOM inside the live page and returns a serializable tree of
 * {@link DomTreeNode}s. Each node carries:
 *
 *   - the real tag + class (a styling hook for the preview),
 *   - the real (truncated) text content,
 *   - a **broad** resolved computed-style subset (inlined → self-contained),
 *   - the viewport geometry,
 *   - inlined image data (so `<img>` and `background-image` render for real).
 *
 * The frontend replays this tree inside a sandboxed `<iframe srcdoc>` so the
 * Studio preview is a faithful, frozen rendering of the real agent — not a
 * hand-built mock skeleton.
 *
 * The walk runs inside the agent via `Runtime.evaluate` (a single CDP round
 * trip, awaited) rather than per-node protocol calls, which keeps it fast even
 * for thousands of nodes. Scripts / stylesheets / links / meta are skipped so
 * the serialized output is inert and safe to embed.
 */

import type { DomTreeNode } from '../../shared/types';
import type { CdpSession } from './cdp-client';

/**
 * Computed-style properties worth inlining for a faithful theme preview.
 * Kept broad on purpose: positioning, transforms, flex/grid, background
 * detail, outlines, shadows and filters are what make the replay look like
 * the real agent instead of a bare skeleton.
 */
const TREE_STYLE_PROPS = [
  // color / paint
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'background-clip',
  'background-origin',
  'color',
  'opacity',
  'box-shadow',
  'text-shadow',
  'filter',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'mix-blend-mode',
  'outline-width',
  'outline-color',
  'outline-style',
  // borders / radius
  'border-radius',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-style',
  // spacing
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  // typography
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-overflow',
  'text-transform',
  'white-space',
  'vertical-align',
  'list-style-type',
  'list-style-position',
  // layout / positioning (critical for non-skeletal replay)
  'display',
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'transform',
  'z-index',
  'visibility',
  'box-sizing',
  'overflow',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'object-fit',
  'object-position',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  // interaction / motion
  'cursor',
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  // extra fidelity — overlays / RTL / flex order / intrinsic sizing
  'pointer-events',
  'overflow-x',
  'overflow-y',
  'aspect-ratio',
  'writing-mode',
  'direction',
  'text-indent',
  'order',
  'align-self',
  'justify-self',
  'flex',
] as const;

const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template']);

// Relaxed so complex agent UIs are captured whole instead of truncated to a
// skeleton. The inline-image budget below bounds the payload size.
const MAX_NODES = 2500;
const MAX_DEPTH = 14;
const MAX_TEXT = 120;
/** Total bytes allowed for inlined image data URLs (keeps payload bounded). */
const IMAGE_BUDGET = 1_500_000;
/** Per-image cap; larger images are left as-is (blank in replay). */
const IMAGE_MAX_BYTES = 60_000;
/** Per-image fetch timeout so a slow/hanging asset can't stall the snapshot. */
const IMAGE_TIMEOUT_MS = 1500;
/** Hard cap on how many images we inline, bounding total capture time. */
const IMG_MAX_COUNT = 40;

/**
 * Capture the agent's real DOM subtree.
 *
 * @param session        An open CDP session (Runtime domain available).
 * @param rootSelector   CSS selector for the subtree root; defaults to `body`.
 * @returns the root {@link DomTreeNode}, or `null` on failure / no match.
 */
export async function captureDomTree(
  session: CdpSession,
  rootSelector = 'body',
): Promise<DomTreeNode | null> {
  const expr = `(async function(){
    var PROPS = ${JSON.stringify([...TREE_STYLE_PROPS])};
    var SKIP = ${JSON.stringify([...SKIP_TAGS])};
    var MAX_NODES = ${MAX_NODES};
    var MAX_DEPTH = ${MAX_DEPTH};
    var MAX_TEXT = ${MAX_TEXT};
    var BUDGET = ${IMAGE_BUDGET};
    var IMG_MAX = ${IMAGE_MAX_BYTES};
    var IMG_TO = ${IMAGE_TIMEOUT_MS};
    var IMG_COUNT = 0;
    var IMG_COUNT_MAX = ${IMG_MAX_COUNT};
    var count = 0;

    function b64FromBuf(buf){
      var bytes = new Uint8Array(buf);
      var bin = '';
      var chunk = 0x8000;
      for (var i=0; i<bytes.length; i+=chunk){
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
      }
      return btoa(bin);
    }

    // Cache inlined results by URL so a repeated asset (logo, icon sprite,
    // identical avatars) is fetched only once and never re-counted against the
    // budget. The cached value may be a data URL or the original URL (when the
    // asset was skipped because it was too large / failed to load).
    var urlCache = {};
    async function inlineUrl(url){
      if(!url || url.indexOf('data:') === 0) return url;
      if(Object.prototype.hasOwnProperty.call(urlCache, url)) return urlCache[url];
      if(BUDGET <= 0){ urlCache[url] = url; return url; }
      if (IMG_COUNT >= IMG_COUNT_MAX){ urlCache[url] = url; return url; }
      try {
        var ctrl = new AbortController();
        var to = setTimeout(function(){ ctrl.abort(); }, IMG_TO);
        var resp = await fetch(url, { signal: ctrl.signal, credentials: 'same-origin' });
        clearTimeout(to);
        if(!resp.ok){ urlCache[url] = url; return url; }
        var buf = await resp.arrayBuffer();
        if(buf.byteLength > IMG_MAX){ urlCache[url] = url; return url; }
        BUDGET -= buf.byteLength;
        IMG_COUNT++;
        var mime = resp.headers.get('content-type') || 'image/png';
        var data = 'data:' + mime + ';base64,' + b64FromBuf(buf);
        urlCache[url] = data;
        return data;
      } catch(e){ urlCache[url] = url; return url; }
    }

    async function inlineBg(value){
      if(!value || value === 'none') return value;
      var re = /url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/g;
      var m; var urls = [];
      while((m = re.exec(value))){ urls.push(m[2]); }
      var out = value;
      for (var u of urls){
        var d = await inlineUrl(u);
        if (d !== u) out = out.split(u).join(d);
      }
      return out;
    }

    async function walk(el, depth){
      if(!el || count >= MAX_NODES || depth > MAX_DEPTH) return null;
      if(el.nodeType !== 1) return null;
      var tag = (el.tagName || 'div').toLowerCase();
      if(SKIP.indexOf(tag) !== -1) return null;
      count++;
      var cs = window.getComputedStyle(el);
      var style = {};
      for(var i=0;i<PROPS.length;i++){
        var v = cs.getPropertyValue(PROPS[i]);
        if(v) style[PROPS[i]] = v;
      }
      if (style['background-image'] && style['background-image'] !== 'none'){
        style['background-image'] = await inlineBg(style['background-image']);
      }

      var imgSrc;
      if (tag === 'img'){
        var raw = (el.src || el.getAttribute('src') || '');
        imgSrc = await inlineUrl(raw);
      }

      var text = '';
      var cn = el.childNodes;
      for(var j=0;j<cn.length;j++){
        if(cn[j].nodeType === 3){ text += (cn[j].textContent || ''); }
      }
      text = text.replace(/\\s+/g,' ').trim();
      if(text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
      var r = el.getBoundingClientRect();
      var children = [];
      var kids = el.children;
      for(var k=0;k<kids.length;k++){
        var n = await walk(kids[k], depth+1);
        if(n) children.push(n);
      }
      // Pierce open shadow roots so web-component internals (VS Code / Trae /
      // Cursor UIs are built from custom elements with shadow DOM) are captured
      // instead of rendering as hollow containers in the replay.
      if (el.shadowRoot && el.shadowRoot.mode === 'open') {
        var sk = el.shadowRoot.children;
        for (var s = 0; s < sk.length; s++) {
          var sn = await walk(sk[s], depth + 1);
          if (sn) children.push(sn);
        }
      }
      // Capture SVG geometry so inline vector icons (codicons, etc.) replay
      // faithfully instead of blanking out in the sandboxed preview. Only a
      // whitelisted set of geometry / paint attributes is kept to bound the
      // serialized payload.
      var attrs = {};
      if (el.namespaceURI && String(el.namespaceURI).indexOf('svg') !== -1) {
        var SVG_GEO = ['viewBox','d','points','transform','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','preserveAspectRatio'];
        for (var gi = 0; gi < SVG_GEO.length; gi++) {
          var gv = el.getAttribute(SVG_GEO[gi]);
          if (gv) attrs[SVG_GEO[gi]] = gv;
        }
      }

      var node = {
        tag: tag,
        cls: el.getAttribute ? (el.getAttribute('class') || '') : '',
        text: text ? text : undefined,
        style: style,
        attrs: attrs,
        rect: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) },
        children: children
      };
      if (imgSrc) node.imgSrc = imgSrc;
      return node;
    }

    var root = document.querySelector(${JSON.stringify(rootSelector)}) || document.body;
    if(!root) return null;
    return await walk(root, 0);
  })()`;

  try {
    const res = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = res?.result?.value;
    if (!value) return null;
    return value as DomTreeNode;
  } catch {
    return null;
  }
}
