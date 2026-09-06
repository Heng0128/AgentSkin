// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootProfiler } from './boot-profiler';

describe('BootProfiler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records per-step durations and reports total', () => {
    const p = new BootProfiler();
    p.begin('加载主题库...');
    p.end();
    p.begin('打开主窗口...');
    p.end();
    expect(p.report()).toMatch(/\[perf\] Boot completed in \d+ms \(2 steps\)/);
    expect(p.report()).toContain('加载主题库...');
    expect(p.report()).toContain('打开主窗口...');
    expect(p.report()).toMatch(/\d+ms/);
  });

  it('returns just the header when no step was timed', () => {
    const p = new BootProfiler();
    expect(p.report()).toMatch(/\[perf\] Boot completed in \d+ms \(0 steps\)/);
  });

  it('ignores end() without a matching begin()', () => {
    const p = new BootProfiler();
    p.end(); // no-op — no current step
    p.begin('初始化语言...');
    p.end();
    expect(p.report()).toContain('1 steps');
  });

  it('replaces an unfinished step when begin is called twice', () => {
    const p = new BootProfiler();
    p.begin('初始化语言...');
    p.begin('加载设置...');
    p.end();
    expect(p.report()).toContain('加载设置...');
    expect(p.report()).not.toContain('初始化语言...');
  });

  it('sorts the report by slowest step first', () => {
    const p = new BootProfiler();
    p.begin('a');
    vi.setSystemTime(Date.now() + 1); // 1ms duration
    p.end();
    p.begin('b');
    vi.setSystemTime(Date.now() + 10); // 10ms duration
    p.end();
    const report = p.report();
    expect(report.indexOf('b')).toBeLessThan(report.indexOf('a'));
  });
});
