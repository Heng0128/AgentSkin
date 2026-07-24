// SPDX-License-Identifier: MPL-2.0

/**
 * # useAgents
 *
 * Manages the agent catalog list and per-agent status lookup.
 *
 * The catalog is seeded SYNCHRONOUSLY from AGENT_META so the environment list
 * renders immediately on boot — no waiting for the IPC round-trip to
 * `catalog.agents.list()`. The IPC call then refreshes the list with richer
 * metadata (slug, icon, description, capabilities) once it resolves.
 *
 * Live status (installed/running/debugReady) comes from the `status` prop,
 * polled by useAppController every 3s.
 */

import { useCallback, useEffect, useState } from 'react';
import { AGENT_IDS, AGENT_META } from '@shared/types';
import type { AgentCapabilities, AgentCatalogItem, AgentId, AppStatus, SystemStatus } from '@shared/types';
import { api } from '@/api/agentSkinClient';
import { findAppStatus } from '@/lib/status-utils';

const ACTIVE_CAPS: AgentCapabilities = { theme: true, hotReload: true, extension: false };

/**
 * Synchronous fallback catalog built from AGENT_META. Lets the UI render all
 * active agents instantly on boot instead of showing an empty list while the
 * IPC call is in flight.
 */
const FALLBACK_AGENTS: AgentCatalogItem[] = AGENT_IDS.map((id) => {
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

export function useAgents(status: SystemStatus | null) {
  const [agents, setAgents] = useState<AgentCatalogItem[]>(FALLBACK_AGENTS);

  useEffect(() => {
    void api.catalog.agents.list().then((r) => setAgents(r.items)).catch(() => undefined);
  }, []);

  const appStatusFor = useCallback(
    (appId: AgentId): AppStatus | null => findAppStatus(status, appId),
    [status],
  );

  return { agents, appStatusFor };
}
