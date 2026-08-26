// SPDX-License-Identifier: MPL-2.0

/**
 * # Performance Trace Types
 *
 * Data shapes for instrumenting theme-apply operations. A {@link ThemeApplyTrace}
 * captures the full lifecycle of a single apply/restore call, broken into named
 * {@link PerformanceStep} entries so callers can pinpoint which phase consumed
 * time or failed.
 *
 * ## Boundary
 *
 * These types live under `main/services/performance/` (not `shared/`) because
 * they record main-process timing only. If a renderer-facing summary is needed
 * in the future, project only the fields that matter for the UI.
 */

/** A single named, timed phase within a theme-apply trace. */
export interface PerformanceStep {
  /** Human-readable phase name (e.g. "resolveTheme", "cdpConnect", "injectCss"). */
  name: string;
  /** High-resolution start timestamp in milliseconds. */
  startedAt: number;
  /** Elapsed time for this step in milliseconds. */
  duration: number;
  /** True if the step completed without throwing. */
  success: boolean;
  /** Error message when `success` is false; undefined on success. */
  error?: string;
  /** Parent step name. Present only on sub-steps that belong to a parent step
   *  (e.g. "connectWebSocket" may have `parentId: "cdpDiscovery"`). */
  parentId?: string;
  /** Sub-steps nested under this step. Populated only on steps that have
   *  been decomposed into finer-grained sub-operations. */
  children?: PerformanceStep[];
}

/**
 * Recursively sum the `duration` of a step and all its descendants.
 *
 * If a step has `children`, the function returns the sum of the children's
 * (recursively computed) durations — this gives an accurate wall-clock
 * figure even when the parent's own `duration` was measured independently.
 * For leaf steps (no children), this simply returns `step.duration`.
 *
 * @param step  The performance step whose total descendant duration to compute.
 * @returns     Total duration in milliseconds across the step and all descendants.
 */
export function sumStepDuration(step: PerformanceStep): number {
  if (step.children && step.children.length > 0) {
    return step.children.reduce((acc, child) => acc + sumStepDuration(child), 0);
  }
  return step.duration;
}

/** Hardware / runtime context captured at trace start. */
export interface DeviceInfo {
  /** Operating system platform (e.g. "win32", "darwin", "linux"). */
  platform: string;
  /** CPU architecture (e.g. "x64", "arm64"). */
  arch: string;
  /** Number of logical CPU cores. */
  cpus: number;
  /** Total physical memory in megabytes. */
  totalMemory: number;
  /** Free physical memory in megabytes at trace start. */
  freeMemory: number;
  /** Electron framework version. */
  electronVersion: string;
}

/**
 * IPC handler timeout event — a standalone record distinct from a full
 * {@link ThemeApplyTrace}. Captures the moment an IPC invoke exceeded its
 * configured threshold so diagnostics can surface handler health without
 * scanning the full apply history.
 */
export interface IpcTimeoutEvent {
  /** Monotonically incremented identifier, e.g. "timeout_001". */
  id: string;
  /** The IPC channel literal that timed out (e.g. "THEME_APPLY"). */
  channel: string;
  /** Actual timeout threshold (ms) configured for the handler. */
  ms: number;
  /** Monotonic timestamp ({@link Date.now}) when the timeout fired. */
  timestamp: number;
}

/** Full record of a single theme-apply or theme-restore operation. */
export interface ThemeApplyTrace {
  /** Unique trace identifier, monotonically incremented (e.g. "apply_001"). */
  id: string;
  /** Agent id the theme was applied to. */
  agentId: string;
  /** Theme id when available (omitted for restore-to-default operations). */
  themeId?: string;
  /** High-resolution start timestamp in milliseconds. */
  startedAt: number;
  /** Wall-clock timestamp (epoch ms) when the trace was finalized. Derived
   *  from the monotonic `startedAt` plus measured `duration` so both share the
   *  same clock source (no separate `Date.now()` call). Used by the
   *  Diagnostics UI for display. */
  finishedAt: number;
  /** Total elapsed time for the entire apply in milliseconds. */
  duration: number;
  /** True if the apply completed end-to-end without an unhandled error. */
  success: boolean;
  /** Chronological list of steps performed during the apply. */
  steps: PerformanceStep[];
  /** Top-level error message when `success` is false; undefined on success. */
  error?: string;
  /** Hardware / runtime context captured at trace start. */
  device: DeviceInfo;
}
