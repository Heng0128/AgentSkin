// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-import-export
 *
 * ZIP import validation and export for theme packages. Reuses the existing
 * `sanitizeCSS` and `validateManifest` guards from the catalog pipeline.
 *
 * ZIP reading uses `yauzl` (already a project dependency). ZIP writing is a
 * minimal implementation on `node:zlib` (deflate) — no external dependency.
 * SHA-256 manifest signature stored as `.signature` inside the ZIP.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import yauzl, { type Entry } from 'yauzl';
import { sanitizeCSS } from '../../shared/safe-css';
import { formatSchemaErrors, validateManifest } from './manifest-validator';
import type { ThemeManifest } from './theme-manifest';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_EXTRACT_SIZE = 100 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

export interface ImportValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: ThemeManifest;
  files: Map<string, Buffer>;
}

export interface ExportResult {
  outputPath: string;
  signature: string;
  fileCount: number;
}

function readZipEntries(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Buffer>();
    let totalSize = 0;

    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) {
        reject(new Error(`Failed to open ZIP: ${err.message}`));
        return;
      }
      if (zipfile.entryCount > MAX_ENTRY_COUNT) {
        reject(new Error(`ZIP contains too many entries: ${zipfile.entryCount}`));
        zipfile.close();
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', (entry: Entry) => {
        if (
          entry.fileName.includes('..') ||
          path.isAbsolute(entry.fileName) ||
          entry.fileName.startsWith('/')
        ) {
          reject(new Error(`Path traversal detected: ${entry.fileName}`));
          zipfile.close();
          return;
        }
        if (entry.fileName.endsWith('/')) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (readErr, readStream) => {
          if (readErr) {
            reject(new Error(`Failed to read entry "${entry.fileName}": ${readErr.message}`));
            zipfile.close();
            return;
          }
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > MAX_EXTRACT_SIZE) {
              reject(new Error(`Extracted size exceeds ${MAX_EXTRACT_SIZE} byte limit`));
              zipfile.close();
              return;
            }
            chunks.push(chunk);
          });
          readStream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
          readStream.on('error', (streamErr: Error) => {
            reject(new Error(`Stream error for "${entry.fileName}": ${streamErr.message}`));
            zipfile.close();
          });
        });
      });

      zipfile.on('end', () => {
        resolve(files);
        zipfile.close();
      });
      zipfile.on('error', (zipErr: Error) => {
        reject(new Error(`ZIP processing error: ${zipErr.message}`));
      });
    });
  });
}

