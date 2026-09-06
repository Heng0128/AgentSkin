// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for WallpaperService (adapter.ts) — thin adapter that
 * coordinates scanning, preview caching, and media serving.
 *
 * Focuses on:
 *   - previewUrlFor: the critical file:// → http:// loopback conversion
 *   - list/rescan/warmupPreviewCache/deleteWallpaper: state coordination
 *   - scan idempotency
 */

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock definitions — vi.hoisted makes them available inside vi.mock factories
// (which are hoisted above all imports by the Vitest transformer).
// ---------------------------------------------------------------------------

const { mockPreviewCache, MockPreviewCache, mockMedia, MockMediaRegistry } = vi.hoisted(() => {
  const mockPreviewCache = {
    getL1Preview: vi.fn<(sourcePath: string, mtimeMs: number) => Promise<string | null>>(),
    warmup: vi.fn<(ids: string[], paths: Map<string, string>) => Promise<void>>(),
    invalidate: vi.fn<(id: string) => void>(),
    getL0Metadata:
      vi.fn<
        (item: { id: string; title?: string; type: string }) => {
          id: string;
          title: string;
          type: string;
        }
      >(),
  };

  class MockPreviewCache {
    getL1Preview = mockPreviewCache.getL1Preview;
    warmup = mockPreviewCache.warmup;
    invalidate = mockPreviewCache.invalidate;
    getL0Metadata = mockPreviewCache.getL0Metadata;
  }

  const mockMedia = {
    registerFile: vi.fn<(filePath: string, mime: string, id: string) => Promise<string | null>>(),
    previewUrlForItem: vi.fn<(item: unknown) => Promise<string | null>>(),
    videoUrlFor: vi.fn<(item: unknown) => Promise<string | null>>(),
    webUrlFor: vi.fn<(item: unknown) => Promise<string | null>>(),
    releaseForId: vi.fn<(id: string) => void>(),
    releaseAll: vi.fn<() => void>(),
  };

  class MockMediaRegistry {
    registerFile = mockMedia.registerFile;
    previewUrlForItem = mockMedia.previewUrlForItem;
    videoUrlFor = mockMedia.videoUrlFor;
    webUrlFor = mockMedia.webUrlFor;
    releaseForId = mockMedia.releaseForId;
    releaseAll = mockMedia.releaseAll;
  }

  return { mockPreviewCache, MockPreviewCache, mockMedia, MockMediaRegistry };
});

vi.mock('./preview-cache', () => ({
  PreviewCache: MockPreviewCache,
}));

vi.mock('./media-registry', () => ({
  MediaRegistry: MockMediaRegistry,
}));

vi.mock('../steam-path-resolver', () => ({
  resolveWorkshopRoot: vi.fn().mockResolvedValue(null),
}));

