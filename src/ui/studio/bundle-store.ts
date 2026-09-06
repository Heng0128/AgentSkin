// SPDX-License-Identifier: MPL-2.0

/**
 * # bundle-store
 *
 * Workspace-scoped external theme bundle management: list, import+install,
 * install-by-id, delete.
 *
 * Extracted from the monolithic `studioStore.ts` as part of the
 * 5-store decomposition (P1-4 weight reduction).
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';

import { toMessage } from '@shared/errors';
import { type UiMessages, uiMessages } from '@shared/i18n';
import { create } from 'zustand';

/** A workspace-scoped installed bundle summary (theme + optional wallpaper). */
export interface StudioBundle {
  id: string;
  name: string;
  themeId?: string;
  hasWallpaper: boolean;
  createdAt: string;
}

interface BundleState {
  bundles: StudioBundle[];
  bundlesLoading: boolean;

  refreshBundles(): Promise<void>;
  importAndInstallBundle(): Promise<string | null>;
  installBundle(id: string): Promise<void>;
  deleteBundle(id: string): Promise<void>;
}

/** Read current i18n message table (project-standard pattern). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

export const useBundleStore = create<BundleState>()((set, get) => ({
  bundles: [],
  bundlesLoading: false,

  refreshBundles: async () => {
    const showToast = useNotificationStore.getState().showToast;
    set({ bundlesLoading: true });
    try {
      const list = await api.listBundles();
      set({ bundles: list, bundlesLoading: false });
    } catch (e) {
      set({ bundlesLoading: false });
      showToast(currentT().studioBundleRefreshFailed(toMessage(e)), 'destructive');
    }
  },

  importAndInstallBundle: async () => {
    const showToast = useNotificationStore.getState().showToast;
    set({ bundlesLoading: true });
    try {
      const result = await api.importBundle();
      if (!result) {
        set({ bundlesLoading: false });
        return null;
      }
      await get().installBundle(result.id);
      await get().refreshBundles();
      showToast(currentT().studioBundleImportedInstalled(result.name));
      return result.id;
    } catch (e) {
      set({ bundlesLoading: false });
      showToast(currentT().studioBundleImportInstallFailed(toMessage(e)), 'destructive');
      return null;
    }
  },

  installBundle: async (id) => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      const res = await api.installBundleById(id);
      if (!res.ok) {
        showToast(
          currentT().studioBundleInstallFailedDetail(
            res.error ?? currentT().studioBundleUnknownError,
          ),
          'destructive',
        );
      } else {
        showToast(currentT().studioBundleInstalledDone);
      }
    } catch (e) {
      showToast(currentT().studioBundleInstallFailedDetail(toMessage(e)), 'destructive');
    }
  },

  deleteBundle: async (id) => {
    const showToast = useNotificationStore.getState().showToast;
    try {
      const res = await api.deleteBundle(id);
      if (!res.ok) {
        showToast(
          currentT().studioBundleDeleteFailedDetail(
            res.error ?? currentT().studioBundleUnknownError,
          ),
          'destructive',
        );
        return;
      }
      set((s) => ({ bundles: s.bundles.filter((b) => b.id !== id) }));
      showToast(currentT().studioBundleDeletedDone);
    } catch (e) {
      showToast(currentT().studioBundleDeleteFailedDetail(toMessage(e)), 'destructive');
    }
  },
}));
