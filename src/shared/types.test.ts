// SPDX-License-Identifier: MPL-2.0

/**
 * # Type Contract — Serialization Round-Trip
 *
 * Structural assertions for core interfaces that flow across IPC boundaries
 * or get persisted to disk. Each test constructs a representative instance,
 * serializes via JSON.stringify → JSON.parse, and asserts deep equality.
 *
 * These tests guard against silent shape drift: if a field is renamed,
 * removed, or its type changes in a way that breaks JSON round-tripping,
 * these assertions fail before the regression reaches production.
 */

import { describe, expect, it } from 'vitest';
import type { ConcurrencyMetrics } from './concurrency';
import type { DriftStatus } from './drift-status';
import type { HealthCheckReport } from './health-check';

// ---------------------------------------------------------------------------
// ConcurrencyMetrics
// ---------------------------------------------------------------------------

describe('ConcurrencyMetrics — serialization round-trip', () => {
  it('preserves all numeric fields through JSON.stringify → parse', () => {
    const metrics: ConcurrencyMetrics = {
      companionBusyByAgent: 2,
      inflightOperations: 3,
      selfHealingAgents: 1,
      capturedTokens: 14,
      persistChainDepth: 0,
      deferredSelfHeals: 0,
      switchEpochByAgent: 1,
      persistFailures: 0,
    };
    const roundTripped = JSON.parse(JSON.stringify(metrics)) as ConcurrencyMetrics;
    expect(roundTripped).toEqual(metrics);
  });
});

// ---------------------------------------------------------------------------
// DriftStatus
// ---------------------------------------------------------------------------

describe('DriftStatus — serialization round-trip', () => {
  it('preserves nested signals and lastRegenResult through JSON.stringify → parse', () => {
    const status: DriftStatus = {
      agentId: 'traework',
      themeId: 'sakura-noir',
      driftScore: 0.42,
      signals: [
        {
          type: 'accent_shift',
          weight: 0.3,
          detail: 'accent shifted from #ff0000 to #cc0000',
        },
      ],
      lastRegenResult: {
        status: 'success',
        timestamp: 1700000000000,
        reason: 'drift exceeded threshold',
      },
      lastCaptureAt: 1700000000000,
      confidence: 'high',
    };
    const roundTripped = JSON.parse(JSON.stringify(status)) as DriftStatus;
    expect(roundTripped).toEqual(status);
  });

  it('handles null lastRegenResult', () => {
    const status: DriftStatus = {
      agentId: 'codex',
      themeId: 'ocean-dark',
      driftScore: 0.0,
      signals: [],
      lastRegenResult: null,
      lastCaptureAt: 0,
      confidence: 'low',
    };
    const roundTripped = JSON.parse(JSON.stringify(status)) as DriftStatus;
    expect(roundTripped).toEqual(status);
  });
});

// ---------------------------------------------------------------------------
// HealthCheckReport
// ---------------------------------------------------------------------------

describe('HealthCheckReport — serialization round-trip', () => {
  it('preserves nested arrays through JSON.stringify → parse', () => {
    const report: HealthCheckReport = {
      agentId: 'traework',
      timestamp: 1700000000000,
      heroArtActive: true,
      themeSheetPresent: true,
      accentToken: '#ff5500',
      hostClassPresent: true,
      adapterPresent: true,
      nativeTokens: { '--dbx-bg-body-web': '#ffffff' },
      overriddenVariables: [
        { name: '--agentskin-accent', declared: '#ff5500', computed: '#cc4400' },
      ],
      opaqueLayers: [
        {
          depth: 1,
          tagName: 'DIV',
          id: 'root',
          classes: 'app-container',
          semanticAttr: '',
          backgroundColor: '#1a1a1a',
          backgroundImage: 'none',
          size: '1920x1080',
          visible: true,
          backdropFilter: 'none',
        },
      ],
      blockingCount: 1,
      score: 85,
    };
    const roundTripped = JSON.parse(JSON.stringify(report)) as HealthCheckReport;
    expect(roundTripped).toEqual(report);
  });
});
