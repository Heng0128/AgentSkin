// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { playbackFor, wallpaperMimeForPath } from './wallpaper-service';

// ---------------------------------------------------------------------------
// playbackFor — GIF classification
// ---------------------------------------------------------------------------
//
// playbackFor determines how the UI renders a wallpaper preview and how the
// injector dispatches the media. GIF files must return 'gif' so:
//   1. The UI grid renders them via <img> (animated GIFs play natively in <img>).
//   2. The injector routes them to injectImageWallpaper (NOT injectVideoWallpaper,
//      which uses <video> and only shows the first frame of a GIF).
//
// This test guards against regressions where .gif might be treated as 'video'.

describe('playbackFor', () => {
  it('returns "gif" for .gif files regardless of type parameter', () => {
    // playbackFor checks the file extension FIRST, before the type parameter.
    // So even if type='video' (which can happen with older cached data or
    // mislabeled project.json), a .gif file must return 'gif'.
    expect(playbackFor('video', '/path/to/animated.gif')).toBe('gif');
    expect(playbackFor('image', '/path/to/animated.gif')).toBe('gif');
    expect(playbackFor('web', '/path/to/animated.gif')).toBe('gif');
    expect(playbackFor('scene', '/path/to/animated.gif')).toBe('gif');
  });

  it('returns "video" for browser-playable video formats', () => {
    expect(playbackFor('video', '/path/to/clip.mp4')).toBe('video');
    expect(playbackFor('video', '/path/to/clip.webm')).toBe('video');
  });

  it('returns "image" for static image formats', () => {
    expect(playbackFor('image', '/path/to/photo.jpg')).toBe('image');
    expect(playbackFor('image', '/path/to/photo.png')).toBe('image');
    expect(playbackFor('image', '/path/to/photo.webp')).toBe('image');
  });

  it('returns "image" for unsupported video containers (fallback to still)', () => {
    // .mkv, .avi, .mov etc. can't be decoded by Chromium — render as still image
    expect(playbackFor('video', '/path/to/clip.mkv')).toBe('image');
    expect(playbackFor('video', '/path/to/clip.avi')).toBe('image');
  });

  it('returns "web" or "scene" for web/scene types', () => {
    expect(playbackFor('web', '/path/to/index.html')).toBe('web');
    expect(playbackFor('scene', '/path/to/scene.pkg')).toBe('scene');
  });

  it('is case-insensitive for file extensions', () => {
    expect(playbackFor('video', '/path/to/ANIMATED.GIF')).toBe('gif');
    expect(playbackFor('video', '/path/to/CLIP.MP4')).toBe('video');
    expect(playbackFor('image', '/path/to/PHOTO.PNG')).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// wallpaperMimeForPath — GIF MIME type
// ---------------------------------------------------------------------------

describe('wallpaperMimeForPath', () => {
  it('returns image/gif for .gif files', () => {
    expect(wallpaperMimeForPath('animated.gif')).toBe('image/gif');
    expect(wallpaperMimeForPath('ANIMATED.GIF')).toBe('image/gif');
  });

  it('returns correct MIME for video formats', () => {
    expect(wallpaperMimeForPath('clip.mp4')).toBe('video/mp4');
    expect(wallpaperMimeForPath('clip.webm')).toBe('video/webm');
  });

  it('returns correct MIME for image formats', () => {
    expect(wallpaperMimeForPath('photo.png')).toBe('image/png');
    expect(wallpaperMimeForPath('photo.jpg')).toBe('image/jpeg');
    expect(wallpaperMimeForPath('photo.jpeg')).toBe('image/jpeg');
    expect(wallpaperMimeForPath('photo.webp')).toBe('image/webp');
  });
});
