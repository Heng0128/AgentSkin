// SPDX-License-Identifier: MPL-2.0

/**
 * # scene-renderer-html
 *
 * Converts a Wallpaper Engine scene.pkg into a self-contained HTML page with
 * a 2D canvas renderer. The output is a complete HTML document (no external
 * dependencies) that can be served via `wallpaperMediaServer.registerHtml`
 * and loaded in an iframe for scene-type wallpaper previews.
 *
 * The renderer implements a simplified 2D layered view of the 3D scene:
 *   - Each visible object with a resolved texture is drawn as a positioned
 *     image layer on a `<canvas>`.
 *   - Layers are sorted by `parallaxDepth` (back to front).
 *   - Solid-color layers fill the canvas with their `color`.
 *   - Camera parallax (mouse-influenced layer offset) is applied when
 *     `general.cameraParallax` is enabled.
 *   - The canvas auto-resizes to fill the viewport.
 *
 * This is NOT a full WebGL scene renderer — it provides a reasonable static
 * preview of layered/image-based wallpapers. Complex 3D scenes with custom
 * shaders, particle systems, or lighting models will render as flattened
 * layers without their shader effects.
 */

import type { SceneData, SceneObject } from './scene-pkg-parser';
import { extractScene, resolveObjectTexture } from './scene-pkg-parser';

/**
 * Render a scene.pkg file into a self-contained HTML string.
 *
 * @param pkgPath Absolute path to the `.pkg` file.
 * @returns A complete HTML document string, or `null` if the pkg could not
 *          be parsed or contains no renderable content.
 */
export function renderSceneToHtml(pkgPath: string): string | null {
  // P2-3: extractScene is a synchronous binary parser that can throw on
  // corrupted / truncated .pkg files. Previously the throw bubbled up to
  // whichever IPC handler called renderSceneToHtml, taking the whole
  // handler down (and returning no response to the waiting renderer).
  // We now catch any throw and degrade to `null` (same contract as a
  // parse failure with no renderable content).
  let scene: SceneData | null = null;
  try {
    scene = extractScene(pkgPath);
  } catch {
    return null;
  }
  if (!scene) return null;

  let layers: RenderLayer[] = [];
  try {
    layers = buildRenderLayers(scene);
  } catch {
    return null;
  }
  if (layers.length === 0 && !scene.general.clearEnabled) return null;

  return buildHtmlDocument(scene, layers);
}

// ---------------------------------------------------------------------------
// Layer extraction
// ---------------------------------------------------------------------------

interface RenderLayer {
  /** Texture data URL (null for solid-color layers). */
  dataUrl: string | null;
  /** Origin x in scene space (centered at canvas center). */
  x: number;
  /** Origin y in scene space. */
  y: number;
  /** Scale factor (1 = native texture size). */
  scaleX: number;
  scaleY: number;
  /** Rotation in radians. */
  rotation: number;
  /** Opacity (0-1). */
  alpha: number;
  /** Solid fill color (for solidLayer objects). */
  solidColor: { r: number; g: number; b: number } | null;
  /** Parallax depth (negative = further back, positive = closer). */
  parallaxDepth: number;
  /** Display quad size in scene units — the quad the texture/solid is mapped
   *  onto. For textured layers this is the OBJECT's declared size (obj.size),
   *  NOT the texture's native resolution: Wallpaper Engine maps textures
   *  (almost always square power-of-two, e.g. 2048×2048) onto the object's
   *  16:9 quad, so drawing at the raw texture size zooms every layer by its
   *  texture/quad ratio — which varies per wallpaper and produced the
   *  "some full / some half / some a corner only" symptom. Falls back to the
   *  texture size when the object declares no size (0/undefined). */
  width: number;
  height: number;
  /** Texture aspect ratio (width/height) for textured layers; null for solid
   *  layers. The texture is drawn PRESERVING this ratio (cover-fit into the
   *  quad area), never stretched — WE quads are just positioning frames. A
   *  square 2048² texture on a 16:9 quad must render square, centered, with
   *  the overflow cropped; drawing it stretched to the quad is the
   *  "壁纸被压扁/压缩" symptom. */
  texAspect: number | null;
}

/**
 * Resolve the display quad size (in scene units) for a layer: the object's
 * declared `size` when non-zero, else the texture's native resolution.
 *
 * Wallpaper Engine maps a texture onto the object's quad — the quad size
 * (obj.size × obj.scale) is what actually appears on screen. Textures are
 * almost always square power-of-two (2048²/4096²/8192²) regardless of the
 * quad's 16:9 aspect, so using the texture's raw resolution as the display
 * size zooms each layer by its per-wallpaper texture/quad ratio. Drawn at the
 * quad size instead, a fullscreen background (obj.size = projection size)
 * fills the viewport exactly — the same result on every wallpaper.
 *
 * @param objectSize  The object's declared size in scene units (obj.size).
 * @param textureSize The texture's native resolution in pixels.
 */
