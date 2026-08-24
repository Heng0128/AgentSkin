// SPDX-License-Identifier: MPL-2.0

/**
 * # PreviewCache — Three-Tier Progressive Wallpaper Preview Loading
 *
 * Manages L0/L1/L2 preview loading for wallpaper grid cards:
 *
 *  - **L0 (metadata)**: KB-level, available immediately after scan.
 *    Title / type / author only — no image decoding.
 *  - **L1 (high-def preview)**: 1920px longest edge, generated on card
 *    scroll-into-view via Electron `nativeImage` resize. Cached to disk
 *    as PNG for instant reload on next launch.
 *  - **L2 (original)**: full-resolution source, loaded on detail-panel
 *    open via the existing `previewUrl` media-server path.
 *
 * ## Disk Cache Layout
 *
 * ```
 * <cacheDir>/
 *   <sha1(sourcePath:mtimeMs:tier)>.png   ← L1 preview file
 * ```
 *
 * The cache key embeds the source file's mtime so any modification
 * invalidates the cached preview without needing explicit invalidation.
 *
 * ## Format Note
 *
 * Electron's `nativeImage` does not expose a WebP encoder (only PNG /
 * JPEG / Bitmap). We use PNG for L1 output — lossless, universally
 * decodable, and acceptable size at 1920px. If WebP support lands in
 * a future Electron version, swap `toPNG()` → `toWebp()` at the single
 * call site below.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeImage } from 'electron';
import { mainWarnFromCatch } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry {
  /** Cache key — sha1(sourcePath:mtimeMs:tier). */
  key: string;
  /** Absolute path to the cached PNG file on disk. */
  filePath: string;
  /** File size in bytes (for LRU accounting). */
  sizeBytes: number;
  /** Last access timestamp (ms since epoch) for LRU eviction. */
  lastAccess: number;
}

interface PreviewMetadata {
  id: string;
  title: string;
  type: string;
  width?: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of entries tracked in the in-memory index. */
const MAX_MEMORY_ENTRIES = 200;

/** Maximum total disk cache size in bytes (200 MB). */
const MAX_DISK_BYTES = 200 * 1024 * 1024;

/** L1 preview longest-edge target in pixels. */
const L1_MAX_EDGE = 1920;

/** Max concurrent L1 generation tasks during warmup (avoids UI jank). */
const WARMUP_CONCURRENCY = 2;

/** Max number of wallpapers to warm up in a single pass (visible viewport cap). */
const WARMUP_BATCH_LIMIT = 30;

/** PNG output quality is lossless — no quality parameter needed. */
const SCOPE = 'PreviewCache';

// ---------------------------------------------------------------------------
// PreviewCache class
// ---------------------------------------------------------------------------

export class PreviewCache {
  private memoryIndex = new Map<string, CacheEntry>();
  private diskUsageBytes = 0;
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Resolve an L1 (1920px) preview for a wallpaper source image.
   *
   * Resolution order:
   *   1. In-memory index hit → return cached `file://` URL, bump LRU.
   *   2. Disk cache hit → add to memory index, return `file://` URL.
   *   3. Miss → decode source with `nativeImage`, resize to 1920px,
   *      write PNG to disk, add to memory index, return `file://` URL.
   *
   * Returns `null` when the source cannot be decoded or resized.
   */
  async getL1Preview(sourcePath: string, mtimeMs: number): Promise<string | null> {
    return this.getOrGenerateL1(sourcePath, mtimeMs);
  }

