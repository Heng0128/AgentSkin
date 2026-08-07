// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser
 *
 * Parses Wallpaper Engine's proprietary `.tex` texture format, including
 * LZ4-compressed mipmaps, DXT1/DXT3/DXT5 decompression, and conversion to
 * browser-displayable PNG data URLs.
 *
 * Extracted from `scene-pkg-parser.ts` as part of the SRP refactor (P0-3).
 *
 * ## TEX Format
 * - Magic1: "TEXV0005", Magic2: "TEXI0001" (16-byte null-padded strings)
 * - Header: format, flags, textureWidth, textureHeight, imageWidth, imageHeight
 * - Image container: TEXB0001–TEXB0004 with mipmaps
 * - Mipmaps may be LZ4-compressed; pixel data may be DXT1/DXT3/DXT5 compressed
 * - Optional frame info container for animated GIF textures
 *
 * References:
 * - https://github.com/notscuffed/repkg (C# reference implementation)
 */

import { deflateSync } from 'node:zlib';
import { lz4DecodeBlock } from '../lz4-decoder';
import { BinaryReader } from './binary-reader';

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

export const TEX_FORMAT = {
  RGBA8888: 0,
  DXT5: 4,
  DXT3: 6,
  DXT1: 7,
  RG88: 8,
  R8: 9,
} as const;

export const TEX_FLAGS = {
  NONE: 0,
  NO_INTERPOLATION: 1,
  CLAMP_UVS: 2,
  IS_GIF: 4,
} as const;

/**
 * Maximum texture dimension for scene-wallpaper rendering.
 *
 * A scene's textures are displayed at quad size × cover scale — for a
 * fullscreen 1080p layer that is ~1920 CSS px, no matter the source
 * resolution. Wallpaper Engine ships textures as square power-of-two
 * (2048²/4096²/8192²), so a 4K+ source on a 1080p layer is 4-16× the bytes
 * the display needs. Every layer's image is decoded to full RGBA at once in
 * the wallpaper iframe, so oversized textures directly inflate both the scene
 * HTML (base64 PNG data URLs) and the iframe's memory — a 20-layer scene with
 * 4096² textures decodes ~900MB.
 *
 * Capping at 2048 keeps 1080p/2K wallpapers essentially pixel-perfect (the
 * display is ≤2048 wide) while cutting 4096² sources 4× and 8192² sources
 * 16×. 4K displays get a slightly softer background — an acceptable trade for
 * the ~4-16× memory reduction.
 */
export const MAX_SCENE_TEXTURE_DIM = 2048;

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

export interface TexMipmap {
  width: number;
  height: number;
  bytes: Buffer;
}

export interface TexImage {
  mipmaps: TexMipmap[];
}

