// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/types — Shared Types & Constants
 *
 * Type definitions and constants shared across the wallpaper service
 * sub-modules (`adapter.ts`, `we/scanner.ts`, `we/parser.ts`,
 * `local/importer.ts`, `media-registry.ts`, `utils.ts`).
 *
 * Extracted from the original `wallpaper-service.ts` so that sub-modules
 * can import these without pulling in the full service class.
 */

import type { WallpaperPlayback, WallpaperProjectType } from '../../shared/types';

// ---------------------------------------------------------------------------
// DiscoveredItem — internal representation of a wallpaper
// ---------------------------------------------------------------------------

/**
 * A wallpaper discovered from the Wallpaper Engine workshop library or
 * local imports. This is the internal representation (with file paths);
 * the public-facing {@link WallpaperInfo} (with loopback URLs) is derived
 * from it by the adapter.
 */
export interface DiscoveredItem {
  /** Workshop item id (the numeric Steam workshop folder name) or local id. */
  id: string;
  /** Wallpaper title from project.json or filename. */
  title: string;
  /** Wallpaper media type for injection dispatch: video, image, web (iframe),
   *   or scene (canvas renderer). */
  type: 'video' | 'image' | 'web' | 'scene';
  /** The original Wallpaper Engine project type from project.json. */
  projectType: WallpaperProjectType;
  /** How the preview is rendered in the UI grid. */
  playback: WallpaperPlayback;
  /** Absolute path to the main media file (video, image, or index.html). */
  mediaPath: string;
  /** Absolute path to the web wallpaper directory (type='web' only). */
  dirPath: string | null;
  /** Absolute path to the scene.pkg file (type='scene' only). */
  pkgPath: string | null;
  /** Absolute path to the preview image (preview.jpg/png/gif or the image
   *  file itself for image wallpapers). Null when no preview exists. */
  previewPath: string | null;
  /** Size of the source media file in bytes. */
  sizeBytes: number;
  /** Workshop tags (e.g. Anime, Animal) or ['local'] for local imports. */
  tags: string[];
  /** Where this wallpaper was discovered from. */
  source: 'workshop' | 'local';
  /** True when the wallpaper has no real media asset — only a low-res
   *  preview thumbnail (preview.jpg). */
  previewOnly: boolean;
}

// ---------------------------------------------------------------------------
// File extension sets
// ---------------------------------------------------------------------------

/**
 * Image file extensions that browsers can natively decode in an `<img>` tag.
 * Used to classify local imports and detect bare-image workshop directories.
 *
 * NOTE: `.gif` is classified as an IMAGE extension (not video) because
 * browsers render animated GIFs natively in `<img>` but NOT in `<video>`
 * (which shows only the first frame). This is a hard constraint from the
 * project memory.
 */
export const IMAGE_EXTENSIONS = new Set<string>([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.webp',
  '.gif',
  '.svg',
]);

/**
 * Video file extensions that can be imported as local wallpapers. These are
 * the containers Chromium's `<video>` element can attempt to decode (though
 * actual decodability depends on the codec inside, e.g. HEVC is not
 * supported). Does NOT include `.gif` — see {@link IMAGE_EXTENSIONS}.
 */
export const IMPORTABLE_EXTENSIONS = new Set<string>(['.mp4', '.webm', '.mkv', '.mov', '.avi']);

/**
 * Video container extensions that Chromium can reliably decode (H.264 in
 * MP4, VP8/VP9/AV1 in WebM). Used by {@link playbackFor} to decide whether
 * a video wallpaper's preview should render as a `<video>` element or fall
 * back to a still image. Containers like `.mkv`, `.mov`, `.avi` may contain
 * codecs Chromium cannot decode (e.g. HEVC, VC-1), so they are excluded.
 */
export const BROWSER_PLAYABLE_VIDEO = new Set<string>(['.mp4', '.webm']);

/**
 * Image extensions that browsers can decode for display. Used by the parser
 * to find the largest decodable image file in a workshop directory when the
 * wallpaper type is unrecognized and no video asset exists.
 */
export const BROWSER_DECODABLE_IMAGE = new Set<string>([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.webp',
  '.gif',
]);

// ---------------------------------------------------------------------------
// Preview file candidates
// ---------------------------------------------------------------------------

/**
 * Common preview image filenames checked when a workshop project's
 * `project.json` doesn't specify a `preview` field. Checked in order —
 * the first existing file wins.
 */
export const PREVIEW_CANDIDATES: readonly string[] = ['preview.jpg', 'preview.png', 'preview.gif'];

// ---------------------------------------------------------------------------
// Import size limits
// ---------------------------------------------------------------------------

/** Maximum file size for imported image wallpapers (50 MB). Images larger
 *  than this are rejected by {@link importMedia} to prevent excessive memory
 *  usage during base64 encoding and CDP transfer. */
export const MAX_IMPORT_IMAGE_BYTES = 50 * 1024 * 1024;

/** Maximum file size for imported video wallpapers (500 MB). Videos larger
 *  than this are rejected by {@link importMedia} to prevent disk bloat in
 *  the custom wallpapers directory and excessive CDP transfer time. */
export const MAX_IMPORT_VIDEO_BYTES = 500 * 1024 * 1024;
