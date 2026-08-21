// SPDX-License-Identifier: MPL-2.0

/**
 * # WallpaperService — Thin Adapter
 *
 * Implements {@link WallpaperServiceApi} by delegating to focused sub-modules
 * under `src/main/wallpaper/`:
 *
 *  - `we/scanner.ts` — Wallpaper Engine workshop scanning
 *  - `local/importer.ts` — local media import, scan, and deletion
 *  - `media-registry.ts` — loopback URL & token lifecycle management
 *  - `utils.ts` — MIME type & playback classification
 *
 * This class owns only state coordination (the items map, scanned flag, root
 * cache, customDir) and delegates all I/O and computation to the sub-modules.
 * This is the ONLY file that `main-context.ts` imports; all other consumers
 * depend on the `WallpaperServiceApi` interface from `services/contracts.ts`.
 *
 * The service is read-only with respect to the workshop library; it never
 * modifies or moves the user's files. Media is served in place over the
 * loopback wallpaper media server as streamable URLs.
 */

import fs from 'node:fs/promises';
import type { WallpaperInfo } from '../../shared/types';
import type { WallpaperServiceApi } from '../services/contracts';
import { resolveWorkshopRoot } from '../steam-path-resolver';
import { deleteLocalWallpaperFile, importMedia, scanCustomDir } from './local/importer';
import { MediaRegistry } from './media-registry';
import type { DiscoveredItem } from './types';
import { playbackFor } from './utils';
import { scanWorkshop } from './we/scanner';

export class WallpaperService implements WallpaperServiceApi {
  private root: string | null = null;
  private customDir: string | null = null;
  private items = new Map<string, DiscoveredItem>();
  private scanned = false;
  private media = new MediaRegistry();

  /** Set the user-data directory for locally imported wallpapers. */
  setCustomDir(dir: string): void {
    this.customDir = dir;
  }

  /**
   * Force a full rescan on the next list()/mediaPathFor() call. Picks up
   * newly installed workshop items or locally added files without an app
   * restart. Clears the preview cache since file contents may have changed.
   */
  rescan(): void {
    this.scanned = false;
    this.root = null;
    // Release theme: items individually (theme wallpapers need to be re-registered by the theme system)
    for (const [id] of this.items) {
      if (id.startsWith('theme:')) {
        this.media.releaseForId(id);
      }
    }
    this.items.clear();
    this.media.releaseAll();
  }

  /** Resolve the workshop content root (memoized). Returns null when not found. */
  private async resolveRoot(): Promise<string | null> {
    if (this.root !== null) return this.root === '' ? null : this.root;
    const workshopRoot = await resolveWorkshopRoot();
    this.root = workshopRoot ?? '';
    return workshopRoot;
  }

  /** Scan the workshop library and custom directory (idempotent). */
  async scan(): Promise<void> {
    if (this.scanned) return;
    this.scanned = true;

    // Scan Wallpaper Engine workshop
    const root = await this.resolveRoot();
    if (root) {
      const workshopItems = await scanWorkshop(root);
      for (const [id, item] of workshopItems) {
        this.items.set(id, item);
      }
    }

    // Scan user-imported local wallpapers
    if (this.customDir) {
      const localItems = await scanCustomDir(this.customDir);
      for (const [id, item] of localItems) {
        if (!this.items.has(id)) this.items.set(id, item);
      }
    }
  }

  /** List discovered wallpapers with streamable preview URLs. */
  async list(): Promise<WallpaperInfo[]> {
    await this.scan();
    const result: WallpaperInfo[] = [];
    for (const item of this.items.values()) {
      const previewUrl = await this.media.previewUrlForItem(item);
      result.push({
        id: item.id,
        title: item.title,
        type: item.type,
        projectType: item.projectType,
        playback: item.playback,
        previewUrl,
        sizeBytes: item.sizeBytes,
        tags: item.tags,
        source: item.source,
        previewOnly: item.previewOnly,
      });
    }
    // Smallest first so lightweight wallpapers surface at the top.
    result.sort((a, b) => a.sizeBytes - b.sizeBytes);
    return result;
  }

  /** Resolve the absolute preview image path for a wallpaper id, or null. */
  async previewPathFor(id: string): Promise<string | null> {
    await this.scan();
    const item = this.items.get(id);
    return item ? item.previewPath : null;
  }

