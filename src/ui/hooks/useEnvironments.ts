// SPDX-License-Identifier: MPL-2.0

/**
 * # useEnvironments
 *
 * Preset-first environment derivation.
 *
 * Data model (v2):
 *   EnvironmentPreset (saved)  →  user-defined Agent+Theme combo
 *   Runtime status (live)      →  AppController's current agent/theme state
 *   EnvironmentModel (derived) →  Preset + runtime overlay
 *
 * Key changes in P2.6:
 *   - EnvironmentModel.presetId links to its corresponding preset.
 *   - If no preset exists, presetId is null (runtime-only env).
 *   - switchEnvironment() auto-creates a preset when needed.
 *   - Presets are loaded via EnvironmentStore (not raw localStorage).
 *   - Reactivity driven by shared refresh counter from useEnvironmentActions.
 *
 * Flow:
 *   1. Load presets from localStorage (EnvironmentStore)
 *   2. Merge with runtime status from AppController
 *   3. Derive EnvironmentModel[] for UI consumption
 *   4. Map each env to its preset by agentId+themeId match
 *
 * This hook is read-only for EnvironmentModel — it never mutates presets.
 * Mutations go through useEnvironmentActions.
 *
 * Reactivity note:
 *   Presets are loaded inside useMemo keyed on the shared refresh counter
 *   (getRefreshCounter()), so mutations in useEnvironmentActions trigger
 *   automatic re-derivation without explicit refresh callbacks.
 */

import { useEffect, useMemo, useState } from 'react';
import { findAppStatus } from '@/lib/status-utils';
import { loadPresets } from '@/storage/environment-store';
import type { EnvironmentModel, EnvironmentPreset } from '@/types/environment';

import type { AgentId } from '@shared/types';
import type { AppController } from './useAppController';
import { getRefreshCounter } from './useEnvironmentActions';

/** Build an environment id from agent + theme. */
function envId(agentId: string, themeId: string | null): string {
  return themeId ? `${agentId}-${themeId}` : `${agentId}-default`;
}

export interface UseEnvironmentsResult {
  /** All environments derived from presets + runtime status. */
  environments: EnvironmentModel[];
  /** Currently active environment (running agent + applied theme). */
  activeEnvironment: EnvironmentModel | null;
  /** Shared refresh counter getter — increments on mutations. */
  refresh: () => number;
}

export function useEnvironments(controller: AppController): UseEnvironmentsResult {
  const { agents: allAgents, installed, status } = controller;

  // --- Presets (persistent) ---
  // P1 audit #14: previously this read localStorage inside a useMemo, which
  // violates React's "useMemo must be pure" rule (localStorage is a side-
  // effectful I/O source) and meant `refreshKey` changes from
  // useEnvironmentActions wouldn't reliably trigger a re-read (the memo's
  // dependency was a module-level getter that React can't track). Now uses
  // useState + useEffect so the read is a proper effect that re-runs when
  // the refresh counter changes, and the result flows through React state
  // (which React CAN track for re-renders).
  const refreshKey = getRefreshCounter();
  const [presets, setPresets] = useState<EnvironmentPreset[]>(() => loadPresets());
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the reactivity trigger — its value change must re-run this effect to re-read presets, even though it is not read inside the body.
  useEffect(() => {
    setPresets(loadPresets());
  }, [refreshKey]);

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
    refresh: getRefreshCounter,
  };
}
