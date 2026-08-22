// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wallpaperMediaServer } from '../wallpaper-server';
import { MediaRegistry } from './media-registry';
import type { DiscoveredItem } from './types';

let tmpDir: string;

/** Minimal image-item fixture backed by a real temp file (the media server
 *  stats the path on register). */
async function imageItem(id: string): Promise<DiscoveredItem> {
  const mediaPath = path.join(tmpDir, `${id}.png`);
  await fs.writeFile(mediaPath, Buffer.from('png'));
  return {
    id,
    title: id,
    type: 'image',
    projectType: 'image',
    playback: 'image',
    mediaPath,
    dirPath: null,
    pkgPath: null,
    previewPath: null,
    sizeBytes: 3,
    tags: [],
    source: 'workshop',
    previewOnly: false,
  };
}

afterEach(async () => {
  // The singleton server survives across tests — clear any registrations
  // so one test's tokens don't leak into the next.
  wallpaperMediaServer.stop();
  vi.restoreAllMocks();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = '';
});

// ---------------------------------------------------------------------------
// Core URL resolution (previewUrlForItem / videoUrlFor / webUrlFor)
// ---------------------------------------------------------------------------

describe('MediaRegistry URL resolution', () => {
  it('previewUrlForItem serves the media file itself for image wallpapers', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const item = await imageItem('a');
    const url = await registry.previewUrlForItem(item);
    expect(url).not.toBeNull();
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('png'));
  });

  it('previewUrlForItem uses the dedicated preview path for video wallpapers', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const previewPath = path.join(tmpDir, 'preview.jpg');
    await fs.writeFile(previewPath, Buffer.from('preview'));
    const item: DiscoveredItem = {
      ...(await imageItem('v')),
      type: 'video',
      previewPath,
    };
    const url = await registry.previewUrlForItem(item);
    expect(url).not.toBeNull();
    const res = await fetch(url!);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from('preview'));
  });

  it('previewUrlForItem returns null without a preview source', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const item: DiscoveredItem = {
      ...(await imageItem('n')),
      type: 'video',
      previewPath: null,
    };
    expect(await registry.previewUrlForItem(item)).toBeNull();
  });

  it('videoUrlFor streams the media file with range support', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const item = await imageItem('v');
    const url = await registry.videoUrlFor(item);
    expect(url).not.toBeNull();
    const res = await fetch(url!, { headers: { Range: 'bytes=0-1' } });
    expect(res.status).toBe(206);
  });

  it('webUrlFor serves a web wallpaper directory through /d/{token}/', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const dirPath = path.join(tmpDir, 'web-root');
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, 'index.html'), '<!doctype html><body>wp</body>');
    const item: DiscoveredItem = {
      ...(await imageItem('w')),
      type: 'web',
      dirPath,
      mediaPath: path.join(dirPath, 'index.html'),
    };
    const url = await registry.webUrlFor(item);
    expect(url).not.toBeNull();
    expect(url!.endsWith('index.html')).toBe(true);
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<body>wp</body>');
  });

  it('webUrlFor returns null for non-web/scene wallpapers', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const item = await imageItem('i');
    expect(await registry.webUrlFor(item)).toBeNull();
  });

  it('caches URLs per id (single registration for repeated calls)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    const item = await imageItem('c');
    const u1 = await registry.previewUrlForItem(item);
    const u2 = await registry.previewUrlForItem(item);
    expect(u1).toBe(u2);
  });
});

// ---------------------------------------------------------------------------
// MediaRegistry release
// ---------------------------------------------------------------------------
describe('MediaRegistry release', () => {
  it('keeps unregistering remaining tokens when one unregister throws', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    // Register three image previews (starts the real loopback server).
    const registry = new MediaRegistry();
    for (const id of ['a', 'b', 'c']) {
      const url = await registry.previewUrlForItem(await imageItem(id));
      expect(url).not.toBeNull();
    }

    // First unregister throws; the rest must still run (releaseAll is
    // best-effort per token — a single failure cannot leak the others).
    const unregisterSpy = vi.spyOn(wallpaperMediaServer, 'unregister');
    unregisterSpy.mockImplementationOnce(() => {
      throw new Error('server hiccup');
    });

    expect(() => registry.releaseAll()).not.toThrow();
    expect(unregisterSpy).toHaveBeenCalledTimes(3);
  });

  it('releaseForId unregisters only the given id and survives throws', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-registry-'));
    const registry = new MediaRegistry();
    for (const id of ['a', 'b']) {
      const url = await registry.previewUrlForItem(await imageItem(id));
      expect(url).not.toBeNull();
    }
    const unregisterSpy = vi.spyOn(wallpaperMediaServer, 'unregister');
    unregisterSpy.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    expect(() => registry.releaseForId('a')).not.toThrow();
    expect(unregisterSpy).toHaveBeenCalledTimes(1);

    // The other item's URL stays registered (and resolves from the cache).
    const urlB = await registry.previewUrlForItem(await imageItem('b'));
    expect(urlB).not.toBeNull();
  });
});
