// SPDX-License-Identifier: MPL-2.0

/**
 * # Pure JavaScript LZ4 Block Decoder
 *
 * Decompresses LZ4 block-format data without any native dependencies.
 *
 * ## Why this exists
 *
 * The `lz4` npm package ships native Node.js bindings (`.node` files compiled
 * with node-gyp). In an Electron app with `npmRebuild: false` (intentionally
 * set to keep builds fast — the rest of the app is pure JS), those bindings
 * are compiled for the Node.js ABI, not Electron's ABI. Loading them at
 * runtime throws `Error: Module did not self-register`.
 *
 * This pure-JS implementation avoids the native dependency entirely. It
 * implements the LZ4 **block** format (not the LZ4 frame format) — which is
 * the format used by Wallpaper Engine's TEX texture mipmaps.
 *
 * ## LZ4 Block Format
 *
 * The block consists of a sequence of "sequences". Each sequence is:
 *
 * 1. **Token** (1 byte):
 *    - High 4 bits: literal length (0–14, or 15 meaning "read more")
 *    - Low 4 bits: match length (0–14, or 15 meaning "read more"), minus 4
 *
 * 2. **Literal length extension** (if high nibble == 15):
 *    - Read bytes; add each to the length. If a byte is 255, continue reading.
 *
 * 3. **Literals**: `literalLength` raw bytes copied to the output.
 *
 * 4. **Match offset** (2 bytes, little-endian): distance back in the output
 *    buffer to copy from. Offset 0 is invalid.
 *
 * 5. **Match length extension** (if low nibble == 15):
 *    - Same encoding as literal length extension. The match length is
 *      `tokenMatchLength + 4 + extension`.
 *
 * The last sequence contains only literals (no match offset/length).
 *
 * Reference: https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md
 */

/**
 * Decode an LZ4 block into a pre-allocated output buffer.
 *
 * @param input - The compressed LZ4 block data.
 * @param output - Pre-allocated buffer sized to the uncompressed length.
 * @returns The output buffer (same reference passed in).
 * @throws if the input is malformed or the output buffer overflows.
 */
export function lz4DecodeBlock(input: Buffer, output: Buffer): Buffer {
  const inLen = input.length;
  const outLen = output.length;
  let ip = 0; // input cursor
  let op = 0; // output cursor

  while (ip < inLen) {
    // --- Token byte ---
    const token = input[ip++];
    let literalLen = token >>> 4; // high nibble
    let matchLen = (token & 0x0f) + 4; // low nibble + 4 (minimum match)

    // --- Literal length extension ---
    if (literalLen === 15) {
      let b: number;
      do {
        if (ip >= inLen) throw new Error('lz4: truncated literal length');
        b = input[ip++];
        literalLen += b;
      } while (b === 255);
    }

    // --- Copy literals ---
    if (literalLen > 0) {
      if (ip + literalLen > inLen) throw new Error('lz4: truncated literals');
      if (op + literalLen > outLen) throw new Error('lz4: output overflow (literals)');
      input.copy(output, op, ip, ip + literalLen);
      ip += literalLen;
      op += literalLen;
    }

    // Last sequence has no match (input exhausted after literals).
    if (ip >= inLen) break;

    // --- Match offset (2 bytes, little-endian) ---
    if (ip + 2 > inLen) throw new Error('lz4: truncated match offset');
    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;
    if (offset === 0) throw new Error('lz4: invalid match offset 0');

    // --- Match length extension ---
    if (matchLen === 19) {
      // token low nibble was 15 (15 + 4 = 19)
      let b: number;
      do {
        if (ip >= inLen) throw new Error('lz4: truncated match length');
        b = input[ip++];
        matchLen += b;
      } while (b === 255);
    }

    // --- Copy match from earlier in the output buffer ---
    if (offset > op) throw new Error('lz4: match offset before start of output');
    if (op + matchLen > outLen) throw new Error('lz4: output overflow (match)');

    // We cannot use Buffer.copy for overlapping copies (offset < matchLen),
    // because copy does not handle byte-by-byte overlap correctly. For
    // offset >= matchLen, a bulk copy is safe; for offset < matchLen, we
    // must copy byte-by-byte so repeated patterns (e.g. RLE-style runs)
    // expand correctly.
    if (offset >= matchLen) {
      // No overlap — bulk copy is safe.
      output.copy(output, op, op - offset, op - offset + matchLen);
    } else {
      // Overlapping copy — byte-by-byte to correctly handle runs.
      for (let i = 0; i < matchLen; i++) {
        output[op + i] = output[op - offset + i];
      }
    }
    op += matchLen;
  }

  // Verify we filled the output buffer exactly.
  if (op !== outLen) {
    throw new Error(`lz4: output size mismatch (expected ${outLen}, got ${op})`);
  }

  return output;
}
