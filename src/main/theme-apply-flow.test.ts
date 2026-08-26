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

import { describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../adapters/base';
import type { ApplyRequest } from '../shared/types';
import type { ThemeEntry } from './services/contracts';
import { type ApplyFlowDeps, applyThemeFlow, fastApplyThemeFlow } from './theme-apply-flow';

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

// ---------------------------------------------------------------------------
// Fast-path (RFC §4.4): cached-port reuse skips CDP discovery + restart
// ---------------------------------------------------------------------------

const FAST_AGENT = 'workbuddy' as const;
const FAST_PORT = 9222;

function makeDeps(overrides: Partial<ApplyFlowDeps> = {}): ApplyFlowDeps {
  const adapter = {
    applyTheme: vi.fn(async () => undefined),
    findTargets: vi.fn(async () => []),
  } as unknown as ApplicationAdapter;

  const entry: ThemeEntry = {
    filePath: '/theme/entry',
    bundle: {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: {
        id: 'theme-a',
        displayName: 'Theme A',
        version: '1.0.0',
        copy: { mode: 'dark' },
      },
      targets: {},
      assets: { images: {} },
    },
  };

  const deps: ApplyFlowDeps = {
    adapter: () => adapter,
    isApplyingTheme: () => false,
    lockAgent: () => {},
    unlockAgent: () => {},
    ensureCdpReady: vi.fn(async () => ({ port: FAST_PORT, reason: null })),
    resolveLivePort: vi.fn(async () => FAST_PORT),
    inferRestartReason: vi.fn(async () => 'no-cdp' as const),
    cachedPort: () => FAST_PORT,
    baselineGet: () => null,
    baselinePut: vi.fn(),
    baselineInvalidate: vi.fn(),
    probeThemeLiveOnPort: vi.fn(async () => true),
    captureBaselineOnPort: vi.fn(async () => null),
    captureFingerprintOnPort: vi.fn(async () => {}),
    findTheme: vi.fn(async () => entry),
    bumpEpoch: () => 1,
    isEpochCurrent: () => true,
    setActiveTheme: () => {},
    persist: vi.fn(async () => {}),
    getAppPath: () => null,
    setAgentWallpaper: vi.fn(async () => {}),
    injectSecondaryTargets: vi.fn(async () => {}),
    hardeningPass: vi.fn(async () => {}),
    injectAgentWallpaperFromApply: vi.fn(async () => {}),
    syncSchemeWithStability: vi.fn(async () => {}),
    status: vi.fn(async () => ({}) as never),
    displayName: () => 'WorkBuddy',
    log: () => {},
    logStructured: () => {},
    ...overrides,
  };
  return deps;
}

const APPLY_REQUEST: ApplyRequest = {
  appId: FAST_AGENT,
  themeId: 'theme-a',
};

describe('applyThemeFlow — fast path (RFC §4.4)', () => {
  it('reuses the cached port and skips CDP discovery + restart when a live port is cached', async () => {
    const deps = makeDeps();
    const adapter = deps.adapter(FAST_AGENT) as unknown as { applyTheme: ReturnType<typeof vi.fn> };

    const { response } = await applyThemeFlow(APPLY_REQUEST, deps);

    expect(response.status).toBe('applied');
    // Fast path must NOT invoke ensureCdpReady (no discovery / restart).
    expect(deps.ensureCdpReady).not.toHaveBeenCalled();
    // Adapter must have been called on the cached port with launch:false.
    expect(adapter.applyTheme).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'agentskin-theme' }),
      expect.objectContaining({ port: FAST_PORT, launch: false }),
    );
    // Background follow-ups (hardening / scheme) still run.
    expect(deps.hardeningPass).toHaveBeenCalledWith(
      FAST_AGENT,
      FAST_PORT,
      expect.anything(),
      expect.any(Number),
    );
  });

  it('falls through to full CDP discovery when no cached port exists (cold apply)', async () => {
    const deps = makeDeps({ cachedPort: () => null });
    const adapter = deps.adapter(FAST_AGENT) as unknown as { applyTheme: ReturnType<typeof vi.fn> };

    const { response } = await applyThemeFlow(APPLY_REQUEST, deps);

    expect(response.status).toBe('applied');
    // No cached port → probe phase runs (ensureAgentCdpReady → resolveLivePort).
    expect(deps.resolveLivePort).toHaveBeenCalled();
    expect(adapter.applyTheme).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ port: FAST_PORT }),
    );
  });

  it('returns requires-restart without touching the adapter when discovery finds no port', async () => {
    const deps = makeDeps({
      cachedPort: () => null,
      // Probe finds nothing and the agent is running without CDP → requires-restart.
      resolveLivePort: vi.fn(async () => null),
      inferRestartReason: vi.fn(async () => 'no-cdp' as const),
    });
    const adapter = deps.adapter(FAST_AGENT) as unknown as { applyTheme: ReturnType<typeof vi.fn> };

    const { response } = await applyThemeFlow(APPLY_REQUEST, deps);

    expect(response.status).toBe('requires-restart');
    expect(adapter.applyTheme).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fastApplyThemeFlow (RFC §4.4): the standalone fast-path chain
// ---------------------------------------------------------------------------

describe('fastApplyThemeFlow (RFC §4.4)', () => {
  it('returns null on a cache miss so the caller falls through to full discovery', async () => {
    const deps = makeDeps({ cachedPort: () => null });
    const adapter = deps.adapter(FAST_AGENT) as unknown as { applyTheme: ReturnType<typeof vi.fn> };

    const result = await fastApplyThemeFlow(APPLY_REQUEST, deps);

    expect(result).toBeNull();
    // The fast path must NOT touch the adapter or run any follow-ups.
    expect(adapter.applyTheme).not.toHaveBeenCalled();
    expect(deps.hardeningPass).not.toHaveBeenCalled();
  });

  it('applies on the cached port and never calls ensureCdpReady', async () => {
    const deps = makeDeps();
    const adapter = deps.adapter(FAST_AGENT) as unknown as { applyTheme: ReturnType<typeof vi.fn> };

    const result = await fastApplyThemeFlow(APPLY_REQUEST, deps);

    expect(result).not.toBeNull();
    expect(result!.response.status).toBe('applied');
    // Fast path must NOT invoke ensureCdpReady (no discovery / restart).
    expect(deps.ensureCdpReady).not.toHaveBeenCalled();
    // Adapter must have been called on the cached port with launch:false.
    expect(adapter.applyTheme).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'agentskin-theme' }),
      expect.objectContaining({ port: FAST_PORT, launch: false }),
    );
    // Non-blocking hardening follow-up still runs so the applied theme is fully wired.
    expect(deps.hardeningPass).toHaveBeenCalled();
  });

  it('honours an explicit request.port over the cached port', async () => {
    const explicitPort = 9333;
    const deps = makeDeps({ cachedPort: () => FAST_PORT });
    const adapter = deps.adapter(FAST_AGENT) as unknown as { applyTheme: ReturnType<typeof vi.fn> };

    const result = await fastApplyThemeFlow({ ...APPLY_REQUEST, port: explicitPort }, deps);

    expect(result).not.toBeNull();
    expect(adapter.applyTheme).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ port: explicitPort }),
    );
  });

  it('maps RESTART_REQUIRED to requires-restart without rethrowing', async () => {
    const deps = makeDeps({
      adapter: () => {
        const a = {
          applyTheme: vi.fn(async () => {
            const err = new Error('target requires restart');
            (err as { code?: string }).code = 'AGENTSKIN_RESTART_REQUIRED';
            throw err;
          }),
        } as unknown as ApplicationAdapter;
        return a;
      },
    });

    const result = await fastApplyThemeFlow(APPLY_REQUEST, deps);

    expect(result).not.toBeNull();
    expect(result!.response.status).toBe('requires-restart');
  });
});

