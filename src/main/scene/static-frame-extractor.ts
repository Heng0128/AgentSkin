// SPDX-License-Identifier: MPL-2.0

/**
 * # Static Frame Extractor
 *
 * Extracts the best static frame from a Wallpaper Engine Scene (.pkg),
 * using a 4-level degradation chain to guarantee an output:
 *
 *   Level 0: Composite frame (Canvas 2D synthesis of all layers)
 *   Level 1: Single main texture (highest-scored image object)
 *   Level 2: preview.jpg (WE's built-in preview)
 *   Level 3: Solid color (from scene.json background)
 *   Level 4: Transparent 1x1 PNG (ultimate fallback)
 *
 * The extractor is designed for wallpaper preview/thumbnail generation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { compositeScene } from './composite-renderer';
import { extractScene, type SceneData } from './scene-extractor';
import { rgbaToPngDataUrl } from './tex-parser';
import { createScoringContext, selectBestTexture, type TextureCandidate } from './texture-scorer';
import { renderSceneFrame } from './we/full-frame-renderer';

/** Result of static frame extraction. */
export interface StaticFrameResult {
  /** Base64 PNG data URL of the extracted frame */
  dataUrl: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Which degradation level produced the output */
  source: 'full-render' | 'composite' | 'main-texture' | 'preview' | 'solid-color' | 'transparent';
  /** Score of the selected main texture (only for 'main-texture' source) */
  score?: number;
}

/** Options for extraction. */
export interface StaticFrameOptions {
  /** Maximum output dimension (default: 1024) */
  maxDim?: number;
  /** Skip composite rendering (Level 0) for performance (default: false) */
  skipComposite?: boolean;
  /** Background color fallback as CSS color string (default: '#000000') */
  fallbackColor?: string;
  /** Explicit preview image path (Level 2). If not provided, derives from pkgPath. */
  previewPath?: string;
}

/**
 * Static Frame Extractator — extracts the best static image from a scene.
 */
export class StaticFrameExtractor {
  private cache = new Map<string, StaticFrameResult>();
  private maxCacheSize = 20;

  /**
   * Extract a static frame from a scene PKG file.
   * @param pkgPath Absolute path to the .pkg file
   * @param options Extraction options
   * @returns Static frame result (always non-null due to degradation chain)
   */
  async extractStaticFrame(
    pkgPath: string,
    options: StaticFrameOptions = {},
  ): Promise<StaticFrameResult> {
    const cached = this.cache.get(pkgPath);
    if (cached) return cached;

    const result = await this.doExtract(pkgPath, options);

    // Cache management (LRU-like: delete oldest if at capacity)
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(pkgPath, result);

    return result;
  }

