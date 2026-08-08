// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { findEntries, findEntry, type PkgPackage, parsePkgBuffer } from './pkg-parser';

// ---------------------------------------------------------------------------
// Helpers — build a scene.pkg container.
// Format: magic (len-prefixed) + entryCount (i32) + file table
// (name len-prefixed, offset i32, length i32 per entry) + flat data section.
// ---------------------------------------------------------------------------

function i32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return b;
}

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([i32(b.length), b]);
}

interface PkgEntrySpec {
  name: string;
  data: Buffer;
}

function buildPkg(entries: PkgEntrySpec[]): Buffer {
  const parts: Buffer[] = [str('scene.pkg'), i32(entries.length)];
  let offset = 0;
  for (const e of entries) {
    parts.push(str(e.name), i32(offset), i32(e.data.length));
    offset += e.data.length;
  }
  for (const e of entries) parts.push(e.data);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parsePkgBuffer', () => {
  it('parses a valid pkg with multiple entries', () => {
    const buf = buildPkg([
      { name: 'scene.json', data: Buffer.from('{}') },
      { name: 'materials/bg.tex', data: Buffer.from([1, 2, 3, 4]) },
    ]);
    const pkg = parsePkgBuffer(buf);
    expect(pkg).not.toBeNull();
    expect(pkg!.magic).toBe('scene.pkg');
    expect(pkg!.entries).toHaveLength(2);
    expect(pkg!.entries[0].fullPath).toBe('scene.json');
    expect(pkg!.entries[0].bytes.toString()).toBe('{}');
    expect(pkg!.entries[1].fullPath).toBe('materials/bg.tex');
    expect(pkg!.entries[1].bytes).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('parses an empty package (zero entries)', () => {
    const pkg = parsePkgBuffer(buildPkg([]));
    expect(pkg).not.toBeNull();
    expect(pkg!.entries).toEqual([]);
  });

  it('returns null for a buffer too small to hold a header', () => {
    expect(parsePkgBuffer(Buffer.alloc(0))).toBeNull();
    expect(parsePkgBuffer(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it('returns null for an empty (zero-length) magic string', () => {
    // length-prefix 0 → empty magic → rejected as not a real pkg.
    const buf = Buffer.concat([i32(0), i32(0)]);
    expect(parsePkgBuffer(buf)).toBeNull();
  });

  it('returns null when entryCount is negative or absurdly large', () => {
    expect(parsePkgBuffer(Buffer.concat([str('scene.pkg'), i32(-1)]))).toBeNull();
    expect(parsePkgBuffer(Buffer.concat([str('scene.pkg'), i32(10001)]))).toBeNull();
  });

  it('returns null when the table claims more entries than the buffer holds', () => {
    // entryCount says 5 but the file is truncated — the string read throws.
    const buf = Buffer.concat([str('scene.pkg'), i32(5), i32(0)]);
    expect(parsePkgBuffer(buf)).toBeNull();
  });

  it('drops an entry whose offset+length fall outside the data section', () => {
    // scene.json is valid; evil.bin claims offset 0, length 999999 which
    // overflows the buffer end — it must be silently dropped, not kill the pkg.
    const data = Buffer.from('{}');
    const parts: Buffer[] = [
      str('scene.pkg'),
      i32(2),
      str('scene.json'),
      i32(0),
      i32(data.length),
      str('evil.bin'),
      i32(0),
      i32(999999),
      data,
    ];
    const pkg = parsePkgBuffer(Buffer.concat(parts));
    expect(pkg).not.toBeNull();
    expect(pkg!.entries).toHaveLength(1);
    expect(pkg!.entries[0].fullPath).toBe('scene.json');
  });

  it('drops an entry with negative offset or length', () => {
    const data = Buffer.from('{}');
    const parts: Buffer[] = [
      str('scene.pkg'),
      i32(2),
      str('scene.json'),
      i32(0),
      i32(data.length),
      str('neg.bin'),
      i32(-5),
      i32(10),
      data,
    ];
    const pkg = parsePkgBuffer(Buffer.concat(parts));
    expect(pkg).not.toBeNull();
    expect(pkg!.entries).toHaveLength(1);
    expect(pkg!.entries[0].fullPath).toBe('scene.json');
  });
});

// ---------------------------------------------------------------------------
// findEntry / findEntries
// ---------------------------------------------------------------------------

function samplePkg(): PkgPackage {
  return parsePkgBuffer(
    buildPkg([
      { name: 'scene.json', data: Buffer.from('{}') },
      { name: 'materials/Bg.tex', data: Buffer.from([1]) },
      { name: 'particles/rain.json', data: Buffer.from('{}') },
    ]),
  )!;
}

describe('findEntry', () => {
  it('finds an entry by exact path (case-insensitive)', () => {
    const pkg = samplePkg();
    expect(findEntry(pkg, 'materials/Bg.tex')?.fullPath).toBe('materials/Bg.tex');
    expect(findEntry(pkg, 'MATERIALS/bg.TEX')?.fullPath).toBe('materials/Bg.tex');
  });

  it('returns null when no entry matches', () => {
    expect(findEntry(samplePkg(), 'nope.json')).toBeNull();
  });
});

describe('findEntries', () => {
  it('returns all entries matching a substring (case-insensitive)', () => {
    const json = findEntries(samplePkg(), '.json')
      .map((e) => e.fullPath)
      .sort();
    expect(json).toEqual(['particles/rain.json', 'scene.json']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(findEntries(samplePkg(), 'textures')).toEqual([]);
  });
});
