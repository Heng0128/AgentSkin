// SPDX-License-Identifier: MPL-2.0

/**
 * # Boot Profiler
 *
 * Records per-step durations for the boot sequence and emits a compact
 * performance report (total + top slowest steps) so slow starts can be
 * diagnosed from the runtime log without DevTools.
 *
 * Steps are timed by wrapping the same `runStep` helper in boot-sequence.ts
 * that already degrades failures — one wrapper covers every step.
 */

export interface BootTiming {
  /** Step label as shown on the splash (e.g. '加载主题库...'). */
  label: string;
  durationMs: number;
}

export class BootProfiler {
  private startedAt = Date.now();
  private current: { label: string; startedAt: number } | null = null;
  private timings: BootTiming[] = [];

  /** Start timing a step. Replaces any unfinished step. */
  begin(label: string): void {
    this.current = { label, startedAt: Date.now() };
  }

  /** Stop timing the current step and record its duration. */
  end(): void {
    if (!this.current) return;
    this.timings.push({
      label: this.current.label,
      durationMs: Date.now() - this.current.startedAt,
    });
    this.current = null;
  }

  /** Total boot-sequence time in ms. */
  get totalMs(): number {
    return Date.now() - this.startedAt;
  }

  /**
   * Read-only copy of the recorded per-step timings, for persistence and for
   * driving next boot's progress weighting.
   */
  getTimings(): BootTiming[] {
    return this.timings.map((t) => ({ label: t.label, durationMs: t.durationMs }));
  }

  /**
   * Compact report: total + the N slowest steps, for the runtime log.
   * Returns an empty body when no step was timed (defensive).
   */
  report(limit = 5): string {
    const header = `[perf] Boot completed in ${this.totalMs}ms (${this.timings.length} steps)`;
    if (this.timings.length === 0) return header;
    const sorted = [...this.timings].sort((a, b) => b.durationMs - a.durationMs);
    const top = sorted
      .slice(0, limit)
      .map((t) => `  ${t.label}: ${t.durationMs}ms`)
      .join('\n');
    return `${header}\nTop steps:\n${top}`;
  }
}
