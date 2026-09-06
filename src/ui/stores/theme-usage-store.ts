// SPDX-License-Identifier: MPL-2.0

/**
 * # themeUsageStore
 *
 * Renderer-side state for theme usage frequency tracking. Communicates
 * with the main process via IPC (THEME_USAGE_GET) to retrieve LRU-sorted
 * theme ids for the quick-switch menu.
 *
 * The main process owns the actual tracking logic and persistence; this
 * store is a thin query layer that caches the sorted results per agent
 * and exposes them to React components.
 */

import { api } from '@/api/agentSkinClient';

import type { AgentId } from '@shared/types/agent';
import type { ThemeUsageMap } from '@shared/types/theme-usage';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface ThemeUsageState {
  /** Full usage map (mirrors main process state, for diagnostics display). */
  usage: ThemeUsageMap;
  /** Per-agent sorted theme ids (cached query results). */
  sortedByAgent: Record<string, string[]>;
  /** Whether a query is currently in flight (prevents duplicate requests). */
  loading: boolean;

  // --- queries ---
  /** Get cached sorted themes for an agent (no IPC call). */
  getSortedThemes: (appId: AgentId) => string[];

  // --- commands ---
  /**
   * Fetch LRU-sorted themes for an agent from the main process.
   * Updates sortedByAgent on success.
   */
  loadSortedThemes: (appId: AgentId, allThemes: string[], limit?: number) => Promise<void>;
  /** Replace the full usage map (e.g. for diagnostics panel). */
  setUsage: (usage: ThemeUsageMap) => void;
  /** Reset all state (for testing). */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useThemeUsageStore = create<ThemeUsageState>((set, get) => ({
  usage: {},
  sortedByAgent: {},
  loading: false,

  getSortedThemes: (appId) => {
    return get().sortedByAgent[appId] ?? [];
  },

  loadSortedThemes: async (appId, allThemes, limit) => {
    set({ loading: true });
    try {
      const sorted = await api.themeUsageGet(appId, allThemes, limit);
      set((state) => ({
        sortedByAgent: { ...state.sortedByAgent, [appId]: sorted },
      }));
    } catch {
      // IPC failure — leave existing cache intact, do not throw.
      // The quick-switch menu will simply show no suggestions.
    } finally {
      set({ loading: false });
    }
  },

  setUsage: (usage) => set({ usage }),

  reset: () => set({ usage: {}, sortedByAgent: {}, loading: false }),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectSortedThemes =
  (appId: AgentId) =>
  (s: ThemeUsageState): string[] =>
    s.sortedByAgent[appId] ?? [];

export const selectUsageMap = (s: ThemeUsageState): ThemeUsageMap => s.usage;

export const selectUsageLoading = (s: ThemeUsageState): boolean => s.loading;
