// SPDX-License-Identifier: MPL-2.0

import type { ThemeVisualSnapshot } from '@shared/types';
import { describe, expect, it } from 'vitest';
import {
  buildSkinTokens,
  buildStudioPalette,
  hexMix,
  lumOf,
  mergeOverridesToSkinTokens,
  toRgba,
} from './palette';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSnapshot(over: Partial<ThemeVisualSnapshot> = {}): ThemeVisualSnapshot {
  return {
    themeId: 'test',
    themeName: 'Test Theme',
    agentId: 'traework',
    timestamp: '2026-01-01T00:00:00Z',
    landmarks: [],
    summary: {
      totalLandmarks: 0,
      visibleLandmarks: 0,
      selectorsTried: 0,
      boxModelAvailable: false,
      cascadeAvailable: false,
    },
    ...over,
  };
}

function snapshotWithRoot(styles: Array<{ property: string; value: string }>): ThemeVisualSnapshot {
  return makeSnapshot({
    landmarks: [
      {
        selector: ':root',
        tag: 'html',
        visible: true,
        styles,
        matchedRules: [],
        platformFonts: [],
        boxModel: null,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// hexMix — mix hex colors A and B by t
// ---------------------------------------------------------------------------

describe('hexMix', () => {
  it('returns color A when t = 0', () => {
    expect(hexMix('#000000', '#ffffff', 0)).toBe('#000000');
  });

  it('returns color B when t = 1', () => {
    expect(hexMix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('mixes 50% between black and white as gray', () => {
    expect(hexMix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('mixes primary colors correctly', () => {
    //red (#ff0000) + blue (#0000ff) at 50% → purple (#800080)
    expect(hexMix('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });

  it('handles lowercase hex', () => {
    expect(hexMix('#ff0000', '#00ff00', 0.5)).toBe('#808000');
  });
});

// ---------------------------------------------------------------------------
// toRgba — hex → rgba() string
// ---------------------------------------------------------------------------

describe('toRgba', () => {
  it('converts #ff0000 to rgba(255, 0, 0, 1)', () => {
    expect(toRgba('#ff0000', 1)).toBe('rgba(255, 0, 0, 1)');
  });

  it('converts #00ff00 with alpha 0.5', () => {
    expect(toRgba('#00ff00', 0.5)).toBe('rgba(0, 255, 0, 0.5)');
  });

  it('handles 3-digit hex shorthand', () => {
    expect(toRgba('#f00', 0.8)).toBe('rgba(255, 0, 0, 0.8)');
  });

  it('passes through alpha value as-is', () => {
    expect(toRgba('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(toRgba('#ffffff', 0.99)).toBe('rgba(255, 255, 255, 0.99)');
  });
});

// ---------------------------------------------------------------------------
// lumOf — perceptual lightness estimate
// ---------------------------------------------------------------------------

describe('lumOf', () => {
  it('returns high value for white', () => {
    expect(lumOf('#ffffff')).toBeGreaterThan(0.9);
  });

  it('returns low value for black', () => {
    expect(lumOf('#000000')).toBeLessThan(0.1);
  });

  it('returns mid-range for medium gray', () => {
    const lum = lumOf('#808080');
    expect(lum).toBeGreaterThan(0.3);
    expect(lum).toBeLessThan(0.7);
  });

  it('white is lighter than black', () => {
    expect(lumOf('#ffffff')).toBeGreaterThan(lumOf('#000000'));
  });

  it('handles lowercase hex', () => {
    expect(lumOf('#ffffff')).toBe(lumOf('#FFFFFF'));
  });
});

// ---------------------------------------------------------------------------
// buildSkinTokens — token math from bg/fg/accent
// ---------------------------------------------------------------------------

describe('buildSkinTokens', () => {
  it('produces all 14 required --agentskin-* keys', () => {
    const tokens = buildSkinTokens({ bg: '#ffffff', fg: '#000000', accent: '#3b82f6' });
    const keys = Object.keys(tokens);
    expect(keys).toContain('--agentskin-accent');
    expect(keys).toContain('--agentskin-bg');
    expect(keys).toContain('--agentskin-surface');
    expect(keys).toContain('--agentskin-text');
    expect(keys).toContain('--agentskin-muted');
    expect(keys).toContain('--agentskin-border');
    expect(keys).toContain('--agentskin-code-bg');
    expect(keys).toContain('--agentskin-input-bg');
    expect(keys).toContain('--agentskin-button-bg');
    expect(keys).toContain('--agentskin-focus-ring');
    expect(keys).toContain('--agentskin-selection');
    expect(keys.length).toBe(14);
  });

  it('accent is passed through directly for light mode', () => {
    const tokens = buildSkinTokens({ bg: '#ffffff', fg: '#000000', accent: '#ff5500' });
    expect(tokens['--agentskin-accent']).toBe('#ff5500');
    expect(tokens['--agentskin-secondary']).toBe('#ff5500');
  });

  it('dark mode produces brighter surface than bg', () => {
    const dark = buildSkinTokens({ bg: '#1a1a2e', fg: '#e0e0e0', accent: '#9d8bff' });
    expect(lumOf(dark['--agentskin-surface']!)).toBeGreaterThan(lumOf('#1a1a2e'));
  });

  it('light mode produces darker surface than bg', () => {
    const light = buildSkinTokens({ bg: '#f5f5f5', fg: '#111111', accent: '#3b82f6' });
    expect(lumOf(light['--agentskin-surface']!)).toBeLessThan(lumOf('#f5f5f5'));
  });

  it('border uses accent with alpha', () => {
    const tokens = buildSkinTokens({ bg: '#ffffff', fg: '#000000', accent: '#3b82f6' });
    expect(tokens['--agentskin-border']).toContain('59, 130, 246');
  });
});

// ---------------------------------------------------------------------------
// buildStudioPalette — snapshot → full token set
// ---------------------------------------------------------------------------

describe('buildStudioPalette', () => {
  it('extracts bg/fg from root landmark and builds tokens', () => {
    const snap = snapshotWithRoot([
      { property: 'background-color', value: '#ffffff' },
      { property: 'color', value: '#000000' },
      { property: 'border-color', value: '#ff5500' },
    ]);
    const tokens = buildStudioPalette(snap);
    expect(tokens['--agentskin-bg']).toBe('#ffffff');
    expect(tokens['--agentskin-text']).toBe('#000000');
  });

  it('falls back to default colors when snapshot has empty landmarks', () => {
    const snap = makeSnapshot({ landmarks: [] });
    const tokens = buildStudioPalette(snap);
    // Should still produce valid tokens with defaults
    expect(tokens['--agentskin-bg']).toBeTruthy();
    expect(tokens['--agentskin-text']).toBeTruthy();
  });

  it('ignores transparent background-color', () => {
    const snap = snapshotWithRoot([{ property: 'background-color', value: 'transparent' }]);
    const tokens = buildStudioPalette(snap);
    // transparent should be filtered, triggering fallback scan or default
    expect(tokens['--agentskin-bg']).toBeTruthy();
    expect(tokens['--agentskin-bg']).not.toBe('transparent');
  });

  it('uses hex() / rgba() colors from computed styles', () => {
    const snap = snapshotWithRoot([{ property: 'background-color', value: 'rgb(30, 30, 50)' }]);
    const tokens = buildStudioPalette(snap);
    expect(tokens['--agentskin-bg']).toBe('rgb(30, 30, 50)');
  });
});

// ---------------------------------------------------------------------------
// mergeOverridesToSkinTokens — override priority + rebuild logic
// ---------------------------------------------------------------------------

describe('mergeOverridesToSkinTokens', () => {
  const base = buildSkinTokens({ bg: '#ffffff', fg: '#000000', accent: '#3b82f6' });

  it('returns base unchanged when overrides is null', () => {
    expect(mergeOverridesToSkinTokens(base, null)).toBe(base);
  });

  it('returns base unchanged when overrides is undefined', () => {
    expect(mergeOverridesToSkinTokens(base, undefined)).toBe(base);
  });

  it('applies full colors map directly', () => {
    const result = mergeOverridesToSkinTokens(base, {
      colors: { accent: '#ff0000', background: '#111111' },
    });
    expect(result['--agentskin-accent']).toBe('#ff0000');
    expect(result['--agentskin-bg']).toBe('#111111');
  });

  it('rebuilds token set from role fields when colors map is empty', () => {
    const result = mergeOverridesToSkinTokens(base, { accent: '#00ff00' });
    expect(result['--agentskin-accent']).toBe('#00ff00');
    // Rebuild produces full token set
    expect(result['--agentskin-surface']).toBeTruthy();
    expect(result['--agentskin-border']).toBeTruthy();
  });

  it('colors map takes priority over role fields', () => {
    const result = mergeOverridesToSkinTokens(base, {
      colors: { accent: '#ff0000' },
      accent: '#00ff00',
    });
    expect(result['--agentskin-accent']).toBe('#ff0000');
  });

  it('ignores empty color values in colors map', () => {
    const result = mergeOverridesToSkinTokens(base, {
      colors: { accent: '', background: '#222222' },
    });
    expect(result['--agentskin-accent']).toBe('#3b82f6'); // unchanged
    expect(result['--agentskin-bg']).toBe('#222222');
  });

  it('keys starting with --agents- are normalized correctly', () => {
    const result = mergeOverridesToSkinTokens(base, {
      colors: { '--agentskin-accent': '#123456' },
    });
    expect(result['--agentskin-accent']).toBe('#123456');
  });

  it('unknown keys get --agentskin- prefix', () => {
    const result = mergeOverridesToSkinTokens(base, {
      colors: { customField: '#abcdef' },
    });
    expect(result['--agentskin-customField']).toBe('#abcdef');
  });

  it('returns base when overrides has no recognized fields', () => {
    const result = mergeOverridesToSkinTokens(base, {} as Record<string, never>);
    expect(result).toStrictEqual(base);
  });
});