  /**
   * Register a video bundled with a theme package so it can be used as a
   * dynamic wallpaper. The video file stays in the theme's package directory
   * (no copy) and is streamed to the UI on demand via `videoUrlFor`.
   */
  async registerThemeWallpaper(themeId: string, videoPath: string, title?: string): Promise<void> {
    let sizeBytes: number;
    try {
      sizeBytes = (await fs.stat(videoPath)).size;
    } catch {
      // R6-24: previously this swallowed the stat error silently, so a missing
      // theme video registered nothing with zero feedback to the caller. Log it
      // so theme-wallpaper registration failures are debuggable.
      console.warn(`[wallpaper] registerThemeWallpaper: missing video file "${videoPath}"`);
      return;
    }
    const id = `theme:${themeId}`;
    // Drop stale cached URLs so playback re-mints against the (possibly new) path.
    this.media.releaseForId(id);
    this.items.set(id, {
      id,
      title: title ?? themeId.replace(/[-_]/g, ' '),
      type: 'video',
      projectType: 'video',
      playback: playbackFor('video', videoPath),
      mediaPath: videoPath,
      dirPath: null,
      pkgPath: null,
      previewPath: null,
      sizeBytes,
      tags: ['theme'],
      source: 'local',
      previewOnly: false,
    });
  }

  /**
   * Import a media file (video or image) into the custom wallpapers directory.
   * Returns the new wallpaper id.
   * @throws {WallpaperImportError} when the extension is unsupported, the file
   *         does not exist, or the file exceeds the per-type size cap.
   */
  async importMedia(sourcePath: string): Promise<string> {
    if (!this.customDir) throw new Error('Wallpaper service not initialized');
    const item = await importMedia(sourcePath, this.customDir);
    this.items.set(item.id, item);
    return item.id;
  }

  /**
   * Delete a locally-imported wallpaper by id. Only items with the `local:`
   * prefix can be deleted; workshop items and theme-bundled videos are
   * read-only and silently skipped.
   */
  async deleteWallpaper(id: string): Promise<boolean> {
    if (!id.startsWith('local:')) return false;
    const item = this.items.get(id);
    if (!item) return false;
    if (this.customDir) {
      await deleteLocalWallpaperFile(item, this.customDir);
    }
    this.items.delete(id);
    this.media.releaseForId(id);
    return true;
  }

  /** Resolve the absolute media path for a wallpaper id, or null. */
  async mediaPathFor(id: string): Promise<string | null> {
    await this.scan();
    const item = this.items.get(id);
    return item ? item.mediaPath : null;
  }

  /** Resolve a streamable loopback URL for a wallpaper's video. */
  async videoUrlFor(id: string): Promise<string | null> {
    await this.scan();
    const item = this.items.get(id);
    if (!item) return null;
    return this.media.videoUrlFor(item);
  }

  /** Backward-compatible alias used by the protocol handler. */
  async videoPathFor(id: string): Promise<string | null> {
    return this.mediaPathFor(id);
  }

  /** Get the full media info for a wallpaper id. */
  async mediaInfoFor(id: string): Promise<{
    type: 'video' | 'image' | 'web' | 'scene';
    path: string;
    previewPath: string | null;
    previewOnly: boolean;
  } | null> {
    await this.scan();
    const item = this.items.get(id);
    if (!item) return null;
    return {
      type: item.type,
      path: item.mediaPath,
      previewPath: item.previewPath,
      previewOnly: item.previewOnly,
    };
  }

  /**
   * Resolve a loopback URL for web/scene wallpaper content. Returns null when
   * the wallpaper cannot be rendered — the injector treats that as a hard
   * failure (it never falls back to the low-res workshop preview thumbnail).
   */
  async webUrlFor(id: string): Promise<string | null> {
    await this.scan();
    const item = this.items.get(id);
    if (!item) return null;
    return this.media.webUrlFor(item);
  }

  /** Whether Wallpaper Engine's workshop directory was found on this machine. */
  async isInstalled(): Promise<boolean> {
    const root = await this.resolveRoot();
    return root !== null;
  }

  /** Number of discovered wallpapers. */
  async count(): Promise<number> {
    await this.scan();
    return this.items.size;
  }
}
