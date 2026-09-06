// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR Joint Analysis Tests
 *
 * Tests for the three-phase joint analysis pipeline:
 *   - Phase 1 (ASAR-only): Static scan result → static health score
 *   - Phase 2 (CDP-optional): Landmark preflight + anchor probe → dynamic score
 *   - Phase 3 (Joint): Combined health score + inject-readiness assessment
 *
 * Key scenarios:
 *   - Agent unreachable → graceful degradation to static-only, with the exact
 *     broken link reported (port / target / connect)
 *   - Agent reachable + all landmarks pass → full joint score
 *   - Agent reachable + landmark fail → reduced dynamic score
 *   - Cached scan result → skip ASAR re-scan
 *   - contextIsolation=false → inject blocked
 *   - CDP error → fallback to static-only with noCdpReason
 *   - Multi-page surfaces uncovered → named warning
 *
 * The CDP side is injected as a {@link JointCdpBridge} stub, so no test opens a
 * socket. The real plumbing lives in `asar-cdp-bridge.ts`.
 */

import type { SelectorValidationReport } from '@shared/types/selector-probe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import type { CdpSession } from '../../main/cdp/cdp-client';
import type { PreflightResult } from '../../main/cdp/preflight';
import type { ArchitectureProfile } from '../../shared/asar-architecture';
import type { ScanResult } from './asar-ipc';

// ---------------------------------------------------------------------------
// Mocks (must be declared before module import)
// ---------------------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => createElectronMock(handlers));

vi.mock('../../main/cdp/preflight', () => ({
  runLandmarkPreflight: vi.fn(),
  getDefaultLandmarks: vi.fn(() => [
    { name: 'chat-surface', selectors: ['.chat'], required: true },
  ]),
}));

vi.mock('../../main/cdp/selector-utils', () => ({
  validateSelectors: vi.fn(),
}));

vi.mock('./asar-ipc', () => ({
  scanExtractedAsar: vi.fn(),
}));

const { registerJointAnalysisIpc, runJointAnalysis, acquireJointSession } = await import(
  './asar-joint-analysis'
);
const { scanExtractedAsar } = await import('./asar-ipc');
const { runLandmarkPreflight } = await import('../../main/cdp/preflight');
const { validateSelectors } = await import('../../main/cdp/selector-utils');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScanResult(
  overrides: Partial<{
    highStabilityCount: number;
    namespaceCount: number;
    contextIsolation: boolean | null;
    sandbox: boolean;
    architecture?: ArchitectureProfile;
  }> = {},
): ScanResult {
  const {
    highStabilityCount = 20,
    namespaceCount = 3,
    contextIsolation = true,
    sandbox = false,
    architecture,
  } = overrides;

  const fragilitySeeds = Array.from({ length: highStabilityCount }, (_, i) => ({
    anchor: `testid-${i}`,
    kind: 'data-testid',
    stability: 'high',
  }));

  const namespaces: Record<
    string,
    { varCount: number; vars: Array<{ value: string; count: number }> }
  > = {};
  for (let i = 0; i < namespaceCount; i++) {
    namespaces[`ns${i}`] = { varCount: 5, vars: [{ value: `var-${i}`, count: 1 }] };
  }

  return {
    topology: { entries: [], preloadScripts: [], chunks: [] },
    strings: { dataAttrs: [], dataTestids: [], ids: [], ipcTypes: [], i18nKeys: [] },
    tokens: { namespaces, varCount: namespaceCount * 5, cssBytes: 1024, sheets: 2 },
    fragilitySeeds,
    security: {
      contextIsolation,
      webSecurity: true,
      sandbox,
      csp: { from: 'none', directives: {} },
    },
    surfaces: {
      preloadExposed: [],
      ipc: { handle: [], invoke: [], send: [], on: [] },
    },
    architecture,
  };
}

