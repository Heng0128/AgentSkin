// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper render CSS helpers (renderer-side)
 *
 * Thin re-export. The pure helpers now live in `@shared/wallpaper-render`
 * so the desktop UI background and the CDP wallpaper injectors share the
 * exact same mapping without the renderer importing from `src/main/`.
 */

export * from '@shared/wallpaper-render';
