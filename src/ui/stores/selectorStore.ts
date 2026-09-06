// SPDX-License-Identifier: MPL-2.0

/**
 * # selectorStore
 *
 * Selector probe & validation state — manages CSS selector testing:
 *   1. Probe a single selector against a live CDP target
 *   2. Validate a batch of selectors for an agent
 *
 * Used by the Workspace's "Selector Inspector" tool and the Settings
 * page's selector validation panel.
 */

import { api } from '@/api/agentSkinClient';

import type { SelectorProbeResult, SelectorValidationReport } from '@shared/types/selector-probe';
import { create } from 'zustand';

interface SelectorState {
  /** Result of the last single-selector probe. */
  probeResult: SelectorProbeResult | null;
  /** Full validation report for a batch of selectors. */
  validationReport: SelectorValidationReport | null;
  /** Loading flags. */
  probing: boolean;
  validating: boolean;
  /** Error messages. */
  probeError: string | null;
  validationError: string | null;

  /** Probe a single CSS selector against a live CDP target. */
  probe: (port: number, selector: string) => Promise<void>;
  /** Validate a batch of selectors for an agent. */
  validate: (port: number, agentId: string, selectors: string[]) => Promise<void>;
  /** Clear all results. */
  reset: () => void;
}

export const useSelectorStore = create<SelectorState>((set) => ({
  probeResult: null,
  validationReport: null,
  probing: false,
  validating: false,
  probeError: null,
  validationError: null,

  probe: async (port, selector) => {
    set({ probing: true, probeError: null });
    try {
      const result = await api.probeSelector(port, selector);
      set({ probeResult: result, probing: false });
    } catch (error) {
      set({
        probeError: error instanceof Error ? error.message : String(error),
        probing: false,
      });
    }
  },

  validate: async (port, agentId, selectors) => {
    set({ validating: true, validationError: null });
    try {
      const report = await api.validateSelectors(port, agentId, selectors);
      set({ validationReport: report, validating: false });
    } catch (error) {
      set({
        validationError: error instanceof Error ? error.message : String(error),
        validating: false,
      });
    }
  },

  reset: () =>
    set({
      probeResult: null,
      validationReport: null,
      probing: false,
      validating: false,
      probeError: null,
      validationError: null,
    }),
}));
