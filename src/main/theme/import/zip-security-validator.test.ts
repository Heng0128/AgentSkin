// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createZip } from '../../catalog/theme-import-export';
import { validateZipImport } from './zip-security-validator';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function createManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark',
    colors: {
      accent: '#00ffff',
      secondary: '#7c83ff',
      background: '#050816',
      foreground: '#e0e8ff',
      muted: '#6c7086',
      surface: '#0a0a12',
      surfaceElevated: '#141828',
      border: '#1e2235',
      codeBackground: '#050816',
      codeForeground: '#e0e8ff',
      inputBackground: '#0a0a12',
      buttonBackground: '#141828',
      focusRing: '#00ffff',
      selection: '#00ffff52',
    },
    ...overrides,
  });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-zipsec-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Helper: write a ZIP buffer to disk and return the path */
async function writeZip(
  filename: string,
  entries: Array<{ name: string; data: Buffer }>,
): Promise<string> {
  const zipPath = path.join(tmpDir, filename);
  await fs.writeFile(zipPath, createZip(entries));
  return zipPath;
}

/**
 * Build a raw ZIP buffer with one entry marked as a Unix symbolic link.
 * The `createZip` helper does not support setting `externalFileAttributes`,
 * so we craft a minimal ZIP manually for the symlink test.
 *
 * The symlink entry's `externalFileAttributes` is set to `0xA1FF0000`
 * (Unix mode `0xA1FF` = `S_IFLNK | 0777`), which yauzl exposes as-is.
 */
