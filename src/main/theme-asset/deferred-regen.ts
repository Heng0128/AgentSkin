// SPDX-License-Identifier: MPL-2.0
/**
 * Theme Self-Healing Loop — Deferred Regeneration Coordinator
 *
 * Coordinates fingerprint capture → drift detection → conditional regen
 * dispatch. Mirrors the wallpaper-self-heal deferred-thunk pattern:
 *   - If agent is currently applying → enqueue with progressive backoff
 *   - Otherwise → dispatch immediately (fire-and-forget)
 *
 * @module theme-asset/deferred-regen
 * @see {@link docs/rfc/2026-08-20-theme-asset-engine-P3.md} §8
 */

import type { AgentId } from '../../shared/types/agent';
import type { DriftStatus } from '../../shared/types/drift-status';
import type { ThemeColors } from '../catalog/theme-manifest';
import type { FidelityVerdict } from '../cdp/baseline-validator';
import type { CdpSession } from '../cdp/cdp-client';
import {
  captureFingerprint,
  computeDriftScore,
  loadBaseline,
  type RegenResult,
  regenerateTheme,
  saveBaseline,
  shouldAutoRegen,
  type ThemeFingerprint,
  type ThemeFingerprintBundle,
} from './fingerprint';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max wait time for apply lock release before forcing dispatch (ms) */
const DEFERRED_MAX_WAIT_MS = 10_000;

/** Initial backoff interval (ms) */
const INITIAL_BACKOFF_MS = 100;

/** Backoff multiplier (exponential) */
const BACKOFF_MULTIPLIER = 2;

/** Max backoff interval (ms) */
const MAX_BACKOFF_MS = 1600;

// ---------------------------------------------------------------------------
// Deferred Queue
// ---------------------------------------------------------------------------

/** Pending regen entry */
interface PendingRegen {
  agentId: AgentId;
  themeId: string;
  thunk: () => Promise<RegenResult>;
  resolve: (result: RegenResult) => void;
}

/** Module-level deferred queue */
const deferredRegens = new Map<AgentId, PendingRegen>();

/** Whether the drain loop is currently running */
let drainRunning = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule a deferred regen for an agent.
 *
 * If the agent is currently applying a theme, the regen is enqueued and
 * dispatched after the apply lock releases (with progressive backoff).
 * Otherwise, it's dispatched immediately (fire-and-forget).
 *
 * @param agentId - Target agent
 * @param themeId - Theme to regenerate
 * @param thunk - Regen thunk from `regenerateTheme()`
 * @param isApplying - Predicate: true if agent is currently applying
 */
export function scheduleDeferredRegen(
  agentId: AgentId,
  themeId: string,
  thunk: () => Promise<RegenResult>,
  isApplying: () => boolean,
): void {
  // If not applying, dispatch immediately
  if (!isApplying()) {
    void thunk().catch(() => {});
    return;
  }

  // Enqueue for deferred dispatch
  deferredRegens.set(agentId, {
    agentId,
    themeId,
    thunk,
    resolve: () => {},
  });

  // Start drain loop if not already running
  if (!drainRunning) {
    void drainDeferredRegens(isApplying);
  }
}

/**
 * Get the number of pending deferred regens (for telemetry).
 */
export function getDeferredRegensSize(): number {
  return deferredRegens.size;
}

/**
 * Clear all pending deferred regens (for testing / epoch reset).
 */
export function clearDeferredRegens(): void {
  deferredRegens.clear();
}

// ---------------------------------------------------------------------------
// Drain Loop
// ---------------------------------------------------------------------------

/**
 * Drain the deferred regen queue with progressive backoff.
 * Polls `isApplying()` and dispatches when the lock releases.
 */
