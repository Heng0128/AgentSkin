// SPDX-License-Identifier: MPL-2.0

/**
 * # IPC Registration Aggregator
 *
 * Entry point for IPC handler registration. Replaces the monolithic
 * `registerIpc()` function in `main.ts` (H3). Each domain module owns its
 * own handlers; this file just calls them in order.
 *
 * `ctx` is forwarded to every module so handlers receive their dependencies
 * via parameter injection (no implicit singleton import), enabling unit
 * testing with mock contexts.
 *
 * `updateTrayMenu` is forwarded only to modules whose handlers mutate
 * tray-visible state (core: locale; theme: apply/restore/import/delete).
 */

import type { MainContext } from '../main-context';
import { registerCoreIpc } from './core-ipc';
import { registerSettingsIpc } from './settings-ipc';
import { registerThemeIpc } from './theme-ipc';
import { registerWallpaperIpc } from './wallpaper-ipc';
import { registerWindowIpc } from './window-ipc';

export function registerIpc(ctx: MainContext, updateTrayMenu: () => Promise<void>): void {
  registerCoreIpc(ctx, updateTrayMenu);
  registerThemeIpc(ctx, updateTrayMenu);
  registerSettingsIpc(ctx);
  registerWallpaperIpc(ctx);
  registerWindowIpc(ctx);
}
