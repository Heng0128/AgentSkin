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
import { dialogEvents } from './dialog-events';

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

interface DialogState {
  restartPrompt: RestartPrompt | null;
  wallpaperRestartPrompt: WallpaperRestartPrompt | null;
  deletePrompt: ThemeCatalogItem | null;
  fileImportPrompt: FileImportConfirmRequest | null;

  // --- setters ---
  setRestartPrompt: (prompt: RestartPrompt | null) => void;
  setWallpaperRestartPrompt: (prompt: WallpaperRestartPrompt | null) => void;
  setDeletePrompt: (prompt: ThemeCatalogItem | null) => void;
  setFileImportPrompt: (prompt: FileImportConfirmRequest | null) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  restartPrompt: null,
  wallpaperRestartPrompt: null,
  deletePrompt: null,
  fileImportPrompt: null,

  setRestartPrompt: (restartPrompt) => {
    set({ restartPrompt });
    dialogEvents.emit('restart-prompt', restartPrompt);
  },
  setWallpaperRestartPrompt: (wallpaperRestartPrompt) => {
    set({ wallpaperRestartPrompt });
    dialogEvents.emit('wallpaper-restart-prompt', wallpaperRestartPrompt);
  },
  setDeletePrompt: (deletePrompt) => {
    set({ deletePrompt });
    dialogEvents.emit('delete-prompt', deletePrompt);
  },
  setFileImportPrompt: (fileImportPrompt) => {
    set({ fileImportPrompt });
    dialogEvents.emit('file-import-prompt', fileImportPrompt);
  },
}));
