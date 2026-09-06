// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper-handler-registry
 *
 * Shared registry that breaks the circular dependency between
 * `themeStore` and `wallpaperStore`.
 *
 * Previously the `wallpaperHandlers` array + `registerWallpaperHandler`
 * lived in `themeStore.ts`, but `wallpaperStore.ts` needed to import
 * `registerWallpaperHandler` at module top-level (called during store
 * creation) while `themeStore.ts` simultaneously imported
 * `useWallpaperStore` from `wallpaperStore.ts` — a classic ES-module
 * circular TDZ:
 *
 *     themeStore → import wallpaperStore
 *                   wallpaperStore → import themeStore (registerWallpaperHandler)
 *                                     themeStore pauses mid-evaluation,
 *                                     `const wallpaperHandlers` still in TDZ
 *                                     → WallpaperHandler called → ReferenceError
 *
 * By relocating the registry to a standalone module imported by both
 * stores, neither store depends on the other for this handshake.
 */

import type { AgentId, WallpaperInfo } from '@shared/types';

export type WallpaperHandler = (
  appId: AgentId,
  restore: boolean,
  wallpaper: WallpaperInfo | null,
) => void;

export const wallpaperHandlers: WallpaperHandler[] = [];

export function registerWallpaperHandler(handler: WallpaperHandler): void {
  wallpaperHandlers.push(handler);
}
