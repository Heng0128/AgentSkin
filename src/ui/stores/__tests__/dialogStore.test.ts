// SPDX-License-Identifier: MPL-2.0

/**
 * # dialogStore — unit tests
 *
 * Covers the dialog/prompt state container:
 * - All 5 prompt setters (restart, wallpaperRestart, launchRestart, delete, fileImport)
 * - Prompt clear (setting back to null)
 * - Independence of prompt fields (setting one doesn't clear others)
 */

import type {
  FileImportConfirmRequest,
  InstalledTheme,
  RestartReason,
  ThemeCatalogItem,
} from '@shared/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDialogStore } from '../dialogStore';

/** Minimal valid ThemeCatalogItem for testing deletePrompt. */
function makeCatalogTheme(id: string, name: string): ThemeCatalogItem {
  return {
    id,
    name,
    version: '1.0.0',
    author: 'Test',
    description: 'Test theme',
    preview: null,
    supportedAgents: ['traework'],
    legacyTargets: [],
    category: 'test',
    tags: [],
    source: 'local',
    installed: true,
  };
}

/** Minimal valid InstalledTheme for testing fileImportPrompt. */
function makeInstalledTheme(id: string, name: string): InstalledTheme {
  return {
    id,
    displayName: name,
    version: '1.0.0',
    supportedAgents: ['traework'],
    coverDataUrl: null,
    tagline: null,
  };
}

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
      const prompt = makeCatalogTheme('theme-1', 'Sakura');

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
        incoming: makeInstalledTheme('theme-1', 'Incoming'),
        existing: makeInstalledTheme('theme-1', 'Existing'),
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
      useDialogStore.getState().setDeletePrompt(makeCatalogTheme('theme-2', 'Ocean'));

      // Both prompts should coexist
      expect(useDialogStore.getState().restartPrompt).not.toBeNull();
      expect(useDialogStore.getState().deletePrompt).not.toBeNull();
    });
  });
});
