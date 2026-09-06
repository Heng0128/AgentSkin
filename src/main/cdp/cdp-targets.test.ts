// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpTarget } from '../../legacy/agentskin-core-runtime';
import type { AgentId, RestartReason } from '../../shared/types';
import type { CdpReadyResult } from '../app-discovery';
import { type CdpReadyDeps, ensureAgentCdpReady } from './cdp-targets';

// Mock listCdpTargets so listTargets/findPageTarget/findDomTargets/findSecondaryTargets
// can be tested without a real CDP endpoint.
vi.mock('../../legacy/agentskin-core-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../legacy/agentskin-core-runtime')>();
  return {
    ...actual,
    listCdpTargets: vi.fn(),
  };
});

// Import AFTER mock so the mocked module is in effect.
const { listCdpTargets } = await import('../../legacy/agentskin-core-runtime');

// The per-port target-list cache is module-level — reset it between tests so
// a cached result from one test never bleeds into the next. The CDP readiness
// tests below do not exercise the targets cache, but the import pulls in the
// module that owns it, so resetting keeps cross-describe isolation intact.
beforeEach(() => {
  vi.clearAllMocks();
});

function makeTarget(overrides: Partial<CdpTarget> = {}): CdpTarget {
  return {
    id: 'target-1',
    type: 'page',
    url: 'http://localhost',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    title: 'Test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Target discovery tests (from cdp-targets.test.ts)
// ---------------------------------------------------------------------------

describe('pickPageTarget', () => {
  it('returns the first target with type "page" and a webSocketDebuggerUrl', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'worker-1', type: 'service_worker', url: 'sw.js' }),
      makeTarget({ id: 'page-1', type: 'page', url: 'http://localhost' }),
      makeTarget({ id: 'page-2', type: 'page', url: 'http://other' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('page-1');
  });

  it('skips page targets without webSocketDebuggerUrl', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'page-no-ws', type: 'page', webSocketDebuggerUrl: undefined }),
      makeTarget({ id: 'page-ok', type: 'page' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('page-ok');
  });

  it('accepts targets with undefined type when URL has http/https/file scheme', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'devtools', type: undefined, url: 'chrome-devtools://devtools' }),
      makeTarget({ id: 'http-page', type: undefined, url: 'https://app.example.com' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('http-page');
  });

  it('rejects undefined-type targets with non-page URLs (chrome-devtools, ws, devtools)', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'devtools', type: undefined, url: 'devtools://devtools/bundled' }),
      makeTarget({ id: 'ws', type: undefined, url: 'ws://127.0.0.1:9222' }),
      makeTarget({ id: 'chrome', type: undefined, url: 'chrome-devtools://devtools' }),
    ];
    expect(pickPageTarget(targets)).toBeUndefined();
  });

  it('rejects undefined-type targets with empty or missing URL', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'no-url', type: undefined, url: '' }),
      makeTarget({ id: 'null-url', type: undefined, url: undefined }),
    ];
    expect(pickPageTarget(targets)).toBeUndefined();
  });

  it('skips webview, iframe, and worker targets', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'webview', type: 'webview' }),
      makeTarget({ id: 'iframe', type: 'iframe' }),
      makeTarget({ id: 'worker', type: 'shared_worker' }),
    ];
    expect(pickPageTarget(targets)).toBeUndefined();
  });

  it('returns undefined for an empty array', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    expect(pickPageTarget([])).toBeUndefined();
  });

  it('handles null type like undefined type', async () => {
    const { pickPageTarget } = await import('./cdp-targets');
    const targets: CdpTarget[] = [
      makeTarget({ id: 'null-type', type: null as unknown as undefined, url: 'http://localhost' }),
    ];
    expect(pickPageTarget(targets)?.id).toBe('null-type');
  });
});

describe('listTargets', () => {
  it('returns targets from listCdpTargets on success', async () => {
    const { listTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget()]);
    const result = await listTargets(9222);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('target-1');
  });

  it('returns empty array when listCdpTargets throws', async () => {
    const { listTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await listTargets(9222);
    expect(result).toEqual([]);
  });

  it('reuses the cached target list within the TTL window (one fetch)', async () => {
    const { listTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget()]);
    const first = await listTargets(9222);
    const second = await listTargets(9222);
    expect(first).toHaveLength(1);
    expect(second).toBe(first); // same cached array
    expect(listCdpTargets).toHaveBeenCalledTimes(1);
  });

  it('does not cache an empty result (transient not-ready state is re-fetched)', async () => {
    const { listTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([]);
    await listTargets(9222);
    await listTargets(9222);
    expect(listCdpTargets).toHaveBeenCalledTimes(2);
  });

  it('clearTargetsCache invalidates the cached list', async () => {
    const { listTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget()]);
    await listTargets(9222);
    clearTargetsCache();
    await listTargets(9222);
    expect(listCdpTargets).toHaveBeenCalledTimes(2);
  });
});

