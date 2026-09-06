// SPDX-License-Identifier: MPL-2.0

/**
 * performance-recorder 并发回归测试（RC2-A 更新）
 *
 * 背景：PerformanceRecorder 曾使用单迹模型（static active），并发 apply
 * 时返回 ShadowTrace。RC2-A 改为 per-agent Map，每个 agent 可有独立 trace。
 *
 * 新行为：
 *   - start() 始终返回 ApplyTraceBuilder（不再有 ShadowTrace）
 *   - 同 agent 并发 start() 返回未注册的 builder（release 为 no-op）
 *   - 不同 agent 并发 start() 各自获得独立注册的 builder
 *   - getActive(agentId) 返回指定 agent 的 trace
 *   - release(agentId, builder) 仅当 builder 是已注册的才释放
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplyTraceBuilder, PerformanceRecorder } from './performance-recorder';

describe('PerformanceRecorder.start — per-agent 并发语义', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  it('首个 start 返回真实 builder 并注册到 map', () => {
    const trace = PerformanceRecorder.start('traework', 'sakura-noir');
    expect(trace).toBeInstanceOf(ApplyTraceBuilder);
    expect(PerformanceRecorder.getActive('traework')).toBe(trace);
  });

  it('不同 agent 并发 start 各自获得独立注册的 builder', async () => {
    const first = PerformanceRecorder.start('traework', 'sakura-noir');
    const second = PerformanceRecorder.start('codex', 'sakura-noir');

    // 两个都是真实 builder，各自注册
    expect(first).toBeInstanceOf(ApplyTraceBuilder);
    expect(second).toBeInstanceOf(ApplyTraceBuilder);
    expect(PerformanceRecorder.getActive('traework')).toBe(first);
    expect(PerformanceRecorder.getActive('codex')).toBe(second);

    // step 正常执行
    let called = false;
    await second.step('resolveTheme', async () => {
      called = true;
    });
    expect(called).toBe(true);

    // finish 返回合法 ThemeApplyTrace
    const result = second.finish();
    expect(result.agentId).toBe('codex');
    expect(PerformanceRecorder.getActive('codex')).toBeNull();
    // 第一个 agent 的 trace 不受影响
    expect(PerformanceRecorder.getActive('traework')).toBe(first);
  });

  it('同 agent 并发 start 返回未注册的 builder（release 为 no-op）', () => {
    const first = PerformanceRecorder.start('traework', 'sakura-noir');
    const second = PerformanceRecorder.start('traework', 'other-theme');

    // 第二个 builder 未注册
    expect(PerformanceRecorder.getActive('traework')).toBe(first);
    expect(second).not.toBe(first);

    // 第二个 builder 的 finish 不会释放第一个
    second.finish();
    expect(PerformanceRecorder.getActive('traework')).toBe(first);
  });

  it('真实 trace finish 释放后，新 start 重新获得真实 builder', () => {
    const first = PerformanceRecorder.start('traework');
    first.finish();
    expect(PerformanceRecorder.getActive('traework')).toBeNull();

    const second = PerformanceRecorder.start('traework');
    expect(second).toBeInstanceOf(ApplyTraceBuilder);
    expect(PerformanceRecorder.getActive('traework')).toBe(second);
  });
});

describe('ApplyTraceBuilder.step — 成功/失败计时', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  afterEach(() => {
    // Defensive: ensure all traces are released even if a test throws.
    PerformanceRecorder.reset();
  });

  it('成功 step 记录 success=true 且 duration >= 0', async () => {
    const builder = PerformanceRecorder.start('traework');
    await builder.step('phase1', async () => 'result');
    const trace = builder.finish();
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].name).toBe('phase1');
    expect(trace.steps[0].success).toBe(true);
    expect(trace.steps[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('失败 step 记录 success=false + error 并重新抛出', async () => {
    const builder = PerformanceRecorder.start('traework');
    await expect(
      builder.step('failing', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const trace = builder.finish();
    expect(trace.steps[0].success).toBe(false);
    expect(trace.steps[0].error).toBe('boom');
    expect(trace.success).toBe(false);
    expect(trace.error).toBe('boom');
  });

  it('已 finalized 的 trace 调用 step 抛出', async () => {
    const builder = PerformanceRecorder.start('traework');
    builder.finish();
    await expect(builder.step('too-late', async () => {})).rejects.toThrow(/already finalized/);
  });
});

describe('ApplyTraceBuilder.finish — 终结化守卫', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  afterEach(() => {
    PerformanceRecorder.reset();
  });

  it('finish 返回合法 ThemeApplyTrace 并释放 agent slot', () => {
    const builder = PerformanceRecorder.start('traework', 'sakura-noir');
    builder.appendStep('connectCdp', 120);
    const trace = builder.finish();
    expect(trace.id).toMatch(/^apply_\d{3}$/);
    expect(trace.agentId).toBe('traework');
    expect(trace.themeId).toBe('sakura-noir');
    expect(trace.steps).toHaveLength(1);
    expect(PerformanceRecorder.getActive('traework')).toBeNull();
  });

  it('finishedAt 与 duration 使用统一时钟源', () => {
    const builder = PerformanceRecorder.start('traework');
    const trace = builder.finish();
    // finishedAt 是 number（epoch ms），duration 是 number
    expect(typeof trace.finishedAt).toBe('number');
    expect(typeof trace.duration).toBe('number');
    expect(trace.finishedAt).toBeGreaterThan(0);
    expect(trace.duration).toBeGreaterThanOrEqual(0);
  });

  it('REQ-G-005: 满足 trace 不变量 finishedAt === startedAt + duration（严格相等，无容差）', () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    const builder = PerformanceRecorder.start('traework');
    // 执行至少一个 step 以产生非零 duration
    builder.appendStep('connectCdp', 120);
    // 向前推进一段时间
    vi.setSystemTime(startTime + 250);
    const trace = builder.finish();
    // 等式严格相等（无容差）
    expect(trace.finishedAt).toBe(trace.startedAt + trace.duration);
    expect(trace.duration).toBe(trace.finishedAt - trace.startedAt);
    vi.useRealTimers();
  });

  it('重复 finish 抛出', () => {
    const builder = PerformanceRecorder.start('traework');
    builder.finish();
    expect(() => builder.finish()).toThrow(/already been finalized/);
  });
});

describe('ApplyTraceBuilder.addSubStep / appendStep', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  afterEach(() => {
    PerformanceRecorder.reset();
  });

  it('appendStep 添加顶层 step 并在 finish 后保留', () => {
    const builder = PerformanceRecorder.start('traework');
    builder.appendStep('connectCdp', 150);
    builder.appendStep('injectTheme', 300, false, 'timeout');
    const trace = builder.finish();
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0].name).toBe('connectCdp');
    expect(trace.steps[0].duration).toBe(150);
    expect(trace.steps[1].success).toBe(false);
    expect(trace.steps[1].error).toBe('timeout');
  });

  it('addSubStep 在 finish 时附加到 parent step 的 children', async () => {
    const builder = PerformanceRecorder.start('traework');
    await builder.step('parent', async (addSubStep) => {
      addSubStep('child-a', 50);
      addSubStep('child-b', 70);
    });
    const trace = builder.finish();
    // parent + 2 children interleaved
    expect(trace.steps).toHaveLength(3);
    expect(trace.steps[0].name).toBe('parent');
    expect(trace.steps[0].children).toHaveLength(2);
    expect(trace.steps[1].name).toBe('child-a');
    expect(trace.steps[2].name).toBe('child-b');
  });

  it('已 finalized 的 trace 调用 appendStep 抛出', () => {
    const builder = PerformanceRecorder.start('traework');
    builder.finish();
    expect(() => builder.appendStep('late', 10)).toThrow(/already finalized/);
  });
});

// ---------------------------------------------------------------------------
// RC5-B: Concurrent trace data integrity across per-agent map
// ---------------------------------------------------------------------------

describe('PerformanceRecorder — concurrent trace data integrity (RC5-B)', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  afterEach(() => {
    PerformanceRecorder.reset();
  });

  it('maintains isolated traces for 3 agents under concurrent apply', async () => {
    const builderA = PerformanceRecorder.start('traework', 'theme-alpha');
    const builderB = PerformanceRecorder.start('codex', 'theme-beta');
    const builderC = PerformanceRecorder.start('doubao', 'theme-gamma');

    // Concurrent steps across agents — each builder is independent.
    await Promise.all([
      builderA.step('resolveTheme', async () => 'alpha'),
      builderB.step('resolveTheme', async () => 'beta'),
      builderC.step('resolveTheme', async () => 'gamma'),
    ]);

    // recordNamedStep must land in the correct agent's trace.
    PerformanceRecorder.recordNamedStep('traework', 'connectCdp', 100);
    PerformanceRecorder.recordNamedStep('codex', 'connectCdp', 200);
    PerformanceRecorder.recordNamedStep('doubao', 'connectCdp', 300);

    // recordNamedStep for an unknown agent is a no-op (no crash).
    PerformanceRecorder.recordNamedStep('unknown-agent', 'connectCdp', 999);

    const traceA = builderA.finish();
    const traceB = builderB.finish();
    const traceC = builderC.finish();

    // Each trace has exactly 2 steps: resolveTheme + connectCdp.
    expect(traceA.steps).toHaveLength(2);
    expect(traceB.steps).toHaveLength(2);
    expect(traceC.steps).toHaveLength(2);

    // Verify the correct recordNamedStep duration landed in each trace.
    const cdpA = traceA.steps.find((s) => s.name === 'connectCdp');
    expect(cdpA?.duration).toBe(100);
    const cdpB = traceB.steps.find((s) => s.name === 'connectCdp');
    expect(cdpB?.duration).toBe(200);
    const cdpC = traceC.steps.find((s) => s.name === 'connectCdp');
    expect(cdpC?.duration).toBe(300);

    // resolveStep belongs to its own agent.
    const resolveA = traceA.steps.find((s) => s.name === 'resolveTheme');
    expect(resolveA?.success).toBe(true);

    // All agent slots released.
    expect(PerformanceRecorder.getActive('traework')).toBeNull();
    expect(PerformanceRecorder.getActive('codex')).toBeNull();
    expect(PerformanceRecorder.getActive('doubao')).toBeNull();
  });

  it('REQ-G-011: recordNamedStep 传入 undefined agentId 应安全 no-op', () => {
    // 无活跃 trace 时调用
    PerformanceRecorder.recordNamedStep(undefined, 'connectCdp', 100);
    // 断言不创建 trace（map 为空）
    expect(PerformanceRecorder.getActive(undefined)).toBeNull();
    expect(PerformanceRecorder.getActive('traework')).toBeNull();
  });

  it('REQ-G-011: recordNamedStep 传入无活跃 trace 的 agentId 应安全 no-op', () => {
    // 调用不存在活跃 trace 的 agentId
    PerformanceRecorder.recordNamedStep('no-such-agent', 'connectCdp', 100);
    // 断言不创建 trace
    expect(PerformanceRecorder.getActive('no-such-agent')).toBeNull();
  });

  it('isolates steps when concurrent applies hit the same agent', async () => {
    // First apply locks the agent.
    const first = PerformanceRecorder.start('traework', 'theme-1');
    // Second apply to same agent gets an unregistered builder.
    const second = PerformanceRecorder.start('traework', 'theme-2');

    await first.step('resolveTheme', async () => 'first');
    await second.step('resolveTheme', async () => 'second');

    // recordNamedStep lands only in the registered trace.
    PerformanceRecorder.recordNamedStep('traework', 'connectCdp', 150);

    const traceFirst = first.finish();
    const traceSecond = second.finish();

    // Only the registered trace has the connectCdp step.
    expect(traceFirst.steps.find((s) => s.name === 'connectCdp')?.duration).toBe(150);
    expect(traceSecond.steps.find((s) => s.name === 'connectCdp')).toBeUndefined();

    // Second builder's release was a no-op — first already released the slot.
    expect(PerformanceRecorder.getActive('traework')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RC-2: Stale entry cleanup (prevents memory leaks from unfinished traces)
// ---------------------------------------------------------------------------

describe('PerformanceRecorder — stale entry cleanup (RC-2)', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    PerformanceRecorder.reset();
  });

  it('removes stale entries after STALE_THRESHOLD_MS (5 min)', () => {
    // Start a trace but never finish it (simulating a crash)
    const startTime = Date.now();
    const stale = PerformanceRecorder.start('traework', 'stale-theme');
    expect(PerformanceRecorder.getActive('traework')).toBe(stale);

    // Advance time by 6 minutes (beyond the 5-minute stale threshold)
    vi.setSystemTime(startTime + 6 * 60 * 1000);

    // Start a new trace for a different agent — triggers cleanup
    PerformanceRecorder.start('codex', 'fresh-theme');

    // The stale entry should have been cleaned up
    expect(PerformanceRecorder.getActive('traework')).toBeNull();
  });

  it('does not remove fresh entries (within stale threshold)', () => {
    const startTime = Date.now();
    const fresh = PerformanceRecorder.start('traework', 'fresh-theme');
    expect(PerformanceRecorder.getActive('traework')).toBe(fresh);

    // Advance time by only 4 minutes (within the 5-minute threshold)
    vi.setSystemTime(startTime + 4 * 60 * 1000);

    // Start a new trace — triggers cleanup scan
    PerformanceRecorder.start('codex', 'other-theme');

    // The fresh entry should still be present
    expect(PerformanceRecorder.getActive('traework')).toBe(fresh);
  });

  it('REQ-G-008: 恰好处于 STALE_THRESHOLD_MS (300000ms) 边界的 entry 应保留', () => {
    const startTime = Date.now();
    const borderline = PerformanceRecorder.start('traework', 'borderline-theme');
    expect(PerformanceRecorder.getActive('traework')).toBe(borderline);

    // 推进到恰好 5 分钟（now - lastActive === threshold，不满足 >）
    vi.setSystemTime(startTime + 5 * 60 * 1000);

    // 触发 cleanup
    PerformanceRecorder.start('codex', 'fresh-theme');

    // 恰好等于阈值时不满足 > 条件，应保留
    expect(PerformanceRecorder.getActive('traework')).toBe(borderline);
  });

  it('REQ-G-008: 超过 STALE_THRESHOLD_MS 1ms 的 entry 应被清除', () => {
    const startTime = Date.now();
    const stale = PerformanceRecorder.start('traework', 'stale-theme');
    expect(PerformanceRecorder.getActive('traework')).toBe(stale);

    // 推进到 5 分钟 + 1ms（now - lastActive > threshold）
    vi.setSystemTime(startTime + 5 * 60 * 1000 + 1);

    // 触发 cleanup
    PerformanceRecorder.start('codex', 'fresh-theme');

    // 超过阈值 1ms，应被清除
    expect(PerformanceRecorder.getActive('traework')).toBeNull();
  });

  it('cleanup is throttled by CLEANUP_INTERVAL_MS (30s)', () => {
    const startTime = Date.now();

    // Start a stale trace
    PerformanceRecorder.start('traework', 'stale-theme');

    // Advance 6 minutes — first cleanup scan
    vi.setSystemTime(startTime + 6 * 60 * 1000);
    PerformanceRecorder.start('codex', 'fresh-theme');
    expect(PerformanceRecorder.getActive('traework')).toBeNull();

    // Start another stale trace (cleanup was just done, lastCleanupAt = startTime + 6min)
    const stale2 = PerformanceRecorder.start('doubao', 'stale-theme-2');
    expect(PerformanceRecorder.getActive('doubao')).toBe(stale2);

    // Advance only 10s — less than the 30s cleanup interval → throttled
    vi.setSystemTime(startTime + 6 * 60 * 1000 + 10 * 1000);
    PerformanceRecorder.start('workbuddy', 'fresh-theme-2');

    // The stale entry should still be present (cleanup throttled)
    expect(PerformanceRecorder.getActive('doubao')).toBe(stale2);

    // Now advance enough time for 'doubao' to become stale (5 min) AND pass the 30s throttle
    // 'doubao' was created at startTime + 6min, so it becomes stale at startTime + 11min
    // The last cleanup was at startTime + 6min, so throttle expires at startTime + 6min + 30s
    // We need: now > startTime + 11min (stale) AND now > startTime + 6min + 30s (throttle)
    vi.setSystemTime(startTime + 11 * 60 * 1000 + 1); // 11min + 1ms
    PerformanceRecorder.start('qoderwork', 'fresh-theme-3');

    // Now the stale entry should be cleaned up
    expect(PerformanceRecorder.getActive('doubao')).toBeNull();
  });
});
