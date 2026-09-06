// SPDX-License-Identifier: MPL-2.0

/**
 * # dialogStore
 *
 * All dialog/prompt UI state — centralized so any action can set a prompt
 * from anywhere (theme apply, wallpaper apply, file import, ...).
 *
 * Extracted from `useDialogs` (Phase A3 of the UI architecture refactor).
 * Holds no domain logic — only the prompt descriptors that DialogsHost
 * renders from.
 */

import type {
  AgentId,
  FileImportConfirmRequest,
  RestartReason,
  ThemeCatalogItem,
} from '@shared/types';
import { create } from 'zustand';

export interface RestartPrompt {
  themeId: string;
  themeName: string;
  appId: AgentId;
  /** Color-scheme id to re-apply after the confirmed restart. */
  schemeId?: string;
  restartReason?: RestartReason;
}

export interface WallpaperRestartPrompt {
  appId: AgentId;
  /** The specific wallpaper id to apply after restart, if set. */
  wallpaperId?: string;
  /** Structured reason so the dialog can show specific guidance. */
  restartReason?: RestartReason;
}

/** Launch-flow restart prompt (RFC 2026-08-19 R5): a scanned Electron app
 *  needs a restart to enable its debug port. Unlike the theme/wallpaper
 *  restart prompts, the action re-launches the app (forceRestart) rather
 *  than re-applying a theme. */
export interface LaunchRestartPrompt {
  /** Scanned-app id (exePath hash — NOT an AgentId; may be un-adapted). */
  appId: string;
  /** User-facing product name. */
  name: string;
  /** Message from the launcher explaining why a restart is needed. */
  message: string;
}

interface DialogState {
  restartPrompt: RestartPrompt | null;
  wallpaperRestartPrompt: WallpaperRestartPrompt | null;
  launchRestartPrompt: LaunchRestartPrompt | null;
  deletePrompt: ThemeCatalogItem | null;
  fileImportPrompt: FileImportConfirmRequest | null;
  /** Restore-all confirmation prompt — set to the active injection count to confirm. */
  restoreAllPrompt: number | null;

  // --- setters ---
  setRestartPrompt: (prompt: RestartPrompt | null) => void;
  setWallpaperRestartPrompt: (prompt: WallpaperRestartPrompt | null) => void;
  setLaunchRestartPrompt: (prompt: LaunchRestartPrompt | null) => void;
  setDeletePrompt: (prompt: ThemeCatalogItem | null) => void;
  setFileImportPrompt: (prompt: FileImportConfirmRequest | null) => void;
  /** Set to active injection count to show confirmation; null to dismiss. */
  setRestoreAllPrompt: (count: number | null) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  restartPrompt: null,
  wallpaperRestartPrompt: null,
  launchRestartPrompt: null,
  deletePrompt: null,
  fileImportPrompt: null,
  restoreAllPrompt: null,

  setRestartPrompt: (restartPrompt) => set({ restartPrompt }),
  setWallpaperRestartPrompt: (wallpaperRestartPrompt) => set({ wallpaperRestartPrompt }),
  setLaunchRestartPrompt: (launchRestartPrompt) => set({ launchRestartPrompt }),
  setDeletePrompt: (deletePrompt) => set({ deletePrompt }),
  setFileImportPrompt: (fileImportPrompt) => set({ fileImportPrompt }),
  setRestoreAllPrompt: (restoreAllPrompt) => set({ restoreAllPrompt }),
}));
