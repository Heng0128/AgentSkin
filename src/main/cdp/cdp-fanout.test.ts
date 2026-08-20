// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../../adapters/base';
import type {
  CdpTarget,
  ResolvedThemeTarget,
  ThemeBundle,
} from '../../legacy/agentskin-core-runtime';
import type { HealthCheckReport } from '../theme-health-check';
import type { CdpSession, EventCdpSession } from './cdp-client';
import type { CdpFanoutDeps } from './cdp-fanout';
import type { InjectEngineResult, InjectThemeResult } from './cdp-inject';
import type { RendererHints } from './renderer-rank';
import { CdpSessionPool } from './session-pool';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('./cdp-client', () => ({
  connectCdp: vi.fn(),
  connectEventCdp: vi.fn(),
}));

vi.mock('./cdp-targets', () => ({
  findDomTargets: vi.fn(),
}));

vi.mock('./cdp-inject', () => ({
  injectThemeViaCdp: vi.fn(),
  removeEngineInjection: vi.fn(),
}));

vi.mock('../theme-health-check', () => ({
  checkThemeHealth: vi.fn(),
}));

vi.mock('./secondary-inject', () => ({
  buildSecondaryInjectExpression: vi.fn(),
  buildSecondaryRemoveExpression: vi.fn(),
}));

vi.mock('../../legacy/agentskin-core-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../legacy/agentskin-core-runtime')>();
  return {
    ...actual,
    resolveThemeTargetFor: vi.fn(),
  };
});

// Import mocked modules AFTER mock declarations.
const { connectCdp, connectEventCdp } = await import('./cdp-client');
const { findDomTargets } = await import('./cdp-targets');
const { injectThemeViaCdp, removeEngineInjection } = await import('./cdp-inject');
const { checkThemeHealth } = await import('../theme-health-check');
const { buildSecondaryInjectExpression, buildSecondaryRemoveExpression } = await import(
  './secondary-inject'
);
const { resolveThemeTargetFor } = await import('../../legacy/agentskin-core-runtime');
const { hardeningPass, hardeningRemove, connectWithRetry } = await import('./cdp-fanout');
const { disposeReloadWatchdogs, getReloadWatchdogKeys } = await import('./reload-watchdog');

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCdpTarget(overrides: Partial<CdpTarget> = {}): CdpTarget {
  return {
    id: 'target-1',
    type: 'page',
    url: 'http://localhost',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    title: 'Test Page',
    ...overrides,
  };
}

function makeMockSession(overrides: Partial<CdpSession> = {}): CdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue('{"installed":true}'),
    close: vi.fn(),
    ...overrides,
  };
}

/** Event-aware session used by the reload watchdog (has on/off). */
function makeMockEventSession(): EventCdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue('{}'),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeResolvedTarget(overrides: Partial<ResolvedThemeTarget> = {}): ResolvedThemeTarget {
  return {
    theme: { id: 'cyber-neon', displayName: 'Cyber Neon', version: '1.0.0' },
    css: ':root { --primary: #0ff; }',
    options: {},
    verification: null,
    imageDataUrls: { hero: 'data:image/webp;base64,abc' },
    artDataUrl: 'data:image/webp;base64,abc',
    ...overrides,
  } as ResolvedThemeTarget;
}

function makeBundle(overrides: Partial<ThemeBundle> = {}): ThemeBundle {
  return {
    format: 'agentskin-theme',
    schemaVersion: 1,
    theme: { id: 'cyber-neon', displayName: 'Cyber Neon', version: '1.0.0' },
    targets: {},
    ...overrides,
  } as ThemeBundle;
}

function makeMockAdapter(coreId = 'doubao'): ApplicationAdapter {
  return {
    id: 'doubao',
    name: 'Doubao',
    type: 'desktop',
    tier: 'active',
    coreId,
    detect: vi.fn(),
    getPath: vi.fn(),
    applyTheme: vi.fn(),
    restoreTheme: vi.fn(),
    discover: vi.fn(),
    findTargets: vi.fn(),
    findRunningPids: vi.fn(),
    resolveDebugPorts: vi.fn(),
    defaultPort: vi.fn().mockReturnValue(0),
    displayName: vi.fn().mockReturnValue('Doubao'),
  } as unknown as ApplicationAdapter;
}

