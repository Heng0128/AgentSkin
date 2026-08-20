// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for theme-asset/deferred-regen.ts
 *
 * Validates the deferred regen coordinator:
 * - Immediate dispatch when not applying
 * - Deferred dispatch when applying (with backoff)
 * - Queue size telemetry
 * - Clear function
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../../../shared/types/agent';
import type { ThemeColors } from '../../catalog/theme-manifest';
import type { FidelityVerdict } from '../../cdp/baseline-validator';
import {
  clearDeferredRegens,
  getDeferredRegensSize,
  scheduleDeferredRegen,
} from '../deferred-regen';
import { partialRerun } from '../fingerprint';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_COLORS: ThemeColors = {
  background: '#1a1a2e',
  foreground: '#eaeaea',
  accent: '#4a90d9',
  secondary: '#6c757d',
  muted: '#495057',
  surface: '#212529',
  surfaceElevated: '#343a40',
  border: '#3d4450',
  codeBackground: '#1e1e2e',
  codeForeground: '#cdd6f4',
  inputBackground: '#2a2b3d',
  buttonBackground: '#4a90d9',
  buttonForeground: '#ffffff',
  focusRing: '#89b4fa',
};

const _SAMPLE_FIDELITY: FidelityVerdict = {
  pass: true,
  matchRatio: 0.95,
  degraded: false,
  dimensions: [
    { key: 'carrierPresent', pass: true, diff: 0 },
    { key: 'adoptedSheetCount', pass: true, diff: 0 },
  ],
};

// ---------------------------------------------------------------------------
// scheduleDeferredRegen
// ---------------------------------------------------------------------------

describe('scheduleDeferredRegen', () => {
  afterEach(() => {
    clearDeferredRegens();
  });

  it('should dispatch immediately when not applying', async () => {
    const dispatchSpy = vi.fn().mockResolvedValue({ status: 'success' });

    scheduleDeferredRegen(
      'traework',
      'test-theme',
      dispatchSpy,
      () => false, // not applying
    );

    // Should be dispatched immediately (microtask)
    await new Promise((r) => setTimeout(r, 10));
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('should defer when applying', () => {
    scheduleDeferredRegen(
      'traework',
      'test-theme',
      vi.fn().mockResolvedValue({ status: 'success' }),
      () => true, // applying
    );

    expect(getDeferredRegensSize()).toBe(1);
  });

  it('should clear queue', () => {
    scheduleDeferredRegen(
      'traework',
      'test-theme',
      vi.fn().mockResolvedValue({ status: 'success' }),
      () => true,
    );
    scheduleDeferredRegen(
      'qoderwork',
      'test-theme',
      vi.fn().mockResolvedValue({ status: 'success' }),
      () => true,
    );

    expect(getDeferredRegensSize()).toBe(2);

    clearDeferredRegens();
    expect(getDeferredRegensSize()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// partialRerun (integration with deferred-regen)
// ---------------------------------------------------------------------------

describe('partialRerun integration', () => {
  it('should produce valid CSS that can be used by regen', () => {
    const result = partialRerun(SAMPLE_COLORS, 'test-theme');
    expect(result.status).toBe('success');
    expect(result.cssOutputs).toBeDefined();

    // Verify all 6 agents have CSS
    const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
    for (const agent of agents) {
      expect(result.cssOutputs![agent as AgentId]).toBeDefined();
      expect(result.cssOutputs![agent as AgentId].length).toBeGreaterThan(0);
    }
  });
});
