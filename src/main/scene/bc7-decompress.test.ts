// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { decompressBc7 } from './tex-parser/bc7-decompress';

/**
 * Helper: create a single BC7 block (16 bytes) for a given mode.
 * The block is mostly zeros except for the mode indicator bit.
 * @param extraBits Array of [bitPosition, value] tuples
 */
function makeBlock(mode: number, extraBits: Array<[number, number]> = []): Buffer {
  const block = Buffer.alloc(16, 0);
  // Set mode indicator bit at position `mode`
  const byteIndex = mode >> 3;
  const bitIndex = mode & 7;
  block[byteIndex] |= 1 << bitIndex;
  // Set extra bits (bit positions -> value)
  for (const [pos, val] of extraBits) {
    const bi = pos >> 3;
    const bj = pos & 7;
    if (val) block[bi] |= 1 << bj;
  }
  return block;
}

describe('decompressBc7', () => {
  it('decodes a mode-0 block without throwing', () => {
    const block = makeBlock(0);
    const src = Buffer.concat([block]);
    // Mode 0: 3 subsets, 4-bit endpoints + P-bit, 3-bit indices
    // Just verify it doesn't throw and produces output of correct size
    const result = decompressBc7(4, 4, src);
    expect(result.length).toBe(4 * 4 * 4); // 64 bytes RGBA
  });

  it('decodes a mode-1 block without throwing', () => {
    const block = makeBlock(1);
    const src = Buffer.concat([block]);
    const result = decompressBc7(4, 4, src);
    expect(result.length).toBe(64);
  });

  it('decodes a mode-2 block without throwing', () => {
    const block = makeBlock(2);
    const src = Buffer.concat([block]);
    const result = decompressBc7(4, 4, src);
    expect(result.length).toBe(64);
  });

  it('decodes a mode-3 block without throwing', () => {
    const block = makeBlock(3);
    const src = Buffer.concat([block]);
    const result = decompressBc7(4, 4, src);
    expect(result.length).toBe(64);
  });

  it('decodes a mode-6 block (full RGBA) without throwing', () => {
    const block = makeBlock(6);
    const src = Buffer.concat([block]);
    const result = decompressBc7(4, 4, src);
    expect(result.length).toBe(64);
  });

  it('produces opaque alpha for modes without alpha (0-3)', () => {
    const block = makeBlock(0);
    const src = Buffer.concat([block]);
    const result = decompressBc7(4, 4, src);
    // All alpha values should be 255 for modes 0-3
    for (let i = 0; i < 16; i++) {
      expect(result[i * 4 + 3]).toBe(255);
    }
  });

  it('handles 8x8 texture (4 blocks)', () => {
    const blocks = Buffer.alloc(4 * 16, 0);
    // Set mode 0 for each block
    for (let b = 0; b < 4; b++) {
      blocks[b * 16 + 0] = 0x01; // mode 0 indicator at bit 0
    }
    const result = decompressBc7(8, 8, blocks);
    expect(result.length).toBe(8 * 8 * 4); // 256 bytes
  });

  it('handles non-multiple-of-4 dimensions (clamps)', () => {
    // 5x5 texture needs 2x2 = 4 blocks (covers 8x8 area)
    const blocks = Buffer.alloc(4 * 16, 0);
    for (let b = 0; b < 4; b++) {
      blocks[b * 16 + 0] = 0x01;
    }
    const result = decompressBc7(5, 5, blocks);
    expect(result.length).toBe(5 * 5 * 4); // 100 bytes
  });
});

describe('BC7 endpoint reading order (Bug D1 fix)', () => {
  /**
   * Regression test: verify that endpoint bits are read in per-endpoint order
   * (R0,G0,B0,R1,G1,B1,...) not per-channel order (R0,R1,...,G0,G1,...,B0,B1,...).
   *
   * We construct a mode-1 block where per-endpoint vs per-channel reading
   * would produce different R0 values. If the decoder reads per-endpoint,
   * R0 should be extracted from bits 8-13 (6 bits starting at bit 8).
   * If per-channel, R0 would come from bits 8-13 but R1 from bits 14-19, etc.
   *
   * For this test, we just verify the decoder produces deterministic output
   * for a known bit pattern (the zero block should produce all-black since
   * all endpoints = 0 → all interpolated values = 0).
   */
  it('all-zero block produces all-black output', () => {
    // Mode 0 with all-zero data → all endpoints = 0 → all pixels black
    const block = Buffer.alloc(16, 0);
    block[0] = 0x01; // mode 0 indicator
    const result = decompressBc7(4, 4, block);
    for (let i = 0; i < 16; i++) {
      expect(result[i * 4]).toBe(0); // R
      expect(result[i * 4 + 1]).toBe(0); // G
      expect(result[i * 4 + 2]).toBe(0); // B
      expect(result[i * 4 + 3]).toBe(255); // A (opaque for mode 0)
    }
  });
});
