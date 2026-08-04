// SPDX-License-Identifier: MPL-2.0

/** Owns all dialog/prompt state — centralized so any hook can set a prompt. */

import { useState } from 'react';

import type { AgentId, FileImportConfirmRequest, ThemeCatalogItem } from '@shared/types';
import type { RestartPrompt } from './useThemes';

/** Wallpaper restart prompt — shown when a wallpaper apply returns
 *  `requires-restart`. The user must explicitly confirm before the agent
 *  is killed + relaunched (or launched from its install path) with CDP. */
export interface WallpaperRestartPrompt {
  appId: AgentId;
  /** The specific wallpaper id to apply after restart, if set.
   *  When undefined, applies the agent's resolved wallpaper (from
   *  per-agent setting or theme-bundled). */
  wallpaperId?: string;
  /** Structured reason (not-installed / not-running / no-cdp / …) so the
   *  dialog can show specific guidance and hide the restart button when a
   *  restart/launch cannot help (mirrors the theme apply dialog). */
  restartReason?: import('@shared/types').RestartReason;
}

export function useDialogs() {
  const [restartPrompt, setRestartPrompt] = useState<RestartPrompt | null>(null);
  const [wallpaperRestartPrompt, setWallpaperRestartPrompt] =
    useState<WallpaperRestartPrompt | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<ThemeCatalogItem | null>(null);
  const [fileImportPrompt, setFileImportPrompt] = useState<FileImportConfirmRequest | null>(null);

  return {
    restartPrompt,
    setRestartPrompt,
    wallpaperRestartPrompt,
    setWallpaperRestartPrompt,
    deletePrompt,
    setDeletePrompt,
    fileImportPrompt,
    setFileImportPrompt,
  };
}