function makeMockEngineResult(overrides: Partial<InjectEngineResult> = {}): InjectEngineResult {
  return {
    layersInjected: 4,
    adapterApplied: true,
    heroInjected: true,
    imagesInjected: 1,
    verification: {
      accent: '#0ff',
      agentskinArt: 'url(blob:abc)',
      heroBlobActive: true,
      adoptedSheetCount: 4,
    },
    success: true,
    ...overrides,
  };
}

function makeMockLegacyResult(overrides: Partial<InjectThemeResult> = {}): InjectThemeResult {
  return {
    cssInjected: true,
    heroInjected: true,
    imagesInjected: 1,
    verification: {
      accent: '#0ff',
      agentskinArt: 'url(blob:abc)',
      heroBlobActive: true,
      adoptedSheetCount: 1,
    },
    success: true,
    ...overrides,
  };
}

function makeMockHealthReport(overrides: Partial<HealthCheckReport> = {}): HealthCheckReport {
  return {
    agentId: 'doubao',
    timestamp: Date.now(),
    heroArtActive: true,
    themeSheetPresent: true,
    accentToken: '#0ff',
    hostClassPresent: true,
    adapterPresent: true,
    nativeTokens: { '--semi-color-bg-0': '#1a1a2e' },
    overriddenVariables: [],
    opaqueLayers: [],
    blockingCount: 0,
    score: 95,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CdpFanoutDeps> = {}): CdpFanoutDeps {
  return {
    adapter: vi.fn().mockReturnValue(makeMockAdapter()),
    isEpochCurrent: vi.fn().mockReturnValue(true),
    tryEngineInjection: vi.fn().mockResolvedValue(makeMockEngineResult()),
    log: vi.fn(),
    ...overrides,
  };
}

// Reset all mocks between tests so call counts and return values don't leak.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(connectCdp).mockResolvedValue(makeMockSession());
  // Reload watchdog (hardeningPass arms it on every page target): give it a
  // benign event session so the async `void openWatchdogSession` settles
  // cleanly instead of surfacing an unhandled rejection.
  vi.mocked(connectEventCdp).mockResolvedValue(makeMockEventSession());
  vi.mocked(findDomTargets).mockResolvedValue([]);
  vi.mocked(injectThemeViaCdp).mockResolvedValue(makeMockLegacyResult());
  vi.mocked(removeEngineInjection).mockResolvedValue(undefined);
  vi.mocked(checkThemeHealth).mockResolvedValue(makeMockHealthReport());
  vi.mocked(buildSecondaryInjectExpression).mockReturnValue('(() => "inject")()');
  vi.mocked(buildSecondaryRemoveExpression).mockReturnValue('(() => "remove")()');
  vi.mocked(resolveThemeTargetFor).mockReturnValue(makeResolvedTarget());
});

// hardeningPass arms a reload watchdog on page targets; ensure it never leaks
// module-level state across tests.
afterEach(() => {
  disposeReloadWatchdogs();
});

// ===========================================================================
// hardeningPass
// ===========================================================================