  /**
   * Combined L1 query + generate logic shared by on-demand loading
   * (`getL1Preview`) and background warmup (`warmup`).
   *
   * Checks the in-memory index first, then disk, then generates a new PNG
   * preview on miss. Returns the `file://` URL of the cached preview or
   * `null` when the source cannot be decoded.
   */
  async getOrGenerateL1(sourcePath: string, mtimeMs: number): Promise<string | null> {
    const key = this.computeKey(sourcePath, mtimeMs, 'L1');

    // 1. Memory cache hit.
    const memEntry = this.memoryIndex.get(key);
    if (memEntry) {
      memEntry.lastAccess = Date.now();
      return pathToFileURL(memEntry.filePath).href;
    }

    // 2. Disk cache hit.
    const diskPath = this.cachePathForKey(key);
    try {
      const stat = await fs.stat(diskPath);
      if (stat.isFile()) {
        const entry: CacheEntry = {
          key,
          filePath: diskPath,
          sizeBytes: stat.size,
          lastAccess: Date.now(),
        };
        this.memoryIndex.set(key, entry);
        this.diskUsageBytes += stat.size;
        this.enforceMemoryCap();
        return pathToFileURL(diskPath).href;
      }
    } catch {
      // File doesn't exist — fall through to generation.
    }

    // 3. Generate preview.
    // Skip formats that Electron nativeImage cannot decode (GIF, WebP, SVG).
    // The caller falls back to the media-server loopback URL where the
    // browser's <img> renders these formats natively.
    const ext = path.extname(sourcePath).toLowerCase();
    const NATIVE_IMAGE_DECODABLE = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.ico']);
    if (!NATIVE_IMAGE_DECODABLE.has(ext)) {
      mainWarnFromCatch(
        SCOPE,
        `Skipping L1 generation for unsupported format (${ext}): ${sourcePath}`,
      );
      return null;
    }

    try {
      const source = nativeImage.createFromPath(sourcePath);
      if (source.isEmpty()) {
        mainWarnFromCatch(SCOPE, `nativeImage failed to decode: ${sourcePath}`);
        return null;
      }

      const size = source.getSize();
      if (size.width <= 0 || size.height <= 0) {
        mainWarnFromCatch(SCOPE, `Invalid image dimensions for: ${sourcePath}`);
        return null;
      }

      // Scale longest edge down to L1_MAX_EDGE (never upscale).
      const scale = Math.min(1, L1_MAX_EDGE / Math.max(size.width, size.height));
      const targetWidth = Math.max(1, Math.round(size.width * scale));
      const targetHeight = Math.max(1, Math.round(size.height * scale));

      const resized = source.resize({ width: targetWidth, height: targetHeight });
      if (resized.isEmpty()) {
        mainWarnFromCatch(SCOPE, `Resize returned empty image for: ${sourcePath}`);
        return null;
      }

      const pngBuffer = resized.toPNG();
      if (!pngBuffer || pngBuffer.length === 0) {
        mainWarnFromCatch(SCOPE, `toPNG returned empty buffer for: ${sourcePath}`);
        return null;
      }

      // Ensure cache directory exists and write atomically (write → rename).
      await fs.mkdir(this.cacheDir, { recursive: true });
      const tmpPath = `${diskPath}.tmp`;
      await fs.writeFile(tmpPath, pngBuffer);
      await fs.rename(tmpPath, diskPath);

      const entry: CacheEntry = {
        key,
        filePath: diskPath,
        sizeBytes: pngBuffer.length,
        lastAccess: Date.now(),
      };
      this.memoryIndex.set(key, entry);
      this.diskUsageBytes += pngBuffer.length;

      this.enforceMemoryCap();
      await this.evictIfNeeded();

      return pathToFileURL(diskPath).href;
    } catch (error) {
      mainWarnFromCatch(SCOPE, error, 'L1 preview generation failed');
      return null;
    }
  }

  /**
   * 后台预热指定壁纸的 L1 预览图
   *
   * Called during app boot (after `runWarmUp`) to pre-generate high-def
   * previews for the wallpapers most likely to be visible in the grid.
   *
   * Design:
   * - Iterates `itemIds` in priority order (visible-first).
   * - Checks L1 cache (memory → disk) before generating.
   * - Limits concurrency to {@link WARMUP_CONCURRENCY} to avoid I/O storms.
   * - Yields to the event loop via `setImmediate` between items so the main
   *   thread stays responsive.
   * - Individual failures are swallowed — the on-demand path
   *   (`getL1Preview`) will retry when the card scrolls into view.
   *
   * @param itemIds - Ordered list of wallpaper ids to warm up (visible first).
   * @param sourcePaths - Map of wallpaper id → absolute preview-source path.
   */
  async warmup(itemIds: string[], sourcePaths: Map<string, string>): Promise<void> {
    // Cap batch size to avoid overloading the first paint of the wallpaper page.
    const ids = itemIds.slice(0, WARMUP_BATCH_LIMIT);
    if (ids.length === 0) return;

    const CONCURRENCY = WARMUP_CONCURRENCY;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        // Atomically grab the next index so two workers never process the
        // same item.
        const idx = cursor++;
        if (idx >= ids.length) return;

        const id = ids[idx];
        const sourcePath = sourcePaths.get(id);
        if (!sourcePath) continue;

        try {
          const stat = await fs.stat(sourcePath);
          await this.getOrGenerateL1(sourcePath, stat.mtimeMs);
        } catch {
          // Source missing / inaccessible / decode failure — skip silently.
          // The on-demand path (getL1Preview → previewUrlFor) retries when
          // the card actually scrolls into view.
        }

        // Yield to the event loop so the main thread stays responsive.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
  }

