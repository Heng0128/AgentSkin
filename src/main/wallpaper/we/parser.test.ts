// SPDX-License-Identifier: MPL-2.0

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseWorkshopProject } from './parser';

/** 1×1 透明 PNG。 */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function writeJson(dir: string, name: string, value: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(value), 'utf8');
}

describe('parseWorkshopProject — type 分发', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'we-parser-test-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('detects a web wallpaper from index.html', async () => {
    const dir = path.join(root, 'wp-web');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'index.html'), '<html></html>');
    const item = await parseWorkshopProject(dir, 'wp-web');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('web');
    expect(item!.projectType).toBe('web');
    expect(item!.dirPath).toBe(dir);
  });

  it('detects a scene wallpaper from scene.pkg', async () => {
    const dir = path.join(root, 'wp-scene');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'scene.pkg'), Buffer.alloc(10));
    const item = await parseWorkshopProject(dir, 'wp-scene');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('scene');
    expect(item!.projectType).toBe('scene');
    expect(item!.pkgPath).toBe(path.join(dir, 'scene.pkg'));
  });

  it('detects a video wallpaper from project.type + file', async () => {
    const dir = path.join(root, 'wp-video');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'movie.mp4'), Buffer.alloc(50));
    await writeJson(dir, 'project.json', { type: 'video', file: 'movie.mp4', title: 'V' });
    const item = await parseWorkshopProject(dir, 'wp-video');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('video');
    expect(item!.mediaPath).toBe(path.join(dir, 'movie.mp4'));
    expect(item!.title).toBe('V');
  });

  it("treats a .gif declared as video as an image (browsers can't play gif in <video>)", async () => {
    const dir = path.join(root, 'wp-gif');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'anim.gif'), Buffer.alloc(30));
    await writeJson(dir, 'project.json', { type: 'video', file: 'anim.gif' });
    const item = await parseWorkshopProject(dir, 'wp-gif');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('image');
    expect(item!.playback).toBe('gif');
  });

  it('infers video from a .mp4 file when project.type is missing', async () => {
    const dir = path.join(root, 'wp-infer');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'clip.mp4'), Buffer.alloc(40));
    await writeJson(dir, 'project.json', { file: 'clip.mp4' });
    const item = await parseWorkshopProject(dir, 'wp-infer');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('video');
  });

  it('falls back to scanning the directory for the largest video when type is unknown', async () => {
    const dir = path.join(root, 'wp-scan');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'small.mp4'), Buffer.alloc(10));
    await fs.writeFile(path.join(dir, 'big.mp4'), Buffer.alloc(80));
    await writeJson(dir, 'project.json', { type: 'application', file: 'main.exe' });
    const item = await parseWorkshopProject(dir, 'wp-scan');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('video');
    expect(item!.mediaPath).toBe(path.join(dir, 'big.mp4'));
  });

  it('marks preview-only when only a preview image exists for an unknown type', async () => {
    const dir = path.join(root, 'wp-prevonly');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'preview.jpg'), Buffer.alloc(20));
    await writeJson(dir, 'project.json', { type: 'application', file: 'missing.bin' });
    const item = await parseWorkshopProject(dir, 'wp-prevonly');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('image');
    expect(item!.previewOnly).toBe(true);
    expect(item!.mediaPath).toBe(path.join(dir, 'preview.jpg'));
  });

  it('returns null when the directory has no usable content', async () => {
    const dir = path.join(root, 'wp-empty');
    await fs.mkdir(dir);
    await writeJson(dir, 'project.json', { type: 'video', file: 'gone.mp4' });
    const item = await parseWorkshopProject(dir, 'wp-empty');
    expect(item).toBeNull();
  });

  it('parses a bare image directory without project.json', async () => {
    const dir = path.join(root, 'wp-bare');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'photo.png'), PNG_BYTES);
    const item = await parseWorkshopProject(dir, 'wp-bare');
    expect(item).not.toBeNull();
    expect(item!.type).toBe('image');
    expect(item!.projectType).toBe('image');
    expect(item!.source).toBe('workshop');
  });

  it('resolves a custom preview filename from project.json', async () => {
    const dir = path.join(root, 'wp-preview');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'hero.png'), PNG_BYTES);
    await writeJson(dir, 'project.json', {
      type: 'image',
      file: 'hero.png',
      preview: 'hero.png',
      title: 'Custom',
    });
    const item = await parseWorkshopProject(dir, 'wp-preview');
    expect(item).not.toBeNull();
    expect(item!.previewPath).toBe(path.join(dir, 'hero.png'));
  });
});
