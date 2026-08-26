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
 * converted to milliseconds for the public API. Both `startedAt` and
 * `finishedAt` are derived from the same monotonic clock, and `duration`
 * equals `finishedAt - startedAt` exactly — no wall-clock `Date` is used.
 *
 * ## Per-agent trace map
 *
 * Each agent may have at most one in-flight trace at a time. Concurrent
 * applies to DIFFERENT agents each get their own real trace; a concurrent
 * apply to the SAME agent (should not happen due to the per-agent dedup
 * lock in `agent-engine-service`, but defended here) receives an isolated
 * builder that is NOT registered in the map — its `release()` is a no-op
 * so it never disturbs the real trace. Deep-layer `recordNamedStep` calls
 * land in the currently registered trace for the matching agent.
 *
 * The legacy `ShadowTrace` class has been eliminated: a registered
 * `ApplyTraceBuilder` is always returned, and per-agent dedup is handled
 * by the map lookup.
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
  public readonly agentId: string;
  private readonly themeId?: string;
  private readonly device: DeviceInfo;
  private readonly startedAt: number;
  private readonly wallClockStart: number;
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
    this.wallClockStart = Date.now();
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
   * Append a standalone top-level step (not a child of another step) with a
   * pre-measured duration. Used by deep CDP layers (`connectCdp`,
   * `connectEventCdp`, `waitForTheme`, subprocess spawn) that record timing
   * outside a `step()` callback but still want to land inside the active
   * apply trace.
   *
   * Unlike sub-steps, this produces a first-class row in the trace's `steps`
   * list (not a `children[]` on a parent). It is a no-op concern-wise so
   * callers may invoke it unconditionally; it only throws if the trace is
   * already finalized.
   */
  appendStep(name: string, duration: number, success = true, error?: string): void {
    if (this.finalized) {
      throw new Error(
        `Trace "${this.traceId}" is already finalized; cannot append step "${name}".`,
      );
    }
    this.steps.push({
      name,
      startedAt: nowMs() - duration,
      duration,
      success,
      ...(error !== undefined ? { error } : {}),
    });
  }

  /**
   * Finalize the trace, freezing all recorded steps and computing totals.
   *
   * Sub-steps registered via {@link addSubStep} are attached to their parent
   * step's `children` array; parents are then re-ordered so that sub-steps
   * appear immediately after their parent in the flat `steps` list.
   *
   * Must be called exactly once. Returns the immutable {@link ThemeApplyTrace}
   * and releases the per-agent slot so a new trace can be started.
   */
  finish(): ThemeApplyTrace {
    if (this.finalized) {
      throw new Error(`Trace "${this.traceId}" has already been finalized.`);
    }
    this.finalized = true;

    // Release this agent's slot only if this builder is the registered one.
    PerformanceRecorder.release(this.agentId, this);

    const finishedAt = nowMs();
    const totalDuration = finishedAt - this.startedAt;
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
      finishedAt: this.wallClockStart + totalDuration,
      duration: totalDuration,
      success,
      steps: orderedSteps,
      error: this.error,
      device: this.device,
    };
  }
}

// ---------------------------------------------------------------------------
// PerformanceRecorder (static per-agent map)
// ---------------------------------------------------------------------------

/**
 * Static entry point for creating theme-apply traces. Maintains a monotonically
 * increasing sequence counter and a per-agent map of in-flight traces.
 *
 * Intentionally a static-only class: it doubles as a module namespace and keeps
 * the per-agent trace invariant in one obvious place. Consumers call
 * `PerformanceRecorder.start(...)` / `.finishTrace(...)` without instantiation.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: deliberate static singleton (see above)
export class PerformanceRecorder {
  /** Monotonically increasing sequence for id generation. */
  private static sequence = 0;

  /** Per-agent in-flight traces. Keyed by agentId. */
  private static traces: Map<string, ApplyTraceBuilder> = new Map();

  /**
   * Begin a new theme-apply trace.
   *
   * When a trace is already in-flight for the same agent (concurrent apply),
   * returns an isolated builder that is NOT registered in the map — its
   * `release()` is a no-op so it never disturbs the real trace. This preserves
   * the invariant that observability never breaks the core injection path.
   *
   * @param agentId  Target agent id.
   * @param themeId  Theme id (optional; omit for restore-to-default).
   */
  static start(agentId: string, themeId?: string): ApplyTraceBuilder {
    const registered = PerformanceRecorder.traces.get(agentId);
    PerformanceRecorder.sequence += 1;
    const id = formatId(PerformanceRecorder.sequence);
    const device = collectDeviceInfo();
    const builder = new ApplyTraceBuilder(id, agentId, device, themeId);
    // Only register if no trace is currently in-flight for this agent.
    if (!registered) {
      PerformanceRecorder.traces.set(agentId, builder);
    }
    return builder;
  }

  /**
   * Release an agent's trace slot. Only removes the entry if it points to
   * `builder` — this prevents an isolated (unregistered) builder from
   * accidentally removing the real trace.
   */
  static release(agentId: string, builder: ApplyTraceBuilder): void {
    if (PerformanceRecorder.traces.get(agentId) === builder) {
      PerformanceRecorder.traces.delete(agentId);
    }
  }

  /**
   * Returns the currently registered trace builder for an agent, or null.
   * Primarily useful for tests and diagnostics.
   */
  static getActive(agentId?: string): ApplyTraceBuilder | null {
    if (agentId) {
      return PerformanceRecorder.traces.get(agentId) ?? null;
    }
    // Backward compat: return the first registered trace.
    const first = PerformanceRecorder.traces.values().next();
    return first.done ? null : first.value;
  }

  /**
   * Record a standalone named step into the active trace (RFC §4.9). Intended
   * for deep layers — `connectCdp`, `connectEventCdp`, `waitForTheme`,
   * subprocess spawn — that measure their own duration and cannot be wrapped
   * by a `step()` callback up in the apply orchestrator. No-op when no trace
   * is in-flight for the given agent.
   *
   * @param agentId  Target agent id (optional; uses first registered trace).
   * @param name     Step name (e.g. 'connectCdp', 'connectEventCdp', 'waitForTheme', 'spawnAgent').
   * @param duration Measured elapsed time in milliseconds.
   * @param success  Whether the operation completed successfully.
   * @param error    Error message when `success` is false.
   */
  static recordNamedStep(
    agentId: string | undefined,
    name: string,
    duration: number,
    success = true,
    error?: string,
  ): void {
    const builder = agentId
      ? (PerformanceRecorder.traces.get(agentId) ?? null)
      : PerformanceRecorder.getActive();
    if (!builder) return;
    builder.appendStep(name, duration, success, error);
  }

  /** Reset sequence counter and clear all traces. Intended for test teardown. */
  static reset(): void {
    PerformanceRecorder.sequence = 0;
    PerformanceRecorder.traces.clear();
  }
}
