// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../adapters/base';
import type { ApplyRequest } from '../shared/types';
import type { ThemeEntry } from './services/contracts';
import { type ApplyFlowDeps, applyThemeFlow, fastApplyThemeFlow } from './theme-apply-flow';

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
    notifyHotReload: vi.fn(),
    notifyBackgroundTaskFailure: vi.fn(),
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
