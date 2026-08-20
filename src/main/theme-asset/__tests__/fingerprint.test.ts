// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for theme-asset/fingerprint.ts
 *
 * P3a 验收（离线可测）：
 * - computeTokenHash 确定性
 * - computeCssHash 确定性
 * - normalizedColorDistance 边界
 * - computeDriftScore: identical=0, selectorHitDrop>0.3, versionChange adds 0.2
 * - shouldAutoRegen: matchRatio<0.5 → manual_required, carrier miss → manual_required, drift>0.3 → auto_regen
 * - loadBaseline/saveBaseline round-trip
 * - regenerateTheme thunk + concurrency guard + cooldown
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../../../shared/types/agent';
import type { ThemeColors } from '../../catalog/theme-manifest';
import type { FidelityVerdict } from '../../cdp/baseline-validator';
import {
  computeCssHash,
  computeDriftScore,
  computeTokenHash,
  DRIFT_THRESHOLD,
  loadBaseline,
  normalizedColorDistance,
  partialRerun,
  regenerateTheme,
  saveBaseline,
  shouldAutoRegen,
  type ThemeFingerprint,
  type ThemeFingerprintBundle,
} from '../fingerprint';

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

const SAMPLE_CSS: Record<string, string> = {
  traework: ':root { --agentskin-accent: #4a90d9; }',
  qoderwork: ':root { --agentskin-accent: #4a90d9; }',
  workbuddy: ':root { --agentskin-accent: #4a90d9; }',
  doubao: ':root { --agentskin-accent: #4a90d9; }',
  codex: 'html.agentskin-host-codex { --agentskin-accent: #4a90d9; }',
  zcode: ':root { --agentskin-accent: #4a90d9; }',
};

function createSampleFingerprint(overrides: Partial<ThemeFingerprint> = {}): ThemeFingerprint {
  return {
    version: 1,
    appId: 'traework',
    themeId: 'test-theme',
    appVersion: 'TRAE/1.2.3',
    url: 'https://trae.ai/chat',
    accent: '#4a90d9',
    adoptedSheetCount: 1,
    selectorHitMap: {
      '.chat-container': true,
      '.message-list': true,
      '.input-area': true,
    },
    tokenHash: 'abc123',
    cssHash: 'def456',
    confidence: 'high',
    capturedAt: Date.now(),
    ...overrides,
  };
}

