// SPDX-License-Identifier: MPL-2.0

/**
 * # drift-status
 *
 * Shared type contract for the P3 Self-Healing Loop drift detection surface.
 * Mirrors the main-process `DriftSignal` / `RegenResult` shapes from
 * `main/theme-asset/fingerprint.ts` so the IPC layer (`AgentSkinApi`) and the
 * renderer (`diagnosticsStore`, `DriftStatusPanel`) can both reference the
 * same contract without crossing architecture boundaries.
 *
 * Types here are deliberately framework-agnostic (no React/Electron deps)
 * so they can be consumed by:
 *   - `shared/types/ipc.ts` (AgentSkinApi contract)
 *   - `ui/stores/diagnosticsStore.ts` (state field)
 *   - `ui/components/diagnostics/DriftStatusPanel.tsx` (presentation)
 *   - `ui/types/drift-status.ts` (UI-side re-export alias)
 */

import type { AgentId } from './agent';

/** Single drift signal contributing to the overall drift score. */
export interface DriftSignal {
  type: 'selector_hit_drop' | 'accent_shift' | 'sheet_mount_failed' | 'app_version_change';
  weight: number;
  detail: string;
}

/** Per-agent drift detection status — pushed from main to renderer via IPC. */
export interface DriftStatus {
  agentId: AgentId;
  themeId: string;
  /** Aggregate drift score 0-1. */
  driftScore: number;
  signals: DriftSignal[];
  lastRegenResult: {
    status: 'success' | 'failed' | 'skipped';
    timestamp: number;
    reason: string;
  } | null;
  /** Epoch ms of the last fingerprint capture. */
  lastCaptureAt: number;
  confidence: 'low' | 'high';
}

/** Result returned by `triggerManualRegen` IPC invoke. */
export interface RegenResult {
  status: 'success' | 'failed' | 'skipped';
  reason: string;
}
