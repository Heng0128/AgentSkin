// SPDX-License-Identifier: MPL-2.0

/**
 * scheme-sync.ts — 隔离单元测试
 *
 * 覆盖三个导出函数的所有关键分支：
 *   syncSchemeToTheme:
 *     S1: withPageSession 抛错 → 吞掉错误 + 记录 best-effort 跳过日志
 *     S2: setSchemeSnapshot 在首次时调用 + persist
 *     S3: getSchemeSnapshot 已存在时跳过 capture
 *
 *   syncSchemeWithStability:
 *     S4: isEpochCurrent=false 立即退出
 *     S5: 调用 initial sync + 5s stability check
 *     S6: 结构化日志 start → done 顺序发射
 *     S7: epoch 变化时中止 stability check
 *
 *   restoreOriginalScheme:
 *     S8: isEpochCurrent=false 立即退出（不做任何事）
 *     S9: 成功路径记录 restore result
 *     S10: 抛错被吞掉 + 记录 best-effort 跳过
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../shared/types';
import type { SchemeSnapshot } from './agent-scheme';
import type { CdpSession } from './cdp/cdp-client';
import {
  restoreOriginalScheme,
  type SchemeSyncDeps,
  syncSchemeToTheme,
  syncSchemeWithStability,
} from './scheme-sync';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';
const VALID_PORT = 9222;
const VALID_SNAPSHOT: SchemeSnapshot = {
  agentId: TEST_APP,
  dataTheme: 'light',
  storage: { 'color-scheme': 'light' },
};

/** 构建可观察的 SchemeSyncDeps mock。 */
function makeDeps(
  overrides: {
    throwOnSession?: boolean;
    isEpochCurrent?: boolean;
    resolvePortResult?: number | null;
  } = {},
): SchemeSyncDeps & {
  _logLines: string[];
  _structuredEvents: { type: string; agentId: AgentId; phase: string; timestamp: string }[];
  _capturedSnapshots: SchemeSnapshot[];
} {
  const {
    throwOnSession = false,
    isEpochCurrent = true,
    resolvePortResult = VALID_PORT,
  } = overrides;

  const logLines: string[] = [];
  const structuredEvents: { type: string; agentId: AgentId; phase: string; timestamp: string }[] =
    [];
  const capturedSnapshots: (SchemeSnapshot | null)[] = [];
  let storedSnapshot: SchemeSnapshot | null = null;

  return {
    withPageSession: async (
      appId: AgentId,
      port: number,
      fn: (session: CdpSession) => Promise<void>,
      _retries?: number,
    ) => {
      if (throwOnSession) throw new Error('CDP unreachable');
      const session = { appId, port } as unknown as CdpSession;
      await fn(session);
    },
    getSchemeSnapshot: () => storedSnapshot,
    setSchemeSnapshot: (snapshot: SchemeSnapshot | null) => {
      storedSnapshot = snapshot;
      capturedSnapshots.push(snapshot);
    },
    persist: vi.fn(),
    isEpochCurrent: () => isEpochCurrent,
    resolveLivePort: async () => resolvePortResult,
    log: (line: string) => logLines.push(line),
    logStructured: (event: { type: string; agentId: AgentId; phase: string; timestamp: string }) =>
      structuredEvents.push(event),
    // Test-only accessors
    _logLines: logLines,
    _structuredEvents: structuredEvents,
    _capturedSnapshots: capturedSnapshots,
  } as unknown as SchemeSyncDeps & {
    _logLines: string[];
    _structuredEvents: { type: string; agentId: AgentId; phase: string; timestamp: string }[];
    _capturedSnapshots: SchemeSnapshot[];
  };
}

// Mock the agent-scheme module so we control captureScheme / applyScheme / restoreScheme
vi.mock('./agent-scheme', () => ({
  captureScheme: vi.fn(async (session: { appId: AgentId }) => {
    // Return a minimal snapshot (in real code this does CDP calls)
    return { agentId: session.appId, dataTheme: 'dark', storage: {} } as SchemeSnapshot;
  }),
  applyScheme: vi.fn(async () => true),
  restoreScheme: vi.fn(async () => true),
}));

// ---------------------------------------------------------------------------
// Tests: syncSchemeToTheme
// ---------------------------------------------------------------------------

