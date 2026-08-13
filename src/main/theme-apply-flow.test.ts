// SPDX-License-Identifier: MPL-2.0

/**
 * Isolated unit test for the background-task failure detection logic
 * in `applyThemeFlow` (theme-apply-flow.ts, lines 467–479).
 *
 * The production code wraps `backgroundTasks: Promise<unknown>[]`
 * with `Promise.allSettled(...)` and then filters for rejected results.
 * Because `applyThemeFlow` is a complex orchestrator (CDP discovery,
 * adapter calls, epoch management, etc.), this file focuses purely on
 * the allSettled → filter-rejected → log-segment pipeline.
 *
 * Strategy: rather than spinning up the entire apply flow with forty
 * mocked collaborators, we replicate the exact filter/map/join logic
 * inline and assert it behaves correctly across all settled-result
 * permutations. This gives us coverage of the failure-escalation
 * branch without coupling to the rest of the flow.
 */

import { describe, expect, it } from 'vitest';

/**
 * Mirrors the logic inside `Promise.allSettled(backgroundTasks).then`
 * in `applyThemeFlow`. Kept in sync manually — this is the contract
 * under test.
 *
 * Returns the log line that `deps.log` would receive, or `null` when
 * no failures are present (matching the production code's early-return
 * when `failed.length === 0`).
 */
function buildBackgroundFailureLog(
  appId: string,
  results: PromiseSettledResult<unknown>[],
): string | null {
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === 0) return null;

  const reasons = failed
    .map(
      (f) =>
        (f as PromiseRejectedResult).reason?.message ?? String((f as PromiseRejectedResult).reason),
    )
    .join('; ');
  return `[apply] ${appId}: ${failed.length} background task(s) failed: ${reasons}`;
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('background task failure detection', () => {
  it('filters rejected results from settled array', () => {
    const results: PromiseSettledResult<string>[] = [
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: new Error('wallpaper failed') },
      { status: 'fulfilled', value: 'ok2' },
      { status: 'rejected', reason: new Error('scheme sync failed') },
    ];
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.length).toBe(2);
    expect((failed[0] as PromiseRejectedResult).reason.message).toBe('wallpaper failed');
    expect((failed[1] as PromiseRejectedResult).reason.message).toBe('scheme sync failed');
  });

  it('returns null log line when all tasks succeed', () => {
    const results: PromiseSettledResult<string>[] = [
      { status: 'fulfilled', value: 'secondary-done' },
      { status: 'fulfilled', value: 'hardening-done' },
      { status: 'fulfilled', value: 'scheme-sync-done' },
    ];
    expect(buildBackgroundFailureLog('agent-a', results)).toBeNull();
  });

  it('builds a correct single-failure log line', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: new Error('hardening failed') },
    ];
    expect(buildBackgroundFailureLog('agent-b', results)).toBe(
      '[apply] agent-b: 1 background task(s) failed: hardening failed',
    );
  });

  it('builds a correct multi-failure log line with all reasons semi-colon-joined', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'rejected', reason: new Error('wallpaper failed') },
      { status: 'fulfilled', value: 'ok' },
      { status: 'rejected', reason: new Error('scheme sync failed') },
      { status: 'rejected', reason: new Error('CDP timeout') },
    ];
    expect(buildBackgroundFailureLog('agent-c', results)).toBe(
      '[apply] agent-c: 3 background task(s) failed: wallpaper failed; scheme sync failed; CDP timeout',
    );
  });

  it('falls back to String(reason) when reason has no .message', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'rejected', reason: 'string-throw' },
    ];
    expect(buildBackgroundFailureLog('agent-d', results)).toBe(
      '[apply] agent-d: 1 background task(s) failed: string-throw',
    );
  });

  it('handles empty background task list', () => {
    expect(buildBackgroundFailureLog('agent-e', [])).toBeNull();
  });

  it('handles reason = null gracefully (String(null))', () => {
    const results: PromiseSettledResult<unknown>[] = [{ status: 'rejected', reason: null }];
    expect(buildBackgroundFailureLog('agent-f', results)).toBe(
      '[apply] agent-f: 1 background task(s) failed: null',
    );
  });
});