  /**
   * Clear the extraction cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private async doExtract(
    pkgPath: string,
    options: StaticFrameOptions,
  ): Promise<StaticFrameResult> {
    const maxDim = options.maxDim ?? 1024;
    const fallbackColor = options.fallbackColor ?? '#000000';

    // Parse the scene
    let scene: SceneData | null;
    try {
      scene = await extractScene(pkgPath);
    } catch {
      scene = null;
    }

    if (!scene) {
      // Scene parsing failed — return fallback
      return this.createFallback(fallbackColor);
    }

    // Level 0: Full WE scene renderer (ported from dsh-wallpaper-engine).
    // Complete replay — object tree, shader effects, puppet, particles, text.
    // A blank (clear-color-only) or failed render falls through to the
    // original chain below, which stays as the degradation fallback.
    if (!options.skipComposite) {
      try {
        const full = await this.tryFullRender(pkgPath, scene, maxDim);
        if (full) return full;
      } catch {
        // Full render failed — continue to next level
      }
    }

    // Level 0b: Try composite rendering (optional)
    if (!options.skipComposite) {
      try {
        const composite = await this.tryComposite(scene, maxDim);
        if (composite) return composite;
      } catch {
        // Composite failed — continue to next level
      }
    }

    // Level 1: Extract main texture
    try {
      const mainTexture = this.tryMainTexture(scene, maxDim);
      if (mainTexture) return mainTexture;
    } catch {
      // Main texture failed — continue
    }

    // Level 2: preview.jpg
    try {
      const preview = await this.tryPreview(options.previewPath, pkgPath);
      if (preview) return preview;
    } catch {
      // Preview failed — continue
    }

    // Level 3: Solid color from scene background
    try {
      const solidColor = this.trySolidColor(scene, fallbackColor);
      if (solidColor) return solidColor;
    } catch {
      // Solid color failed — continue
    }

    // Level 4: Transparent 1x1 PNG
    return this.createTransparentPixel();
  }

  /**
   * Level 0: Full WE scene frame via the ported renderer worker.
   *
   * Renders at the scene's projection aspect scaled to `maxDim`, then applies
   * the empty-frame gate: when <0.1% of sampled pixels differ from the scene
   * clear color the render is treated as failed (e.g. shader-only scenes the
   * CPU pipeline cannot draw) so the degradation chain produces a better
   * image than a blank frame would.
   */
  private async tryFullRender(
    pkgPath: string,
    scene: SceneData,
    maxDim: number,
  ): Promise<StaticFrameResult | null> {
    const projSize = scene.general.orthogonalProjection;
    const sceneWidth = projSize.width || 1920;
    const sceneHeight = projSize.height || 1080;
    const scale = Math.min(1, maxDim / Math.max(sceneWidth, sceneHeight));
    const width = Math.max(1, Math.round(sceneWidth * scale));
    const height = Math.max(1, Math.round(sceneHeight * scale));

    const result = await renderSceneFrame({ pkgPath, width, height });
    if (!result) return null;
    // Empty-frame gate — same threshold semantics as the dsh plugin.
    if (result.checked === 0 || result.diff / result.checked < 0.001) return null;

    return {
      dataUrl: `data:image/png;base64,${result.png.toString('base64')}`,
      width,
      height,
      source: 'full-render',
    };
  }

  /**
   * Level 0b: Composite all layers using software rendering.
   * Renders all visible layers (textures, solid colors) into a single image.
   */
  private async tryComposite(scene: SceneData, maxDim: number): Promise<StaticFrameResult | null> {
    try {
      // Use scene projection size, scaled down to maxDim
      const projSize = scene.general.orthogonalProjection;
      const sceneWidth = projSize.width || 1920;
      const sceneHeight = projSize.height || 1080;
      const scale = Math.min(1, maxDim / Math.max(sceneWidth, sceneHeight));
      const width = Math.max(1, Math.round(sceneWidth * scale));
      const height = Math.max(1, Math.round(sceneHeight * scale));

      const result = compositeScene(scene, {
        width,
        height,
        backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
      });

      if (!result) return null;

      return {
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        source: 'composite',
      };
    } catch {
      return null;
    }
  }

  /**
   * Level 1: Extract the highest-scored texture.
   */
  private tryMainTexture(scene: SceneData, maxDim: number): StaticFrameResult | null {
    const textures = scene.textures;
    if (!textures || textures.size === 0) return null;

    // Build candidates from scene textures (Map<string, SceneTexture>)
    const candidates: TextureCandidate[] = [];
    for (const [id, tex] of textures) {
      candidates.push({
        id,
        name: tex.name ?? '',
        width: tex.width ?? 0,
        height: tex.height ?? 0,
        position: { x: 0, y: 0 }, // SceneTexture doesn't carry position
        opacity: 1.0,
        blendMode: 'normal',
      });
    }

    const sceneWidth = scene.general?.orthogonalProjection?.width ?? 1920;
    const sceneHeight = scene.general?.orthogonalProjection?.height ?? 1080;
    const context = createScoringContext(sceneWidth, sceneHeight);

    const best = selectBestTexture(candidates, context);
    if (!best) return null;

    // Get the selected texture's data URL (already decoded by scene-extractor)
    const bestTex = textures.get(best.id);
    if (!bestTex?.dataUrl) return null;

    return {
      dataUrl: bestTex.dataUrl,
      width: Math.min(best.width, maxDim),
      height: Math.min(best.height, maxDim),
      source: 'main-texture',
    };
  }

