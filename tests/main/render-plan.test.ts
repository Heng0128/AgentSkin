// SPDX-License-Identifier: MIT
//
// # render-plan.test.ts — unit tests for the RenderPlan semantic IR.
//
// Validates the three public exports:
//   - createRenderPlan: resolves version-aware plans for every agent.
//   - renderPlanToCSS: turns a plan + manifest into a valid CSS string.
//   - validateRenderPlan: structural correctness checks.

import { describe, expect, it } from 'vitest';
import {
  AGENT_IDS,
  createRenderPlan,
  renderPlanToCSS,
  validateRenderPlan,
} from '../../scripts/lib/render-plan.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal but valid dark-theme manifest colours. */
const DARK_COLORS = {
  accent: '#4a90d9',
  secondary: '#7a8a99',
  background: '#1e1e1e',
  foreground: '#e0e0e0',
  muted: '#888888',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  inputBackground: '#2a2a2a',
  buttonBackground: '#4a90d918',
  buttonForeground: '#4a90d9',
  focusRing: '#4a90d966',
} as const;

const DARK_MANIFEST = { mode: 'dark', isLight: false, colors: DARK_COLORS } as const;

const LIGHT_MANIFEST = {
  mode: 'light',
  isLight: true,
  colors: { ...DARK_COLORS, background: '#f5f5f5', foreground: '#1a1a1a', muted: '#6b6b6b' },
} as const;

// ---------------------------------------------------------------------------
// createRenderPlan
// ---------------------------------------------------------------------------

describe('createRenderPlan', () => {
  it('produces a structurally complete plan for every supported agent', () => {
    for (const agentId of AGENT_IDS) {
      const plan = createRenderPlan(agentId, '1.0.0', DARK_MANIFEST);
      expect(plan.agentId).toBe(agentId);
      expect(plan.version).toBeTypeOf('string');
      expect(plan.version.length).toBeGreaterThan(0);
      expect(plan.compatibility).toBeTypeOf('object');
      expect(plan.strategy).toBeTypeOf('object');
    }
  });

  it('resolves traework <2.5 to a plan without backdrop-filter or focus-ring', () => {
    const plan = createRenderPlan('traework', '2.4.0', DARK_MANIFEST);
    expect(plan.version).toBe('<2.5');
    expect(plan.compatibility.backdropFilterSupported).toBe(false);
    expect(plan.compatibility.focusRingAvailable).toBe(false);
    expect(plan.strategy.backgroundMode).toBe('overlay');
  });

  it('resolves traework 2.5+ to a plan with backdrop-filter and direct mode', () => {
    const plan = createRenderPlan('traework', '2.5.1', DARK_MANIFEST);
    expect(plan.version).toBe('2.5+');
    expect(plan.compatibility.backdropFilterSupported).toBe(true);
    expect(plan.compatibility.focusRingAvailable).toBe(true);
    expect(plan.strategy.backgroundMode).toBe('direct');
  });

  it('resolves codex 2026.8+ with focus-ring available', () => {
    const plan = createRenderPlan('codex', '2026.8.3', DARK_MANIFEST);
    expect(plan.version).toBe('2026.8+');
    expect(plan.compatibility.focusRingAvailable).toBe(true);
  });

  it('resolves codex 2026.7.x without focus-ring (legacy selector support)', () => {
    const plan = createRenderPlan('codex', '2026.7.5', DARK_MANIFEST);
    expect(plan.version).toBe('2026.7+');
    expect(plan.compatibility.focusRingAvailable).toBe(false);
  });

  it('resolves doubao "latest" to the latest descriptor', () => {
    const plan = createRenderPlan('doubao', 'latest', DARK_MANIFEST);
    expect(plan.version).toBe('latest');
    expect(plan.compatibility.backdropFilterSupported).toBe(true);
  });

  it('includes all 14 agent tokens in the plan tokenMapping', () => {
    const plan = createRenderPlan('zcode', '1.0.0', DARK_MANIFEST);
    const keys = Object.keys(plan.strategy.tokenMapping);
    expect(keys).toContain('--agentskin-accent');
    expect(keys).toContain('--agentskin-bg');
    expect(keys).toContain('--agentskin-surface');
    expect(keys).toContain('--agentskin-text');
    expect(keys).toContain('--agentskin-focus-ring');
    expect(keys.length).toBeGreaterThanOrEqual(14);
  });

  it('attaches non-empty criticalSelectors for every agent', () => {
    for (const agentId of AGENT_IDS) {
      const plan = createRenderPlan(agentId, '1.0.0', DARK_MANIFEST);
      expect(Array.isArray(plan.strategy.criticalSelectors)).toBe(true);
      expect(plan.strategy.criticalSelectors.length).toBeGreaterThan(0);
    }
  });

  it('throws on an unknown agentId', () => {
    expect(() => createRenderPlan('unknown-app', '1.0.0', DARK_MANIFEST)).toThrow(
      /unknown agentId/,
    );
  });

  it('throws on an empty detectedVersion', () => {
    expect(() => createRenderPlan('codex', '', DARK_MANIFEST)).toThrow(/non-empty string/);
  });

  it('throws when themeManifest is null', () => {
    expect(() => createRenderPlan('codex', '1.0.0', null as unknown as object)).toThrow(
      /must be an object/,
    );
  });
});

