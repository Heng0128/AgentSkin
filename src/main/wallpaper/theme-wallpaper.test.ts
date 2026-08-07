// SPDX-License-Identifier: MPL-2.0

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledTheme } from '../../shared/types';
import { registerThemeWallpaperForInstalled } from './theme-wallpaper';

function fakeTheme(overrides: Partial<InstalledTheme> = {}): InstalledTheme {
  return {
    id: 'wallpaper-abc',
    displayName: '壁纸·测试',
    version: '1.0.0',
    supportedAgents: [],
    coverDataUrl: null,
    tagline: null,
    ...overrides,
  };
}

describe('registerThemeWallpaperForInstalled', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-wallpaper-test-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('registers a bundled video wallpaper when the file exists', async () => {
    const themeId = 'wallpaper-abc';
    const themeDir = path.join(root, themeId);
    await fs.mkdir(path.join(themeDir, 'wallpaper'), { recursive: true });
    await fs.writeFile(path.join(themeDir, 'wallpaper', 'video.mp4'), Buffer.from('x'));

    const register = vi.fn(async () => {});
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme({ id: themeId, wallpaper: { video: 'wallpaper/video.mp4' } }),
      root,
    );
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      themeId,
      path.join(themeDir, 'wallpaper', 'video.mp4'),
      '壁纸·测试',
    );
  });

  it('skips when the video file is missing (never throws)', async () => {
    const register = vi.fn(async () => {});
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme({ wallpaper: { video: 'wallpaper/gone.mp4' } }),
      root,
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('skips when the theme has no wallpaper.video', async () => {
    const register = vi.fn(async () => {});
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme(),
      root,
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('skips when the wallpaper service is unavailable', async () => {
    const themeDir = path.join(root, 'wallpaper-abc');
    await fs.mkdir(path.join(themeDir, 'wallpaper'), { recursive: true });
    await fs.writeFile(path.join(themeDir, 'wallpaper', 'video.mp4'), Buffer.from('x'));
    // 不传 onError；wallpapers 为 null → 直接返回，不抛。
    await expect(
      registerThemeWallpaperForInstalled(
        { wallpapers: null } as never,
        fakeTheme({ wallpaper: { video: 'wallpaper/video.mp4' } }),
        root,
      ),
    ).resolves.toBeUndefined();
  });

  it('blocks video paths that escape the package root (traversal / absolute)', async () => {
    const onError = vi.fn();
    const register = vi.fn(async () => {});
    // `../` traversal through the theme id escapes the root → blocked.
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme({ id: '../evil', wallpaper: { video: 'wallpaper/x.mp4' } }),
      root,
      onError,
    );
    // `..` inside the video path escapes the root → blocked. (A single `..`
    // is absorbed by path.join; `../../` actually walks above the root.)
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme({ id: 'theme-b', wallpaper: { video: '../../outside.mp4' } }),
      root,
      onError,
    );
    // An absolute video path is absorbed into the join (stays inside root) and
    // simply misses — never registered, no escape.
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme({ id: 'theme-c', wallpaper: { video: '/etc/passwd' } }),
      root,
      onError,
    );
    expect(register).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('still registers videos inside the root even when the id contains dots', async () => {
    // A dots-only id is fine (path.resolve normalizes it); only escapes are
    // blocked — guards against over-blocking legitimate ids.
    const themeId = 'theme.with.dots';
    const themeDir = path.join(root, themeId);
    await fs.mkdir(path.join(themeDir, 'wallpaper'), { recursive: true });
    await fs.writeFile(path.join(themeDir, 'wallpaper', 'video.mp4'), Buffer.from('x'));
    const register = vi.fn(async () => {});
    await registerThemeWallpaperForInstalled(
      { wallpapers: { registerThemeWallpaper: register } as never },
      fakeTheme({ id: themeId, wallpaper: { video: 'wallpaper/video.mp4' } }),
      root,
    );
    expect(register).toHaveBeenCalledTimes(1);
  });
});