  /**
   * Level 2: Use WE's built-in preview.jpg.
   */
  private async tryPreview(
    previewPath: string | undefined,
    pkgPath: string,
  ): Promise<StaticFrameResult | null> {
    // Determine the preview path: explicit option, or derive from pkgPath
    let previewFile = previewPath;
    if (!previewFile) {
      // Derive from pkgPath: look for preview.jpg/png/gif in the same directory
      const dir = path.dirname(pkgPath);
      const candidates = [
        'preview.jpg',
        'preview.jpeg',
        'preview.png',
        'preview.gif',
        'preview.webp',
      ];
      for (const candidate of candidates) {
        const candidatePath = path.join(dir, candidate);
        try {
          const stat = await fs.stat(candidatePath);
          if (stat.isFile()) {
            previewFile = candidatePath;
            break;
          }
        } catch {
          // File doesn't exist, try next
        }
      }
    }

    if (!previewFile) return null;

    // Read the preview file and convert to base64 data URL
    try {
      const fileBuffer = await fs.readFile(previewFile);
      const ext = path.extname(previewFile).toLowerCase();
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
      const base64 = fileBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      return {
        dataUrl,
        width: 0, // Unknown without decoding
        height: 0,
        source: 'preview',
      };
    } catch {
      // Failed to read preview file
      return null;
    }
  }

  /**
   * Level 3: Generate a solid color from scene background.
   */
  private trySolidColor(scene: SceneData, fallbackColor: string): StaticFrameResult | null {
    const clearColor = scene.general?.clearColor;
    let color: { r: number; g: number; b: number; a: number } | null = null;

    if (clearColor) {
      // SceneColor uses 0-1 float range
      color = {
        r: Math.round(clearColor.r * 255),
        g: Math.round(clearColor.g * 255),
        b: Math.round(clearColor.b * 255),
        a: 255,
      };
    } else {
      color = this.parseColor(fallbackColor);
    }

    if (!color) return null;

    // Create a 1x1 PNG of the background color
    const rgba = Buffer.from([color.r, color.g, color.b, 255]);
    const dataUrl = rgbaToPngDataUrl(rgba, 1, 1);

    return {
      dataUrl,
      width: 1,
      height: 1,
      source: 'solid-color',
    };
  }

  /**
   * Level 4: Transparent 1x1 PNG.
   */
  private createTransparentPixel(): StaticFrameResult {
    const rgba = Buffer.from([0, 0, 0, 0]);
    const dataUrl = rgbaToPngDataUrl(rgba, 1, 1);
    return {
      dataUrl,
      width: 1,
      height: 1,
      source: 'transparent',
    };
  }

  /**
   * Create a fallback result (solid color or transparent).
   */
  private createFallback(color: string): StaticFrameResult {
    const parsed = this.parseColor(color);
    if (!parsed) return this.createTransparentPixel();

    const rgba = Buffer.from([parsed.r, parsed.g, parsed.b, 255]);
    return {
      dataUrl: rgbaToPngDataUrl(rgba, 1, 1),
      width: 1,
      height: 1,
      source: 'solid-color',
    };
  }

  /**
   * Parse a CSS color string to RGBA components.
   */
  private parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
    if (!color) return null;

    // Hex color: #RRGGBB or #RGB
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b, a: 255 };
      }
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return { r, g, b, a: 255 };
      }
    }

    // rgb() / rgba() format
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
        a: 255,
      };
    }

    return null;
  }
}

/** Singleton instance for convenience. */
export const staticFrameExtractor = new StaticFrameExtractor();