export interface TexFrameInfo {
  imageId: number;
  frametime: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TexData {
  format: number;
  flags: number;
  textureWidth: number;
  textureHeight: number;
  imageWidth: number;
  imageHeight: number;
  images: TexImage[];
  isGif: boolean;
  frames: TexFrameInfo[];
  /** Derived from FreeImageFormat in the container, if present. */
  imageFormat: number;
}

// ---------------------------------------------------------------------------
// TEX Parser
// ---------------------------------------------------------------------------

/** Parse a .tex file from a Buffer. Returns null on invalid data. */
export function parseTex(buf: Buffer): TexData | null {
  const reader = new BinaryReader(buf);

  let magic1: string, magic2: string;
  try {
    magic1 = reader.readNullTerminatedString();
    magic2 = reader.readNullTerminatedString();
  } catch {
    return null;
  }
  if (magic1 !== 'TEXV0005' || magic2 !== 'TEXI0001') return null;

  const format = reader.readInt32();
  const flags = reader.readInt32();
  const textureWidth = reader.readInt32();
  const textureHeight = reader.readInt32();
  const imageWidth = reader.readInt32();
  const imageHeight = reader.readInt32();
  /* unkInt0 */ reader.readUint32();

  const isGif = (flags & TEX_FLAGS.IS_GIF) !== 0;

  // Image container
  const containerMagic = reader.readNullTerminatedString();
  const imageCount = reader.readInt32();
  const version = parseInt(containerMagic.replace('TEXB', ''), 10) || 1;

  let imageFormat = -1;
  if (containerMagic === 'TEXB0003') {
    imageFormat = reader.readInt32();
  } else if (containerMagic === 'TEXB0004') {
    const fmt = reader.readInt32();
    const isVideoMp4 = reader.readInt32();
    imageFormat = fmt === -1 && isVideoMp4 === 1 ? 7 : fmt; // VideoMp4 = 7
  }

  const images: TexImage[] = [];
  for (let i = 0; i < imageCount; i++) {
    const mipmapCount = reader.readInt32();
    const mipmaps: TexMipmap[] = [];
    for (let j = 0; j < mipmapCount; j++) {
      mipmaps.push(readMipmap(reader, version));
    }
    images.push({ mipmaps });
  }

  // Frame info (GIF only)
  const frames: TexFrameInfo[] = [];
  if (isGif && reader.remaining > 20) {
    try {
      const frameMagic = reader.readNullTerminatedString();
      const frameCount = reader.readInt32();
      for (let i = 0; i < frameCount; i++) {
        const imageId = reader.readInt32();
        const frametime = reader.readFloat32();
        if (frameMagic === 'TEXS0001') {
          frames.push({
            imageId,
            frametime,
            x: reader.readInt32(),
            y: reader.readInt32(),
            width: reader.readInt32(),
            height: reader.readInt32(),
          });
          reader.readInt32(); // widthY (unused)
          reader.readInt32(); // heightX (unused)
        } else {
          frames.push({
            imageId,
            frametime,
            x: reader.readFloat32(),
            y: reader.readFloat32(),
            width: reader.readFloat32(),
            height: reader.readFloat32(),
          });
          reader.readFloat32(); // widthY
          reader.readFloat32(); // heightX
        }
      }
    } catch {
      // Frame info parsing failed — treat as non-animated
    }
  }

  return {
    format,
    flags,
    textureWidth,
    textureHeight,
    imageWidth,
    imageHeight,
    images,
    isGif,
    frames,
    imageFormat,
  };
}

function readMipmap(reader: BinaryReader, version: number): TexMipmap {
  if (version === 1) {
    const width = reader.readInt32();
    const height = reader.readInt32();
    const byteCount = reader.readInt32();
    const bytes = reader.readBytes(byteCount);
    return { width, height, bytes };
  }

  // Versions 2, 3, and 4 all share the same mipmap format:
  //   width, height, isLz4, decompressedSize, byteCount, bytes
  // TEXB0004 differs from TEXB0003 only in the container header (extra
  // fmt + isVideoMp4 fields), NOT in the mipmap layout. The previous code
  // incorrectly read 4 extra fields for version >= 4, causing the parser
  // to go out of bounds on TEXB0004 files.
  const width = reader.readInt32();
  const height = reader.readInt32();
  const isLz4Compressed = reader.readInt32() === 1;
  const decompressedBytesCount = reader.readInt32();
  const byteCount = reader.readInt32();
  let bytes = reader.readBytes(byteCount);

  if (isLz4Compressed && decompressedBytesCount > 0) {
    const output = Buffer.alloc(decompressedBytesCount);
    try {
      lz4DecodeBlock(bytes, output);
      bytes = output;
    } catch (error) {
      // LZ4 decode failed — leave compressed data in place. Downstream DXT
      // decode will then also fail and the texture is dropped by the caller,
      // but log here so a corrupt/compressed mipmap is diagnosable instead
      // of producing silently garbage pixels. Compression ratio + error
      // message are enough to identify whether this is a truncated file,
      // an unsupported LZ4 variant, or a malformed header.
      console.warn(
        `[tex-parser] LZ4 decode failed (compressed=${bytes.length}B, ` +
          `expected=${decompressedBytesCount}B): ${(error as Error)?.message ?? error}`,
      );
    }
  }

  return { width, height, bytes };
}

// ---------------------------------------------------------------------------
// DXT Decompression
// ---------------------------------------------------------------------------

/** Decompress DXT1/DXT3/DXT5 to RGBA8888. Returns null for unsupported formats. */
export function decompressDxt(
  format: number,
  width: number,
  height: number,
  src: Buffer,
): Buffer | null {
  if (format === TEX_FORMAT.RGBA8888 || format === TEX_FORMAT.R8 || format === TEX_FORMAT.RG88) {
    return src; // Already uncompressed
  }
  if (format === TEX_FORMAT.DXT1) return decompressDxt1(width, height, src);
  if (format === TEX_FORMAT.DXT3) return decompressDxt3(width, height, src);
  if (format === TEX_FORMAT.DXT5) return decompressDxt5(width, height, src);
  return null;
}

function decompressDxt1(width: number, height: number, src: Buffer): Buffer {
  const blockSize = 8;
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const dst = Buffer.alloc(width * height * 4);
  let srcPos = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const c0 = src.readUint16LE(srcPos);
      const c1 = src.readUint16LE(srcPos + 2);
      const lookup = src.readUint32LE(srcPos + 4);
      srcPos += blockSize;

      const [r0, g0, b0] = rgb565ToRgb888(c0);
      const [r1, g1, b1] = rgb565ToRgb888(c1);

      const colors: Array<[number, number, number, number]> = [
        [r0, g0, b0, 255],
        [r1, g1, b1, 255],
      ];
      if (c0 > c1) {
        colors.push([
          Math.round((2 * r0 + r1) / 3),
          Math.round((2 * g0 + g1) / 3),
          Math.round((2 * b0 + b1) / 3),
          255,
        ]);
        colors.push([
          Math.round((r0 + 2 * r1) / 3),
          Math.round((g0 + 2 * g1) / 3),
          Math.round((b0 + 2 * b1) / 3),
          255,
        ]);
      } else {
        colors.push([
          Math.round((r0 + r1) / 2),
          Math.round((g0 + g1) / 2),
          Math.round((b0 + b1) / 2),
          255,
        ]);
        colors.push([0, 0, 0, 0]); // transparent
      }

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const idx = (lookup >> (2 * (py * 4 + px))) & 3;
          const [r, g, b, a] = colors[idx];
          const di = (y * width + x) * 4;
          dst[di] = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = a;
        }
      }
    }
  }
  return dst;
}

