// SPDX-License-Identifier: MPL-2.0

/**
 * # Binary Reader
 *
 * Low-level utility for reading little-endian binary data from a Buffer.
 * Used by the PKG container parser and TEX texture parser to walk through
 * Wallpaper Engine's proprietary binary formats.
 *
 * Extracted from `scene-pkg-parser.ts` as part of the SRP refactor (P0-3).
 */

/**
 * Sequential cursor over a Buffer. All multi-byte reads are little-endian,
 * matching Wallpaper Engine's binary formats (PKG, TEX).
 */
export class BinaryReader {
  private buf: Buffer;
  private pos = 0;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  get position(): number {
    return this.pos;
  }

  seek(p: number): void {
    this.pos = p;
  }

  /** Throw a labelled RangeError if `n` bytes aren't available at the cursor.
   *  Node's `Buffer.readXxxLE` throws an opaque `RangeError('Index out of
   *  range')` on underflow; we convert that into a labelled error so callers
   *  (and `parsePkgBuffer`'s catch) can distinguish a truncated/corrupt binary
   *  file from a code bug, and so a truncated TEX/PKG header degrades to a
   *  clean null instead of a confusing stack trace. */
  private require(n: number, what: string): void {
    if (n < 0) throw new RangeError(`BinaryReader: negative read size ${n} (${what})`);
    if (this.pos + n > this.buf.length) {
      throw new RangeError(
        `BinaryReader: read past end of buffer (${what}) at ${this.pos}, ${n} needed, ${this.buf.length} present`,
      );
    }
  }

  readInt32(): number {
    this.require(4, 'int32');
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readUint32(): number {
    this.require(4, 'uint32');
    const v = this.buf.readUint32LE(this.pos);
    this.pos += 4;
    return v;
  }

  readFloat32(): number {
    this.require(4, 'float32');
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  readBytes(n: number): Buffer {
    if (n < 0) {
      throw new RangeError(`BinaryReader.readBytes: negative length ${n}`);
    }
    const end = this.pos + n;
    if (end > this.buf.length) {
      // Throw instead of silently returning a truncated Buffer. A truncated
      // view would be passed downstream to TEX / DXT / LZ4 parsers that
      // assume the requested byte count is available — they would then read
      // garbage / zero-filled memory and silently produce corrupt textures.
      // Caller is expected to validate file structure (e.g. parsePkg's
      // entryCount bound check) before requesting reads of that size.
      throw new RangeError(
        `BinaryReader.readBytes: requested ${n} bytes at offset ${this.pos} but only ${this.buf.length - this.pos} remain`,
      );
    }
    const slice = this.buf.subarray(this.pos, end);
    this.pos = end;
    return slice;
  }

  /** Read a length-prefixed (int32) UTF-8 string.
   *
   *  On a truncated or corrupt length prefix (negative size, or a size larger
   *  than the remaining buffer) a labelled RangeError is thrown — never an
   *  unbounded allocation or a silent read of garbage. Callers that want a
   *  null result on failure (e.g. `parsePkgBuffer`) wrap this in try/catch. */
  readStringI32(): string {
    const size = this.readInt32();
    if (size < 0) {
      throw new RangeError(`BinaryReader.readStringI32: negative length ${size}`);
    }
    // A length prefix claiming more bytes than remain is a corrupt container
    // (or an attacker-controlled value) — reject before readBytes would trip.
    if (size > this.remaining) {
      throw new RangeError(
        `BinaryReader.readStringI32: length ${size} exceeds remaining ${this.remaining}`,
      );
    }
    return this.readBytes(size).toString('utf8');
  }

  /** Read a null-terminated string (consumes the null terminator). Used for
   *  Wallpaper Engine's variable-length magic strings like "TEXV0005\0"
   *  which are NOT fixed-size fields — they're C-style strings where the
   *  next field starts immediately after the null byte. */
  readNullTerminatedString(): string {
    const start = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0) {
      this.pos++;
    }
    const str = this.buf.subarray(start, this.pos).toString('utf8');
    if (this.pos < this.buf.length) this.pos++; // skip null terminator
    return str;
  }

  /** Read a null-terminated string from a fixed-size field (NString).
   *
   *  Bounded by `maxLen` AND by the buffer end: if the field runs past the
   *  buffer without a NUL, the loop stops at the buffer boundary rather than
   *  walking into undefined indices (which would otherwise read 0-byte values
   *  and advance `pos` past the end). */
  readNString(maxLen: number): string {
    const bytes: number[] = [];
    const limit = Math.min(this.pos + maxLen, this.buf.length);
    for (; this.pos < limit; this.pos++) {
      const b = this.buf[this.pos];
      if (b === 0) {
        this.pos++; // consume the NUL
        break;
      }
      bytes.push(b);
    }
    return Buffer.from(bytes).toString('utf8');
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }
}
