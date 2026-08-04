// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEAL_WINDOW_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_HEALS_PER_WINDOW,
  ThemeWatchdog,
  type WatchdogDeps,
} from './theme-watchdog';

function makeDeps(overrides: Partial<WatchdogDeps> = {}): WatchdogDeps & {
  states: ReturnType<ThemeWatchdog['getState']>[];
} {
  const states: ReturnType<ThemeWatchdog['getState']>[] = [];
  return {
    isThemeActive: () => true,
    probe: async () => true,
    heal: async () => undefined,
    onState: (s) => states.push(s),
    log: () => undefined,
    ...overrides,
    states,
  };
}

describe('ThemeWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports healthy when the probe passes', async () => {
    const deps = makeDeps({ probe: async () => true });
    const wd = new ThemeWatchdog('traework', deps, 1000);
    const state = await wd.checkNow();
    expect(state.status).toBe('healthy');
    expect(state.consecutiveFailures).toBe(0);
  });

  it('self-heals on a failed probe and returns to healthy', async () => {
    const heal = vi.fn(async () => undefined);
    const deps = makeDeps({ probe: async () => false, heal });
    const wd = new ThemeWatchdog('traework', deps, 1000);
    const state = await wd.checkNow();
    expect(heal).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('healthy');
    expect(state.healsInWindow).toBe(1);
  });

  it('degrades when heals keep failing (consecutive failures accumulate)', async () => {
    // probe 持续不健康 + heal 持续失败 → consecutiveFailures 累积到阈值 → degraded。
    const heal = vi.fn(async () => {
      throw new Error('heal failed');
    });
    const deps = makeDeps({ probe: async () => false, heal });
    const wd = new ThemeWatchdog('traework', deps, 1000);

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES - 1; i++) {
      const state = await wd.checkNow();
      expect(state.status).toBe('self-healing'); // 还在尝试
    }
    const final = await wd.checkNow();
    expect(final.status).toBe('degraded'); // 达到连续失败阈值
    // 最后一次不再尝试 heal。
    expect(heal).toHaveBeenCalledTimes(MAX_CONSECUTIVE_FAILURES - 1);
  });

  it('caps heals per rolling hour (≤ MAX_HEALS_PER_WINDOW)', async () => {
    const heal = vi.fn(async () => undefined);
    let healthy = true;
    const deps = makeDeps({
      probe: async () => healthy,
      heal,
    });
    const wd = new ThemeWatchdog('traework', deps, 1000);

    // 耗光窗口内自愈额度：失败→heal→healthy 交替 MAX 次。
    for (let i = 0; i < MAX_HEALS_PER_WINDOW; i++) {
      healthy = false;
      await wd.checkNow();
      healthy = true;
      await wd.checkNow();
    }
    expect(wd.getState().healsInWindow).toBe(MAX_HEALS_PER_WINDOW);

    // 预算耗尽后下一次失败 → degraded，不再 heal。
    healthy = false;
    const state = await wd.checkNow();
    expect(state.status).toBe('degraded');
    expect(heal).toHaveBeenCalledTimes(MAX_HEALS_PER_WINDOW);
  });

  it('resets the heal window after HEAL_WINDOW_MS elapses', async () => {
    const heal = vi.fn(async () => undefined);
    let healthy = true;
    const deps = makeDeps({ probe: async () => healthy, heal });
    const wd = new ThemeWatchdog('traework', deps, 1000);

    // 耗光窗口内自愈额度。
    for (let i = 0; i < MAX_HEALS_PER_WINDOW; i++) {
      healthy = false;
      await wd.checkNow();
      healthy = true;
      await wd.checkNow();
    }
    expect(wd.getState().healsInWindow).toBe(MAX_HEALS_PER_WINDOW);

    // 窗口过期 → 计数清零，可再次自愈。
    await vi.advanceTimersByTimeAsync(HEAL_WINDOW_MS + 1);
    healthy = false;
    const state = await wd.checkNow();
    expect(state.healsInWindow).toBe(1);
    expect(heal).toHaveBeenCalledTimes(MAX_HEALS_PER_WINDOW + 1);
  });

  it('skips probing when the theme is not active', async () => {
    const probe = vi.fn(async () => false);
    const deps = makeDeps({ isThemeActive: () => false, probe });
    const wd = new ThemeWatchdog('traework', deps, 1000);
    const state = await wd.checkNow();
    expect(probe).not.toHaveBeenCalled();
    expect(state.status).toBe('healthy');
  });

  it('start() schedules periodic checks and stop() clears them', async () => {
    const probe = vi.fn(async () => true);
    const deps = makeDeps({ probe });
    const wd = new ThemeWatchdog('traework', deps, 1000);
    wd.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).toHaveBeenCalledTimes(3); // t=1000/2000/3000
    wd.stop();
    const before = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe.mock.calls.length).toBe(before);
  });

  it('emits state to the onState callback', async () => {
    const deps = makeDeps({ probe: async () => false, heal: async () => undefined });
    const wd = new ThemeWatchdog('traework', deps, 1000);
    await wd.checkNow();
    expect(deps.states.length).toBeGreaterThanOrEqual(2); // self-healing → healthy
    expect(deps.states.at(-1)?.status).toBe('healthy');
  });
});
