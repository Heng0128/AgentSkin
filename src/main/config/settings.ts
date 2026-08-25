// SPDX-License-Identifier: MPL-2.0

import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { atomicWriteJsonSync } from '../fs-utils';

/** Default settings */
const DEFAULT_SETTINGS = {
  imageBlobThresholdMB: 20, // default 20MB in MB
};

type SettingsKey = keyof typeof DEFAULT_SETTINGS;
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

/** Runtime settings cache */
let settings: typeof DEFAULT_SETTINGS | null = null;

function isRecordString(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Load settings from user data directory.
 * Returns the loaded settings object (defaults if not found).
 */
function loadSettings(): typeof DEFAULT_SETTINGS {
  if (settings) return settings;

  // Try to load from user data directory (App.getPath('userData'))
  // Since we're in main process, we can use Electron's app module
  try {
    // Use Electron's cross-platform userData path (supports --user-data-dir portable mode)
    const userDataPath = app.getPath('userData');

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
            const s = settings as typeof DEFAULT_SETTINGS & Record<string, unknown>;
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

  const userDataPath = app.getPath('userData');
  const settingsFile = path.join(userDataPath, 'wallpaper-settings.json');

  try {
    // 原子写入：temp → fsync → rename → dir fsync。写入失败时原文件保持不变。
    atomicWriteJsonSync(settingsFile, next);
  } catch (err) {
    console.error('[WallpaperSettings] Failed to save settings:', err);
    return; // 写入失败 → 不更新内存缓存，保持磁盘与内存一致
  }

  // 磁盘写入成功后才更新内存缓存。
  settingsObj[key] = value;
}

// Export for debugging/reload
export { DEFAULT_SETTINGS, loadSettings };
