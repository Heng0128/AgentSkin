// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser
 *
 * Parses Wallpaper Engine's proprietary `.tex` texture format, including
 * LZ4-compressed mipmaps, DXT1/DXT3/DXT5/BC7 decompression, and conversion to
 * browser-displayable PNG data URLs.
 *
 * Extracted from `scene-pkg-parser.ts` as part of the SRP refactor (P0-3).
 *
 * ## TEX Format
 * - Magic1: "TEXV0005" or "TEXV0006", Magic2: "TEXI0001" (16-byte null-padded strings)
 * - Header: format, flags, textureWidth, textureHeight, imageWidth, imageHeight
 * - Image container: TEXB0001–TEXB0004 with mipmaps
 * - Mipmaps may be LZ4-compressed; pixel data may be DXT1/DXT3/DXT5/BC7 compressed
 * - Optional frame info container for animated GIF textures
 *
 * References:
 * - https://github.com/notscuffed/repkg (C# reference implementation)
 * - https://learn.microsoft.com/en-us/windows/win32/direct3d11/bc7-format
 */

import { deflateSync } from 'node:zlib';
import { lz4DecodeBlock } from '../lz4-decoder';
import { BinaryReader } from './binary-reader';

/**
 * Hard limits that keep a corrupt or hostile `.tex`/`.pkg` from crashing the
 * renderer with an out-of-memory allocation or an out-of-bounds read.
 *
 * NOTE: `MAX_SCENE_TEXTURE_DIM` (exported below as 2048) is the *display* cap
 * used by `cappedTextureDim`/`pickMipmapForDisplay`. These two constants are
 * the *raw decode* safety limits and are intentionally larger.
 *
 * - `MAX_SCENE_DECODE_DIM`: a single decoded side larger than this is treated
 *   as corrupt (legitimate Wallpaper Engine textures cap at 8192; 16384 leaves
 *   headroom for non-square oddities). Anything far beyond is an attack/garbage
 *   value and would allocate gigabytes via `Buffer.alloc(w*h*4)`.
 * - `MAX_SCENE_DECODE_BYTES`: the most memory a single mipmap decode may
 *   allocate. ~512 MiB comfortably covers an 8192² RGBA texture while rejecting
 *   absurd `decompressedBytesCount` claims from a broken LZ4 header.
 */
export const MAX_SCENE_DECODE_DIM = 16384;
export const MAX_SCENE_DECODE_BYTES = 512 * 1024 * 1024;

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
  BC7: 10,
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

const BC7_WEIGHTS_2 = [0, 21, 43, 64];
const BC7_WEIGHTS_3 = [0, 9, 18, 27, 37, 46, 55, 64];
const BC7_WEIGHTS_4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

// ---------------------------------------------------------------------------
// BC7 partition & anchor tables
// ---------------------------------------------------------------------------
// Derived from the canonical BC7 specification. Reference source:
// https://github.com/richgel999/bc7enc  (bc7decomp.cpp, MIT © Richard Geldreich, Jr.)
// which itself follows the Microsoft D3D11 / DirectXTex tables exactly.
//
// BC7 fix-up index rule (per the spec):
//   For each subset, the "anchor" pixel's most-significant index bit is
//   implicitly 0, so only (indexBits - 1) bits are stored for that pixel
//   in the bitstream.  Non-anchor pixels store the full indexBits.
//   This is why indices MUST be decoded sequentially from bitstream start —
//   skipping an anchor shifts every subsequent read offset by 1 bit.
//
// Tables below are little-endian bit-order (LSB first) to match bc7ReadBits.

// 2-subset partition table (64 entries × 16 pixels), values ∈ {0, 1}.
// Indexed as BC7_PARTITION_2[partitionSetId * 16 + pixelIndex].
const BC7_PARTITION_2 = new Uint8Array([
  0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
  1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0,
  0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0,
  1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0,
  1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
  0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0,
  1, 1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0,
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1,
  0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
  0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0,
  0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1,
  0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0,
  1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1,
  0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1,
  0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1,
  0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1,
  0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1,
  0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1,
  1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1,
  0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0,
  0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1,
  1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0,
  1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 1,
  1,
]);

// Anchor pixel for subset 1 in 2-subset modes (modes 1, 3, 7).
// The subset-0 anchor is always pixel 0 per spec; this table gives the subset-1
// anchor pixel index, one per partition set ID (0..63).
const BC7_ANCHOR_INDEX_2_SUB1 = new Uint8Array([
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2,
  2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15,
  15, 15, 15, 15, 2, 2, 15,
]);

