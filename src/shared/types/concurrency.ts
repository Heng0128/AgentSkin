// SPDX-License-Identifier: MPL-2.0

/**
 * Concurrency + health metrics for the Agent Skin engine.
 *
 * Shared between main process (AgentEngineService.collectConcurrencyMetrics)
 * and renderer process (diagnosticsStore.updateConcurrencyMetrics).
 */
export interface ConcurrencyMetrics {
  /** Number of agents currently in the companion-busy guard set. */
  companionBusyByAgent: number;
  /** Number of agents with an in-flight apply or restore operation. */
  inflightOperations: number;
  /** Number of agents currently running a self-heal cycle. */
  selfHealingAgents: number;
  /** Number of tokens captured by the theme-tokens subsystem. */
  capturedTokens: number;
  /** Current depth of the persistence write queue. */
  persistChainDepth: number;
  /** Number of deferred self-heal operations waiting for a quiet window. */
  deferredSelfHeals: number;
  /** Number of pending theme-switch epochs per agent. */
  switchEpochByAgent: number;
  /** Number of persistence failures since last reset. */
  persistFailures: number;
}