vi.mock('./we/scanner', () => ({
  scanWorkshop: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('./local/importer', () => ({
  scanCustomDir: vi.fn().mockResolvedValue(new Map()),
  importMedia: vi.fn<(src: string, dir: string) => Promise<{ id: string }>>(),
  deleteLocalWallpaperFile: vi.fn<(item: unknown, dir: string) => Promise<void>>(),
}));

// Import SUT after mocks are set up
import fs from 'node:fs/promises';
import type { WallpaperService } from './adapter';
import { WallpaperService as WallpaperServiceClass } from './adapter';

let service: WallpaperService;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-'));
  service = new WallpaperServiceClass();
  // Reset all mocks
  vi.clearAllMocks();
  // Default L0 metadata mock returns the item's own fields
  mockPreviewCache.getL0Metadata.mockImplementation(
    (item: { id: string; title?: string; type: string }) => ({
      id: item.id,
      title: item.title ?? item.id,
      type: item.type,
    }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = '';
});

/** Helper: create a minimal DiscoveredItem for testing. */
function makeItem(
  id: string,
  overrides: Partial<{
    previewPath: string | null;
    type: 'video' | 'image' | 'web' | 'scene';
    sizeBytes: number;
  }> = {},
): {
  id: string;
  title: string;
  type: 'video' | 'image' | 'web' | 'scene';
  projectType: string;
  playback: string;
  mediaPath: string;
  dirPath: string | null;
  pkgPath: string | null;
  previewPath: string | null;
  sizeBytes: number;
  tags: string[];
  source: 'workshop' | 'local';
  previewOnly: boolean;
} {
  return {
    id,
    title: id,
    type: overrides.type ?? 'image',
    projectType: overrides.type ?? 'image',
    playback: overrides.type ?? 'image',
    mediaPath: path.join(tmpDir, `${id}.png`),
    dirPath: null,
    pkgPath: null,
    previewPath: overrides.previewPath ?? path.join(tmpDir, `${id}-preview.png`),
    sizeBytes: overrides.sizeBytes ?? 1000,
    tags: [],
    source: 'local',
    previewOnly: false,
  };
}

// ---------------------------------------------------------------------------
// previewUrlFor — the critical file:// → http:// conversion
// ---------------------------------------------------------------------------

describe('WallpaperService.previewUrlFor', () => {
  it('returns null when id does not exist', async () => {
    service.setCustomDir(tmpDir);
    const url = await service.previewUrlFor('nonexistent');
    expect(url).toBeNull();
  });

  it('returns null when item.previewPath is null', async () => {
    service.setCustomDir(tmpDir);
    // Manually create item with null previewPath (makeItem's ?? would substitute default)
    const nullPreviewItem = {
      id: 'item1',
      title: 'item1',
      type: 'image' as const,
      projectType: 'image',
      playback: 'image',
      mediaPath: path.join(tmpDir, 'item1.png'),
      dirPath: null,
      pkgPath: null,
      previewPath: null,
      sizeBytes: 1000,
      tags: [],
      source: 'local' as const,
      previewOnly: false,
    };
    (service as unknown as { items: Map<string, typeof nullPreviewItem> }).items.set(
      'item1',
      nullPreviewItem,
    );
    (service as unknown as { scanned: boolean }).scanned = true;
    const url = await service.previewUrlFor('item1');
    expect(url).toBeNull();
  });

  it('converts file:// URL from PreviewCache to http:// loopback URL via registerFile', async () => {
    service.setCustomDir(tmpDir);

    // Create the preview file so fs.stat succeeds
    const item = makeItem('item1');
    await fs.writeFile(item.previewPath!, Buffer.from('preview-data'));

    // Setup: PreviewCache returns a properly formatted file:// URL
    const { pathToFileURL } = await import('node:url');
    const fakeFileUrl = pathToFileURL(path.join(tmpDir, 'cached.png')).href;
    mockPreviewCache.getL1Preview.mockResolvedValue(fakeFileUrl);
    mockMedia.registerFile.mockResolvedValue('http://127.0.0.1:3456/w?t=abc123');

    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'item1',
      item,
    );
    (service as unknown as { scanned: boolean }).scanned = true;

    const url = await service.previewUrlFor('item1');

    // The result should be the http:// URL from registerFile
    expect(url).toBe('http://127.0.0.1:3456/w?t=abc123');
    expect(mockMedia.registerFile).toHaveBeenCalledWith(
      expect.stringContaining('cached.png'),
      'image/png',
      'item1',
    );
    // previewUrlForItem should NOT be called when PreviewCache succeeds
    expect(mockMedia.previewUrlForItem).not.toHaveBeenCalled();
  });

  it('falls back to media.previewUrlForItem when PreviewCache returns null', async () => {
    service.setCustomDir(tmpDir);

    // Create the preview file so fs.stat succeeds
    const item = makeItem('item1');
    await fs.writeFile(item.previewPath!, Buffer.from('preview-data'));

    mockPreviewCache.getL1Preview.mockResolvedValue(null);
    mockMedia.previewUrlForItem.mockResolvedValue('http://127.0.0.1:3456/w?t=fallback');

    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'item1',
      item,
    );
    (service as unknown as { scanned: boolean }).scanned = true;

    const url = await service.previewUrlFor('item1');
    expect(url).toBe('http://127.0.0.1:3456/w?t=fallback');
    expect(mockMedia.previewUrlForItem).toHaveBeenCalled();
  });

  it('falls back to media server when PreviewCache stat fails', async () => {
    service.setCustomDir(tmpDir);

    // getL1Preview rejects (simulates stat failure)
    mockPreviewCache.getL1Preview.mockRejectedValue(new Error('ENOENT'));
    mockMedia.previewUrlForItem.mockResolvedValue('http://127.0.0.1:3456/w?t=error-fallback');

    const item = makeItem('item1');
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'item1',
      item,
    );
    (service as unknown as { scanned: boolean }).scanned = true;

    const url = await service.previewUrlFor('item1');
    expect(url).toBe('http://127.0.0.1:3456/w?t=error-fallback');
  });

  it('falls back to media server when fileURLToPath fails', async () => {
    service.setCustomDir(tmpDir);

    // Create the preview file so fs.stat succeeds
    const item = makeItem('item1');
    await fs.writeFile(item.previewPath!, Buffer.from('preview-data'));

    // PreviewCache returns an invalid URL that fileURLToPath can't parse
    mockPreviewCache.getL1Preview.mockResolvedValue('not-a-valid-url');
    mockMedia.previewUrlForItem.mockResolvedValue('http://127.0.0.1:3456/w?t=invalid-fallback');

    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'item1',
      item,
    );
    (service as unknown as { scanned: boolean }).scanned = true;

    const url = await service.previewUrlFor('item1');
    expect(url).toBe('http://127.0.0.1:3456/w?t=invalid-fallback');
  });
});

// ---------------------------------------------------------------------------
// list — returns L0 metadata with deferred previewUrl
// ---------------------------------------------------------------------------

