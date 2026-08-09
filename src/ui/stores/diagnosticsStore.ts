// SPDX-License-Identifier: MPL-2.0

/**
 * # diagnosticsStore
 *
 * Diagnostics state — manages IPC timeout events for the PerformancePanel.
 *
 * Independent store (no i18n dependency). Pure data layer: the UI reads
 * `timeoutEvents`, `timeoutsLoading`, `timeoutsError` and triggers
 * `loadTimeouts` / `clearTimeouts` through the api client.
 */

import { api } from '@/api/agentSkinClient';

import { create } from 'zustand';

interface DiagnosticsState {
  timeoutEvents: Array<{ id: string; channel: string; ms: number; timestamp: number }>;
  timeoutsLoading: boolean;
  timeoutsError: string | null;

  loadTimeouts: (count?: number) => Promise<void>;
  clearTimeouts: () => Promise<void>;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  timeoutEvents: [],
  timeoutsLoading: false,
  timeoutsError: null,

  loadTimeouts: async (count = 10) => {
    set({ timeoutsLoading: true, timeoutsError: null });
    try {
      const events = await api.getPerformanceTimeouts(count);
      set({ timeoutEvents: events, timeoutsLoading: false });
    } catch (error) {
      set({
        timeoutsError: error instanceof Error ? error.message : String(error),
        timeoutsLoading: false,
      });
    }
  },

  clearTimeouts: async () => {
    set({ timeoutsLoading: true, timeoutsError: null });
    try {
      await api.clearPerformanceTimeouts();
      set({ timeoutEvents: [], timeoutsLoading: false });
    } catch (error) {
      set({
        timeoutsError: error instanceof Error ? error.message : String(error),
        timeoutsLoading: false,
      });
    }
  },
}));