async function drainDeferredRegens(isApplying: () => boolean): Promise<void> {
  if (drainRunning) return;
  drainRunning = true;

  let backoffMs = INITIAL_BACKOFF_MS;
  const startTime = Date.now();

  try {
    while (deferredRegens.size > 0) {
      // Safety bound: force dispatch after max wait
      const elapsed = Date.now() - startTime;
      if (elapsed >= DEFERRED_MAX_WAIT_MS) {
        for (const [agentId, pending] of deferredRegens) {
          void pending.thunk().catch(() => {});
          deferredRegens.delete(agentId);
        }
        break;
      }

      // Wait for backoff interval
      await sleep(backoffMs);

      // Check each pending regen
      for (const [agentId, pending] of [...deferredRegens.entries()]) {
        if (!isApplying()) {
          // Lock released → dispatch
          try {
            const result = await pending.thunk();
            pending.resolve(result);
          } catch {
            // Best-effort: don't crash the drain loop
          }
          deferredRegens.delete(agentId);
        }
      }

      // Exponential backoff (capped)
      backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    }
  } finally {
    drainRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Coordinator: Capture → Detect → Dispatch
// ---------------------------------------------------------------------------

/**
 * Capture fingerprint, detect drift, and conditionally dispatch regen.
 *
 * This is the main entry point called from the apply flow's background
 * tasks. It:
 * 1. Captures current fingerprint from the live CDP session
 * 2. Loads baseline fingerprint from disk
 * 3. Computes drift score
 * 4. Determines regen action via `shouldAutoRegen()`
 * 5. Conditionally dispatches regen thunk
 *
 * @param session - Live CDP session
 * @param agentId - Target agent
 * @param themeId - Theme id
 * @param colors - Theme colors (from InstalledTheme)
 * @param cssOutputs - Current CSS outputs (6-agent map)
 * @param themeDir - Theme package directory (for baseline storage)
 * @param fidelity - Fidelity verdict from verify stage
 * @param isApplying - Predicate: true if agent is currently applying
 * @param onDriftStatus - Optional callback invoked with drift status after
 *   detection (used to push status to the Diagnostics UI). Best-effort:
 *   errors are swallowed.
 * @returns Capture result (null on failure — best-effort)
 */
export async function captureDetectDispatch(
  session: CdpSession,
  agentId: AgentId,
  themeId: string,
  colors: ThemeColors,
  cssOutputs: Record<string, string>,
  themeDir: string,
  fidelity: FidelityVerdict,
  isApplying: () => boolean,
  onDriftStatus?: (status: DriftStatus) => void,
): Promise<ThemeFingerprint | null> {
  try {
    // Step 1: Capture current fingerprint
    const current = await captureFingerprint(session, agentId, themeId, colors, cssOutputs);
    if (!current) return null;

    // Step 2: Load baseline
    const baseline = await loadBaseline(themeDir);

    // Step 3: If no baseline, save current as initial baseline
    if (!baseline) {
      const initialBundle: ThemeFingerprintBundle = {
        themeId,
        appVersion: current.appVersion,
        fingerprints: { [agentId]: current } as Record<AgentId, ThemeFingerprint>,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveBaseline(themeDir, initialBundle);
      return current;
    }

    // Step 4: Compute drift
    const baselineFp = baseline.fingerprints[agentId];
    if (!baselineFp) {
      // No baseline for this agent → save and return
      baseline.fingerprints[agentId] = current as ThemeFingerprint;
      baseline.updatedAt = Date.now();
      await saveBaseline(themeDir, baseline);
      return current;
    }

    const drift = computeDriftScore(baselineFp, current);

    // Step 5: Determine action
    const { action } = shouldAutoRegen(fidelity, drift.score);

    // Step 6: Dispatch based on action
    if (action === 'auto_regen') {
      const thunk = regenerateTheme(agentId, themeId);
      scheduleDeferredRegen(agentId, themeId, thunk, isApplying);
    }

    // Step 7: Update baseline with current capture
    baseline.fingerprints[agentId] = current as ThemeFingerprint;
    baseline.updatedAt = Date.now();
    await saveBaseline(themeDir, baseline);

    // Step 8: Notify UI of drift status (best-effort)
    if (onDriftStatus) {
      try {
        onDriftStatus({
          agentId,
          themeId,
          driftScore: drift.score,
          signals: drift.signals,
          lastRegenResult:
            action === 'auto_regen'
              ? { status: 'success', timestamp: Date.now(), reason: 'auto_regen dispatched' }
              : null,
          lastCaptureAt: current.capturedAt,
          confidence: current.confidence,
        });
      } catch {
        // Best-effort: never crash the apply flow
      }
    }

    return current;
  } catch {
    // Best-effort: never crash the apply flow
    return null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Promise-based sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
