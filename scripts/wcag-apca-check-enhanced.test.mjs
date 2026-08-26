// SPDX-License-Identifier: MPL-2.0

/**
 * # wcag-apca-check-enhanced.test.mjs
 *
 * Unit tests for the enhanced contrast checking functions:
 * checkContrast (single pair) and checkThemeContrastBatch (full theme).
 * Also validates that existing exports remain backward-compatible.
 */

import { describe, expect, it } from 'vitest';
import {
  apcaContrast,
  assertContrast,
  autoOnColor,
  checkContrast,
  checkExtendedContrast,
  checkThemeContrast,
  checkThemeContrastBatch,
  formatContrastReport,
} from './wcag-apca-check.mjs';

// ---------------------------------------------------------------------------
// checkContrast — single pair
// ---------------------------------------------------------------------------

describe('checkContrast', () => {
  it('returns ratio, passesAA, passesAAA, passesAPCA', () => {
    const result = checkContrast('#ffffff', '#000000');
    expect(result).toHaveProperty('ratio');
    expect(result).toHaveProperty('passesAA');
    expect(result).toHaveProperty('passesAAA');
    expect(result).toHaveProperty('passesAPCA');
  });

  it('reports maximum contrast for black on white', () => {
    const result = checkContrast('#ffffff', '#000000');
    expect(result.ratio).toBe(21);
    expect(result.passesAA).toBe(true);
    expect(result.passesAAA).toBe(true);
    expect(result.passesAPCA).toBe(true);
  });

  it('reports minimum contrast for identical colors', () => {
    const result = checkContrast('#888888', '#888888');
    expect(result.ratio).toBe(1);
    expect(result.passesAA).toBe(false);
    expect(result.passesAAA).toBe(false);
    expect(result.passesAPCA).toBe(false);
  });

  it('fails AA for low-contrast pair', () => {
    const result = checkContrast('#777777', '#888888');
    expect(result.passesAA).toBe(false);
    expect(result.ratio).toBeLessThan(4.5);
  });

  it('passes AA but fails AAA for mid-contrast pair', () => {
    // #555555 on #ffffff ≈ 7.4:1 — passes both AA and AAA
    // Use a pair that passes AA but not AAA: e.g. #767676 on #fff ≈ 4.5:1
    const result = checkContrast('#767676', '#ffffff');
    expect(result.passesAA).toBe(true);
    // This pair is right at the AA boundary; verify ratio is in expected range
    expect(result.ratio).toBeGreaterThanOrEqual(4.4);
    expect(result.ratio).toBeLessThan(7.0);
  });

  it('is order-independent (fg/bg swap gives same ratio)', () => {
    const a = checkContrast('#ffffff', '#000000');
    const b = checkContrast('#000000', '#ffffff');
    expect(a.ratio).toBe(b.ratio);
    expect(a.passesAA).toBe(b.passesAA);
  });

  it('handles dark theme typical pair (light text on dark bg)', () => {
    const result = checkContrast('#e0e0e0', '#1a1a2e');
    expect(result.passesAA).toBe(true);
    expect(result.ratio).toBeGreaterThan(4.5);
  });
});

// ---------------------------------------------------------------------------
// checkThemeContrastBatch — full theme
// ---------------------------------------------------------------------------

