// SPDX-License-Identifier: MPL-2.0

/**
 * # PKG Container Parser
 *
 * Parses Wallpaper Engine's proprietary `scene.pkg` binary container format.
 * The PKG format is a simple archive: a magic string, an entry count, a file
 * table (name/offset/length per entry), and a flat data section.
 *
 * Extracted from `scene-pkg-parser.ts` as part of the SRP refactor (P0-3).
 *
 * ## Format
 *
 * ### V0001 / V0002 (new)
 * - Header: magic "PKG\0" (4-byte NString), headerSize (int32 LE)
 * - If headerSize > 8: extended header of `(headerSize - 8)` bytes to skip
 * - File table: per entry — name (length-prefixed string), offset (int32 LE),
 *   length (int32 LE)
 * - Data section: raw file bytes at `dataStart + entry.offset`
 * - No compression at the PKG level
 *
 * ### Legacy (length-prefixed magic)
 * - Header: magic (length-prefixed string), entry count (int32 LE)
 * - Same file table and data section layout.
 *
 * The parser auto-detects the format: if the first 4 bytes decode to "PKG" as
 * an NString, the new header structure is used; otherwise the cursor rewinds
 * and the legacy layout is parsed.
 */

import { readFileSync } from 'node:fs';
import { BinaryReader } from './binary-reader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PkgEntry {
  fullPath: string;
  offset: number;
  length: number;
  bytes: Buffer;
}

export interface PkgPackage {
  magic: string;
  entries: PkgEntry[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Parse a scene.pkg file into its constituent entries. */
export function parsePkg(filePath: string): PkgPackage | null {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch {
    return null;
  }
  return parsePkgBuffer(buf);
}

/** Parse a PKG from a Buffer (testable). */
export function parsePkgBuffer(buf: Buffer): PkgPackage | null {
  const reader = new BinaryReader(buf);
  let magic: string;
  try {
    // Auto-detect format: try the new V0001/V0002 magic "PKG\0" first.
    // readNString(4) reads up to 4 bytes until NUL — for "PKG\0" it returns
    // "PKG" and advances the cursor by 4. If the result is not "PKG", this is
    // the legacy format and we rewind to parse the length-prefixed magic.
    const detected = reader.readNString(4);
    if (detected === 'PKG') {
      // V0001 / V0002: read headerSize and skip extended header if present.
      // V0001: headerSize = 0 (or 8), no extended header.
      // V0002: headerSize > 8, extended header of (headerSize - 8) bytes.
      magic = detected;
      const headerSize = reader.readInt32();
      if (headerSize > 8) {
        reader.seek(reader.position + headerSize - 8);
      }
    } else {
      // Legacy format: rewind and read the length-prefixed magic string.
      reader.seek(0);
      magic = reader.readStringI32();
      // An empty magic string means this is not a real scene.pkg container — a
      // length-prefix of 0 in the header is either a corrupt file or a different
      // format. Reject it so callers treat it as "unparseable, skip" (null).
      if (!magic) return null;
    }
    const entryCount = reader.readInt32();
    if (entryCount < 0 || entryCount > 10000) return null;

    const rawEntries: Array<{ name: string; offset: number; length: number }> = [];
    for (let i = 0; i < entryCount; i++) {
      const name = reader.readStringI32();
      const offset = reader.readInt32();
      const length = reader.readInt32();
      rawEntries.push({ name, offset, length });
    }

    const dataStart = reader.position;
    const dataEnd = buf.length;
    const entries: PkgEntry[] = [];
    for (const e of rawEntries) {
      // P2-12: Boundary-validate offset and length. A malformed/malicious PKG
      // can claim offset+length far past the buffer end, causing buf.subarray
      // to silently return an empty view (or throw when used downstream on a
      // path that assumes non-empty content). Negative values are also caught
      // by the >= 0 guards. Valid entries that fit within the data region are
      // kept; silently drop the rest so a single bad entry doesn't kill the
      // whole package.
      if (e.offset < 0 || e.length < 0) continue;
      const absStart = dataStart + e.offset;
      const absEnd = absStart + e.length;
      if (!Number.isFinite(absStart) || !Number.isFinite(absEnd)) continue;
      if (absStart < dataStart || absStart > dataEnd) continue;
      if (absEnd < absStart || absEnd > dataEnd) continue;
      entries.push({
        fullPath: e.name,
        offset: e.offset,
        length: e.length,
        bytes: buf.subarray(absStart, absEnd),
      });
    }

    return { magic, entries };
  } catch (error) {
    // BinaryReader now throws RangeError on truncated reads (P4#1) instead of
    // silently returning short Buffers. A corrupt PKG that claims more entries
    // / longer strings than the buffer holds surfaces here as a clean null,
    // matching the existing contract: callers (extractScene etc.) treat null
    // as "unparseable, skip this wallpaper" without a try/catch of their own.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** Find an entry by path (case-insensitive). */
export function findEntry(pkg: PkgPackage, name: string): PkgEntry | null {
  const lower = name.toLowerCase();
  for (const e of pkg.entries) {
    if (e.fullPath.toLowerCase() === lower) return e;
  }
  return null;
}

/** Find all entries matching a substring (case-insensitive). */
export function findEntries(pkg: PkgPackage, pattern: string): PkgEntry[] {
  const lower = pattern.toLowerCase();
  return pkg.entries.filter((e) => e.fullPath.toLowerCase().includes(lower));
}
