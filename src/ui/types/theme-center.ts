// SPDX-License-Identifier: MPL-2.0

/**
 * Theme Center card model — derive-only type.
 *
 * Built from a {@link ThemeCatalogItem} via `toCard()` in `useThemeCenter.ts`.
 * Holds the same display fields as ThemeCatalogItem plus one computed field
 * (`hasWallpaper`). Do NOT add independent data here — extend Omit<> and update
 * the `toCard` mapping instead.
 *
 * ThemeCardModel is for simple contexts (dashboard recent themes).
 * ThemeCenterCardModel adds category, version, installed status, source, and
 * supported agent IDs for the full theme management grid.
 */

import type { AgentId, ThemeCatalogItem, ThemeSource } from '@shared/types';

export interface ThemeCenterCardModel
  extends Omit<
    ThemeCatalogItem,
    'description' | 'legacyTargets' | 'schemes' | 'wallpaper' | 'mode'
  > {
  /** Declared color mode from the theme manifest ('dark' | 'light' | 'auto'). */
  mode: 'dark' | 'light' | 'auto' | null;
  /** Whether this theme bundles a dynamic video wallpaper. */
  hasWallpaper: boolean;
}