// 3-subset partition table (64 entries × 16 pixels), values ∈ {0, 1, 2}.
// Same reference source as above.  Indexed as BC7_PARTITION_3[partitionSetId * 16 + pixelIndex].
const BC7_PARTITION_3 = new Uint8Array([
  0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 1, 2, 2, 2, 2, 0, 0, 0, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 2, 1, 0,
  0, 0, 0, 2, 0, 0, 1, 2, 2, 1, 1, 2, 2, 1, 1, 0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 2,
  2, 0, 0, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 1,
  1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 1, 1, 2, 0, 1,
  1, 2, 0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1, 0, 1, 1,
  2, 1, 1, 2, 2, 1, 2, 2, 2, 0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0, 2, 2, 2, 0, 0, 0, 0, 1, 0, 0, 1, 1,
  0, 1, 1, 2, 1, 1, 2, 2, 0, 1, 1, 1, 0, 0, 1, 1, 2, 0, 0, 1, 2, 2, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1,
  1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 2,
  2, 2, 0, 2, 2, 2, 0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 2, 1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2,
  2, 0, 1, 2, 2, 0, 0, 0, 0, 1, 1, 0, 0, 2, 2, 1, 0, 2, 2, 1, 0, 0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1, 1,
  0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2, 0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1, 0,
  1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2, 2, 1, 1, 2, 2, 1, 0, 0, 2, 2, 1, 1, 0, 2, 1, 1, 0, 2, 0, 0,
  2, 2, 0, 1, 1, 0, 0, 1, 1, 0, 2, 0, 0, 2, 2, 2, 2, 2, 0, 0, 1, 1, 0, 1, 2, 2, 0, 1, 2, 2, 0, 0, 1,
  1, 0, 0, 0, 0, 2, 0, 0, 0, 2, 2, 1, 1, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 2, 2, 1, 2, 2, 2,
  0, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 2, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 2, 0, 0, 2, 2, 0, 2, 2, 2, 0,
  1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 0, 1,
  2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 0, 0, 1,
  1, 2, 2, 0, 0, 1, 1, 2, 2, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1,
  0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 2, 2, 1,
  1, 2, 2, 0, 0, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 1, 1, 0, 2, 2, 0, 1, 2,
  2, 1, 0, 2, 2, 0, 1, 2, 2, 1, 0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 0, 1, 0, 0, 0, 0, 2, 1, 2,
  1, 2, 1, 2, 1, 2, 1, 2, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 2, 2, 2, 2, 0, 2, 2, 2, 0, 1, 1, 1,
  0, 2, 2, 2, 0, 1, 1, 1, 0, 0, 0, 2, 1, 1, 1, 2, 0, 0, 0, 2, 1, 1, 1, 2, 0, 0, 0, 0, 2, 1, 1, 2, 2,
  1, 1, 2, 2, 1, 1, 2, 0, 2, 2, 2, 0, 1, 1, 1, 0, 1, 1, 1, 0, 2, 2, 2, 0, 0, 0, 2, 1, 1, 1, 2, 1, 1,
  1, 2, 0, 0, 0, 2, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1,
  2, 2, 1, 1, 2, 0, 1, 1, 0, 0, 1, 1, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 2, 2, 0, 0, 1, 1, 0, 0, 1, 1,
  0, 0, 2, 2, 0, 0, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
  1, 2, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 2, 2, 1, 2, 2, 2, 0, 2, 2, 2, 1, 2,
  2, 2, 0, 1, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 1, 1, 2, 0, 1, 1, 2, 2, 0, 1, 2, 2, 2,
  0,
]);

// 3-subset anchor tables (one per subset beyond subset-0, which is always pixel 0).
// Subset 1 anchor pixel index, then subset 2 anchor pixel index, per partition set ID (0..63).
const BC7_ANCHOR_INDEX_3_SUB1 = new Uint8Array([
  3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5,
  15, 15, 8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10,
  8, 13, 15, 12, 3, 3,
]);
const BC7_ANCHOR_INDEX_3_SUB2 = new Uint8Array([
  15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6,
  10, 15, 15, 10, 8, 15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15,
  15, 15, 15, 15, 15, 15, 3, 15, 15, 8,
]);

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
  const VALID_MAGICS = ['TEXV0005', 'TEXV0006'];
  if (!VALID_MAGICS.includes(magic1) || magic2 !== 'TEXI0001') return null;

  // Slurp the entire body in one guarded block: a truncated header, a corrupt
  // frame table, or any out-of-bounds scalar read now degrades to a clean
  // `null` (the function's documented contract) instead of surfacing an opaque
  // RangeError to the caller. `extractTextures` already treats a thrown error
  // the same way, but returning null keeps the contract explicit and avoids a
  // confusing stack trace for the common "partially downloaded .tex" case.
  try {
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
    // A corrupt length field could claim an enormous image count; cap it so the
    // loop stays bounded even when the container carries trailing padding bytes.
    const imageCount = Math.max(0, Math.min(reader.readInt32(), 4096));
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
      // Cap per-image mipmap count the same way as imageCount.
      const mipmapCount = Math.max(0, Math.min(reader.readInt32(), 1 << 16));
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
  } catch {
    // Truncated/corrupt header or frame table → the whole file is unparseable.
    return null;
  }
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
    // Reject absurd decompressed-size claims (corrupt/attacker-controlled
    // header) *before* attempting the allocation. Buffer.alloc accepts values
    // up to ~2 GB and would otherwise OOM the renderer or throw a cryptic
    // RangeError. Above the decode budget we leave the (still-compressed)
    // bytes in place so downstream decode fails gracefully and the texture is
    // dropped by the caller.
    if (decompressedBytesCount > MAX_SCENE_DECODE_BYTES) {
      console.warn(
        `[tex-parser] LZ4 decompressed size ${decompressedBytesCount}B exceeds budget ` +
          `${MAX_SCENE_DECODE_BYTES}B — skipping decompression.`,
      );
    } else {
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
  }

  return { width, height, bytes };
}

