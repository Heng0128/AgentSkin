// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser — PNG Encoder
 *
 * Encodes raw RGBA pixel data to PNG format (base64 data URL).
 * Pure TypeScript implementation, no canvas dependency.
 */

import { deflateSync } from 'node:zlib';

/** Maximum raw decode dimension. */
const MAX_SCENE_DECODE_DIM = 16384;

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

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUint32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUint32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
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
      `rgbaToPngDataUrl: dimensions ${width}x${height} exceed max ${MAX_SCENE_DECODE_DIM}`,
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