describe('hardeningPass', () => {
  it('returns early when epoch is not current', async () => {
    const deps = makeDeps({
      isEpochCurrent: vi.fn().mockReturnValue(false),
    });
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);
    expect(findDomTargets).not.toHaveBeenCalled();
  });

  it('logs and returns when resolveThemeTargetFor throws', async () => {
    vi.mocked(resolveThemeTargetFor).mockImplementation(() => {
      throw new Error('resolve failed');
    });
    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);
    expect(findDomTargets).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('[hardening] doubao: resolveThemeTarget failed'),
    );
  });

  it('logs and returns when no DOM targets are found', async () => {
    vi.mocked(findDomTargets).mockResolvedValue([]);
    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('no DOM-bearing targets'));
    expect(connectCdp).not.toHaveBeenCalled();
  });

  it('uses engine injection when tryEngineInjection returns a result', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());
    const engineResult = makeMockEngineResult();
    const deps = makeDeps({
      tryEngineInjection: vi.fn().mockResolvedValue(engineResult),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // Engine layers target only `page` targets; the webview is handled by the
    // lightweight secondary CSS injection in the same loop (RFC 2026-08-18).
    expect(deps.tryEngineInjection).toHaveBeenCalledTimes(1);
    expect(injectThemeViaCdp).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('ENGINE [page]'));
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('applied to 1/2 targets (engine=1 legacy=0 secondary=1)'),
    );
  });

  it('falls back to legacy injection for page targets when engine returns null', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());
    vi.mocked(injectThemeViaCdp).mockResolvedValue(makeMockLegacyResult());

    const deps = makeDeps({
      tryEngineInjection: vi.fn().mockResolvedValue(null),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // Legacy injection only applies to page targets.
    expect(injectThemeViaCdp).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('LEGACY [page]'));
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('applied to 1/2 targets (engine=0 legacy=1 secondary=1)'),
    );
  });

  it('skips legacy injection for non-page targets when engine returns null', async () => {
    const targets = [makeCdpTarget({ id: 'wv-1', type: 'webview' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());

    const deps = makeDeps({
      tryEngineInjection: vi.fn().mockResolvedValue(null),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(injectThemeViaCdp).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('applied to 0/1 targets'));
  });

  it('injects lightweight CSS into non-page targets via the unified loop', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview', title: 'McpView' }),
      makeCdpTarget({ id: 'if-1', type: 'iframe', title: 'ArdoFrame' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const session = makeMockSession({
      evaluate: vi.fn().mockResolvedValue('{"installed":true}'),
    });
    vi.mocked(connectCdp).mockResolvedValue(session);

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // Each non-page target gets exactly one lightweight CSS write.
    expect(session.evaluate).toHaveBeenCalledTimes(2);
    expect(buildSecondaryInjectExpression).toHaveBeenCalledTimes(2);
    expect(injectThemeViaCdp).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('applied to 0/2 targets (engine=0 legacy=0 secondary=2)'),
    );
  });

  it('reports per-target progress and a summary for non-page targets', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview', title: 'McpView' }),
      makeCdpTarget({ id: 'wv-2', type: 'webview', title: 'OtherView' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());

    const events: unknown[] = [];
    const deps = makeDeps({
      onSecondaryProgress: vi.fn((event) => {
        events.push(event);
      }),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // one progress event per target + one summary event.
    const progressEvents = events.filter((e) => (e as { targetId?: string }).targetId);
    expect(progressEvents).toHaveLength(2);
    expect((progressEvents[0] as { targetId: string }).targetId).toBe('wv-1');
    expect((progressEvents[1] as { targetId: string }).targetId).toBe('wv-2');
    const summary = events.at(-1) as { injected: number; failed: number; total: number };
    expect(summary.injected).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.total).toBe(2);
  });

  it('counts non-page failures and marks the failing progress event', async () => {
    const targets = [makeCdpTarget({ id: 'wv-1', type: 'webview', title: 'Bad WebView' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const session = makeMockSession({
      evaluate: vi.fn().mockResolvedValue('{"installed":false,"reason":"no-root"}'),
    });
    vi.mocked(connectCdp).mockResolvedValue(session);

    const events: unknown[] = [];
    const deps = makeDeps({
      onSecondaryProgress: vi.fn((event) => {
        events.push(event);
      }),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(events).toHaveLength(2);
    expect((events[0] as { success: boolean }).success).toBe(false);
    expect((events[0] as { error?: string }).error).toContain('unexpected result');
    const summary = events.at(-1) as { injected: number; failed: number };
    expect(summary.injected).toBe(0);
    expect(summary.failed).toBe(1);
    // Non-page evaluate failures bump the summary failed count but not the
    // top-level `failed` counter, so the log line shows engine=0 legacy=0.
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('applied to 0/1 targets (engine=0 legacy=0)'),
    );
  });

  it('does not emit secondary progress when there are only page targets', async () => {
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());

    const deps = makeDeps({
      onSecondaryProgress: vi.fn(),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.onSecondaryProgress).not.toHaveBeenCalled();
  });

  it('watchdog skips a page target when engine sheets are already present (P3)', async () => {
    // The page session's evaluate answers a verification that reports the
    // engine's owned adoptedStyleSheets as present → watchdog skips injection.
    const presentEval = vi.fn().mockResolvedValue(
      JSON.stringify({
        accent: '#f00',
        agentskinArt: '',
        heroBlobActive: false,
        adoptedSheetCount: 3,
      }),
    );
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession({ evaluate: presentEval }));

    const deps = makeDeps({
      tryEngineInjection: vi.fn().mockResolvedValue(makeMockEngineResult()),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // page-1 skipped (sheets already applied) → no engine write.
    expect(deps.tryEngineInjection).not.toHaveBeenCalled();
    expect(injectThemeViaCdp).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('WATCHDOG skip page'));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('watchdog-skip=1'));

    // RFC 2026-08-18 P3: hardeningPass must also arm the cross-navigation reload
    // watchdog on the primary page target (regardless of skip/inject).
    expect(connectEventCdp).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/page/1');
    expect(getReloadWatchdogKeys()).toContain('doubao');
  });

  it('watchdog injects a page target when engine sheets are absent (P3)', async () => {
    // A verification that reports adoptedSheetCount === 0 (or missing) means
    // the engine sheets were not applied → the watchdog must re-inject.
    const absentEval = vi.fn().mockResolvedValue(
      JSON.stringify({
        accent: '',
        agentskinArt: '',
        heroBlobActive: false,
        adoptedSheetCount: 0,
      }),
    );
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession({ evaluate: absentEval }));

    const deps = makeDeps({
      tryEngineInjection: vi.fn().mockResolvedValue(makeMockEngineResult()),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.tryEngineInjection).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('ENGINE [page]'));
    expect(deps.log).not.toHaveBeenCalledWith(expect.stringContaining('WATCHDOG skip'));
  });

  it('counts failures when connectCdp throws', async () => {
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockRejectedValue(new Error('connect failed'));

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('connect failed'));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('failed=1'));
  });

  it('counts failures when tryEngineInjection throws', async () => {
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());

    const deps = makeDeps({
      tryEngineInjection: vi.fn().mockRejectedValue(new Error('engine crash')),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('injection failed: engine crash'),
    );
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('failed=1'));
  });

  it('aborts mid-loop when epoch changes between targets', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'wv-2', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());

    let callCount = 0;
    const deps = makeDeps({
      isEpochCurrent: vi.fn(() => {
        callCount++;
        // Call 1 = pre-loop (true), call 2 = first iteration (true),
        // call 3 = second iteration (false) → abort.
        return callCount <= 2;
      }),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('epoch changed, aborting after 1/3'),
    );
    // Only one target processed.
    expect(deps.tryEngineInjection).toHaveBeenCalledTimes(1);
  });

  it('runs health check on the first page session after injection', async () => {
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const session = makeMockSession();
    vi.mocked(connectCdp).mockResolvedValue(session);
    const healthReport = makeMockHealthReport({ score: 88, blockingCount: 2 });
    vi.mocked(checkThemeHealth).mockResolvedValue(healthReport);

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(checkThemeHealth).toHaveBeenCalledWith(session, 'doubao');
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('health score=88/100'));
    expect(session.close).toHaveBeenCalled();
  });

  it('logs top blockers when blockingCount > 0 and score < 50', async () => {
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());
    vi.mocked(checkThemeHealth).mockResolvedValue(
      makeMockHealthReport({
        score: 40,
        blockingCount: 3,
        opaqueLayers: [
          {
            depth: 1,
            tagName: 'DIV',
            id: 'main-bg',
            classes: 'app-shell bg-solid',
            semanticAttr: '',
            backgroundColor: 'rgb(30, 30, 30)',
            backgroundImage: '',
            size: '1200x800',
            visible: true,
            backdropFilter: '',
          },
        ],
      }),
    );

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('top blockers:'));
  });

  it('skips health check when no page target is present', async () => {
    const targets = [makeCdpTarget({ id: 'wv-1', type: 'webview' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(checkThemeHealth).not.toHaveBeenCalled();
  });

  it('closes all sessions except the first page session during loop, then closes it after health check', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);

    const pageSession = makeMockSession();
    const wvSession = makeMockSession();
    let connectCount = 0;
    vi.mocked(connectCdp).mockImplementation(() => {
      connectCount++;
      return Promise.resolve(connectCount === 1 ? pageSession : wvSession);
    });

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // Webview session closed during the loop (in finally block).
    expect(wvSession.close).toHaveBeenCalled();
    // Page session kept for health check, then closed after.
    expect(pageSession.close).toHaveBeenCalled();
    expect(checkThemeHealth).toHaveBeenCalledWith(pageSession, 'doubao');
  });

  it('re-appends wallpaper punch-through sheet after health check', async () => {
    const targets = [makeCdpTarget({ id: 'page-1', type: 'page' })];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const session = makeMockSession({
      evaluate: vi.fn().mockResolvedValue('wp-reappended'),
    });
    vi.mocked(connectCdp).mockResolvedValue(session);

    const deps = makeDeps();
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // The last evaluate call should be the wallpaper re-append expression.
    const lastCall = vi.mocked(session.evaluate).mock.calls.at(-1);
    expect(lastCall?.[0]).toContain('__agentskinWpPunch');
  });

  // ---------------------------------------------------------------------------
  // RFC A2 P2 — primary renderer unification on rendererHints
  // ---------------------------------------------------------------------------

  /**
   * Helper: build a mock adapter that declares `rendererHints`. Without this
   * the factory's `as unknown as ApplicationAdapter` leaves the accessor
   * undefined → hardeningPass falls back to list order.
   */
  function makeHintedAdapter(hints: RendererHints): ApplicationAdapter {
    const adapter = makeMockAdapter();
    (adapter as unknown as { rendererHints: () => RendererHints }).rendererHints = () => hints;
    return adapter;
  }

  it('hoists the rendererHints-preferred page to the front and runs health on it (P2)', async () => {
    // List order is adversarial: the NON-preferred page comes first, so historic
    // first-page logic would pick the wrong window. rendererHints must override.
    const mainWs = 'ws://127.0.0.1:9222/devtools/page/main';
    const secWs = 'ws://127.0.0.1:9222/devtools/page/secondary';
    const targets = [
      makeCdpTarget({
        id: 'page-secondary',
        type: 'page',
        url: 'http://localhost/side.html',
        webSocketDebuggerUrl: secWs,
      }),
      makeCdpTarget({
        id: 'page-main',
        type: 'page',
        url: 'http://localhost/app/index.html',
        webSocketDebuggerUrl: mainWs,
      }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);

    const mainSession = makeMockSession();
    const secSession = makeMockSession();
    vi.mocked(connectCdp).mockImplementation((url) =>
      Promise.resolve(url === mainWs ? mainSession : secSession),
    );

    const deps = makeDeps({
      adapter: vi
        .fn()
        .mockReturnValue(makeHintedAdapter({ preferredUrlPatterns: ['app/index\\.html$'] })),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // The preferred page is hoisted → it becomes `firstSession` → health runs
    // on the semantic-anchor window, not whatever /json/list returned first.
    expect(checkThemeHealth).toHaveBeenCalledWith(mainSession, 'doubao');
    // The reload watchdog arms on the primary (preferred) page's ws url.
    expect(connectEventCdp).toHaveBeenCalledWith(mainWs);
  });

  it('falls back to the first page target when no rendererHints are declared (P2)', async () => {
    const mainWs = 'ws://127.0.0.1:9222/devtools/page/main';
    const secWs = 'ws://127.0.0.1:9222/devtools/page/secondary';
    const targets = [
      makeCdpTarget({
        id: 'page-first',
        type: 'page',
        url: 'http://localhost/a.html',
        webSocketDebuggerUrl: mainWs,
      }),
      makeCdpTarget({
        id: 'page-second',
        type: 'page',
        url: 'http://localhost/b.html',
        webSocketDebuggerUrl: secWs,
      }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const firstSession = makeMockSession();
    const secondSession = makeMockSession();
    vi.mocked(connectCdp).mockImplementation((url) =>
      Promise.resolve(url === mainWs ? firstSession : secondSession),
    );
    // makeMockAdapter has no rendererHints → accessor is undefined.
    const deps = makeDeps();

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    expect(checkThemeHealth).toHaveBeenCalledWith(firstSession, 'doubao');
    expect(connectEventCdp).toHaveBeenCalledWith(mainWs);
  });

  it('does not choose a secondaryPatterns page as primary even when listed first (P2)', async () => {
    const bootWs = 'ws://127.0.0.1:9222/devtools/page/boot';
    const mainWs = 'ws://127.0.0.1:9222/devtools/page/main';
    const targets = [
      makeCdpTarget({
        id: 'page-boot',
        type: 'page',
        url: 'http://localhost/boot.html',
        webSocketDebuggerUrl: bootWs,
      }),
      makeCdpTarget({
        id: 'page-main',
        type: 'page',
        url: 'http://localhost/app/index.html',
        webSocketDebuggerUrl: mainWs,
      }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const bootSession = makeMockSession();
    const mainSession = makeMockSession();
    vi.mocked(connectCdp).mockImplementation((url) =>
      Promise.resolve(url === bootWs ? bootSession : mainSession),
    );

    const deps = makeDeps({
      adapter: vi.fn().mockReturnValue(makeHintedAdapter({ secondaryPatterns: ['boot\\.html$'] })),
    });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // boot page excluded from the primary decision → main becomes primary.
    expect(checkThemeHealth).toHaveBeenCalledWith(mainSession, 'doubao');
    expect(connectEventCdp).toHaveBeenCalledWith(mainWs);
  });
});

// ===========================================================================
// Pooled sessions (RFC §4.1) — reuse across sub-tasks, owned by the pool
// ===========================================================================

describe('pooled session reuse', () => {
  it('reuses a webview session across repeat hardening passes without closing it', async () => {
    const wvTarget = makeCdpTarget({ id: 'wv-1', type: 'webview' });
    vi.mocked(findDomTargets).mockResolvedValue([wvTarget]);

    const wvSession = makeMockSession();
    let connectCount = 0;
    vi.mocked(connectCdp).mockImplementation(() => {
      connectCount++;
      return Promise.resolve(wvSession);
    });

    const pool = new CdpSessionPool();
    const deps = makeDeps({ sessions: pool });

    // Both passes touch the SAME webview (same target key) — the pool collapses
    // the two connects into one underlying session, which the loop reuses.
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);
    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);

    // Only one underlying connect for the one target — pool collapsed the dupes.
    expect(connectCount).toBe(1);
    // The fan-out never closes a pooled session.
    expect(wvSession.close).not.toHaveBeenCalled();
    // The session lives in the pool until epoch invalidation.
    expect(pool.poolSize('doubao')).toBe(1);
  });

  it('releases pooled session refCount after hardeningPass (refCount returns to 0)', async () => {
    const wvTarget = makeCdpTarget({ id: 'wv-1', type: 'webview' });
    vi.mocked(findDomTargets).mockResolvedValue([wvTarget]);

    const session = makeMockSession();
    vi.mocked(connectCdp).mockResolvedValue(session);

    const pool = new CdpSessionPool();
    const deps = makeDeps({ sessions: pool });

    await hardeningPass('doubao', 9222, makeBundle(), 1, deps);
    expect(session.close).not.toHaveBeenCalled();
    // After hardeningPass completes, refCount should be 0 (released in finally)
    expect(pool.poolSize('doubao')).toBe(1);
    expect(session.close).not.toHaveBeenCalled();

    // Acquire again should reuse the session
    const s2 = await pool.acquire('doubao', 'wv-1', () => Promise.resolve(session));
    expect(s2).toBe(session); // Same session reused
  });
});

// ===========================================================================
// hardeningRemove
// ===========================================================================

describe('hardeningRemove', () => {
  it('returns early when epoch is not current', async () => {
    const deps = makeDeps({
      isEpochCurrent: vi.fn().mockReturnValue(false),
    });
    await hardeningRemove('doubao', 9222, 1, deps);
    expect(findDomTargets).not.toHaveBeenCalled();
  });

  it('returns early when no DOM targets are found', async () => {
    vi.mocked(findDomTargets).mockResolvedValue([]);
    const deps = makeDeps();
    await hardeningRemove('doubao', 9222, 1, deps);
    expect(connectCdp).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('removes engine from all targets successfully', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'if-1', type: 'iframe' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    const session = makeMockSession();
    vi.mocked(connectCdp).mockResolvedValue(session);

    const deps = makeDeps();
    await hardeningRemove('doubao', 9222, 1, deps);

    // Page target → removeEngineInjection; non-page targets → lightweight
    // CSS strip (their single-channel counterpart to hardeningPass).
    expect(removeEngineInjection).toHaveBeenCalledTimes(1);
    expect(buildSecondaryRemoveExpression).toHaveBeenCalledTimes(2);
    expect(session.evaluate).toHaveBeenCalledTimes(2);
    // RFC 2026-08-18 P2: removeEngineInjection no longer takes an appId.
    // Sanity-check each call targets exactly one session argument.
    for (const call of vi.mocked(removeEngineInjection).mock.calls) {
      expect(call.length).toBe(1);
    }
    expect(session.close).toHaveBeenCalledTimes(3);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('removed engine from 3/3'));
  });

  it('aborts mid-loop when epoch changes between targets', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);

    let callCount = 0;
    const deps = makeDeps({
      isEpochCurrent: vi.fn(() => {
        callCount++;
        return callCount <= 2;
      }),
    });

    await hardeningRemove('doubao', 9222, 1, deps);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('epoch changed, aborting after 1/2'),
    );
    expect(connectCdp).toHaveBeenCalledTimes(1);
  });

  it('continues on individual target failures (best-effort)', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);

    let callCount = 0;
    vi.mocked(connectCdp).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('connect failed'));
      return Promise.resolve(makeMockSession());
    });

    const deps = makeDeps();
    await hardeningRemove('doubao', 9222, 1, deps);

    // page-1 connect fails (never reaches engine removal); wv-1 is still
    // stripped via the lightweight CSS channel.
    expect(connectCdp).toHaveBeenCalledTimes(2);
    expect(removeEngineInjection).not.toHaveBeenCalled();
    expect(buildSecondaryRemoveExpression).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('removed engine from 1/2'));
  });

  it('continues when removeEngineInjection throws (best-effort)', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());
    vi.mocked(removeEngineInjection).mockRejectedValueOnce(new Error('remove failed'));

    const deps = makeDeps();
    await hardeningRemove('doubao', 9222, 1, deps);

    expect(removeEngineInjection).toHaveBeenCalledTimes(1);
    // page-1 failed (not counted in removed), wv-1 succeeded via CSS strip.
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('removed engine from 1/2'));
  });
});

