// SPDX-License-Identifier: MPL-2.0

/**
 * Theme Center card model — richer than ThemeCardModel.
 *
 * ThemeCardModel is for simple contexts (dashboard recent themes).
 * ThemeCenterCardModel adds category, version, installed status, source, and
 * supported agent IDs for the full theme management grid.
 */

import type { AgentId, ThemeSource } from '@shared/types';

export interface ThemeCenterCardModel {
  id: string;
  name: string;
  preview: string | null;
  icon: string | null;
  author: string;
  version: string;
  tags: string[];
  category: string;
  /** Declared color mode from the theme manifest ('dark' | 'light' | 'auto'). */
  mode: 'dark' | 'light' | 'auto' | null;
  /** Agent IDs this theme supports (e.g. ['traework', 'qoderwork']). */
  supportedAgents: AgentId[];
  installed: boolean;
  source: ThemeSource;
  /** Whether this theme bundles a dynamic video wallpaper. */
  hasWallpaper: boolean;
}
