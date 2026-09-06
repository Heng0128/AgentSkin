// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser — Core Parser
 *
 * Parses Wallpaper Engine's proprietary `.tex` texture format.
 * Handles LZ4-compressed mipmaps and container format variations.
 */

import { lz4DecodeBlock } from '../../lz4-decoder';
import { BinaryReader } from '../binary-reader';
import { MAX_SCENE_DECODE_BYTES, TEX_FLAGS, type TexData, type TexMipmap } from './tex-types';

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

    const images: TexData['images'] = [];
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
    const frames: TexData['frames'] = [];
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