// ===========================================================================
// connectWithRetry (B4 — CDP-2)
// ===========================================================================

describe('connectWithRetry', () => {
  it('returns the session when the first connect succeeds', async () => {
    const session = makeMockSession();
    vi.mocked(connectCdp).mockResolvedValue(session);
    const result = await connectWithRetry('ws://x', 4000);
    expect(result).toBe(session);
    expect(connectCdp).toHaveBeenCalledTimes(1);
  });

  it('retries on connect failure then succeeds', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(connectCdp)
        .mockRejectedValueOnce(new Error('CDP connection failed'))
        .mockResolvedValueOnce(makeMockSession());
      const promise = connectWithRetry('ws://x', 4000, 3, [100, 100]);
      // First attempt rejects → 100ms backoff → second attempt resolves.
      await vi.advanceTimersByTimeAsync(100);
      const session = await promise;
      expect(session).toBeTruthy();
      expect(connectCdp).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null after all attempts fail', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(connectCdp).mockRejectedValue(new Error('CDP connection failed'));
      const promise = connectWithRetry('ws://x', 4000, 3, [100, 100]);
      await vi.advanceTimersByTimeAsync(200); // both backoffs elapse
      const result = await promise;
      expect(result).toBeNull();
      expect(connectCdp).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hardeningPass retries a connect that fails once (CDP-2)', async () => {
    vi.useFakeTimers();
    try {
      const session = makeMockSession();
      vi.mocked(findDomTargets).mockResolvedValue([makeCdpTarget({ type: 'webview' })]);
      vi.mocked(connectCdp)
        .mockRejectedValueOnce(new Error('CDP connection failed'))
        .mockResolvedValueOnce(session);
      const deps = makeDeps();
      const promise = hardeningPass('doubao', 9222, makeBundle(), 1, deps);
      await vi.advanceTimersByTimeAsync(500); // first backoff
      await promise;
      // 1 initial + 1 retry — the connect failure is absorbed by the retry.
      expect(connectCdp).toHaveBeenCalledTimes(2);
      expect(session.evaluate).toHaveBeenCalled();
      expect(deps.log).not.toHaveBeenCalledWith(
        expect.stringContaining('connect failed after retries'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('hardeningPass counts a target as failed when connect never succeeds', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(findDomTargets).mockResolvedValue([makeCdpTarget({ type: 'page' })]);
      vi.mocked(connectCdp).mockRejectedValue(new Error('CDP connection failed'));
      const deps = makeDeps({
        tryEngineInjection: vi.fn().mockResolvedValue(null),
      });
      const promise = hardeningPass('doubao', 9222, makeBundle(), 1, deps);
      await vi.advanceTimersByTimeAsync(2000); // both retry backoffs elapse
      await promise;
      expect(connectCdp).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      expect(deps.log).toHaveBeenCalledWith(
        expect.stringContaining('connect failed after retries'),
      );
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('applied to 0/1 targets'));
    } finally {
      vi.useRealTimers();
    }
  });
});
