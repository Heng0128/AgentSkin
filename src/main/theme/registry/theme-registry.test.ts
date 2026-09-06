// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for theme-registry.ts — the theme registry sync protocol.
 *
 * Covers:
 * 1. Registry parsing (valid + invalid)
 * 2. Incremental version detection
 * 3. SHA-256 checksum verification
 * 4. Atomic install flow
 * 5. Rollback on failure
 * 6. Network error handling
 * 7. Download size limits
 * 8. End-to-end syncThemes flow
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChecksumMismatchError,
  computeBufferSha256,
  computeFileSha256,
  downloadFile,
  extractZipSimple,
  findUpdates,
  installTheme,
  isNewerVersion,
  parseRegistry,
  RegistryParseError,
  type RegistryThemeEntry,
  readLocalVersions,
  SizeMismatchError,
  syncThemes,
  type ThemeRegistry,
} from './theme-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid registry for testing. */
function createTestRegistry(themes: Partial<RegistryThemeEntry>[] = []): ThemeRegistry {
  return {
    version: 1,
    themes: themes.map(
      (t, i): RegistryThemeEntry => ({
        id: t.id ?? `theme-${i}`,
        name: t.name ?? `Theme ${i}`,
        version: t.version ?? '1.0.0',
        preview_url: t.preview_url ?? `https://example.com/${t.id ?? `theme-${i}`}/preview.png`,
        download_url: t.download_url ?? `https://example.com/${t.id ?? `theme-${i}`}/download.zip`,
        sha256: t.sha256 ?? createHash('sha256').update(`content-${i}`).digest('hex'),
        size: t.size ?? 1000,
        ...(t.checksum_url ? { checksum_url: t.checksum_url } : {}),
      }),
    ),
  };
}

/** Create a valid ZIP file with stored (no compression) entries. */
function createStoredZip(entries: Record<string, Buffer>): Buffer {
  const fileRecords: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;
  const entryList = Object.entries(entries);
  const numEntries = entryList.length;

  for (const [filename, content] of entryList) {
    const filenameBuf = Buffer.from(filename, 'utf8');
    const crc = crc32(content);

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4); // Version needed
    localHeader.writeUInt16LE(0, 6); // Flags
    localHeader.writeUInt16LE(0, 8); // Compression method (stored)
    localHeader.writeUInt16LE(0, 10); // Mod time
    localHeader.writeUInt16LE(0, 12); // Mod date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(content.length, 18); // Compressed size
    localHeader.writeUInt32LE(content.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // Filename length
    localHeader.writeUInt16LE(0, 28); // Extra field length

    fileRecords.push(localHeader, filenameBuf, content);

    // Central directory file header
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // Signature
    cdHeader.writeUInt16LE(20, 4); // Version made by
    cdHeader.writeUInt16LE(20, 6); // Version needed
    cdHeader.writeUInt16LE(0, 8); // Flags
    cdHeader.writeUInt16LE(0, 10); // Compression method
    cdHeader.writeUInt16LE(0, 12); // Mod time
    cdHeader.writeUInt16LE(0, 14); // Mod date
    cdHeader.writeUInt32LE(crc, 16); // CRC-32
    cdHeader.writeUInt32LE(content.length, 20); // Compressed size
    cdHeader.writeUInt32LE(content.length, 24); // Uncompressed size
    cdHeader.writeUInt16LE(filenameBuf.length, 28); // Filename length
    cdHeader.writeUInt16LE(0, 30); // Extra field length
    cdHeader.writeUInt16LE(0, 32); // Comment length
    cdHeader.writeUInt16LE(0, 34); // Disk number
    cdHeader.writeUInt16LE(0, 36); // Internal attrs
    cdHeader.writeUInt32LE(0, 38); // External attrs
    cdHeader.writeUInt32LE(offset, 42); // Local header offset

    centralDir.push(cdHeader, filenameBuf);

    offset += localHeader.length + filenameBuf.length + content.length;
  }

  const centralDirBuf = Buffer.concat(centralDir);
  const centralDirOffset = offset;

  // End of Central Directory Record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk with CD
  eocd.writeUInt16LE(numEntries, 8); // Entries on disk
  eocd.writeUInt16LE(numEntries, 10); // Total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12); // Central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // Central dir offset
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...fileRecords, centralDirBuf, eocd]);
}

