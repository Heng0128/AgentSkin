// SPDX-License-Identifier: MPL-2.0

/**
 * # ipc-type-guards
 *
 * Runtime type-guards for values arriving over IPC.
 *
 * Prefer these over `as unknown as T` assertions — they validate the actual
 * shape at runtime and return a precise type instead of a blind cast.
 *
 * ## Why
 *
 * The preload bridge (`ipcRenderer.invoke`) returns `unknown` for any channel
 * whose handler may evolve over time. Blind casts (`as Foo`) hide shape drift:
 * if the main process starts returning a different shape, the cast silently
 * passes bad data to the store. These guards fail fast and let callers
 * degrade gracefully.
 */

import type { WallpaperInfo } from './types';

/** Validate any value is a non-null object (safe record access). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Validate an `{ ok: false, error: string }` error shape. */
export function isOkError(value: unknown): value is { ok: false; error: string } {
  if (!isRecord(value)) return false;
  if (value.ok !== false) return false;
  return typeof value.error === 'string';
}

/**
 * Runtime type guard for a single WallpaperInfo object.
 * Validates required fields exist with correct types. Optional/nullable
 * fields are only checked for type when present.
 */
export function isWallpaperInfo(value: unknown): value is WallpaperInfo {
  if (!isRecord(value)) return false;
  const obj = value;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.title !== 'string') return false;
  if (typeof obj.type !== 'string' || !['video', 'image', 'web', 'scene'].includes(obj.type))
    return false;
  if (typeof obj.projectType !== 'string') return false;
  if (typeof obj.playback !== 'string') return false;
  if (obj.previewUrl !== null && typeof obj.previewUrl !== 'string') return false;
  if (typeof obj.sizeBytes !== 'number') return false;
  if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === 'string')) return false;
  if (typeof obj.source !== 'string' || !['workshop', 'local'].includes(obj.source)) return false;
  if (typeof obj.previewOnly !== 'boolean') return false;
  return true;
}

/**
 * Validate a normalize-able wallpaper result:
 *   - WallpaperInfo[] (array of valid items)
 *   - { ok: true, items: WallpaperInfo[] }
 *   - { ok: false, error: string }
 */
export function isWallpaperResult(
  value: unknown,
): value is WallpaperInfo[] | { ok: true; items: WallpaperInfo[] } {
  if (Array.isArray(value)) {
    return value.every(isWallpaperInfo);
  }
  if (isRecord(value) && value.ok === true && Array.isArray(value.items)) {
    return value.items.every(isWallpaperInfo);
  }
  return false;
}
