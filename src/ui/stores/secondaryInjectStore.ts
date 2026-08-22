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

import type { AgentId } from '@shared/types';
import { create } from 'zustand';

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

export const useSecondaryInjectStore = create<SecondaryInjectState>((set, get) => ({
  byAgent: {} as Record<AgentId, SecondaryInjectAgentState>,
  _initialized: false,

  init: () => {
    if (get()._initialized) return;
    set({ _initialized: true });
    api.onSecondaryInjectProgress(get()._handleProgress);
    api.onSecondaryInjectSummary(get()._handleSummary);
  },

  _handleProgress: (event) => {
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
