// SPDX-License-Identifier: MPL-2.0

/**
 * # useThemes
 *
 * Manages the installed-themes lifecycle: catalog fetching, search, selection,
 * apply/restore, import (file-open + drag-drop), delete, and export.
 *
 * All theme data comes from the Catalog IPC layer.
 */

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '@/api/agentSkinClient';
import { APP_META } from '@/components/app-mark';

import type { UiMessages } from '@shared/i18n';
import type {
  AgentId,
  FileImportConfirmRequest,
  SystemStatus,
  ThemeCatalogItem,
} from '@shared/types';
import { handleApplyResult } from './apply-result';

export type Selection = { kind: 'installed'; theme: ThemeCatalogItem } | null;

export interface RestartPrompt {
  themeId: string;
  themeName: string;
  appId: AgentId;
  /** Color-scheme id to re-apply after the confirmed restart. */
  schemeId?: string;
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
  const {
    showToast,
    fail,
    setBusy,
    t,
    status,
    setStatus,
    refreshStatus,
    deletePrompt,
    setDeletePrompt,
    fileImportPrompt,
    setFileImportPrompt,
    setRestartPrompt,
    activateThemeWallpaper,
  } = deps;
  const [installed, setInstalled] = useState<ThemeCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);

  // P1 audit #13: synchronous mutual-exclusion guard for `withBusy`. React
  // state updates are async (batched into the next render tick), so reading
  // `busy` inside `withBusy` would always see the stale closure value — two
  // rapid calls in the same render cycle (tray burst, double-click) would
  // both see `busy === null` and both proceed, racing each other through
  // IPC. The ref is updated synchronously so a duplicate call (same key)
  // bails out immediately. Each key is a distinct operation (e.g. a single
  // app apply), so up to `MAX_CONCURRENCY` independent operations may run at
  // once — applies to different agents no longer block each other.
  const busyKeys = useRef<Set<BusyKey>>(new Set());
  const MAX_CONCURRENCY = 4;

  const installedById = useMemo(
    () => new Map(installed.map((theme) => [theme.id, theme] as const)),
    [installed],
  );

  const refreshThemes = useCallback(async () => {
    try {
      setInstalled((await api.catalog.themes.list()).items);
    } catch (error) {
      // Surface the failure instead of silently leaving a stale/empty list
      // (previously the boot effect swallowed it with .catch(() => undefined)
      // and the file-import listener had no catch at all → unhandled rejection).
      fail(error);
    }
  }, [fail]);

  // Boot: fetch themes from catalog
  useEffect(() => {
    // refreshThemes now reports failures via fail() — no silent swallow.
    void refreshThemes().finally(() => setLoading(false));
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
  }, [refreshThemes, showToast, t, setFileImportPrompt]);

  /**
   * Run an async operation under a busy-state guard: set the busy key, run
   * `fn`, route any throw to `fail`, and always clear busy. Replaces the
   * try/catch/finally boilerplate that was duplicated across 5 actions.
   * Returns fn's result, or `undefined` if fn threw.
   *
   * P1 audit #13: a `busyMutex` ref provides synchronous mutual exclusion.
   * Without it, two rapid calls in the same render cycle would both read
   * `busy === null` from the stale closure and both proceed, racing each
   * other through the IPC layer (double-apply, delete-while-applying, etc.).
   * The ref flips synchronously so the second call is rejected before it
   * reaches the IPC. The state `busy` is still set for UI feedback (spinner,
   * disabled buttons) — it just can't be used as a lock because React
   * batches state updates.
   */
  const withBusy = useCallback(
    async <T>(key: BusyKey, fn: () => Promise<T>): Promise<T | undefined> => {
      if (busyKeys.current.has(key)) {
        // P0#4: Same operation already running — give the user feedback instead
        // of silently returning undefined. A double-click on Apply is the
        // common scenario; no need for a noisy destructive toast.
        const msg = (t as Record<string, unknown>).busyOperationInProgress as string | undefined;
        showToast(msg ?? 'This operation is already running — please wait.');
        return undefined;
      }
      if (busyKeys.current.size >= MAX_CONCURRENCY) {
        // P0#4: Concurrency cap hit — user clicked too many agents/operations.
        // This is actionable feedback instead of the operation "vanishing".
        const msgFn = (t as Record<string, unknown>).busyConcurrencyLimit as
          | ((n: number) => string)
          | undefined;
        showToast(
          msgFn
            ? msgFn(MAX_CONCURRENCY)
            : `Too many operations running (max ${MAX_CONCURRENCY}) — please wait.`,
          'destructive',
        );
        return undefined;
      }
      busyKeys.current.add(key);
      // P1#5: When multiple operations run concurrently, reflect the CURRENT
      // key (the one just added) in busy state, not the [0] oldest. This way
      // the button the user just clicked correctly shows disabled/spinner.
      setBusy(key);
      try {
        return await fn();
      } catch (error) {
        fail(error);
        return undefined;
      } finally {
        busyKeys.current.delete(key);
        // When all settle, clear busy; otherwise keep the UI informed by
        // reflecting the newest remaining key (Set insertion order → last = newest).
        const remaining = Array.from(busyKeys.current);
        setBusy(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      }
    },
    [fail, setBusy, showToast, t],
  );

  const applyToApp = useCallback(
    async (
      themeId: string,
      themeName: string,
      appId: AgentId,
      options: { restartExisting?: boolean; schemeId?: string } = {},
    ) => {
      const result = await withBusy(`apply:${appId}:${themeId}`, async () => {
        // Two-phase CDP discovery: first attempt probes only (no restart).
        // If the agent is running without --remote-debugging-port, the
        // response is `requires-restart` and we show a confirmation dialog.
        // The user must explicitly click "Restart & apply" before the agent
        // is killed + relaunched with CDP — never auto-restart.
        return api.applyTheme({
          themeId,
          appId,
          restartExisting: options.restartExisting,
          schemeId: options.schemeId,
        });
      });
      if (!result) return false;
      // Don't overwrite shared status with this operation's snapshot: with
      // MAX_CONCURRENCY operations in flight, an older completion can land
      // last and regress the status UI. Refresh the authoritative state
      // instead (same as restoreAll).
      await refreshStatus();
      const outcome = handleApplyResult(result, { themeId, themeName, appId });
      switch (outcome.kind) {
        case 'requires-restart':
          setRestartPrompt({
            themeId,
            themeName,
            appId,
            schemeId: options.schemeId,
            restartReason: outcome.restartReason,
          });
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
              void activateThemeWallpaper(themeId, theme.wallpaper.workshopId).catch(
                () => undefined,
              );
            }
          }
          return true;
      }
    },
    [
      setRestartPrompt,
      showToast,
      t,
      withBusy,
      activateThemeWallpaper,
      installedById,
      refreshStatus,
    ],
  );

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

  const restoreApp = useCallback(
    async (appId: AgentId) => {
      const result = await withBusy(`restore:${appId}`, () => api.restoreApp(appId));
      if (!result) return;
      // Same as applyToApp: refresh authoritative status instead of capturing
      // this operation's snapshot, so concurrent restores can't regress it.
      await refreshStatus();
      const appName =
        result.apps.find((a) => a.appId === appId)?.displayName ?? APP_META[appId]?.name ?? appId;
      showToast(t.nativeRestored(appName));
    },
    [showToast, t, withBusy, refreshStatus],
  );

  /**
   * Restore every app that currently has an active theme OR a wallpaper
   * preference. Parallel + best-effort — each restore is independent.
   * Replaces the two identical copies that were inlined in WorkspacePage
   * and title-bar.
   *
   * Surfaces a toast with the success/failure count so the user knows the
   * outcome instead of staring at a silently-refreshing list.
   *
   * P1#9: Wrap each individual restore in `withBusy` so:
   *   - No silent race with single-app restores or applies on the same agent.
   *   - The concurrency cap is enforced (MAX_CONCURRENCY).
   *   - Busy UI state shows during bulk restore (buttons disabled / spinner).
   *   - Any thrown error routes through `fail` instead of being swallowed.
   */
  const restoreAll = useCallback(async () => {
    const apps = status?.apps ?? [];
    const targets = apps.filter((app) => app.activeThemeId);
    if (targets.length === 0) {
      showToast(t.restoreAllNothing);
      return;
    }
    const results = await Promise.all(
      targets.map(async (app) => {
        const result = await withBusy(`restore:${app.appId}`, () => api.restoreApp(app.appId));
        // withBusy returns undefined on: thrown error (logged via fail),
        // same-key collision, or concurrency cap. All three count as failed.
        // Otherwise the SystemStatus return is truthy.
        return result !== undefined;
      }),
    );
    const okCount = results.filter((r) => r).length;
    const failCount = results.length - okCount;
    await refreshStatus();
    if (failCount === 0) {
      showToast(t.restoreAllDone(okCount));
    } else if (okCount === 0) {
      showToast(t.restoreAllFailed, 'destructive');
    } else {
      showToast(t.restoreAllPartial(okCount, failCount), 'destructive');
    }
  }, [status, refreshStatus, showToast, t, withBusy]);

  const confirmFileImport = useCallback(async () => {
    const prompt = fileImportPrompt;
    if (!prompt) return;
    setFileImportPrompt(null);
    const result = await withBusy('import', () => api.importThemeFromPath(prompt.path));
    if (!result) return;
    await refreshThemes();
    showToast(t.importedTheme(result.theme.displayName));
  }, [fileImportPrompt, refreshThemes, showToast, t, setFileImportPrompt, withBusy]);

  const dropThemeFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        if (!/\.(agenttheme|agentskin-theme|codex-theme)$/.test(file.name)) continue;
        const path = api.getPathForFile(file);
        if (path) void api.openThemeFile(path).catch(fail);
      }
    },
    [fail],
  );

  const exportTheme = useCallback(
    async (themeId: string) => {
      const result = await withBusy(`export:${themeId}`, () => api.exportTheme(themeId));
      if (result && !result.canceled) showToast(t.packageExported);
    },
    [showToast, t, withBusy],
  );

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
      current?.kind === 'installed' && current.theme.id === deletePrompt.id ? null : current,
    );
    showToast(t.themeDeleted(deletePrompt.name));
  }, [deletePrompt, refreshThemes, setStatus, showToast, t, setDeletePrompt, withBusy]);

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
