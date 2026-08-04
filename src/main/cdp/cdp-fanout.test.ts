// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationAdapter } from '../../adapters/base';
import type {
  CdpTarget,
  ResolvedThemeTarget,
  ThemeBundle,
} from '../../legacy/agentskin-core-runtime';
import type { HealthCheckReport } from '../theme-health-check';
import type { CdpSession } from './cdp-client';
import type { CdpFanoutDeps } from './cdp-fanout';
import type { InjectEngineResult, InjectThemeResult } from './cdp-inject';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('./cdp-client', () => ({
  connectCdp: vi.fn(),
}));

vi.mock('./cdp-targets', () => ({
  findDomTargets: vi.fn(),
  findSecondaryTargets: vi.fn(),
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
const { connectCdp } = await import('./cdp-client');
const { findDomTargets, findSecondaryTargets } = await import('./cdp-targets');
const { injectThemeViaCdp, removeEngineInjection } = await import('./cdp-inject');
const { checkThemeHealth } = await import('../theme-health-check');
const { buildSecondaryInjectExpression, buildSecondaryRemoveExpression } = await import(
  './secondary-inject'
);
const { resolveThemeTargetFor } = await import('../../legacy/agentskin-core-runtime');
const {
  injectSecondaryTargets,
  removeSecondaryTargets,
  hardeningPass,
  hardeningRemove,
  connectWithRetry,
} = await import('./cdp-fanout');

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
  vi.mocked(findDomTargets).mockResolvedValue([]);
  vi.mocked(findSecondaryTargets).mockResolvedValue([]);
  vi.mocked(injectThemeViaCdp).mockResolvedValue(makeMockLegacyResult());
  vi.mocked(removeEngineInjection).mockResolvedValue(undefined);
  vi.mocked(checkThemeHealth).mockResolvedValue(makeMockHealthReport());
  vi.mocked(buildSecondaryInjectExpression).mockReturnValue('(() => "inject")()');
  vi.mocked(buildSecondaryRemoveExpression).mockReturnValue('(() => "remove")()');
  vi.mocked(resolveThemeTargetFor).mockReturnValue(makeResolvedTarget());
});

// ===========================================================================
// injectSecondaryTargets
// ===========================================================================

describe('injectSecondaryTargets', () => {
  it('returns early when epoch is not current', async () => {
    const deps = makeDeps({
      isEpochCurrent: vi.fn().mockReturnValue(false),
    });
    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);
    expect(findSecondaryTargets).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('logs and returns when resolveThemeTargetFor throws', async () => {
    vi.mocked(resolveThemeTargetFor).mockImplementation(() => {
      throw new Error('no target for coreId');
    });
    const deps = makeDeps();
    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);
    expect(findSecondaryTargets).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('[secondary] doubao: resolveThemeTarget failed'),
    );
  });

  it('logs and returns when no secondary targets are found', async () => {
    vi.mocked(findSecondaryTargets).mockResolvedValue([]);
    const deps = makeDeps();
    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('no secondary targets'));
    expect(connectCdp).not.toHaveBeenCalled();
  });

  it('injects CSS into all secondary targets successfully', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'if-1', type: 'iframe' }),
    ];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);
    const session = makeMockSession({
      evaluate: vi.fn().mockResolvedValue('{"installed":true}'),
    });
    vi.mocked(connectCdp).mockResolvedValue(session);

    const deps = makeDeps();
    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);

    expect(connectCdp).toHaveBeenCalledTimes(2);
    expect(session.evaluate).toHaveBeenCalledTimes(2);
    expect(session.close).toHaveBeenCalledTimes(2);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('injected CSS into 2/2'));
  });

  it('counts failures when evaluate returns non-installed result', async () => {
    const targets = [makeCdpTarget({ id: 'wv-1', type: 'webview', title: 'Bad WebView' })];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);
    const session = makeMockSession({
      evaluate: vi.fn().mockResolvedValue('{"installed":false,"reason":"no-root"}'),
    });
    vi.mocked(connectCdp).mockResolvedValue(session);

    const deps = makeDeps();
    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('injected CSS into 0/1'));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('1 failed'));
  });

  it('counts failures when connectCdp throws', async () => {
    const targets = [makeCdpTarget({ id: 'wv-1', type: 'webview' })];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockRejectedValue(new Error('CDP connect timeout'));

    const deps = makeDeps();
    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('connect failed'));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('0/1'));
  });

  it('aborts mid-loop when epoch changes between targets', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'wv-2', type: 'webview' }),
      makeCdpTarget({ id: 'wv-3', type: 'webview' }),
    ];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);

    // Epoch is current on first check (before loop), flips to false on second
    // check (inside loop, before processing wv-2).
    let callCount = 0;
    const deps = makeDeps({
      isEpochCurrent: vi.fn(() => {
        callCount++;
        // Call 1 = pre-loop guard (true), call 2 = first iteration guard (true),
        // call 3 = second iteration guard (false) → abort.
        return callCount <= 2;
      }),
    });

    await injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('epoch changed, aborting after 1/3'),
    );
    // Only one target processed before abort.
    expect(connectCdp).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// removeSecondaryTargets
