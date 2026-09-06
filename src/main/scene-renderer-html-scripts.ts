// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene Renderer HTML Scripts (inline <script> generator)
 *
 * Generates a self-contained HTML document with an inline canvas renderer
 * for scene-type wallpapers. Extracted from scene-renderer-html.ts as part
 * of the SRP refactor (P0-3).
 *
 * The renderer is a self-contained IIFE — no external scripts, no imports.
 * Coordinate + cover-fit helpers are embedded by source (`fn.toString()`)
 * so the inline script always uses the same math the unit tests assert
 * (single source of truth).
 */

import type { SceneData } from './scene-pkg-parser';
import { layerDrawSize, sceneLayerCenter } from './scene-renderer-coords';
import type { RenderLayer } from './scene-renderer-types';

// ---------------------------------------------------------------------------
// HTML document generation
// ---------------------------------------------------------------------------

/**
 * Build the complete HTML document with an inline canvas renderer.
 * The renderer is a self-contained IIFE — no external scripts, no imports.
 */
export function buildHtmlDocument(scene: SceneData, layers: RenderLayer[]): string {
  const clearColor = scene.general.clearColor;
  const bgColor = `rgb(${Math.round(clearColor.r * 255)}, ${Math.round(clearColor.g * 255)}, ${Math.round(clearColor.b * 255)})`;
  const projWidth = scene.general.orthogonalProjection.width || 1920;
  const projHeight = scene.general.orthogonalProjection.height || 1080;
  const parallaxEnabled = scene.general.cameraParallax;
  const parallaxAmount = scene.general.cameraParallaxAmount || 0;

  // Serialize layers as JSON for the inline script to consume.
  // dataUrls are already strings — safe to embed in JSON.
  const layersJson = JSON.stringify(layers);

  // Embed the coordinate + cover-fit helpers by source so the inline script
  // always uses the same math the unit tests assert (single source of truth).
  const coordHelper = `(${sceneLayerCenter.toString()})`;
  const drawSizeHelper = `(${layerDrawSize.toString()})`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scene Wallpaper</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: ${bgColor}; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="scene"></canvas>
<script>
(function() {
  'use strict';
  var LAYERS = ${layersJson};
  var PROJ_W = ${projWidth};
  var PROJ_H = ${projHeight};
  var PARALLAX = ${parallaxEnabled ? 'true' : 'false'};
  var PARALLAX_AMOUNT = ${parallaxAmount};
  var BG_COLOR = "${bgColor}";
  var SCENE_COORD = ${coordHelper};
  var LAYER_DRAW_SIZE = ${drawSizeHelper};

  var canvas = document.getElementById('scene');
  var ctx = canvas.getContext('2d');
  var images = [];
  var mouseX = 0, mouseY = 0;
  var targetMouseX = 0, targetMouseY = 0;

  // Preload all texture images. Animated layers preload every frame's image;
  // the render loop switches the drawn image on each frame's accumulated
  // timing (see current[i] below).
  var loaded = 0;
  var totalToLoad = 0;
  for (var i = 0; i < LAYERS.length; i++) {
    var imgs = [];
    if (LAYERS[i].frames && LAYERS[i].frames.length > 0) {
      for (var f = 0; f < LAYERS[i].frames.length; f++) {
        totalToLoad++;
        (function(imgIndex, src) {
          var img = new Image();
          img.onload = function() { loaded++; if (loaded >= totalToLoad) render(); };
          img.onerror = function() { loaded++; if (loaded >= totalToLoad) render(); };
          img.src = src;
          imgs[imgIndex] = img;
        })(f, LAYERS[i].frames[f].dataUrl);
      }
    } else if (LAYERS[i].dataUrl) {
      totalToLoad++;
      var img = new Image();
      img.onload = function() { loaded++; if (loaded >= totalToLoad) render(); };
      img.onerror = function() { loaded++; if (loaded >= totalToLoad) render(); };
      img.src = LAYERS[i].dataUrl;
      imgs[0] = img;
    }
    images[i] = imgs.length > 0 ? imgs : null;
  }

  // Particle simulation sources: one state block per particle layer. Sprites
  // preload like the static layers above so the first frame has them ready.
  var PSOURCES = [];
  for (var i = 0; i < LAYERS.length; i++) {
    if (LAYERS[i].particle) {
      PSOURCES.push({ cfg: LAYERS[i].particle, parts: [], emitAcc: 0, lastT: null, img: null });
    }
  }
  for (var i = 0; i < PSOURCES.length; i++) {
    (function(ps) {
      var src = ps.cfg.image;
      if (src) {
        totalToLoad++;
        var img = new Image();
        img.onload = function() { loaded++; if (loaded >= totalToLoad) render(); };
        img.onerror = function() { loaded++; if (loaded >= totalToLoad) render(); };
        img.src = src;
        ps.img = img;
      }
    })(PSOURCES[i]);
  }

  // If nothing to load, render immediately (solid layers only).
  if (totalToLoad === 0) render();

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function render() {
    var w = window.innerWidth;
    var h = window.innerHeight;

    // Clear with background color.
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Scale factor: 'cover' fit the projection into the viewport (fill the
    // whole screen, cropping the edges if the aspect ratios differ — same as
    // the <img>/<video> wallpaper paths' object-fit:cover).
    var scale = Math.max(w / PROJ_W, h / PROJ_H);

    // Smooth parallax mouse interpolation.
    mouseX += (targetMouseX - mouseX) * 0.05;
    mouseY += (targetMouseY - mouseY) * 0.05;

    for (var i = 0; i < LAYERS.length; i++) {
      var layer = LAYERS[i];
      ctx.save();
      ctx.globalAlpha = layer.alpha;

      // Parallax offset: deeper layers move less.
      var parallaxX = 0, parallaxY = 0;
      if (PARALLAX) {
        var depth = layer.parallaxDepth;
        parallaxX = mouseX * PARALLAX_AMOUNT * depth * 10;
        parallaxY = mouseY * PARALLAX_AMOUNT * depth * 10;
      }

      // Convert the layer's WE scene-space origin (projection bottom-left,
      // +y up) to a canvas-space center (viewport top-left, +y down).
      var pos = SCENE_COORD(layer.x, layer.y, PROJ_W, PROJ_H, w, h);
      var drawX = pos.x + parallaxX;
      var drawY = pos.y + parallaxY;

      ctx.translate(drawX, drawY);
      ctx.rotate(layer.rotation);

      // Mirror negative scale: Wallpaper Engine flips objects by setting a
      // negative scaleX/scaleY. ctx.drawImage throws IndexSizeError on
      // negative dimensions, so we flip the local axes via ctx.scale and draw
      // with absolute sizes. (ctx.fillRect tolerates negative dims, but the
      // same abs+mirror keeps both branches consistent.)
      var sx = layer.scaleX < 0 ? -1 : 1;
      var sy = layer.scaleY < 0 ? -1 : 1;
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      var absScaleX = Math.abs(layer.scaleX);
      var absScaleY = Math.abs(layer.scaleY);

      if (layer.solidColor) {
        // Solid color fill
        var fillW = layer.width * scale * absScaleX;
        var fillH = layer.height * scale * absScaleY;
        var r = Math.round(layer.solidColor.r * 255);
        var g = Math.round(layer.solidColor.g * 255);
        var b = Math.round(layer.solidColor.b * 255);
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillRect(-fillW / 2, -fillH / 2, fillW, fillH);
      } else if (images[i] && images[i][current[i] || 0]) {
        // Textured layer: draw at the object's QUAD size (layer.width/height)
        // while PRESERVING the texture's own aspect ratio (texAspect) —
        // cover-fit the texture into the quad area and crop the overflow.
        // WE quads are positioning frames, not a target aspect: drawing the
        // texture stretched to the quad flattens square 2048² sources onto
        // 16:9 frames (the "壁纸被压扁/压缩" symptom). Cover-fit keeps the
        // source undistorted and centered, exactly like <img object-fit:cover>.
        var img = images[i][current[i] || 0];
        if (img.complete && img.naturalWidth > 0) {
          var quadW = layer.width * scale * absScaleX;
          var quadH = layer.height * scale * absScaleY;
          var draw = LAYER_DRAW_SIZE(quadW, quadH, layer.texAspect || 1);
          ctx.drawImage(img, -draw.width / 2, -draw.height / 2, draw.width, draw.height);
        }
      }

      ctx.restore();
    }
  }

  // Mouse tracking for parallax
  window.addEventListener('mousemove', function(e) {
    targetMouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetMouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  // Cross-origin signal bridge: the iframe is pointer-events:none inside the
  // agent page, so it never receives mousemove — the agent page forwards
  // pointer + audio levels via postMessage (see buildWpSignalBridgeJs in
  // cdp/wallpaper/shared.ts). This listener resurrects scene parallax in
  // agent windows and drives the audio breathing.
  var audioLevel = 0; // smoothed 0..1
  var audioTarget = 0;
  window.addEventListener('message', function(e) {
    var d = e && e.data;
    if (!d || !d.__agentskin) return;
    if (d.type === 'pointer' && d.data) {
      targetMouseX = (d.data.x - 0.5) * 2;
      targetMouseY = (d.data.y - 0.5) * 2;
    } else if (d.type === 'audio' && d.data && typeof d.data.level === 'number') {
      audioTarget = Math.max(0, Math.min(1, d.data.level));
    }
  });

  window.addEventListener('resize', resize);

  // --- Basic 2D particle simulation (WE particle presets) ---
  function randRange(min, max) { return min + Math.random() * (max - min); }

  function spawnParticle(cfg) {
    var x = cfg.origin.x;
    var y = cfg.origin.y;
    if (cfg.spawn === 'box') {
      x += (Math.random() * 2 - 1) * cfg.directions.x;
      y += (Math.random() * 2 - 1) * cfg.directions.y;
    } else {
      var dist = cfg.distanceMin + Math.random() * (cfg.distanceMax - cfg.distanceMin);
      var ang = Math.random() * Math.PI * 2;
      x += Math.cos(ang) * dist;
      y += Math.sin(ang) * dist;
    }
    var size = randRange(cfg.sizeMin, cfg.sizeMax);
    return {
      x: x, y: y,
      vx: randRange(cfg.velocityMin.x, cfg.velocityMax.x),
      vy: randRange(cfg.velocityMin.y, cfg.velocityMax.y),
      age: 0,
      life: Math.max(0.05, randRange(cfg.lifetimeMin, cfg.lifetimeMax)),
      size: size > 0 ? size : 1,
      r: randRange(cfg.colorMin.r, cfg.colorMax.r) * (cfg.tint ? cfg.tint.r : 1),
      g: randRange(cfg.colorMin.g, cfg.colorMax.g) * (cfg.tint ? cfg.tint.g : 1),
      b: randRange(cfg.colorMin.b, cfg.colorMax.b) * (cfg.tint ? cfg.tint.b : 1)
    };
  }

  function stepParticles(t) {
    for (var s = 0; s < PSOURCES.length; s++) {
      var ps = PSOURCES[s];
      if (!ps.lastT) { ps.lastT = t; continue; }
      var dt = Math.min(0.1, (t - ps.lastT) / 1000);
      ps.lastT = t;
      var cfg = ps.cfg;
      // Emit at the configured rate (accumulate fractional seconds).
      ps.emitAcc += cfg.rate * dt;
      var n = Math.floor(ps.emitAcc);
      ps.emitAcc -= n;
      while (n > 0 && ps.parts.length < cfg.maxCount) {
        ps.parts.push(spawnParticle(cfg));
        n--;
      }
      // Integrate position/velocity; drop dead particles.
      for (var i = ps.parts.length - 1; i >= 0; i--) {
        var p = ps.parts[i];
        p.age += dt;
        if (p.age >= p.life) { ps.parts.splice(i, 1); continue; }
        p.vx += cfg.gravity.x * dt;
        p.vy += cfg.gravity.y * dt;
        var drag = Math.max(0, 1 - cfg.drag * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  function drawParticles(w, h, audio) {
    // Viewport cover scale (constant per frame) — used to size particles in
    // canvas px from their scene-space sizes.
    var coverScale = SCENE_COORD(0, 0, PROJ_W, PROJ_H, w, h).scale;
    for (var s = 0; s < PSOURCES.length; s++) {
      var ps = PSOURCES[s];
      if (ps.parts.length === 0) continue;
      var cfg = ps.cfg;
      ctx.save();
      // Additive materials (light shafts, halos) approximate with 'lighter'.
      ctx.globalCompositeOperation = cfg.additive ? 'lighter' : 'source-over';
      for (var i = 0; i < ps.parts.length; i++) {
        var p = ps.parts[i];
        var pos = SCENE_COORD(p.x, p.y, PROJ_W, PROJ_H, w, h);
        // Fade in over fadeInTime; fade out in the last 20% of life.
        var a = cfg.fadeInTime > 0 ? Math.min(1, p.age / cfg.fadeInTime) : 1;
        var lifeLeft = 1 - p.age / p.life;
        if (lifeLeft < 0.2) a *= lifeLeft / 0.2;
        if (a <= 0.01) continue;
        ctx.globalAlpha = cfg.alpha * a;
        // Audio pulse scales particle size like the layer breathing.
        var size = Math.abs(p.size * coverScale * cfg.scaleX) * (1 + audio * 0.2);
        var wd = size;
        var hd = size / cfg.aspect;
        var col = 'rgb(' + Math.round(p.r * 255) + ',' + Math.round(p.g * 255) + ',' + Math.round(p.b * 255) + ')';
        ctx.fillStyle = col;
        if (cfg.rotation !== 0) {
          ctx.save();
          ctx.translate(pos.x, pos.y);
          ctx.rotate(cfg.rotation);
          if (ps.img && ps.img.complete && ps.img.naturalWidth > 0) {
            ctx.drawImage(ps.img, -wd / 2, -hd / 2, wd, hd);
          } else {
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(0.5, wd / 2), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        } else if (ps.img && ps.img.complete && ps.img.naturalWidth > 0) {
          ctx.drawImage(ps.img, pos.x - wd / 2, pos.y - hd / 2, wd, hd);
        } else {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, Math.max(0.5, wd / 2), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // Animation loop for smooth parallax + audio breathing + GIF frame advance
  var current = []; // per-layer current frame index
  var lastFrameAt = []; // per-layer timestamp of the last frame switch
  var accum = []; // per-layer accumulated time past the current frame
  function advanceFrames(t) {
    var changed = false;
    for (var i = 0; i < LAYERS.length; i++) {
      var fr = LAYERS[i].frames;
      if (!fr || fr.length < 2) continue;
      if (!lastFrameAt[i]) {
        lastFrameAt[i] = t;
        accum[i] = 0;
        continue;
      }
      accum[i] += t - lastFrameAt[i];
      lastFrameAt[i] = t;
      while (true) {
        var idx = current[i] || 0;
        var ft = fr[idx].frametime;
        if (!(ft > 0)) ft = 0.1; // guard against malformed/zero durations
        if (accum[i] < ft * 1000) break;
        accum[i] -= ft * 1000;
        current[i] = (idx + 1) % fr.length;
        changed = true;
      }
    }
    return changed;
  }
  function animate() {
    var t = Date.now();
    // Smooth the audio level (attack/decay like a meter).
    audioLevel += (audioTarget - audioLevel) * 0.2;
    if (audioLevel < 0.001) audioLevel = 0;
    var needAudio = audioLevel > 0.005;
    var framesChanged = advanceFrames(t);
    stepParticles(t);
    var hasParticles = PSOURCES.length > 0;
    var w = window.innerWidth;
    var h = window.innerHeight;
    var dirty = framesChanged || hasParticles;
    if (PARALLAX) {
      var dx = Math.abs(targetMouseX - mouseX);
      var dy = Math.abs(targetMouseY - mouseY);
      if (dx > 0.001 || dy > 0.001 || needAudio) dirty = true;
    } else if (needAudio) {
      dirty = true;
    }
    if (dirty) {
      // Audio breathing: gentle scale pulse driven by the smoothed level.
      if (needAudio) {
        var pulse = 1 + audioLevel * 0.04 * (0.6 + 0.4 * Math.sin(t / 220));
        ctx.setTransform(dpr * pulse, 0, 0, dpr * pulse, 0, 0);
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      render();
      if (hasParticles) drawParticles(w, h, audioLevel);
    }
    requestAnimationFrame(animate);
  }
  animate();

  resize();
})();
</script>
</body>
</html>`;
}