/** A QoderWork-style multi-page profile: three entries in their own windows. */
function makeMultiPageArchitecture(): ArchitectureProfile {
  return {
    agentId: 'qoderwork',
    family: 'react-renderer',
    scanFamily: 'react',
    entryPoints: [
      {
        file: 'out/renderer/index.html',
        role: 'main',
        scripts: ['assets/index.js'],
        styles: [],
        moduleType: 'module',
        csp: 'medium',
        bytes: 100,
      },
      {
        file: 'out/renderer/voice-overlay.html',
        role: 'voice-overlay',
        scripts: [],
        styles: [],
        moduleType: 'module',
        csp: 'medium',
        bytes: 50,
      },
      {
        file: 'out/renderer/quickpick.html',
        role: 'quickpick',
        scripts: [],
        styles: [],
        moduleType: 'module',
        csp: 'medium',
        bytes: 50,
      },
    ],
    primaryEntry: 'out/renderer/index.html',
    dependencies: [],
    csp: 'medium',
    surfaces: [
      { role: 'main', entry: 'out/renderer/index.html', requiresSeparateTarget: false },
      {
        role: 'voice-overlay',
        entry: 'out/renderer/voice-overlay.html',
        requiresSeparateTarget: true,
      },
      { role: 'quickpick', entry: 'out/renderer/quickpick.html', requiresSeparateTarget: true },
    ],
    inject: { mechanism: 'adoptedStyleSheets', reasons: ['CSP 为白名单来源'] },
    tokenNamespaces: ['qoder'],
    stats: { html: 3, js: 1, css: 0, bytes: 200 },
  };
}

/** A CDP session stub — typed so the deps helper satisfies the real contract. */
function makeMockSession(): CdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockResolvedValue({ result: { value: '{}' } }),
    close: vi.fn(),
  } as unknown as CdpSession;
}

interface BridgeOptions {
  port?: number | null;
  targets?: Array<Record<string, unknown>>;
  session?: CdpSession | null;
}

/** Build a stub CDP bridge — no sockets, fully under test control. */
function makeBridge(options: BridgeOptions = {}) {
  const { port = 9224, targets, session = makeMockSession() } = options;
  const defaultTargets = [
    {
      id: 'target-1',
      type: 'page',
      title: 'QoderWork',
      url: 'file:///out/renderer/index.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9224/devtools/page/target-1',
    },
  ];
  return {
    resolvePort: vi.fn().mockResolvedValue(port),
    listTargets: vi.fn().mockResolvedValue(targets ?? defaultTargets),
    connect: vi.fn().mockResolvedValue(session),
  };
}

/** Wrap a bridge + optional session into the deps `runJointAnalysis` expects. */
function makeDeps(session: CdpSession | null, targets: Array<Record<string, unknown>> = []) {
  let released = false;
  const release = vi.fn(() => {
    released = true;
  });
  return {
    release,
    wasReleased: () => released,
    deps: {
      acquire: vi.fn(async () => {
        if (!session) return { ok: false as const, reason: 'no-live-cdp-port' };
        return {
          ok: true as const,
          session,
          release,
          port: 9224,
          target: { id: 'target-1', title: 'Agent', url: 'file:///index.html' },
          targets,
        };
      }),
    },
  };
}

function makePreflightResult(passed: boolean): PreflightResult {
  return {
    passed,
    hits: passed ? [{ name: 'chat-surface', matchedSelector: '.chat', count: 1 }] : [],
    misses: passed ? [] : [{ name: 'chat-surface', selectors: ['.chat'] }],
    warnings: [],
  };
}