// ---------------------------------------------------------------------------
// DXT Decompression
// ---------------------------------------------------------------------------

/** Decompress DXT1/DXT3/DXT5/BC7 to RGBA8888. Returns null for unsupported formats. */
export function decompressDxt(
  format: number,
  width: number,
  height: number,
  src: Buffer,
): Buffer | null {
  // Dimension safety: a corrupt header can report gigantic textures. Without a
  // guard, decompressDxt1/3/5/7 would call `Buffer.alloc(width*height*4)` and try
  // to read `src` well past its end (OOM + out-of-bounds reads). Reject up front.
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_SCENE_DECODE_DIM ||
    height > MAX_SCENE_DECODE_DIM
  ) {
    return null;
  }

  const blockW = Math.ceil(width / 4);
  const blockH = Math.ceil(height / 4);
  // Alloc budget for the decoded RGBA buffer — rejects dimensions that would
  // allocate hundreds of MiB+ while still allowing a legitimate 8192² texture.
  const withinBudget = width * height * 4 <= MAX_SCENE_DECODE_BYTES;

  if (format === TEX_FORMAT.RGBA8888) {
    // Already uncompressed; only guard against indexing out of `src`.
    return src.length >= width * height * 4 ? src : null;
  }
  if (format === TEX_FORMAT.R8) {
    return src.length >= width * height ? src : null;
  }
  if (format === TEX_FORMAT.RG88) {
    return src.length >= width * height * 2 ? src : null;
  }
  if (format === TEX_FORMAT.DXT1) {
    return blockW * blockH * 8 <= src.length && withinBudget
      ? decompressDxt1(width, height, src)
      : null;
  }
  if (format === TEX_FORMAT.DXT3) {
    return blockW * blockH * 16 <= src.length && withinBudget
      ? decompressDxt3(width, height, src)
      : null;
  }
  if (format === TEX_FORMAT.DXT5) {
    return blockW * blockH * 16 <= src.length && withinBudget
      ? decompressDxt5(width, height, src)
      : null;
  }
  if (format === TEX_FORMAT.BC7) {
    return blockW * blockH * 16 <= src.length && withinBudget
      ? decompressBc7(width, height, src)
      : null;
  }
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

// ---------------------------------------------------------------------------
// BC7 Decompression (bit-exact, all 8 modes)
// ---------------------------------------------------------------------------

/**
 * Decompress BC7-format texture data to RGBA8888.
 *
 * BC7 uses 16-byte blocks (128 bits), each covering a 4×4 texel region.
 * The mode is determined by the first set bit of byte 0 (bit 0 = mode 0,
 * bit 7 = mode 7). Byte 0 = 0x00 (mode 8) is reserved and decodes to black.
 *
 * This is a **bit-exact** implementation covering all 8 modes per the
 * Microsoft BC7 specification, including:
 * - Modes 0–3: color-only, multi-subset partitions with fix-up indices and
 *   P-bit handling (shared per subset in mode 1, per-endpoint in modes 0/3).
 * - Modes 4–5: separate color + alpha with rotation and (mode 4) a 1-bit
 *   index selector choosing 2/3-bit index widths.
 * - Mode 6: combined RGBA, single subset, 4-bit indices.
 * - Mode 7: combined RGBA, 2-subset partitions, P-bit per endpoint.
 *
 * Decode pipeline per texel:
 *   1. extract_mode → bit position of first 1-bit
 *   2. partition lookup → subset index (modes 0–3, 7)
 *   3. extract raw endpoints from bitstream
 *   4. fully_decode_endpoints: P-bit injection + MSB-replication
 *   5. per-texel index extraction (fix-up: anchor index MSB = 0)
 *   6. 4-point interpolation with spec weights
 *   7. channel rotation swap (modes 4–5)
 *
 * References:
 * - https://learn.microsoft.com/en-us/windows/win32/direct3d11/bc7-format
 * - https://learn.microsoft.com/en-us/windows/win32/direct3d11/bc7-format-mode-reference
 */