/** Compute CRC-32 for a buffer (used in ZIP file creation). */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Create a fetch mock that returns a response with the given body. */
function createFetchMock(body: string | Buffer, status = 200): typeof fetch {
  return vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => {
    const buf = typeof body === 'string' ? Buffer.from(body) : body;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => buf.toString('utf8'),
      json: async () => JSON.parse(buf.toString('utf8')),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      }),
    } as Response;
  });
}

/** Create a fetch mock that returns a streaming response for binary data. */
function createStreamingFetchMock(data: Buffer, status = 200): typeof fetch {
  return vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => data.toString('utf8'),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(data));
          controller.close();
        },
      }),
    } as Response;
  });
}

// ---------------------------------------------------------------------------
// 1. Registry parsing
// ---------------------------------------------------------------------------

describe('parseRegistry', () => {
  it('parses a valid registry JSON', () => {
    const registry = createTestRegistry([
      { id: 'cyber-neon', name: 'Cyber Neon', version: '1.2.0' },
    ]);
    const raw = JSON.stringify(registry);
    const result = parseRegistry(raw);
    expect(result.version).toBe(1);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0].id).toBe('cyber-neon');
    expect(result.themes[0].name).toBe('Cyber Neon');
    expect(result.themes[0].version).toBe('1.2.0');
  });

  it('parses an empty themes array', () => {
    const raw = JSON.stringify({ version: 1, themes: [] });
    const result = parseRegistry(raw);
    expect(result.themes).toEqual([]);
  });

  it('throws RegistryParseError for malformed JSON', () => {
    expect(() => parseRegistry('{ invalid json')).toThrow(RegistryParseError);
    expect(() => parseRegistry('{ invalid json')).toThrow('Registry JSON is malformed');
  });

  it('throws RegistryParseError for missing required fields', () => {
    const raw = JSON.stringify({
      version: 1,
      themes: [{ id: 'test' }], // missing name, version, etc.
    });
    expect(() => parseRegistry(raw)).toThrow(RegistryParseError);
  });

  it('throws RegistryParseError for non-string fields', () => {
    const raw = JSON.stringify({
      version: 1,
      themes: [
        {
          id: 123,
          name: 'Test',
          version: '1.0.0',
          preview_url: 'x',
          download_url: 'y',
          sha256: 'z',
          size: 100,
        },
      ],
    });
    expect(() => parseRegistry(raw)).toThrow(RegistryParseError);
  });

  it('throws RegistryParseError for invalid size', () => {
    const raw = JSON.stringify({
      version: 1,
      themes: [
        {
          id: 't',
          name: 'T',
          version: '1.0.0',
          preview_url: 'x',
          download_url: 'y',
          sha256: 'z',
          size: -1,
        },
      ],
    });
    expect(() => parseRegistry(raw)).toThrow(RegistryParseError);
  });

  it('throws RegistryParseError for unsupported version', () => {
    const raw = JSON.stringify({ version: 999, themes: [] });
    expect(() => parseRegistry(raw)).toThrow('Unsupported registry version: 999');
  });
});

// ---------------------------------------------------------------------------
// 2. Incremental version detection
// ---------------------------------------------------------------------------

