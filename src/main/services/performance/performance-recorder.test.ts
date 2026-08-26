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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
