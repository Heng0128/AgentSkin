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

import type { SceneData, SceneObject, SceneParticle } from './scene-pkg-parser';
import {
  deriveWeInstallRoot,
  extractScene,
  findParticleOperator,
  resolveObjectTexture,
  resolveSceneParticle,
} from './scene-pkg-parser';

/**
 * Render a scene.pkg file into a self-contained HTML string.
 *
 * @param pkgPath Absolute path to the `.pkg` file.
 * @param options Optional resolution context. `weInstallRoot` points at the
 *          Wallpaper Engine install directory whose `assets/` folder holds
 *          particle presets, particle materials and textures (scene.pkg
 *          itself only references them by path). When omitted, the install
 *          root is derived from the pkg's workshop-layout path.
 * @returns A complete HTML document string, or `null` if the pkg could not
 *          be parsed or contains no renderable content.
 */
export function renderSceneToHtml(
  pkgPath: string,
  options?: { weInstallRoot?: string },
): string | null {
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

  const weInstallRoot = options?.weInstallRoot ?? deriveWeInstallRoot(pkgPath);

  let layers: RenderLayer[] = [];
  try {
    layers = buildRenderLayers(scene, weInstallRoot);
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
  /** Animated (GIF) frames for this layer: { dataUrl, frametime } per frame.
   *  When present the renderer switches the drawn image on each frame's
   *  interval; the still image at index 0 is the fallback until loaded. */
  frames: Array<{ dataUrl: string; frametime: number }> | null;
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
  /** Particle-simulation config (null for static/solid layers). */
  particle: ParticleLayer | null;
}

/**
 * Serialized config for a 2D particle-simulation layer. Built from a Wallpaper
 * Engine particle JSON (resolved from the WE install `assets/`), flattened so
 * the inline HTML script only needs this compact object.
 */
interface ParticleLayer {
  /** Particles emitted per second. */
  rate: number;
  /** Particle count cap (WE `maxcount`). */
  maxCount: number;
  /** Spawn volume: 'sphere' (radius distanceMin..distanceMax) or 'box'. */
  spawn: 'sphere' | 'box';
  /** Absolute emitter position in scene space (bottom-left origin, +y up). */
  origin: { x: number; y: number; z: number };
  /** Spawn direction / box half-extent. */
  directions: { x: number; y: number; z: number };
  distanceMin: number;
  distanceMax: number;
  lifetimeMin: number;
  lifetimeMax: number;
  sizeMin: number;
  sizeMax: number;
  velocityMin: { x: number; y: number; z: number };
  velocityMax: { x: number; y: number; z: number };
  /** Particle color range, normalized 0-1. */
  colorMin: { r: number; g: number; b: number };
  colorMax: { r: number; g: number; b: number };
  /** Object tint (from instanceoverride.colorn), 0-1, or null. */
  tint: { r: number; g: number; b: number } | null;
  gravity: { x: number; y: number; z: number };
  /** Drag coefficient (0 = none). */
  drag: number;
  /** Fade-in duration in seconds (0 = instant). */
  fadeInTime: number;
  /** True for additive-blended materials → canvas 'lighter' composite. */
  additive: boolean;
  /** Sprite data URL (null → draw plain colored circles). */
  image: string | null;
  /** Sprite aspect ratio (width/height), for undistorted drawing. */
  aspect: number;
  /** Object transform applied to every particle. */
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  parallaxDepth: number;
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
 * resolved texture (or a solid color) becomes one layer. Particle objects
 * (obj.particle) become particle-simulation layers when their preset resolves
 * from the WE install. Layers are sorted by parallax depth so that further
 * back layers render first.
 */
function buildRenderLayers(scene: SceneData, weInstallRoot: string | null): RenderLayer[] {
  const layers: RenderLayer[] = [];

  for (const obj of scene.objects) {
    if (!obj.visible) continue;

    // Particle layer — resolved pkg-first (particle JSONs + materials are
    // bundled inside scene.pkg), with the WE install assets as fallback.
    // Falls through to the static path when the preset is missing/malformed.
    if (obj.particle) {
      const particle = resolveSceneParticle(obj, scene, weInstallRoot);
      if (particle) {
        layers.push(buildParticleLayer(obj, particle));
        continue;
      }
    }

    // Solid color layer
    if (obj.color && isSolidLayer(scene, obj)) {
      layers.push({
        dataUrl: null,
        frames: null,
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
        particle: null,
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
      frames: texture.frames ?? null,
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
      particle: null,
    });
  }

  // Sort back-to-front: lower parallaxDepth = further back = render first.
  layers.sort((a, b) => a.parallaxDepth - b.parallaxDepth);
  return layers;
}

/** Parse a 0-1 RGB string like "0.69 0.52 0.22" (instanceoverride.colorn). */
function parseInstanceColor(v: unknown): { r: number; g: number; b: number } | null {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

/**
 * Build a particle-simulation layer from a resolved scene particle. Uses the
 * first emitter and the movement/alphafade operators (the common structure);
 * multi-emitter systems approximate with the first emitter.
 */
function buildParticleLayer(obj: SceneObject, particle: SceneParticle): RenderLayer {
  const data = particle.data;
  const emitter =
    data.emitters[0] ??
    ({
      name: 'sphererandom',
      rate: 1,
      origin: { x: 0, y: 0, z: 0 },
      directions: { x: 1, y: 1, z: 1 },
      distanceMin: 0,
      distanceMax: 0,
    } as {
      name: string;
      rate: number;
      origin: { x: number; y: number; z: number };
      directions: { x: number; y: number; z: number };
      distanceMin: number;
      distanceMax: number;
    });
  const movement = findParticleOperator(data, 'movement');
  const alphaFade = findParticleOperator(data, 'alphafade');

  // Absolute emitter position = object origin + emitter offset (scene space).
  const origin = {
    x: obj.origin.x + emitter.origin.x,
    y: obj.origin.y + emitter.origin.y,
    z: obj.origin.z + emitter.origin.z,
  };

  const tex = particle.texture;
  const cfg: ParticleLayer = {
    rate: Math.max(0, emitter.rate),
    maxCount: Math.max(1, data.maxCount),
    spawn: emitter.name.toLowerCase().includes('box') ? 'box' : 'sphere',
    origin,
    directions: emitter.directions,
    distanceMin: emitter.distanceMin,
    distanceMax: Math.max(emitter.distanceMin, emitter.distanceMax),
    lifetimeMin: data.initializers.lifetime.min,
    lifetimeMax: data.initializers.lifetime.max,
    sizeMin: data.initializers.size.min,
    sizeMax: data.initializers.size.max,
    velocityMin: data.initializers.velocity.min,
    velocityMax: data.initializers.velocity.max,
    colorMin: data.initializers.color.min,
    colorMax: data.initializers.color.max,
    tint: parseInstanceColor(obj.instanceOverride?.colorn),
    gravity: movement?.gravity ?? { x: 0, y: 0, z: 0 },
    drag: movement?.drag ?? 0,
    fadeInTime: alphaFade?.fadeInTime ?? 0,
    additive: particle.blending === 'additive',
    image: tex?.dataUrl ?? null,
    aspect: tex && tex.height > 0 ? tex.width / tex.height : 1,
    scaleX: obj.scale.x,
    scaleY: obj.scale.y,
    rotation: (obj.angles.z * Math.PI) / 180,
    alpha: obj.alpha,
    parallaxDepth: obj.parallaxDepth ?? 0,
  };

  return {
    dataUrl: null,
    frames: null,
    x: obj.origin.x,
    y: obj.origin.y,
    scaleX: obj.scale.x,
    scaleY: obj.scale.y,
    rotation: (obj.angles.z * Math.PI) / 180,
    alpha: obj.alpha,
    solidColor: null,
    parallaxDepth: obj.parallaxDepth ?? 0,
    width: 0,
    height: 0,
    texAspect: null,
    particle: cfg,
  };
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
