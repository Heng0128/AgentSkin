// SPDX-License-Identifier: MPL-2.0

/**
 * # Agent Engine Options
 *
 * Pure helper functions for merging wallpaper render options across the
 * per-agent → global → theme precedence chain.
 *
 * Extracted from `AgentEngineService` (Facade decomposition — options module).
 *
 * These functions are side-effect-free and have no dependency on service state,
 * making them trivial to unit-test in isolation.
 */

import type { WallpaperRenderOptions } from '../../shared/types';

/**
 * Merge two render option sets with a per-field precedence: `base` supplies
 * defaults, `override` wins on any field it sets. Used to resolve the
 * per-agent → global → theme render chain so a partially-configured
 * per-agent setting does not wipe the global default.
 */
export function mergeRenderOptions(
  base: WallpaperRenderOptions | undefined,
  override: WallpaperRenderOptions | undefined,
): WallpaperRenderOptions | undefined {
  if (!override) return base;
  if (!base) return override;
  return { ...base, ...override };
}

/**
 * Fold a theme wallpaper's top-level `speed/loop/scrimOpacity` (legacy fields)
 * into its `render` options. The CDP injector only reads `render` — without
 * this fold, a theme that sets `speed: 2` (but no `render.speed`) would play
 * at 1×. Returns undefined when the wallpaper sets nothing.
 */
export function themeRenderOptions(wp: {
  render?: WallpaperRenderOptions;
  speed?: number;
  loop?: boolean;
  scrimOpacity?: number;
}): WallpaperRenderOptions | undefined {
  if (
    !wp.render &&
    wp.speed === undefined &&
    wp.loop === undefined &&
    wp.scrimOpacity === undefined
  ) {
    return undefined;
  }
  return {
    ...(wp.render ?? {}),
    ...(wp.speed !== undefined ? { speed: wp.speed } : {}),
    ...(wp.loop !== undefined ? { loop: wp.loop } : {}),
    ...(wp.scrimOpacity !== undefined ? { scrimOpacity: wp.scrimOpacity } : {}),
  };
}