describe('WallpaperService.list', () => {
  it('returns WallpaperInfo with previewUrl: null (deferred)', async () => {
    service.setCustomDir(tmpDir);
    const item1 = makeItem('item1', { sizeBytes: 500 });
    const item2 = makeItem('item2', { sizeBytes: 200 });
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'item1',
      item1,
    );
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'item2',
      item2,
    );

    const list = await service.list();
    expect(list).toHaveLength(2);
    // All previewUrl must be null (deferred to scroll-into-view)
    for (const info of list) {
      expect(info.previewUrl).toBeNull();
    }
  });

  it('returns items sorted by sizeBytes ascending', async () => {
    service.setCustomDir(tmpDir);
    const big = makeItem('big', { sizeBytes: 10000 });
    const small = makeItem('small', { sizeBytes: 100 });
    const medium = makeItem('medium', { sizeBytes: 1000 });
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'big',
      big,
    );
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'small',
      small,
    );
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'medium',
      medium,
    );

    const list = await service.list();
    expect(list.map((i) => i.id)).toEqual(['small', 'medium', 'big']);
  });
});

// ---------------------------------------------------------------------------
// rescan — clears state and invalidates cache
// ---------------------------------------------------------------------------

describe('WallpaperService.rescan', () => {
  it('clears items, invalidates cache, and releases all media', async () => {
    service.setCustomDir(tmpDir);
    const item = makeItem('theme:mytheme', { type: 'video' });
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'theme:mytheme',
      item,
    );
    // Mark as scanned
    (service as unknown as { scanned: boolean }).scanned = true;

    service.rescan();

    await expect(service.count()).resolves.toBe(0);
    expect(mockMedia.releaseAll).toHaveBeenCalled();
    expect(mockPreviewCache.invalidate).toHaveBeenCalledWith('theme:mytheme');
  });
});

// ---------------------------------------------------------------------------
// warmupPreviewCache — delegation
// ---------------------------------------------------------------------------

describe('WallpaperService.warmupPreviewCache', () => {
  it('delegates to previewCache.warmup when cache is initialized', async () => {
    service.setCustomDir(tmpDir);
    const itemIds = ['a', 'b', 'c'];
    const sourcePaths = new Map([
      ['a', '/path/a.png'],
      ['b', '/path/b.png'],
    ]);

    await service.warmupPreviewCache(itemIds, sourcePaths);
    expect(mockPreviewCache.warmup).toHaveBeenCalledWith(itemIds, sourcePaths);
  });

  it('is a no-op when previewCache is not initialized', async () => {
    // setCustomDir not called — previewCache is null
    await service.warmupPreviewCache(['a'], new Map());
    expect(mockPreviewCache.warmup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteWallpaper — only local: items
// ---------------------------------------------------------------------------

describe('WallpaperService.deleteWallpaper', () => {
  it('returns false for non-local ids (workshop:)', async () => {
    service.setCustomDir(tmpDir);
    const result = await service.deleteWallpaper('workshop:12345');
    expect(result).toBe(false);
    expect(mockMedia.releaseForId).not.toHaveBeenCalled();
  });

  it('returns false for non-existent local ids', async () => {
    service.setCustomDir(tmpDir);
    const result = await service.deleteWallpaper('local:nonexistent');
    expect(result).toBe(false);
  });

  it('deletes local item and calls media.releaseForId', async () => {
    service.setCustomDir(tmpDir);
    const item = makeItem('local:abc');
    (service as unknown as { items: Map<string, ReturnType<typeof makeItem>> }).items.set(
      'local:abc',
      item,
    );

    const result = await service.deleteWallpaper('local:abc');
    expect(result).toBe(true);
    expect(mockMedia.releaseForId).toHaveBeenCalledWith('local:abc');
    // Item should be removed
    expect((service as unknown as { items: Map<string, unknown> }).items.has('local:abc')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// scan — idempotency
// ---------------------------------------------------------------------------

describe('WallpaperService.scan', () => {
  it('only scans once on multiple calls', async () => {
    // Make resolveWorkshopRoot return a path so scanWorkshop is invoked
    vi.mocked(await import('../steam-path-resolver')).resolveWorkshopRoot.mockResolvedValue(
      '/mock/workshop',
    );

    // Re-create service to pick up the new mock
    service = new WallpaperServiceClass();
    service.setCustomDir(tmpDir);

    const scanWorkshopSpy = vi.fn().mockResolvedValue(new Map());
    const scanCustomDirSpy = vi.fn().mockResolvedValue(new Map());

    vi.mocked((await import('./we/scanner')).scanWorkshop).mockImplementation(scanWorkshopSpy);
    vi.mocked((await import('./local/importer')).scanCustomDir).mockImplementation(
      scanCustomDirSpy,
    );

    await service.scan();
    await service.scan();
    await service.scan();

    // Both scanners called exactly once — the scanned flag prevents re-scanning
    expect(scanWorkshopSpy).toHaveBeenCalledTimes(1);
    expect(scanCustomDirSpy).toHaveBeenCalledTimes(1);
  });
});
