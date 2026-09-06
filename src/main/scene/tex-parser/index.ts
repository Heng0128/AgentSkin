// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser
 *
 * Parses Wallpaper Engine's proprietary `.tex` texture format, including
 * LZ4-compressed mipmaps, DXT1/DXT3/DXT5/BC7 decompression, and conversion to
 * browser-displayable PNG data URLs.
 *
 * ## TEX Format
 * - Magic1: "TEXV0005" or "TEXV0006", Magic2: "TEXI0001" (16-byte null-padded strings)
 * - Header: format, flags, textureWidth, textureHeight, imageWidth, imageHeight
 * - Image container: TEXB0001–TEXB0004 with mipmaps
 * - Mipmaps may be LZ4-compressed; pixel data may be DXT1/DXT3/DXT5/BC7 compressed
 * - Optional frame info container for animated GIF textures
 *
 * ## Module Structure
 * - {@link ./tex-types}           — type definitions & constants
 * - {@link ./tex-parser}          — core TEX parsing (parseTex, readMipmap)
 * - {@link ./dxt-decompress}      — DXT1/DXT3/DXT5 decompression
 * - {@link ./bc7-decompress}      — BC7 decompression (all 8 modes)
 * - {@link ./png-encoder}         — PNG encoding (rgbaToPngDataUrl)
 * - {@link ./tex-render}          — TEX → PNG data URL conversion
 *
 * References:
 * - https://github.com/notscuffed/repkg (C# reference implementation)
 * - https://learn.microsoft.com/en-us/windows/win32/direct3d11/bc7-format
 */

export * from './bc7-decompress';
export * from './dxt-decompress';
export * from './png-encoder';
export * from './tex-parser';
export * from './tex-render';
// Re-export everything from sub-modules
export * from './tex-types';
