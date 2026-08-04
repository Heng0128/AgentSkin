// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper-service.ts — Backward-Compatibility Barrel
 *
 * This file re-exports the public API from the split modules under
 * `src/main/wallpaper/`. Existing imports like
 * `import { WallpaperService, playbackFor, wallpaperMimeForPath } from './wallpaper-service'`
 * continue to work without changes.
 *
 * The actual implementation now lives in:
 *  - `wallpaper/adapter.ts` — WallpaperService class (thin delegation)
 *  - `wallpaper/utils.ts` — pure utility functions (playbackFor, wallpaperMimeForPath)
 *  - `wallpaper/types.ts` — shared types & constants (DiscoveredItem, extension sets)
 *  - `wallpaper/we/parser.ts` — project.json parsing & type detection
 *  - `wallpaper/we/scanner.ts` — workshop directory iteration
 *  - `wallpaper/local/importer.ts` — local media import, scan, and deletion
 *  - `wallpaper/media-registry.ts` — loopback URL & token lifecycle management
 *
 * ## Why a barrel instead of deleting the file?
 *
 * `main-context.ts` imports `WallpaperService` from `./wallpaper-service`, and
 * `wallpaper-service.test.ts` imports `playbackFor` / `wallpaperMimeForPath`
 * from `./wallpaper-service`. The barrel avoids touching every consumer while
 * the actual logic is cleanly split into single-responsibility modules.
 */

export { WallpaperService } from './wallpaper/adapter';
export { playbackFor, wallpaperMimeForPath } from './wallpaper/utils';
