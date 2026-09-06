// SPDX-License-Identifier: MPL-2.0

/**
 * # Boot Progress Baseline
 *
 * Persists the measured per-step durations of the boot sequence so that, on
 * the *next* launch, the splash progress bar can advance in proportion to
 * real loading time instead of fixed guess weights.
 *
 * This is what makes the splash "tied to loading time": a step that actually
 * takes 1.5s gets a larger slice of the progress bar (and advances slowly
 * while it runs), while a step that takes 30ms gets a tiny slice. Without a
 * baseline we fall back to a default per-step budget, so even the first boot
 * advances with elapsed time rather than sitting still then jumping.
 *
 * The baseline is updated with an exponential moving average on every boot so
 * a single slow/fast run can't skew the weights permanently.
 */

import fs from 'node:fs';
import path from 'node:path';

/** File name of the persisted baseline inside the user data dir. */
const BASELINE_FILE = 'boot-progress.json';

/**
 * Fallback per-step duration budget (ms) used when no baseline exists for a
 * label. Keeps first-boot progress advancing with elapsed time even before
 * we have real measurements.
 */
export const DEFAULT_STEP_MS = 400;

/** How much of the latest run to keep (0–1) when smoothing the baseline. */
const SMOOTHING = 0.5;

/**
 * Per-step duration baseline: label → average duration in ms.
 */
export type BootBaseline = Record<string, number>;

/**
 * Load the persisted baseline. Returns an empty object when the file is
 * missing or unreadable (first launch / corrupted data) — never throws.
 */
export function loadBootBaseline(userDataRoot: string): BootBaseline {
  try {
    const raw = fs.readFileSync(path.join(userDataRoot, BASELINE_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: BootBaseline = {};
    // TODO: type-guard — 待渐进式加固
    for (const [label, ms] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        out[label] = ms;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge the latest run's timings into the persisted baseline with an
 * exponential moving average, then write it back. Best-effort: never throws.
 */
export function saveBootBaseline(
  userDataRoot: string,
  latestTimings: Array<{ label: string; durationMs: number }>,
): void {
  if (latestTimings.length === 0) return;
  const prev = loadBootBaseline(userDataRoot);
  const merged: BootBaseline = { ...prev };
  for (const { label, durationMs } of latestTimings) {
    if (durationMs <= 0) continue;
    const prior = merged[label];
    merged[label] = prior == null ? durationMs : prior * (1 - SMOOTHING) + durationMs * SMOOTHING;
  }
  try {
    fs.writeFileSync(
      path.join(userDataRoot, BASELINE_FILE),
      JSON.stringify(merged, null, 2),
      'utf8',
    );
  } catch {
    /* best-effort — a failed baseline write must never break boot */
  }
}

/**
 * Estimated duration (ms) for a boot step, from the baseline or a default.
 */
export function estimateStepMs(label: string, baseline: BootBaseline): number {
  const known = baseline[label];
  return known != null && Number.isFinite(known) && known > 0 ? known : DEFAULT_STEP_MS;
}
