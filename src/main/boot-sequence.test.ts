// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for boot-sequence.runStep — focus on the ticker-leak fix:
 * a step whose fn() never settles must still clear its interval.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock electron BEFORE any real import runs. The IPC modules pulled in by
// boot-sequence.ts call app.getPath() at module scope, which crashes in a
// bare node environment. We stub it out so we can unit-test runStep in
// isolation.
vi.mock('electron', () => ({
  app: {
    getName: () => 'AgentSkin',
    getPath: () => '/tmp/agentskin-test',
    getLocale: () => 'en-US',
    isPackaged: false,
    setName: vi.fn(),
    dock: undefined,
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
  },
}));

import { BootProfiler } from './boot-profiler';
import { BootProgressReporter } from './boot-reporter';
import { runStep } from './boot-sequence';

describe('runStep — ticker leak protection', () => {
  let reporter: BootProgressReporter;
  let profiler: BootProfiler;

  beforeEach(() => {
    vi.useFakeTimers();

    const noop = () => {};
    reporter = new BootProgressReporter(noop);
    reporter.addStep('mock-step', 100); // single-step pool so advance() works
    profiler = new BootProfiler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a timeout error when fn() never settles, then clears the ticker', async () => {
    // fn() returns a Promise that never settles — simulating a hung step.
    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));

    // Run the step; it will reject after STEP_TIMEOUT_MS (15s).
    const stepPromise = runStep(reporter, profiler, 'mock-step', 100, fn, 'mock failure');

    // Advance time past the 15s timeout.
    await vi.advanceTimersByTimeAsync(15_000);

    // The step must reject (degrade) — not hang.
    const result = await stepPromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning).toContain('mock failure');
      expect(result.warning).toContain('mock-step');
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearInterval is called after timeout (no ticker leak)', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const fn = vi.fn().mockImplementation(() => new Promise(() => {}));

    const stepPromise = runStep(reporter, profiler, 'mock-step', 100, fn, 'mock failure');

    await vi.advanceTimersByTimeAsync(15_000);
    await stepPromise;

    // clearInterval must have been called — both in catch (explicit) and
    // in finally. At minimum once.
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });
});
