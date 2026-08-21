// SPDX-License-Identifier: MPL-2.0

/**
 * # WE Parser — project.json Parsing & Type Detection
 *
 * Parses a single Wallpaper Engine workshop project directory: reads
 * `project.json`, detects the wallpaper type (web / scene / video / image),
 * locates the media file and preview image, and returns a fully-populated
 * {@link DiscoveredItem}.
 *
 * This module is pure I/O — it reads files but does not mutate any shared
 * state. The scanner (`we/scanner.ts`) calls this per directory and collects
 * results into a Map.
 *
 * Extracted from the original `wallpaper-service.ts` scan() method (lines
 * 298–548, ~250 lines of type-detection logic) so that parsing can be tested
 * in isolation without standing up the full service.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { WallpaperProjectType } from '../../../shared/types';
import { isCeProject, parseCeMetadata } from '../../scene/ce-parser';
import { isSceProject, parseSceMetadata } from '../../scene/sce-parser';
import {
  BROWSER_DECODABLE_IMAGE,
  type DiscoveredItem,
  IMAGE_EXTENSIONS,
  IMPORTABLE_EXTENSIONS,
  PREVIEW_CANDIDATES,
} from '../types';
import { playbackFor } from '../utils';

/** Parsed project.json fields (subset we care about). */
interface ProjectJson {
  type?: string;
  file?: string;
  title?: string;
  tags?: string[];
  /** Preview image filename (usually "preview.jpg"). Read from project.json
   *  like WEML does — some wallpapers use custom preview filenames. */
  preview?: string;
  /** Content rating: "Everyone", "Questionable", "Mature", etc. */
  contentrating?: string;
}

/**
 * Find the preview image for a workshop project directory. Checks
 * `project.preview` from project.json first, then falls back to common names
 * (preview.jpg / preview.png / preview.gif).
 */
async function findPreviewPath(dir: string, project: ProjectJson): Promise<string | null> {
  if (typeof project.preview === 'string' && project.preview) {
    const p = path.join(dir, project.preview);
    const s = await fs.stat(p).catch(() => null);
    if (s?.isFile()) return p;
  }
  for (const candidate of PREVIEW_CANDIDATES) {
    const p = path.join(dir, candidate);
    const s = await fs.stat(p).catch(() => null);
    if (s?.isFile()) return p;
  }
  return null;
}

/**
 * Parse a single Wallpaper Engine workshop project directory.
 *
 * Reads `project.json`, detects the wallpaper type (web/scene/video/image),
 * locates the media file and preview image, and returns a fully-populated
 * {@link DiscoveredItem}. Returns null when the directory has no usable
 * wallpaper content.
 *
 * Type detection order:
 *  1. **Web**: `index.html` exists → iframe wallpaper
 *  2. **Scene**: `scene.pkg` exists → canvas renderer wallpaper
 *  3. **Video/Image**: `project.type` + `project.file` → direct media
 *  4. **Fallback**: scan directory for largest video file
 *  5. **Last resort**: use preview image as static wallpaper
 */
