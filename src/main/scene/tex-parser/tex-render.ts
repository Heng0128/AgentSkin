// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser — Render & Convert
 *
 * Converts parsed TEX data to browser-displayable PNG data URLs.
 * Handles embedded PNG/JPEG images, DXT/BC7 decompression, and
 * animated GIF frame rendering.
 */

import { decompressDxt } from './dxt-decompress';
import { rgbaToPngDataUrl } from './png-encoder';
import {
  FIF_JPEG,
  FIF_PNG,
  MAX_SCENE_TEXTURE_DIM,
  TEX_FORMAT,
  type TexData,
  type TexFrameInfo,
  type TexFrameRendered,
  type TexImage,
  type TexMipmap,
} from './tex-types';

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Box-downscale an RGBA buffer by integer factor `k` (2, 4, 8…).
 *
 * 4096² DXT textures are routinely decoded at 4096² only to be displayed at
 * ≤2048 CSS px. Decoding at full size wastes ~4× memory and CPU, so we
 * halve the texture down the mipmap chain while a mipmap is still above
 * {@link MAX_SCENE_TEXTURE_DIM}. Each halving decodes a 4×-smaller mipmap
 * (e.g. 4096²→2048²) — never a full-size decode that is then thrown away.
 *
 * The `rgba` buffer is mutated in place (only the first half of each row is
 * written, which is a subset of the same buffer) and returned.
 */
export function boxDownscaleRgba(rgba: Buffer, width: number, height: number, k: number): void {
  const outW = Math.floor(width / k);
  const outH = Math.floor(height / k);
  const srcRowBytes = width * 4;
  const dstRowBytes = outW * 4;
  const factor = k * k;

  for (let y = 0; y < outH; y++) {
    const srcBase = y * k * srcRowBytes;
    const dstBase = y * dstRowBytes;
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < k; dy++) {
        const row = srcBase + dy * srcRowBytes + x * k * 4;
        for (let dx = 0; dx < k; dx++) {
          const o = row + dx * 4;
          r += rgba[o];
          g += rgba[o + 1];
          b += rgba[o + 2];
          a += rgba[o + 3];
        }
      }
      const o = dstBase + x * 4;
      rgba[o] = r / factor;
      rgba[o + 1] = g / factor;
      rgba[o + 2] = b / factor;
      rgba[o + 3] = a / factor;
    }
  }
}

/** If `dim` is larger than {@link MAX_SCENE_TEXTURE_DIM}, clamp it to the cap.
 *  Real WE textures are powers of two, so the clamp is exact (4096 → 2048,
 *  8192 → 2048); smaller textures pass through unchanged (1024 stays 1024). */
export function cappedTextureDim(dim: number): number {
  return dim <= MAX_SCENE_TEXTURE_DIM ? dim : MAX_SCENE_TEXTURE_DIM;
}

/**
 * Pick the mipmap whose decode cost best matches the scene-texture cap.
 *
 * WE ships mipmap chains (largest first, halving each step). Decoding the
 * full-res mip of a 4096² texture allocates ~64MB of RGBA that a 1080p layer
 * never needs. This picks the mip CLOSEST to the display cap:
 *
 *   1. Among mips whose larger dimension ≤ cap, the one with the largest
 *      larger-dimension (closest to the cap from below) — e.g. a fullscreen
 *      texture with a 1920×1080 mip picks that mip: identical on a 1080p
 *      display at 1/4 the decode memory.
 *   2. If every mip exceeds the cap (single-mip 4096²), the smallest such mip
 *      (closest from above) — `texToDataUrl` downscales it to exactly the cap.
 *
 * Examples:
 *   chain [4096, 2048, 1024, …] → 2048 (exact, no downscale needed)
 *   fullscreen chain [3840x2160, 1920x1080, …] → 1920x1080 (≤ cap, best fit)
 *   single mip 4096              → 4096 (downscaled to 2048 in texToDataUrl)
 *   single mip 1024              → 1024 (below cap, used as-is)
 */
export function pickMipmapForDisplay(mipmaps: TexMipmap[], cap: number): TexMipmap {
  let largest = mipmaps[0];
  for (const m of mipmaps) {
    if (m.width * m.height > largest.width * largest.height) largest = m;
  }
  let bestFit: TexMipmap | null = null; // largest maxDim ≤ cap
  let smallestOver: TexMipmap | null = null; // smallest maxDim > cap
  const maxDimOf = (m: TexMipmap): number => (m.width > m.height ? m.width : m.height);
  for (const m of mipmaps) {
    const maxDim = maxDimOf(m);
    if (maxDim <= cap) {
      if (!bestFit || maxDimOf(bestFit) < maxDim) bestFit = m;
    } else if (!smallestOver || maxDim < maxDimOf(smallestOver)) {
      smallestOver = m;
    }
  }
  return bestFit ?? smallestOver ?? largest;
}

