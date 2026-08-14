// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importMedia, WallpaperImportError } from './importer';

describe('importMedia', () => {
  let tmpDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-wp-'));
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-wp-src-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  it('throws WallpaperImportError (UNSUPPORTED_FORMAT) for unknown extensions', async () => {
    const bogus = path.join(sourceDir, 'readme.txt');
    await fs.writeFile(bogus, 'not a media file');
    await expect(importMedia(bogus, tmpDir)).rejects.toThrow(WallpaperImportError);
    await expect(importMedia(bogus, tmpDir)).rejects.toThrow('不支持的壁纸格式');
  });

  it('throws WallpaperImportError (FILE_NOT_FOUND) when source does not exist', async () => {
    const missing = path.join(sourceDir, 'ghost.png');
    await expect(importMedia(missing, tmpDir)).rejects.toThrow(WallpaperImportError);
    await expect(importMedia(missing, tmpDir)).rejects.toThrow('文件不存在');
  });

  it('throws WallpaperImportError (FILE_TOO_LARGE) when image exceeds cap', async () => {
    // MAX_IMPORT_IMAGE_BYTES is 50MB — write 51MB.
    const bigImage = path.join(sourceDir, 'big.png');
    await fs.writeFile(bigImage, Buffer.alloc(51 * 1024 * 1024));
    await expect(importMedia(bigImage, tmpDir)).rejects.toThrow(WallpaperImportError);
    await expect(importMedia(bigImage, tmpDir)).rejects.toThrow('文件过大');
  });

  it('imports a valid PNG and returns a DiscoveredItem', async () => {
    const img = path.join(sourceDir, 'valid.png');
    await fs.writeFile(img, Buffer.from('fake-png-data'));
    const item = await importMedia(img, tmpDir);
    expect(item.id).toMatch(/^local:/);
    expect(item.type).toBe('image');
    expect(await fs.stat(item.mediaPath)).toBeTruthy();
  });

  it('imports a valid M4V video and returns type=video', async () => {
    const vid = path.join(sourceDir, 'vid.mp4');
    await fs.writeFile(vid, Buffer.alloc(1024));
    const item = await importMedia(vid, tmpDir);
    expect(item.type).toBe('video');
    expect(item.id).toContain('vid.mp4');
  });

  it('appends a suffix when the file already exists in customDir', async () => {
    const img = path.join(sourceDir, 'dup.png');
    await fs.writeFile(img, Buffer.from('first'));
    await importMedia(img, tmpDir);

    // Second import of the same file.
    await fs.writeFile(img, Buffer.from('second'));
    const second = await importMedia(img, tmpDir);
    expect(second.id).toMatch(/\s\(1\)/);
  });
});
