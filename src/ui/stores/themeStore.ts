// SPDX-License-Identifier: MPL-2.0

/**
 * # themeStore
 *
 * Manages the installed-themes lifecycle: catalog fetching, search, selection,
 * apply/restore, import (file-open + drag-drop), delete, and export.
 *
 * Extracted from `useThemes` (Phase A3). Cross-store dependencies
 * (notificationStore, statusStore, dialogStore, wallpaperStore) are accessed
 * via `getState()` so no React-level prop threading is required.
 *
 * ## IPC events wired at boot
 *
 * The store subscribes to agentSkin IPC events inside `create()` so that
 * file-open, tray-apply, and file-import-confirm events are captured once at
 * module lifecycle — not per-component-mount. Cancellation functions are
 * stashed and returned from `unsubscribe()` for app shutdown.
 */

import { api } from '@/api/agentSkinClient';
import { APP_META } from '@/components/app-mark';
import { useDialogStore } from '@/stores/dialogStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useWallpaperStore } from '@/stores/wallpaperStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import type { AgentId, ThemeCatalogItem } from '@shared/types';
import { create } from 'zustand';
import { handleApplyResult } from '../hooks/apply-result';
import type { RestartPrompt } from './dialogStore';
import { withImportLock } from './import-guard';

export type Selection = { kind: 'installed'; theme: ThemeCatalogItem } | null;

/**
 * Discriminated busy-state key. Replaces the loose `string | null` so the
 * literal `'import'` check in the UI is type-safe.
 */
export type BusyKey =
  | 'import'
  | `apply:${string}`
  | `restore:${string}`
  | `delete:${string}`
  | `export:${string}`
  | `bundle:${string}`;

/** Build the i18n dictionary for the current locale. */
function currentT(): UiMessages {
  const locale = useShellStore.getState().locale;
  return uiMessages[locale];
}

/**
 * Run an async operation under a busy-state guard: set the busy key, run
 * `fn`, route any throw to `fail`, and always clear busy. Replaces the
 * try/catch/finally boilerplate that was duplicated across 5 actions.
 *
 * A `busyKeys` Set provides synchronous mutual exclusion. React state
 * updates are async (batched into the next render tick), so reading `busy`
 * inside `withBusy` would always see the stale closure value — two rapid
 * calls in the same render cycle (tray burst, double-click) would both see
 * `busy === null` and both proceed, racing each other through IPC. The Set
 * is updated synchronously so a duplicate call bails out immediately. The
 * state `busy` is still set for UI feedback (spinner, disabled buttons).
 *
 * Each key is a distinct operation (e.g. a per-agent apply), so up to
 * `MAX_CONCURRENCY` independent operations may run at once — applies to
 * different agents no longer block each other.
 */
const busyKeys = new Set<BusyKey>();
// The product supports 6 agents; raising the global concurrency cap to 6 lets
// "apply to all agents" inject every agent in parallel instead of dropping
// the surplus ones (withBusy now queues rather than rejects, but a cap of < 6
// would still serialize the last couple of applies unnecessarily).
const MAX_CONCURRENCY = 6;

/** Maximum time (ms) to wait for a concurrency slot in withBusy before giving
 *  up and surfacing a notification. Prevents the queue from hanging forever if
 *  a slot never frees (e.g. an apply that never settles). */
const MAX_BUSY_WAIT_MS = 60_000;

// ---------------------------------------------------------------------------
// state shape
// ---------------------------------------------------------------------------

interface ThemeState {
  installed: ThemeCatalogItem[];
  loading: boolean;
  selection: Selection;
  busy: BusyKey | null;

  // --- queries ---
  installedById: (id: string) => ThemeCatalogItem | undefined;
  setSelection: (sel: Selection) => void;

  // --- lifecycle ---
  /** Fetch themes from IPC; reports failures via notificationStore. */
  refreshThemes: () => Promise<void>;
  /** Wire IPC events (file-open, file-import-confirm, tray-apply). */
  unsubscribe: () => void;

