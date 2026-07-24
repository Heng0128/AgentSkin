// SPDX-License-Identifier: MPL-2.0

/**
 * # useThemes
 *
 * Manages the installed-themes lifecycle: catalog fetching, search, selection,
 * apply/restore, import (file-open + drag-drop), delete, and export.
 *
 * All theme data comes from the Catalog IPC layer.
 */

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { UiMessages } from '@shared/i18n';
import { APP_META } from '@/components/app-mark';
import { api } from '@/api/agentSkinClient';
import { handleApplyResult } from './apply-result';
import type {
  AgentId,
  AppStatus,
  FileImportConfirmRequest,
  SystemStatus,
  ThemeCatalogItem,
} from '@shared/types';

export type Selection =
  | { kind: 'installed'; theme: ThemeCatalogItem }
  | null;

export interface RestartPrompt {
  themeId: string;
  themeName: string;
  appId: AgentId;
  restartReason?: import('@shared/types').ApplyResponse['restartReason'];
}

/**
 * Discriminated busy-state key. Replaces the loose `string | null` so the
 * literal `'import'` check in the UI is type-safe and the prefixed forms
 * (apply/restore/delete) can't be typo'd without a compile error.
 *
 * Consumers that only need "is anything busy?" check `busy !== null`.
 */
export type BusyKey =
  | 'import'
  | `apply:${string}`
  | `restore:${string}`
  | `delete:${string}`
  | `export:${string}`;

interface UseThemesDeps {
  showToast: (message: string, tone?: 'default' | 'destructive') => void;
  fail: (error: unknown) => void;
  busy: BusyKey | null;
  setBusy: Dispatch<SetStateAction<BusyKey | null>>;
  t: UiMessages;
  status: SystemStatus | null;
  setStatus: (status: SystemStatus | null) => void;
  /** Triggers an IPC status refresh. Used by restoreAll after parallel restores. */
  refreshStatus: () => Promise<void>;
  deletePrompt: ThemeCatalogItem | null;
  setDeletePrompt: (prompt: ThemeCatalogItem | null) => void;
  fileImportPrompt: FileImportConfirmRequest | null;
  setFileImportPrompt: (prompt: FileImportConfirmRequest | null) => void;
  setRestartPrompt: (prompt: RestartPrompt | null) => void;
  /** Activate the video wallpaper bundled with a theme (no-op if the theme
   *  has no wallpaper). Called after a successful apply so the video
   *  background follows the theme. `workshopId` takes precedence over the
   *  theme-bundled video when present. */
  activateThemeWallpaper?: (themeId: string, workshopId?: string) => Promise<void>;
}

