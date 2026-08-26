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

import type { HealthCheckReport } from '@shared/types/health-check';
import { create } from 'zustand';
import type { ConcurrencyMetrics } from '../../shared/types/concurrency';
import type { DriftStatus } from '../types/drift-status';

interface MemorySample {
  ts: number;
  heapUsed: number;
  rss: number;
  external: number;
}

interface PerfTrace {
  id: string;
  agentId: string;
  themeId?: string;
  startedAt: number;
  finishedAt: number;
  duration: number;
  success: boolean;
  steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
  error?: string;
}

interface DiagnosticsState {
  timeoutEvents: Array<{ id: string; channel: string; ms: number; timestamp: number }>;
  timeoutsLoading: boolean;
  timeoutsError: string | null;
  concurrencyMetrics: ConcurrencyMetrics;
  /** Per-agent latest theme health-check report pushed from the main process.
   *  Keyed by agentId so switching agents preserves each report independently. */
  healthReportByAgent: Record<string, HealthCheckReport>;
  /** Per-agent drift-detection status pushed from the main process after each
   *  fingerprint capture + drift cycle. Keyed by agentId. */
  driftStatusByAgent: Record<string, DriftStatus>;
  /** Recent memory samples (heap/rss/external) from the main process.
   *  Populated by `loadMemorySamples()`; capped at 60 entries (5 min @ 5s). */
  memorySamples: MemorySample[];
  memoryLoading: boolean;
  memoryError: string | null;
  /** Recent performance traces pushed in real-time from the main process.
   *  Each new trace is prepended; list capped at 50 entries. */
  recentTraces: PerfTrace[];

  loadTimeouts: (count?: number) => Promise<void>;
  clearTimeouts: () => Promise<void>;
  updateConcurrencyMetrics: (metrics: Partial<ConcurrencyMetrics>) => void;
  setHealthReport: (report: HealthCheckReport) => void;
  setDriftReport: (report: DriftStatus) => void;
  /** Increment persistFailures by the failure count carried in the warning. */
  incrementPersistFailures: (count: number) => void;
  /** Load main-process memory samples (heap/rss/external). */
  loadMemorySamples: () => Promise<void>;
  /** Push a real-time trace from the `performance:new-trace` IPC event. */
  pushTrace: (trace: PerfTrace) => void;
}

const initialConcurrencyMetrics: ConcurrencyMetrics = {
  companionBusyByAgent: 0,
  inflightOperations: 0,
  selfHealingAgents: 0,
  capturedTokens: 0,
  persistChainDepth: 0,
  deferredSelfHeals: 0,
  switchEpochByAgent: 0,
  persistFailures: 0,
};

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  timeoutEvents: [],
  timeoutsLoading: false,
  timeoutsError: null,
  concurrencyMetrics: initialConcurrencyMetrics,
  healthReportByAgent: {},
  driftStatusByAgent: {},
  memorySamples: [],
  memoryLoading: false,
  memoryError: null,
  recentTraces: [],

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

  setHealthReport: (report) => {
    set((s) => ({
      healthReportByAgent: {
        ...s.healthReportByAgent,
        [report.agentId]: report,
      },
    }));
  },

  setDriftReport: (report) => {
    set((s) => ({
      driftStatusByAgent: {
        ...s.driftStatusByAgent,
        [report.agentId]: report,
      },
    }));
  },

  incrementPersistFailures: (count) => {
    set((state) => ({
      concurrencyMetrics: {
        ...state.concurrencyMetrics,
        persistFailures: state.concurrencyMetrics.persistFailures + count,
      },
    }));
  },

  loadMemorySamples: async () => {
    set({ memoryLoading: true, memoryError: null });
    try {
      const samples = await api.getPerformanceMemory();
      set({ memorySamples: samples, memoryLoading: false });
    } catch (error) {
      set({
        memoryError: error instanceof Error ? error.message : String(error),
        memoryLoading: false,
      });
    }
  },

  pushTrace: (trace) => {
    set((state) => ({
      recentTraces: [trace, ...state.recentTraces].slice(0, 50),
    }));
  },
}));