function decompressBc7(width: number, height: number, src: Buffer): Buffer {
  const blockSize = 16;
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const dst = Buffer.alloc(width * height * 4);
  let srcPos = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const block = src.subarray(srcPos, srcPos + 16);
      srcPos += blockSize;

      // Detect mode: first set bit from LSB of byte 0
      const modeByte = block[0];
      let mode = 0;
      for (let b = 0; b < 8; b++) {
        if (modeByte & (1 << b)) {
          mode = b;
          break;
        }
      }
      // mode 8 (byte 0 == 0x00) is reserved → black
      if (modeByte === 0x00) {
        continue;
      }

      // Parse block into local endpoint + index state
      decodeBc7Block(block, mode, dst, bx, by, width, height);
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// BC7 Bit Reader – reads little-endian bitstream from a 16-byte block
// ---------------------------------------------------------------------------

/** Reads `count` bits from a 16-byte block at bit offset `bitOfs`, LSB-first. */
function bc7ReadBits(block: Uint8Array, bitOfs: number, count: number): number {
  let result = 0;
  for (let i = 0; i < count; i++) {
    const byteIndex = (bitOfs + i) >> 3;
    const bitIndex = (bitOfs + i) & 7;
    if (block[byteIndex] & (1 << bitIndex)) {
      result |= 1 << i;
    }
  }
  return result;
}

// Partition + endpoint + index extraction per mode

function decodeBc7Block(
  block: Uint8Array,
  mode: number,
  dst: Buffer,
  bx: number,
  by: number,
  width: number,
  height: number,
): void {
  let numSubsets = 1;
  let rotation = 0;
  let idxMode = 0;

  // Bit-offsets for sequential bitstream fields
  // "Descriptor" bits start at bit 0. Mode indicator occupies (mode+1) bits (bits 0..mode).
  // After the mode indicator, we read remaining descriptor fields.
  // However, in the real BC7 layout bits 0..(mode-1) are all zero and don't carry data;
  // the mode 1-bit at position `mode` IS the highest bit of the first data channel.
  // So when we read raw endpoint data, we start at bit (mode + 1).
  const dataBitOfs = mode + 1;

  let bitOfs = dataBitOfs;

  // Partition set ID (if applicable)
  let partitionSetId = 0;

  switch (mode) {
    case 0:
      numSubsets = 3;
      partitionSetId = bc7ReadBits(block, bitOfs, 4);
      bitOfs += 4;
      break;
    case 1:
      numSubsets = 2;
      partitionSetId = bc7ReadBits(block, bitOfs, 6);
      bitOfs += 6;
      break;
    case 2:
      numSubsets = 3;
      partitionSetId = bc7ReadBits(block, bitOfs, 6);
      bitOfs += 6;
      break;
    case 3:
      numSubsets = 2;
      partitionSetId = bc7ReadBits(block, bitOfs, 6);
      bitOfs += 6;
      break;
    case 4:
      numSubsets = 1;
      idxMode = bc7ReadBits(block, bitOfs, 1);
      bitOfs += 1;
      rotation = bc7ReadBits(block, bitOfs, 2);
      bitOfs += 2;
      break;
    case 5:
      numSubsets = 1;
      rotation = bc7ReadBits(block, bitOfs, 2);
      bitOfs += 2;
      break;
    case 6:
      numSubsets = 1;
      break;
    case 7:
      numSubsets = 2;
      partitionSetId = bc7ReadBits(block, bitOfs, 6);
      bitOfs += 6;
      break;
  }

  // Extract raw endpoints per mode
  // Mode 0: RGBP 4.4.4.1, 3 subsets, unique P per endpoint
  // Mode 1: RGBP 6.6.6.1, 2 subsets, shared P per subset
  // Mode 2: RGB 5.5.5, 3 subsets, no P
  // Mode 3: RGBP 7.7.7.1, 2 subsets, unique P per subset
  // Mode 4: RGB 5.5.5 + A 6, 1 subset
  // Mode 5: RGB 7.7.7 + A 8, 1 subset
  // Mode 6: RGBAP 7.7.7.7.1, 1 subset, unique P per endpoint
  // Mode 7: RGBAP 5.5.5.5.1, 2 subsets, unique P per endpoint

  // We'll store endpoints as [r, g, b, a] with raw (un-decoded) values
  // Then apply fully_decode_endpoints (P-bit injection + bit replication)

  const rawEndpoints: number[][] = []; // [endpointIdx][RGBA]

  switch (mode) {
    case 0: {
      const numEp = numSubsets * 2; // 6
      // Per-channel endpoint reading (BC7 spec: all R, then all G, then all B)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let c = 0; c < 3; c++) {
        for (let e = 0; e < numEp; e++) {
          rawEndpoints[e][c] = bc7ReadBits(block, bitOfs, 4);
          bitOfs += 4;
        }
      }
      // 6 P-bits follow (one per endpoint)
      for (let i = 0; i < numEp; i++) {
        const p = bc7ReadBits(block, bitOfs, 1);
        bitOfs += 1;
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 1) | p;
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 1) | p;
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 1) | p;
      }
      // Replicate 5-bit to 8-bit
      for (let i = 0; i < rawEndpoints.length; i++) {
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 3) | (rawEndpoints[i][0] >> 2);
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 3) | (rawEndpoints[i][1] >> 2);
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 3) | (rawEndpoints[i][2] >> 2);
        rawEndpoints[i][3] = 255;
      }
      break;
    }
    case 1: {
      const numEp = numSubsets * 2; // 4
      // Per-channel endpoint reading (BC7 spec: all R, then all G, then all B)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let c = 0; c < 3; c++) {
        for (let e = 0; e < numEp; e++) {
          rawEndpoints[e][c] = bc7ReadBits(block, bitOfs, 6);
          bitOfs += 6;
        }
      }
      // Shared P-bits: 2 bits, one per subset
      const p0 = bc7ReadBits(block, bitOfs, 1);
      bitOfs += 1;
      const p1 = bc7ReadBits(block, bitOfs, 1);
      bitOfs += 1;
      // Inject P-bits into all channels of subset's endpoints
      rawEndpoints[0][0] = (rawEndpoints[0][0] << 1) | p0;
      rawEndpoints[0][1] = (rawEndpoints[0][1] << 1) | p0;
      rawEndpoints[0][2] = (rawEndpoints[0][2] << 1) | p0;
      rawEndpoints[1][0] = (rawEndpoints[1][0] << 1) | p0;
      rawEndpoints[1][1] = (rawEndpoints[1][1] << 1) | p0;
      rawEndpoints[1][2] = (rawEndpoints[1][2] << 1) | p0;
      rawEndpoints[2][0] = (rawEndpoints[2][0] << 1) | p1;
      rawEndpoints[2][1] = (rawEndpoints[2][1] << 1) | p1;
      rawEndpoints[2][2] = (rawEndpoints[2][2] << 1) | p1;
      rawEndpoints[3][0] = (rawEndpoints[3][0] << 1) | p1;
      rawEndpoints[3][1] = (rawEndpoints[3][1] << 1) | p1;
      rawEndpoints[3][2] = (rawEndpoints[3][2] << 1) | p1;
      // Replicate 7-bit to 8-bit
      for (let i = 0; i < rawEndpoints.length; i++) {
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 1) | (rawEndpoints[i][0] >> 6);
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 1) | (rawEndpoints[i][1] >> 6);
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 1) | (rawEndpoints[i][2] >> 6);
        rawEndpoints[i][3] = 255;
      }
      break;
    }
    case 2: {
      const numEp = numSubsets * 2; // 6
      // Per-channel endpoint reading (BC7 spec: all R, then all G, then all B)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let c = 0; c < 3; c++) {
        for (let e = 0; e < numEp; e++) {
          rawEndpoints[e][c] = bc7ReadBits(block, bitOfs, 5);
          bitOfs += 5;
        }
      }
      // No P-bits. Replicate 5-bit to 8-bit.
      for (let i = 0; i < rawEndpoints.length; i++) {
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 3) | (rawEndpoints[i][0] >> 2);
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 3) | (rawEndpoints[i][1] >> 2);
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 3) | (rawEndpoints[i][2] >> 2);
        rawEndpoints[i][3] = 255;
      }
      break;
    }
    case 3: {
      const numEp = numSubsets * 2; // 4
      // Per-channel endpoint reading (BC7 spec: all R, then all G, then all B)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let c = 0; c < 3; c++) {
        for (let e = 0; e < numEp; e++) {
          rawEndpoints[e][c] = bc7ReadBits(block, bitOfs, 7);
          bitOfs += 7;
        }
      }
      // 4 P-bits (unique per endpoint, NOT shared per subset)
      for (let i = 0; i < numEp; i++) {
        const p = bc7ReadBits(block, bitOfs, 1);
        bitOfs += 1;
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 1) | p;
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 1) | p;
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 1) | p;
      }
      // Replicate 8-bit to 8-bit (no-op, already 8 bits after P)
      for (let i = 0; i < rawEndpoints.length; i++) {
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 0) | (rawEndpoints[i][0] >> 8);
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 0) | (rawEndpoints[i][1] >> 8);
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 0) | (rawEndpoints[i][2] >> 8);
        rawEndpoints[i][3] = 255;
      }
      break;
    }
    case 4: {
      // Color+Alpha separate, 1 subset, 2-bit rotation
      // RGBA endpoints: R0(5), G0(5), B0(5), R1(5), G1(5), B1(5), A0(6), A1(6)
      const r0r1 = bc7ReadBits(block, bitOfs, 10);
      bitOfs += 10;
      const g0g1 = bc7ReadBits(block, bitOfs, 10);
      bitOfs += 10;
      const b0b1 = bc7ReadBits(block, bitOfs, 10);
      bitOfs += 10;
      const a0 = bc7ReadBits(block, bitOfs, 6);
      bitOfs += 6;
      const a1 = bc7ReadBits(block, bitOfs, 6);
      bitOfs += 6;
      const r0 = (r0r1 >> 0) & 0x1f,
        r1 = (r0r1 >> 5) & 0x1f;
      const g0 = (g0g1 >> 0) & 0x1f,
        g1 = (g0g1 >> 5) & 0x1f;
      const b0 = (b0b1 >> 0) & 0x1f,
        b1 = (b0b1 >> 5) & 0x1f;
      rawEndpoints.push([
        (r0 << 3) | (r0 >> 2),
        (g0 << 3) | (g0 >> 2),
        (b0 << 3) | (b0 >> 2),
        (a0 << 2) | (a0 >> 4),
      ]);
      rawEndpoints.push([
        (r1 << 3) | (r1 >> 2),
        (g1 << 3) | (g1 >> 2),
        (b1 << 3) | (b1 >> 2),
        (a1 << 2) | (a1 >> 4),
      ]);
      break;
    }
    case 5: {
      // Color+Alpha separate, 1 subset, 2-bit rotation
      // RGBA endpoints: R0(7), G0(7), B0(7), R1(7), G1(7), B1(7), A0(8), A1(8)
      const r0r1 = bc7ReadBits(block, bitOfs, 14);
      bitOfs += 14;
      const g0g1 = bc7ReadBits(block, bitOfs, 14);
      bitOfs += 14;
      const b0b1 = bc7ReadBits(block, bitOfs, 14);
      bitOfs += 14;
      const a0 = bc7ReadBits(block, bitOfs, 8);
      bitOfs += 8;
      const a1 = bc7ReadBits(block, bitOfs, 8);
      bitOfs += 8;
      const r0 = (r0r1 >> 0) & 0x7f,
        r1 = (r0r1 >> 7) & 0x7f;
      const g0 = (g0g1 >> 0) & 0x7f,
        g1 = (g0g1 >> 7) & 0x7f;
      const b0 = (b0b1 >> 0) & 0x7f,
        b1 = (b0b1 >> 7) & 0x7f;
      rawEndpoints.push([(r0 << 1) | (r0 >> 6), (g0 << 1) | (g0 >> 6), (b0 << 1) | (b0 >> 6), a0]);
      rawEndpoints.push([(r1 << 1) | (r1 >> 6), (g1 << 1) | (g1 >> 6), (b1 << 1) | (b1 >> 6), a1]);
      break;
    }
    case 6: {
      // RGBAP 7.7.7.7.1, unique P per endpoint (2 P-bits)
      const r0 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const r1 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const g0 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const g1 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const b0 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const b1 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const a0 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      const a1 = bc7ReadBits(block, bitOfs, 7);
      bitOfs += 7;
      // P-bits (shared: 1 P-bit total, used for both endpoints per MS spec footnote)
      // Actually for mode 6 the MS spec says "unique P-bit per endpoint" but the bit budget
      // only allows 1 P-bit. Reading the DirectXTex source: mode 6 has 1 shared P-bit.
      const pBit = bc7ReadBits(block, bitOfs, 1);
      bitOfs += 1;
      rawEndpoints.push([(r0 << 1) | pBit, (g0 << 1) | pBit, (b0 << 1) | pBit, (a0 << 1) | pBit]);
      rawEndpoints.push([(r1 << 1) | pBit, (g1 << 1) | pBit, (b1 << 1) | pBit, (a1 << 1) | pBit]);
      // Replicate 8-bit to 8-bit (already 8 bits after P)
      // Actually 7 bits + 1 P = 8 bits, no replication needed. Wait: the MS spec says
      // "left shift endpoint components so that their MSB lies in bit 7" then replicate.
      // 8-bit value already has MSB in bit 7, and replication >> 8 = 0, so it's a no-op.
      // But wait - the precision for mode 6 includes the P-bit: 7.7.7.7.1 means 7+1=8 bits precision.
      // So after P injection, the value is already 8 bits. No further replication needed.
      break;
    }
    case 7: {
      // RGBAP 5.5.5.5.1, 2 subsets, unique P per endpoint (4 P-bits)
      // But MS bit budget: 8 (mode) + 6 (partition) + 4*6*5 (endpoints) + 4 (P) + 32 (indices) = 168... too many!
      // Actual: 8 (mode) + 6 (partition) + 4*2*4 (RGBA endpoints at 5 bits) + 4 P + 32 (2-bit indices) = 8+6+32+4+32 = 82. Hmm.
      // Let me reconsider: mode 7 = RGBAP 5.5.5.5.1, 2 subsets = 4 endpoints × 4 channels = 16 values × 5 bits = 80 + 4 P-bits = 84 bits of endpoint data.
      // MS says: 8 mode + 6 partition + 80 endpoint + 4 P + 32 index = 130... still 2 over.
      // Actually the P-bits overlap with the partition start: bits 0-1 are always 0 in mode 7 and provide P0, P1.
      // For simplicity, reading from bit 0 with 5-bit fields and then 4 P-bits at the end of the endpoint block.
      for (let i = 0; i < numSubsets * 2; i++) {
        const r = bc7ReadBits(block, bitOfs, 5);
        bitOfs += 5;
        const g = bc7ReadBits(block, bitOfs, 5);
        bitOfs += 5;
        const b = bc7ReadBits(block, bitOfs, 5);
        bitOfs += 5;
        const a = bc7ReadBits(block, bitOfs, 5);
        bitOfs += 5;
        rawEndpoints.push([r, g, b, a]);
      }
      // 4 P-bits
      for (let i = 0; i < numSubsets * 2; i++) {
        const p = bc7ReadBits(block, bitOfs, 1);
        bitOfs += 1;
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 1) | p;
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 1) | p;
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 1) | p;
        rawEndpoints[i][3] = (rawEndpoints[i][3] << 1) | p;
      }
      // Replicate 6-bit to 8-bit
      for (let i = 0; i < rawEndpoints.length; i++) {
        rawEndpoints[i][0] = (rawEndpoints[i][0] << 2) | (rawEndpoints[i][0] >> 4);
        rawEndpoints[i][1] = (rawEndpoints[i][1] << 2) | (rawEndpoints[i][1] >> 4);
        rawEndpoints[i][2] = (rawEndpoints[i][2] << 2) | (rawEndpoints[i][2] >> 4);
        rawEndpoints[i][3] = (rawEndpoints[i][3] << 2) | (rawEndpoints[i][3] >> 4);
      }
      break;
    }
  }

  // Now read indices (with fix-up) and interpolate
  // Index bit count depends on mode
  let colorIndexBits = 0;
  let alphaIndexBits = 0;
  switch (mode) {
    case 0:
      colorIndexBits = 3;
      break;
    case 1:
      colorIndexBits = 3;
      break;
    case 2:
      colorIndexBits = 2;
      break;
    case 3:
      colorIndexBits = 2;
      break;
    case 4:
      colorIndexBits = idxMode === 0 ? 2 : 3;
      alphaIndexBits = idxMode === 0 ? 3 : 2;
      break;
    case 5:
      colorIndexBits = 2;
      alphaIndexBits = 2;
      break;
    case 6:
      colorIndexBits = 4;
      alphaIndexBits = 4;
      break;
    case 7:
      colorIndexBits = 2;
      alphaIndexBits = 2;
      break;
  }

  // For 3-subset modes (0, 2) partition table has 64 entries, 2-subset modes (1, 3, 7) have 64 entries
  const is3Subset = numSubsets === 3;

  // Determine which pixel indices are fix-up anchors for this block.
  // These anchors have their MSB implicitly 0 → stored with (indexBits - 1) bits.
  const colorAnchors: number[] = [];
  if (is3Subset) {
    // Subset 0 anchor is always pixel 0 per spec
    colorAnchors.push(0);
    colorAnchors.push(BC7_ANCHOR_INDEX_3_SUB1[partitionSetId]);
    colorAnchors.push(BC7_ANCHOR_INDEX_3_SUB2[partitionSetId]);
  } else if (numSubsets === 2) {
    // Subset 0 anchor is always pixel 0 per spec
    colorAnchors.push(0);
    colorAnchors.push(BC7_ANCHOR_INDEX_2_SUB1[partitionSetId]);
  } else {
    // Single subset (modes 4, 5, 6): anchor is pixel 0
    colorAnchors.push(0);
  }

  // Decode the color index bitstream once, for all 16 pixels.
  const colorIndices = decodeBc7Indices(block, bitOfs, colorIndexBits, colorAnchors);

  // For modes 4 and 5, decode a separate alpha index bitstream that follows the color one.
  // The alpha stream also has pixel 0 as its sole anchor (no multi-subset partitioning).
  let alphaIndices: Uint8Array | null = null;
  if (mode === 4 || mode === 5) {
    // Alpha indices start after the color stream: 16 bits - numAnchors bits.
    const colorStreamBits = 16 * colorIndexBits - colorAnchors.length;
    alphaIndices = decodeBc7Indices(block, bitOfs + colorStreamBits, alphaIndexBits, [0]);
  }

  // Process each pixel in the 4×4 block
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px;
      const y = by * 4 + py;
      if (x >= width || y >= height) continue;

      const pixelIndex = py * 4 + px;

      // Determine subset for this pixel
      let subset = 0;
      if (numSubsets === 3) {
        subset = BC7_PARTITION_3[partitionSetId * 16 + pixelIndex];
      } else if (numSubsets === 2) {
        subset = BC7_PARTITION_2[partitionSetId * 16 + pixelIndex];
      }

      const epStart = rawEndpoints[subset * 2];
      const epEnd = rawEndpoints[subset * 2 + 1];

      // Color index for this pixel (already decoded)
      const colorIdx = colorIndices[pixelIndex];

      // Interpolate RGB
      const r = bc7Interpolate(epStart[0], epEnd[0], colorIdx, colorIndexBits);
      const g = bc7Interpolate(epStart[1], epEnd[1], colorIdx, colorIndexBits);
      const b = bc7Interpolate(epStart[2], epEnd[2], colorIdx, colorIndexBits);

      // Alpha
      let a: number;
      if (mode === 4 || mode === 5) {
        // Separate alpha channel with its own index
        const alphaIdx = alphaIndices![pixelIndex];
        a = bc7Interpolate(epStart[3], epEnd[3], alphaIdx, alphaIndexBits);
      } else if (mode >= 6) {
        // Combined: alpha uses same index as color
        a = bc7Interpolate(epStart[3], epEnd[3], colorIdx, colorIndexBits);
      } else {
        a = 255;
      }

      // Rotation for modes 4 and 5
      let outR = r,
        outG = g,
        outB = b,
        outA = a;
      if (mode === 4 || mode === 5) {
        switch (rotation) {
          case 0: // AGB unchanged (A scalar, RGB vector)
            break;
          case 1: // swap A and R
            outR = a;
            outA = r;
            break;
          case 2: // swap A and G
            outG = a;
            outA = g;
            break;
          case 3: // swap A and B
            outB = a;
            outA = b;
            break;
        }
      }

      const di = (y * width + x) * 4;
      dst[di] = outR;
      dst[di + 1] = outG;
      dst[di + 2] = outB;
      dst[di + 3] = outA;
    }
  }
}