export function useThemes(deps: UseThemesDeps) {
  const { showToast, fail, busy, setBusy, t, status, setStatus, refreshStatus,
    deletePrompt, setDeletePrompt, fileImportPrompt, setFileImportPrompt, setRestartPrompt,
    activateThemeWallpaper } = deps;
  const [installed, setInstalled] = useState<ThemeCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);

  const installedById = useMemo(
    () => new Map(installed.map((theme) => [theme.id, theme] as const)),
    [installed],
  );

  const refreshThemes = useCallback(async () => {
    setInstalled((await api.catalog.themes.list()).items);
  }, []);

  // Boot: fetch themes from catalog
  useEffect(() => {
    void refreshThemes().catch(() => undefined).finally(() => setLoading(false));
  }, [refreshThemes]);

  // File-open events
  useEffect(() => {
    const offImported = api.onFileImported(async (result) => {
      await refreshThemes();
      showToast(t.importedTheme(result.theme.displayName));
    });
    const offConfirm = api.onFileImportConfirm(setFileImportPrompt);
    const offFailed = api.onFileImportFailed((message) => {
      showToast(message || t.actionFailed, 'destructive');
    });
    return () => {
      offImported();
      offConfirm();
      offFailed();
    };
  }, [refreshThemes, showToast, t]);

  /**
   * Run an async operation under a busy-state guard: set the busy key, run
   * `fn`, route any throw to `fail`, and always clear busy. Replaces the
   * try/catch/finally boilerplate that was duplicated across 5 actions.
   * Returns fn's result, or `undefined` if fn threw.
   */
  const withBusy = useCallback(async <T>(
    key: BusyKey,
    fn: () => Promise<T>,
  ): Promise<T | undefined> => {
    setBusy(key);
    try {
      return await fn();
    } catch (error) {
      fail(error);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [fail, setBusy]);

  const applyToApp = useCallback(async (
    themeId: string,
    themeName: string,
    appId: AgentId,
    options: { restartExisting?: boolean } = {},
  ) => {
    const result = await withBusy(`apply:${themeId}`, () =>
      api.applyTheme({
        themeId,
        appId,
        restartExisting: options.restartExisting,
      }),
    );
    if (!result) return false;
    setStatus(result.system);
    const outcome = handleApplyResult(result, { themeId, themeName, appId });
    switch (outcome.kind) {
      case 'requires-restart':
        setRestartPrompt({ themeId, themeName, appId, restartReason: outcome.restartReason });
        return false;
      case 'port-occupied':
        showToast(outcome.message, 'destructive');
        return false;
      case 'success':
        showToast(t.themeApplied(themeName));
        // Activate the theme's video wallpaper, if it has one. WorkshopId
        // (Wallpaper Engine reference) takes precedence over a bundled video.
        if (activateThemeWallpaper) {
          const theme = installedById.get(themeId);
          if (theme?.wallpaper) {
            void activateThemeWallpaper(themeId, theme.wallpaper.workshopId).catch(() => undefined);
          }
        }
        return true;
    }
  }, [setStatus, setRestartPrompt, showToast, t, withBusy, activateThemeWallpaper, installedById]);

  // Tray-initiated apply: run the normal apply flow so it surfaces the same
  // toast / restart-confirmation dialog as an in-app apply.
  useEffect(() => {
    const offTrayApply = api.onTrayApply((request) => {
      void applyToApp(request.themeId, request.themeName, request.appId);
    });
    return () => {
      offTrayApply();
    };
  }, [applyToApp]);

  const restoreApp = useCallback(async (appId: AgentId) => {
    const result = await withBusy(`restore:${appId}`, () => api.restoreApp(appId));
    if (!result) return;
    setStatus(result);
    const appName = result.apps.find((a) => a.appId === appId)?.displayName ?? APP_META[appId]?.name ?? appId;
    showToast(t.nativeRestored(appName));
  }, [APP_META, setStatus, showToast, t, withBusy]);

  /**
   * Restore every app that currently has an active theme. Parallel +
   * best-effort — each restore is independent. Replaces the two identical
   * copies that were inlined in WorkspacePage and title-bar.
   */
  const restoreAll = useCallback(async () => {
    const apps = status?.apps ?? [];
    await Promise.all(
      apps
        .filter((app) => app.activeThemeId)
        .map((app) => api.restoreApp(app.appId).catch(() => undefined)),
    );
    await refreshStatus();
  }, [status, refreshStatus]);

  const confirmFileImport = useCallback(async () => {
    const prompt = fileImportPrompt;
    if (!prompt) return;
    setFileImportPrompt(null);
    const result = await withBusy('import', () => api.importThemeFromPath(prompt.path));
    if (!result) return;
    await refreshThemes();
    showToast(t.importedTheme(result.theme.displayName));
  }, [fileImportPrompt, refreshThemes, showToast, t, setFileImportPrompt, withBusy]);

  const dropThemeFiles = useCallback((files: File[]) => {
    for (const file of files) {
      if (!/\.(agenttheme|agentskin-theme|codedrobe-theme|codex-theme)$/.test(file.name)) continue;
      const path = api.getPathForFile(file);
      if (path) void api.openThemeFile(path).catch(fail);
    }
  }, [fail]);

  const exportTheme = useCallback(async (themeId: string) => {
    const result = await withBusy(`export:${themeId}`, () => api.exportTheme(themeId));
    if (result && !result.canceled) showToast(t.packageExported);
  }, [showToast, t, withBusy]);

  const confirmDelete = useCallback(async () => {
    if (!deletePrompt) return;
    const result = await withBusy(`delete:${deletePrompt.id}`, () =>
      api.deleteTheme(deletePrompt.id),
    );
    setDeletePrompt(null);
    if (!result) return;
    await refreshThemes();
    setStatus(result.status);
    setSelection((current) =>
      current?.kind === 'installed' && current.theme.id === deletePrompt.id ? null : current);
    showToast(t.themeDeleted(deletePrompt.name));
  }, [deletePrompt, refreshThemes, setStatus, showToast, t, setSelection, setDeletePrompt, withBusy]);

  return {
    installed,
    installedById,
    selection,
    setSelection,
    applyToApp,
    restoreApp,
    restoreAll,
    exportTheme,
    confirmDelete,
    confirmFileImport,
    dropThemeFiles,
    refreshThemes,
    loading,
  };
}
