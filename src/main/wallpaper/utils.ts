// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Module — Pure Utility Functions
 *
 * MIME-type derivation and playback classification. These are pure functions
 * (no I/O, no side effects) extracted from the original `wallpaper-service.ts`
 * so they can be unit-tested in isolation and imported by sub-modules without
 * pulling in the full service class.
 */

import path from 'node:path';
import type { WallpaperPlayback } from '../../shared/types';
import { BROWSER_PLAYABLE_VIDEO } from './types';

/** Derive a MIME type for a wallpaper media file (video or image). */
export function wallpaperMimeForPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

/** Classify how a wallpaper's preview should be rendered in the UI. Web and
 *  scene wallpapers render their preview as a still image (the workshop
 *  preview.jpg/png); the actual animated content is served on demand via
 *  {@link WallpaperService.webUrlFor} when applied to an agent. */
export function playbackFor(
  type: 'video' | 'image' | 'web' | 'scene',
  mediaPath: string,
): WallpaperPlayback {
  const ext = path.extname(mediaPath).toLowerCase();
  if (ext === '.gif') return 'gif';
  if (type === 'image') return 'image';
  if (type === 'web') return 'web';
  if (type === 'scene') return 'scene';
  // Dynamic wallpaper whose media is a browser-decodable video container.
  if (BROWSER_PLAYABLE_VIDEO.has(ext)) return 'video';
  // Unsupported video containers can't be decoded by Chromium — render as
  // a still image.
  return 'image';
}