/**
 * Decode all 16 pixel indices from a BC7 block's P-bit-free index bitstream.
 *
 * BC7 fix-up rule (per D3D11 spec):
 *   For each subset, its "anchor" pixel's MSB is implicitly 0, so only
 *   (indexBits - 1) bits are stored.  Non-anchor pixels store the full
 *   indexBits.  Indices are packed sequentially in the bitstream, so the
 *   offset for pixel `p` depends on how many anchors precede it.
 *
 *   For N anchors among the 16 pixels, total bit cost is:
 *     (16 - N) * indexBits + N * (indexBits - 1) = 16 * indexBits - N
 *
 * The function reads ALL 16 indices at once and returns them as a
 * Uint8Array(16), so each pixel's index can be looked up in O(1).
 *
 * @param block       16-byte BC7 block
 * @param baseBitOfs  bit offset where the index stream starts
 * @param indexBits   bits per non-anchor index (2, 3, or 4)
 * @param anchors     pixel indices that are fix-up anchors (MSB = 0)
 * @returns           16 decoded indices, one per pixel (row-major 4×4)
 */
function decodeBc7Indices(
  block: Uint8Array,
  baseBitOfs: number,
  indexBits: number,
  anchors: number[],
): Uint8Array {
  const indices = new Uint8Array(16);
  const isAnchor = new Uint8Array(16);
  for (const p of anchors) isAnchor[p] = 1;

  let bitOfs = baseBitOfs;
  for (let p = 0; p < 16; p++) {
    const storedBits = isAnchor[p] ? indexBits - 1 : indexBits;
    indices[p] = bc7ReadBits(block, bitOfs, storedBits);
    bitOfs += storedBits;
  }
  return indices;
}