describe('isNewerVersion', () => {
  it('returns true when registry version has higher major', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('returns true when registry version has higher minor', () => {
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true);
  });

  it('returns true when registry version has higher patch', () => {
    expect(isNewerVersion('1.2.4', '1.2.3')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  it('returns false when local version is newer', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false);
  });
});

describe('findUpdates', () => {
  it('identifies new themes that are not installed', () => {
    const registry = createTestRegistry([{ id: 'new-theme' }]);
    const installed = new Map<string, string>();
    const updates = findUpdates(registry, installed);
    expect(updates).toHaveLength(1);
    expect(updates[0].isNew).toBe(true);
    expect(updates[0].localVersion).toBeUndefined();
  });

  it('identifies themes with newer versions', () => {
    const registry = createTestRegistry([{ id: 'theme-a', version: '2.0.0' }]);
    const installed = new Map([['theme-a', '1.0.0']]);
    const updates = findUpdates(registry, installed);
    expect(updates).toHaveLength(1);
    expect(updates[0].isNew).toBe(false);
    expect(updates[0].localVersion).toBe('1.0.0');
  });

  it('skips themes that are already up-to-date', () => {
    const registry = createTestRegistry([{ id: 'theme-b', version: '1.0.0' }]);
    const installed = new Map([['theme-b', '1.0.0']]);
    const updates = findUpdates(registry, installed);
    expect(updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. SHA-256 checksum verification
// ---------------------------------------------------------------------------

describe('computeBufferSha256', () => {
  it('returns correct SHA-256 hex digest', () => {
    const data = Buffer.from('hello world');
    const hash = computeBufferSha256(data);
    expect(hash).toBe(createHash('sha256').update(data).digest('hex'));
  });
});

describe('computeFileSha256', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('computes correct SHA-256 for a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'test content');
    const hash = await computeFileSha256(filePath);
    expect(hash).toBe(createHash('sha256').update('test content').digest('hex'));
  });
});

// ---------------------------------------------------------------------------
// 4. Download file (with mock fetch)
// ---------------------------------------------------------------------------

describe('downloadFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('downloads a file successfully using mock fetch', async () => {
    const content = Buffer.from('mock theme package content');
    const fetchMock = createStreamingFetchMock(content);
    const destPath = path.join(tmpDir, 'theme.zip');

    const bytesDownloaded = await downloadFile('https://example.com/theme.zip', destPath, {
      fetchImpl: fetchMock,
      maxBytes: 50 * 1024 * 1024,
    });

    expect(bytesDownloaded).toBeGreaterThan(0);
    const saved = await fs.readFile(destPath);
    expect(saved.toString()).toBe(content.toString());
  });

  it('throws on HTTP error status', async () => {
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 404 } as Response;
    }) as unknown as typeof fetch;
    const destPath = path.join(tmpDir, 'theme.zip');

    await expect(
      downloadFile('https://example.com/missing.zip', destPath, {
        fetchImpl: fetchMock,
        maxBytes: 50 * 1024 * 1024,
      }),
    ).rejects.toThrow('Download failed: HTTP 404');
  });

  it('enforces max download size limit', async () => {
    // Create data larger than the limit
    const bigContent = Buffer.alloc(200, 0x42);
    const fetchMock = createStreamingFetchMock(bigContent);
    const destPath = path.join(tmpDir, 'theme.zip');

    await expect(
      downloadFile('https://example.com/big.zip', destPath, {
        fetchImpl: fetchMock,
        maxBytes: 100, // 100 bytes limit
      }),
    ).rejects.toThrow('Download exceeded 100 byte limit');

    // Verify partial file was cleaned up
    const exists = await fs
      .access(destPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. ZIP extraction
// ---------------------------------------------------------------------------

describe('extractZipSimple', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('extracts stored (no compression) ZIP entries', async () => {
    const zipData = createStoredZip({
      'manifest.json': Buffer.from('{"id":"test","version":"1.0.0"}'),
      'theme.css': Buffer.from(':root { --accent: #ff0000; }'),
    });
    const zipPath = path.join(tmpDir, 'test.zip');
    await fs.writeFile(zipPath, zipData);
    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir);

    await extractZipSimple(zipPath, extractDir);

    const manifest = await fs.readFile(path.join(extractDir, 'manifest.json'), 'utf8');
    expect(manifest).toBe('{"id":"test","version":"1.0.0"}');
    const css = await fs.readFile(path.join(extractDir, 'theme.css'), 'utf8');
    expect(css).toBe(':root { --accent: #ff0000; }');
  });

  it('extracts deflated ZIP entries', async () => {
    const content = Buffer.from('deflated content here');
    const compressed = deflateRawSync(content);
    const zipData = createDeflatedZip('file.txt', compressed, content.length);

    const zipPath = path.join(tmpDir, 'test.zip');
    await fs.writeFile(zipPath, zipData);
    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir);

    await extractZipSimple(zipPath, extractDir);

    const extracted = await fs.readFile(path.join(extractDir, 'file.txt'), 'utf8');
    expect(extracted).toBe('deflated content here');
  });

  it('rejects path traversal attempts', async () => {
    const zipData = createStoredZip({
      '../../../etc/passwd': Buffer.from('root:x:0:0'),
    });
    const zipPath = path.join(tmpDir, 'evil.zip');
    await fs.writeFile(zipPath, zipData);
    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir);

    await expect(extractZipSimple(zipPath, extractDir)).rejects.toThrow('ZIP path traversal');
  });
});