function makeValidationReport(total: number, hit: number): SelectorValidationReport {
  const miss = total - hit;
  return {
    agentId: 'codex',
    results: Array.from({ length: total }, (_, i) => ({
      selector: `[data-testid="testid-${i}"]`,
      kind: i < hit ? 'hit' : 'miss',
      count: i < hit ? 1 : 0,
    })),
    summary: { total, hit, miss, invalid: 0, timeout: 0 },
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests — IPC Registration
// ---------------------------------------------------------------------------

describe('registerJointAnalysisIpc', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('registers ASAR_JOINT_ANALYSIS handler', () => {
    registerJointAnalysisIpc(() => undefined);
    expect(handlers.has('asar:joint-analysis')).toBe(true);
  });

  it('passes agentId and extractDir to runJointAnalysis via IPC', async () => {
    const cachedScan = makeScanResult();
    vi.mocked(scanExtractedAsar).mockReturnValue(cachedScan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    // With a bridge the CDP phase actually runs, so the total exceeds the
    // static-only ceiling.
    registerJointAnalysisIpc(() => undefined, makeBridge() as never);

    const handler = handlers.get('asar:joint-analysis')!;
    const result = await handler(
      {},
      {
        agentId: 'codex',
        extractDir: '/tmp/test-extract',
        cachedScanResult: cachedScan,
      },
    );

    const jointResult = result as { health: { total: number }; scanResult: typeof cachedScan };
    expect(jointResult.health.total).toBeGreaterThan(0);
    expect(jointResult.scanResult).toBe(cachedScan);
  });

  it('stays static-only when no bridge is configured', async () => {
    const scan = makeScanResult();
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    registerJointAnalysisIpc(() => undefined);

    const handler = handlers.get('asar:joint-analysis')!;
    const result = (await handler({}, { agentId: 'codex', extractDir: '/tmp/test' })) as {
      health: { dynamicScore: number; noCdpReason?: string };
    };

    expect(result.health.dynamicScore).toBe(0);
    expect(result.health.noCdpReason).toContain('未配置 CDP 桥接');
  });
});

// ---------------------------------------------------------------------------
// Tests — runJointAnalysis: Graceful Degradation (Agent Unreachable)
// ---------------------------------------------------------------------------

describe('runJointAnalysis — graceful degradation (no CDP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns static-only health when the agent cannot be reached', async () => {
    const scan = makeScanResult();
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    // Static score should be > 0 (from seeds + namespaces + contextIsolation bonus)
    expect(result.health.staticScore).toBeGreaterThan(0);
    expect(result.health.dynamicScore).toBe(0);
    expect(result.health.total).toBe(result.health.staticScore);
    expect(result.health.hitRate).toBe(0);
    expect(result.health.landmarkPassed).toBe(false);
    expect(result.health.noCdpReason).toContain('未找到可用的 CDP 调试端口');
    expect(result.cdp).toBeUndefined();
  });

  it('reports an unknown acquire reason verbatim', async () => {
    const scan = makeScanResult();
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const result = await runJointAnalysis(
      { agentId: 'codex', extractDir: '/tmp/test' },
      { acquire: async () => ({ ok: false, reason: 'boot-in-progress' }) },
    );

    expect(result.health.noCdpReason).toBe('boot-in-progress');
  });

  it('survives an acquire that throws', async () => {
    const scan = makeScanResult();
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const result = await runJointAnalysis(
      { agentId: 'codex', extractDir: '/tmp/test' },
      { acquire: () => Promise.reject(new Error('pool exploded')) },
    );

    expect(result.health.dynamicScore).toBe(0);
    expect(result.health.noCdpReason).toContain('acquire threw: pool exploded');
  });

  it('computes static score with contextIsolation bonus', async () => {
    const scan = makeScanResult({
      contextIsolation: true,
      highStabilityCount: 20,
      namespaceCount: 3,
    });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    // seedScore = min(20, round(20/25*20)) = 16
    // namespaceScore = min(10, 3) = 3
    // contextIsolationBonus = 10
    // staticScore = min(40, 16+3+10) = 29
    expect(result.health.staticScore).toBe(29);
  });

  it('computes static score without contextIsolation bonus', async () => {
    const scan = makeScanResult({
      contextIsolation: null,
      highStabilityCount: 10,
      namespaceCount: 2,
    });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    // seedScore = min(20, round(10/25*20)) = 8
    // namespaceScore = min(10, 2) = 2
    // contextIsolationBonus = 0
    // staticScore = min(40, 8+2+0) = 10
    expect(result.health.staticScore).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Tests — runJointAnalysis: Full Joint Score (Agent Running)
// ---------------------------------------------------------------------------

describe('runJointAnalysis — full joint score (with CDP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes joint health when landmarks pass + high hit rate', async () => {
    const scan = makeScanResult({
      highStabilityCount: 25,
      namespaceCount: 4,
      contextIsolation: true,
    });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    // All 25 seeds hit
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(25, 25));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    // hitRate = 25/25 = 1.0
    // hitScore = round(1.0 * 40) = 40
    // landmarkScore = 20 (passed)
    // dynamicScore = min(60, 40+20) = 60
    expect(result.health.hitRate).toBe(1);
    expect(result.health.dynamicScore).toBe(60);
    expect(result.health.landmarkPassed).toBe(true);
    expect(result.health.total).toBe(result.health.staticScore + 60);
  });

  it('computes reduced dynamic score when landmarks fail', async () => {
    const scan = makeScanResult({ highStabilityCount: 20, namespaceCount: 3 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(false));
    // 15/20 seeds hit
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(20, 15));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    // hitRate = 15/20 = 0.75
    // hitScore = round(0.75 * 40) = 30
    // landmarkScore = 10 (failed)
    // dynamicScore = min(60, 30+10) = 40
    expect(result.health.hitRate).toBeCloseTo(0.75);
    expect(result.health.dynamicScore).toBe(40);
    expect(result.health.landmarkPassed).toBe(false);
  });

  it('caps total health score at 100', async () => {
    const scan = makeScanResult({
      highStabilityCount: 25,
      namespaceCount: 10,
      contextIsolation: true,
    });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(25, 25));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    // static: seedScore=20, namespaceScore=10, bonus=10 → 40
    // dynamic: hitScore=40, landmarkScore=20 → 60
    expect(result.health.total).toBe(100);
  });

  it('reports the live CDP contribution', async () => {
    const scan = makeScanResult();
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.cdp).toBeDefined();
    expect(result.cdp?.port).toBe(9224);
    expect(result.cdp?.targetId).toBe('target-1');
  });
});

