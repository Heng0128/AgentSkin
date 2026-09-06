// SPDX-License-Identifier: MPL-2.0

/**
 * baseline-gate 单测（RFC §6 批 C / Step3）
 *
 * 以下内容从 baseline-manager.ts 的 § baseline-gate 节内联而来，因为这些函数
 * （evaluateReplicationGate / isBaselineFresh / assessBaselineGate 等）仅为测试
 * 调用，无生产消费者。
 *
 * 纯函数部分（assessBaselineGate / isBaselineFresh）直接断言；
 * evaluateReplicationGate 用 mock session 验证异常路径的保守降级。
 */

import { describe, expect, it, vi } from 'vitest';
import { toMessage } from '../../shared/errors';
import type { BaselineCssCapture, FidelityVerdict } from './baseline-capture';
import { validateBaselineCss } from './baseline-capture';
import type { CdpSession } from './cdp-client';

// ===========================================================================
// Inlined gate implementation (test-only, no production consumers)
// ===========================================================================

/** Snapshot freshness window (ms): within this window we skip re-validation. */
const BASELINE_GATE_FRESH_MS = 30 * 60 * 1000;

/** Minimum metadata from a baseline truth snapshot needed for gate decisions. */
interface BaselineTruthMeta {
  appId: string;
  appVersion: string;
  themeMode: 'light' | 'dark';
  capturedAt: number;
  schemaVersion?: number;
}

/** Replication gate verdict. */
type GateVerdict =
  | { gate: 'allow'; reason: 'fresh' | 'replication_ok'; matchRatio?: number }
  | {
      gate: 'degrade';
      reason: 'no_baseline' | 'expired' | 'replication_failed' | 'probe_failed' | 'schema_mismatch';
      message: string;
      matchRatio?: number;
    };

function buildDegradeVerdict(
  reason: Extract<GateVerdict, { gate: 'degrade' }>['reason'],
  message: string,
  matchRatio?: number,
): GateVerdict {
  return { gate: 'degrade', reason, message, matchRatio };
}

/**
 * Determine whether a truth snapshot is within the freshness window (≤ FRESH_MS).
 */
function isBaselineFresh(truth: BaselineTruthMeta | null, now: number): boolean {
  if (!truth) return false;
  if (!Number.isFinite(truth.capturedAt)) return false;
  const age = now - truth.capturedAt;
  if (age < 0) return true;
  return age <= BASELINE_GATE_FRESH_MS;
}

/**
 * Pure gate decision (aligns with RFC Step3 "missing-blocks-load gate").
 */
function assessBaselineGate({
  truth,
  fidelity,
  now,
}: {
  truth: BaselineTruthMeta | null;
  fidelity: FidelityVerdict | null;
  now: number;
}): GateVerdict {
  if (!truth) {
    return buildDegradeVerdict(
      'no_baseline',
      'no baseline truth snapshot for this app/version/theme mode',
    );
  }
  if (truth.schemaVersion !== undefined && truth.schemaVersion !== 1) {
    return buildDegradeVerdict(
      'schema_mismatch',
      `baseline schema mismatch (expected 1, got ${truth.schemaVersion})`,
    );
  }
  if (!isBaselineFresh(truth, now)) {
    return buildDegradeVerdict(
      'expired',
      'baseline truth is stale; recapture before loading custom theme',
    );
  }
  if (!fidelity) {
    return { gate: 'allow', reason: 'fresh' };
  }
  if (fidelity.degraded || !fidelity.pass) {
    return buildDegradeVerdict(
      'replication_failed',
      `baseline replication fidelity ${Math.round(fidelity.matchRatio * 100)}% below gate threshold`,
      fidelity.matchRatio,
    );
  }
  return { gate: 'allow', reason: 'replication_ok', matchRatio: fidelity.matchRatio };
}

/**
 * Orchestrate: perform a real replication check and normalize to FidelityVerdict.
 */
async function evaluateReplicationGate(
  session: CdpSession,
  capture: BaselineCssCapture,
  opts: { minMatchRatio?: number; colorTolerance?: number; severeColorTolerance?: number } = {},
): Promise<FidelityVerdict> {
  try {
    const verdict = await validateBaselineCss(session, capture, opts);
    if (verdict.degraded && verdict.dimensions.length === 0 && !verdict.gateError) {
      return {
        ...verdict,
        gateError: 'baseline replication degraded (internal probe/replay failure)',
      };
    }
    return verdict;
  } catch (error) {
    return {
      pass: false,
      matchRatio: 0,
      degraded: true,
      dimensions: [],
      gateError: toMessage(error),
    };
  }
}

// ===========================================================================
// Tests
// ===========================================================================

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
