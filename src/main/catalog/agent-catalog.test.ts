// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { type AgentAdapterInfo, AgentCatalog } from './agent-catalog';

const mockAdapters: AgentAdapterInfo[] = [
  {
    id: 'traework',
    name: 'TRAE',
    type: 'agent',
    tier: 'active',
    coreId: 'traework',
    displayName: () => 'TRAE SOLO',
  },
  {
    id: 'qoderwork',
    name: 'QoderWork CN',
    type: 'ide',
    tier: 'active',
    coreId: 'qoderwork',
    displayName: () => 'QoderWork CN',
  },
];

describe('AgentCatalog', () => {
  const catalog = new AgentCatalog(mockAdapters);

  describe('listAgents', () => {
    it('returns all agents', () => {
      const agents = catalog.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id)).toEqual(['traework', 'qoderwork']);
    });

    it('provides default status (IPC layer overwrites with live data)', () => {
      const agents = catalog.listAgents();
      for (const agent of agents) {
        expect(agent.status.installed).toBe(false);
        expect(agent.status.running).toBe(false);
        expect(agent.status.debugReady).toBe(false);
      }
    });

    it('populates slug and capabilities from display metadata', () => {
      const trae = catalog.getAgent('traework');
      expect(trae!.slug).toBe('trae');
      expect(trae!.capabilities.theme).toBe(true);
      expect(trae!.capabilities.hotReload).toBe(true);
      expect(trae!.capabilities.extension).toBe(false);
    });
  });

  describe('getAgent', () => {
    it('returns a single agent by id', () => {
      const agent = catalog.getAgent('traework');
      expect(agent).not.toBeNull();
      expect(agent!.id).toBe('traework');
      expect(agent!.supported).toBe(true);
    });

    it('uses catalog display name for active adapters', () => {
      const agent = catalog.getAgent('traework');
      expect(agent!.displayName).toBe('TRAE Work CN');
    });

    it('uses catalog display name for QoderWork CN', () => {
      const agent = catalog.getAgent('qoderwork');
      expect(agent!.displayName).toBe('QoderWork CN');
    });

    it('returns null for unknown id', () => {
      expect(catalog.getAgent('unknown')).toBeNull();
    });
  });

  describe('getAvailableAgents', () => {
    it('returns only active-tier agents', () => {
      const active = catalog.getAvailableAgents();
      expect(active).toHaveLength(2);
      expect(active.every((a) => a.supported)).toBe(true);
    });

    it('returns active agents from the catalog', () => {
      const active = catalog.getAvailableAgents();
      expect(active.find((a) => a.id === 'traework')).toBeDefined();
      expect(active.find((a) => a.id === 'qoderwork')).toBeDefined();
    });
  });
});
