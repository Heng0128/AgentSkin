// SPDX-License-Identifier: MPL-2.0

/**
 * # delegates.test.ts — withPageSession 核心逻辑单元测试
 *
 * delegates.ts 中唯一一个包含真实逻辑（非纯转发）的函数是 withPageSession。
 * 本文件验证其核心行为：
 *   - 正常路径：首次 findTargets 命中 → 调用 fn → 关闭 session
 *   - 重试路径：前 N 次无目标 → 第 N+1 次成功
 *   - disposed 短路：isDisposed 返回 true → 立即抛出错误
 *   - 端口缓存：成功时复用 cachedPort，失败时重置
 *   - 全失败耗尽 retries → 抛出 lastError
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../shared/types';
import type { CdpSession } from '../cdp/cdp-client';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock calls (hoisted by vitest)
// ---------------------------------------------------------------------------

const { mockSession } = vi.hoisted(() => ({
  mockSession: {
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  } as unknown as CdpSession,
}));

vi.mock('../cdp/cdp-client', () => ({
  connectCdp: vi.fn().mockResolvedValue(mockSession),
}));

vi.mock('../cdp/cdp-targets', () => ({
  pickPageTarget: vi.fn(
    (targets: Array<{ type: string }>) =>
      targets.find((t) => t.type === 'page') ?? targets[0] ?? null,
  ),
}));

vi.mock('../cdp/injection/shared', () => ({
  backoffDelay: vi.fn().mockResolvedValue(undefined),
}));

import { connectCdp } from '../cdp/cdp-client';
import { type WithPageSessionDeps, withPageSession } from './delegates';

const TEST_AGENT: AgentId = 'traework' as AgentId;

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

interface MockWithPageSessionDepsOptions {
  /** findTargets 返回值序列（按调用顺序） */
  findTargetsResults?: Array<Array<{ type: string; webSocketDebuggerUrl: string }> | Error>;
  /** resolveLivePort 返回值序列（按调用顺序） */
  resolveLivePortResults?: Array<number | null>;
  /** isDisposed 返回值 */
  isDisposed?: () => boolean;
}

