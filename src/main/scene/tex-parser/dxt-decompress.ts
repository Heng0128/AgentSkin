// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser — DXT Decompression
 *
 * Decompresses DXT1/DXT3/DXT5 compressed texture data to RGBA8888.
 * DXT (S3 Texture Compression) uses 4×4 pixel blocks with various
 * compression schemes for color and alpha channels.
 *
 * NOTE: BC7 decompression is handled separately in `./bc7-decompress.ts`.
 * The unified `decompressDxt` format dispatcher is exported here.
 */

import { decompressBc7 } from './bc7-decompress';
import { MAX_SCENE_DECODE_BYTES, MAX_SCENE_DECODE_DIM, TEX_FORMAT } from './tex-types';

// ---------------------------------------------------------------------------
// DXT Decompression
// ---------------------------------------------------------------------------

/** Decompress DXT1 to RGBA8888. */
export function decompressDxt1(width: number, height: number, src: Buffer): Buffer {
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

/** Decompress DXT3 to RGBA8888 (explicit 4-bit alpha). */
export function decompressDxt3(width: number, height: number, src: Buffer): Buffer {
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

/** Decompress DXT5 to RGBA8888 (interpolated alpha). */
export function decompressDxt5(width: number, height: number, src: Buffer): Buffer {
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
// Format Dispatch
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

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function rgb565ToRgb888(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) << 3;
  const g = ((c >> 5) & 0x3f) << 2;
  const b = (c & 0x1f) << 3;
  return [r | (r >> 5), g | (g >> 6), b | (b >> 5)];
}