describe('findPageTarget', () => {
  it('returns the first page target', async () => {
    const { findPageTarget, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'worker', type: 'service_worker' }),
      makeTarget({ id: 'page', type: 'page' }),
    ]);
    const result = await findPageTarget(9222);
    expect(result?.id).toBe('page');
  });

  it('returns undefined when no page target exists', async () => {
    const { findPageTarget, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'worker', type: 'service_worker' }),
    ]);
    const result = await findPageTarget(9222);
    expect(result).toBeUndefined();
  });
});

describe('findDomTargets', () => {
  it('returns page, webview, and iframe targets with webSocketDebuggerUrl', async () => {
    const { findDomTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'page', type: 'page' }),
      makeTarget({ id: 'webview', type: 'webview' }),
      makeTarget({ id: 'iframe', type: 'iframe' }),
      makeTarget({ id: 'worker', type: 'shared_worker' }),
      makeTarget({ id: 'page-no-ws', type: 'page', webSocketDebuggerUrl: undefined }),
    ]);
    const result = await findDomTargets(9222);
    expect(result.map((t) => t.id)).toEqual(['page', 'webview', 'iframe']);
  });

  it('returns empty array when no DOM targets exist', async () => {
    const { findDomTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'worker', type: 'service_worker' }),
    ]);
    const result = await findDomTargets(9222);
    expect(result).toEqual([]);
  });
});

