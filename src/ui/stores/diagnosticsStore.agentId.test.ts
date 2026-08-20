// SPDX-License-Identifier: MPL-2.0

/**
 * # diagnosticsStore agentId partitioning tests
 *
 * Verifies that healthReportByAgent correctly isolates reports per agentId,
 * switching agents does not cross-contaminate, and last-writer-wins per agent.
 */

import type { HealthCheckReport } from '@shared/types/health-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    getPerformanceTimeouts: vi.fn(),
    clearPerformanceTimeouts: vi.fn(),
  },
}));

import { useDiagnosticsStore } from './diagnosticsStore';

/** Build a minimal HealthCheckReport for a given agentId. */
function makeReport(agentId: string, score = 100): HealthCheckReport {
  return {
    agentId,
    timestamp: Date.now(),
    heroArtActive: true,
    themeSheetPresent: true,
    accentToken: '#4a90d9',
    hostClassPresent: true,
    adapterPresent: true,
    nativeTokens: {},
    overriddenVariables: [],
    opaqueLayers: [],
    blockingCount: 0,
    score,
  };
}

describe('diagnosticsStore — healthReportByAgent agentId partitioning', () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({
      healthReportByAgent: {},
    });
  });

  it('returns null for an agentId with no report', () => {
    const { healthReportByAgent } = useDiagnosticsStore.getState();
    expect(healthReportByAgent.traework).toBeUndefined();
  });

  it('stores and retrieves report for a single agent', () => {
    const report = makeReport('traework', 88);
    useDiagnosticsStore.getState().setHealthReport(report);

    const { healthReportByAgent } = useDiagnosticsStore.getState();
    expect(healthReportByAgent.traework?.score).toBe(88);
    expect(Object.keys(healthReportByAgent)).toHaveLength(1);
  });

  it('keeps reports for different agents independent (no cross-contamination)', () => {
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 90));
    useDiagnosticsStore.getState().setHealthReport(makeReport('doubao', 60));
    useDiagnosticsStore.getState().setHealthReport(makeReport('codex', 75));

    const { healthReportByAgent } = useDiagnosticsStore.getState();
    expect(Object.keys(healthReportByAgent).sort()).toEqual(['codex', 'doubao', 'traework']);
    expect(healthReportByAgent.traework?.score).toBe(90);
    expect(healthReportByAgent.doubao?.score).toBe(60);
    expect(healthReportByAgent.codex?.score).toBe(75);
  });

  it('does not overwrite other agents when one agent report is updated', () => {
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 90));
    useDiagnosticsStore.getState().setHealthReport(makeReport('doubao', 60));

    // Update traework only
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 95));

    const { healthReportByAgent } = useDiagnosticsStore.getState();
    expect(healthReportByAgent.traework?.score).toBe(95);
    expect(healthReportByAgent.doubao?.score).toBe(60); // unchanged
  });

  it('last writer wins for the same agentId', () => {
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 70));
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 85));
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 92));

    const { healthReportByAgent } = useDiagnosticsStore.getState();
    expect(healthReportByAgent.traework?.score).toBe(92);
    expect(Object.keys(healthReportByAgent)).toHaveLength(1);
  });

  it('simulates apply doubao then apply traework scenario (the original bug)', () => {
    // Bug scenario: applying doubao first, then traework
    // Previously, a single healthReport slot meant traework overwrote doubao
    useDiagnosticsStore.getState().setHealthReport(makeReport('doubao', 55));
    useDiagnosticsStore.getState().setHealthReport(makeReport('traework', 99));

    const { healthReportByAgent } = useDiagnosticsStore.getState();
    // Both should be retained, not just traework
    expect(healthReportByAgent.doubao?.score).toBe(55);
    expect(healthReportByAgent.traework?.score).toBe(99);
  });
});
