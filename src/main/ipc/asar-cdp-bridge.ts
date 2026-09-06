// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP bridge for ASAR joint analysis
 *
 * The live half of "CDP + ASAR unpacking": given an agent id, find the app's
 * Chrome DevTools endpoint, enumerate its targets, and open a session to the
 * one that actually renders the UI.
 *
 * This is deliberately the *only* module in the joint-analysis path that
 * touches sockets and the DevTools HTTP endpoint. Keeping it separate means
 * the orchestration in `asar-joint-analysis.ts` stays unit-testable with a
 * stub bridge, and the analysis tests never open a real connection.
 *
 * ## Why the port has to be discovered
 *
 * An Electron app only listens on the port it was launched with
 * (`--remote-debugging-port=N`, or `0` → Chromium picks one and writes it to
 * `DevToolsActivePort`). WorkBuddy randomises its port per launch, and Doubao
 * needs the flag passed at all. So the bridge probes rather than trusting
 * config: preferred port first, then a bounded walk of the shared
 * 9222–9357 agent band, stopping at the first port that answers `/json/list`.
 */

import { probePortLive } from '../../shared/cdp-discovery';
import type { AgentId } from '../../shared/types/agent';
import { connectWithRetry } from '../cdp/cdp-fanout';
import { listTargets } from '../cdp/cdp-targets';
import {
  AGENT_PORT_FALLBACK_MAX,
  AGENT_PORT_FALLBACK_MIN,
  getAdapterPortConfig,
} from '../cdp/port-manager';
import type { JointCdpBridge, JointTargetInfo } from './asar-joint-analysis';

/**
 * Max ports probed per analysis.
 *
 * The common case exits on the first candidate (the adapter's preferred port),
 * so the cap only bounds the cost of "app not running at all": a refused TCP
 * connect on localhost fails in well under the timeout, keeping the negative
 * path near-instant rather than a linear scan of the whole band.
 */
const MAX_PORT_PROBES = 24;

/** TCP probe budget per candidate port. */
const PORT_PROBE_TIMEOUT_MS = 200;

/**
 * Build the port candidate list: the adapter's preferred port first, then the
 * shared fallback band.
 */
function portCandidates(agentId: AgentId): number[] {
  const candidates: number[] = [];
  const cfg = getAdapterPortConfig(agentId);
  if (cfg) candidates.push(cfg.preferredPort);
  for (
    let port = AGENT_PORT_FALLBACK_MIN;
    port <= AGENT_PORT_FALLBACK_MAX && candidates.length < MAX_PORT_PROBES;
    port++
  ) {
    if (!candidates.includes(port)) candidates.push(port);
  }
  return candidates;
}

/** Find a port that is both listening and serving CDP targets. */
async function resolvePort(agentId: AgentId): Promise<number | null> {
  for (const port of portCandidates(agentId)) {
    if (!(await probePortLive(port, PORT_PROBE_TIMEOUT_MS))) continue;
    const targets = await listTargets(port);
    if (targets.length > 0) return port;
  }
  return null;
}

/**
 * The default bridge — real sockets, real DevTools endpoint.
 *
 * Injected into {@link registerJointAnalysisIpc} by `ipc/index.ts`; tests pass
 * a stub instead.
 */
export function createDefaultCdpBridge(): JointCdpBridge {
  return {
    resolvePort,
    listTargets: (port: number): Promise<readonly JointTargetInfo[]> => listTargets(port),
    connect: (wsUrl: string) => connectWithRetry(wsUrl, 4000, 2, [500]),
  };
}
