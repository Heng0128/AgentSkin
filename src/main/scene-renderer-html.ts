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
 *
 * ## Module structure (post-refactor)
 *
 * The original ~870-line monolith was split:
 *   - {@link ./scene-renderer-types}      — `RenderLayer`, `ParticleLayer`, `ParticleState`
 *   - {@link ./scene-renderer-coords}     — coordinate mapping, cover-fit sizing
 *   - {@link ./scene-renderer-layers}     — `buildRenderLayers`, `buildParticleLayer`
 *   - {@link ./scene-renderer-particles}  — `spawnParticle`, `stepParticles`, `drawParticles`
 *   - {@link ./scene-renderer-html-scripts} — `buildHtmlDocument` (inline JS generator)
 *
 * This file is the **composition root** — it wires the pipeline and re-exports
 * the public surface consumed by tests.
 */

import type { SceneData } from './scene-pkg-parser';
import { deriveWeInstallRoot, extractScene } from './scene-pkg-parser';
import {
  alignmentToAnchor,
  computeLayerDisplaySize,
  layerDisplaySize,
  layerDrawSize,
  sceneLayerCenter,
} from './scene-renderer-coords';
import { buildHtmlDocument } from './scene-renderer-html-scripts';
import { buildRenderLayers } from './scene-renderer-layers';
import { drawParticles, spawnParticle, stepParticles } from './scene-renderer-particles';
import type { RenderLayer } from './scene-renderer-types';

// ---------------------------------------------------------------------------
// Public re-exports (preserve exact signatures for test compatibility)
// ---------------------------------------------------------------------------

// Re-export types for consumers
export type { RenderLayer } from './scene-renderer-types';
export {
  alignmentToAnchor,
  computeLayerDisplaySize,
  drawParticles,
  layerDisplaySize,
  layerDrawSize,
  sceneLayerCenter,
  spawnParticle,
  stepParticles,
};

// ---------------------------------------------------------------------------
// Composition root
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// L2 Canvas 2D renderer (animated, rAF loop)
// ---------------------------------------------------------------------------

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
// A-25 TODO: renderSceneToHtml is fully synchronous — extractScene binary
// parsing + buildRenderLayers texture reads + buildHtmlDocument all block the
// main process event loop. Large workshop scenes (50MB+ textures, 100+ objects)
// can stall IPC for seconds. Candidate migrations (ascending complexity):
//   1. wrap call site in setImmediate (defers, doesn't free the loop)
//   2. move extractScene into a worker_threads.Worker (true parallelism)
//   3. cache SceneData by pkgPath + mtime (avoids repeat parsing)
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
// Scene parsing helper (for tier-based dispatch)
// ---------------------------------------------------------------------------

/**
 * Parse a scene.pkg file and return the scene data + render layers.
 *
 * This is the shared parsing step for all render tiers (L1/L2/L3).
 * Call once, then dispatch to the appropriate renderer based on tier.
 *
 * @param pkgPath Absolute path to the `.pkg` file.
 * @param options Optional resolution context (same as `renderSceneToHtml`).
 * @returns `{ scene, layers }` on success, `null` on parse failure.
 */
export function parseSceneLayers(
  pkgPath: string,
  options?: { weInstallRoot?: string },
): { scene: SceneData; layers: RenderLayer[] } | null {
  try {
    const scene = extractScene(pkgPath);
    if (!scene) return null;
    const weInstallRoot = options?.weInstallRoot ?? deriveWeInstallRoot(pkgPath);
    const layers = buildRenderLayers(scene, weInstallRoot);
    if (layers.length === 0 && !scene.general.clearEnabled) return null;
    return { scene, layers };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// L1 static renderer (zero-runtime fallback)
// ---------------------------------------------------------------------------

/**
 * Generate a static preview HTML for a scene (L1 degradation tier).
 *
 * Renders the first frame of the scene as a single `<img>` — no rAF loop,
 * no particles, no interaction. Intended for low-power devices or when the
 * user selects "energy saver" mode.
 *
 * The output contains **zero `<script>` tags**, so there is no runtime
 * overhead beyond the browser's image decode + paint.
 *
 * @param layers The resolved render layers (same shape as produced by
 *        `buildRenderLayers`). Expected to be sorted back-to-front by
 *        `parallaxDepth` — the function picks the rearmost image layer
 *        as the static preview source.
 * @param options Optional viewport dimensions for the `<img>` tag.
 * @returns A complete HTML document string. When `layers` is empty or
 *          contains no image data, returns a pure-black background page.
 */
export function renderSceneToStaticHtml(
  layers: RenderLayer[],
  options: { width?: number; height?: number } = {},
): string {
  const width = options.width || 1920;
  const height = options.height || 1080;

  // Find the first frame's dataURL from layers. Layers are sorted by
  // parallaxDepth (back to front), so we pick the rearmost image layer
  // as the static preview source — equivalent to "the background".
  let imageUrl: string | null = null;
  for (const layer of layers) {
    if (layer.frames && layer.frames.length > 0 && layer.frames[0].dataUrl) {
      imageUrl = layer.frames[0].dataUrl;
      break;
    }
    if (layer.dataUrl) {
      imageUrl = layer.dataUrl;
      break;
    }
  }

  // No image layer found — return a pure-black static page. Zero scripts.
  if (!imageUrl) {
    return (
      '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>Scene Wallpaper (Static)</title>\n' +
      '<style>\n' +
      '  * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
      '  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }\n' +
      '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      '</body>\n' +
      '</html>'
    );
  }

  // Single <img> with the first frame — no JavaScript, no canvas, no rAF.
  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>Scene Wallpaper (Static)</title>\n' +
    '<style>\n' +
    '  * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
    '  html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }\n' +
    '  img { display: block; width: 100%; height: 100%; object-fit: cover; }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    `<img src="${imageUrl}" width="${width}" height="${height}" alt="">\n` +
    '</body>\n' +
    '</html>'
  );
}
