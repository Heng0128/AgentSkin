// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene Renderer Coordinate Helpers
 *
 * Anchor resolution, coordinate transform, cover-fit sizing, and layer
 * display-size computation for the scene renderer.
 *
 * Consumed by:
 *   - scene-renderer-layers.ts  (layer extraction)
 *   - scene-renderer-html-scripts.ts  (inline HTML script generation)
 *   - scene-renderer-html.test.ts  (unit + fixture tests)
 *   - scene-size.verify.test.ts  (integration tests)
 */

// ---------------------------------------------------------------------------
// Anchor resolution
// ---------------------------------------------------------------------------

/**
 * Normalize a Wallpaper Engine alignment string to a numeric anchor point
 * (0-1 on each axis, defaulting to center = 0.5).
 *
 * WE alignment strings: "top", "bottom", "left", "right", "center",
 * "top left", "top right", "bottom left", "bottom right".
 *
 * The anchor drives how an offset layer positions itself relative to its
 * origin in canvas space (top-left origin, +y down). The renderer applies
 * a Y-flip when converting from WE scene space (bottom-left, +y up), so an
 * anchorY of 0 = "bottom" and 1 = "top" — matching CSS/screen convention.
 *
 * @param alignment  The object's WE alignment string (or null → center).
 * @returns { anchorX, anchorY } normalized 0-1 for each axis.
 */
export function alignmentToAnchor(alignment: string | null): { anchorX: number; anchorY: number } {
  if (!alignment) return { anchorX: 0.5, anchorY: 0.5 };

  const parts = alignment.toLowerCase().trim().split(/\s+/);
  let anchorX = 0.5;
  let anchorY = 0.5;

  for (const part of parts) {
    switch (part) {
      case 'left':
        anchorX = 0;
        break;
      case 'right':
        anchorX = 1;
        break;
      case 'top':
        anchorY = 1;
        break;
      case 'bottom':
        anchorY = 0;
        break;
      case 'center':
        anchorX = 0.5;
        anchorY = 0.5;
        break;
      default:
        break;
    }
  }

  return { anchorX, anchorY };
}

// ---------------------------------------------------------------------------
// Layer display size (backward-compatible API)
// ---------------------------------------------------------------------------

/**
 * Compute the display quad size (in scene units) for a texture layer.
 *
 * Wallpaper Engine maps a texture onto the object's quad — the quad size
 * (obj.size × obj.scale) is what actually appears on screen. Textures are
 * almost always square power-of-two (2048²/4096²/8192²) regardless of the
 * quad's 16:9 aspect, so using the texture's raw resolution as the display
 * size would zoom each layer by a per-wallpaper ratio. Instead we use the
 * object's declared size; only when that is missing (0/undefined) do we
 * fall back to the texture resolution.
 *
 * **Backward-compat signature** — used by scene-size.verify.test.ts which
 * calls with only two args (no projection context).
 *
 * @param objectSize  The object's declared size in scene units (obj.size).
 * @param textureSize The texture's native resolution in pixels — the fallback
 *                    when the object declares no size.
 */
export function layerDisplaySize(
  objectSize: { x: number; y: number },
  textureSize: { width: number; height: number },
): { width: number; height: number } {
  const width = objectSize.x > 0 ? objectSize.x : textureSize.width;
  const height = objectSize.y > 0 ? objectSize.y : textureSize.height;
  return { width, height };
}

// ---------------------------------------------------------------------------
// Layer display size (new API with projection fallback)
// ---------------------------------------------------------------------------

/**
 * Compute the display quad size (in scene units) for a texture layer,
 * with the scene projection size as the final fallback.
 *
 * Priority: obj.size (explicit) > scene projection (WE convention) > texture
 * resolution (last resort).
 *
 * @param objectSize  The object's declared size in scene units (obj.size).
 * @param textureSize The texture's native resolution in pixels.
 * @param projSize    The scene's orthogonal projection size — the fallback
 *                    when obj.size is 0.
 * @param useProjectionFallback  Whether to fall back to projection size
 *                    before texture size (default: true). Tests that assert
 *                    the pure 2-arg behaviour should call `layerDisplaySize`.
 */
export function computeLayerDisplaySize(
  objectSize: { x: number; y: number },
  _textureSize: { width: number; height: number },
  projSize: { width: number; height: number },
  useProjectionFallback = true,
): { width: number; height: number } {
  const width =
    objectSize.x > 0 ? objectSize.x : useProjectionFallback ? projSize.width : _textureSize.width;
  const height =
    objectSize.y > 0 ? objectSize.y : useProjectionFallback ? projSize.height : _textureSize.height;
  return { width, height };
}

// ---------------------------------------------------------------------------
// Cover-fit draw size (for textured layers)
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
 * @param quadW   Quad width in canvas px (quad size × cover scale × |scaleX|).
 * @param quadH   Quad height in canvas px.
 * @param aspect  Texture aspect ratio (width/height).
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

// ---------------------------------------------------------------------------
// Scene → canvas coordinate mapping
// ---------------------------------------------------------------------------

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
 * is the "壁纸显示位置不正确" symptom users reported on scene-type wallpapers.
 *
 * ## Scale
 *
 * `scale` is a 'cover' fit (`max(w/PROJ_W, h/PROJ_H)`), so the projection
 * fills the viewport and crops the overflow — matching the `<img>`/`<video>`
 * wallpaper paths' `object-fit: cover`.
 *
 * @param x       Layer origin x in scene space (projection units).
 * @param y       Layer origin y in scene space (projection units, +y up).
 * @param projW   Projection width (from scene.json orthogonalProjection).
 * @param projH   Projection height.
 * @param viewW   Viewport width (CSS px).
 * @param viewH   Viewport height (CSS px).
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
