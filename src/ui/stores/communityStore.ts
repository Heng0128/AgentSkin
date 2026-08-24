// SPDX-License-Identifier: MPL-2.0

/**
 * # communityStore
 *
 * UI state management for DreamSkin community themes — the browse tab,
 * download progress, install lifecycle, and cancellation.
 *
 * Mirrors the Zustand pattern used across the app (agentStore, themeStore,
 * settingsStore): data properties first, UI state second, actions last.
 * Cross-store dependencies (notificationStore) are accessed via `getState()`
 * so no React-level prop threading is required.
 *
 * ## IPC events wired at module init
 *
 * The store subscribes to `onCommunityDownloadProgress` once at module load
 * so download progress events are captured perma — not per-component-mount.
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';

import type {
  CommunityThemeSummary,
  CommunityThemeDetail,
  CommunityThemeListParams,
  CommunityThemeListResult,
  DownloadProgress,
  InstallResult,
} from '@shared/types/community';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommunitySortKey = CommunityThemeListParams['sort'];

interface CommunityState {
  // --- Data ---
  themes: CommunityThemeSummary[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: NonNullable<CommunitySortKey>;
  query: string;

  // --- UI state ---
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  selectedThemeId: string | null;
  selectedThemeDetail: CommunityThemeDetail | null;
  detailLoading: boolean;

  // --- Download/install state ---
  downloadProgress: Map<string, DownloadProgress>;
  installingIds: Set<string>;
  installedIds: Set<string>;

  // --- Actions ---
  loadThemes: (params?: Partial<CommunityThemeListParams>) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  setQuery: (query: string) => void;
  setSortBy: (sort: NonNullable<CommunitySortKey>) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  selectTheme: (id: string | null) => void;
  loadThemeDetail: (themeId: string) => Promise<void>;
  installTheme: (themeId: string) => Promise<InstallResult>;
  uninstallTheme: (themeId: string) => Promise<void>;
  cancelInstall: (themeId: string) => Promise<void>;
  markInstalled: (themeId: string) => void;
  updateDownloadProgress: (progress: DownloadProgress) => void;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCommunityStore = create<CommunityState>((set, get) => ({
  // --- Initial state ---
  themes: [],
  total: 0,
  page: 1,
  pageSize: 20,
  sortBy: 'popular',
  query: '',

  loading: false,
  loadingMore: false,
  error: null,
  selectedThemeId: null,
  selectedThemeDetail: null,
  detailLoading: false,

  downloadProgress: new Map(),
  installingIds: new Set(),
  installedIds: new Set(),

  // --- Load theme list ---
  loadThemes: async (params) => {
    set({ loading: true, error: null });

    try {
      const state = get();
      const result = await api.listCommunityThemes({
        page: state.page,
        pageSize: state.pageSize,
        sort: state.sortBy,
        query: state.query || undefined,
        ...params,
      });

      if (result?.success) {
        const data = result.data as CommunityThemeListResult;
        set({
          themes: data.themes,
          total: data.total,
          loading: false,
        });
      } else {
        set({
          error: result?.error || 'Failed to load community themes',
          loading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error while loading themes',
        loading: false,
      });
    }
  },

  // --- Load more (infinite scroll) ---
  loadMore: async () => {
    const { page, pageSize, themes, total, sortBy, query, loadingMore } = get();
    if (themes.length >= total || loadingMore) return;

    set({ loadingMore: true });

    try {
      const result = await api.listCommunityThemes({
        page: page + 1,
        pageSize,
        sort: sortBy,
        query: query || undefined,
      });

      if (result?.success) {
        const data = result.data as CommunityThemeListResult;
        set({
          themes: [...themes, ...data.themes],
          total: data.total,
          page: page + 1,
          loadingMore: false,
        });
      } else {
        set({ loadingMore: false });
      }
    } catch {
      set({ loadingMore: false });
    }
  },

  // --- Refresh the current page ---
  refresh: async () => {
    const { loadThemes, query, sortBy, pageSize, page } = get();
    await loadThemes({ query: query || undefined, sort: sortBy, pageSize, page });
  },

  // --- Search ---
  setQuery: (query) => {
    set({ query, page: 1 });
  },

  setSortBy: async (sort) => {
    set({ sortBy: sort, page: 1 });
    // Reload with new sort
    const state = get();
    await get().loadThemes({ sort, query: state.query || undefined, page: 1, pageSize: state.pageSize });
  },

  setPage: async (page) => {
    set({ page });
    const state = get();
    await get().loadThemes({ page, query: state.query || undefined, sort: state.sortBy, pageSize: state.pageSize });
  },

  // --- Selection ---
  selectTheme: (id) => {
    set({ selectedThemeId: id, selectedThemeDetail: null });
  },

  // --- Load theme detail ---
  loadThemeDetail: async (themeId: string) => {
    set({ detailLoading: true, selectedThemeDetail: null });

    try {
      const result = await api.getCommunityTheme(themeId);
      if (result?.success && result.data) {
        set({
          selectedThemeDetail: result.data,
          detailLoading: false,
        });
      } else {
        set({
          error: result?.error || 'Failed to load theme detail',
          detailLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load detail',
        detailLoading: false,
      });
    }
  },

  // --- Install a community theme ---
  installTheme: async (themeId: string) => {
    const { installingIds } = get();

    if (installingIds.has(themeId)) {
      return { success: false, error: 'Theme is already being installed' };
    }

    // Mark as installing
    const newInstallingIds = new Set(installingIds);
    newInstallingIds.add(themeId);
    set({
      installingIds: newInstallingIds,
      downloadProgress: new Map(get().downloadProgress).set(themeId, {
        themeId,
        phase: 'downloading',
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
      }),
    });

    try {
      const result = await api.downloadCommunityTheme(themeId);

      if (result?.success && result.data?.success) {
        // Mark as installed on success
        const newInstalledIds = new Set(get().installedIds);
        newInstalledIds.add(themeId);

        // Remove from installing
        const stillInstalling = new Set(installingIds);
        stillInstalling.delete(themeId);

        // Clear progress
        const progress = new Map(get().downloadProgress);
        progress.delete(themeId);

        set({
          installedIds: newInstalledIds,
          installingIds: stillInstalling,
          downloadProgress: progress,
        });

        // Notify other parts of the app
        useNotificationStore.getState().showToast(
          result.data.themeId
            ? `Theme "${themeId}" installed successfully`
            : 'Theme installed successfully',
        );

        return result.data;
      } else {
        // Install failed — clean up installing state
        const stillInstalling = new Set(installingIds);
        stillInstalling.delete(themeId);
        const progress = new Map(get().downloadProgress);
        progress.delete(themeId);

        set({
          installingIds: stillInstalling,
          downloadProgress: progress,
        });

        const errorMsg = result?.error || result?.data?.error || 'Installation failed';
        useNotificationStore.getState().fail(errorMsg);

        return {
          success: false,
          error: errorMsg,
        };
      }
    } catch (error) {
      // Exception — clean up
      const stillInstalling = new Set(installingIds);
      stillInstalling.delete(themeId);
      const progress = new Map(get().downloadProgress);
      progress.delete(themeId);

      set({
        installingIds: stillInstalling,
        downloadProgress: progress,
      });

      const errorMsg = error instanceof Error ? error.message : 'Unknown error during installation';
      useNotificationStore.getState().fail(errorMsg);

      return { success: false, error: errorMsg };
    }
  },

  // --- Uninstall a community theme ---
  uninstallTheme: async (themeId: string) => {
    // Remove from installed set (the actual IPC uninstall is handled by the theme install flow)
    const { installedIds } = get();
    const newInstalledIds = new Set(installedIds);
    newInstalledIds.delete(themeId);
    set({ installedIds: newInstalledIds });
  },

  // --- Cancel an in-progress download ---
  cancelInstall: async (themeId: string) => {
    // IPC cancel
    await api.cancelCommunityDownload(themeId);

    // Remove from installing
    const { installingIds, downloadProgress } = get();
    const newInstalling = new Set(installingIds);
    newInstalling.delete(themeId);

    const newProgress = new Map(downloadProgress);
    newProgress.delete(themeId);

    set({
      installingIds: newInstalling,
      downloadProgress: newProgress,
    });
  },

  // --- Mark as installed (external trigger, e.g. re-scan) ---
  markInstalled: (themeId: string) => {
    const { installedIds } = get();
    const newInstalledIds = new Set(installedIds);
    newInstalledIds.add(themeId);
    set({ installedIds: newInstalledIds });
  },

  // --- Update download progress (called by IPC subscription) ---
  updateDownloadProgress: (progress) => {
    const downloadProgress = new Map(get().downloadProgress);
    downloadProgress.set(progress.themeId, progress);
    set({ downloadProgress });
  },

  // --- Clear errors ---
  clearError: () => {
    set({ error: null });
  },
}));

// ---------------------------------------------------------------------------
// Module-level subscriptions
// ---------------------------------------------------------------------------

// Subscribe to download progress events at module init so all components
// automatically see progress updates without per-mount subscriptions.
// This pattern mirrors themeStore's onStatusChanged/onFileImported wiring.

if (typeof window !== 'undefined' && api?.onCommunityDownloadProgress) {
  api.onCommunityDownloadProgress((progress) => {
    useCommunityStore.getState().updateDownloadProgress(progress);
  });
}
