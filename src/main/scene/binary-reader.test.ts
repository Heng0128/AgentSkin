// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { BinaryReader } from './binary-reader';

describe('BinaryReader — 标量读取边界', () => {
  it('readInt32 throws a labelled RangeError when truncated', () => {
    const r = new BinaryReader(Buffer.from([1, 2, 3]));
    expect(() => r.readInt32()).toThrow(/read past end of buffer/);
  });

  it('readUint32 / readFloat32 throw labelled RangeError when truncated', () => {
    const r1 = new BinaryReader(Buffer.from([0, 0, 0]));
    expect(() => r1.readUint32()).toThrow(/read past end of buffer/);
    const r2 = new BinaryReader(Buffer.from([0, 0, 0]));
    expect(() => r2.readFloat32()).toThrow(/read past end of buffer/);
  });

  it('readBytes rejects negative length with a clear message', () => {
    const r = new BinaryReader(Buffer.alloc(4));
    expect(() => r.readBytes(-1)).toThrow(/negative length/);
  });

  it('readBytes throws when the slice runs past the buffer', () => {
    const r = new BinaryReader(Buffer.alloc(4));
    expect(() => r.readBytes(8)).toThrow(/only 4 remain/);
  });
});

describe('BinaryReader — 字符串读取', () => {
  it('readStringI32 throws (not allocates) on an oversized length claim', () => {
    // i32 length = 1 GiB, but only 4 bytes of buffer remain.
    const r = new BinaryReader(Buffer.concat([Buffer.from([0, 0, 0, 64]), Buffer.alloc(4)]));
    expect(() => r.readStringI32()).toThrow(/exceeds remaining/);
  });

  it('readStringI32 throws on a negative length prefix', () => {
    const r = new BinaryReader(Buffer.from([255, 255, 255, 255])); // -1 as int32
    expect(() => r.readStringI32()).toThrow(/negative length/);
  });

  it('readNString stops at the buffer boundary without walking off the end', () => {
    // No NUL and fewer than maxLen bytes available → returns what's present.
    const r = new BinaryReader(Buffer.from([65, 66, 67])); // "ABC", no terminator
    expect(r.readNString(16)).toBe('ABC');
    // Cursor must not be past the end.
    expect(r.position).toBe(3);
  });

  it('readNullTerminatedString returns empty string for an empty buffer', () => {
    const r = new BinaryReader(Buffer.alloc(0));
    expect(r.readNullTerminatedString()).toBe('');
  });

  it('readNullTerminatedString reads available bytes (no NUL) without throwing', () => {
    // No terminator and no padding → returns the raw bytes rather than walking
    // off the end of the buffer.
    const r = new BinaryReader(Buffer.from([1, 2, 3]));
    expect(r.readNullTerminatedString()).toBe('\u0001\u0002\u0003');
  });
});
