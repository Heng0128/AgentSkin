// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WallpaperInfo } from '../shared/types';
import type { WallpaperServiceApi } from './services/contracts';

/** Wallpaper Engine's Steam app id is 431960; workshop items live under content/431960. */
const WE_APP_ID = '431960';

/** Custom protocol used to stream wallpaper videos into the sandboxed renderer. */
export const WALLPAPER_SCHEME = 'agentskin-wallpaper';

/** Video extensions accepted for local import. */
const IMPORTABLE_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi']);

/** Image extensions for static wallpapers. */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif']);

/** All extensions accepted for local import (video + image). */
const ALL_IMPORTABLE_EXTENSIONS = new Set<string>([...IMPORTABLE_EXTENSIONS, ...IMAGE_EXTENSIONS]);

export function wallpaperUrlFor(id: string): string {
  return `${WALLPAPER_SCHEME}://media/${id}`;
}

interface DiscoveredItem {
  id: string;
  title: string;
  type: 'video' | 'image';
  /** Absolute path to the media file (video or image). */
  mediaPath: string;
  previewPath: string | null;
  sizeBytes: number;
  tags: string[];
  source: 'workshop' | 'local';
}

/**
 * Candidate Wallpaper Engine workshop content roots. The first existing one is
 * used. Covers the default 32-bit and 64-bit Steam install locations on Windows
 * plus the standard macOS location.
 */
function candidateWorkshopRoots(): string[] {
  const roots: string[] = [];
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    roots.push(path.join(pf86, 'Steam', 'steamapps', 'workshop', 'content', WE_APP_ID));
    roots.push(path.join(pf, 'Steam', 'steamapps', 'workshop', 'content', WE_APP_ID));
  } else if (process.platform === 'darwin') {
    roots.push(
      path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'Steam',
        'steamapps',
        'workshop',
        'content',
        WE_APP_ID,
      ),
    );
  } else {
    roots.push(
      path.join(os.homedir(), '.steam', 'steam', 'steamapps', 'workshop', 'content', WE_APP_ID),
    );
    roots.push(
      path.join(
        os.homedir(),
        '.local',
        'share',
        'Steam',
        'steamapps',
        'workshop',
        'content',
        WE_APP_ID,
      ),
    );
  }
  return roots;
}

const PREVIEW_CANDIDATES = ['preview.jpg', 'preview.png', 'preview.gif'] as const;