describe('syncSchemeToTheme', () => {
  // S1
  it('swallows withPageSession errors and logs best-effort message', async () => {
    const deps = makeDeps({ throwOnSession: true });
    const extra = deps as unknown as { _logLines: string[] };

    // Should NOT throw
    await syncSchemeToTheme(TEST_APP, VALID_PORT, 'dark', deps);

    expect(extra._logLines.some((l) => l.includes('best-effort'))).toBe(true);
  });

  // S2
  it('captures and persists scheme snapshot on first call when none exists', async () => {
    const deps = makeDeps({});
    const extra = deps as unknown as {
      _capturedSnapshots: SchemeSnapshot[];
    };

    await syncSchemeToTheme(TEST_APP, VALID_PORT, 'dark', deps);

    // Called setSchemeSnapshot once (captured fresh snapshot)
    expect(extra._capturedSnapshots).toHaveLength(1);
    // Persisted after capture
    expect(deps.persist).toHaveBeenCalledTimes(1);
  });

  // S3
  it('skips capture when snapshot already exists', async () => {
    // Pre-populate by calling once, then a second time should not re-capture
    const deps = makeDeps({});
    const extra = deps as unknown as {
      _capturedSnapshots: SchemeSnapshot[];
    };

    await syncSchemeToTheme(TEST_APP, VALID_PORT, 'dark', deps);
    expect(extra._capturedSnapshots).toHaveLength(1);

    await syncSchemeToTheme(TEST_APP, VALID_PORT, 'dark', deps);
    // Second call should NOT capture a new snapshot (still 1)
    expect(extra._capturedSnapshots).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: syncSchemeWithStability
// ---------------------------------------------------------------------------

describe('syncSchemeWithStability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // S4
  it('returns immediately when epoch is stale', async () => {
    const deps = makeDeps({ isEpochCurrent: false });
    const extra = deps as unknown as {
      _structuredEvents: { type: string; agentId: AgentId; phase: string; timestamp: string }[];
    };

    const promise = syncSchemeWithStability(TEST_APP, VALID_PORT, 'dark', 1, deps);

    // Should complete immediately (no timers needed)
    await promise;

    // No sync start event emitted
    expect(extra._structuredEvents.filter((e) => e.phase === 'start')).toHaveLength(0);
  });

  // S5 + S6
  it('emits structured log progression and runs stability check', async () => {
    const deps = makeDeps({ throwOnSession: false });
    const extra = deps as unknown as {
      _structuredEvents: { type: string; agentId: AgentId; phase: string; timestamp: string }[];
    };

    const promise = syncSchemeWithStability(TEST_APP, VALID_PORT, 'dark', 1, deps);

    // Advance past the 5s stability window
    await vi.advanceTimersByTimeAsync(6000);

    await promise;

    // start and done events emitted
    const phases = extra._structuredEvents.map((e) => e.phase);
    expect(phases).toContain('start');
    expect(phases).toContain('done');
  });

  // S7
  it('aborts stability check when epoch changed during the 5s wait', async () => {
    let callCount = 0;
    // isEpochCurrent: first call (line 182) passes, second call (line 200) fails → abort
    const dynamicDeps = {
      ...makeDeps({}),
      isEpochCurrent: () => {
        callCount++;
        return callCount <= 1;
      },
    } as unknown as SchemeSyncDeps;
    const extra = dynamicDeps as unknown as {
      _structuredEvents: { type: string; agentId: AgentId; phase: string; timestamp: string }[];
      _logLines: string[];
    };

    const promise = syncSchemeWithStability(TEST_APP, VALID_PORT, 'dark', 1, dynamicDeps);

    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    // Should have logged the epoch-changed abort
    expect(extra._logLines.some((l) => l.includes('epoch changed, aborting'))).toBe(true);
    // 'done' event NOT emitted when aborted
    expect(extra._structuredEvents.filter((e) => e.phase === 'done')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: restoreOriginalScheme
// ---------------------------------------------------------------------------

describe('restoreOriginalScheme', () => {
  // S8
  it('returns immediately when epoch is stale', async () => {
    const deps = makeDeps({ isEpochCurrent: false }) as unknown as SchemeSyncDeps & {
      _logLines: string[];
    };

    await restoreOriginalScheme(TEST_APP, VALID_PORT, VALID_SNAPSHOT, 1, deps);

    // No CDP interaction — log should be empty
    expect(deps._logLines).toHaveLength(0);
  });

  // S9
  it('logs success message when restore succeeds', async () => {
    const deps = makeDeps({}) as unknown as SchemeSyncDeps & {
      _logLines: string[];
    };

    await restoreOriginalScheme(TEST_APP, VALID_PORT, VALID_SNAPSHOT, 1, deps);

    expect(deps._logLines.some((l) => l.includes('original scheme restored'))).toBe(true);
  });

  // S10
  it('swallows errors and logs best-effort message', async () => {
    const deps = makeDeps({ throwOnSession: true }) as unknown as SchemeSyncDeps & {
      _logLines: string[];
    };

    await restoreOriginalScheme(TEST_APP, VALID_PORT, VALID_SNAPSHOT, 1, deps);

    expect(deps._logLines.some((l) => l.includes('best-effort'))).toBe(true);
  });
});
