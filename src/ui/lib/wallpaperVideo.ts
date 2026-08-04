// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';

/**
 * # Wallpaper video loader (streaming loopback URL)
 *
 * Video wallpapers are played from a streamable loopback HTTP URL minted by the
 * main-process wallpaper media server (`wallpaperVideoUrl(id)`), so the browser
 * media stack streams + buffers the file itself and the renderer never holds
 * the whole clip in memory (the old base64 path gave up past 30MB).
 *
 * Resolution is cached module-wide keyed by wallpaper id, with in-flight
 * de-duplication so several mounted cards for the same video only trigger one
 * IPC round-trip. Loading is lazy — a URL is only resolved when a surface
 * actually mounts a video.
 */

// R6-16: 限制缓存大小，防止长期运行持续累积。使用简单 LRU：超出上限时删除最早插入的条目。
const MAX_CACHE_SIZE = 50;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Resolve (and cache) the streaming loopback URL for a wallpaper's video media. */
export async function fetchWallpaperVideoUrl(id: string): Promise<string | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const pending = inflight.get(id);
  if (pending) return pending;
  const p = api
    .wallpaperVideoUrl(id)
    .then((url) => {
      inflight.delete(id);
      if (url) {
        // R6-16: LRU 淘汰 — 超出上限时删除最旧条目。
        if (cache.size >= MAX_CACHE_SIZE) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        cache.set(id, url);
      }
      return url;
    })
    .catch(() => {
      inflight.delete(id);
      return null;
    });
  inflight.set(id, p);
  return p;
}

// Scene/web 渲染器 URL（wallpaper:web-url，与 agent 注入共用同一 loopback
// 渲染器）。独立缓存：URL 有生命周期（scene HTML 注册后不可变），且数量远
// 少于视频 URL —— 不占 video LRU 名额。
const webCache = new Map<string, string>();
const webInflight = new Map<string, Promise<string | null>>();

/** Resolve (and cache) the loopback renderer URL for a scene/web wallpaper. */
export async function fetchWallpaperWebUrl(id: string): Promise<string | null> {
  const cached = webCache.get(id);
  if (cached) return cached;
  const pending = webInflight.get(id);
  if (pending) return pending;
  const p = api
    .wallpaperWebUrl(id)
    .then((url) => {
      webInflight.delete(id);
      if (url) webCache.set(id, url);
      return url;
    })
    .catch(() => {
      webInflight.delete(id);
      return null;
    });
  webInflight.set(id, p);
  return p;
}

// R6-16: 暴露缓存清理函数，供壁纸切换或显存压力时调用。
export function clearWallpaperVideoCache(keepIds?: Set<string>): void {
  if (!keepIds) {
    cache.clear();
    return;
  }
  for (const id of cache.keys()) {
    if (!keepIds.has(id)) cache.delete(id);
  }
}

export interface WallpaperVideoState {
  url: string | null;
  loading: boolean;
}

/**
 * React hook returning the base64 data URL for a wallpaper's video, loading it
 * lazily on first need. `id` may be null (e.g. an image wallpaper) — in that
 * case the hook stays idle and returns `{ url: null, loading: false }`.
 */
export function useWallpaperVideoUrl(id: string | null): WallpaperVideoState {
  const [state, setState] = useState<WallpaperVideoState>(() => ({
    url: id ? (cache.get(id) ?? null) : null,
    loading: id !== null && !cache.has(id),
  }));

  useEffect(() => {
    if (!id) {
      setState({ url: null, loading: false });
      return;
    }
    const cached = cache.get(id);
    if (cached) {
      setState({ url: cached, loading: false });
      return;
    }
    let cancelled = false;
    setState({ url: null, loading: true });
    void fetchWallpaperVideoUrl(id).then((url) => {
      if (!cancelled) setState({ url, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}

/**
 * React hook resolving the loopback renderer URL for a scene/web wallpaper
 * (the same iframe the CDP injector mounts inside agent windows). Loaded
 * lazily on first need; `id` null keeps it idle.
 */
export function useWallpaperWebUrl(id: string | null): WallpaperVideoState {
  const [state, setState] = useState<WallpaperVideoState>(() => ({
    url: id ? (webCache.get(id) ?? null) : null,
    loading: id !== null && !webCache.has(id),
  }));

  useEffect(() => {
    if (!id) {
      setState({ url: null, loading: false });
      return;
    }
    const cached = webCache.get(id);
    if (cached) {
      setState({ url: cached, loading: false });
      return;
    }
    let cancelled = false;
    setState({ url: null, loading: true });
    void fetchWallpaperWebUrl(id).then((url) => {
      if (!cancelled) setState({ url, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}