export function layerDisplaySize(
  objectSize: { x: number; y: number },
  textureSize: { width: number; height: number },
): { width: number; height: number } {
  const width = objectSize.x > 0 ? objectSize.x : textureSize.width;
  const height = objectSize.y > 0 ? objectSize.y : textureSize.height;
  return { width, height };
}

/**
 * Extract renderable layers from scene objects. Each visible object with a
 * resolved texture (or a solid color) becomes one layer. Layers are sorted
 * by parallax depth so that further-back layers render first.
 */
function buildRenderLayers(scene: SceneData): RenderLayer[] {
  const layers: RenderLayer[] = [];

  for (const obj of scene.objects) {
    if (!obj.visible) continue;

    // Solid color layer
    if (obj.color && isSolidLayer(scene, obj)) {
      layers.push({
        dataUrl: null,
        x: obj.origin.x,
        y: obj.origin.y,
        scaleX: obj.scale.x,
        scaleY: obj.scale.y,
        rotation: (obj.angles.z * Math.PI) / 180,
        alpha: obj.alpha,
        solidColor: obj.color,
        parallaxDepth: obj.parallaxDepth ?? 0,
        width: obj.size.x || 1920,
        height: obj.size.y || 1080,
        texAspect: null,
      });
      continue;
    }

    // Textured layer
    const texture = resolveObjectTexture(obj, scene);
    if (!texture || !texture.dataUrl) continue;

    // Display size = the object's quad (obj.size), NOT the texture's raw
    // resolution. WE textures are square power-of-two and get mapped onto
    // 16:9 quads; drawing at the texture size zooms per-wallpaper (see
    // {@link layerDisplaySize}).
    const quad = layerDisplaySize(obj.size, { width: texture.width, height: texture.height });

    layers.push({
      dataUrl: texture.dataUrl,
      x: obj.origin.x,
      y: obj.origin.y,
      scaleX: obj.scale.x,
      scaleY: obj.scale.y,
      rotation: (obj.angles.z * Math.PI) / 180,
      alpha: obj.alpha,
      solidColor: null,
      parallaxDepth: obj.parallaxDepth ?? 0,
      width: quad.width,
      height: quad.height,
      // Aspect ratio of the SOURCE texture — the renderer preserves this
      // when drawing so the image never stretches to the quad.
      texAspect: texture.height > 0 ? texture.width / texture.height : 1,
    });
  }

  // Sort back-to-front: lower parallaxDepth = further back = render first.
  layers.sort((a, b) => a.parallaxDepth - b.parallaxDepth);
  return layers;
}

/**
 * Check if an object is a solid-color layer (no texture, has a color).
 * WE marks solid layers via the model's `solidLayer` flag, but some objects
 * have a color without a model — treat those as solid too.
 */
