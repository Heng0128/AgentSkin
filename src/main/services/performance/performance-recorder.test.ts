// SPDX-License-Identifier: MPL-2.0

/**
 * performance-recorder 并发回归测试（2026-08-17 修复）
 *
 * 背景：PerformanceRecorder 曾假定"apply 全局串行"（模块头注释原话），
 * `start()` 遇已有 trace 直接 throw —— 在多 Agent 并发 apply（MAX_CONCURRENCY=6）
 * 下，后发起的 5 个 apply 在 fastApplyThemeFlow 的 `PerformanceRecorder.start()`
 * 处抛错 → IPC → UI 弹"操作失败"，表现为"一键注入只有第一个生效、并发被取消"。
 *
 * 修复：start() 遇忙返回 no-op 影子 trace，观测层永不打断核心行为。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApplyTraceBuilder, PerformanceRecorder } from './performance-recorder';

describe('PerformanceRecorder.start 并发语义（回归：不得抛错）', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  it('首个 start 返回真实 builder', () => {
    const trace = PerformanceRecorder.start('traework', 'sakura-noir');
    expect(trace).toBeInstanceOf(ApplyTraceBuilder);
    expect(PerformanceRecorder.getActive()).not.toBeNull();
  });

  it('第二个并发 start（不同 agent）返回影子 trace 且不抛错', async () => {
    PerformanceRecorder.start('traework', 'sakura-noir');
    const shadow = PerformanceRecorder.start('codex', 'sakura-noir');

    // 不再 throw；影子 trace 可正常使用
    expect(shadow.traceId.startsWith('shadow-')).toBe(true);

    // step 必须照常执行回调（apply 行为零影响）
    let called = false;
    await shadow.step('resolveTheme', async () => {
      called = true;
    });
    expect(called).toBe(true);

    // finish 返回合法 ThemeApplyTrace，且不释放真实 trace
    const result = shadow.finish();
    expect(result.steps[0].name).toBe('shadowed-concurrent-apply');
    expect(PerformanceRecorder.getActive()).not.toBeNull(); // 真实 trace 仍在
  });

  it('真实 trace finish 释放后，新 start 重新获得真实 builder', () => {
    const first = PerformanceRecorder.start('traework');
    first.finish();
    expect(PerformanceRecorder.getActive()).toBeNull();

    const second = PerformanceRecorder.start('codex');
    expect(second).toBeInstanceOf(ApplyTraceBuilder);
  });
});

describe('ApplyTraceBuilder.step — 成功/失败计时', () => {
  beforeEach(() => {
    PerformanceRecorder.reset();
  });

  afterEach(() => {
    // Defensive: ensure singleton is released even if a test throws before finish().
    PerformanceRecorder.release();
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
    PerformanceRecorder.release();
  });

  it('finish 返回合法 ThemeApplyTrace 并释放 singleton', () => {
    const builder = PerformanceRecorder.start('traework', 'sakura-noir');
    builder.appendStep('connectCdp', 120);
    const trace = builder.finish();
    expect(trace.id).toMatch(/^apply_\d{3}$/);
    expect(trace.agentId).toBe('traework');
    expect(trace.themeId).toBe('sakura-noir');
    expect(trace.steps).toHaveLength(1);
    expect(PerformanceRecorder.getActive()).toBeNull();
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
    PerformanceRecorder.release();
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