// ---------------------------------------------------------------------------
// renderPlanToCSS
// ---------------------------------------------------------------------------

describe('renderPlanToCSS', () => {
  it('produces a string that contains valid CSS declaration blocks', () => {
    const plan = createRenderPlan('qoderwork', '1.0.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    expect(css).toBeTypeOf('string');
    expect(css.length).toBeGreaterThan(100);
    // Must contain balanced braces.
    const opens = (css.match(/{/g) ?? []).length;
    const closes = (css.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(0);
  });

  it('includes the 14 agentskin tokens in the output', () => {
    const plan = createRenderPlan('workbuddy', '1.0.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    expect(css).toContain('--agentskin-accent');
    expect(css).toContain('--agentskin-bg');
    expect(css).toContain('--agentskin-surface');
    expect(css).toContain('--agentskin-text');
    expect(css).toContain('--agentskin-border');
    expect(css).toContain('--agentskin-focus-ring');
  });

  it('honours backgroundMode=overlay (no backdrop-filter: blur) for old traework', () => {
    const plan = createRenderPlan('traework', '2.4.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    expect(plan.strategy.backgroundMode).toBe('overlay');
    expect(css).not.toContain('backdrop-filter');
  });

  it('emits backdrop-filter for backgroundMode=direct', () => {
    const plan = createRenderPlan('zcode', '1.0.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    expect(plan.strategy.backgroundMode).toBe('direct');
    expect(css).toContain('backdrop-filter');
  });

  it('omits the focus-ring block when the engine does not support it', () => {
    const plan = createRenderPlan('traework', '2.4.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    expect(plan.compatibility.focusRingAvailable).toBe(false);
    expect(css).not.toContain(':focus-visible');
  });

  it('respects the light/dark mode flag in color-scheme', () => {
    const darkPlan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    const darkCss = renderPlanToCSS(darkPlan, DARK_MANIFEST);
    expect(darkCss).toContain('color-scheme: dark');

    const lightPlan = createRenderPlan('codex', '2026.8.0', LIGHT_MANIFEST);
    const lightCss = renderPlanToCSS(lightPlan, LIGHT_MANIFEST);
    expect(lightCss).toContain('color-scheme: light');
  });

  it('contains the critical selectors in the generated CSS', () => {
    const plan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    for (const sel of plan.strategy.criticalSelectors) {
      // The host-scoped selectors appear after the host prefix — strip the
      // host prefix from the selector body to test for the class portion.
      expect(css).toContain(sel);
    }
  });

  it('uses the native-variable bridge for the target agent', () => {
    const plan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    const css = renderPlanToCSS(plan, DARK_MANIFEST);
    // Codex maps to --color-token-* namespace.
    expect(css).toContain('--color-token-primary');
    expect(css).toContain('--color-token-bg-primary');
  });
});

// ---------------------------------------------------------------------------
// validateRenderPlan
// ---------------------------------------------------------------------------

describe('validateRenderPlan', () => {
  it('returns valid=true for a well-formed plan', () => {
    const plan = createRenderPlan('doubao', 'latest', DARK_MANIFEST);
    const result = validateRenderPlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a plan with an invalid agentId', () => {
    const plan = { ...createRenderPlan('codex', '2026.8.0', DARK_MANIFEST), agentId: 'nope' };
    const result = validateRenderPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('agentId'))).toBe(true);
  });

  it('rejects a plan with a non-boolean compatibility field', () => {
    const plan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    plan.compatibility = {
      ...plan.compatibility,
      backdropFilterSupported: 'yes' as unknown as boolean,
    };
    const result = validateRenderPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('backdropFilterSupported'))).toBe(true);
  });

  it('rejects a plan with an invalid backgroundMode', () => {
    const plan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    plan.strategy = { ...plan.strategy, backgroundMode: 'wipe' as string };
    const result = validateRenderPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('backgroundMode'))).toBe(true);
  });

  it('rejects a plan with incomplete tokenMapping', () => {
    const plan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    const mapping = { ...plan.strategy.tokenMapping };
    delete mapping['--agentskin-accent'];
    plan.strategy = { ...plan.strategy, tokenMapping: mapping };
    const result = validateRenderPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--agentskin-accent'))).toBe(true);
  });

  it('flags nativeThemeSupport=true as a warning-only condition', () => {
    const plan = createRenderPlan('codex', '2026.8.0', DARK_MANIFEST);
    plan.compatibility = { ...plan.compatibility, nativeThemeSupport: true };
    const result = validateRenderPlan(plan);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('nativeThemeSupport'))).toBe(true);
  });
});
