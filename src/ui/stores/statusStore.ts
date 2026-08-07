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

  setStatus: (status: SystemStatus | null) => void;
  refreshStatus: () => Promise<void>;
}

export const useStatusStore = create<StatusState>((set) => ({
  status: null,
  lastStatusAt: null,
  isRefreshing: false,

  setStatus: (status) => set({ status }),
  refreshStatus: async () => {
    set({ isRefreshing: true });
    try {
      set({ status: await api.refreshStatus(), lastStatusAt: Date.now() });
    } catch {
      /* transient */
    } finally {
      set({ isRefreshing: false });
    }
  },
}));
