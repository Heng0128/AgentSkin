// SPDX-License-Identifier: MPL-2.0

/**
 * # agentStore
 *
 * Agent catalog list. The catalog is seeded SYNCHRONOUSLY from AGENT_META so
 * the environment list renders immediately on boot — no waiting for the IPC
 * round-trip to `catalog.agents.list()`. The IPC call then refreshes the list
 * with richer metadata (slug, icon, description, capabilities) once it
 * resolves.
 *
 * Extracted from `useAgents` (Phase A3).
 *
 * Live status (installed/running/debugReady) is intentionally NOT stored here
 * — it comes from the polled `statusStore.status`. The `appStatusFor` helper
 * below reads status on demand (via getState) so consumers can subscribe to
 * both slices independently without a derived selector.
 */

import { api } from '@/api/agentSkinClient';
import { findAppStatus } from '@/lib/status-utils';
import { useStatusStore } from '@/stores/statusStore';

import type { AgentCapabilities, AgentCatalogItem, AgentId, AppStatus } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';
import { create } from 'zustand';

const ACTIVE_CAPS: AgentCapabilities = { theme: true, hotReload: true, extension: false };

/** Synchronous fallback catalog built from AGENT_META for instant boot render. */
export const FALLBACK_AGENTS: AgentCatalogItem[] = AGENT_IDS.map((id) => {
  const meta = AGENT_META[id];
  return {
    id,
    slug: id,
    name: meta.officialName,
    displayName: meta.displayName,
    officialName: meta.officialName,
    region: meta.region,
    adapter: id,
    type: 'agent' as const,
    icon: id,
    description: '',
    capabilities: ACTIVE_CAPS,
    supported: true,
    status: { installed: false, running: false, debugReady: false },
  };
});

interface AgentState {
  agents: AgentCatalogItem[];
  loaded: boolean;
  /** Fetch the catalog from IPC; falls back to AGENT_META on failure. */
  loadAgents: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: FALLBACK_AGENTS,
  loaded: false,

  loadAgents: async () => {
    try {
      const result = await api.catalog.agents.list();
      set({ agents: result.items, loaded: true });
    } catch {
      // A failure leaves the fallback catalog (no icons/descriptions), which is
      // silently degraded — surface it via console so a missing catalog IPC is
      // diagnosable instead of looking like a UI bug.
      set({ loaded: true });
      console.error('[agentStore] catalog.agents.list() failed — using fallback');
    }
  },
}));

/**
 * Look up an app's live status from the polled statusStore. Read on demand
 * (not a React subscription) so it can be called anywhere — render, action,
 * or effect — without creating a subscription coupling.
 */
export function appStatusFor(appId: AgentId): AppStatus | null {
  return findAppStatus(useStatusStore.getState().status, appId);
}
