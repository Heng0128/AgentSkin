// SPDX-License-Identifier: MPL-2.0

/**
 * baseline-gate.ts 单测（RFC §6 批 C / Step3）
 *
 * 纯函数部分（assessBaselineGate / isBaselineFresh）直接断言；
 * evaluateReplicationGate 用 mock session 验证异常路径的保守降级。
 */

import { describe, expect, it, vi } from 'vitest';
import type { BaselineCssCapture } from './baseline-css-capture';
import {
  assessBaselineGate,
  BASELINE_GATE_FRESH_MS,
  type BaselineTruthMeta,
  evaluateReplicationGate,
  isBaselineFresh,
} from './baseline-gate';
import type { CdpSession } from './cdp-client';

const NOW = 1_700_000_000_000;

type TruthOverrides = {
  appId?: string;
  appVersion?: string;
  themeMode?: 'light' | 'dark';
  capturedAt?: number;
  schemaVersion?: number;
};

function makeTruth(overrides: TruthOverrides = {}): BaselineTruthMeta {
  return {
    appId: 'codex',
    appVersion: '2.10.0',
    themeMode: 'dark' as const,
    capturedAt: NOW,
    schemaVersion: 1,
    ...overrides,
  };
}

function makeCapture(): BaselineCssCapture {
  return {
    appId: 'codex',
    url: 'https://app.codex/',
    stylesheets: [],
    varDependencies: [],
    jsFrozen: true,
    complete: true,
    capturedAt: NOW,
  };
}

function makeFidelity(pass: boolean, degraded: boolean, matchRatio: number) {
  return { pass, matchRatio, degraded, dimensions: [] };
}

describe('isBaselineFresh', () => {
  it('null truth is not fresh', () => {
    expect(isBaselineFresh(null, NOW)).toBe(false);
  });

  it('is fresh within the freshness window', () => {
    expect(isBaselineFresh(makeTruth(), NOW)).toBe(true);
    expect(isBaselineFresh(makeTruth({ capturedAt: NOW - BASELINE_GATE_FRESH_MS }), NOW)).toBe(
      true,
    );
  });

  it('is stale beyond the freshness window', () => {
    expect(isBaselineFresh(makeTruth({ capturedAt: NOW - BASELINE_GATE_FRESH_MS - 1 }), NOW)).toBe(
      false,
    );
    expect(isBaselineFresh(makeTruth({ capturedAt: Number.NaN }), NOW)).toBe(false);
  });
});

describe('assessBaselineGate', () => {
  it('forbids loading when no baseline truth exists', () => {
    const verdict = assessBaselineGate({ truth: null, fidelity: null, now: NOW });
    expect(verdict.gate).toBe('degrade');
    if (verdict.gate === 'degrade') expect(verdict.reason).toBe('no_baseline');
  });

  it('forbids on schema mismatch', () => {
    const verdict = assessBaselineGate({
      truth: makeTruth({ schemaVersion: 2 }),
      fidelity: null,
      now: NOW,
    });
    expect(verdict.gate).toBe('degrade');
    if (verdict.gate === 'degrade') expect(verdict.reason).toBe('schema_mismatch');
  });

  it('forbids on expired baseline', () => {
    const verdict = assessBaselineGate({
      truth: makeTruth({ capturedAt: NOW - BASELINE_GATE_FRESH_MS - 1 }),
      fidelity: makeFidelity(true, false, 0.9),
      now: NOW,
    });
    expect(verdict.gate).toBe('degrade');
    if (verdict.gate === 'degrade') expect(verdict.reason).toBe('expired');
  });

  it('allows on fresh baseline without re-verification', () => {
    const verdict = assessBaselineGate({ truth: makeTruth(), fidelity: null, now: NOW });
    expect(verdict).toEqual({ gate: 'allow', reason: 'fresh' });
  });

  it('forbids when replication fidelity fails', () => {
    const verdict = assessBaselineGate({
      truth: makeTruth(),
      fidelity: makeFidelity(false, true, 0.4),
      now: NOW,
    });
    expect(verdict.gate).toBe('degrade');
    if (verdict.gate === 'degrade') {
      expect(verdict.reason).toBe('replication_failed');
      expect(verdict.matchRatio).toBe(0.4);
    }
  });

  it('allows when replication passes', () => {
    const verdict = assessBaselineGate({
      truth: makeTruth(),
      fidelity: makeFidelity(true, false, 0.96),
      now: NOW,
    });
    expect(verdict).toEqual({ gate: 'allow', reason: 'replication_ok', matchRatio: 0.96 });
  });
});

describe('evaluateReplicationGate', () => {
  it('forbids conservatively when the replication probe throws', async () => {
    const session = {
      evaluate: vi.fn().mockRejectedValue(new Error('cdp down')),
      send: vi.fn(),
      close: () => {},
    } as unknown as CdpSession;
    const verdict = await evaluateReplicationGate(session, makeCapture());
    expect(verdict.pass).toBe(false);
    expect(verdict.degraded).toBe(true);
    expect(typeof verdict.gateError).toBe('string');
  });
});