// ---------------------------------------------------------------------------
// Tests — Cached Scan Result
// ---------------------------------------------------------------------------

describe('runJointAnalysis — cached scan result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips ASAR scan when cachedScanResult is provided', async () => {
    const cachedScan = makeScanResult({ highStabilityCount: 15, namespaceCount: 2 });
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis(
      { agentId: 'codex', extractDir: '/tmp/test', cachedScanResult: cachedScan },
      deps,
    );

    expect(scanExtractedAsar).not.toHaveBeenCalled();
    expect(result.scanResult).toBe(cachedScan);
  });
});

// ---------------------------------------------------------------------------
// Tests — Inject Readiness Assessment
// ---------------------------------------------------------------------------

describe('runJointAnalysis — inject readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks inject when contextIsolation is false', async () => {
    const scan = makeScanResult({ contextIsolation: false });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.readiness.canInject).toBe(false);
    expect(result.readiness.blocks).toContain(
      'contextIsolation is false — preload injection may be blocked',
    );
  });

  it('warns when contextIsolation is null (not detected)', async () => {
    const scan = makeScanResult({ contextIsolation: null });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.readiness.canInject).toBe(true);
    expect(result.readiness.warnings).toContain('contextIsolation not detected — verify manually');
  });

  it('warns when few high-stability anchors', async () => {
    const scan = makeScanResult({ highStabilityCount: 3 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.readiness.warnings).toContain(
      'Few high-stability anchors — injection may be fragile',
    );
  });

  it('warns when low anchor hit rate in dynamic mode', async () => {
    const scan = makeScanResult({ highStabilityCount: 20 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    // Only 5/20 hit → 25% hit rate
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(20, 5));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.health.hitRate).toBeCloseTo(0.25);
    expect(result.readiness.warnings.some((w) => w.includes('Low anchor hit rate'))).toBe(true);
  });

  it('warns when landmark preflight not fully passed', async () => {
    const scan = makeScanResult({ highStabilityCount: 10 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(false));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(10, 10));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.readiness.warnings).toContain(
      'Landmark preflight not fully passed — some DOM anchors missing',
    );
  });

  it('recommends a CSP-derived inject mechanism', async () => {
    const scan = makeScanResult({ architecture: makeMultiPageArchitecture() });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);

    const { deps } = makeDeps(null);
    const result = await runJointAnalysis({ agentId: 'qoderwork', extractDir: '/tmp/test' }, deps);

    expect(result.readiness.recommendations.some((r) => r.includes('adoptedStyleSheets'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — Multi-page surface coverage
// ---------------------------------------------------------------------------

describe('runJointAnalysis — multi-page surface coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names multi-page entries that no live target serves', async () => {
    const scan = makeScanResult({ architecture: makeMultiPageArchitecture() });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    // Only the primary entry is live — voice-overlay and quickpick are not.
    const { deps } = makeDeps(makeMockSession(), [
      { id: 't1', type: 'page', url: 'file:///out/renderer/index.html', title: 'QoderWork' },
    ]);
    const result = await runJointAnalysis({ agentId: 'qoderwork', extractDir: '/tmp/test' }, deps);

    expect(result.cdp?.surfaces).toHaveLength(2);
    expect(result.cdp?.surfaces.every((s) => !s.matched)).toBe(true);
    expect(
      result.readiness.warnings.some((w) => w.includes('voice-overlay') && w.includes('quickpick')),
    ).toBe(true);
  });

  it('marks a surface matched when a target serves it', async () => {
    const scan = makeScanResult({ architecture: makeMultiPageArchitecture() });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    const { deps } = makeDeps(makeMockSession(), [
      { id: 't1', type: 'page', url: 'file:///out/renderer/index.html', title: 'QoderWork' },
      {
        id: 't2',
        type: 'page',
        url: 'file:///out/renderer/voice-overlay.html',
        title: 'Voice',
      },
    ]);
    const result = await runJointAnalysis({ agentId: 'qoderwork', extractDir: '/tmp/test' }, deps);

    const overlay = result.cdp?.surfaces.find((s) => s.role === 'voice-overlay');
    expect(overlay?.matched).toBe(true);
    expect(result.readiness.warnings.some((w) => w.includes('voice-overlay'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — CDP Error Fallback
// ---------------------------------------------------------------------------

describe('runJointAnalysis — CDP error fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to static-only when landmark preflight throws', async () => {
    const scan = makeScanResult({ highStabilityCount: 15, namespaceCount: 2 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockRejectedValue(new Error('CDP timeout'));

    const { deps } = makeDeps(makeMockSession());
    const result = await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(result.health.dynamicScore).toBe(0);
    expect(result.health.noCdpReason).toContain('CDP error: CDP timeout');
  });

  it('releases the session after success', async () => {
    const scan = makeScanResult({ highStabilityCount: 10 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    const { deps, release } = makeDeps(makeMockSession());
    await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the session even when the CDP phase throws', async () => {
    const scan = makeScanResult({ highStabilityCount: 10 });
    vi.mocked(scanExtractedAsar).mockReturnValue(scan);
    vi.mocked(runLandmarkPreflight).mockRejectedValue(new Error('socket died'));

    const { deps, release } = makeDeps(makeMockSession());
    await runJointAnalysis({ agentId: 'codex', extractDir: '/tmp/test' }, deps);

    expect(release).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — acquireJointSession (the previously-broken link)
// ---------------------------------------------------------------------------

describe('acquireJointSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports no-live-cdp-port when no port answers', async () => {
    const bridge = makeBridge({ port: null });
    const result = await acquireJointSession(bridge as never, undefined, 'codex');
    expect(result).toEqual({ ok: false, reason: 'no-live-cdp-port' });
  });

  it('reports no-dom-target when only background pages exist', async () => {
    const bridge = makeBridge({
      targets: [{ id: 'bg', type: 'background_page', url: 'chrome://extensions' }],
    });
    const result = await acquireJointSession(bridge as never, undefined, 'codex');
    expect(result).toEqual({ ok: false, reason: 'no-dom-target' });
  });

  it('reports connect-failed when the WebSocket cannot be opened', async () => {
    const bridge = makeBridge({ session: null });
    const result = await acquireJointSession(bridge as never, undefined, 'codex');
    expect(result).toEqual({ ok: false, reason: 'connect-failed' });
  });

  it('connects to the hint-matching target, not merely the first one', async () => {
    const bridge = makeBridge({
      targets: [
        { id: 'a', type: 'page', title: 'Settings', url: 'file:///settings.html' },
        {
          id: 'b',
          type: 'page',
          title: 'QoderWork',
          url: 'file:///out/renderer/index.html',
          webSocketDebuggerUrl: 'ws://b',
        },
      ],
    });
    const result = await acquireJointSession(bridge as never, undefined, 'qoderwork');

    expect(result.ok).toBe(true);
    // RENDERER_HINTS[qoderwork].primary prefers out/renderer/index.html.
    expect(bridge.connect).toHaveBeenCalledWith('ws://b');
    if (result.ok) {
      expect(result.target.id).toBe('b');
      result.release();
    }
  });

  it('keys the session by target id, not the literal "main"', async () => {
    // Regression guard: the old code called pool.acquire(agentId, 'main', …),
    // which could never hit a pooled entry and always opened a fresh session.
    const bridge = makeBridge();
    const acquire = vi.fn(async (_appId: string, key: string, open: () => Promise<unknown>) => ({
      session: await open(),
      pooled: true,
    }));
    const release = vi.fn();
    const pool = { acquire, release } as never;

    const result = await acquireJointSession(bridge as never, pool, 'codex');
    expect(result.ok).toBe(true);
    expect(acquire.mock.calls[0]?.[1]).toBe('target-1');
    if (result.ok) {
      result.release();
      expect(release).toHaveBeenCalledWith('codex', 'target-1');
    }
  });

  it('releases a pooled session at most once', async () => {
    const bridge = makeBridge();
    const release = vi.fn();
    const pool = {
      acquire: vi.fn(async (_a: string, _k: string, open: () => Promise<unknown>) => ({
        session: await open(),
        pooled: true,
      })),
      release,
    } as never;

    const result = await acquireJointSession(bridge as never, pool, 'codex');
    if (!result.ok) throw new Error('expected a session');
    result.release();
    result.release();

    expect(release).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — Family Detection (single source of truth)
// ---------------------------------------------------------------------------

describe('runJointAnalysis — family detection via IPC', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('detects react family for codex', async () => {
    registerJointAnalysisIpc(() => undefined, makeBridge() as never);
    const handler = handlers.get('asar:joint-analysis')!;

    vi.mocked(scanExtractedAsar).mockReturnValue(makeScanResult());
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    await handler({}, { agentId: 'codex', extractDir: '/tmp/test' });
    expect(scanExtractedAsar).toHaveBeenCalledWith('/tmp/test', 'react', 'codex');
  });

  it('detects react family for workbuddy (WebView sandbox, not VS Code)', async () => {
    // Regression guard: workbuddy was previously classified 'vscode' because
    // three modules carried three different copies of this table.
    registerJointAnalysisIpc(() => undefined, makeBridge() as never);
    const handler = handlers.get('asar:joint-analysis')!;

    vi.mocked(scanExtractedAsar).mockReturnValue(makeScanResult());
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    await handler({}, { agentId: 'workbuddy', extractDir: '/tmp/test' });
    expect(scanExtractedAsar).toHaveBeenCalledWith('/tmp/test', 'react', 'workbuddy');
  });

  it('detects vscode family for traework (the only VS Code layout)', async () => {
    registerJointAnalysisIpc(() => undefined, makeBridge() as never);
    const handler = handlers.get('asar:joint-analysis')!;

    vi.mocked(scanExtractedAsar).mockReturnValue(makeScanResult());
    vi.mocked(runLandmarkPreflight).mockResolvedValue(makePreflightResult(true));
    vi.mocked(validateSelectors).mockResolvedValue(makeValidationReport(1, 1));

    await handler({}, { agentId: 'traework', extractDir: '/tmp/test' });
    expect(scanExtractedAsar).toHaveBeenCalledWith('/tmp/test', 'vscode', 'traework');
  });
});