/** Helper: create a ZIP with a single deflated entry. */
function createDeflatedZip(filename: string, compressed: Buffer, originalSize: number): Buffer {
  const fileRecords: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  const filenameBuf = Buffer.from(filename, 'utf8');

  // Local file header
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // Deflated
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14); // CRC
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(originalSize, 22);
  localHeader.writeUInt16LE(filenameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  fileRecords.push(localHeader, filenameBuf, compressed);

  const cdHeader = Buffer.alloc(46);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0, 8);
  cdHeader.writeUInt16LE(8, 10); // Deflated
  cdHeader.writeUInt16LE(0, 12);
  cdHeader.writeUInt16LE(0, 14);
  cdHeader.writeUInt32LE(0, 16); // CRC
  cdHeader.writeUInt32LE(compressed.length, 20);
  cdHeader.writeUInt32LE(originalSize, 24);
  cdHeader.writeUInt16LE(filenameBuf.length, 28);
  cdHeader.writeUInt16LE(0, 30);
  cdHeader.writeUInt16LE(0, 32);
  cdHeader.writeUInt16LE(0, 34);
  cdHeader.writeUInt16LE(0, 36);
  cdHeader.writeUInt32LE(0, 38);
  cdHeader.writeUInt32LE(offset, 42);

  centralDir.push(cdHeader, filenameBuf);
  offset += localHeader.length + filenameBuf.length + compressed.length;

  const centralDirBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); // Total entries on disk
  eocd.writeUInt16LE(1, 10); // Total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...fileRecords, centralDirBuf, eocd]);
}

// ---------------------------------------------------------------------------
// 6. Atomic install
// ---------------------------------------------------------------------------

