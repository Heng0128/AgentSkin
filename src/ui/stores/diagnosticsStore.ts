// SPDX-License-Identifier: MPL-2.0

/**
 * # diagnosticsStore
 *
 * Diagnostics state — manages IPC timeout events for the PerformancePanel
 * and exposes concurrency-subsystem runtime metrics pushed from the main process
 * every 5 seconds via the `diagnostics:concurrency-metrics` IPC channel.
 *
 * Independent store (no i18n dependency). Pure data layer: the UI reads
 * `timeoutEvents`, `timeoutsLoading`, `timeoutsError`, `concurrencyMetrics`
 * and triggers `loadTimeouts` / `clearTimeouts` / `updateConcurrencyMetrics`
 * through the api client.
 */

import { api } from '@/api/agentSkinClient';

import { create } from 'zustand';

/**
 * Concurrency-subsystem runtime metrics. Each field is a snapshot of the
 * underlying Map/Set size at the moment the main process collected them.
 * Zero for every field indicates a quiescent system.
 *
 * These are pushed from the main process (AgentEngineService) every 5s via
 * `diagnostics:concurrency-metrics` and merged into the store with
 * `updateConcurrencyMetrics`.
 */
export interface ConcurrencyMetrics {
  /** Number of agents currently in the companion-busy guard set (wallpaperStore). */
  companionBusyByAgent: number;
  /** Number of agents with an in-flight apply or restore operation. */
  inflightOperations: number;
  /** Number of agents actively running a self-heal cycle. */
  selfHealingAgents: number;
  /** Number of agents with captured media tokens awaiting epoch-restore. */
  capturedTokens: number;
  /** Current depth of the persistence-write serialisation chain. */
  persistChainDepth: number;
  /** Number of agents with a deferred self-heal thunk awaiting lock release. */
  deferredSelfHeals: number;
  /** Number of agents with an active (un-superseded) environment switch. */
  switchEpochByAgent: number;
}

interface DiagnosticsState {
  timeoutEvents: Array<{ id: string; channel: string; ms: number; timestamp: number }>;
  timeoutsLoading: boolean;
  timeoutsError: string | null;
  concurrencyMetrics: ConcurrencyMetrics;

  loadTimeouts: (count?: number) => Promise<void>;
  clearTimeouts: () => Promise<void>;
  updateConcurrencyMetrics: (metrics: Partial<ConcurrencyMetrics>) => void;
}

const initialConcurrencyMetrics: ConcurrencyMetrics = {
  companionBusyByAgent: 0,
  inflightOperations: 0,
  selfHealingAgents: 0,
  capturedTokens: 0,
  persistChainDepth: 0,
  deferredSelfHeals: 0,
  switchEpochByAgent: 0,
};

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  timeoutEvents: [],
  timeoutsLoading: false,
  timeoutsError: null,
  concurrencyMetrics: initialConcurrencyMetrics,

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

  updateConcurrencyMetrics: (metrics) => {
    set((state) => ({
      concurrencyMetrics: { ...state.concurrencyMetrics, ...metrics },
    }));
  },
}));
