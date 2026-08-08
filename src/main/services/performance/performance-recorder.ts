// SPDX-License-Identifier: MPL-2.0

/**
 * # Performance Recorder
 *
 * Minimal high-resolution timer that records a theme-apply operation as a
 * sequence of timed steps. Invoke {@link PerformanceRecorder.start} to begin
 * a trace, chain {@link ApplyTraceBuilder.step} calls for each phase, then
 * call {@link ApplyTraceBuilder.finish} to finalize the trace.
 *
 * ## Timing source
 *
 * Uses `process.hrtime.bigint()` for monotonic sub-millisecond precision,
 * converted to milliseconds for the public API.
 *
 * ## Single-trace model
 *
 * Only one trace is active at a time. Calling `start()` while a trace is
 * in-flight throws to prevent accidental interleaving. This mirrors the
 * constraint that theme-apply operations are serialized by the orchestrator.
 *
 * ## Error behavior
 *
 * Each `step()` wraps the callback in a try/catch: on failure the step is
 * recorded with `success: false` and the error message, then the error is
 * re-thrown so the caller's control flow is unchanged — errors are never
 * silently swallowed.
 */

import os from 'node:os';
import type { DeviceInfo, PerformanceStep, ThemeApplyTrace } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Current time in milliseconds via `process.hrtime.bigint()`. */
function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

/** Format a zero-padded apply id (e.g. 1 -> "apply_001"). */
function formatId(n: number): string {
  return `apply_${String(n).padStart(3, '0')}`;
}

/** Collect device / runtime information for trace attribution. */
function collectDeviceInfo(): DeviceInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMemory: Math.round(os.totalmem() / 1024 / 1024),
    freeMemory: Math.round(os.freemem() / 1024 / 1024),
    electronVersion: process.versions.electron ?? 'unknown',
  };
}

/**
 * Function type exposed to step callbacks so they can attach sub-steps
 * with pre-measured durations without needing direct builder access.
 */
export type AddSubStepFn = (
  name: string,
  duration: number,
  success?: boolean,
  error?: string,
) => void;

// ---------------------------------------------------------------------------
// ApplyTraceBuilder
// ---------------------------------------------------------------------------

/**
 * Mutable builder for a single theme-apply trace. Constructed via
 * {@link PerformanceRecorder.start}; not intended for direct construction
 * by consumers.
 */
export class ApplyTraceBuilder {
  public readonly traceId: string;
  private readonly agentId: string;
  private readonly themeId?: string;
  private readonly device: DeviceInfo;
  private readonly startedAt: number;
  private readonly steps: PerformanceStep[] = [];
  /** Sub-steps keyed by parent step name; assembled during {@link finish}. */
  private readonly pendingSubSteps: Map<string, PerformanceStep[]> = new Map();
  private error?: string;
  private finalized = false;

  constructor(traceId: string, agentId: string, device: DeviceInfo, themeId?: string) {
    this.traceId = traceId;
    this.agentId = agentId;
    this.themeId = themeId;
    this.device = device;
    this.startedAt = nowMs();
  }

  /**
   * Execute `fn`, recording the timing and outcome as a named step.
   *
   * Two overloads:
   *   1. `step(name, fn)` — `fn` takes no arguments; simple phase wrapping.
   *   2. `step(name, fn)` — `fn` receives an {@link AddSubStepFn} callback
   *      that lets callers register finer-grained sub-steps. These sub-steps
   *      are attached as `.children[]` on the parent step during `finish()`.
   *
   * On success the step is appended with `success: true` and the return
   * value is passed through. On failure the step is appended with
   * `success: false` and `error` set to the message of the caught error,
   * then the original error is re-thrown.
   *
   * @param name  Human-readable phase identifier.
   * @param fn    Async operation to time. May optionally accept an
   *              `addSubStep` callback as its first argument.
   */
  async step<T>(
    name: string,
    fn: ((addSubStep: AddSubStepFn) => Promise<T>) | (() => Promise<T>),
  ): Promise<T> {
    if (this.finalized) {
      throw new Error(`Trace "${this.traceId}" is already finalized; cannot add step "${name}".`);
    }

    // Scoped addSubStep that tags sub-steps with this step's name as parent.
    const scopedAddSubStep: AddSubStepFn = (subName, duration, success, error) => {
      return this.addSubStep(name, subName, duration, success, error);
    };

    const stepStart = nowMs();
    try {
      // Runtime arity detection: pass addSubStep only when fn declares a parameter.
      const result =
        fn.length > 0
          ? await (fn as (addSubStep: AddSubStepFn) => Promise<T>)(scopedAddSubStep)
          : await (fn as () => Promise<T>)();
      this.steps.push({
        name,
        startedAt: stepStart,
        duration: nowMs() - stepStart,
        success: true,
      });
      return result;
    } catch (err) {
      const duration = nowMs() - stepStart;
      const message = err instanceof Error ? err.message : String(err);
      this.steps.push({
        name,
        startedAt: stepStart,
        duration,
        success: false,
        error: message,
      });
      // Record the first error as the trace-level error as well.
      if (!this.error) {
        this.error = message;
      }
      throw err;
    }
  }