describe('installTheme', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('installs a theme from a local ZIP file', async () => {
    const zipData = createStoredZip({
      'manifest.json': Buffer.from('{"id":"test-theme"}'),
    });
    const zipPath = path.join(tmpDir, 'test-theme.zip');
    await fs.writeFile(zipPath, zipData);

    const entry: RegistryThemeEntry = {
      id: 'test-theme',
      name: 'Test Theme',
      version: '1.0.0',
      preview_url: 'https://example.com/preview.png',
      download_url: 'https://example.com/download.zip',
      sha256: createHash('sha256').update(zipData).digest('hex'),
      size: zipData.length,
    };

    const destDir = path.join(tmpDir, 'themes');
    const result = await installTheme(entry, destDir, zipPath);

    expect(result.status).toBe('installed');
    expect(result.installedVersion).toBe('1.0.0');

    // Verify theme was extracted
    const themeDir = path.join(destDir, 'test-theme.agentskin-theme');
    const manifest = await fs.readFile(path.join(themeDir, 'manifest.json'), 'utf8');
    expect(manifest).toBe('{"id":"test-theme"}');

    // Verify version marker was written
    const versionFile = await fs.readFile(
      path.join(destDir, 'test-theme.agentskin-version'),
      'utf8',
    );
    expect(versionFile).toBe('1.0.0');
  });

  it('fails install when SHA-256 does not match', async () => {
    const zipData = createStoredZip({ 'manifest.json': Buffer.from('{}') });
    const zipPath = path.join(tmpDir, 'bad-theme.zip');
    await fs.writeFile(zipPath, zipData);

    const entry: RegistryThemeEntry = {
      id: 'bad-theme',
      name: 'Bad Theme',
      version: '1.0.0',
      preview_url: 'https://example.com/preview.png',
      download_url: 'https://example.com/download.zip',
      sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // wrong
      size: zipData.length,
    };

    const destDir = path.join(tmpDir, 'themes');
    const result = await installTheme(entry, destDir, zipPath);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('checksum mismatch');
  });

  it('cleans up temp dir after install', async () => {
    const zipData = createStoredZip({ 'manifest.json': Buffer.from('{}') });
    const zipPath = path.join(tmpDir, 'cleanup-test.zip');
    await fs.writeFile(zipPath, zipData);

    const entry: RegistryThemeEntry = {
      id: 'cleanup-test',
      name: 'Cleanup Test',
      version: '1.0.0',
      preview_url: 'https://example.com/preview.png',
      download_url: 'https://example.com/download.zip',
      sha256: createHash('sha256').update(zipData).digest('hex'),
      size: zipData.length,
    };

    const destDir = path.join(tmpDir, 'themes');
    await installTheme(entry, destDir, zipPath);

    // Verify temp dirs are cleaned up (only destDir and test files should exist)
    const tempEntries = await fs.readdir(os.tmpdir());
    const leftoverTemps = tempEntries.filter((e) => e.startsWith('agentskin-registry-'));
    expect(leftoverTemps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Local version detection
// ---------------------------------------------------------------------------

describe('readLocalVersions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads version markers from local directory', async () => {
    await fs.writeFile(path.join(tmpDir, 'theme-a.agentskin-version'), '1.0.0', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'theme-b.agentskin-version'), '2.5.0', 'utf8');

    const versions = await readLocalVersions(tmpDir);
    expect(versions.get('theme-a')).toBe('1.0.0');
    expect(versions.get('theme-b')).toBe('2.5.0');
  });

  it('returns empty map for non-existent directory', async () => {
    const versions = await readLocalVersions(path.join(tmpDir, 'nonexistent'));
    expect(versions.size).toBe(0);
  });

  it('ignores non-version files', async () => {
    await fs.writeFile(path.join(tmpDir, 'theme-a.agentskin-version'), '1.0.0', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'random.txt'), 'ignore me', 'utf8');

    const versions = await readLocalVersions(tmpDir);
    expect(versions.size).toBe(1);
    expect(versions.has('random')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. End-to-end syncThemes
// ---------------------------------------------------------------------------

describe('syncThemes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('performs full sync with new theme installation', async () => {
    const zipData = createStoredZip({ 'manifest.json': Buffer.from('{"id":"new-theme"}') });
    const registry = createTestRegistry([
      {
        id: 'new-theme',
        name: 'New Theme',
        version: '1.0.0',
        sha256: createHash('sha256').update(zipData).digest('hex'),
        size: zipData.length,
      },
    ]);

    // Mock fetch: return registry for registry URL, ZIP for download URL
    const fetchMock = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('registry.json')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(registry),
        } as Response;
      }
      if (urlStr.includes('download.zip')) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(zipData));
              controller.close();
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as unknown as typeof fetch;

    const destDir = path.join(tmpDir, 'themes');
    const result = await syncThemes('https://example.com/registry.json', destDir, {
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.installed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].status).toBe('installed');
  });

  it('skips themes that are already up-to-date', async () => {
    const zipData = createStoredZip({ 'manifest.json': Buffer.from('{}') });
    const registry = createTestRegistry([
      {
        id: 'existing-theme',
        name: 'Existing Theme',
        version: '1.0.0',
        sha256: createHash('sha256').update(zipData).digest('hex'),
        size: zipData.length,
      },
    ]);

    const fetchMock = createFetchMock(JSON.stringify(registry));
    const destDir = path.join(tmpDir, 'themes');

    // Pre-create the dest directory and install the theme with matching version
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(path.join(destDir, 'existing-theme.agentskin-version'), '1.0.0', 'utf8');

    const result = await syncThemes('https://example.com/registry.json', destDir, {
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.installed).toBe(0);
    expect(result.results[0].status).toBe('skipped');
  });

  it('handles registry fetch failure gracefully', async () => {
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 500 } as Response;
    }) as unknown as typeof fetch;

    const destDir = path.join(tmpDir, 'themes');
    const result = await syncThemes('https://example.com/registry.json', destDir, {
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Registry fetch failed');
    expect(result.totalEvaluated).toBe(0);
  });

  it('handles network error during registry fetch', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('Network unreachable');
    }) as unknown as typeof fetch;

    const destDir = path.join(tmpDir, 'themes');
    const result = await syncThemes('https://example.com/registry.json', destDir, {
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Registry fetch error');
  });

  it('reports partial success when some themes fail', async () => {
    const goodZip = createStoredZip({ 'manifest.json': Buffer.from('{"id":"good"}') });
    const registry = createTestRegistry([
      {
        id: 'good-theme',
        name: 'Good Theme',
        version: '1.0.0',
        sha256: createHash('sha256').update(goodZip).digest('hex'),
        size: goodZip.length,
      },
      {
        id: 'bad-theme',
        name: 'Bad Theme',
        version: '1.0.0',
        sha256: 'invalidsha256invalidsha256invalidsha256invalidsha256invalidsha256invalidsha256in',
        size: 100,
      },
    ]);

    const fetchMock = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('registry.json')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(registry) } as Response;
      }
      if (urlStr.includes('good-theme')) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(goodZip));
              controller.close();
            },
          }),
        } as Response;
      }
      if (urlStr.includes('bad-theme')) {
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(Buffer.from('wrong content')));
              controller.close();
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as unknown as typeof fetch;

    const destDir = path.join(tmpDir, 'themes');
    const result = await syncThemes('https://example.com/registry.json', destDir, {
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.installed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('invokes onProgress callback for each theme', async () => {
    const zipData = createStoredZip({ 'manifest.json': Buffer.from('{}') });
    const registry = createTestRegistry([
      {
        id: 'progress-theme',
        name: 'Progress Theme',
        version: '1.0.0',
        sha256: createHash('sha256').update(zipData).digest('hex'),
        size: zipData.length,
      },
    ]);

    const fetchMock = vi.fn(async (url: string | URL | Request, _options?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('registry.json')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(registry) } as Response;
      }
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(zipData));
            controller.close();
          },
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const destDir = path.join(tmpDir, 'themes');
    const progressCalls: Array<{ index: number; total: number }> = [];

    await syncThemes('https://example.com/registry.json', destDir, {
      fetchImpl: fetchMock,
      onProgress: (_result, index, total) => {
        progressCalls.push({ index, total });
      },
    });

    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Error classes
// ---------------------------------------------------------------------------

describe('error classes', () => {
  it('ChecksumMismatchError carries expected/actual values', () => {
    const err = new ChecksumMismatchError('theme-1', 'expected-hash', 'actual-hash');
    expect(err.themeId).toBe('theme-1');
    expect(err.expected).toBe('expected-hash');
    expect(err.actual).toBe('actual-hash');
    expect(err.name).toBe('ChecksumMismatchError');
  });

  it('SizeMismatchError carries expected/actual values', () => {
    const err = new SizeMismatchError('theme-1', 1000, 2000);
    expect(err.themeId).toBe('theme-1');
    expect(err.expected).toBe(1000);
    expect(err.actual).toBe(2000);
    expect(err.name).toBe('SizeMismatchError');
  });

  it('RegistryParseError has correct name', () => {
    const err = new RegistryParseError('test error');
    expect(err.name).toBe('RegistryParseError');
    expect(err.message).toBe('test error');
  });
});
