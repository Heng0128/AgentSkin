// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser — Types & Constants
 *
 * Shared type definitions and constants for the TEX texture format parser.
 *
 * TEX Format:
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
// Constants
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** One rendered GIF frame: a data URL plus its display duration in seconds. */
export interface TexFrameRendered {
  dataUrl: string;
  frametime: number;
}

/** FreeImage format constants used by TEXB0003/TEXB0004 containers. When
 *  imageFormat is one of these, the mipmap bytes contain a raw image file
 *  (PNG/JPEG) rather than DXT-compressed pixel data. */
export const FIF_JPEG = 2;
export const FIF_PNG = 13;
