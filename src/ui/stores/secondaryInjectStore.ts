// SPDX-License-Identifier: MPL-2.0

/**
 * # secondaryInjectStore
 *
 * Tracks per-agent secondary-injection (webview/iframe) progress and summary
 * events pushed from the main process. Consumed by the Diagnostics tab to
 * render a per-target injection timeline.
 *
 * Data is transient diagnostic info — not persisted across restarts.
 * A module-level Set prevents duplicate IPC subscriptions across HMR.
 */

import { api } from '@/api/agentSkinClient';

import type { AgentId } from '@shared/types/agent';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Runtime type guard — validate IPC event agent field
// ---------------------------------------------------------------------------

/**
 * Validate that a string is a valid AgentId.
 * Prevents invalid agent identifiers from corrupting store state.
 */
function isValidAgentId(value: string): value is AgentId {
  return ['workbuddy', 'qoderwork', 'traework', 'doubao', 'codex', 'zcode'].includes(value);
}

export interface SecondaryInjectStep {
  targetId: string;
  targetType: string;
  title?: string;
  success: boolean;
  error?: string;
  elapsed: number;
  timestamp: number;
}

export interface SecondaryInjectSummary {
  injected: number;
  failed: number;
  total: number;
  duration: number;
}

export interface SecondaryInjectAgentState {
  steps: SecondaryInjectStep[];
  summary: SecondaryInjectSummary | null;
  startedAt: number;
}

interface SecondaryInjectState {
  byAgent: Record<AgentId, SecondaryInjectAgentState>;
  _initialized: boolean;
  init: () => void;
  _handleProgress: (event: {
    agent: string;
    targetId: string;
    targetType: string;
    title?: string;
    success: boolean;
    error?: string;
    elapsed: number;
  }) => void;
  _handleSummary: (event: {
    agent: string;
    injected: number;
    failed: number;
    total: number;
    duration: number;
  }) => void;
}

const initAgentState = (): SecondaryInjectAgentState => ({
  steps: [],
  summary: null,
  startedAt: Date.now(),
});

// Store unsubscribe functions for cleanup — prevents HMR subscription leaks.
let unsubSecondaryInjectProgress: (() => void) | null = null;
let unsubSecondaryInjectSummary: (() => void) | null = null;

export const useSecondaryInjectStore = create<SecondaryInjectState>((set, get) => ({
  byAgent: {} as Record<AgentId, SecondaryInjectAgentState>,
  _initialized: false,

  init: () => {
    if (get()._initialized) return;
    set({ _initialized: true });
    unsubSecondaryInjectProgress = api.onSecondaryInjectProgress(get()._handleProgress);
    unsubSecondaryInjectSummary = api.onSecondaryInjectSummary(get()._handleSummary);
  },

  _handleProgress: (event) => {
    // Validate agent field before state mutation
    if (!isValidAgentId(event.agent)) {
      console.warn('[secondaryInjectStore] invalid agent id in progress event', event.agent);
      return;
    }
    set((state) => {
      const agent = event.agent as AgentId;
      const prev = state.byAgent[agent] ?? initAgentState();
      return {
        byAgent: {
          ...state.byAgent,
          [agent]: {
            ...prev,
            steps: [
              ...prev.steps,
              {
                targetId: event.targetId,
                targetType: event.targetType,
                title: event.title,
                success: event.success,
                error: event.error,
                elapsed: event.elapsed,
                timestamp: Date.now(),
              },
            ],
          },
        },
      };
    });
  },

  _handleSummary: (event) => {
    // Validate agent field before state mutation
    if (!isValidAgentId(event.agent)) {
      console.warn('[secondaryInjectStore] invalid agent id in summary event', event.agent);
      return;
    }
    set((state) => {
      const agent = event.agent as AgentId;
      const prev = state.byAgent[agent] ?? initAgentState();
      return {
        byAgent: {
          ...state.byAgent,
          [agent]: {
            ...prev,
            summary: {
              injected: event.injected,
              failed: event.failed,
              total: event.total,
              duration: event.duration,
            },
          },
        },
      };
    });
  },
}));

/**
 * Cleanup module-level IPC subscriptions.
 * Call on app exit or HMR dispose to prevent subscription leaks.
 */
export function disposeSecondaryInjectSubscriptions(): void {
  if (unsubSecondaryInjectProgress) {
    unsubSecondaryInjectProgress();
    unsubSecondaryInjectProgress = null;
  }
  if (unsubSecondaryInjectSummary) {
    unsubSecondaryInjectSummary();
    unsubSecondaryInjectSummary = null;
  }
}
