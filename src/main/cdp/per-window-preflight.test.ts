// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession } from './cdp-client';
import { connectCdp } from './cdp-client';
import type { CdpTarget } from './cdp-targets';
import type { LandmarkDefinition } from './preflight';
import {
  classifyTarget,
  type PerWindowPreflightResult,
  runPerWindowPreflight,
  shouldBlockInjection,
} from './preflight';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./cdp-client', () => ({
  connectCdp: vi.fn(),
}));

// Reset all mock call counts between tests so assertions on
// toHaveBeenCalled / not.toHaveBeenCalled are not polluted by prior tests.
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTarget(overrides: Partial<CdpTarget> = {}): CdpTarget {
  return {
    id: 'target-1',
    type: 'page',
    url: 'app://-/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    title: 'Test',
    ...overrides,
  };
}

/**
 * Create a session whose evaluate method simulates the IIFE behavior for a
 * given set of "present" landmark names. This drives classifyTarget through
 * the real runLandmarkPreflight internally.
 */
function makeSessionWithLandmarks(presentNames: Set<string>): CdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockImplementation((expr: string) => {
      const match = expr.match(/const landmarks = (\[.*?\]);/s);
      if (!match) return Promise.resolve('[]');
      const landmarks = JSON.parse(match[1]) as Array<{
        name: string;
        selectors: string[];
      }>;
      const results = landmarks.map((lm) => {
        if (presentNames.has(lm.name)) {
          return { name: lm.name, found: true, matchedSelector: lm.selectors[0], count: 1 };
        }
        return { name: lm.name, found: false, count: 0 };
      });
      return Promise.resolve(JSON.stringify(results));
    }),
    close: vi.fn(),
  };
}

/**
 * Create a session whose evaluate method rejects (simulates evaluation error).
 */
function makeSessionWithError(): CdpSession {
  return {
    send: vi.fn().mockResolvedValue({}),
    evaluate: vi.fn().mockRejectedValue(new Error('renderer error')),
    close: vi.fn(),
  };
}

function makeLandmarks(): LandmarkDefinition[] {
  return [
    { name: 'main-content', selectors: ['#root', 'main'], required: true },
    { name: 'composer', selectors: ['.composer'], required: false },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyTarget', () => {
  // 1. 所有 required landmarks 命中 → primary
  it('returns primary when all required landmarks are present', async () => {
    vi.mocked(connectCdp).mockResolvedValue(
      makeSessionWithLandmarks(new Set(['main-content', 'composer'])),
    );

    const result = await classifyTarget(makeTarget(), makeLandmarks(), 'codex');

    expect(result.status).toBe('primary');
    expect(result.reason).toBeUndefined();
  });

  // 2. 缺少 required landmarks + 特殊路由 → skipped
  it('returns skipped when required landmarks missing but URL matches special route', async () => {
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set(['composer'])));

    const target = makeTarget({
      url: 'app://-/index.html?initialRoute=%2Favatar-overlay',
    });
    const result = await classifyTarget(target, makeLandmarks(), 'codex');

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('avatar-overlay');
  });

  // 3. 缺少 required landmarks + 非特殊路由 → failed
  it('returns failed when required landmarks missing and URL is not a special route', async () => {
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set(['composer'])));

    const target = makeTarget({ url: 'app://-/index.html?initialRoute=%2Fsettings' });
    const result = await classifyTarget(target, makeLandmarks(), 'codex');

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('main-content');
  });

  // 4. 无 webSocketDebuggerUrl → failed
  it('returns failed when target has no webSocketDebuggerUrl', async () => {
    const target = makeTarget({ webSocketDebuggerUrl: '' });
    const result = await classifyTarget(target, makeLandmarks(), 'codex');

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('no webSocketDebuggerUrl');
    expect(connectCdp).not.toHaveBeenCalled();
  });

  // 5. 空 landmarks → primary (快速路径)
  it('returns primary for empty landmarks array without connecting', async () => {
    const result = await classifyTarget(makeTarget(), [], 'codex');

    expect(result.status).toBe('primary');
    expect(connectCdp).not.toHaveBeenCalled();
  });

  // 6. CDP 连接失败 → failed
  it('returns failed when CDP connection fails', async () => {
    vi.mocked(connectCdp).mockRejectedValue(new Error('connection refused'));

    const result = await classifyTarget(makeTarget(), makeLandmarks(), 'codex');

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('CDP connect failed');
  });

  // 7. CDP 连接超时 → failed
  it('returns failed when CDP connection times out', async () => {
    vi.mocked(connectCdp).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    );

    const result = await classifyTarget(makeTarget(), makeLandmarks(), 'codex');

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('CDP connect failed');
  });

  // 8. evaluate 异常 → failed
  it('returns failed when landmark evaluation throws', async () => {
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithError());

    const result = await classifyTarget(makeTarget(), makeLandmarks(), 'codex');

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('evaluation error');
  });

  // 9. 非 codex agent 不匹配 codex 特殊路由
  it('does not match codex special routes for non-codex agents', async () => {
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set()));

    const target = makeTarget({
      url: 'app://-/index.html?initialRoute=%2Favatar-overlay',
    });
    // workbuddy 不匹配 codex 的特殊路由
    const result = await classifyTarget(target, makeLandmarks(), 'workbuddy');

    expect(result.status).toBe('failed');
  });

  // 10. session.close() 在 finally 中被调用
  it('closes the session in finally block after classification', async () => {
    const session = makeSessionWithLandmarks(new Set(['main-content', 'composer']));
    vi.mocked(connectCdp).mockResolvedValue(session);

    await classifyTarget(makeTarget(), makeLandmarks(), 'codex');

    expect(session.close).toHaveBeenCalledTimes(1);
  });
});

