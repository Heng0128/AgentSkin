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
 * - Header: magic (length-prefixed string), entry count (int32 LE)
 * - File table: per entry — name (length-prefixed string), offset (int32 LE),
 *   length (int32 LE)
 * - Data section: raw file bytes at `dataStart + entry.offset`
 * - No compression at the PKG level
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
    magic = reader.readStringI32();
  } catch {
    return null;
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
