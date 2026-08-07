// SPDX-License-Identifier: MPL-2.0

import type { AgentCapabilities } from '../../shared/types';
import { AGENT_META } from '../../shared/types';
import type { AgentCatalogItem, AgentDisplayMeta } from './types';

export interface AgentAdapterInfo {
  id: string;
  name: string;
  type: 'agent' | 'ide' | 'desktop';
  tier: 'active' | 'experimental';
  coreId: string;
  displayName(): string;
}

const ACTIVE_CAPS: AgentCapabilities = { theme: true, hotReload: true, extension: false };

/**
 * Catalog-level display metadata. Display names, official names, and regions
 * are derived from AGENT_META (the single source of truth in shared/types).
 * Only catalog-specific fields (slug, icon, description, capabilities) live here.
 */
const DISPLAY_META: Record<string, AgentDisplayMeta> = {
  traework: {
    slug: 'trae',
    icon: 'traework',
    description: 'ByteDance AI coding IDE.',
    displayName: AGENT_META.traework.displayName,
    officialName: AGENT_META.traework.officialName,
    region: AGENT_META.traework.region,
    capabilities: ACTIVE_CAPS,
  },
  qoderwork: {
    slug: 'qoder',
    icon: 'qoderwork',
    description: 'Tencent cloud AI IDE.',
    displayName: AGENT_META.qoderwork.displayName,
    officialName: AGENT_META.qoderwork.officialName,
    region: AGENT_META.qoderwork.region,
    capabilities: ACTIVE_CAPS,
  },
  workbuddy: {
    slug: 'workbuddy',
    icon: 'workbuddy',
    description: 'AI coding assistant.',
    displayName: AGENT_META.workbuddy.displayName,
    officialName: AGENT_META.workbuddy.officialName,
    region: AGENT_META.workbuddy.region,
    capabilities: ACTIVE_CAPS,
  },
  doubao: {
    slug: 'doubao',
    icon: 'doubao',
    description: 'ByteDance Doubao AI assistant.',
    displayName: AGENT_META.doubao.displayName,
    officialName: AGENT_META.doubao.officialName,
    region: AGENT_META.doubao.region,
    capabilities: ACTIVE_CAPS,
  },
  codex: {
    slug: 'codex',
    icon: 'codex',
    description: 'OpenAI Codex desktop assistant.',
    displayName: AGENT_META.codex.displayName,
    officialName: AGENT_META.codex.officialName,
    region: AGENT_META.codex.region,
    capabilities: ACTIVE_CAPS,
  },
  zcode: {
    slug: 'zcode',
    icon: 'zcode',
    description: 'ZCode AI coding desktop app.',
    displayName: AGENT_META.zcode.displayName,
    officialName: AGENT_META.zcode.officialName,
    region: AGENT_META.zcode.region,
    capabilities: ACTIVE_CAPS,
  },
};

const FALLBACK_META: AgentDisplayMeta = {
  slug: '',
  icon: '',
  description: '',
  officialName: '',
  region: 'Global',
  capabilities: ACTIVE_CAPS,
};

export class AgentCatalog {
  constructor(private readonly adapters: readonly AgentAdapterInfo[]) {}

  listAgents(): AgentCatalogItem[] {
    return this.adapters.map((adapter) => this.toItem(adapter));
  }

  getAgent(id: string): AgentCatalogItem | null {
    const adapter = this.adapters.find((a) => a.id === id);
    return adapter ? this.toItem(adapter) : null;
  }

  getAvailableAgents(): AgentCatalogItem[] {
    return this.adapters.filter((a) => a.tier === 'active').map((adapter) => this.toItem(adapter));
  }

  private toItem(adapter: AgentAdapterInfo): AgentCatalogItem {
    const meta = DISPLAY_META[adapter.id] ?? FALLBACK_META;
    let displayName = meta.displayName ?? adapter.name;
    // Product display names in DISPLAY_META are authoritative. Only fall back
    // to the engine's runtime name when no curated display name exists (e.g.
    // unknown adapters without a catalog entry).
    if (!meta.displayName && adapter.coreId) {
      try {
        displayName = adapter.displayName();
      } catch {
        /* fallback to adapter.name below */
      }
    }
    return {
      id: adapter.id,
      slug: meta.slug,
      name: adapter.name,
      displayName,
      officialName: meta.officialName,
      region: meta.region,
      adapter: adapter.coreId,
      type: adapter.type as 'agent' | 'ide',
      icon: meta.icon,
      description: meta.description,
      capabilities: meta.capabilities,
      supported: adapter.tier === 'active',
      // Default status — the IPC layer overwrites with live data for active agents.
      status: { installed: false, running: false, debugReady: false },
    };
  }
}