describe('runPerWindowPreflight', () => {
  // 11. 混合目标正确分类汇总
  it('correctly classifies a mix of targets into primary', async () => {
    const primaryTarget = makeTarget({ id: 'page-main', url: 'app://-/index.html' });
    const skippedTarget = makeTarget({
      id: 'page-overlay',
      url: 'app://-/index.html?initialRoute=%2Favatar-overlay',
    });
    const failedTarget = makeTarget({
      id: 'page-other',
      url: 'app://-/index.html?initialRoute=%2Funknown',
    });

    // All targets get a session that returns passed=true (all landmarks present)
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set(['main-content'])));

    const result = await runPerWindowPreflight(
      [primaryTarget, skippedTarget, failedTarget],
      makeLandmarks(),
      'codex',
    );

    // All three are primary (landmarks are all present in mock session)
    expect(result.primary).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  // 12. 空 targets 数组 → 空结果
  it('returns empty result for empty targets array', async () => {
    const result = await runPerWindowPreflight([], makeLandmarks(), 'codex');

    expect(result.primary).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(connectCdp).not.toHaveBeenCalled();
  });

  // 13. 并行预检互不干扰
  it('runs preflight on all targets in parallel without mutual blocking', async () => {
    const targets = [makeTarget({ id: 't1' }), makeTarget({ id: 't2' }), makeTarget({ id: 't3' })];

    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set(['main-content'])));

    const result = await runPerWindowPreflight(targets, makeLandmarks(), 'codex');

    expect(result.primary).toHaveLength(3);
    expect(connectCdp).toHaveBeenCalledTimes(3);
  });

  // 14. 一个 target 失败不影响其他 target 的分类
  it('isolates failures — one target failure does not affect others', async () => {
    const goodTarget = makeTarget({ id: 'good' });
    const badTarget = makeTarget({ id: 'bad', webSocketDebuggerUrl: '' });

    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set(['main-content'])));

    const result = await runPerWindowPreflight([goodTarget, badTarget], makeLandmarks(), 'codex');

    expect(result.primary).toHaveLength(1);
    expect(result.primary[0].id).toBe('good');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('bad');
  });
});

describe('shouldBlockInjection', () => {
  // 15. 有 primary 时不阻塞
  it('returns false when there are primary targets', () => {
    const result: PerWindowPreflightResult = {
      primary: [makeTarget()],
      skipped: [makeTarget()],
      failed: [makeTarget()],
    };
    expect(shouldBlockInjection(result)).toBe(false);
  });

  // 16. zero primary + 有 failed → 阻塞
  it('returns true when zero primary and at least one failed', () => {
    const result: PerWindowPreflightResult = {
      primary: [],
      skipped: [makeTarget()],
      failed: [makeTarget()],
    };
    expect(shouldBlockInjection(result)).toBe(true);
  });

  // 17. zero primary + zero failed (仅 skipped) → 不阻塞
  it('returns false when zero primary but no failed (only skipped)', () => {
    const result: PerWindowPreflightResult = {
      primary: [],
      skipped: [makeTarget(), makeTarget()],
      failed: [],
    };
    expect(shouldBlockInjection(result)).toBe(false);
  });

  // 18. 全空 → 不阻塞
  it('returns false when all arrays are empty', () => {
    const result: PerWindowPreflightResult = {
      primary: [],
      skipped: [],
      failed: [],
    };
    expect(shouldBlockInjection(result)).toBe(false);
  });
});

describe('special route detection', () => {
  // 19. Codex welcome 路由 → skipped
  it('classifies codex welcome route as skipped', async () => {
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set()));

    const target = makeTarget({
      url: 'app://-/index.html?initialRoute=%2Fwelcome',
    });
    const result = await classifyTarget(target, makeLandmarks(), 'codex');

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('welcome');
  });

  // 20. 非特殊路由的 codex 页面 → failed
  it('classifies codex unknown route as failed', async () => {
    vi.mocked(connectCdp).mockResolvedValue(makeSessionWithLandmarks(new Set()));

    const target = makeTarget({
      url: 'app://-/index.html?initialRoute=%2Fsome-other-route',
    });
    const result = await classifyTarget(target, makeLandmarks(), 'codex');

    expect(result.status).toBe('failed');
  });
});
