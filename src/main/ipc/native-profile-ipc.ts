// SPDX-License-Identifier: MPL-2.0

/**
 * # Native Profile IPC
 *
 * Registers the NATIVE_PROFILE_BUILD handler. The renderer sends a DomTreeNode
 * + build options; the handler calls `buildNativeProfile()` from the
 * native-profile模块 and returns a compact summary (agentId, componentCount,
 * roleDistribution).
 *
 * The full AgentNativeProfile (components, palette, metrics) lives only in the
 * main process — the renderer receives a trimmed digest so the UI never ships
 * multi-MB payloads across IPC.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { DomTreeNode } from '../../shared/types';
import { type BuildProfileOptions, buildNativeProfile } from '../profile/native-profile';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Compact summary returned to the renderer (no per-component detail). */
export interface NativeProfileSummary {
  agentId: string;
  componentCount: number;
  roleDistribution: Record<string, number>;
  /** Elevation ladder (≤16 steps) — color + delta luminance per level. */
  elevationLadder: Array<{ level: number; color: string; deltaLuminance: number }>;
}

/** Tally components by their inferred role. */
function countRoles(profile: ReturnType<typeof buildNativeProfile>): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of profile.components) {
    dist[c.role] = (dist[c.role] ?? 0) + 1;
  }
  return dist;
}

/** Trim a full AgentNativeProfile down to a renderer-safe summary. */
function summarize(profile: ReturnType<typeof buildNativeProfile>): NativeProfileSummary {
  return {
    agentId: profile.meta.agentId,
    componentCount: profile.components.length,
    roleDistribution: countRoles(profile),
    elevationLadder: profile.metrics.elevationLadder,
  };
}

export function registerNativeProfileIpc(): void {
  ipcMain.handle(
    IpcChannel.NATIVE_PROFILE_BUILD,
    (_event, domTree: DomTreeNode | null, options: BuildProfileOptions) =>
      withMonitoredTimeout(
        IpcChannel.NATIVE_PROFILE_BUILD,
        15000,
        Promise.resolve(buildNativeProfile(domTree, options)).then(summarize),
      ),
  );
}
