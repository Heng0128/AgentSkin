// SPDX-License-Identifier: MPL-2.0

import type { InstallHints } from '../../../adapters/base';
import { CodexAdapter } from '../../../adapters/domestic/codex';
import { DoubaoAdapter } from '../../../adapters/domestic/doubao';
import { QoderAdapter } from '../../../adapters/domestic/qoder';
import { TraeAdapter } from '../../../adapters/domestic/trae';
import { WorkbuddyAdapter } from '../../../adapters/domestic/workbuddy';
import { ZcodeAdapter } from '../../../adapters/domestic/zcode';
import type { AgentId } from '../../../shared/types/agent';
import { mainWarn } from '../../logger';

/**
 * Snapshot of a single adapter's identity + install hints.
 * Built once at module load so the scanner never has to instantiate adapters
 * during the hot scan path.
 */
export interface AgentProbe {
  id: AgentId;
  displayName: string;
  hints: InstallHints;
}

function buildAgentProbes(): AgentProbe[] {
  const adapters = [
    new TraeAdapter(),
    new QoderAdapter(),
    new WorkbuddyAdapter(),
    new DoubaoAdapter(),
    new CodexAdapter(),
    new ZcodeAdapter(),
  ];
  const probes: AgentProbe[] = [];
  for (const a of adapters) {
    if (!a.installHints) {
      mainWarn('ElectronScanner', `adapter "${a.id}" has no installHints — skipping in L1 scan`);
      continue;
    }
    probes.push({
      id: a.id as AgentId,
      displayName: a.name,
      hints: a.installHints,
    });
  }
  return probes;
}

export const AGENT_PROBES: AgentProbe[] = buildAgentProbes();