// ===========================================================================

describe('removeSecondaryTargets', () => {
  it('returns early when epoch is not current', async () => {
    const deps = makeDeps({
      isEpochCurrent: vi.fn().mockReturnValue(false),
    });
    await removeSecondaryTargets('doubao', 9222, 1, deps);
    expect(findSecondaryTargets).not.toHaveBeenCalled();
  });

  it('returns early when no secondary targets are found', async () => {
    vi.mocked(findSecondaryTargets).mockResolvedValue([]);
    const deps = makeDeps();
    await removeSecondaryTargets('doubao', 9222, 1, deps);
    expect(connectCdp).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  it('removes CSS from all secondary targets successfully', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'if-1', type: 'iframe' }),
    ];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);
    const session = makeMockSession();
    vi.mocked(connectCdp).mockResolvedValue(session);

    const deps = makeDeps();
    await removeSecondaryTargets('doubao', 9222, 1, deps);

    expect(connectCdp).toHaveBeenCalledTimes(2);
    expect(session.evaluate).toHaveBeenCalledTimes(2);
    expect(session.close).toHaveBeenCalledTimes(2);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('removed CSS from 2/2'));
  });

  it('aborts mid-loop when epoch changes between targets', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'wv-2', type: 'webview' }),
    ];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);

    let callCount = 0;
    const deps = makeDeps({
      isEpochCurrent: vi.fn(() => {
        callCount++;
        return callCount <= 2;
      }),
    });

    await removeSecondaryTargets('doubao', 9222, 1, deps);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('epoch changed, aborting remove after 1/2'),
    );
    expect(connectCdp).toHaveBeenCalledTimes(1);
  });

  it('continues on individual target failures (best-effort)', async () => {
    const targets = [
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
      makeCdpTarget({ id: 'wv-2', type: 'webview' }),
    ];
    vi.mocked(findSecondaryTargets).mockResolvedValue(targets);

    let callCount = 0;
    vi.mocked(connectCdp).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('connect failed'));
      return Promise.resolve(makeMockSession());
    });

    const deps = makeDeps();
    await removeSecondaryTargets('doubao', 9222, 1, deps);

    // Second target still processed despite first failure.
    expect(connectCdp).toHaveBeenCalledTimes(2);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('removed CSS from 1/2'));
  });
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

    expect(deps.tryEngineInjection).toHaveBeenCalledTimes(2);
    expect(injectThemeViaCdp).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('ENGINE [page]'));
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining('applied to 2/2 targets (engine=2 legacy=0)'),
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
      expect.stringContaining('applied to 1/2 targets (engine=0 legacy=1)'),
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

    expect(connectCdp).toHaveBeenCalledTimes(3);
    expect(removeEngineInjection).toHaveBeenCalledTimes(3);
    // Each call should pass the appId.
    for (const call of vi.mocked(removeEngineInjection).mock.calls) {
      expect(call[1]).toBe('doubao');
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

    // Second target still processed.
    expect(connectCdp).toHaveBeenCalledTimes(2);
    expect(removeEngineInjection).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('removed engine from 1/2'));
  });

  it('continues when removeEngineInjection throws (best-effort)', async () => {
    const targets = [
      makeCdpTarget({ id: 'page-1', type: 'page' }),
      makeCdpTarget({ id: 'wv-1', type: 'webview' }),
    ];
    vi.mocked(findDomTargets).mockResolvedValue(targets);
    vi.mocked(connectCdp).mockResolvedValue(makeMockSession());
    vi.mocked(removeEngineInjection)
      .mockRejectedValueOnce(new Error('remove failed'))
      .mockResolvedValueOnce(undefined);

    const deps = makeDeps();
    await hardeningRemove('doubao', 9222, 1, deps);

    expect(removeEngineInjection).toHaveBeenCalledTimes(2);
    // First target failed (not counted in removed), second succeeded.
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

  it('injectSecondaryTargets retries a connect that fails once (CDP-2)', async () => {
    vi.useFakeTimers();
    try {
      const session = makeMockSession();
      vi.mocked(findSecondaryTargets).mockResolvedValue([makeCdpTarget({ type: 'webview' })]);
      vi.mocked(connectCdp)
        .mockRejectedValueOnce(new Error('CDP connection failed'))
        .mockResolvedValueOnce(session);
      const deps = makeDeps();
      const promise = injectSecondaryTargets('doubao', 9222, makeBundle(), 1, deps);
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