function decompressDxt3(width: number, height: number, src: Buffer): Buffer {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const dst = Buffer.alloc(width * height * 4);
  let srcPos = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Read 4-bit alpha values (8 bytes = 64 bits = 16 x 4-bit values)
      const alphas: number[] = [];
      for (let i = 0; i < 8; i++) {
        const byte = src[srcPos + i];
        alphas.push((byte & 0xf) * 17);
        alphas.push((byte >> 4) * 17);
      }
      srcPos += 8;

      // Read color block (same as DXT1)
      const c0 = src.readUint16LE(srcPos);
      const c1 = src.readUint16LE(srcPos + 2);
      const lookup = src.readUint32LE(srcPos + 4);
      srcPos += 8;

      const [r0, g0, b0] = rgb565ToRgb888(c0);
      const [r1, g1, b1] = rgb565ToRgb888(c1);
      const colors: Array<[number, number, number]> = [
        [r0, g0, b0],
        [r1, g1, b1],
        [
          Math.round((2 * r0 + r1) / 3),
          Math.round((2 * g0 + g1) / 3),
          Math.round((2 * b0 + b1) / 3),
        ],
        [
          Math.round((r0 + 2 * r1) / 3),
          Math.round((g0 + 2 * g1) / 3),
          Math.round((b0 + 2 * b1) / 3),
        ],
      ];

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const ci = (lookup >> (2 * (py * 4 + px))) & 3;
          const ai = py * 4 + px;
          const [r, g, b] = colors[ci];
          const di = (y * width + x) * 4;
          dst[di] = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = alphas[ai];
        }
      }
    }
  }
  return dst;
}