  /**
   * Return L0 metadata (synchronous — no image loading).
   *
   * This is a pure transform: the caller already has the `DiscoveredItem`
   * fields in memory from the scan. We just normalize them into the
   * `PreviewMetadata` shape.
   */
  getL0Metadata(item: { id: string; title?: string; type: string }): PreviewMetadata {
    return {
      id: item.id,
      title: item.title ?? item.id,
      type: item.type,
    };
  }

  /**
   * Evict least-recently-used entries until disk usage is under the cap.
   *
   * Sorts the memory index by `lastAccess` ascending and deletes the oldest
   * entries (both disk file and index entry) until `diskUsageBytes` is below
   * `MAX_DISK_BYTES`.
   */
  async evictIfNeeded(): Promise<void> {
    if (this.diskUsageBytes <= MAX_DISK_BYTES) return;

    const entries = [...this.memoryIndex.values()].sort((a, b) => a.lastAccess - b.lastAccess);

    for (const entry of entries) {
      if (this.diskUsageBytes <= MAX_DISK_BYTES) break;

      // Remove from index first so a concurrent getL1Preview can't
      // reference a file we're about to delete.
      this.memoryIndex.delete(entry.key);
      this.diskUsageBytes -= entry.sizeBytes;

      try {
        await fs.unlink(entry.filePath);
      } catch {
        // File already gone — nothing to clean up.
      }
    }
  }

  /**
   * Invalidate all cache entries whose key contains the given wallpaper id.
   *
   * Because the cache key is `sha1(sourcePath:mtimeMs:tier)` and the source
   * path embeds the wallpaper id, we match on substring. This is a best-
   * effort cleanup — if the id doesn't appear in the key, the entry will
   * naturally age out via LRU.
   */
  invalidate(id: string): void {
    for (const [key, entry] of this.memoryIndex) {
      if (key.includes(id) || entry.filePath.includes(id)) {
        this.memoryIndex.delete(key);
        this.diskUsageBytes -= entry.sizeBytes;
        fs.unlink(entry.filePath).catch(() => {});
      }
    }
  }

  /**
   * Initialize the cache directory. Must be called before any getL1Preview
   * call in production (getL1Preview also mkdirs on first write, but calling
   * this explicitly during boot gives a clear failure point if the
   * directory cannot be created).
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Compute a deterministic cache key from source path, mtime, and tier.
   *
   * Embedding `mtimeMs` ensures that any file modification produces a new
   * key, so stale previews are never served after the source changes.
   */
  private computeKey(sourcePath: string, mtimeMs: number, tier: string): string {
    return createHash('sha1').update(`${sourcePath}:${mtimeMs}:${tier}`).digest('hex');
  }

  /** Map a cache key to its on-disk PNG path. */
  private cachePathForKey(key: string): string {
    return path.join(this.cacheDir, `${key}.png`);
  }

  /**
   * Trim the in-memory index to `MAX_MEMORY_ENTRIES` by evicting the
   * least-recently-used entries. Does NOT delete disk files — those are
   * reclaimed by `evictIfNeeded()` based on actual disk usage.
   */
  private enforceMemoryCap(): void {
    if (this.memoryIndex.size <= MAX_MEMORY_ENTRIES) return;

    const entries = [...this.memoryIndex.values()].sort((a, b) => a.lastAccess - b.lastAccess);
    const toRemove = entries.slice(0, this.memoryIndex.size - MAX_MEMORY_ENTRIES);
    for (const entry of toRemove) {
      this.memoryIndex.delete(entry.key);
    }
  }
}