  // --- mutations ---
  applyToApp: (
    themeId: string,
    themeName: string,
    appId: AgentId,
    options?: { restartExisting?: boolean; schemeId?: string },
  ) => Promise<boolean>;
  restoreApp: (appId: AgentId) => Promise<void>;
  restoreAll: () => Promise<void>;
  exportTheme: (themeId: string) => Promise<void>;
  createBundle: (themeId: string) => Promise<void>;
  confirmDelete: () => Promise<void>;
  confirmFileImport: () => Promise<void>;
  dropThemeFiles: (files: File[]) => void;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useThemeStore = create<ThemeState>((set, get) => {
  // --- ipc cancelers (filled inside create, called by unsubscribe) ---
  let offFileImported: (() => void) | null = null;
  let offFileImportConfirm: (() => void) | null = null;
  let offFileImportFailed: (() => void) | null = null;
  let offTrayApply: (() => void) | null = null;

  // Idempotent: HMR / repeated create() should not accumulate listeners.
  // If a previous create() round registered cancelers, unsubscribe them first
  // so the old closures are off'd before new ones are attached.
  function unsubscribe() {
    offFileImported?.();
    offFileImportConfirm?.();
    offFileImportFailed?.();
    offTrayApply?.();
    offFileImported = null;
    offFileImportConfirm = null;
    offFileImportFailed = null;
    offTrayApply = null;
  }

  if (offFileImported) unsubscribe();

  // Wire IPC subscriptions at module load — mirrors useThemes' boot effect.
  // `get()` is safe to call here; zustand closures capture bound selectors.
  offFileImported = api.onFileImported(async (result) => {
    await get().refreshThemes();
    useNotificationStore.getState().showToast(currentT().importedTheme(result.theme.displayName));
  });
  offFileImportConfirm = api.onFileImportConfirm(useDialogStore.getState().setFileImportPrompt);
  offFileImportFailed = api.onFileImportFailed((message) => {
    useNotificationStore.getState().showToast(message || currentT().actionFailed, 'destructive');
  });
  offTrayApply = api.onTrayApply((request) => {
    void get().applyToApp(request.themeId, request.themeName, request.appId);
  });

  return {
    installed: [],
    loading: true,
    selection: null,
    busy: null,

    installedById: (id) => get().installed.find((theme) => theme.id === id),
    setSelection: (selection) => set({ selection }),

    refreshThemes: async () => {
      try {
        set({ installed: (await api.catalog.themes.list()).items });
      } catch (error) {
        // Surface the failure instead of silently leaving a stale/empty list.
        useNotificationStore.getState().fail(error);
      }
    },

    unsubscribe,

    applyToApp: async (themeId, themeName, appId, options = {}) => {
      const { setRestartPrompt } = useDialogStore.getState();
      const t = currentT();

      const result = await withBusy(`apply:${appId}:${themeId}`, async () => {
        // Two-phase CDP discovery: first attempt probes only (no restart).
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
      // last and regress the status UI. Refresh the authoritative state instead.
      await useStatusStore.getState().refreshStatus();

      const outcome = handleApplyResult(result, { themeId, themeName, appId });
      switch (outcome.kind) {
        case 'requires-restart':
          setRestartPrompt({
            themeId,
            themeName,
            appId,
            schemeId: options.schemeId,
            restartReason: outcome.restartReason,
          } satisfies RestartPrompt);
          return false;
        case 'port-occupied':
          useNotificationStore.getState().showToast(outcome.message, 'destructive');
          return false;
        case 'success': {
          useNotificationStore.getState().showToast(t.themeApplied(themeName));
          // Activate the theme's bundled wallpaper, if it has one.
          // Pass appId so the wallpaper follows the theme: per-agent
          // preference is persisted and CDP injection is triggered.
          const theme = get().installedById(themeId);
          if (theme?.wallpaper) {
            void useWallpaperStore
              .getState()
              .activateThemeWallpaper(themeId, theme.wallpaper.workshopId, appId)
              .catch(() => undefined);
          }
          return true;
        }
        case 'unknown-status':
          // Unknown status from main process — treat as transient failure.
          useNotificationStore
            .getState()
            .showToast(t.themeApplyUnexpectedStatus(outcome.status), 'destructive');
          return false;
      }
      // Exhaustiveness fallback — handleApplyResult returns all kinds above,
      // but TS control flow across await boundaries needs this.
      return false as never;
    },

    restoreApp: async (appId) => {
      const t = currentT();
      const result = await withBusy(`restore:${appId}`, () => api.restoreApp(appId));
      if (!result) return;
      // Same as applyToApp: refresh authoritative status.
      await useStatusStore.getState().refreshStatus();
      const appName =
        result.apps.find((a) => a.appId === appId)?.displayName ?? APP_META[appId]?.name ?? appId;
      useNotificationStore.getState().showToast(t.nativeRestored(appName));
    },

    restoreAll: async () => {
      const t = currentT();
      const status = useStatusStore.getState().status;
      const apps = status?.apps ?? [];
      const targets = apps.filter((app) => app.activeThemeId);
      if (targets.length === 0) {
        useNotificationStore.getState().showToast(t.restoreAllNothing);
        return;
      }
      const results = await Promise.all(
        targets.map(async (app) => {
          const result = await withBusy(`restore:${app.appId}`, () => api.restoreApp(app.appId));
          // withBusy returns undefined on: thrown error (logged via fail),
          // same-key collision, or concurrency cap.
          return result !== undefined;
        }),
      );
      const okCount = results.filter((r) => r).length;
      const failCount = results.length - okCount;
      await useStatusStore.getState().refreshStatus();
      if (failCount === 0) {
        useNotificationStore.getState().showToast(t.restoreAllDone(okCount));
      } else if (okCount === 0) {
        useNotificationStore.getState().showToast(t.restoreAllFailed, 'destructive');
      } else {
        useNotificationStore
          .getState()
          .showToast(t.restoreAllPartial(okCount, failCount), 'destructive');
      }
    },

    confirmFileImport: async () => {
      const { fileImportPrompt, setFileImportPrompt } = useDialogStore.getState();
      const t = currentT();
      if (!fileImportPrompt) return;
      const targetPath = fileImportPrompt.path;
      setFileImportPrompt(null);
      const didAcquire = await withImportLock(targetPath, async () => {
        const result = await withBusy('import', () => api.importThemeFromPath(targetPath));
        if (!result) return;
        await get().refreshThemes();
        useNotificationStore.getState().showToast(t.importedTheme(result.theme.displayName));
      });
      if (!didAcquire) {
        // Another store is already importing this same path — refresh the
        // catalog in case the other side finished before we checked, but
        // skip the IPC and the toast to avoid duplicate entries / alerts.
        void get().refreshThemes();
      }
    },

    dropThemeFiles: (files) => {
      for (const file of files) {
        if (!/\.(agenttheme|agentskin-theme|codex-theme)$/.test(file.name)) continue;
        const path = api.getPathForFile(file);
        if (path) void api.openThemeFile(path).catch(useNotificationStore.getState().fail);
      }
    },

    exportTheme: async (themeId) => {
      const t = currentT();
      const result = await withBusy(`export:${themeId}`, () => api.exportTheme(themeId));
      if (result && !result.canceled) useNotificationStore.getState().showToast(t.packageExported);
    },

    createBundle: async (themeId) => {
      const t = currentT();
      const result = await withBusy(`bundle:${themeId}`, () => api.createBundle(themeId));
      if (result && !result.canceled) useNotificationStore.getState().showToast(t.bundleExported);
    },

    confirmDelete: async () => {
      const { deletePrompt, setDeletePrompt } = useDialogStore.getState();
      const t = currentT();
      if (!deletePrompt) return;
      const theme = deletePrompt;
      const result = await withBusy(`delete:${theme.id}`, () => api.deleteTheme(theme.id));
      setDeletePrompt(null);
      if (!result) return;
      await get().refreshThemes();
      useStatusStore.getState().setStatus(result.status);
      set((current) =>
        current.selection?.kind === 'installed' && current.selection.theme.id === theme.id
          ? { selection: null }
          : {},
      );
      useNotificationStore.getState().showToast(t.themeDeleted(theme.name));
    },
  };
});

/** Run `fn` under a busy-key guard (see module docblock). */
async function withBusy<T>(key: BusyKey, fn: () => Promise<T>): Promise<T | undefined> {
  const t = currentT();
  if (busyKeys.has(key)) {
    useNotificationStore.getState().showToast(t.busyOperationInProgress);
    return undefined;
  }
  // If the concurrency limit is reached, WAIT for a slot instead of silently
  // dropping the operation. Previously this returned `undefined` immediately,
  // which made "apply to all agents" (6 applies) silently skip the 5th/6th
  // agent whenever 4 were already in flight — the user saw no error and no
  // injection. Waiting guarantees every queued operation eventually runs.
  let elapsed = 0;
  while (busyKeys.size >= MAX_CONCURRENCY) {
    if (elapsed >= MAX_BUSY_WAIT_MS) {
      useNotificationStore.getState().fail(t.busyTimeout);
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    elapsed += 50;
  }
  busyKeys.add(key);
  useThemeStore.setState({ busy: key });
  try {
    return await fn();
  } catch (error) {
    useNotificationStore.getState().fail(error);
    return undefined;
  } finally {
    busyKeys.delete(key);
    const remaining = Array.from(busyKeys);
    useThemeStore.setState({
      busy: remaining.length > 0 ? remaining[remaining.length - 1] : null,
    });
  }
}
