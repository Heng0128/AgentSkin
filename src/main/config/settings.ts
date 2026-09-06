// SPDX-License-Identifier: MPL-2.0

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { atomicWriteJsonSync } from '../fs-utils';

/** Default settings */
const DEFAULT_SETTINGS = {
  imageBlobThresholdMB: 20, // default 20MB in MB
  /**
   * Adapter IDs that use the renderer stable wait mechanism instead of the
   * fixed-timeout retry in `withPageSession`.稳定等待轮询 CDP `/json/list`
   * 直到目标页面 ID 连续稳定超过阈值（默认 750ms），提高变加载时间应用的
   * 注入成功率。默认启用 WorkBuddy 和 TRAE Work。
   */
  rendererStableWaitAdapters: ['workbuddy', 'traework'] as string[],
};

type SettingsKey = keyof typeof DEFAULT_SETTINGS;
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

/**
 * Runtime settings cache.
 *
 * Note: the cache is invalidated after every successful disk write (see
 * `invalidateSettingsCache()`). This prevents stale reads when the file is
 * edited externally (no fs watcher). The settings file is tiny (<1KB) and
 * reads are infrequent, so cache misses are cheap.
 */
let settings: typeof DEFAULT_SETTINGS | null = null;

function isRecordString(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Resolve the user data directory path.
 * Uses Electron app.getPath('userData') in the main process,
 * with fallback to env-var-based paths for tests/CLI contexts.
 */
function getUserDataDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return process.env.APPDATA
      ? path.join(process.env.APPDATA, 'AgentSkin')
      : process.env.HOME
        ? path.join(process.env.HOME, '.agentskin')
        : path.join(process.cwd(), 'user-data');
  }
}

/**
 * Load settings from user data directory.
 * Returns the loaded settings object (defaults if not found).
 */
function loadSettings(): typeof DEFAULT_SETTINGS {
  if (settings) return settings;
  return reloadSettings();
}

/**
 * Force-reload settings from disk, bypassing the cache.
 * Call this after external file edits (no fs watcher).
 */
function reloadSettings(): typeof DEFAULT_SETTINGS {
  try {
    const userDataPath = getUserDataDir();
    const settingsFile = path.join(userDataPath, 'wallpaper-settings.json');

    if (fs.existsSync(settingsFile)) {
      const raw = fs.readFileSync(settingsFile, 'utf8');
      const parsedRaw: unknown = JSON.parse(raw);

      if (!isRecordString(parsedRaw)) {
        console.warn('[WallpaperSettings]: settings root is not an object, using defaults');
        settings = { ...DEFAULT_SETTINGS };
        return settings;
      }

      // Merge with defaults, preserving unknown fields
      settings = { ...DEFAULT_SETTINGS, ...parsedRaw };
      // Validate only known keys — iterate SETTINGS_KEYS (not parsed keys) so
      // the SettingsKey type is enforced by the array literal, not by cast.
      SETTINGS_KEYS.forEach((key) => {
        if (Object.hasOwn(parsedRaw, key)) {
          const val = parsedRaw[key];
          // Basic type check
          if (typeof val !== typeof DEFAULT_SETTINGS[key]) {
            console.warn(`[WallpaperSettings]: Type mismatch for ${key}, using default`);
            const s = settings as unknown as Record<string, unknown>;
            s[key] = DEFAULT_SETTINGS[key];
          }
          // Range check: a corrupt/absurd threshold (negative, NaN, or huge)
          // would make getImageBlobThresholdBytes() return a nonsense cap and
          // every image wallpaper balloon the heap. Clamp into 1..1000 MB.
          if (key === 'imageBlobThresholdMB') {
            const mb = (settings as typeof DEFAULT_SETTINGS).imageBlobThresholdMB;
            if (!Number.isFinite(mb) || mb <= 0 || mb > 1000) {
              console.warn(
                `[WallpaperSettings]: imageBlobThresholdMB=${String(mb)} out of range (1..1000), using default`,
              );
              (settings as typeof DEFAULT_SETTINGS).imageBlobThresholdMB =
                DEFAULT_SETTINGS.imageBlobThresholdMB;
            }
          }
        }
      });
    } else {
      // Create directory and write default config if file doesn't exist
      fs.mkdirSync(userDataPath, { recursive: true });
      atomicWriteJsonSync(settingsFile, DEFAULT_SETTINGS);
      settings = { ...DEFAULT_SETTINGS };
    }
  } catch (err) {
    console.error('[WallpaperSettings] Failed to load settings, using defaults:', err);
    settings = { ...DEFAULT_SETTINGS };
  }

  return settings ?? { ...DEFAULT_SETTINGS };
}