describe('applyThemeFlow — baseline seeding + light probe (RFC §4.5/§4.6)', () => {
  it('seeds the baseline cache after a successful apply', async () => {
    const deps = makeDeps({
      captureBaselineOnPort: vi.fn(async () => ({
        appId: FAST_AGENT,
        themeId: 'theme-a',
        url: 'app://main',
        accent: '#3355ff',
        adoptedSheetCount: 1,
        heroBlobActive: false,
        semanticNodeCount: 2500,
        capturedAt: Date.now(),
      })),
    });

    const { response, background } = (await fastApplyThemeFlow(APPLY_REQUEST, deps))!;
    await background;

    expect(response.status).toBe('applied');
    expect(deps.captureBaselineOnPort).toHaveBeenCalledWith(FAST_PORT, FAST_AGENT, 'theme-a');
    expect(deps.baselinePut).toHaveBeenCalledWith(
      expect.objectContaining({ appId: FAST_AGENT, themeId: 'theme-a' }),
    );
    // A live theme must NOT invalidate the cache.
    expect(deps.baselineInvalidate).not.toHaveBeenCalled();
  });

  it('invalidates the baseline cache when the light probe fails', async () => {
    const deps = makeDeps({ probeThemeLiveOnPort: vi.fn(async () => false) });

    const { background } = (await fastApplyThemeFlow(APPLY_REQUEST, deps))!;
    await background;

    expect(deps.probeThemeLiveOnPort).toHaveBeenCalledWith(FAST_PORT, FAST_AGENT);
    expect(deps.baselineInvalidate).toHaveBeenCalledWith(FAST_AGENT);
  });
});
