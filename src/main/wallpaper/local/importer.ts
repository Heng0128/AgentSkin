// SPDX-License-Identifier: MPL-2.0

/**
 * # Local Importer — Custom Directory Scanning & Media Import
 *
 * Handles wallpapers that the user imports directly (not from Wallpaper
 * Engine's workshop). Three operations:
 *  - **scanCustomDir**: enumerate media files in the custom directory
 *  - **importMedia**: copy a file into the custom directory and return its item
 *  - **deleteLocalWallpaperFile**: safely delete a file from the custom directory
 *
 * Extracted from the original `wallpaper-service.ts` so that import logic can
 * be tested without the full service class (which also owns workshop scanning,
 * URL caching, and the scan() state machine).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import type { DiscoveredItem } from '../types';
import {
  IMAGE_EXTENSIONS,
  IMPORTABLE_EXTENSIONS,
  MAX_IMPORT_IMAGE_BYTES,
  MAX_IMPORT_VIDEO_BYTES,
} from '../types';
import { playbackFor } from '../utils';

/**
 * Scan the custom (user-imported) wallpapers directory for media files.
 * Returns a map of discovered items keyed by id (`local:<filename>`).
 * Files that cannot be stat'd are silently skipped.
 */
export async function scanCustomDir(customDir: string): Promise<Map<string, DiscoveredItem>> {
  const items = new Map<string, DiscoveredItem>();
  let entries: string[];
  try {
    entries = await fs.readdir(customDir);
  } catch {
    return items;
  }

  for (const file of entries) {
    const ext = path.extname(file).toLowerCase();
    const isVideo = IMPORTABLE_EXTENSIONS.has(ext);
    const isImage = IMAGE_EXTENSIONS.has(ext);
    if (!isVideo && !isImage) continue;
    const mediaPath = path.join(customDir, file);
    try {
      const stat = await fs.stat(mediaPath);
      if (!stat.isFile()) continue;
      const id = `local:${file}`;
      items.set(id, {
        id,
        title: path.basename(file, ext).replace(/[-_]/g, ' '),
        type: isVideo ? 'video' : 'image',
        projectType: isVideo ? 'video' : 'image',
        playback: playbackFor(isVideo ? 'video' : 'image', mediaPath),
        mediaPath,
        dirPath: null,
        pkgPath: null,
        previewPath: isImage ? mediaPath : null,
        sizeBytes: stat.size,
        tags: ['local'],
        source: 'local',
        previewOnly: false,
      });
    } catch {
      // skip unreadable files
    }
  }

  return items;
}

/**
 * Import a media file (video or image) into the custom wallpapers directory.
 * Copies the file (does not move) so the original stays intact.
 * Returns the new {@link DiscoveredItem}, or null if the extension is
 * unsupported or the file exceeds the per-type size cap.
 */
export async function importMedia(
  sourcePath: string,
  customDir: string,
): Promise<DiscoveredItem | null> {
  const ext = path.extname(sourcePath).toLowerCase();
  const isVideo = IMPORTABLE_EXTENSIONS.has(ext);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  if (!isVideo && !isImage) return null;

  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  if (!sourceStat || !sourceStat.isFile()) return null;
  const maxBytes = isVideo ? MAX_IMPORT_VIDEO_BYTES : MAX_IMPORT_IMAGE_BYTES;
  if (sourceStat.size > maxBytes) return null;

  await fs.mkdir(customDir, { recursive: true });

  // Avoid overwriting: append a suffix if the file already exists.
  let finalPath = path.join(customDir, path.basename(sourcePath));
  let counter = 1;
  while (true) {
    try {
      await fs.stat(finalPath);
      const base = path.basename(sourcePath, ext);
      finalPath = path.join(customDir, `${base} (${counter})${ext}`);
      counter++;
    } catch {
      break; // does not exist — safe to write
    }
  }

  await fs.copyFile(sourcePath, finalPath);

  const id = `local:${path.basename(finalPath)}`;
  const stat = await fs.stat(finalPath);
  return {
    id,
    title: path.basename(finalPath, ext).replace(/[-_]/g, ' '),
    type: isVideo ? 'video' : 'image',
    projectType: isVideo ? 'video' : 'image',
    playback: playbackFor(isVideo ? 'video' : 'image', finalPath),
    mediaPath: finalPath,
    dirPath: null,
    pkgPath: null,
    previewPath: isImage ? finalPath : null,
    sizeBytes: stat.size,
    tags: ['local'],
    source: 'local',
    previewOnly: false,
  };
}

/**
 * Delete a locally-imported wallpaper file from disk.
 * Only files inside `customDir` can be deleted (safety guard against
 * deleting workshop or system files). Uses `shell.trashItem` (recycle bin)
 * with a fallback to `unlink` for network drives.
 * Returns true when the file was deleted, false when the path is outside
 * the custom directory.
 */
export async function deleteLocalWallpaperFile(
  item: DiscoveredItem,
  customDir: string,
): Promise<boolean> {
  const resolvedCustom = path.resolve(customDir);
  const resolvedMedia = path.resolve(item.mediaPath);
  const rel = path.relative(resolvedCustom, resolvedMedia);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    try {
      await shell.trashItem(resolvedMedia);
    } catch {
      // trashItem can fail on network drives or headless envs — fall back
      // to unlink as last resort.
      await fs.unlink(resolvedMedia).catch(() => {});
    }
    return true;
  }
  return false;
}
