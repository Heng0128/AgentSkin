// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for PreviewCache — three-tier progressive wallpaper preview
 * loading (L0/L1/L2). Covers memory/disk cache hits, format filtering,
 * L0 metadata, invalidation, and cache initialization.
 *
 * Note: Electron's nativeImage API is mocked because the test environment
 * is Node.js (not a full Electron renderer). We simulate a minimal NativeImage
 * that supports resize/getSize/isEmpty/toPNG.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Electron nativeImage — simulates a minimal NativeImage that supports
// the surface area used by PreviewCache (createFromPath, resize, getSize,
// isEmpty, toPNG).
// ---------------------------------------------------------------------------

const createMockNativeImage = (width: number, height: number) => ({
  isEmpty: () => false,
  getSize: () => ({ width, height }),
  resize: (opts: { width: number; height: number }) =>
    createMockNativeImage(opts.width, opts.height),
  toPNG: () => Buffer.from('mock-png-data'),
  toDataURL: () => 'data:image/png;base64,mock',
});

// Mock the electron module — must be at top level for hoisting
vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: vi.fn().mockImplementation(() => createMockNativeImage(100, 100)),
    createFromBuffer: vi.fn().mockImplementation(() => createMockNativeImage(100, 100)),
  },
}));

// Import SUT after mock is set up
import { PreviewCache } from './preview-cache';

let tmpDir: string;
let cacheDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-cache-'));
  cacheDir = path.join(tmpDir, 'cache');
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = '';
  cacheDir = '';
});

// ---------------------------------------------------------------------------
// getL1Preview / getOrGenerateL1 — cache resolution
// ---------------------------------------------------------------------------