  /**
   * Register a sub-step under a parent step. Intended to be called from
   * within a step callback (via the `addSubStep` parameter) with a
   * pre-measured duration. Sub-steps are assembled into `children[]`
   * during {@link finish}.
   *
   * @param parentName  Name of the owning parent step.
   * @param name        Sub-step name (e.g. "connectWebSocket").
   * @param duration    Measured elapsed time in milliseconds.
   * @param success     Whether the sub-step completed successfully.
   * @param error       Error message when `success` is false.
   */
  addSubStep(
    parentName: string,
    name: string,
    duration: number,
    success = true,
    error?: string,
  ): void {
    if (this.finalized) {
      throw new Error(
        `Trace "${this.traceId}" is already finalized; cannot add sub-step "${name}".`,
      );
    }
    const subStep: PerformanceStep = {
      name,
      startedAt: this.startedAt,
      duration,
      success,
      ...(error !== undefined ? { error } : {}),
      parentId: parentName,
    };
    const bucket = this.pendingSubSteps.get(parentName);
    if (bucket) {
      bucket.push(subStep);
    } else {
      this.pendingSubSteps.set(parentName, [subStep]);
    }
  }

  /**
   * Finalize the trace, freezing all recorded steps and computing totals.
   *
   * Sub-steps registered via {@link addSubStep} are attached to their parent
   * step's `children` array; parents are then re-ordered so that sub-steps
   * appear immediately after their parent in the flat `steps` list.
   *
   * Must be called exactly once. Returns the immutable {@link ThemeApplyTrace}
   * and releases the singleton so a new trace can be started.
   */
  finish(): ThemeApplyTrace {
    if (this.finalized) {
      throw new Error(`Trace "${this.traceId}" has already been finalized.`);
    }
    this.finalized = true;

    // Determine end-of-life: singleton is released first so a concurrent
    // start() call can begin immediately after finalization.
    PerformanceRecorder.release();

    const totalDuration = nowMs() - this.startedAt;
    const success = !this.error;

    // Build final flat-step list, interleaving children after their parent.
    const orderedSteps: PerformanceStep[] = [];
    for (const step of this.steps) {
      // Attach children array (copy) if any sub-steps were registered.
      const children = this.pendingSubSteps.get(step.name);
      if (children && children.length > 0) {
        const parentWithChildren: PerformanceStep = { ...step, children: children.slice() };
        orderedSteps.push(parentWithChildren);
        orderedSteps.push(...children);
      } else {
        orderedSteps.push(step);
      }
    }

    return {
      id: this.traceId,
      agentId: this.agentId,
      themeId: this.themeId,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      duration: totalDuration,
      success,
      steps: orderedSteps,
      error: this.error,
      device: this.device,
    };
  }
}

// ---------------------------------------------------------------------------
// PerformanceRecorder (static singleton)
// ---------------------------------------------------------------------------

/**
 * Static entry point for creating theme-apply traces. Maintains a monotonically
 * increasing sequence counter and ensures only one trace is in-flight at a time.
 *
 * Intentionally a static-only class: it doubles as a module namespace and keeps
 * the in-flight trace invariant in one obvious place. Consumers call
 * `PerformanceRecorder.start(...)` / `.finishTrace(...)` without instantiation.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: deliberate static singleton (see above)
export class PerformanceRecorder {
  /** Monotonically increasing sequence for id generation. */
  private static sequence = 0;

  /** Currently active trace, or null when idle. */
  private static active: ApplyTraceBuilder | null = null;

  /**
   * Begin a new theme-apply trace. Throws if a trace is already in-flight.
   *
   * @param agentId  Target agent id.
   * @param themeId  Theme id (optional; omit for restore-to-default).
   */
  static start(agentId: string, themeId?: string): ApplyTraceBuilder {
    if (PerformanceRecorder.active) {
      throw new Error(
        'Cannot start a new performance trace: trace ' +
          `"${PerformanceRecorder.active.traceId}" is already in-flight. ` +
          'Call finish() on the current trace before starting another.',
      );
    }
    PerformanceRecorder.sequence += 1;
    const id = formatId(PerformanceRecorder.sequence);
    const device = collectDeviceInfo();
    const builder = new ApplyTraceBuilder(id, agentId, device, themeId);
    PerformanceRecorder.active = builder;
    return builder;
  }

  /** Release the active trace (called internally by `finish()`). */
  static release(): void {
    PerformanceRecorder.active = null;
  }

  /**
   * Returns the currently active trace builder, or null when idle.
   * Primarily useful for tests and diagnostics.
   */
  static getActive(): ApplyTraceBuilder | null {
    return PerformanceRecorder.active;
  }

  /** Reset sequence counter and clear active trace. Intended for test teardown. */
  static reset(): void {
    PerformanceRecorder.sequence = 0;
    PerformanceRecorder.active = null;
  }
}
