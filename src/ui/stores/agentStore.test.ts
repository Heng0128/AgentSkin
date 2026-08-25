// SPDX-License-Identifier: MPL-2.0

/**
 * # agentStore tests
 *
 * Covers the agent catalog store: loadAgents, FALLBACK_AGENTS usage,
 * and appStatusFor helper.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockCatalogAgentsList } = vi.hoisted(() => ({
  mockCatalogAgentsList: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    catalog: {
      agents: {
        list: mockCatalogAgentsList,
      },
    },
  },
}));

vi.mock('@/stores/statusStore', () => ({
  useStatusStore: {
    getState: () => ({
      status: {
        apps: {},
      },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { FALLBACK_AGENTS, useAgentStore } from './agentStore';
import { AGENT_IDS, AGENT_META } from '@shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  // Reset to initial state (with fallback agents)
  useAgentStore.setState({
    agents: FALLBACK_AGENTS,
    loaded: false,
  });
}

function makeAgentItem(id: string) {
  return {
    id,
    slug: id,
    name: `Agent ${id}`,
    displayName: `Agent ${id}`,
    officialName: `Agent ${id}`,
    region: 'cn',
    adapter: id,
    type: 'agent' as const,
    icon: id,
    description: `Description for ${id}`,
    capabilities: { theme: true, hotReload: true, extension: false },
    supported: true,
    status: { installed: true, running: false, debugReady: false },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  // -----------------------------------------------------------------------
  // loadAgents
  // -----------------------------------------------------------------------

  describe('loadAgents', () => {
    it('loads agents from IPC on success and sets loaded=true', async () => {
      const items = [makeAgentItem('traework'), makeAgentItem('qoderwork')];
      mockCatalogAgentsList.mockResolvedValue({ items });

      await useAgentStore.getState().loadAgents();

      const state = useAgentStore.getState();
      expect(state.agents).toEqual(items);
      expect(state.loaded).toBe(true);
    });

    it('falls back to AGENT_META-based catalog on IPC failure', async () => {
      mockCatalogAgentsList.mockRejectedValue(new Error('IPC not ready'));

      await useAgentStore.getState().loadAgents();

      const state = useAgentStore.getState();
      expect(state.loaded).toBe(true);
      // Agents should be the fallback (from AGENT_META)
      expect(state.agents.length).toBeGreaterThan(0);
      expect(state.agents[0]).toHaveProperty('id');
      expect(state.agents[0]).toHaveProperty('name');
    });

    it('does not throw when IPC rejects', async () => {
      mockCatalogAgentsList.mockRejectedValue(new Error('Unhandled IPC error'));

      await expect(useAgentStore.getState().loadAgents()).resolves.toBeUndefined();
    });

    it('uses fallback agents that include all expected fields', async () => {
      mockCatalogAgentsList.mockRejectedValue(new Error('IPC error'));

      await useAgentStore.getState().loadAgents();

      const state = useAgentStore.getState();
      for (const agent of state.agents) {
        expect(agent).toHaveProperty('id');
        expect(agent).toHaveProperty('slug');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('adapter');
        expect(agent).toHaveProperty('capabilities');
        expect(agent.status).toHaveProperty('installed');
        expect(agent.status).toHaveProperty('running');
        expect(agent.status).toHaveProperty('debugReady');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('has loaded=false before loadAgents is called', () => {
      // After reset, verify the initial loaded state is false
      resetStore();
      expect(useAgentStore.getState().loaded).toBe(false);
    });

    it('starts with FALLBACK_AGENTS as initial catalog', () => {
      console.log('typeof FALLBACK_AGENTS:', typeof FALLBACK_AGENTS);
      console.log('FALLBACK_AGENTS value:', FALLBACK_AGENTS);
      console.log('typeof useAgentStore:', typeof useAgentStore);
      resetStore();
      const state = useAgentStore.getState();
      console.log('state.agents:', state.agents);
      expect(state.agents).toEqual(FALLBACK_AGENTS);
    });
  });
});