describe('checkThemeContrastBatch', () => {
  const darkTheme = {
    '--agentskin-bg': '#1a1a2e',
    '--agentskin-surface': '#252540',
    '--agentskin-surface-elevated': '#2f2f50',
    '--agentskin-text': '#e8e8f0',
    '--agentskin-muted': '#b0b0c0',
    '--agentskin-accent': '#8aafff',
    '--agentskin-secondary': '#b0a0ff',
    '--agentskin-border': '#5a5a78',
    '--agentskin-code-bg': '#12121e',
    '--agentskin-code-fg': '#d0d8e8',
    '--agentskin-focus-ring': '#8aafff',
    '--agentskin-selection': '#4a4a70',
    '--agentskin-button-bg': '#4a4a6a',
    '--agentskin-input-bg': '#252540',
    '--agentskin-success': '#34d399',
    '--agentskin-error': '#f87171',
    '--agentskin-warning': '#fbbf24',
    '--agentskin-info': '#60a5fa',
  };

  it('returns results array and allPassAA flag', () => {
    const result = checkThemeContrastBatch(darkTheme, 'dark');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('allPassAA');
    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.allPassAA).toBe('boolean');
  });

  it('checks multiple fg/bg pairs', () => {
    const result = checkThemeContrastBatch(darkTheme, 'dark');
    // With 6 bg tokens and 10 fg tokens, we should have many pairs
    expect(result.results.length).toBeGreaterThan(10);
  });

  it('reports AA status for a typical dark theme', () => {
    const result = checkThemeContrastBatch(darkTheme, 'dark');
    // A typical dark theme may not pass ALL pairs (e.g. border on surface)
    // but the function should correctly report the status
    expect(typeof result.allPassAA).toBe('boolean');
    // At least the primary text/bg pair should pass
    const primary = result.results.find(
      (r) => r.fg === '--agentskin-text' && r.bg === '--agentskin-bg',
    );
    expect(primary).toBeDefined();
    expect(primary.level).toBe('AAA');
  });

  it('allPassAA is false when a pair fails', () => {
    const badTheme = {
      ...darkTheme,
      '--agentskin-text': '#2a2a3a', // nearly same as background
    };
    const result = checkThemeContrastBatch(badTheme, 'dark');
    expect(result.allPassAA).toBe(false);
  });

  it('each result has fg, bg, ratio, and level', () => {
    const result = checkThemeContrastBatch(darkTheme, 'dark');
    for (const r of result.results) {
      expect(r).toHaveProperty('fg');
      expect(r).toHaveProperty('bg');
      expect(r).toHaveProperty('ratio');
      expect(r).toHaveProperty('level');
      expect(['AAA', 'AA', 'fail']).toContain(r.level);
    }
  });

  it('level is AAA when ratio >= 7.0', () => {
    const result = checkThemeContrastBatch(darkTheme, 'dark');
    const textOnBg = result.results.find(
      (r) => r.fg === '--agentskin-text' && r.bg === '--agentskin-bg',
    );
    expect(textOnBg).toBeDefined();
    expect(textOnBg.level).toBe('AAA');
  });

  it('handles empty token map gracefully', () => {
    const result = checkThemeContrastBatch({}, 'dark');
    expect(result.results).toHaveLength(0);
    expect(result.allPassAA).toBe(true); // no failures = vacuously true
  });

  it('handles partial token map (only bg and text)', () => {
    const minimal = {
      '--agentskin-bg': '#1a1a2e',
      '--agentskin-text': '#e0e0e0',
    };
    const result = checkThemeContrastBatch(minimal, 'dark');
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.allPassAA).toBe(true);
  });

  it('checks semantic colors against backgrounds', () => {
    const result = checkThemeContrastBatch(darkTheme, 'dark');
    const successOnBg = result.results.find(
      (r) => r.fg === '--agentskin-success' && r.bg === '--agentskin-bg',
    );
    expect(successOnBg).toBeDefined();
    expect(successOnBg.ratio).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility — existing exports still work
// ---------------------------------------------------------------------------

describe('backward compatibility', () => {
  it('checkThemeContrast still works with manifest-shaped input', () => {
    const manifest = {
      colors: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        _wcag: { level: 'AA' },
      },
    };
    const result = checkThemeContrast(manifest);
    expect(result).not.toBeNull();
    expect(result.wcag.passesAA).toBe(true);
  });

  it('checkExtendedContrast still works', () => {
    const manifest = {
      colors: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        extended: {
          error: '#ef4444',
          success: '#22c55e',
        },
      },
    };
    const result = checkExtendedContrast(manifest);
    expect(result).toHaveLength(2);
  });

  it('assertContrast still throws on failure', () => {
    const manifest = {
      colors: {
        background: '#888888',
        foreground: '#999999',
        _wcag: { level: 'AA' },
      },
    };
    expect(() => assertContrast(manifest)).toThrow();
  });

  it('formatContrastReport still works', () => {
    const manifest = {
      colors: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        _wcag: { level: 'AA' },
      },
    };
    const result = checkThemeContrast(manifest);
    const report = formatContrastReport(result);
    expect(typeof report).toBe('string');
    expect(report).toContain('WCAG');
  });

  it('apcaContrast and autoOnColor are re-exported', () => {
    expect(typeof apcaContrast).toBe('function');
    expect(typeof autoOnColor).toBe('function');
    expect(autoOnColor('#ffffff')).toBe('#000000');
    expect(autoOnColor('#000000')).toBe('#ffffff');
  });
});
