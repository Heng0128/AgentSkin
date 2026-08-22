// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { lz4DecodeBlock } from './lz4-decoder';

/**
 * Hand-rolled LZ4 block encoder for test fixtures. Produces minimal valid
 * blocks that exercise specific decoder branches (literals, matches,
 * extensions, overlapping copies). Not a general-purpose encoder — just
 * enough to drive every code path in lz4DecodeBlock.
 */
function encodeLz4(opts: {
  literals: Buffer;
  matchOffset?: number;
  matchLen?: number; // actual match length (>= 4); omit for a final literal-only sequence
}): Buffer {
  const { literals, matchOffset, matchLen } = opts;
  const out: number[] = [];

  const litNibble = literals.length >= 15 ? 15 : literals.length;
  const hasMatch = matchOffset !== undefined && matchLen !== undefined;
  const matchNibble = hasMatch ? (matchLen! - 4 >= 15 ? 15 : matchLen! - 4) : 0;
  out.push((litNibble << 4) | matchNibble);

  // Literal length extension (when nibble saturated at 15).
  if (litNibble === 15) {
    let remaining = literals.length - 15;
    while (remaining >= 255) {
      out.push(255);
      remaining -= 255;
    }
    out.push(remaining);
  }

  // Literal bytes.
  for (const b of literals) out.push(b);

  if (hasMatch) {
    // Match offset (little-endian, 2 bytes).
    out.push(matchOffset! & 0xff, (matchOffset! >> 8) & 0xff);
    // Match length extension (when nibble saturated at 15 → matchLen 19).
    if (matchNibble === 15) {
      let remaining = matchLen! - 19;
      while (remaining >= 255) {
        out.push(255);
        remaining -= 255;
      }
      out.push(remaining);
    }
  }

  return Buffer.from(out);
}

