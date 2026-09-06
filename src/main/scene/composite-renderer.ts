// SPDX-License-Identifier: MPL-2.0

/**
 * # Composite Renderer
 *
 * Renders Wallpaper Engine scene layers into a single composited image using
 * software rendering (no DOM/Canvas required). This is the Level 0 fallback
 * in the static frame extraction degradation chain.
 *
 * The renderer:
 * 1. Builds render layers from the scene data
 * 2. Sorts layers by parallax depth (back to front)
 * 3. Composites each layer onto an RGBA buffer
 * 4. Exports the result as a PNG data URL
 *
 * Limitations:
 * - No shader effects or 3D rendering
 * - No particle simulation
 * - No text rendering
 * - PNG textures only (JPEG/BMP fall through to next degradation level)
 */

import { PNG } from 'pngjs';
import { buildRenderLayers } from '../scene-renderer-layers';
import type { SceneData } from './scene-extractor';
import { extractScene } from './scene-extractor';
import { rgbaToPngDataUrl } from './tex-parser';

/** Result of composite rendering. */
export interface CompositeResult {
  /** Base64 PNG data URL of the composited image */
  dataUrl: string;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}

/** Options for composite rendering. */
export interface CompositeOptions {
  /** Output width in pixels (default: 1920) */
  width?: number;
  /** Output height in pixels (default: 1080) */
  height?: number;
  /** Background color (default: transparent) */
  backgroundColor?: { r: number; g: number; b: number; a: number };
}

/**
 * Composite render layers into a single image.
 *
 * @param scene The scene data to render
 * @param options Rendering options
 * @returns Composite result or null if rendering fails
 */
export function compositeScene(
  scene: SceneData,
  options: CompositeOptions = {},
): CompositeResult | null {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const bgColor = options.backgroundColor ?? { r: 0, g: 0, b: 0, a: 0 };

  try {
    // Build render layers (null weInstallRoot — particles won't resolve,
    // but static frame extraction doesn't need particle simulation)
    const layers = buildRenderLayers(scene, null);
    if (layers.length === 0) return null;

    // Sort layers by parallax depth (back to front)
    layers.sort((a, b) => (a.parallaxDepth ?? 0) - (b.parallaxDepth ?? 0));

    // Create RGBA buffer
    const buffer = Buffer.alloc(width * height * 4, 0);

    // Fill background
    if (bgColor.a > 0) {
      for (let i = 0; i < width * height; i++) {
        buffer[i * 4] = bgColor.r;
        buffer[i * 4 + 1] = bgColor.g;
        buffer[i * 4 + 2] = bgColor.b;
        buffer[i * 4 + 3] = bgColor.a;
      }
    }

    // Composite each layer
    for (const layer of layers) {
      compositeLayer(buffer, width, height, layer);
    }

    // Encode as PNG
    const png = new PNG({ width, height });
    png.data.set(buffer);
    const pngBuffer = PNG.sync.write(png);
    const dataUrl = rgbaToPngDataUrl(pngBuffer, width, height);

    return { dataUrl, width, height };
  } catch {
    return null;
  }
}

/**
 * Composite a single layer onto the buffer.
 */
function compositeLayer(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  layer: {
    dataUrl: string | null;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    alpha: number;
    solidColor: { r: number; g: number; b: number } | null;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
  },
): void {
  // Skip fully transparent layers
  if (layer.alpha <= 0) return;

  const layerWidth = layer.width * layer.scaleX;
  const layerHeight = layer.height * layer.scaleY;

  // Calculate layer position (centered at canvas center, then offset by layer position)
  const centerX = canvasWidth / 2 + layer.x;
  const centerY = canvasHeight / 2 + layer.y;

  // Apply anchor offset
  const drawX = centerX - layerWidth * layer.anchorX;
  const drawY = centerY - layerHeight * layer.anchorY;

  // Handle solid color layers
  if (layer.solidColor && !layer.dataUrl) {
    fillSolidColor(
      buffer,
      canvasWidth,
      canvasHeight,
      drawX,
      drawY,
      layerWidth,
      layerHeight,
      layer.solidColor,
      layer.alpha,
    );
    return;
  }

  // Handle textured layers
  if (!layer.dataUrl) return;

  // Decode the image
  const imageData = decodeImageDataUrl(layer.dataUrl);
  if (!imageData) return;

  // Composite the image
  compositeImage(
    buffer,
    canvasWidth,
    canvasHeight,
    imageData,
    drawX,
    drawY,
    layerWidth,
    layerHeight,
    layer.alpha,
    layer.rotation,
  );
}

/**
 * Fill a rectangular area with a solid color.
 */