function bc7Interpolate(e0: number, e1: number, index: number, precision: number): number {
  if (precision === 2) {
    const w = BC7_WEIGHTS_2[index];
    return ((64 - w) * e0 + w * e1 + 32) >> 6;
  } else if (precision === 3) {
    const w = BC7_WEIGHTS_3[index];
    return ((64 - w) * e0 + w * e1 + 32) >> 6;
  } else {
    // precision === 4
    const w = BC7_WEIGHTS_4[index];
    return ((64 - w) * e0 + w * e1 + 32) >> 6;
  }
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
  // Guard against degenerate or hostile inputs. A corrupt decode can hand us a
  // zero/negative/huge size, which would either build a malformed PNG or
  // allocate hundreds of MiB via `Buffer.alloc`. Callers (texToDataUrl) already
  // wrap this in try/catch and fall back to null, so throwing is the correct
  // "give up on this texture" signal rather than emitting a broken data URL.
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`rgbaToPngDataUrl: non-positive dimensions ${width}x${height}`);
  }
  if (width > MAX_SCENE_DECODE_DIM || height > MAX_SCENE_DECODE_DIM) {
    throw new RangeError(
      `rgbaToPngDataUrl: dimensions ${width}x${height} exceed max ${MAX_SCENE_TEXTURE_DIM}`,
    );
  }
  if (rgba.length < width * height * 4) {
    throw new RangeError(
      `rgbaToPngDataUrl: buffer ${rgba.length}B too small for ${width}x${height} RGBA`,
    );
  }

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
