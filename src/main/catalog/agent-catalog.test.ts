// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { AgentCatalog, type AgentAdapterInfo } from './agent-catalog';

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
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    type: 'agent',
    tier: 'experimental',
    coreId: '',
    displayName: () => {
      throw new Error('experimental');
    },
  },
];

describe('AgentCatalog', () => {
  const catalog = new AgentCatalog(mockAdapters);

  describe('listAgents', () => {
    it('returns all agents (active + experimental)', () => {
      const agents = catalog.listAgents();
      expect(agents).toHaveLength(3);
      expect(agents.map((a) => a.id)).toEqual(['traework', 'qoderwork', 'codebuddy']);
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

    it('sets experimental capabilities for experimental adapters', () => {
      const codebuddy = catalog.getAgent('codebuddy');
      expect(codebuddy!.capabilities.theme).toBe(false);
      expect(codebuddy!.capabilities.hotReload).toBe(false);
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

    it('falls back to adapter name for experimental adapters', () => {
      const agent = catalog.getAgent('codebuddy');
      expect(agent).not.toBeNull();
      expect(agent!.displayName).toBe('CodeBuddy');
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

    it('excludes experimental agents', () => {
      const active = catalog.getAvailableAgents();
      expect(active.find((a) => a.id === 'codebuddy')).toBeUndefined();
    });
  });
});