function fillSolidColor(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  alpha: number,
): void {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(canvasWidth, Math.ceil(x + width));
  const endY = Math.min(canvasHeight, Math.ceil(y + height));

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      const idx = (py * canvasWidth + px) * 4;
      // Alpha blend
      const srcAlpha = alpha;
      const dstAlpha = buffer[idx + 3] / 255;
      const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
      if (outAlpha > 0) {
        buffer[idx] = Math.round(
          (color.r * srcAlpha + buffer[idx] * dstAlpha * (1 - srcAlpha)) / outAlpha,
        );
        buffer[idx + 1] = Math.round(
          (color.g * srcAlpha + buffer[idx + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha,
        );
        buffer[idx + 2] = Math.round(
          (color.b * srcAlpha + buffer[idx + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha,
        );
        buffer[idx + 3] = Math.round(outAlpha * 255);
      }
    }
  }
}

/**
 * Decode a data URL to RGBA pixel data.
 */
function decodeImageDataUrl(
  dataUrl: string,
): { data: Buffer; width: number; height: number } | null {
  // Parse data URL
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;

  const format = match[1].toLowerCase();
  const base64 = match[2];
  const imageBuffer = Buffer.from(base64, 'base64');

  if (format === 'png') {
    try {
      const png = PNG.sync.read(imageBuffer);
      return { data: png.data, width: png.width, height: png.height };
    } catch {
      return null;
    }
  }

  // JPEG and other formats not supported in this simple renderer
  return null;
}

/**
 * Composite an image onto the buffer with alpha blending.
 */
function compositeImage(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  image: { data: Buffer; width: number; height: number },
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
  alpha: number,
  rotation: number,
): void {
  const imgWidth = image.width;
  const imgHeight = image.height;

  // Calculate the source-to-target scale
  const scaleX = targetWidth / imgWidth;
  const scaleY = targetHeight / imgHeight;

  // For simplicity, skip rotation (rotation requires more complex math)
  const hasRotation = Math.abs(rotation) > 0.001;

  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(canvasWidth, Math.ceil(x + targetWidth));
  const endY = Math.min(canvasHeight, Math.ceil(y + targetHeight));

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      // Map destination pixel to source pixel
      let srcX: number;
      let srcY: number;

      if (hasRotation) {
        // Apply inverse rotation
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = px - (x + targetWidth / 2);
        const dy = py - (y + targetHeight / 2);
        srcX = dx * cos - dy * sin + targetWidth / 2;
        srcY = dx * sin + dy * cos + targetHeight / 2;
      } else {
        srcX = px - x;
        srcY = py - y;
      }

      // Scale to source image coordinates
      srcX /= scaleX;
      srcY /= scaleY;

      // Check bounds
      if (srcX < 0 || srcX >= imgWidth || srcY < 0 || srcY >= imgHeight) continue;

      // Bilinear interpolation for smoother results
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, imgWidth - 1);
      const y1 = Math.min(y0 + 1, imgHeight - 1);
      const fx = srcX - x0;
      const fy = srcY - y0;

      // Get four neighboring pixels
      const idx00 = (y0 * imgWidth + x0) * 4;
      const idx10 = (y0 * imgWidth + x1) * 4;
      const idx01 = (y1 * imgWidth + x0) * 4;
      const idx11 = (y1 * imgWidth + x1) * 4;

      // Interpolate
      const srcR =
        image.data[idx00] * (1 - fx) * (1 - fy) +
        image.data[idx10] * fx * (1 - fy) +
        image.data[idx01] * (1 - fx) * fy +
        image.data[idx11] * fx * fy;
      const srcG =
        image.data[idx00 + 1] * (1 - fx) * (1 - fy) +
        image.data[idx10 + 1] * fx * (1 - fy) +
        image.data[idx01 + 1] * (1 - fx) * fy +
        image.data[idx11 + 1] * fx * fy;
      const srcB =
        image.data[idx00 + 2] * (1 - fx) * (1 - fy) +
        image.data[idx10 + 2] * fx * (1 - fy) +
        image.data[idx01 + 2] * (1 - fx) * fy +
        image.data[idx11 + 2] * fx * fy;
      const srcA =
        image.data[idx00 + 3] * (1 - fx) * (1 - fy) +
        image.data[idx10 + 3] * fx * (1 - fy) +
        image.data[idx01 + 3] * (1 - fx) * fy +
        image.data[idx11 + 3] * fx * fy;

      // Apply layer alpha
      const layerAlpha = (srcA / 255) * alpha;

      // Alpha blend with destination
      const dstIdx = (py * canvasWidth + px) * 4;
      const dstAlpha = buffer[dstIdx + 3] / 255;
      const outAlpha = layerAlpha + dstAlpha * (1 - layerAlpha);

      if (outAlpha > 0) {
        buffer[dstIdx] = Math.round(
          (srcR * layerAlpha + buffer[dstIdx] * dstAlpha * (1 - layerAlpha)) / outAlpha,
        );
        buffer[dstIdx + 1] = Math.round(
          (srcG * layerAlpha + buffer[dstIdx + 1] * dstAlpha * (1 - layerAlpha)) / outAlpha,
        );
        buffer[dstIdx + 2] = Math.round(
          (srcB * layerAlpha + buffer[dstIdx + 2] * dstAlpha * (1 - layerAlpha)) / outAlpha,
        );
        buffer[dstIdx + 3] = Math.round(outAlpha * 255);
      }
    }
  }
}

/**
 * Render a scene.pkg file to a composited image.
 *
 * @param pkgPath Absolute path to the .pkg file
 * @param options Rendering options
 * @returns Composite result or null if rendering fails
 */
export async function renderSceneComposite(
  pkgPath: string,
  options: CompositeOptions = {},
): Promise<CompositeResult | null> {
  try {
    const scene = await extractScene(pkgPath);
    if (!scene) return null;

    // Use scene projection size if not specified
    const projSize = scene.general.orthogonalProjection;
    const mergedOptions: CompositeOptions = {
      width: options.width ?? projSize.width ?? 1920,
      height: options.height ?? projSize.height ?? 1080,
      ...options,
    };

    return compositeScene(scene, mergedOptions);
  } catch {
    return null;
  }
}
