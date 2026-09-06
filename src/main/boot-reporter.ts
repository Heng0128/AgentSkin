// SPDX-License-Identifier: MPL-2.0

/**
 * # Boot Progress Reporter
 *
 * Real-time progress estimation engine for the splash screen. Replaces the
 * previous hardcoded jump-cut percentages (5 → 15 → 25 → …) with a smooth
 * interpolation model that accounts for per-step estimated weight.
 *
 * ## Design
 *
 * Each boot step registers with an estimated weight (0–100) representing its
 * share of total boot work. The reporter computes the overall progress range
 * for the currently active step and interpolates toward its target using
 * `requestAnimationFrame`-driven smooth animation on the renderer side.
 *
 * The model also supports "warm-up" phases — background work that runs
 * concurrently with the boot sequence and updates progress independently
 * within the 60%–90% range.
 *
 * ## Usage
 *
 * ```typescript
 * const reporter = new BootProgressReporter(sendFn);
 *
 * // Register boot steps (order matters)
 * reporter.addStep('加载主题库...', 15);
 * reporter.addStep('加载设置...', 10);
 * reporter.addStep('初始化壁纸引擎...', 10);
 *
 * // Report current step progress (0–1 within the step)
 * reporter.advance('加载主题库...', 0.5);  // halfway through step 1
 *
 * // Start a warm-up phase (auto-managed within 60–90% range)
 * reporter.startWarmUp('预编译主题样式...');
 * reporter.reportWarmUp(0.3);  // 30% of warm-up done
 * reporter.endWarmUp();
 * ```
 */

/**
 * A single registered boot step.
 */
export interface BootStep {
  /** Human-readable label shown on the splash. */
  label: string;
  /** Weight (0–100) representing this step's share of total boot work. */
  weight: number;
}

/**
 * Reporter state exposed for testing and debugging.
 */
export interface ReporterState {
  currentLabel: string;
  currentPct: number;
  isWarmUp: boolean;
  isBootComplete: boolean;
}

export type ProgressSender = (label: string, pct: number) => void;

export class BootProgressReporter {
  private steps: BootStep[] = [];
  private currentIndex = -1;
  private totalWeight = 0;
  private _isWarmUp = false;
  private _currentWarmUpLabel: string | null = null;
  private _isBootComplete = false;
  private _send: ProgressSender;
  private _lastSentLabel = '';
  private _lastSentPct = -1;

  constructor(send: ProgressSender) {
    this._send = send;
  }

  // ── Step registration ──────────────────────────────────────────────

  /** Register a boot step. Call in order before starting. */
  addStep(label: string, weight: number): this {
    this.steps.push({ label, weight });
    this.totalWeight += weight;
    return this;
  }

  // ── Progress reporting ────────────────────────────────────────────

  /**
   * Advance to a specific step and report its internal progress.
   *
   * @param label - The step label (must match a registered step).
   * @param stepProgress - Progress within this step (0–1).   */
  advance(label: string, stepProgress: number): void {
    this._isBootComplete = false;
    const idx = this.steps.findIndex((s) => s.label === label);
    if (idx === -1) return;
    this.currentIndex = idx;
    const priorWeight = this.steps.slice(0, idx).reduce((sum, s) => sum + s.weight, 0);
    const stepWeight = this.steps[idx]!.weight;
    const clampedProgress = Math.max(0, Math.min(1, stepProgress));
    const pct = (priorWeight + stepWeight * clampedProgress) / this.totalWeight;
    this._sendIfChanged(label, Math.round(pct * 1000) / 10);
  }

  /**
   * Complete the current step and move to the next one.
   * Equivalent to calling `advance(label, 1.0)` then advancing the index.   */
  completeStep(label: string): void {
    const idx = this.steps.findIndex((s) => s.label === label);
    if (idx === -1 || idx < this.currentIndex) return;
    // Send 100% for this step
    const priorWeight = this.steps.slice(0, idx + 1).reduce((sum, s) => sum + s.weight, 0);
    const pct = priorWeight / this.totalWeight;
    this._sendIfChanged(label, Math.round(pct * 1000) / 10);
    this.currentIndex = idx + 1;
  }

  // ── Warm-up phases ─────────────────────────────────────────────────

  // Warm-up sub-phases are registered as ordinary boot steps (in
  // `boot-sequence.ts`) with their own weights, so they share the same
  // normalized 0–100% progress pool. This keeps the bar strictly monotonic:
  // a warm-up phase advances between the boot steps that surround it instead
  // of owning a separate fixed 60–90% window that could make the bar regress.

  /** Start a warm-up sub-phase (label must be pre-registered via `addStep`). */
  startWarmUp(label: string): void {
    this._isWarmUp = true;
    this._currentWarmUpLabel = label;
    this.advance(label, 0);
  }

  /**
   * Report progress within the current warm-up sub-phase.
   * @param progress - 0–1 within the current sub-phase.
   */
  reportWarmUp(progress: number): void {
    if (!this._isWarmUp || !this._currentWarmUpLabel) return;
    this.advance(this._currentWarmUpLabel, Math.max(0, Math.min(1, progress)));
  }

  /** Mark the current warm-up sub-phase as complete. */
  endWarmUp(): void {
    if (!this._isWarmUp || !this._currentWarmUpLabel) return;
    this.completeStep(this._currentWarmUpLabel);
    this._currentWarmUpLabel = null;
  }

  /** Finish all warm-up phases. Returns to normal boot-step mode. */
  completeWarmUp(): void {
    this._isWarmUp = false;
    this._currentWarmUpLabel = null;
  }

  // ── Boot completion ──────────────────────────────────────────────────

  /** Mark the entire boot sequence as complete (100%). */
  completeBoot(label?: string): void {
    this._isBootComplete = true;
    this._isWarmUp = false;
    this._sendIfChanged(label ?? '就绪', 100);
  }

  // ── Step degradation ────────────────────────────────────────────────

  /**
   * Report the current step as skipped due to a failure — keeps the label
   * visible on the splash with a "(跳过)" suffix at the current percentage
   * so the user sees the step was degraded rather than silently skipped.
   */
  skipped(label: string): void {
    this._sendIfChanged(`${label} (跳过)`, this._lastSentPct);
  }

  /** Last reported overall percentage (0–100). */
  get pct(): number {
    return this._lastSentPct;
  }

  // ── State access ─────────────────────────────────────────────────────

  get isWarmUp(): boolean {
    return this._isWarmUp;
  }
  get isBootComplete(): boolean {
    return this._isBootComplete;
  }

  // ── Internal ───────────────────────────────────────────────────────

  private _sendIfChanged(label: string, pct: number): void {
    if (label === this._lastSentLabel && pct === this._lastSentPct) return;
    this._lastSentLabel = label;
    this._lastSentPct = pct;
    this._send(label, pct);
  }
}
