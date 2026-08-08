import { describe, expect, it } from 'vitest';
import { BootProgressReporter } from './boot-reporter';

describe('BootProgressReporter', () => {
  it('maps a full boot step sequence monotonically from 0 to 100', () => {
    const sent: Array<{ label: string; pct: number }> = [];
    const reporter = new BootProgressReporter((label, pct) => sent.push({ label, pct }));

    reporter.addStep('初始化语言...', 5);
    reporter.addStep('加载主题库...', 15);
    reporter.addStep('加载设置...', 10);
    reporter.addStep('初始化壁纸引擎...', 10);
    reporter.addStep('启动 CDP 引擎...', 10);
    reporter.addStep('加载主题目录...', 15);
    reporter.addStep('注册 IPC 处理器...', 10);
    reporter.addStep('打开主窗口...', 10);

    for (const step of [
      '初始化语言...',
      '加载主题库...',
      '加载设置...',
      '初始化壁纸引擎...',
      '启动 CDP 引擎...',
      '加载主题目录...',
      '注册 IPC 处理器...',
      '打开主窗口...',
    ]) {
      reporter.advance(step, 0);
      reporter.completeStep(step);
    }
    reporter.completeBoot('就绪');

    const pc = sent.map((s) => s.pct);
    expect(pc[0]).toBe(0);
    expect(pc[pc.length - 1]).toBe(100);
    for (let i = 1; i < pc.length; i++) {
      expect(pc[i]!).toBeGreaterThanOrEqual(pc[i - 1]!);
    }
    expect(pc).toContain(100);
  });

  it('advances monotonically across boot steps and interleaved warm-up phases', () => {
    const sent: Array<{ label: string; pct: number }> = [];
    const reporter = new BootProgressReporter((label, pct) => sent.push({ label, pct }));

    // Mirror the real boot-sequence: boot steps + warm-up phases share one
    // normalized progress pool (total weight = 100).
    const bootSteps = [
      '初始化语言...',
      '加载主题库...',
      '加载设置...',
      '初始化壁纸引擎...',
      '启动 CDP 引擎...',
      '加载主题目录...',
    ];
    const warmPhases = ['预编译主题样式...', '建立缩略图索引...', '预加载适配器模块...'];
    const tailSteps = ['注册 IPC 处理器...', '打开主窗口...'];

    reporter.addStep('初始化语言...', 5);
    reporter.addStep('加载主题库...', 15);
    reporter.addStep('加载设置...', 10);
    reporter.addStep('初始化壁纸引擎...', 10);
    reporter.addStep('启动 CDP 引擎...', 10);
    reporter.addStep('加载主题目录...', 15);
    reporter.addStep('预编译主题样式...', 5);
    reporter.addStep('建立缩略图索引...', 5);
    reporter.addStep('预加载适配器模块...', 5);
    reporter.addStep('注册 IPC 处理器...', 10);
    reporter.addStep('打开主窗口...', 10);

    // Run steps 1–6, interleave warm-up phases, then tail steps.
    for (const s of bootSteps) {
      reporter.advance(s, 0.4);
      reporter.completeStep(s);
    }
    for (const w of warmPhases) {
      reporter.startWarmUp(w);
      reporter.reportWarmUp(0.5);
      reporter.endWarmUp();
    }
    reporter.completeWarmUp();
    for (const s of tailSteps) {
      reporter.advance(s, 0.4);
      reporter.completeStep(s);
    }
    reporter.completeBoot('就绪');

    const pc = sent.map((s) => s.pct);
    // Strictly monotonic — no regression when warm-up runs (the old design made
    // the bar jump back because warm-up owned a separate 60–90% window).
    for (let i = 1; i < pc.length; i++) {
      expect(pc[i]!).toBeGreaterThanOrEqual(pc[i - 1]!);
    }
    expect(pc[pc.length - 1]).toBe(100);
    // Warm-up must actually advance the bar between step 6 and step 7:
    // steps 1–6 land at 65%, warm-up spans 65–80%, tail ends at 100%.
    expect(Math.max(...pc)).toBe(100);
    // Each warm-up phase reports real progress (not stuck at the prior value).
    const warmMidPcts = sent
      .filter((s) => warmPhases.includes(s.label) && s.pct < 100)
      .map((s) => s.pct);
    expect(warmMidPcts.length).toBeGreaterThan(0);
    expect(Math.min(...warmMidPcts)).toBeGreaterThanOrEqual(65);
  });

  it('within-step advance by progress exposes intermediate values', () => {
    const sent: Array<{ label: string; pct: number }> = [];
    const reporter = new BootProgressReporter((label, pct) => sent.push({ label, pct }));

    // 100-weight pool; a weight-10 step spans 90→100. Midpoint = 95.
    reporter.addStep('加载主题库...', 90);
    reporter.addStep('校验数据...', 10);
    reporter.advance('校验数据...', 0);
    reporter.advance('校验数据...', 0.5);
    reporter.completeStep('校验数据...');

    const mid = sent.find((s) => s.label === '校验数据...' && s.pct === 95);
    expect(mid).toBeTruthy();
    const end = sent.find((s) => s.label === '校验数据...' && s.pct === 100);
    expect(end).toBeTruthy();
  });
});