function createZipWithSymlink(
  normalEntries: Array<{ name: string; data: Buffer }>,
  symlinkName: string,
  symlinkTarget: string,
): Buffer {
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const allEntries: Array<{ name: string; data: Buffer; isSymlink: boolean }> = [
    ...normalEntries.map((e) => ({ ...e, isSymlink: false })),
    { name: symlinkName, data: Buffer.from(symlinkTarget), isSymlink: true },
  ];

  const fileChunks: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of allEntries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const data = compressed.length < entry.data.length ? compressed : entry.data;
    const method = compressed.length < entry.data.length ? 8 : 0;

    // Local file header (30 bytes + name + data).
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(entry.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    fileChunks.push(lh, nameBuf, data);

    // Central directory header (46 bytes + name).
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    // versionMadeBy: 0x0314 = Unix, version 2.0.
    cd.writeUInt16LE(entry.isSymlink ? 0x0314 : 20, 4);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    if (entry.isSymlink) {
      // externalFileAttributes: Unix mode 0xA1FF << 16 (S_IFLNK | 0777).
      cd.writeUInt32LE(0xa1ff0000, 38);
    }
    cd.writeUInt32LE(offset, 42);
    centralDir.push(cd, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(allEntries.length, 8);
  eocd.writeUInt16LE(allEntries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...fileChunks, centralBuf, eocd]);
}

/** Helper: write a ZIP with a symlink entry to disk and return the path */
async function writeZipWithSymlink(
  filename: string,
  normalEntries: Array<{ name: string; data: Buffer }>,
  symlinkName: string,
  symlinkTarget: string,
): Promise<string> {
  const zipPath = path.join(tmpDir, filename);
  await fs.writeFile(zipPath, createZipWithSymlink(normalEntries, symlinkName, symlinkTarget));
  return zipPath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateZipImport', () => {
  // --- 1. Valid ZIP ---
  it('accepts a valid themed ZIP with allowed file types', async () => {
    const zipPath = await writeZip('valid.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'assets/css/traework.css',
        data: Buffer.from(
          ':root { --agentskin-accent: #00ffff; }\n[data-agentskin-theme] .agentskin-card { color: #fff; }',
        ),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // --- 2. Path traversal ---
  it('rejects ZIP with path traversal entry (../)', async () => {
    const zipPath = await writeZip('traversal.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: '../../etc/passwd', data: Buffer.from('evil') },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Path traversal') || e.includes('traversal'))).toBe(
      true,
    );
  });

  // --- 3. Absolute path ---
  it('rejects ZIP with absolute path entry', async () => {
    const zipPath = await writeZip('absolute.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: '/etc/shadow', data: Buffer.from('root:x:0:0') },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('traversal') || e.includes('absolute'))).toBe(true);
  });

  // --- 4. Oversized single file ---
  it('rejects ZIP with a single file exceeding 10 MB', async () => {
    const zipPath = await writeZip('bigfile.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: 'huge.png', data: Buffer.alloc(11 * 1024 * 1024) },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds 10 MB') || e.includes('10 MB'))).toBe(
      true,
    );
  });

  // --- 5. Oversized total ---
  it('rejects ZIP with total decompressed size exceeding 50 MB', async () => {
    // Create multiple files that sum to > 50 MB.
    const chunk = Buffer.alloc(15 * 1024 * 1024);
    const zipPath = await writeZip('bigtotal.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: 'a.png', data: chunk },
      { name: 'b.png', data: chunk },
      { name: 'c.png', data: chunk },
      { name: 'd.png', data: chunk },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('50 MB') || e.includes('Total'))).toBe(true);
  });

  // --- 6. Missing manifest ---
  it('rejects ZIP without manifest.json', async () => {
    const zipPath = await writeZip('no-manifest.zip', [
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing manifest.json'))).toBe(true);
  });

  // --- 7. Invalid manifest JSON ---
  it('rejects ZIP with malformed manifest.json', async () => {
    const zipPath = await writeZip('bad-manifest.zip', [
      { name: 'manifest.json', data: Buffer.from('{ this is not json <<<') },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not valid JSON') || e.includes('JSON'))).toBe(
      true,
    );
  });

  // --- 8. Manifest missing required fields ---
  it('rejects manifest missing required fields (name, version, colors)', async () => {
    const zipPath = await writeZip('incomplete-manifest.zip', [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify({ id: 'bad' })) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"name"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('"version"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('"colors"'))).toBe(true);
  });

  // --- 9. CSS injection (generic selectors) ---
  it('rejects CSS that targets generic HTML elements (body, div)', async () => {
    const zipPath = await writeZip('css-inject.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from('body { background: red; }\ndiv { display: none; }'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CSS scope violation'))).toBe(true);
  });

  // --- 10. Disallowed file types ---
  it('rejects ZIP containing disallowed file types (.exe, .js, .woff)', async () => {
    const zipPath = await writeZip('badtypes.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: 'malware.exe', data: Buffer.from('MZ\x90\x00') },
      { name: 'script.js', data: Buffer.from('alert(1)') },
      { name: 'font.woff', data: Buffer.from('wOFF') },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('Disallowed file type') && e.includes('malware.exe')),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.includes('Disallowed file type') && e.includes('script.js')),
    ).toBe(true);
    expect(
      result.errors.some((e) => e.includes('Disallowed file type') && e.includes('font.woff')),
    ).toBe(true);
  });

  // --- 11. CSS with external @import ---
  it('rejects CSS with @import or @font-face rules', async () => {
    const zipPath = await writeZip('css-import.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from('@import url("https://evil.com/steal.css");'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('@import') || e.includes('disallowed'))).toBe(true);
  });

  // --- 12. CSS with safe :root and data-agentskin selectors ---
  it('accepts CSS using only :root and [data-agentskin] selectors', async () => {
    const zipPath = await writeZip('css-safe.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'safe.css',
        data: Buffer.from(
          ':root { --agentskin-accent: #00ffff; }\n[data-agentskin-theme="dark"] { --bg: #000; }\n.agentskin-card { border: 1px solid #333; }',
        ),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(true);
    const cssErrors = result.errors.filter((e) => e.includes('CSS'));
    expect(cssErrors).toHaveLength(0);
  });

  // --- 13. Non-existent file ---
  it('returns error when file does not exist', async () => {
    const result = await validateZipImport(path.join(tmpDir, 'nonexistent.zip'));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Failed to read') || e.includes('ENOENT'))).toBe(
      true,
    );
  });

  // --- 14. Universal selector * in CSS ---
  it('rejects CSS with universal selector *', async () => {
    const zipPath = await writeZip('css-universal.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'reset.css',
        data: Buffer.from('* { box-sizing: border-box; }'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('CSS scope violation'))).toBe(true);
  });

  // --- 15. Remote URL detection (https URL in CSS url()) ---
  it('rejects CSS with remote https URL in url()', async () => {
    const zipPath = await writeZip('css-remote-url.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from(':root { --bg: url("https://evil.com/steal.png"); }'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes('Remote URL') && e.includes('https://evil.com/steal.png'),
      ),
    ).toBe(true);
  });

  // --- 16. Remote URL detection (protocol-relative URL) ---
  it('rejects CSS with protocol-relative URL in url()', async () => {
    const zipPath = await writeZip('css-protocol-relative.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from(':root { --bg: url("//cdn.example.com/bg.png"); }'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('Remote URL') && e.includes('protocol-relative')),
    ).toBe(true);
  });

  // --- 17. Remote URL detection allows data: URIs and relative paths ---
  it('accepts CSS with data: URIs and relative paths in url()', async () => {
    const zipPath = await writeZip('css-safe-urls.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from(
          ':root { --bg: url(data:image/png;base64,abc123); --icon: url(../images/icon.png); }',
        ),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(true);
  });

  // --- 18. CSS @import detection ---
  it('rejects CSS with @import statement', async () => {
    const zipPath = await writeZip('css-import-check.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from('@import "https://evil.com/override.css";'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('@import') && e.includes('forbidden'))).toBe(true);
  });

  // --- 19. Executable magic bytes detection (PE/MZ header) ---
  it('rejects file with PE (MZ) magic bytes even with .png extension', async () => {
    const zipPath = await writeZip('magic-pe.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'disguised.png',
        data: Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Executable') && e.includes('PE'))).toBe(true);
  });

  // --- 20. Executable magic bytes detection (ELF header) ---
  it('rejects file with ELF magic bytes even with .css extension', async () => {
    const elfContent = Buffer.alloc(64);
    elfContent.write('\x7fELF', 0);
    const zipPath = await writeZip('magic-elf.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: 'disguised.css', data: elfContent },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Executable') && e.includes('ELF'))).toBe(true);
  });

  // --- 21. Symbolic link detection ---
  it('rejects ZIP containing a symbolic link entry', async () => {
    const zipPath = await writeZipWithSymlink(
      'symlink.zip',
      [
        { name: 'manifest.json', data: Buffer.from(createManifest()) },
        { name: 'icon.png', data: PNG_1X1 },
        { name: 'preview.png', data: PNG_1X1 },
      ],
      'link-to-secret',
      '/etc/shadow',
    );
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('Symbolic link') || e.includes('symbolic link')),
    ).toBe(true);
  });

  // --- 22. Enhanced CSS scope error message ---
  it('reports descriptive error for unscoped generic selector', async () => {
    const zipPath = await writeZip('css-scope-enhanced.zip', [
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      {
        name: 'style.css',
        data: Buffer.from('body { background: red; }'),
      },
    ]);
    const result = await validateZipImport(zipPath);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('CSS scope violation') && e.includes('agentskin-*')),
    ).toBe(true);
  });
});
