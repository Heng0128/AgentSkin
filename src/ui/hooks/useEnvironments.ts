// SPDX-License-Identifier: MPL-2.0

/**
 * # useEnvironments
 *
 * Pure derivation hook — transforms store state into EnvironmentModel[].
 *
 * Data model:
 *   EnvironmentPreset (from environmentStore)  →  user-defined Agent+Theme combo
 *   Runtime status (live, from statusStore)    →  AppStatus per app
 *   EnvironmentModel (derived)                →  Preset + runtime overlay
 *
 * Reactivity: this hook subscribes to environmentStore.presets,
 * agentStore.agents, themeStore.installed, and statusStore.status. Any
 * mutation in environmentStore (create/rename/delete/duplicate) updates the
 * presets slice, which automatically re-runs the derivation — no module counter
 * or manual refresh callback needed.
 */

import { useMemo } from 'react';
import { findAppStatus } from '@/lib/status-utils';
import { useAgentStore } from '@/stores/agentStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useStatusStore } from '@/stores/statusStore';
import { useThemeStore } from '@/stores/themeStore';
import type { EnvironmentModel, EnvironmentPreset } from '@/types/environment';

import type { AgentId } from '@shared/types';

/** Build an environment id from agent + theme. */
function envId(agentId: string, themeId: string | null): string {
  const resolved = themeId || 'default';
  return `${agentId}-${resolved}`;
}

export interface UseEnvironmentsResult {
  /** All environments derived from presets + runtime status. */
  environments: EnvironmentModel[];
  /** Currently active environment (running agent + applied theme). */
  activeEnvironment: EnvironmentModel | null;
}

export function useEnvironments(): UseEnvironmentsResult {
  // --- Subscribe to stores (selector-based, re-renders only on slice change) ---
  const presets = useEnvironmentStore((s) => s.presets);
  const allAgents = useAgentStore((s) => s.agents);
  const installed = useThemeStore((s) => s.installed);
  const status = useStatusStore((s) => s.status);

  // --- Lookups ---
  const themeById = useMemo(() => {
    const map = new Map<string, (typeof installed)[number]>();
    for (const th of installed) map.set(th.id, th);
    return map;
  }, [installed]);

  const activeThemeByAgent = useMemo(() => {
    const map = new Map<string, string>();
    for (const app of status?.apps ?? []) {
      if (app.activeThemeId) map.set(app.appId, app.activeThemeId);
    }
    return map;
  }, [status]);

  // Map: agentId → preset
  const presetByAgent = useMemo(() => {
    const map = new Map<string, EnvironmentPreset>();
    for (const p of presets) map.set(p.agentId, p);
    return map;
  }, [presets]);

  // --- Build EnvironmentModel[] ---
  const environments = useMemo<EnvironmentModel[]>(() => {
    const result: EnvironmentModel[] = [];

    for (const agent of allAgents) {
      if (!agent.supported) continue;

      const preset = presetByAgent.get(agent.id) ?? null;
      const appStatus = findAppStatus(status, agent.id as AgentId);
      const activeThemeId = activeThemeByAgent.get(agent.id) ?? null;
      const activeTheme = activeThemeId ? (themeById.get(activeThemeId) ?? null) : null;

      const isRunning = !!appStatus?.running || !!appStatus?.debugReady;
      const isInstalled = !!appStatus?.installed;

      // Determine environment status.
      // When status===null the first detection round has not returned yet:
      // show 'detecting' instead of 'offline' so the user sees live progress
      // rather than a flat "not detected" misrepresenting an in-flight scan.
      let envStatus: EnvironmentModel['status'] = 'offline';
      if (status === null) envStatus = 'detecting';
      else if (isRunning && activeTheme) envStatus = 'active';
      else if (isRunning) envStatus = 'available';
      else if (isInstalled) envStatus = 'available';

      // Determine name: preset name > runtime-derived name
      let displayName = agent.displayName;
      if (preset) {
        displayName = preset.name;
      } else if (activeTheme) {
        displayName = `${agent.displayName} — ${activeTheme.name}`;
      }

      // Determine theme info
      const theme = activeTheme
        ? {
            id: activeTheme.id,
            name: activeTheme.name,
            preview: activeTheme.preview,
            icon: activeTheme.icon ?? null,
          }
        : null;

      // Link to preset if one exists for this agent+theme combo
      const presetId = preset && preset.themeId === activeThemeId ? preset.id : null;

      result.push({
        id: envId(agent.id, activeThemeId),
        name: displayName,
        agent: {
          id: agent.id as AgentId,
          name: agent.slug,
          displayName: agent.displayName,
        },
        theme,
        status: envStatus,
        agentRunning: isRunning,
        agentInstalled: isInstalled,
        detectedVersion: appStatus?.version ?? null,
        detectedPath: appStatus?.path ?? null,
        presetId,
      });
    }

    // Sort: active first, then presets with names (sorted by updatedAt), then others
    return result.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;

      // Both non-active: sort by preset updatedAt if available
      const presetA = presetByAgent.get(a.agent.id);
      const presetB = presetByAgent.get(b.agent.id);
      if (presetA && presetB) {
        return new Date(presetB.updatedAt).getTime() - new Date(presetA.updatedAt).getTime();
      }
      if (presetA) return -1;
      if (presetB) return 1;

      return 0;
    });
  }, [allAgents, status, activeThemeByAgent, themeById, presetByAgent]);

  // Active environment
  const activeEnvironment = useMemo(
    () => environments.find((e) => e.status === 'active') ?? null,
    [environments],
  );

  return {
    environments,
    activeEnvironment,
  };
}