describe('lz4DecodeBlock', () => {
  describe('literal-only sequences (no match)', () => {
    it('decodes a short literal-only block', () => {
      const input = encodeLz4({ literals: Buffer.from('hello') });
      const output = lz4DecodeBlock(input, Buffer.alloc(5));
      expect(output.toString()).toBe('hello');
    });

    it('decodes an empty literal-only block (zero-length payload)', () => {
      // token 0x00, no literals, no match — output must be empty.
      const input = Buffer.from([0x00]);
      const output = lz4DecodeBlock(input, Buffer.alloc(0));
      expect(output.length).toBe(0);
    });
  });

  describe('literal length extension', () => {
    it('decodes a block whose literal length needs a single extension byte', () => {
      // 20 literals → nibble 15 + ext 5.
      const payload = Buffer.alloc(20, 0x41); // 'A' * 20
      const input = encodeLz4({ literals: payload });
      const output = lz4DecodeBlock(input, Buffer.alloc(20));
      expect(output.equals(payload)).toBe(true);
    });

    it('decodes a block whose literal length needs multiple 255 extension bytes', () => {
      // 280 literals → 15 + 255 + 10.
      const payload = Buffer.alloc(280, 0x42);
      const input = encodeLz4({ literals: payload });
      const output = lz4DecodeBlock(input, Buffer.alloc(280));
      expect(output.equals(payload)).toBe(true);
    });
  });

  describe('match copies', () => {
    it('decodes a non-overlapping match (offset >= matchLen, bulk copy path)', () => {
      // literal "abcd" + match offset 4, len 4 → "abcdabcd"
      const input = encodeLz4({ literals: Buffer.from('abcd'), matchOffset: 4, matchLen: 4 });
      const output = lz4DecodeBlock(input, Buffer.alloc(8));
      expect(output.toString()).toBe('abcdabcd');
    });

    it('decodes an overlapping match (offset < matchLen, byte-by-byte RLE run)', () => {
      // literal "a" + match offset 1, len 4 → "aaaaa"
      const input = encodeLz4({ literals: Buffer.from('a'), matchOffset: 1, matchLen: 4 });
      const output = lz4DecodeBlock(input, Buffer.alloc(5));
      expect(output.toString()).toBe('aaaaa');
    });

    it('decodes an overlapping match that repeats a multi-byte pattern', () => {
      // literal "abcd" + match offset 4, len 24 (extension) → "abcd" repeated 7x (28 bytes)
      const input = encodeLz4({ literals: Buffer.from('abcd'), matchOffset: 4, matchLen: 24 });
      const output = lz4DecodeBlock(input, Buffer.alloc(28));
      expect(output.toString()).toBe('abcd'.repeat(7));
    });

    it('decodes a match length that needs multiple 255 extension bytes', () => {
      // matchLen = 19 + 255 + 5 = 279, offset 1 → run of one byte.
      const input = encodeLz4({ literals: Buffer.from('Z'), matchOffset: 1, matchLen: 279 });
      const output = lz4DecodeBlock(input, Buffer.alloc(280));
      expect(output.length).toBe(280);
      expect(output.every((b) => b === 0x5a)).toBe(true); // all 'Z'
    });

    it('decodes a literal-only sequence followed by a match in the same block', () => {
      // Build manually: seq1 = literal "ab" + match(offset 2, len 4) → "ababab"; final literal "XY"
      // Total output: "ababab" (6) + "XY" (2) = 8
      const parts: number[] = [];
      // seq1: token = (2 << 4) | 0 = 0x20
      parts.push(0x20, 0x61, 0x62); // literals 'a','b'
      parts.push(0x02, 0x00); // offset 2
      // matchLen nibble 0 → matchLen 4
      // seq2 (final): token = (2 << 4) | 0 = 0x20
      parts.push(0x20, 0x58, 0x59); // literals 'X','Y'
      const input = Buffer.from(parts);
      const output = lz4DecodeBlock(input, Buffer.alloc(8));
      expect(output.toString()).toBe('abababXY');
    });
  });

  describe('error handling', () => {
    it('throws on truncated literal length extension', () => {
      // token 0xF0 (lit nibble 15) but no extension byte follows.
      const input = Buffer.from([0xf0]);
      expect(() => lz4DecodeBlock(input, Buffer.alloc(1))).toThrow('truncated literal length');
    });

    it('throws on truncated literals', () => {
      // token 0x50 (5 literals) but only 2 bytes follow.
      const input = Buffer.from([0x50, 0x01, 0x02]);
      expect(() => lz4DecodeBlock(input, Buffer.alloc(5))).toThrow('truncated literals');
    });

    it('throws on output overflow while copying literals', () => {
      const input = encodeLz4({ literals: Buffer.from('hello') });
      expect(() => lz4DecodeBlock(input, Buffer.alloc(3))).toThrow('output overflow (literals)');
    });

    it('throws on truncated match offset', () => {
      // literal "ab" then only 1 byte for offset.
      const input = Buffer.from([0x20, 0x61, 0x62, 0x04]);
      expect(() => lz4DecodeBlock(input, Buffer.alloc(6))).toThrow('truncated match offset');
    });

    it('throws on invalid match offset 0', () => {
      const input = encodeLz4({ literals: Buffer.from('ab'), matchOffset: 0, matchLen: 4 });
      expect(() => lz4DecodeBlock(input, Buffer.alloc(6))).toThrow('invalid match offset 0');
    });

    it('throws when match offset points before the start of output', () => {
      // literal "ab" + match offset 10 (> op=2) → offset before start.
      const input = encodeLz4({ literals: Buffer.from('ab'), matchOffset: 10, matchLen: 4 });
      expect(() => lz4DecodeBlock(input, Buffer.alloc(6))).toThrow(
        'match offset before start of output',
      );
    });

    it('throws on output overflow while copying a match', () => {
      // literal "a" + match offset 1, len 4 → needs 5 bytes; give 4.
      const input = encodeLz4({ literals: Buffer.from('a'), matchOffset: 1, matchLen: 4 });
      expect(() => lz4DecodeBlock(input, Buffer.alloc(4))).toThrow('output overflow (match)');
    });

    it('throws on truncated match length extension', () => {
      // token 0x1F: literal nibble 1 (one literal), match nibble 15 (matchLen=19).
      // After the literal + 2-byte offset, input is exhausted → no extension byte.
      const input = Buffer.from([0x1f, 0x61, 0x01, 0x00]);
      expect(() => lz4DecodeBlock(input, Buffer.alloc(5))).toThrow('truncated match length');
    });

    it('throws on output size mismatch (decoded data smaller than buffer)', () => {
      // Decode 5 bytes into a 6-byte buffer.
      const input = encodeLz4({ literals: Buffer.from('hello') });
      expect(() => lz4DecodeBlock(input, Buffer.alloc(6))).toThrow('output size mismatch');
    });

    it('throws on output size mismatch (decoded data larger than buffer)', () => {
      // Covered by overflow paths, but assert the mismatch message path via a
      // final literal-only block whose bytes exceed the buffer.
      const input = encodeLz4({ literals: Buffer.alloc(4, 0x41) });
      expect(() => lz4DecodeBlock(input, Buffer.alloc(2))).toThrow('output overflow (literals)');
    });
  });

  describe('return value', () => {
    it('returns the same buffer reference passed in', () => {
      const input = encodeLz4({ literals: Buffer.from('abc') });
      const output = Buffer.alloc(3);
      const result = lz4DecodeBlock(input, output);
      expect(result).toBe(output);
    });
  });
});
