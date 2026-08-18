// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from './agent';

/**
 * Security posture for a single agent — derived from asar analysis
 * (`scripts/extract-asar-summary.mjs`).
 */
export interface AgentSecurityProfile {
  readonly agentId: AgentId;
  readonly contextIsolation: boolean;
  readonly sandbox: boolean;
  readonly webSecurity: 'strict' | 'standard' | 'disabled';
  readonly cspLevel: 'strict' | 'moderate' | 'none';
  readonly nodeIntegration: boolean;
  readonly contextBridge: boolean;
}

/**
 * Static mapping of known agent security profiles.
 *
 * Source: asar analysis of each agent's Electron main process config.
 * TODO: replace with runtime data once extract-asar-summary persists JSON.
 */
export const AGENT_SECURITY_PROFILES: Readonly<Record<AgentId, AgentSecurityProfile>> = {
  codex: {
    agentId: 'codex',
    contextIsolation: true,
    sandbox: true,
    webSecurity: 'strict',
    cspLevel: 'strict',
    nodeIntegration: false,
    contextBridge: true,
  },
  doubao: {
    agentId: 'doubao',
    contextIsolation: true,
    sandbox: true,
    webSecurity: 'standard',
    cspLevel: 'moderate',
    nodeIntegration: false,
    contextBridge: true,
  },
  traework: {
    agentId: 'traework',
    contextIsolation: true,
    sandbox: false,
    webSecurity: 'standard',
    cspLevel: 'moderate',
    nodeIntegration: false,
    contextBridge: true,
  },
  workbuddy: {
    agentId: 'workbuddy',
    contextIsolation: true,
    sandbox: true,
    webSecurity: 'strict',
    cspLevel: 'strict',
    nodeIntegration: false,
    contextBridge: true,
  },
  qoderwork: {
    agentId: 'qoderwork',
    contextIsolation: true,
    sandbox: true,
    webSecurity: 'strict',
    cspLevel: 'strict',
    nodeIntegration: false,
    contextBridge: true,
  },
  zcode: {
    agentId: 'zcode',
    contextIsolation: true,
    sandbox: true,
    webSecurity: 'strict',
    cspLevel: 'strict',
    nodeIntegration: false,
    contextBridge: true,
  },
};
