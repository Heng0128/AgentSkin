// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper-ns.mjs — page-side wallpaper mounts (window.__agentskin__.wallpaper)
 *
 * Invoked from the AgentSkin main process over CDP evaluate:
 *   window.__agentskin__.wallpaper.applyImage|applyVideo|applyWeb|removeAll(opts)
 *
 * Callers: src/main/cdp/cdp-wallpaper-inject.ts (evalWallpaper call builders);
 * verdict strings returned ('ok' | 'invalid-url' | ...) are consumed by the
 * injector pipeline. CSS/alignment/filter semantics mirror
 * @shared/wallpaper-render (the renderer-side twin) so the same wallpaper
 * renders identically on the desktop UI background and in agent windows.
 *
 * This file is read by the main process (raw source) and evaluated in the
 * target page BEFORE any mount call — the wallpaper pipeline does not run the
 * theme engine, so the namespace cannot be assumed to exist.
 */
(function installWallpaperNamespace() {
  var NS = (window.__agentskin__ = window.__agentskin__ || {});
  if (NS.wallpaper) return; // idempotent across re-evaluations

  var LAYER_ID = 'agentskin-wallpaper-layer';
  var SCRIM_ID = 'agentskin-wallpaper-scrim';
  var MEDIA_ID = 'agentskin-wallpaper-media';
  var POINTER_FLAG = '__agentskinWpPointerForward';

  function root() {
    var el = document.getElementById(LAYER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = LAYER_ID;
      // z-index 0 fixed layer behind the app shell (app content is elevated
      // by the theme engine's transparent container background).
      el.style.cssText =
        'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
      (document.body || document.documentElement).prepend(el);
    }
    return el;
  }

  function ensureScrim(opacity) {
    var o = typeof opacity === 'number' ? Math.min(100, Math.max(0, opacity)) : 55;
    var el = document.getElementById(SCRIM_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = SCRIM_ID;
      (document.body || document.documentElement).prepend(el);
    }
    el.style.cssText =
      'position:fixed;inset:0;z-index:0;pointer-events:none;background:rgba(0,0,0,' +
      (o / 100).toFixed(3) +
      ');';
    return el;
  }

  function objectFitFor(alignment) {
    switch (alignment) {
      case 'stretch':
        return 'fill';
      case 'fit':
        return 'contain';
      case 'center':
      case 'tile':
        return 'none';
      default:
        return 'cover';
    }
  }

  function objectPositionFor(render) {
    var x = render && typeof render.positionX === 'number' ? render.positionX : 0;
    var y = render && typeof render.positionY === 'number' ? render.positionY : 0;
    return 'calc(50% + ' + x + '%) calc(50% + ' + y + '%)';
  }

  function flipTransformFor(render) {
    var sx = render && render.flipH ? -1 : 1;
    var sy = render && render.flipV ? -1 : 1;
    if (sx === 1 && sy === 1) return '';
    return 'scaleX(' + sx + ') scaleY(' + sy + ')';
  }

  function hueFor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 0;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 0xff) / 255;
    var g = ((n >> 8) & 0xff) / 255;
    var b = (n & 0xff) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    if (max === min) return 0;
    var h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    var deg = h * 60;
    return deg < 0 ? deg + 360 : deg;
  }

  function filterFor(render) {
    if (!render) return '';
    var parts = [];
    if (render.brightness !== undefined && render.brightness !== 100)
      parts.push('brightness(' + (render.brightness / 100).toFixed(2) + ')');
    if (render.contrast !== undefined && render.contrast !== 100)
      parts.push('contrast(' + (render.contrast / 100).toFixed(2) + ')');
    if (render.saturation !== undefined && render.saturation !== 100)
      parts.push('saturate(' + (render.saturation / 100).toFixed(2) + ')');
    if (render.hueRotate !== undefined && render.hueRotate !== 0)
      parts.push('hue-rotate(' + render.hueRotate + 'deg)');
    if (render.sepia !== undefined && render.sepia > 0)
      parts.push('sepia(' + (render.sepia / 100).toFixed(2) + ')');
    if (render.grayscale !== undefined && render.grayscale > 0)
      parts.push('grayscale(' + (render.grayscale / 100).toFixed(2) + ')');
    if (render.blur !== undefined && render.blur > 0) parts.push('blur(' + render.blur + 'px)');
    if (render.tint) {
      var hue = Math.round(hueFor(render.tint));
      parts.push('sepia(1) saturate(2.5) hue-rotate(' + hue + 'deg)');
    }
    return parts.join(' ');
  }

  function mediaStyle(render) {
    var alignment = render && render.alignment;
    var fit = objectFitFor(alignment);
    var css =
      'position:absolute;inset:0;width:100%;height:100%;' +
      'object-position:' + objectPositionFor(render) + ';';
    if (fit !== 'cover') css += 'object-fit:' + fit + ';';
    var flip = flipTransformFor(render);
    if (flip) css += 'transform:' + flip + ';';
    var filter = filterFor(render);
    if (filter) css += 'filter:' + filter + ';';
    return css;
  }

  function resolveSrc(opts) {
    var src = null;
    if (typeof opts.src === 'string' && opts.src) src = opts.src;
    else if (typeof opts.srcGlobal === 'string' && opts.srcGlobal && window[opts.srcGlobal]) {
      src = String(window[opts.srcGlobal]);
      try {
        delete window[opts.srcGlobal];
      } catch (e) {
        window[opts.srcGlobal] = undefined;
      }
    }
    if (!src) return null;
    // Main-process callers wrap http(s) URLs as CSS url(...) — strip it.
    var m = /^url\((.*)\)$/i.exec(src.trim());
    if (m) src = m[1].replace(/^['"]|['"]$/g, '');
    return src;
  }

  function clearLayer() {
    var layer = document.getElementById(LAYER_ID);
    if (layer) layer.innerHTML = '';
  }

  // Mouse parallax for image/video layers: scale(1.1) + up to 40px offset,
  // opposite the cursor (identical math to the desktop DynamicBackground).
  var parallaxStrength = 0;
  var parallaxBound = false;
  function bindParallax() {
    if (parallaxBound) return;
    parallaxBound = true;
    window.addEventListener(
      'mousemove',
      function (e) {
        if (parallaxStrength <= 0) return;
        var el = document.getElementById(LAYER_ID);
        if (!el || !el.firstChild) return;
        var nx = e.clientX / window.innerWidth - 0.5;
        var ny = e.clientY / window.innerHeight - 0.5;
        var MAX_OFFSET = 40;
        el.style.transform =
          'scale(1.1) translate(' +
          (-nx * parallaxStrength * MAX_OFFSET).toFixed(2) + 'px, ' +
          (-ny * parallaxStrength * MAX_OFFSET).toFixed(2) + 'px)';
      },
      { passive: true },
    );
  }

  // Pointer forwarding for web/scene iframes (pointer-events:none — they
  // never receive real mousemove). Same postMessage shape as DynamicBackground.
  function bindPointerForward() {
    if (window[POINTER_FLAG]) return;
    window[POINTER_FLAG] = function (e) {
      var layer = document.getElementById(LAYER_ID);
      var f = layer && layer.querySelector('iframe');
      if (!f || !f.contentWindow || !f.src) return;
      var target;
      try {
        target = new URL(f.src, window.location.href).origin;
      } catch (e2) {
        return;
      }
      try {
        f.contentWindow.postMessage(
          {
            __agentskin: true,
            type: 'pointer',
            data: { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight },
          },
          target,
        );
      } catch (e3) {
        /* cross-origin — degrade silently */
      }
    };
    window.addEventListener('mousemove', window[POINTER_FLAG], { passive: true });
  }

  // Pause bridge: wallpaper-lifecycle.ts evaluates AGENTSKIN_WP_PAUSE(true|false)
  // on suspend / on-battery / resume / on-ac power events.
  function installPauseBridge(video) {
    window.AGENTSKIN_WP_PAUSE = function (paused) {
      try {
        if (paused) {
          video.pause();
        } else {
          var p = video.play();
          if (p && typeof p.catch === 'function') p.catch(function () {});
        }
      } catch (e) {
        /* media may be gone */
      }
    };
  }

  NS.wallpaper = {
    /** Looping muted fullscreen <video>. opts: src|srcGlobal, mime, speed,
     *  loop, render {scrimOpacity, alignment, positionX/Y, flipH/V, filters,
     *  parallax}. Returns 'ok' or 'invalid-url'. */
    applyVideo: function (opts) {
      opts = opts || {};
      var src = resolveSrc(opts);
      if (!src) return 'invalid-url';
      var render = opts.render || {};
      clearLayer();
      var layer = root();
      var v = document.createElement('video');
      v.id = MEDIA_ID;
      v.src = src;
      v.autoplay = true;
      v.loop = opts.loop === undefined ? true : opts.loop !== false;
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.style.cssText = mediaStyle(render);
      if (typeof opts.speed === 'number' && opts.speed > 0) v.playbackRate = opts.speed;
      v.addEventListener('error', function () {
        v.dataset.wpError = '1';
      });
      layer.appendChild(v);
      ensureScrim(render.scrimOpacity);
      parallaxStrength = Math.min(1, Math.max(0, render.parallax || 0) / 100);
      if (parallaxStrength > 0) bindParallax();
      installPauseBridge(v);
      var p = v.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
      return 'ok';
    },

    /** Fullscreen <img> (http(s) / data: URL). Returns 'ok' | 'invalid-url'. */
    applyImage: function (opts) {
      opts = opts || {};
      var src = resolveSrc(opts);
      if (!src) return 'invalid-url';
      var render = opts.render || {};
      clearLayer();
      var layer = root();
      var img = document.createElement('img');
      img.id = MEDIA_ID;
      img.src = src;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = mediaStyle(render);
      layer.appendChild(img);
      ensureScrim(render.scrimOpacity);
      parallaxStrength = Math.min(1, Math.max(0, render.parallax || 0) / 100);
      if (parallaxStrength > 0) bindParallax();
      return 'ok';
    },

    /** Fullscreen iframe for web/scene wallpapers. opts: url, render. */
    applyWeb: function (opts) {
      opts = opts || {};
      var src = typeof opts.url === 'string' && opts.url ? opts.url : resolveSrc(opts);
      if (!src) return 'invalid-url';
      var render = opts.render || {};
      clearLayer();
      var layer = root();
      var frame = document.createElement('iframe');
      frame.id = MEDIA_ID;
      frame.src = src;
      frame.title = 'wallpaper';
      frame.allow = 'autoplay';
      frame.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;';
      var flip = flipTransformFor(render);
      var filter = filterFor(render);
      // filter shifts with the element's own transform — pin with translateZ(0).
      if (flip || filter) frame.style.transform = (flip + ' translateZ(0)').trim();
      if (filter) frame.style.filter = filter;
      layer.appendChild(frame);
      ensureScrim(render.scrimOpacity);
      if ((render.parallax || 0) > 0) bindPointerForward();
      return 'ok';
    },

    /** Remove every wallpaper element + scrim + hooks. */
    removeAll: function () {
      var layer = document.getElementById(LAYER_ID);
      if (layer) layer.remove();
      var scrim = document.getElementById(SCRIM_ID);
      if (scrim) scrim.remove();
      parallaxStrength = 0;
      try {
        delete window.AGENTSKIN_WP_PAUSE;
      } catch (e) {
        window.AGENTSKIN_WP_PAUSE = undefined;
      }
      return 'ok';
    },
  };
  return 'ok';
})();