/** Get the current blob threshold in bytes */
export function getImageBlobThresholdBytes(): number {
  const mb = loadSettings().imageBlobThresholdMB;
  return mb * 1024 * 1024;
}

/** Get the list of adapter IDs that should use the renderer stable wait mechanism. */
export function getRendererStableWaitAdapters(): string[] {
  return loadSettings().rendererStableWaitAdapters;
}

/** Update a setting value (for UI/API updates) */
export function updateSetting(key: SettingsKey, value: number): void {
  const settingsObj = loadSettings();
  // Validate type
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) {
    throw new Error(`Invalid type for ${key}`);
  }
  // Range validation mirrors the load-time clamp: reject absurd thresholds
  // instead of persisting them.
  if (key === 'imageBlobThresholdMB' && (!Number.isFinite(value) || value <= 0 || value > 1000)) {
    throw new Error('imageBlobThresholdMB must be between 1 and 1000');
  }

  // R6-2: 先构造完整对象并写入磁盘，成功后再更新内存缓存。
  // 原实现先改内存后写磁盘，写失败时 catch 只 console.error 但内存已更新，
  // 导致进程内看到新值但磁盘仍是旧值，重启后回退且用户无感知。
  const next = { ...settingsObj, [key]: value };

  const userDataPath = getUserDataDir();
  const settingsFile = path.join(userDataPath, 'wallpaper-settings.json');

  try {
    // 原子写入：temp → fsync → rename → dir fsync。写入失败时原文件保持不变。
    atomicWriteJsonSync(settingsFile, next);
  } catch (err) {
    console.error('[WallpaperSettings] Failed to save settings:', err);
    return; // 写入失败 → 不更新内存缓存，保持磁盘与内存一致
  }

  // 磁盘写入成功后才失效缓存，下次 loadSettings() 从磁盘读取最新值。
  invalidateSettingsCache();
}

/** Invalidate the settings cache — forces next loadSettings() to re-read from disk. */
export function invalidateSettingsCache(): void {
  settings = null;
}

/**
 * Update the list of adapter IDs that should use the renderer stable wait.
 * Validation: must be an array of non-empty strings. Invalid input is rejected
 * without modifying the current value.
 */
export function updateRendererStableWaitAdapters(adapters: unknown): void {
  if (!Array.isArray(adapters) || !adapters.every((a) => typeof a === 'string' && a.length > 0)) {
    throw new Error('rendererStableWaitAdapters must be a non-empty array of strings');
  }
  const settingsObj = loadSettings();
  const next = { ...settingsObj, rendererStableWaitAdapters: adapters };
  const userDataPath = getUserDataDir();
  const settingsFile = path.join(userDataPath, 'wallpaper-settings.json');
  try {
    atomicWriteJsonSync(settingsFile, next);
  } catch (err) {
    console.error('[WallpaperSettings] Failed to save rendererStableWaitAdapters:', err);
    return;
  }
  // 磁盘写入成功后才失效缓存。
  invalidateSettingsCache();
}

// Export for debugging/reload
export { DEFAULT_SETTINGS, loadSettings };
