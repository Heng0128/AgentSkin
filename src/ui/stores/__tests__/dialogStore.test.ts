// SPDX-License-Identifier: MPL-2.0

/**
 * # dialogStore — unit tests
 *
 * Covers the dialog/prompt state container:
 * - All 5 prompt setters (restart, wallpaperRestart, launchRestart, delete, fileImport)
 * - Prompt clear (setting back to null)
 * - Independence of prompt fields (setting one doesn't clear others)
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { FileImportConfirmRequest, RestartReason } from '@shared/types';
import { useDialogStore } from '../dialogStore';

describe('dialogStore', () => {
  beforeEach(() => {
    // Reset all prompts to null
    useDialogStore.setState({
      restartPrompt: null,
      wallpaperRestartPrompt: null,
      launchRestartPrompt: null,
      deletePrompt: null,
      fileImportPrompt: null,
    });
  });

  describe('restartPrompt', () => {
    it('should set and clear restart prompt', () => {
      const prompt = {
        themeId: 'theme-1',
        themeName: 'Sakura',
        appId: 'traework' as const,
        schemeId: 'light',
        restartReason: 'port-occupied' as RestartReason,
      };

      useDialogStore.getState().setRestartPrompt(prompt);
      expect(useDialogStore.getState().restartPrompt).toEqual(prompt);

      useDialogStore.getState().setRestartPrompt(null);
      expect(useDialogStore.getState().restartPrompt).toBeNull();
    });
  });

  describe('wallpaperRestartPrompt', () => {
    it('should set and clear wallpaper restart prompt', () => {
      const prompt = {
        appId: 'qoderwork' as const,
        wallpaperId: 'wp-123',
        restartReason: 'needs-restart' as RestartReason,
      };

      useDialogStore.getState().setWallpaperRestartPrompt(prompt);
      expect(useDialogStore.getState().wallpaperRestartPrompt).toEqual(prompt);

      useDialogStore.getState().setWallpaperRestartPrompt(null);
      expect(useDialogStore.getState().wallpaperRestartPrompt).toBeNull();
    });
  });

  describe('launchRestartPrompt', () => {
    it('should set and clear launch restart prompt', () => {
      const prompt = {
        appId: 'app-hash-123',
        name: 'My App',
        message: 'Port not available',
      };

      useDialogStore.getState().setLaunchRestartPrompt(prompt);
      expect(useDialogStore.getState().launchRestartPrompt).toEqual(prompt);

      useDialogStore.getState().setLaunchRestartPrompt(null);
      expect(useDialogStore.getState().launchRestartPrompt).toBeNull();
    });
  });

  describe('deletePrompt', () => {
    it('should set and clear delete prompt', () => {
      const prompt = {
        id: 'theme-1',
        name: 'Sakura',
      } as const;

      useDialogStore.getState().setDeletePrompt(prompt);
      expect(useDialogStore.getState().deletePrompt).toEqual(prompt);

      useDialogStore.getState().setDeletePrompt(null);
      expect(useDialogStore.getState().deletePrompt).toBeNull();
    });
  });

  describe('fileImportPrompt', () => {
    it('should set and clear file import prompt', () => {
      const prompt: FileImportConfirmRequest = {
        path: '/tmp/test.theme',
        name: 'test.theme',
      };

      useDialogStore.getState().setFileImportPrompt(prompt);
      expect(useDialogStore.getState().fileImportPrompt).toEqual(prompt);

      useDialogStore.getState().setFileImportPrompt(null);
      expect(useDialogStore.getState().fileImportPrompt).toBeNull();
    });
  });

  describe('prompt independence', () => {
    it('should not clear other prompts when setting one', () => {
      useDialogStore.getState().setRestartPrompt({
        themeId: 'theme-1',
        themeName: 'Sakura',
        appId: 'traework' as const,
      });
      useDialogStore.getState().setDeletePrompt({
        id: 'theme-2',
        name: 'Ocean',
      } as const);

      // Both prompts should coexist
      expect(useDialogStore.getState().restartPrompt).not.toBeNull();
      expect(useDialogStore.getState().deletePrompt).not.toBeNull();
    });
  });
});
