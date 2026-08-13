// SPDX-License-Identifier: MPL-2.0

/**
 * # statusStore
 *
 * System status + status-refresh lifecycle.
 *
 * Extracted from `useAppController` (Phase A2). Owns the live status object,
 * the last-success timestamp, the in-flight refresh flag, and the refresh
 * action itself. Boot progress (parsed per-agent phases) is kept separately
 * (see bootProgressStore) because it is derived from the runtime-log stream.
 */

import { api } from '@/api/agentSkinClient';

import type { SystemStatus } from '@shared/types';
import { create } from 'zustand';

interface StatusState {
  status: SystemStatus | null;
  lastStatusAt: number | null;
  isRefreshing: boolean;
  /** Error message from the last failed refresh, null when last refresh succeeded. */
  error: string | null;

  setStatus: (status: SystemStatus | null) => void;
  refreshStatus: () => Promise<void>;
  /** Clear the error state (e.g., on user-initiated retry). */
  clearError: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  status: null,
  lastStatusAt: null,
  isRefreshing: false,
  error: null,

  setStatus: (status) => set({ status }),
  clearError: () => set({ error: null }),
  refreshStatus: async () => {
    set({ isRefreshing: true, error: null });
    try {
      set({ status: await api.refreshStatus(), lastStatusAt: Date.now(), error: null });
    } catch (err) {
      // Capture the error message so the UI can display a retry prompt.
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
    } finally {
      set({ isRefreshing: false });
    }
  },
}));