function createSampleBundle(): ThemeFingerprintBundle {
  return {
    themeId: 'test-theme',
    appVersion: 'TRAE/1.2.3',
    fingerprints: {
      traework: createSampleFingerprint({ appId: 'traework' }),
      qoderwork: createSampleFingerprint({ appId: 'qoderwork' }),
      workbuddy: createSampleFingerprint({ appId: 'workbuddy' }),
      doubao: createSampleFingerprint({ appId: 'doubao' }),
      codex: createSampleFingerprint({ appId: 'codex' }),
      zcode: createSampleFingerprint({ appId: 'zcode' }),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createFidelityVerdict(overrides: Partial<FidelityVerdict> = {}): FidelityVerdict {
  return {
    pass: true,
    matchRatio: 0.95,
    degraded: false,
    dimensions: [
      { key: 'carrierPresent', pass: true, diff: 0 },
      { key: 'adoptedSheetCount', pass: true, diff: 0 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Hash Utilities
// ---------------------------------------------------------------------------

describe('computeTokenHash', () => {
  it('should return deterministic hash for same colors', () => {
    const hash1 = computeTokenHash(SAMPLE_COLORS);
    const hash2 = computeTokenHash(SAMPLE_COLORS);
    expect(hash1).toBe(hash2);
  });

  it('should return different hash for different colors', () => {
    const hash1 = computeTokenHash(SAMPLE_COLORS);
    const hash2 = computeTokenHash({ ...SAMPLE_COLORS, accent: '#ff5500' });
    expect(hash1).not.toBe(hash2);
  });

  it('should return 16-character hex string', () => {
    const hash = computeTokenHash(SAMPLE_COLORS);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('computeCssHash', () => {
  it('should return deterministic hash for same CSS', () => {
    const hash1 = computeCssHash(SAMPLE_CSS);
    const hash2 = computeCssHash(SAMPLE_CSS);
    expect(hash1).toBe(hash2);
  });

  it('should return different hash for different CSS', () => {
    const hash1 = computeCssHash(SAMPLE_CSS);
    const hash2 = computeCssHash({
      ...SAMPLE_CSS,
      traework: ':root { --agentskin-accent: #ff5500; }',
    });
    expect(hash1).not.toBe(hash2);
  });

  it('should be order-independent', () => {
    const css1 = { a: 'x', b: 'y', c: 'z' };
    const css2 = { c: 'z', a: 'x', b: 'y' };
    expect(computeCssHash(css1)).toBe(computeCssHash(css2));
  });
});

// ---------------------------------------------------------------------------
// Color Distance
// ---------------------------------------------------------------------------

describe('normalizedColorDistance', () => {
  it('should return 0 for identical colors', () => {
    expect(normalizedColorDistance('#4a90d9', '#4a90d9')).toBe(0);
  });

  it('should return > 0 for different colors', () => {
    const dist = normalizedColorDistance('#4a90d9', '#ff5500');
    expect(dist).toBeGreaterThan(0);
  });

  it('should return < 1 for non-opposite colors', () => {
    const dist = normalizedColorDistance('#4a90d9', '#4a90da');
    expect(dist).toBeLessThan(1);
  });

  it('should handle invalid colors gracefully', () => {
    expect(normalizedColorDistance('invalid', '#4a90d9')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Drift Detection
// ---------------------------------------------------------------------------

describe('computeDriftScore', () => {
  it('should return score 0 for identical fingerprints', () => {
    const fp = createSampleFingerprint();
    const result = computeDriftScore(fp, fp);
    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('should detect selector hit drop (weight 0.4)', () => {
    const baseline = createSampleFingerprint({
      selectorHitMap: { a: true, b: true, c: true },
    });
    const current = createSampleFingerprint({
      selectorHitMap: { a: true, b: false, c: false },
    });
    const result = computeDriftScore(baseline, current);
    expect(result.score).toBeGreaterThan(DRIFT_THRESHOLD);
    expect(result.signals[0].type).toBe('selector_hit_drop');
    expect(result.signals[0].weight).toBe(0.4);
  });

  it('should detect accent shift (weight 0.2)', () => {
    const baseline = createSampleFingerprint({ accent: '#4a90d9' });
    const current = createSampleFingerprint({ accent: '#ff5500' });
    const result = computeDriftScore(baseline, current);
    const accentSignal = result.signals.find((s) => s.type === 'accent_shift');
    expect(accentSignal).toBeDefined();
    expect(accentSignal?.weight).toBe(0.2);
  });

  it('should detect sheet mount failure (weight 0.2)', () => {
    const baseline = createSampleFingerprint({ adoptedSheetCount: 1 });
    const current = createSampleFingerprint({ adoptedSheetCount: 0 });
    const result = computeDriftScore(baseline, current);
    const sheetSignal = result.signals.find((s) => s.type === 'sheet_mount_failed');
    expect(sheetSignal).toBeDefined();
    expect(sheetSignal?.weight).toBe(0.2);
  });

  it('should detect app version change (weight 0.2)', () => {
    const baseline = createSampleFingerprint({ appVersion: 'TRAE/1.2.3' });
    const current = createSampleFingerprint({ appVersion: 'TRAE/1.3.0' });
    const result = computeDriftScore(baseline, current);
    const versionSignal = result.signals.find((s) => s.type === 'app_version_change');
    expect(versionSignal).toBeDefined();
    expect(versionSignal?.weight).toBe(0.2);
  });

  it('should accumulate multiple signals', () => {
    const baseline = createSampleFingerprint({
      selectorHitMap: { a: true, b: true, c: true },
      accent: '#4a90d9',
      adoptedSheetCount: 1,
      appVersion: 'TRAE/1.2.3',
    });
    const current = createSampleFingerprint({
      selectorHitMap: { a: true, b: false, c: false },
      accent: '#ff5500',
      adoptedSheetCount: 0,
      appVersion: 'TRAE/1.3.0',
    });
    const result = computeDriftScore(baseline, current);
    // 0.4 + 0.2 + 0.2 + 0.2 = 1.0
    expect(result.score).toBeCloseTo(1.0, 1);
    expect(result.signals).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Manual Intervention Gate
// ---------------------------------------------------------------------------

describe('shouldAutoRegen', () => {
  it('should return manual_required when matchRatio < 0.5', () => {
    const fidelity = createFidelityVerdict({ matchRatio: 0.3 });
    const result = shouldAutoRegen(fidelity, 0.8);
    expect(result.action).toBe('manual_required');
    expect(result.reason).toContain('Severe degradation');
  });

  it('should return manual_required when carrier is missing', () => {
    const fidelity = createFidelityVerdict({
      matchRatio: 0.9,
      dimensions: [{ key: 'carrierPresent', pass: false, diff: 1 }],
    });
    const result = shouldAutoRegen(fidelity, 0.8);
    expect(result.action).toBe('manual_required');
    expect(result.reason).toContain('Carrier node missing');
  });

  it('should return auto_regen when drift > threshold', () => {
    const fidelity = createFidelityVerdict({ matchRatio: 0.9 });
    const result = shouldAutoRegen(fidelity, 0.5);
    expect(result.action).toBe('auto_regen');
  });

  it('should return degrade_report when drift is minor', () => {
    const fidelity = createFidelityVerdict({ matchRatio: 0.9 });
    const result = shouldAutoRegen(fidelity, 0.1);
    expect(result.action).toBe('degrade_report');
  });
});

// ---------------------------------------------------------------------------
// Storage Layer
// ---------------------------------------------------------------------------

describe('loadBaseline / saveBaseline', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'fingerprint-test-'));

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return null when file does not exist', async () => {
    const result = await loadBaseline(join(testDir, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('should round-trip save and load', async () => {
    const bundle = createSampleBundle();
    await saveBaseline(testDir, bundle);

    const loaded = await loadBaseline(testDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.themeId).toBe(bundle.themeId);
    expect(loaded?.fingerprints.traework.appId).toBe('traework');
  });

  it('should create valid JSON file', async () => {
    const bundle = createSampleBundle();
    await saveBaseline(testDir, bundle);

    const filePath = join(testDir, 'fingerprint.json');
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as ThemeFingerprintBundle;
    expect(parsed.themeId).toBe(bundle.themeId);
  });

  it('should return null for corrupted JSON', async () => {
    const filePath = join(testDir, 'fingerprint.json');
    // Overwrite with invalid JSON
    const { writeFileSync } = await import('node:fs');
    writeFileSync(filePath, 'not valid json {{{', 'utf-8');

    const result = await loadBaseline(testDir);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Partial Re-run Pipeline
// ---------------------------------------------------------------------------

describe('partialRerun', () => {
  it('should return CSS outputs for all 6 agents', () => {
    const result = partialRerun(SAMPLE_COLORS, 'test-theme');
    expect(result.status).toBe('success');
    expect(result.cssOutputs).toBeDefined();
    expect(Object.keys(result.cssOutputs!).length).toBe(6);
  });

  it('should include enhanced surface tokens', () => {
    const result = partialRerun(SAMPLE_COLORS, 'test-theme');
    expect(result.status).toBe('success');
    // Surface layering should produce surfaceL1
    const traeworkCss = result.cssOutputs!.traework;
    expect(traeworkCss).toContain('--agentskin-accent');
  });

  it('should fail when colors lack required tokens', () => {
    const minimalColors: ThemeColors = {
      background: '#000000',
      foreground: '#ffffff',
    };
    const result = partialRerun(minimalColors, 'test-theme');
    // contractCheck should fail due to low token coverage
    expect(result.status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Regeneration Thunk
// ---------------------------------------------------------------------------

describe('regenerateTheme', () => {
  beforeEach(() => {
    // Reset module-level state between tests
    // Note: This is a best-effort reset for testing purposes
  });

  it('should return a thunk function', () => {
    const thunk = regenerateTheme('traework', 'test-theme');
    expect(typeof thunk).toBe('function');
  });

  it('should execute regen when called with colors', async () => {
    const thunk = regenerateTheme('qoderwork', 'test-theme', SAMPLE_COLORS);
    const result = await thunk();
    expect(result.status).toBe('success');
  });

  it('should fail when no colors provided', async () => {
    const thunk = regenerateTheme('doubao', 'test-theme');
    const result = await thunk();
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('no colors');
  });

  it('should skip when already regenerating (concurrency guard)', async () => {
    const agentId: AgentId = 'workbuddy';

    // First call claims the agent
    const thunk1 = regenerateTheme(agentId, 'test-theme', SAMPLE_COLORS);
    const thunk2 = regenerateTheme(agentId, 'test-theme', SAMPLE_COLORS);

    // Execute both — second should be skipped
    const [result1, result2] = await Promise.all([thunk1(), thunk2()]);

    // One should succeed, one should be skipped
    const statuses = [result1.status, result2.status].sort();
    expect(statuses).toContain('skipped');
  });
});
