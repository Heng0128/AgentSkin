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

import { beforeEach, describe, expect, it } from 'vitest';
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