function mimeForPreview(file: string): string {
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * # WallpaperService
 *
 * Discovers wallpapers installed through Wallpaper Engine's Steam workshop
 * library and serves them to the renderer. Three categories are recognized:
 * - `type: "video"` — streamed as `<video>` backgrounds.
 * - `type: "image"` — served as `<img>` backgrounds.
 * - `type: "scene"` / `"web"` / empty — the most common types in Wallpaper
 *   Engine. These are scene-based (parallax/image) or HTML wallpapers whose
 *   internal format is proprietary. The preview image (preview.jpg/png/gif) is
 *   used as a static image wallpaper so the user can still see and apply them.
 *
 * The service is read-only with respect to the workshop library; it never
 * modifies or moves the user's files. Media is streamed in place via the
 * {@link WALLPAPER_SCHEME} protocol.
 */
export class WallpaperService implements WallpaperServiceApi {
  private root: string | null = null;
  private customDir: string | null = null;
  private items = new Map<string, DiscoveredItem>();
  private scanned = false;

  /** Set the user-data directory for locally imported wallpapers. */
  setCustomDir(dir: string): void {
    this.customDir = dir;
  }

  /** Resolve the workshop content root (memoized). Returns null when not found. */
  private async resolveRoot(): Promise<string | null> {
    if (this.root !== null) return this.root === '' ? null : this.root;
    for (const candidate of candidateWorkshopRoots()) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) {
          this.root = candidate;
          return candidate;
        }
      } catch {
        // not present — try next candidate
      }
    }
    this.root = '';
    return null;
  }

  /** Scan the custom (user-imported) wallpapers directory. */
  private async scanCustomDir(): Promise<void> {
    if (!this.customDir) return;
    let entries: string[];
    try {
      entries = await fs.readdir(this.customDir);
    } catch {
      return;
    }
    for (const file of entries) {
      const ext = path.extname(file).toLowerCase();
      const isVideo = IMPORTABLE_EXTENSIONS.has(ext);
      const isImage = IMAGE_EXTENSIONS.has(ext);
      if (!isVideo && !isImage) continue;
      const mediaPath = path.join(this.customDir, file);
      try {
        const stat = await fs.stat(mediaPath);
        if (!stat.isFile()) continue;
        const id = `local:${file}`;
        if (this.items.has(id)) continue;
        this.items.set(id, {
          id,
          title: path.basename(file, ext).replace(/[-_]/g, ' '),
          type: isVideo ? 'video' : 'image',
          mediaPath,
          // For image wallpapers, use the image itself as preview.
          previewPath: isImage ? mediaPath : null,
          sizeBytes: stat.size,
          tags: ['local'],
          source: 'local',
        });
      } catch {
        // skip unreadable files
      }
    }
  }

  /** Scan the workshop library for video and image wallpapers (idempotent). */
  async scan(): Promise<void> {
    if (this.scanned) return;
    this.scanned = true;

    // Scan Wallpaper Engine workshop
    const root = await this.resolveRoot();
    if (root) {
      let entries: string[];
      try {
        entries = await fs.readdir(root);
      } catch {
        entries = [];
      }

      for (const entry of entries) {
        const dir = path.join(root, entry);
        const projectFile = path.join(dir, 'project.json');
        try {
          const raw = await fs.readFile(projectFile, 'utf8');
          const project = JSON.parse(raw) as {
            type?: string;
            file?: string;
            title?: string;
            tags?: string[];
          };

          const projectType = typeof project.type === 'string' ? project.type.toLowerCase() : '';

          // Find the first available preview image.
          let previewPath: string | null = null;
          for (const candidate of PREVIEW_CANDIDATES) {
            const p = path.join(dir, candidate);
            const s = await fs.stat(p).catch(() => null);
            if (s && s.isFile()) {
              previewPath = p;
              break;
            }
          }

          let type: 'video' | 'image' | null = null;
          let mediaPath: string | null = null;
          let sizeBytes = 0;

          if (projectType === 'video' && typeof project.file === 'string') {
            // Direct video wallpaper — stream the video file.
            type = 'video';
            mediaPath = path.join(dir, project.file);
          } else if (projectType === 'image' && typeof project.file === 'string') {
            // Direct image wallpaper.
            type = 'image';
            mediaPath = path.join(dir, project.file);
          } else if (typeof project.file === 'string') {
            // Infer type from file extension when project.type is missing/unusual.
            const ext = path.extname(project.file).toLowerCase();
            if (IMPORTABLE_EXTENSIONS.has(ext)) {
              type = 'video';
              mediaPath = path.join(dir, project.file);
            } else if (IMAGE_EXTENSIONS.has(ext)) {
              type = 'image';
              mediaPath = path.join(dir, project.file);
            }
          }

          // For scene / web / unrecognized types (or when project.file is
          // missing/invalid): scan the directory for video files. Many "scene"
          // wallpapers ship .mp4/.webm assets that ARE the animated content.
          if (
            !type ||
            (type === 'video' &&
              mediaPath &&
              !(await fs.stat(mediaPath).catch(() => null))?.isFile())
          ) {
            type = null;
            mediaPath = null;
            try {
              const dirFiles = await fs.readdir(dir);
              // Prefer larger video files (main content) over small clips.
              let bestVideo: { file: string; size: number } | null = null;
              for (const f of dirFiles) {
                const ext = path.extname(f).toLowerCase();
                if (!IMPORTABLE_EXTENSIONS.has(ext)) continue;
                const fp = path.join(dir, f);
                const st = await fs.stat(fp).catch(() => null);
                if (st && st.isFile() && (!bestVideo || st.size > bestVideo.size)) {
                  bestVideo = { file: fp, size: st.size };
                }
              }
              if (bestVideo) {
                type = 'video';
                mediaPath = bestVideo.file;
                sizeBytes = bestVideo.size;
              }
            } catch {
              // directory unreadable — fall through to preview fallback
            }
          }

          // Scene / web / empty-type wallpapers with no video asset: use the
          // preview as fallback. GIF previews are animated → mark as 'video'
          // (dynamic); JPG/PNG previews are truly static → mark as 'image'.
          if (!type && previewPath) {
            const previewExt = path.extname(previewPath).toLowerCase();
            if (previewExt === '.gif') {
              type = 'video';
            } else {
              type = 'image';
            }
            mediaPath = previewPath;
          }

          if (!type || !mediaPath) continue;

          const mediaStat = await fs.stat(mediaPath).catch(() => null);
          if (!mediaStat || !mediaStat.isFile()) continue;
          sizeBytes = mediaStat.size;

          // For image wallpapers, use the image itself as preview if no dedicated preview.
          if (!previewPath && type === 'image') previewPath = mediaPath;

          this.items.set(entry, {
            id: entry,
            title: typeof project.title === 'string' && project.title ? project.title : entry,
            type,
            mediaPath,
            previewPath,
            sizeBytes,
            tags: Array.isArray(project.tags)
              ? project.tags.filter((t) => typeof t === 'string')
              : [],
            source: 'workshop',
          });
        } catch {
          // No project.json or malformed — try bare image files in the folder.
          try {
            const files = await fs.readdir(dir);
            const imageFile = files.find((f) =>
              IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()),
            );
            if (imageFile) {
              const mediaPath = path.join(dir, imageFile);
              const mediaStat = await fs.stat(mediaPath).catch(() => null);
              if (mediaStat && mediaStat.isFile()) {
                this.items.set(entry, {
                  id: entry,
                  title: entry,
                  type: 'image',
                  mediaPath,
                  previewPath: mediaPath,
                  sizeBytes: mediaStat.size,
                  tags: [],
                  source: 'workshop',
                });
              }
            }
          } catch {
            // Skip unreadable directories.
          }
        }
      }
    }

    // Scan user-imported local wallpapers
    await this.scanCustomDir();
  }

  /** List discovered wallpapers with base64 preview data URLs. */
  async list(): Promise<WallpaperInfo[]> {
    await this.scan();
    const result: WallpaperInfo[] = [];
    for (const item of this.items.values()) {
      let previewDataUrl: string | null = null;
      if (item.previewPath) {
        try {
          const bytes = await fs.readFile(item.previewPath);
          previewDataUrl = `data:${mimeForPreview(item.previewPath)};base64,${bytes.toString('base64')}`;
        } catch {
          previewDataUrl = null;
        }
      }
      result.push({
        id: item.id,
        title: item.title,
        type: item.type,
        // Expose the streaming URL for both video and image types — the
        // protocol handler serves any media file, and the UI picks <video>
        // or <img> based on `type`.
        videoUrl: wallpaperUrlFor(item.id),
        previewDataUrl,
        sizeBytes: item.sizeBytes,
        tags: item.tags,
        source: item.source,
      });
    }
    // Smallest first so lightweight wallpapers surface at the top.
    result.sort((a, b) => a.sizeBytes - b.sizeBytes);
    return result;
  }

  /**
   * Register a video bundled with a theme package so it can be used as a
   * dynamic wallpaper. The video file stays in the theme's package directory
   * (no copy) and is streamed in place via the agentskin-wallpaper:// protocol.
   *
   * The wallpaper id is `theme:{themeId}` so the UI can reference it
   * deterministically. Re-registering (e.g. on reseed) updates the path.
   */
  async registerThemeWallpaper(themeId: string, videoPath: string, title?: string): Promise<void> {
    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(videoPath)).size;
    } catch {
      // File doesn't exist — skip registration silently.
      return;
    }
    const id = `theme:${themeId}`;
    this.items.set(id, {
      id,
      title: title ?? themeId.replace(/[-_]/g, ' '),
      type: 'video',
      mediaPath: videoPath,
      previewPath: null,
      sizeBytes,
      tags: ['theme'],
      source: 'local',
    });
  }

  /**
   * Import a media file (video or image) into the custom wallpapers directory.
   * Copies the file (does not move) so the original stays intact.
   * Returns the new wallpaper id, or null if the extension is unsupported.
   */
  async importMedia(sourcePath: string): Promise<string | null> {
    const ext = path.extname(sourcePath).toLowerCase();
    const isVideo = IMPORTABLE_EXTENSIONS.has(ext);
    const isImage = IMAGE_EXTENSIONS.has(ext);
    if (!isVideo && !isImage) return null;
    if (!this.customDir) return null;

    await fs.mkdir(this.customDir, { recursive: true });
    const fileName = path.basename(sourcePath);
    const destPath = path.join(this.customDir, fileName);

    // Avoid overwriting: append a suffix if the file already exists.
    let finalPath = destPath;
    let counter = 1;
    while (true) {
      try {
        await fs.stat(finalPath);
        const base = path.basename(sourcePath, ext);
        finalPath = path.join(this.customDir, `${base} (${counter})${ext}`);
        counter++;
      } catch {
        break; // does not exist — safe to write
      }
    }

    await fs.copyFile(sourcePath, finalPath);

    // Register immediately without a full rescan.
    const id = `local:${path.basename(finalPath)}`;
    const stat = await fs.stat(finalPath);
    this.items.set(id, {
      id,
      title: path.basename(finalPath, ext).replace(/[-_]/g, ' '),
      type: isVideo ? 'video' : 'image',
      mediaPath: finalPath,
      previewPath: isImage ? finalPath : null,
      sizeBytes: stat.size,
      tags: ['local'],
      source: 'local',
    });
    return id;
  }

  /**
   * Delete a locally-imported wallpaper by id. Only items with the `local:`
   * prefix (user-imported files in the custom directory) can be deleted;
   * workshop items and theme-bundled videos are read-only and silently skipped.
   *
   * Removes the underlying media file from disk and unregisters the item.
   * Returns true when something was deleted, false otherwise.
   */
  async deleteWallpaper(id: string): Promise<boolean> {
    if (!id.startsWith('local:')) return false;
    const item = this.items.get(id);
    if (!item) return false;
    // Only delete files inside the custom directory as a safety guard.
    if (this.customDir) {
      const resolvedCustom = path.resolve(this.customDir);
      const resolvedMedia = path.resolve(item.mediaPath);
      const rel = path.relative(resolvedCustom, resolvedMedia);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        try {
          await fs.unlink(resolvedMedia);
        } catch {
          // File may already be gone — still unregister the item.
        }
      }
    }
    this.items.delete(id);
    return true;
  }

  /**
   * Resolve the absolute media path for a wallpaper id, or null when unknown.
   * Used by the protocol handler to stream the file and by agent injection.
   */
  async mediaPathFor(id: string): Promise<string | null> {
    await this.scan();
    const item = this.items.get(id);
    return item ? item.mediaPath : null;
  }

  /** Backward-compatible alias used by the protocol handler. */
  async videoPathFor(id: string): Promise<string | null> {
    return this.mediaPathFor(id);
  }

  /**
   * Get the full media info for a wallpaper id (type + path).
   * Returns null when the id is unknown.
   */
  async mediaInfoFor(id: string): Promise<{ type: 'video' | 'image'; path: string } | null> {
    await this.scan();
    const item = this.items.get(id);
    if (!item) return null;
    return { type: item.type, path: item.mediaPath };
  }

  /** Whether Wallpaper Engine's workshop directory was found on this machine. */
  async isInstalled(): Promise<boolean> {
    const root = await this.resolveRoot();
    return root !== null;
  }

  /** Number of discovered wallpapers (both video and image). */
  async count(): Promise<number> {
    await this.scan();
    return this.items.size;
  }
}
