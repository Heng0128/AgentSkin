// SPDX-License-Identifier: MPL-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BootTiming } from './boot-profiler';
import {
  DEFAULT_STEP_MS,
  estimateStepMs,
  loadBootBaseline,
  saveBootBaseline,
} from './boot-progress';

describe('boot-progress baseline', () => {
  const mkTimings = (labels: Array<[string, number]>): BootTiming[] =>
    labels.map(([label, durationMs]) => ({ label, durationMs }));

  // Use a real temp directory so fs.writeFileSync inside saveBootBaseline succeeds.
  const tmpRoot = path.join(os.tmpdir(), 'agentskin-boot-progress-test');
  beforeAll(() => fs.mkdirSync(tmpRoot, { recursive: true }));

  it('returns the default estimate when no baseline exists', () => {
    expect(estimateStepMs('加载主题库...', {})).toBe(DEFAULT_STEP_MS);
    expect(estimateStepMs('anything', {})).toBe(DEFAULT_STEP_MS);
  });

  it('returns the stored baseline for known steps', () => {
    const baseline = { '加载主题库...': 1200 };
    expect(estimateStepMs('加载主题库...', baseline)).toBe(1200);
  });

  it('load returns an empty record when the file is missing', () => {
    const root = '__nonexistent_boot_progress_root__';
    expect(loadBootBaseline(root)).toEqual({});
  });

  it('save/load round-trips smoothed moving averages', () => {
    const root = tmpRoot;
    // Ensure a clean slate — the temp dir may hold a baseline from a prior run.
    const baselineFile = path.join(root, 'boot-progress.json');
    if (fs.existsSync(baselineFile)) fs.unlinkSync(baselineFile);

    saveBootBaseline(root, mkTimings([['加载主题库...', 1000]]));
    // First run stores the raw value.
    expect(loadBootBaseline(root)['加载主题库...']).toBe(1000);

    // Second run: 50% blend (SMOOTHING=0.5) => (1000+1200)/2 = 1100.
    saveBootBaseline(root, mkTimings([['加载主题库...', 1200]]));
    expect(loadBootBaseline(root)['加载主题库...']).toBe(1100);
  });
});
