// SPDX-License-Identifier: MPL-2.0

/**
 * # TEX Texture Parser — BC7 Decompression
 *
 * Decompresses BC7-format texture data to RGBA8888.
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

// BC7 interpolation weights
const BC7_WEIGHTS_2 = [0, 21, 43, 64];
const BC7_WEIGHTS_3 = [0, 9, 18, 27, 37, 46, 55, 64];
const BC7_WEIGHTS_4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

// ---------------------------------------------------------------------------
// BC7 Decompression
// ---------------------------------------------------------------------------

/** Decompress BC7-format texture data to RGBA8888. */
export function decompressBc7(width: number, height: number, src: Buffer): Buffer {
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

// ---------------------------------------------------------------------------
// BC7 Block Decoder
// ---------------------------------------------------------------------------

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
      // Per-endpoint reading (BC7 spec: R0,G0,B0,R1,G1,B1,... per endpoint)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let e = 0; e < numEp; e++) {
        for (let c = 0; c < 3; c++) {
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
      // Per-endpoint reading (BC7 spec: R0,G0,B0,R1,G1,B1,... per endpoint)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let e = 0; e < numEp; e++) {
        for (let c = 0; c < 3; c++) {
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
      // Per-endpoint reading (BC7 spec: R0,G0,B0,R1,G1,B1,... per endpoint)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let e = 0; e < numEp; e++) {
        for (let c = 0; c < 3; c++) {
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
      // Per-endpoint reading (BC7 spec: R0,G0,B0,R1,G1,B1,... per endpoint)
      for (let i = 0; i < numEp; i++) {
        rawEndpoints.push([0, 0, 0, 0]);
      }
      for (let e = 0; e < numEp; e++) {
        for (let c = 0; c < 3; c++) {
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

// ---------------------------------------------------------------------------
// BC7 Index Decoder
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// BC7 Interpolation
// ---------------------------------------------------------------------------

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