describe('PreviewCache L1 resolution', () => {
  it('does not call createFromPath for unsupported formats (no extension)', async () => {
    const cache = new PreviewCache(cacheDir);
    const { nativeImage } = await import('electron');
    const mockedCreateFromPath = vi.mocked(nativeImage.createFromPath);

    // A file without extension returns null because '' is not in the decodable set
    const filePath = path.join(tmpDir, 'noext');
    await fs.writeFile(filePath, Buffer.from('data'));
    mockedCreateFromPath.mockClear();

    const result = await cache.getL1Preview(filePath, 1000);

    expect(result).toBeNull();
    expect(mockedCreateFromPath).not.toHaveBeenCalled();
  });

  it('returns a file:// URL on successful PNG generation', async () => {
    const cache = new PreviewCache(cacheDir);
    const sourcePath = path.join(tmpDir, 'source.png');
    await fs.writeFile(sourcePath, Buffer.from('png-data'));

    const url = await cache.getL1Preview(sourcePath, 1000);
    expect(url).not.toBeNull();
    expect(url).toMatch(/^file:\/\//);

    // Verify nativeImage.createFromPath WAS called
    const { nativeImage } = await import('electron');
    expect(nativeImage.createFromPath).toHaveBeenCalledWith(sourcePath);
  });

  it('memory cache hit returns the same URL without re-reading disk', async () => {
    const cache = new PreviewCache(cacheDir);
    const sourcePath = path.join(tmpDir, 'source.png');
    await fs.writeFile(sourcePath, Buffer.from('png-data'));

    const url1 = await cache.getL1Preview(sourcePath, 1000);
    expect(url1).not.toBeNull();

    // Spy on fs.stat to verify it's NOT called on memory hit
    const statSpy = vi.spyOn(fs, 'stat');
    const url2 = await cache.getL1Preview(sourcePath, 1000);

    expect(url2).toBe(url1);
    expect(statSpy).not.toHaveBeenCalled();
    statSpy.mockRestore();
  });

  it('disk cache hit after memory eviction returns the same URL', async () => {
    const cache = new PreviewCache(cacheDir);
    const sourcePath = path.join(tmpDir, 'source.png');
    await fs.writeFile(sourcePath, Buffer.from('png-data'));

    // First call populates memory + disk
    const url1 = await cache.getL1Preview(sourcePath, 1000);
    expect(url1).not.toBeNull();

    // Invalidate from memory using the cacheDir substring (which appears in filePath)
    cache.invalidate(cacheDir);

    // Second call should hit disk cache
    const url2 = await cache.getL1Preview(sourcePath, 1000);
    expect(url2).toBe(url1);
  });

  it('different mtime produces different cache keys (no stale preview)', async () => {
    const cache = new PreviewCache(cacheDir);
    const sourcePath = path.join(tmpDir, 'source.png');
    await fs.writeFile(sourcePath, Buffer.from('png-data'));

    const url1 = await cache.getL1Preview(sourcePath, 1000);
    const url2 = await cache.getL1Preview(sourcePath, 2000);

    // Different mtime → different cache key → different file paths
    expect(url1).not.toBe(url2);
  });
});

// ---------------------------------------------------------------------------
// getL0Metadata — synchronous metadata
// ---------------------------------------------------------------------------

describe('PreviewCache L0 metadata', () => {
  it('returns normalized metadata with title', () => {
    const cache = new PreviewCache(cacheDir);
    const meta = cache.getL0Metadata({ id: 'w1', title: 'Aurora', type: 'video' });
    expect(meta).toEqual({ id: 'w1', title: 'Aurora', type: 'video' });
  });

  it('falls back to id when title is missing', () => {
    const cache = new PreviewCache(cacheDir);
    const meta = cache.getL0Metadata({ id: 'w2', type: 'image' });
    expect(meta.title).toBe('w2');
  });
});

// ---------------------------------------------------------------------------
// invalidate — best-effort cleanup
// ---------------------------------------------------------------------------

describe('PreviewCache invalidate', () => {
  it('removes entries whose filePath contains the id substring', async () => {
    const cache = new PreviewCache(cacheDir);
    const sourcePath = path.join(tmpDir, 'test.png');
    await fs.writeFile(sourcePath, Buffer.from('png-data'));

    // Generate a cache entry
    const url = await cache.getL1Preview(sourcePath, 1000);
    expect(url).not.toBeNull();

    // Invalidate using a substring that appears in the filePath
    // The filePath is <cacheDir>/<hash>.png, so cacheDir is a valid substring
    cache.invalidate(cacheDir);

    // The disk unlink inside invalidate() is fire-and-forget. While it is
    // still pending, a getL1Preview call hits the stale disk cache and
    // re-adds the entry to the memory index — from that point every further
    // call is a memory hit and the regeneration path (createFromPath) is
    // masked forever. So wait for the disk file to actually disappear
    // (readdir poll, bounded) BEFORE triggering regeneration: after that
    // the call is a memory miss + disk miss and must regenerate.
    await vi.waitFor(
      async () => {
        const files = await fs.readdir(cacheDir).catch(() => [] as string[]);
        expect(files.filter((f) => f.endsWith('.png') && !f.endsWith('.tmp'))).toEqual([]);
      },
      { timeout: 5000, interval: 50 },
    );

    const { nativeImage } = await import('electron');
    const mockedCreateFromPath = vi.mocked(nativeImage.createFromPath);
    mockedCreateFromPath.mockClear();

    const url2 = await cache.getL1Preview(sourcePath, 1000);
    expect(url2).not.toBeNull();
    expect(mockedCreateFromPath).toHaveBeenCalled();
  }, 10000);
});

// ---------------------------------------------------------------------------
// initialize — directory creation
// ---------------------------------------------------------------------------

describe('PreviewCache initialize', () => {
  it('creates the cache directory recursively', async () => {
    const nestedDir = path.join(tmpDir, 'deep', 'nested', 'cache');
    const cache = new PreviewCache(nestedDir);
    await cache.initialize();
    await expect(fs.access(nestedDir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeKey — deterministic hashing
// ---------------------------------------------------------------------------

describe('PreviewCache computeKey', () => {
  it('produces deterministic keys for the same input (memory hit)', async () => {
    const cache = new PreviewCache(cacheDir);
    const sourcePath = path.join(tmpDir, 'source.png');
    await fs.writeFile(sourcePath, Buffer.from('png-data'));

    // Generate once
    const url1 = await cache.getL1Preview(sourcePath, 5000);
    expect(url1).not.toBeNull();

    // Spy on fs.stat to verify memory cache hit (no disk stat)
    const statSpy = vi.spyOn(fs, 'stat');
    const url2 = await cache.getL1Preview(sourcePath, 5000);

    expect(url1).toBe(url2);
    expect(statSpy).not.toHaveBeenCalled(); // Memory hit, no disk stat
    statSpy.mockRestore();
  });

  it('produces different keys for different source paths', async () => {
    const cache = new PreviewCache(cacheDir);
    const path1 = path.join(tmpDir, 'a.png');
    const path2 = path.join(tmpDir, 'b.png');
    await fs.writeFile(path1, Buffer.from('png-data'));
    await fs.writeFile(path2, Buffer.from('png-data'));

    const url1 = await cache.getL1Preview(path1, 1000);
    const url2 = await cache.getL1Preview(path2, 1000);

    expect(url1).not.toBe(url2);
  });
});