export async function parseWorkshopProject(
  dir: string,
  entry: string,
): Promise<DiscoveredItem | null> {
  // Validate directory name to prevent malformed paths from becoming item IDs
  if (/[<>:"|?*]/.test(entry) || entry.includes('..')) {
    console.warn(`[wallpaper] skipping malformed directory name: ${dir}`);
    return null;
  }

  const projectFile = path.join(dir, 'project.json');
  let project: ProjectJson;
  try {
    const raw = await fs.readFile(projectFile, 'utf8');
    project = JSON.parse(raw) as ProjectJson;
  } catch {
    // Missing or corrupt project.json — still try web/scene/video detection
    // below (index.html / scene.pkg presence doesn't depend on it). The
    // bare-image fallback at the end covers directories with only images.
    project = {};
  }

  const projectType = typeof project.type === 'string' ? project.type.toLowerCase() : '';
  const previewPath = await findPreviewPath(dir, project);

  let type: 'video' | 'image' | 'web' | 'scene' | null = null;
  let mediaPath: string | null = null;
  let sizeBytes = 0;
  let dirPath: string | null = null;
  let pkgPath: string | null = null;
  let previewOnly = false;

  // --- Web wallpaper: index.html exists in the directory ---
  // P3-5: async fs.stat replaces the synchronous existsSync() call that used
  // to block the event loop mid-async parseWorkshopProject. On a scan of
  // ~2000 WE projects this removes 1000+ tiny sync syscalls that would
  // otherwise starve the renderer IPC / timer queue.
  const indexHtmlPath = path.join(dir, 'index.html');
  const indexHtmlStat = await fs.stat(indexHtmlPath).catch(() => null);
  if (indexHtmlStat?.isFile()) {
    type = 'web';
    dirPath = dir;
    mediaPath = previewPath ?? indexHtmlPath;
  }

  // --- Scene wallpaper: scene.pkg exists in the directory ---
  if (!type) {
    const scenePkgPath = path.join(dir, 'scene.pkg');
    const sceneStat = await fs.stat(scenePkgPath).catch(() => null);
    if (sceneStat?.isFile()) {
      type = 'scene';
      pkgPath = scenePkgPath;
      mediaPath = previewPath ?? scenePkgPath;
      sizeBytes = sceneStat.size;
    }
  }

  // --- Video / image detection (only if not web/scene) ---
  if (!type) {
    if (projectType === 'video' && typeof project.file === 'string') {
      // Guard: if the file is actually a .gif, treat it as an image
      // (browsers can't play animated GIFs in <video>).
      const fileExt = path.extname(project.file).toLowerCase();
      type = fileExt === '.gif' ? 'image' : 'video';
      mediaPath = path.join(dir, project.file);
    } else if (projectType === 'image' && typeof project.file === 'string') {
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
  }

  // --- SCE / CE scene detection (fallback when no WE type matched) ---
  // SCE (Sucrose Wallpaper Engine) and CE (Cyclone Engine) are alternative
  // scene formats that don't use scene.pkg. Probe them after the standard
  // WE type detection (project.type + project.file) so that projects with
  // a recognizable WE type or inferable media file are handled first.
  //
  // Guard: only probe SCE/CE when project.json does NOT declare a known WE
  // type. Standard WE projects always have a `type` field (video/image/web/
  // scene/application); SCE projects omit it. Without this guard, every
  // workshop directory with project.json would match isSceProject (which
  // only checks for project.json existence) and be misclassified as scene.
  const KNOWN_WE_TYPES = new Set(['video', 'image', 'web', 'scene', 'application']);
  if (!type && !KNOWN_WE_TYPES.has(projectType)) {
    if (await isSceProject(dir)) {
      const sceMeta = (await parseSceMetadata(dir)) ?? {};
      type = 'scene';
      mediaPath = previewPath ?? path.join(dir, 'project.json');
      // SCE projects are directory-based; sizeBytes reflects the project file.
      try {
        const projStat = await fs.stat(path.join(dir, 'project.json'));
        sizeBytes = projStat.size;
      } catch {
        sizeBytes = 0;
      }
      return {
        id: entry,
        title: sceMeta.title ?? entry,
        type,
        projectType: 'scene',
        playback: playbackFor('scene', mediaPath),
        mediaPath,
        dirPath: dir,
        pkgPath: null,
        previewPath,
        sizeBytes,
        tags: [],
        source: 'workshop',
        previewOnly: !previewPath,
        sceneFormat: 'sce',
      };
    }

    if (await isCeProject(dir)) {
      const ceMeta = (await parseCeMetadata(dir)) ?? {};
      type = 'scene';
      mediaPath = previewPath ?? path.join(dir, 'scene.dat');
      try {
        const datStat = await fs.stat(path.join(dir, 'scene.dat'));
        sizeBytes = datStat.size;
      } catch {
        sizeBytes = 0;
      }
      return {
        id: entry,
        title: ceMeta.title ?? entry,
        type,
        projectType: 'scene',
        playback: playbackFor('scene', mediaPath),
        mediaPath,
        dirPath: dir,
        pkgPath: null,
        previewPath,
        sizeBytes,
        tags: [],
        source: 'workshop',
        previewOnly: !previewPath,
        sceneFormat: 'ce',
      };
    }
  }

  // For scene / web / unrecognized types: scan directory for video files.
  if (
    !type ||
    (type === 'video' && mediaPath && !(await fs.stat(mediaPath).catch(() => null))?.isFile())
  ) {
    type = null;
    mediaPath = null;
    try {
      const dirFiles = await fs.readdir(dir);
      let bestVideo: { file: string; size: number } | null = null;
      for (const f of dirFiles) {
        const ext = path.extname(f).toLowerCase();
        if (!IMPORTABLE_EXTENSIONS.has(ext)) continue;
        const fp = path.join(dir, f);
        const st = await fs.stat(fp).catch(() => null);
        if (st?.isFile() && (!bestVideo || st.size > bestVideo.size)) {
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

  // Unrecognized type with no video asset: use preview as fallback.
  if (!type && previewPath) {
    type = 'image';
    let bestImage = { file: previewPath, size: 0 };
    try {
      const previewStat = await fs.stat(previewPath).catch(() => null);
      if (previewStat) bestImage.size = previewStat.size;
      const dirFiles = await fs.readdir(dir);
      for (const f of dirFiles) {
        const ext = path.extname(f).toLowerCase();
        if (!BROWSER_DECODABLE_IMAGE.has(ext)) continue;
        const fp = path.join(dir, f);
        const st = await fs.stat(fp).catch(() => null);
        if (st?.isFile() && st.size > bestImage.size) {
          bestImage = { file: fp, size: st.size };
        }
      }
    } catch {
      // directory unreadable — fall back to previewPath
    }
    mediaPath = bestImage.file;
    if (mediaPath === previewPath) previewOnly = true;
  }

  if (!type || !mediaPath) return parseBareImageDir(dir, entry);

  const mediaStat = await fs.stat(mediaPath).catch(() => null);
  if (!mediaStat?.isFile()) return null;
  sizeBytes = mediaStat.size;

  // For image wallpapers, use the image itself as preview if no dedicated preview.
  const resolvedPreview = previewPath ?? (type === 'image' ? mediaPath : null);

  const resolvedProjectType: WallpaperProjectType =
    projectType === 'video' ||
    projectType === 'image' ||
    projectType === 'web' ||
    projectType === 'scene' ||
    projectType === 'application'
      ? (projectType as WallpaperProjectType)
      : (type as WallpaperProjectType);

  return {
    id: entry,
    title: typeof project.title === 'string' && project.title ? project.title : entry,
    type,
    projectType: resolvedProjectType,
    playback: playbackFor(type, mediaPath),
    mediaPath,
    dirPath,
    pkgPath,
    previewPath: resolvedPreview,
    sizeBytes,
    tags: Array.isArray(project.tags) ? project.tags.filter((t) => typeof t === 'string') : [],
    source: 'workshop',
    previewOnly,
  };
}

/** Fallback for directories without project.json: find a bare image file. */
async function parseBareImageDir(dir: string, entry: string): Promise<DiscoveredItem | null> {
  try {
    const files = await fs.readdir(dir);
    const imageFile = files.find((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));
    if (imageFile) {
      const mediaPath = path.join(dir, imageFile);
      const mediaStat = await fs.stat(mediaPath).catch(() => null);
      if (mediaStat?.isFile()) {
        return {
          id: entry,
          title: entry,
          type: 'image',
          projectType: 'image',
          playback: 'image',
          mediaPath,
          dirPath: null,
          pkgPath: null,
          previewPath: mediaPath,
          sizeBytes: mediaStat.size,
          tags: [],
          source: 'workshop',
          previewOnly: false,
        };
      }
    }
  } catch {
    // Skip unreadable directories.
  }
  return null;
}
