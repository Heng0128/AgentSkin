// SPDX-License-Identifier: MPL-2.0

import type { AgentCapabilities } from '../../shared/types';
import { AGENT_META } from '../../shared/types';
import type { AgentCatalogItem } from './types';
import type { AgentDisplayMeta } from './types';

export interface AgentAdapterInfo {
  id: string;
  name: string;
  type: 'agent' | 'ide' | 'desktop';
  tier: 'active' | 'experimental';
  coreId: string;
  displayName(): string;
}

const ACTIVE_CAPS: AgentCapabilities = { theme: true, hotReload: true, extension: false };
const EXPERIMENTAL_CAPS: AgentCapabilities = { theme: false, hotReload: false, extension: false };

/**
 * Catalog-level display metadata. Display names, official names, and regions
 * are derived from AGENT_META (the single source of truth in shared/types).
 * Only catalog-specific fields (slug, icon, description, capabilities) live here.
 */
const DISPLAY_META: Record<string, AgentDisplayMeta> = {
  traework: { slug: 'trae', icon: 'traework', description: 'ByteDance AI coding IDE.', displayName: AGENT_META.traework.displayName, officialName: AGENT_META.traework.officialName, region: AGENT_META.traework.region, capabilities: ACTIVE_CAPS },
  qoderwork: { slug: 'qoder', icon: 'qoderwork', description: 'Tencent cloud AI IDE.', displayName: AGENT_META.qoderwork.displayName, officialName: AGENT_META.qoderwork.officialName, region: AGENT_META.qoderwork.region, capabilities: ACTIVE_CAPS },
  workbuddy: { slug: 'workbuddy', icon: 'workbuddy', description: 'AI coding assistant.', displayName: AGENT_META.workbuddy.displayName, officialName: AGENT_META.workbuddy.officialName, region: AGENT_META.workbuddy.region, capabilities: ACTIVE_CAPS },
  codebuddy: { slug: 'codebuddy', icon: 'codebuddy', description: 'Tencent Cloud CodeBuddy — experimental.', displayName: 'CodeBuddy', officialName: 'CodeBuddy', region: 'CN', tier: 'experimental', capabilities: EXPERIMENTAL_CAPS },
  doubao: { slug: 'doubao', icon: 'doubao', description: 'ByteDance Doubao AI assistant.', displayName: AGENT_META.doubao.displayName, officialName: AGENT_META.doubao.officialName, region: AGENT_META.doubao.region, capabilities: ACTIVE_CAPS },
  marscode: { slug: 'marscode', icon: 'marscode', description: 'Doubao MarsCode AI IDE — experimental.', displayName: '豆包 MarsCode', officialName: 'MarsCode', region: 'CN', tier: 'experimental', capabilities: EXPERIMENTAL_CAPS },
  comate: { slug: 'comate', icon: 'comate', description: 'Baidu Comate AI coding assistant — experimental.', displayName: '百度 Comate', officialName: 'Comate', region: 'CN', tier: 'experimental', capabilities: EXPERIMENTAL_CAPS },
  tongyi_lingma: { slug: 'tongyi', icon: 'tongyi_lingma', description: 'Alibaba Tongyi Lingma — experimental.', displayName: '通义灵码', officialName: '通义灵码', region: 'CN', tier: 'experimental', capabilities: EXPERIMENTAL_CAPS },
  tencent_ai_code: { slug: 'tencent-ai-code', icon: 'tencent_ai_code', description: 'Tencent Cloud AI Code — experimental.', displayName: '腾讯云 AI Code', officialName: '腾讯AI代码', region: 'CN', tier: 'experimental', capabilities: EXPERIMENTAL_CAPS },
};

const FALLBACK_META: AgentDisplayMeta = { slug: '', icon: '', description: '', officialName: '', region: 'Global', capabilities: EXPERIMENTAL_CAPS };

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
    // experimental adapters without a catalog entry).
    if (!meta.displayName && adapter.coreId) {
      try { displayName = adapter.displayName(); } catch { /* experimental */ }
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
