// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { AgentId, RestartReason } from '../../shared/types';
import type { CdpReadyResult } from '../app-discovery';
import { type CdpReadyDeps, ensureAgentCdpReady } from './cdp-ready';

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
    expect(ensureCdpReady).toHaveBeenCalledWith(TEST_AGENT, 45_000);
  });
});