// ---------------------------------------------------------------------------
// Embedded Image Detection
// ---------------------------------------------------------------------------

/** Check if a buffer starts with a known image file signature and return
 *  the corresponding base64 data URL, or null if no signature matches.
 *  Supports PNG, JPEG, and BMP — the three formats Wallpaper Engine embeds
 *  in TEX containers via FreeImage. */
function embeddedImageToDataUrl(bytes: Buffer): string | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  }
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return `data:image/bmp;base64,${bytes.toString('base64')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TEX Image Decoding
// ---------------------------------------------------------------------------

/** Largest mipmap of an image. Embedded-PNG chains mix formats: the LARGEST
 *  mip is the real PNG/JPEG file while the smaller mips are DXT-compressed
 *  (verified against real workshop data: 431 of 256 multi-mip embedded
 *  textures have non-image bytes in their smaller mips). */
function largestMipOf(image: TexImage): TexMipmap | null {
  if (image.mipmaps.length === 0) return null;
  let largest = image.mipmaps[0];
  for (const m of image.mipmaps) {
    if (m.width * m.height > largest.width * m.height) largest = m;
  }
  return largest;
}

/** Decode one image of a TexData to an RGBA buffer, capped to the scene
 *  texture limit. Shared by {@link texToDataUrl} and the GIF frame renderer.
 *
 *  Picks the mipmap that best matches the scene-texture cap: the smallest mip
 *  ≥ 2048 (e.g. a 4096² texture decodes its 2048² mip directly — 1/4 the RGBA
 *  of the full-res decode). Only when the chain lacks a fitting mip
 *  (single-mip 4096², or 8192²→4096² jumps) do we decode a larger mip and
 *  downscale it below. */
function decodeTexImageRgba(
  tex: TexData,
  image: TexImage,
): { rgba: Buffer; width: number; height: number } | null {
  const mipmap = pickMipmapForDisplay(image.mipmaps, MAX_SCENE_TEXTURE_DIM);
  const targetW = cappedTextureDim(mipmap.width);
  const targetH = cappedTextureDim(mipmap.height);

  let rgba = decompressDxt(tex.format, mipmap.width, mipmap.height, mipmap.bytes);
  if (!rgba) return null;

  // Handle R8 and RG88 → expand to RGBA
  if (tex.format === TEX_FORMAT.R8) {
    const expanded = Buffer.alloc(mipmap.width * mipmap.height * 4);
    for (let i = 0; i < mipmap.width * mipmap.height; i++) {
      expanded[i * 4] = rgba[i];
      expanded[i * 4 + 1] = rgba[i];
      expanded[i * 4 + 2] = rgba[i];
      expanded[i * 4 + 3] = 255;
    }
    rgba = expanded;
  } else if (tex.format === TEX_FORMAT.RG88) {
    const expanded = Buffer.alloc(mipmap.width * mipmap.height * 4);
    for (let i = 0; i < mipmap.width * mipmap.height; i++) {
      expanded[i * 4] = rgba[i * 2];
      expanded[i * 4 + 1] = rgba[i * 2 + 1];
      expanded[i * 4 + 2] = 0;
      expanded[i * 4 + 3] = 255;
    }
    rgba = expanded;
  }

  // Downscale to the scene-texture cap: halve the (already-decoded) RGBA
  // buffer while it is still above the cap. A 4096² texture becomes 2048²
  // here — the same visual result as decoding the 2048² mip, but at 1/4 the
  // RGBA + PNG memory. Never allocates a second full-size buffer (the
  // box-filter writes into the first half of the same buffer).
  let width = mipmap.width;
  let height = mipmap.height;
  if (width > targetW || height > targetH) {
    // Both dims halve together (textures are square); pick the smallest
    // factor that brings the larger dim under the cap.
    const factor = width > height ? width / targetW : height / targetH;
    const k = factor >= 4 ? 4 : 2;
    const nextW = Math.floor(width / k);
    const nextH = Math.floor(height / k);
    boxDownscaleRgba(rgba, width, height, k);
    width = nextW;
    height = nextH;
  }

  return { rgba, width, height };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Convert a TexData's first image (largest mipmap) to a base64 PNG data URL.
 *  Uses the `canvas` package or falls back to raw RGBA → PNG encoding.
 *
 *  For TEXB0003/TEXB0004 containers with imageFormat = PNG (13) or JPEG (2),
 *  the mipmap bytes ARE the raw image file — we return them directly as a
 *  data URL without attempting DXT decompression. This is the most common
 *  case for scene wallpapers created from static images. */
export function texToDataUrl(tex: TexData): string | null {
  const image = tex.images[0];
  if (!image) return null;
  const largest = largestMipOf(image);
  if (!largest) return null;

  // Embedded image format (PNG/JPEG): ONLY the largest mip carries the raw
  // image file — return it directly as a base64 data URL. Do NOT pick a
  // capped mip here: the smaller mips are DXT-compressed, not image files,
  // so decoding them as PNG/JPEG yields garbage (the black-block symptom).
  // This handles both explicit imageFormat fields and fallback signature
  // detection (some TEXB0001 files lack the imageFormat field but still
  // contain embedded PNG data).
  if (tex.imageFormat === FIF_PNG || tex.imageFormat === FIF_JPEG) {
    return embeddedImageToDataUrl(largest.bytes);
  }
  // Fallback: detect PNG/JPEG by magic bytes even if imageFormat wasn't set
  // (e.g. TEXB0001 containers that predate the imageFormat field).
  const dataUrl = embeddedImageToDataUrl(largest.bytes);
  if (dataUrl) return dataUrl;

  const decoded = decodeTexImageRgba(tex, image);
  if (!decoded) return null;
  return rgbaToPngDataUrl(decoded.rgba, decoded.width, decoded.height);
}

/** Render every frame of an animated (GIF) texture to data URLs, preserving
 *  each frame's display duration. Returns null when the texture is not
 *  animated (no TEXS0001 frame table) or no frame decodes successfully.
 *
 *  Frames that fail to decode are skipped — a partially-usable GIF still
 *  animates with its remaining frames instead of falling back to static. */
export function texFramesToDataUrls(tex: TexData): TexFrameRendered[] | null {
  if (!tex.isGif || tex.frames.length === 0) return null;
  // Per-image decode cache: animated textures can reference the same image
  // multiple times (sprite-atlas GIFs), so decode once per imageId.
  const rgbaCache = new Map<number, { rgba: Buffer; width: number; height: number }>();
  const out: TexFrameRendered[] = [];
  for (const frame of tex.frames) {
    const dataUrl = renderTexFrame(tex, frame, rgbaCache);
    if (dataUrl) out.push({ dataUrl, frametime: frame.frametime });
  }
  return out.length > 0 ? out : null;
}

/** Render a single TEXS0001 frame entry (imageId + atlas region) to a data URL. */
function renderTexFrame(
  tex: TexData,
  frame: TexFrameInfo,
  rgbaCache: Map<number, { rgba: Buffer; width: number; height: number }>,
): string | null {
  const image = tex.images[frame.imageId];
  if (!image) return null;

  // Embedded PNG/JPEG frames: return the whole image file directly. Sub-rect
  // crop is unsupported for embedded formats — the frame covers the full
  // image in the common flipbook case, and the whole image is a better
  // degraded result than nothing for sprite-atlas GIFs.
  if (tex.imageFormat === FIF_PNG || tex.imageFormat === FIF_JPEG) {
    const largest = largestMipOf(image);
    return largest ? embeddedImageToDataUrl(largest.bytes) : null;
  }

  let decoded: { rgba: Buffer; width: number; height: number } | null =
    rgbaCache.get(frame.imageId) ?? null;
  if (!decoded) {
    // Fallback: some non-PNG-flagged textures still embed image bytes.
    const largest = largestMipOf(image);
    if (largest) {
      const embedded = embeddedImageToDataUrl(largest.bytes);
      if (embedded) return embedded;
    }
    decoded = decodeTexImageRgba(tex, image);
    if (!decoded) return null;
    rgbaCache.set(frame.imageId, decoded);
  }

  // Region crop from the TEXS0001 frame table (sprite-atlas GIFs). The frame
  // x/y/width/height are in texture space (top-origin row order, matching the
  // decoded buffer). Frames that cover the whole image — or declare an empty
  // region (0) — skip the crop entirely, which is the common flipbook case.
  const cropW = frame.width > 0 && frame.width < decoded.width ? frame.width : decoded.width;
  const cropH = frame.height > 0 && frame.height < decoded.height ? frame.height : decoded.height;
  const isFull =
    frame.x <= 0 && frame.y <= 0 && cropW === decoded.width && cropH === decoded.height;
  if (isFull) return rgbaToPngDataUrl(decoded.rgba, decoded.width, decoded.height);

  const cx = Math.max(0, Math.min(decoded.width - cropW, Math.round(frame.x)));
  const cy = Math.max(0, Math.min(decoded.height - cropH, Math.round(frame.y)));
  const cropped = Buffer.alloc(cropW * cropH * 4);
  for (let row = 0; row < cropH; row++) {
    const srcStart = (cy + row) * decoded.width * 4 + cx * 4;
    decoded.rgba.copy(cropped, row * cropW * 4, srcStart, srcStart + cropW * 4);
  }
  return rgbaToPngDataUrl(cropped, cropW, cropH);
}
