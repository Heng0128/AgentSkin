// SPDX-License-Identifier: MPL-2.0

/**
 * # visualAnalysisStore
 *
 * Visual Analysis state — manages the visual analysis workflow:
 *   1. List available analysis targets (agent names with stored snapshots)
 *   2. Get a specific target's analysis data
 *   3. Detect if an agent is currently running (for live analysis)
 *   4. List all analysis summaries (for the overview grid)
 *   5. Export an analysis result as a theme package
 *   6. Subscribe to real-time analysis progress events
 *
 * Independent store (no i18n dependency). Pure data layer.
 */

import { api } from '@/api/agentSkinClient';

import { create } from 'zustand';

interface VisualAnalysisProgress {
  agent: string;
  step: string;
  progress: number;
}

interface VisualAnalysisState {
  /** List of agent names that have stored analysis data. */
  targets: string[];
  /** List of all analysis summaries (compact view). */
  summaries: import('@shared/types').VisualAnalysisSummary[];
  /** Currently selected target's detailed analysis data. */
  currentTarget: Record<string, unknown> | null;
  /** Detection result: is the named agent currently running? */
  detection: { agent: string; running: boolean; port?: number; title?: string } | null;
  /** Real-time progress events from the main process. */
  progress: VisualAnalysisProgress | null;
  /** Loading flags for each operation. */
  loading: {
    targets: boolean;
    summaries: boolean;
    target: boolean;
    detect: boolean;
    export: boolean;
  };
  /** Error messages. */
  errors: {
    targets: string | null;
    summaries: string | null;
    target: string | null;
    detect: string | null;
    export: string | null;
  };
  /** Last export result. */
  exportResult: { ok: boolean; path?: string } | null;

  /** Load the list of available analysis targets. */
  loadTargets: () => Promise<void>;
  /** Load all analysis summaries. */
  loadSummaries: () => Promise<void>;
  /** Get detailed analysis data for a specific agent. */
  loadTarget: (agentName: string) => Promise<void>;
  /** Detect if an agent is currently running. */
  detectAgent: (agentName: string) => Promise<void>;
  /** Export an analysis result as a theme package. */
  exportTheme: (agentName: string, themeData: Record<string, unknown>) => Promise<void>;
  /** Set real-time progress from the IPC subscription. */
  setProgress: (progress: VisualAnalysisProgress | null) => void;
  /** Reset all state. */
  reset: () => void;
}

const initialLoading = {
  targets: false,
  summaries: false,
  target: false,
  detect: false,
  export: false,
};

const initialErrors = {
  targets: null,
  summaries: null,
  target: null,
  detect: null,
  export: null,
};

export const useVisualAnalysisStore = create<VisualAnalysisState>((set) => ({
  targets: [],
  summaries: [],
  currentTarget: null,
  detection: null,
  progress: null,
  loading: initialLoading,
  errors: initialErrors,
  exportResult: null,

  loadTargets: async () => {
    set((s) => ({
      loading: { ...s.loading, targets: true },
      errors: { ...s.errors, targets: null },
    }));
    try {
      const targets = await api.listVisualAnalysisTargets();
      set((s) => ({ targets, loading: { ...s.loading, targets: false } }));
    } catch (error) {
      set((s) => ({
        errors: { ...s.errors, targets: error instanceof Error ? error.message : String(error) },
        loading: { ...s.loading, targets: false },
      }));
    }
  },

  loadSummaries: async () => {
    set((s) => ({
      loading: { ...s.loading, summaries: true },
      errors: { ...s.errors, summaries: null },
    }));
    try {
      const summaries = await api.listVisualAnalysisSummaries();
      set((s) => ({ summaries, loading: { ...s.loading, summaries: false } }));
    } catch (error) {
      set((s) => ({
        errors: { ...s.errors, summaries: error instanceof Error ? error.message : String(error) },
        loading: { ...s.loading, summaries: false },
      }));
    }
  },

  loadTarget: async (agentName) => {
    set((s) => ({
      loading: { ...s.loading, target: true },
      errors: { ...s.errors, target: null },
    }));
    try {
      const target = await api.getVisualAnalysisTarget(agentName);
      set((s) => ({
        currentTarget: target,
        loading: { ...s.loading, target: false },
      }));
    } catch (error) {
      set((s) => ({
        errors: { ...s.errors, target: error instanceof Error ? error.message : String(error) },
        loading: { ...s.loading, target: false },
      }));
    }
  },

  detectAgent: async (agentName) => {
    set((s) => ({
      loading: { ...s.loading, detect: true },
      errors: { ...s.errors, detect: null },
    }));
    try {
      const detection = await api.detectVisualAnalysisAgent(agentName);
      set((s) => ({
        detection: { agent: agentName, ...detection },
        loading: { ...s.loading, detect: false },
      }));
    } catch (error) {
      set((s) => ({
        errors: { ...s.errors, detect: error instanceof Error ? error.message : String(error) },
        loading: { ...s.loading, detect: false },
      }));
    }
  },

  exportTheme: async (agentName, themeData) => {
    set((s) => ({
      loading: { ...s.loading, export: true },
      errors: { ...s.errors, export: null },
    }));
    try {
      const result = await api.exportVisualAnalysisTheme(agentName, themeData);
      set((s) => ({
        exportResult: result,
        loading: { ...s.loading, export: false },
      }));
    } catch (error) {
      set((s) => ({
        errors: { ...s.errors, export: error instanceof Error ? error.message : String(error) },
        loading: { ...s.loading, export: false },
      }));
    }
  },

  setProgress: (progress) => set({ progress }),

  reset: () =>
    set({
      targets: [],
      summaries: [],
      currentTarget: null,
      detection: null,
      progress: null,
      loading: initialLoading,
      errors: initialErrors,
      exportResult: null,
    }),
}));