describe('findSecondaryTargets', () => {
  it('returns only webview and iframe targets (excludes main page)', async () => {
    const { findSecondaryTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'page', type: 'page' }),
      makeTarget({ id: 'webview', type: 'webview' }),
      makeTarget({ id: 'iframe', type: 'iframe' }),
      makeTarget({ id: 'worker', type: 'service_worker' }),
    ]);
    const result = await findSecondaryTargets(9222);
    expect(result.map((t) => t.id)).toEqual(['webview', 'iframe']);
  });

  it('filters out webview/iframe targets without webSocketDebuggerUrl', async () => {
    const { findSecondaryTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([
      makeTarget({ id: 'webview-no-ws', type: 'webview', webSocketDebuggerUrl: undefined }),
      makeTarget({ id: 'iframe-ok', type: 'iframe' }),
    ]);
    const result = await findSecondaryTargets(9222);
    expect(result.map((t) => t.id)).toEqual(['iframe-ok']);
  });

  it('returns empty array when no secondary targets exist', async () => {
    const { findSecondaryTargets, clearTargetsCache } = await import('./cdp-targets');
    clearTargetsCache();
    vi.mocked(listCdpTargets).mockResolvedValue([makeTarget({ id: 'page', type: 'page' })]);
    const result = await findSecondaryTargets(9222);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unified CDP readiness tests (from cdp-ready.test.ts)
// ---------------------------------------------------------------------------

const TEST_AGENT = 'traework' as AgentId;

function createDeps(overrides: Partial<CdpReadyDeps> = {}): CdpReadyDeps & {
  logLines: string[];
} {
  const logLines: string[] = [];
  return {
    resolveLivePort: async () => null,
    ensureCdpReady: async (): Promise<CdpReadyResult> => ({ port: null, reason: 'timeout' }),
    inferRestartReason: async (): Promise<RestartReason> => 'no-cdp',
    log: (line: string) => logLines.push(line),
    ...overrides,
    logLines,
  };
}

describe('ensureAgentCdpReady — CDP readiness policy', () => {
  it('returns ready with the live port when the probe succeeds (phase 1)', async () => {
    const deps = createDeps({ resolveLivePort: async () => 9222 });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps);
    expect(result).toEqual({ port: 9222, status: 'ready' });
    // ensureCdpReady must NOT be called — a live port needs no launch.
    expect(deps.logLines.some((l) => l.includes('no live CDP port'))).toBe(false);
  });

  it('auto-launches a not-running agent without a confirmation dialog', async () => {
    const ensureCdpReady = vi.fn(
      async (): Promise<CdpReadyResult> => ({ port: 9333, reason: null }),
    );
    const inferRestartReason = vi.fn(async (): Promise<RestartReason> => 'not-running');
    const deps = createDeps({
      ensureCdpReady: ensureCdpReady as CdpReadyDeps['ensureCdpReady'],
      inferRestartReason: inferRestartReason as CdpReadyDeps['inferRestartReason'],
    });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps);
    expect(result).toEqual({ port: 9333, status: 'ready' });
    // 未运行 = 启动，不是重启 —— 第一次点击直接拉起，不弹窗。
    expect(ensureCdpReady).toHaveBeenCalledTimes(1);
    expect(deps.logLines.some((l) => l.includes('auto-launching'))).toBe(true);
  });

  it('falls back to requires-restart when the auto-launch fails', async () => {
    const ensureCdpReady = vi.fn(
      async (): Promise<CdpReadyResult> => ({ port: null, reason: 'spawn-error' }),
    );
    const inferRestartReason = vi.fn(
      async (appId: AgentId, reason: CdpReadyResult['reason'] | null): Promise<RestartReason> =>
        reason === 'spawn-error' ? 'spawn-failed' : 'not-running',
    );
    const deps = createDeps({
      ensureCdpReady: ensureCdpReady as CdpReadyDeps['ensureCdpReady'],
      inferRestartReason: inferRestartReason as CdpReadyDeps['inferRestartReason'],
    });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps);
    expect(result).toEqual({
      port: null,
      status: 'requires-restart',
      restartReason: 'spawn-failed',
    });
    // 二次映射用了 ensureCdpReady 的失败原因。
    expect(inferRestartReason).toHaveBeenLastCalledWith(TEST_AGENT, 'spawn-error');
  });

  it('still requires a confirmation when the agent runs WITHOUT a debug port (no-cdp)', async () => {
    const ensureCdpReady = vi.fn();
    const inferRestartReason = vi.fn(async (): Promise<RestartReason> => 'no-cdp');
    const deps = createDeps({
      ensureCdpReady: ensureCdpReady as unknown as CdpReadyDeps['ensureCdpReady'],
      inferRestartReason: inferRestartReason as CdpReadyDeps['inferRestartReason'],
    });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps);
    // 运行中的 app 不能被悄悄杀掉 —— 必须弹窗让用户确认重启。
    expect(result).toEqual({
      port: null,
      status: 'requires-restart',
      restartReason: 'no-cdp',
    });
    expect(ensureCdpReady).not.toHaveBeenCalled();
  });

  it('does not launch when the agent is not installed', async () => {
    const ensureCdpReady = vi.fn();
    const inferRestartReason = vi.fn(async (): Promise<RestartReason> => 'not-installed');
    const deps = createDeps({
      ensureCdpReady: ensureCdpReady as unknown as CdpReadyDeps['ensureCdpReady'],
      inferRestartReason: inferRestartReason as CdpReadyDeps['inferRestartReason'],
    });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps);
    expect(result).toEqual({
      port: null,
      status: 'requires-restart',
      restartReason: 'not-installed',
    });
    expect(ensureCdpReady).not.toHaveBeenCalled();
  });

  it('calls ensureCdpReady when the user confirms a restart (restartExisting)', async () => {
    const ensureCdpReady = vi.fn(
      async (): Promise<CdpReadyResult> => ({ port: 9333, reason: null }),
    );
    const deps = createDeps({ ensureCdpReady: ensureCdpReady as CdpReadyDeps['ensureCdpReady'] });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps, { restartExisting: true });
    expect(result).toEqual({ port: 9333, status: 'ready' });
    expect(ensureCdpReady).toHaveBeenCalledTimes(1);
  });

  it('maps an ensureCdpReady failure to a structured restartReason (not-installed)', async () => {
    const ensureCdpReady = vi.fn(
      async (): Promise<CdpReadyResult> => ({ port: null, reason: 'not-installed' }),
    );
    const inferRestartReason = vi.fn(async (): Promise<RestartReason> => 'not-installed');
    const deps = createDeps({
      ensureCdpReady: ensureCdpReady as CdpReadyDeps['ensureCdpReady'],
      inferRestartReason: inferRestartReason as CdpReadyDeps['inferRestartReason'],
    });
    const result = await ensureAgentCdpReady(TEST_AGENT, deps, { restartExisting: true });
    expect(result).toEqual({
      port: null,
      status: 'requires-restart',
      restartReason: 'not-installed',
    });
    expect(inferRestartReason).toHaveBeenCalledWith(TEST_AGENT, 'not-installed');
  });

  it('passes the timeout through to ensureCdpReady', async () => {
    const ensureCdpReady = vi.fn(
      async (): Promise<CdpReadyResult> => ({ port: 9444, reason: null }),
    );
    const deps = createDeps({ ensureCdpReady: ensureCdpReady as CdpReadyDeps['ensureCdpReady'] });
    await ensureAgentCdpReady(TEST_AGENT, deps, { restartExisting: true, timeoutMs: 45_000 });
    expect(ensureCdpReady).toHaveBeenCalledWith(TEST_AGENT, 45_000, true);
  });
});
