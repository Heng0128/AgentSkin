// SPDX-License-Identifier: MPL-2.0

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickLargestFallbackImage } from './fallback-image';

describe('pickLargestFallbackImage', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fallback-image-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('picks the largest decodable image in the directory over the preview', async () => {
    const preview = path.join(dir, 'preview.jpg');
    const hero = path.join(dir, 'hero.png');
    const video = path.join(dir, 'video.mp4'); // 非图片扩展名 → 跳过
    await fs.writeFile(preview, Buffer.alloc(100));
    await fs.writeFile(hero, Buffer.alloc(5000));
    await fs.writeFile(video, Buffer.alloc(99999));

    const picked = await pickLargestFallbackImage(dir, preview);
    expect(picked).toBe(hero);
  });

  it('returns the preview when no directory image is larger', async () => {
    const preview = path.join(dir, 'preview.jpg');
    await fs.writeFile(preview, Buffer.alloc(100));
    const small = path.join(dir, 'thumb.png');
    await fs.writeFile(small, Buffer.alloc(50));

    const picked = await pickLargestFallbackImage(dir, preview);
    expect(picked).toBe(preview);
  });

  it('returns null when fallback is null', async () => {
    await expect(pickLargestFallbackImage(dir, null)).resolves.toBeNull();
  });

  it('returns the preview when the directory is unreadable (never throws)', async () => {
    const preview = path.join(dir, 'preview.jpg');
    await fs.writeFile(preview, Buffer.alloc(10));
    const missing = path.join(dir, 'does-not-exist');
    const picked = await pickLargestFallbackImage(missing, preview);
    expect(picked).toBe(preview);
  });

  it('returns the preview when it is unreadable', async () => {
    const preview = path.join(dir, 'gone.jpg');
    const picked = await pickLargestFallbackImage(dir, preview);
    expect(picked).toBe(preview);
  });

  it('uses an injected sizeOf (no fs dependency)', async () => {
    const preview = path.join(dir, 'preview.jpg');
    const hero = path.join(dir, 'hero.png');
    await fs.writeFile(preview, Buffer.alloc(100));
    await fs.writeFile(hero, Buffer.alloc(100));
    // 假 sizeOf：hero 更大（不读真实 stat）。
    const sizeOf = async (file: string) => (path.basename(file) === 'hero.png' ? 900 : 100);
    const picked = await pickLargestFallbackImage(dir, preview, sizeOf);
    expect(picked).toBe(hero);
  });
});