function createMockDeps(opts: MockWithPageSessionDepsOptions = {}): WithPageSessionDeps & {
  logLines: string[];
  findTargetsCalls: number;
  resolveLivePortCalls: number;
} {
  const logLines: string[] = [];
  let findTargetsCallIndex = 0;
  let resolveLivePortCallIndex = 0;

  const findTargetsResults = opts.findTargetsResults ?? [
    [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }],
  ];
  const resolveLivePortResults = opts.resolveLivePortResults ?? [9222];

  return {
    logLines,
    get findTargetsCalls() {
      return findTargetsCallIndex;
    },
    get resolveLivePortCalls() {
      return resolveLivePortCallIndex;
    },
    adapter: (() =>
      ({
        findTargets: async () => {
          const result = findTargetsResults[findTargetsCallIndex++] ?? [];
          if (result instanceof Error) throw result;
          return result as Array<{ type: string; webSocketDebuggerUrl: string }>;
        },
      }) as unknown as ReturnType<
        WithPageSessionDeps['adapter']
      >) as WithPageSessionDeps['adapter'],
    resolveLivePort: async () => resolveLivePortResults[resolveLivePortCallIndex++] ?? null,
    isDisposed: opts.isDisposed ?? (() => false),
    log: (line: string) => logLines.push(line),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withPageSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 正常路径
  // =========================================================================

  describe('happy path', () => {
    it('calls fn with session and closes it after first successful target resolution', async () => {
      const deps = createMockDeps({
        findTargetsResults: [
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }],
        ],
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000);

      // fn 被调用一次，传入 session
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(mockSession);
      // session 被关闭
      expect(mockSession.close).toHaveBeenCalledTimes(1);
      // connectCdp 被调用一次
      expect(connectCdp).toHaveBeenCalledTimes(1);
      expect(connectCdp).toHaveBeenCalledWith('ws://127.0.0.1:9222/page/1', 5000, 8000, TEST_AGENT);
    });

    it('returns immediately after first success without exhausting retries', async () => {
      const deps = createMockDeps({
        findTargetsResults: [
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }],
        ],
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await withPageSession(TEST_AGENT, 9222, fn, 5, deps, 5000);

      // 只调用了一次 findTargets 和 resolveLivePort
      expect(deps.findTargetsCalls).toBe(1);
      expect(deps.resolveLivePortCalls).toBe(1);
    });
  });

  // =========================================================================
  // 重试路径
  // =========================================================================

  describe('retry path', () => {
    it('retries when first findTargets returns empty, succeeds on second attempt', async () => {
      const deps = createMockDeps({
        findTargetsResults: [
          [], // 第一次无目标
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }], // 第二次命中
        ],
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000);

      // fn 最终被调用
      expect(fn).toHaveBeenCalledTimes(1);
      expect(mockSession.close).toHaveBeenCalledTimes(1);
      // findTargets 被调用两次
      expect(deps.findTargetsCalls).toBe(2);
    });

    it('resets cachedPort when findTargets throws (stale port)', async () => {
      const deps = createMockDeps({
        findTargetsResults: [
          new Error('stale port'), // 第一次抛错 → cachedPort 重置
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/2' }], // 第二次命中（新端口）
        ],
        resolveLivePortResults: [9222, 9223], // 第一次 9222 → 第二次重新解析得 9223
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000);

      // resolveLivePort 被调用两次（第一次初始 + 第二次因 cachedPort 重置）
      expect(deps.resolveLivePortCalls).toBe(2);
      // 最终用新端口连接
      expect(connectCdp).toHaveBeenCalledWith('ws://127.0.0.1:9222/page/2', 5000, 8000, TEST_AGENT);
    });

    it('retries when resolveLivePort returns null (app still booting)', async () => {
      const deps = createMockDeps({
        findTargetsResults: [
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }], // 第二次有目标
        ],
        resolveLivePortResults: [null, 9222], // 第一次 null → 第二次成功
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(deps.resolveLivePortCalls).toBe(2);
    });
  });

  // =========================================================================
  // disposed 短路
  // =========================================================================

  describe('disposed short-circuit', () => {
    it('throws immediately when isDisposed returns true on first attempt', async () => {
      const deps = createMockDeps({
        isDisposed: () => true,
        findTargetsResults: [
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }],
        ],
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await expect(withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000)).rejects.toThrow(
        'AgentEngineService disposed',
      );

      // fn 不应被调用
      expect(fn).not.toHaveBeenCalled();
      // session 不应被关闭（因为从未连接）
      expect(mockSession.close).not.toHaveBeenCalled();
    });

    it('throws on second attempt if disposed during retry', async () => {
      let disposed = false;
      const deps = createMockDeps({
        isDisposed: () => disposed,
        findTargetsResults: [
          [], // 第一次无目标
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }], // 第二次有目标
        ],
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      // 在第一次 findTargets 之后设置 disposed
      const originalFindTargets = deps.adapter;
      deps.adapter = (() =>
        ({
          findTargets: async () => {
            const result = await originalFindTargets(TEST_AGENT).findTargets(9222, 1200);
            disposed = true; // 第一次调用后设置 disposed
            return result;
          },
        }) as unknown as ReturnType<
          WithPageSessionDeps['adapter']
        >) as WithPageSessionDeps['adapter'];

      await expect(withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000)).rejects.toThrow(
        'AgentEngineService disposed',
      );

      // fn 不应被调用（第二次迭代时 disposed 为 true）
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 全失败路径
  // =========================================================================

  describe('all-retries-fail path', () => {
    it('throws lastError when all retries exhausted with no targets', async () => {
      const deps = createMockDeps({
        findTargetsResults: [[], [], []], // 3 次都无目标
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await expect(withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000)).rejects.toThrow(
        'no reachable page target',
      );

      // fn 从未被调用
      expect(fn).not.toHaveBeenCalled();
      // findTargets 被调用 3 次
      expect(deps.findTargetsCalls).toBe(3);
    });

    it('throws lastError when resolveLivePort always returns null', async () => {
      const deps = createMockDeps({
        findTargetsResults: [],
        resolveLivePortResults: [null, null, null], // 3 次都无端口
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      await expect(withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000)).rejects.toThrow(
        'no live CDP port',
      );

      // findTargets 从未被调用（因为端口解析失败）
      expect(deps.findTargetsCalls).toBe(0);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // session.close 错误处理
  // =========================================================================

  describe('session.close error handling', () => {
    it('logs close error but does not throw', async () => {
      vi.mocked(mockSession.close).mockImplementationOnce(() => {
        throw new Error('close failed');
      });

      const deps = createMockDeps({
        findTargetsResults: [
          [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' }],
        ],
        resolveLivePortResults: [9222],
      });
      const fn = vi.fn().mockResolvedValue(undefined);

      // 不应抛错
      await withPageSession(TEST_AGENT, 9222, fn, 3, deps, 5000);

      // 错误被记录到 log
      expect(deps.logLines.some((l) => l.includes('session.close() error'))).toBe(true);
      expect(deps.logLines.some((l) => l.includes('close failed'))).toBe(true);
    });
  });
});