function isSolidLayer(scene: SceneData, obj: SceneObject): boolean {
  if (!obj.image) return true;
  const modelKey = obj.image
    .replace(/\.(json|model)$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  const model = scene.models.get(modelKey);
  return model?.solidLayer ?? false;
}

// ---------------------------------------------------------------------------
// Scene → canvas coordinate mapping
// ---------------------------------------------------------------------------

/**
 * Compute the draw size for a textured layer: cover-fit the texture into the
 * quad area while preserving the texture's own aspect ratio.
 *
 * WE quads are positioning frames, not a target aspect — the texture keeps
 * its own ratio and the overflow is cropped (same as `object-fit: cover`).
 * Stretching the texture to the quad flattens square 2048² sources onto 16:9
 * frames, which is the "壁纸被压扁/压缩" symptom.
 *
 * @param quadW  Quad width in canvas px (quad size × cover scale × |scaleX|).
 * @param quadH  Quad height in canvas px.
 * @param aspect Texture aspect ratio (width/height).
 * @returns The draw width/height preserving the aspect, centered in the quad.
 */
export function layerDrawSize(
  quadW: number,
  quadH: number,
  aspect: number,
): { width: number; height: number } {
  if (!(quadW > 0) || !(quadH > 0) || !(aspect > 0)) return { width: quadW, height: quadH };
  if (quadW / quadH > aspect) {
    // Quad is wider than the texture → width-driven, crop top/bottom.
    return { width: quadW, height: quadW / aspect };
  }
  // Quad is taller → height-driven, crop left/right.
  return { width: quadH * aspect, height: quadH };
}

/**
 * Map a Wallpaper Engine scene-space coordinate to a canvas-space center
 * position for the viewport.
 *
 * ## Coordinate systems
 *
 * WE scenes use a **projection space** whose origin is the **bottom-left**
 * corner, with +x right and +y **up**. A fullscreen image object sits at
 * `(PROJ_W/2, PROJ_H/2)` — the projection center (verified against real
 * workshop items: a 1920×1080 scene's fullscreen layer has origin (960, 540)).
 *
 * The renderer draws into a viewport with a **top-left origin and +y down**
 * (standard canvas). We therefore subtract the projection-center offset before
 * scaling, and flip the Y axis.
 *
 * ## Why this fixes the off-position wallpaper
 *
 * The previous mapping drew `centerX + layer.x * scale` — it added the raw
 * scene coordinate (bottom-left origin) directly, so a fullscreen image at
 * (960, 540) on 1920×1080 landed with its *center* at the viewport's
 * bottom-right corner. Only a corner quadrant of the image was visible, which
 * is the "壁纸显示位置不正确" symptom users reported on scene-type wallpapers
 * (the dominant type in the workshop library).
 *
 * ## Scale
 *
 * `scale` is a 'cover' fit (`max(w/PROJ_W, h/PROJ_H)`), so the projection
 * fills the viewport and crops the overflow — matching the `<img>`/`<video>`
 * wallpaper paths' `object-fit: cover`.
 *
 * @param x        Layer origin x in scene space (projection units).
 * @param y        Layer origin y in scene space (projection units, +y up).
 * @param projW    Projection width (from scene.json orthogonalProjection).
 * @param projH    Projection height.
 * @param viewW    Viewport width (CSS px).
 * @param viewH    Viewport height (CSS px).
 * @returns The canvas-space center where the layer should be drawn, plus the
 *          applied scale (so callers can size the layer's rect consistently).
 */
export function sceneLayerCenter(
  x: number,
  y: number,
  projW: number,
  projH: number,
  viewW: number,
  viewH: number,
): { x: number; y: number; scale: number } {
  const scale = Math.max(viewW / projW, viewH / projH);
  return {
    scale,
    x: viewW / 2 + (x - projW / 2) * scale,
    y: viewH / 2 + (projH / 2 - y) * scale,
  };
}

// ---------------------------------------------------------------------------
// HTML document generation
// ---------------------------------------------------------------------------

/**
 * Build the complete HTML document with an inline canvas renderer.
 * The renderer is a self-contained IIFE — no external scripts, no imports.
 */
function buildHtmlDocument(scene: SceneData, layers: RenderLayer[]): string {
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

  // Preload all texture images.
  var loaded = 0;
  var totalToLoad = 0;
  for (var i = 0; i < LAYERS.length; i++) {
    if (LAYERS[i].dataUrl) {
      totalToLoad++;
      var img = new Image();
      img.onload = function() { loaded++; if (loaded >= totalToLoad) render(); };
      img.onerror = function() { loaded++; if (loaded >= totalToLoad) render(); };
      img.src = LAYERS[i].dataUrl;
      images[i] = img;
    } else {
      images[i] = null;
    }
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
      } else if (images[i] && images[i].complete && images[i].naturalWidth > 0) {
        // Textured layer: draw at the object's QUAD size (layer.width/height)
        // while PRESERVING the texture's own aspect ratio (texAspect) —
        // cover-fit the texture into the quad area and crop the overflow.
        // WE quads are positioning frames, not a target aspect: drawing the
        // texture stretched to the quad flattens square 2048² sources onto
        // 16:9 frames (the "壁纸被压扁/压缩" symptom). Cover-fit keeps the
        // source undistorted and centered, exactly like <img object-fit:cover>.
        var img = images[i];
        var quadW = layer.width * scale * absScaleX;
        var quadH = layer.height * scale * absScaleY;
        var draw = LAYER_DRAW_SIZE(quadW, quadH, layer.texAspect || 1);
        ctx.drawImage(img, -draw.width / 2, -draw.height / 2, draw.width, draw.height);
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

  // Animation loop for smooth parallax + audio breathing
  function animate() {
    var t = Date.now();
    // Smooth the audio level (attack/decay like a meter).
    audioLevel += (audioTarget - audioLevel) * 0.2;
    if (audioLevel < 0.001) audioLevel = 0;
    var needAudio = audioLevel > 0.005;
    if (PARALLAX) {
      var dx = Math.abs(targetMouseX - mouseX);
      var dy = Math.abs(targetMouseY - mouseY);
      if (dx > 0.001 || dy > 0.001 || needAudio) {
        // Audio breathing: gentle scale pulse driven by the smoothed level.
        if (needAudio) {
          var pulse = 1 + audioLevel * 0.04 * (0.6 + 0.4 * Math.sin(t / 220));
          ctx.setTransform(dpr * pulse, 0, 0, dpr * pulse, 0, 0);
        } else {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        render();
      }
    } else if (needAudio) {
      var pulse2 = 1 + audioLevel * 0.04 * (0.6 + 0.4 * Math.sin(t / 220));
      ctx.setTransform(dpr * pulse2, 0, 0, dpr * pulse2, 0, 0);
      render();
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