function decompressDxt5(width: number, height: number, src: Buffer): Buffer {
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const dst = Buffer.alloc(width * height * 4);
  let srcPos = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Read alpha block (8 bytes total):
      //   alpha0 (1 byte), alpha1 (1 byte), 6 bytes of 4-bit lookup values
      //   (48 bits = 16 x 3-bit indices into the alphas[] table below).
      const alpha0 = src[srcPos];
      const alpha1 = src[srcPos + 1];
      const alphaBytes = src.subarray(srcPos + 2, srcPos + 8);
      srcPos += 8;

      const alphas: number[] = [alpha0, alpha1];
      if (alpha0 > alpha1) {
        for (let i = 1; i <= 6; i++) {
          alphas.push(Math.round(((7 - i) * alpha0 + i * alpha1) / 7));
        }
      } else {
        for (let i = 1; i <= 4; i++) {
          alphas.push(Math.round(((5 - i) * alpha0 + i * alpha1) / 5));
        }
        alphas.push(0);
        alphas.push(255);
      }

      // Read 4-bit alpha indices from alphaBytes (6 bytes = 48 bits = 16 x 3-bit values)
      const alphaIndices: number[] = [];
      let bits = 0;
      let bitCount = 0;
      for (let i = 0; i < 6; i++) {
        bits |= alphaBytes[i] << bitCount;
        bitCount += 8;
      }
      for (let i = 0; i < 16; i++) {
        alphaIndices.push((bits >> (i * 3)) & 7);
      }

      // Read color block (8 bytes, same as DXT1)
      const c0 = src.readUint16LE(srcPos);
      const c1 = src.readUint16LE(srcPos + 2);
      const lookup = src.readUint32LE(srcPos + 4);
      srcPos += 8;

      const [r0, g0, b0] = rgb565ToRgb888(c0);
      const [r1, g1, b1] = rgb565ToRgb888(c1);
      const colors: Array<[number, number, number]> = [
        [r0, g0, b0],
        [r1, g1, b1],
        [
          Math.round((2 * r0 + r1) / 3),
          Math.round((2 * g0 + g1) / 3),
          Math.round((2 * b0 + b1) / 3),
        ],
        [
          Math.round((r0 + 2 * r1) / 3),
          Math.round((g0 + 2 * g1) / 3),
          Math.round((b0 + 2 * b1) / 3),
        ],
      ];

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const ci = (lookup >> (2 * (py * 4 + px))) & 3;
          const ai = py * 4 + px;
          const [r, g, b] = colors[ci];
          const di = (y * width + x) * 4;
          dst[di] = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = alphas[alphaIndices[ai]];
        }
      }
    }
  }
  return dst;
}

function rgb565ToRgb888(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) << 3;
  const g = ((c >> 5) & 0x3f) << 2;
  const b = (c & 0x1f) << 3;
  return [r | (r >> 5), g | (g >> 6), b | (b >> 5)];
}

// ---------------------------------------------------------------------------
// TEX → PNG Data URL conversion
// ---------------------------------------------------------------------------

/** FreeImage format constants used by TEXB0003/TEXB0004 containers. When
 *  imageFormat is one of these, the mipmap bytes contain a raw image file
 *  (PNG/JPEG) rather than DXT-compressed pixel data. */
const FIF_JPEG = 2;
const FIF_PNG = 13;

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

/** One rendered GIF frame: a data URL plus its display duration in seconds. */
export interface TexFrameRendered {
  dataUrl: string;
  frametime: number;
}

/** Largest mipmap of an image. Embedded-PNG chains mix formats: the LARGEST
 *  mip is the real PNG/JPEG file while the smaller mips are DXT-compressed
 *  (verified against real workshop data: 431 of 256 multi-mip embedded
 *  textures have non-image bytes in their smaller mips). */
function largestMipOf(image: TexImage): TexMipmap | null {
  if (image.mipmaps.length === 0) return null;
  let largest = image.mipmaps[0];
  for (const m of image.mipmaps) {
    if (m.width * m.height > largest.width * largest.height) largest = m;
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

/** Encode raw RGBA bytes as a base64 PNG data URL (pure TS, no canvas dep). */
export function rgbaToPngDataUrl(rgba: Buffer, width: number, height: number): string {
  // Build PNG manually: signature + IHDR + IDAT + IEND
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUint32BE(width, 0);
  ihdr.writeUint32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Build raw scanlines with filter byte (0 = none) per row
  const rowSize = width * 4;
  const raw = Buffer.alloc((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowSize + 1)] = 0; // filter: none
    rgba.subarray(y * rowSize, (y + 1) * rowSize).copy(raw, y * (rowSize + 1) + 1);
  }

  // Compress with zlib (Node built-in)
  const compressed = deflateSync(raw);

  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ];

  const totalSize = signature.length + chunks.reduce((s, c) => s + c.length, 0);
  const png = Buffer.concat([signature, ...chunks], totalSize);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUint32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUint32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// CRC32 for PNG chunks
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
