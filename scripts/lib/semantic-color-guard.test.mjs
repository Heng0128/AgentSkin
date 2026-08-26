// SPDX-License-Identifier: MPL-2.0

/**
 * # semantic-color-guard.test.mjs
 *
 * Unit tests for the semantic color protection rule engine.
 * Covers: isSemanticToken, getSemanticColor, validateSemanticProtection,
 * getDecorableTokens, validateSemanticContrast, classifySemanticRole.
 */

import { describe, expect, it } from 'vitest';
import {
  classifySemanticRole,
  getDecorableTokens,
  getSemanticColor,
  isSemanticToken,
  SEMANTIC_COLORS,
  validateSemanticContrast,
  validateSemanticProtection,
} from './semantic-color-guard.mjs';

// ---------------------------------------------------------------------------
// isSemanticToken
// ---------------------------------------------------------------------------

describe('isSemanticToken', () => {
  it('returns true for bare role names', () => {
    expect(isSemanticToken('success')).toBe(true);
    expect(isSemanticToken('error')).toBe(true);
    expect(isSemanticToken('warning')).toBe(true);
    expect(isSemanticToken('info')).toBe(true);
  });

  it('returns true for CSS custom property names', () => {
    expect(isSemanticToken('--agentskin-success')).toBe(true);
    expect(isSemanticToken('--agentskin-error')).toBe(true);
    expect(isSemanticToken('--agentskin-warning')).toBe(true);
    expect(isSemanticToken('--agentskin-info')).toBe(true);
  });

  it('returns false for non-semantic tokens', () => {
    expect(isSemanticToken('--agentskin-bg')).toBe(false);
    expect(isSemanticToken('--agentskin-accent')).toBe(false);
    expect(isSemanticToken('--agentskin-text')).toBe(false);
    expect(isSemanticToken('--agentskin-surface')).toBe(false);
    expect(isSemanticToken('background')).toBe(false);
    expect(isSemanticToken('')).toBe(false);
  });

  it('returns false for undefined/null-like inputs', () => {
    expect(isSemanticToken('foo')).toBe(false);
    expect(isSemanticToken('--agentskin-unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSemanticColor
// ---------------------------------------------------------------------------

describe('getSemanticColor', () => {
  it('returns canonical light values', () => {
    expect(getSemanticColor('success', 'light')).toBe(SEMANTIC_COLORS.success.light);
    expect(getSemanticColor('error', 'light')).toBe(SEMANTIC_COLORS.error.light);
    expect(getSemanticColor('warning', 'light')).toBe(SEMANTIC_COLORS.warning.light);
    expect(getSemanticColor('info', 'light')).toBe(SEMANTIC_COLORS.info.light);
  });

  it('returns canonical dark values', () => {
    expect(getSemanticColor('success', 'dark')).toBe(SEMANTIC_COLORS.success.dark);
    expect(getSemanticColor('error', 'dark')).toBe(SEMANTIC_COLORS.error.dark);
    expect(getSemanticColor('warning', 'dark')).toBe(SEMANTIC_COLORS.warning.dark);
    expect(getSemanticColor('info', 'dark')).toBe(SEMANTIC_COLORS.info.dark);
  });

  it('works with CSS custom property names', () => {
    expect(getSemanticColor('--agentskin-success', 'light')).toBe('#10b981');
    expect(getSemanticColor('--agentskin-error', 'dark')).toBe('#f87171');
  });

  it('returns null for non-semantic tokens', () => {
    expect(getSemanticColor('--agentskin-bg', 'light')).toBeNull();
    expect(getSemanticColor('background', 'dark')).toBeNull();
    expect(getSemanticColor('unknown', 'light')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateSemanticProtection
// ---------------------------------------------------------------------------

describe('validateSemanticProtection', () => {
  it('passes when no semantic tokens are present', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-bg': '#1a1a2e',
        '--agentskin-text': '#e0e0e0',
        '--agentskin-accent': '#7c9cff',
      },
      'dark',
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes when semantic tokens use canonical values', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-success': '#10b981',
        '--agentskin-error': '#ef4444',
        '--agentskin-warning': '#f59e0b',
        '--agentskin-info': '#3b82f6',
      },
      'light',
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes when semantic tokens are within allowed hue range', () => {
    // A slightly different green for success — still in the green/teal range
    const result = validateSemanticProtection(
      {
        success: '#059669', // darker green, still valid
        error: '#dc2626', // darker red, still valid
      },
      'dark',
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when success token uses a non-green hue', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-success': '#8b5cf6', // purple — wrong for success
      },
      'dark',
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].token).toBe('--agentskin-success');
  });

  it('fails when error token uses a non-red hue', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-error': '#22c55e', // green — wrong for error
      },
      'dark',
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].token).toBe('--agentskin-error');
  });

  it('fails when semantic token is too desaturated', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-success': '#888888', // grey — no semantic meaning
      },
      'dark',
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('reports multiple violations at once', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-success': '#8b5cf6', // purple — wrong
        '--agentskin-error': '#22c55e', // green — wrong
        '--agentskin-warning': '#ef4444', // red — wrong for warning
      },
      'dark',
    );
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  it('includes expected and actual in violation details', () => {
    const result = validateSemanticProtection(
      {
        '--agentskin-info': '#f59e0b', // yellow/orange — wrong for info
      },
      'dark',
    );
    expect(result.violations[0]).toHaveProperty('token');
    expect(result.violations[0]).toHaveProperty('expected');
    expect(result.violations[0]).toHaveProperty('actual');
    expect(result.violations[0].actual).toBe('#f59e0b');
  });
});

// ---------------------------------------------------------------------------
// getDecorableTokens
// ---------------------------------------------------------------------------

describe('getDecorableTokens', () => {
  it('returns an array of token IDs', () => {
    const tokens = getDecorableTokens();
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('does not include semantic tokens', () => {
    const tokens = getDecorableTokens();
    expect(tokens).not.toContain('--agentskin-success');
    expect(tokens).not.toContain('--agentskin-error');
    expect(tokens).not.toContain('--agentskin-warning');
    expect(tokens).not.toContain('--agentskin-info');
  });

  it('includes background and accent tokens', () => {
    const tokens = getDecorableTokens();
    expect(tokens).toContain('--agentskin-bg');
    expect(tokens).toContain('--agentskin-accent');
    expect(tokens).toContain('--agentskin-text');
    expect(tokens).toContain('--agentskin-surface');
  });

  it('returns 12 tokens (14 total minus 2 per-agent derived)', () => {
    expect(getDecorableTokens()).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// validateSemanticContrast
// ---------------------------------------------------------------------------

describe('validateSemanticContrast', () => {
  it('passes for high-contrast semantic color on background', () => {
    const result = validateSemanticContrast('#10b981', '#1a1a2e');
    expect(result.passes).toBe(true);
    expect(result.ratio).toBeGreaterThan(3.0);
  });

  it('fails for low-contrast semantic color on similar background', () => {
    const result = validateSemanticContrast('#34d399', '#a0e0c0');
    // Light green on light mint — should fail (low luminance delta)
    expect(result.passes).toBe(false);
  });

  it('returns a numeric ratio', () => {
    const result = validateSemanticContrast('#ef4444', '#ffffff');
    expect(typeof result.ratio).toBe('number');
    expect(result.ratio).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// classifySemanticRole
// ---------------------------------------------------------------------------

describe('classifySemanticRole', () => {
  it('classifies green as success', () => {
    expect(classifySemanticRole('#10b981')).toBe('success');
    expect(classifySemanticRole('#22c55e')).toBe('success');
  });

  it('classifies red as error', () => {
    expect(classifySemanticRole('#ef4444')).toBe('error');
    expect(classifySemanticRole('#dc2626')).toBe('error');
  });

  it('classifies orange/yellow as warning', () => {
    expect(classifySemanticRole('#f59e0b')).toBe('warning');
    expect(classifySemanticRole('#fbbf24')).toBe('warning');
  });

  it('classifies blue as info', () => {
    expect(classifySemanticRole('#3b82f6')).toBe('info');
    expect(classifySemanticRole('#60a5fa')).toBe('info');
  });

  it('returns null for grey/desaturated colors', () => {
    expect(classifySemanticRole('#888888')).toBeNull();
    expect(classifySemanticRole('#cccccc')).toBeNull();
  });

  it('returns null for near-black and near-white', () => {
    expect(classifySemanticRole('#000000')).toBeNull();
    expect(classifySemanticRole('#ffffff')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SEMANTIC_COLORS constant
// ---------------------------------------------------------------------------

describe('SEMANTIC_COLORS', () => {
  it('has entries for all four roles', () => {
    expect(SEMANTIC_COLORS).toHaveProperty('success');
    expect(SEMANTIC_COLORS).toHaveProperty('error');
    expect(SEMANTIC_COLORS).toHaveProperty('warning');
    expect(SEMANTIC_COLORS).toHaveProperty('info');
  });

  it('each entry has light, dark, and role fields', () => {
    for (const [role, def] of Object.entries(SEMANTIC_COLORS)) {
      expect(def).toHaveProperty('light');
      expect(def).toHaveProperty('dark');
      expect(def.role).toBe(role);
    }
  });

  it('all hex values are valid 6-digit hex', () => {
    for (const def of Object.values(SEMANTIC_COLORS)) {
      expect(def.light).toMatch(/^#[0-9a-f]{6}$/);
      expect(def.dark).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