export function createZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const fileChunks: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const data = compressed.length < entry.data.length ? compressed : entry.data;
    const method = compressed.length < entry.data.length ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(entry.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    fileChunks.push(lh, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    centralDir.push(cd, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...fileChunks, centralBuf, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function generateManifestSignature(files: Map<string, Buffer>): string {
  const hash = crypto.createHash('sha256');
  const names = [...files.keys()].filter((n) => n !== '.signature').sort();
  for (const name of names) {
    hash.update(Buffer.from(name, 'utf8'));
    hash.update(files.get(name)!);
  }
  return hash.digest('hex');
}

export function verifyManifestSignature(files: Map<string, Buffer>, signature: string): boolean {
  const expected = generateManifestSignature(files);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function validateThemeZip(input: string | Buffer): Promise<ImportValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let raw: Buffer;
  if (typeof input === 'string') {
    try {
      raw = await fs.readFile(input);
    } catch (e) {
      return {
        ok: false,
        errors: [`Failed to read file: ${(e as Error).message}`],
        warnings,
        files: new Map(),
      };
    }
  } else {
    raw = input;
  }

  let files: Map<string, Buffer>;
  try {
    const tmpPath = path.join(
      require('node:os').tmpdir(),
      `agentskin-import-${crypto.randomBytes(8).toString('hex')}.zip`,
    );
    await fs.writeFile(tmpPath, raw);
    try {
      files = await readZipEntries(tmpPath);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  } catch (e) {
    return {
      ok: false,
      errors: [`Invalid ZIP: ${(e as Error).message}`],
      warnings,
      files: new Map(),
    };
  }

  const manifestBuf = files.get('manifest.json');
  if (!manifestBuf) {
    return { ok: false, errors: ['Missing manifest.json at ZIP root'], warnings, files };
  }

  let manifest: ThemeManifest;
  try {
    // TODO: type-guard — 待渐进式加固
    manifest = JSON.parse(manifestBuf.toString('utf8')) as ThemeManifest;
  } catch {
    return { ok: false, errors: ['manifest.json is not valid JSON'], warnings, files };
  }

  const schemaErrors = validateManifest(manifest);
  if (schemaErrors.length > 0)
    errors.push(`Schema validation failed: ${formatSchemaErrors(schemaErrors)}`);

  const referenced = [manifest.icon, manifest.preview];
  if (manifest.hero) referenced.push(manifest.hero);
  for (const ref of referenced) {
    if (ref && !files.has(ref)) errors.push(`Referenced file missing from ZIP: ${ref}`);
  }

  for (const [name, data] of files) {
    if (name.endsWith('.css')) {
      const result = sanitizeCSS(data.toString('utf8'));
      if (result.blocked) errors.push(`CSS file "${name}" blocked: ${result.reasons.join(', ')}`);
    }
  }

  let totalImageSize = 0;
  for (const [name, data] of files) {
    if (IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      totalImageSize += data.length;
      if (data.length > MAX_IMAGE_SIZE)
        errors.push(`Image "${name}" exceeds 10MB limit (${formatBytes(data.length)})`);
    }
  }
  if (totalImageSize > MAX_TOTAL_IMAGE_SIZE)
    errors.push(`Total image size exceeds 50MB limit (${formatBytes(totalImageSize)})`);

  const sigBuf = files.get('.signature');
  if (sigBuf) {
    if (!verifyManifestSignature(files, sigBuf.toString('utf8').trim())) {
      errors.push('SHA-256 signature verification failed: package may be tampered');
    }
  } else {
    warnings.push('No .signature file found: package integrity not verifiable');
  }

  return { ok: errors.length === 0, errors, warnings, manifest, files };
}

export async function exportTheme(
  _themeId: string,
  packagePath: string,
  outputPath: string,
): Promise<ExportResult> {
  const entries: Array<{ name: string; data: Buffer }> = [];

  const manifestRaw = await fs.readFile(path.join(packagePath, 'manifest.json'), 'utf8');
  // TODO: type-guard — 待渐进式加固
  const manifest = JSON.parse(manifestRaw) as ThemeManifest;
  entries.push({ name: 'manifest.json', data: Buffer.from(manifestRaw, 'utf8') });

  const referenced = [manifest.icon, manifest.preview];
  if (manifest.hero) referenced.push(manifest.hero);
  for (const ref of referenced) {
    if (ref) {
      try {
        entries.push({ name: ref, data: await fs.readFile(path.join(packagePath, ref)) });
      } catch {
        /* skip missing */
      }
    }
  }

  const cssDir = path.join(packagePath, 'assets', 'css');
  try {
    const walkCss = async (dir: string, prefix: string) => {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const relPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) await walkCss(path.join(dir, item.name), relPath);
        else if (item.name.endsWith('.css')) {
          entries.push({
            name: `assets/css/${relPath}`,
            data: await fs.readFile(path.join(dir, item.name)),
          });
        }
      }
    };
    await walkCss(cssDir, '');
  } catch {
    /* no CSS dir */
  }

  try {
    entries.push({
      name: 'README.md',
      data: await fs.readFile(path.join(packagePath, 'README.md')),
    });
  } catch {
    /* no README */
  }

  const signature = generateManifestSignature(new Map(entries.map((e) => [e.name, e.data])));
  entries.push({ name: '.signature', data: Buffer.from(signature, 'utf8') });

  await fs.writeFile(outputPath, createZip(entries));
  return { outputPath, signature, fileCount: entries.length };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
