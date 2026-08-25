// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { CommunityTheme } from '../../shared/types/community';
import {
  AGENTSKIN_TOKEN_KEYS,
  adjustBrightness,
  bridgeColors,
  getContrastColor,
  hexToRgb,
  parseHex,
  rgbToHex,
} from '../../src/main/community/community-color-bridge';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const darkTheme: CommunityTheme = {
  themeId: 'theme-dark-001',
  name: 'Midnight Blue',
  author: { id: 'author-1', displayName: 'TestAuthor' },
  description: 'A dark theme for testing',
  tags: ['dark', 'blue'],
  downloads: 100,
  rating: 4.5,
  updatedAt: '2025-01-15T10:30:00Z',
  version: '1.0.0',
  screenshots: [],
  targetAgents: ['traework'],
  displayMeta: {
    appearance: 'dark',
    colors: {
      accent: '#60a5fa',
      secondary: '#93b5d6',
      background: '#0f172a',
      text: '#eef2f7',
      muted: '#64748b',
      panel: '#1e293b',
      panelAlt: '#334155',
      line: '#374151',
    },
  },
};

const lightTheme: CommunityTheme = {
  themeId: 'theme-light-001',
  name: 'Snow White',
  author: { id: 'author-2', displayName: 'LightAuthor' },
  description: 'A light theme for testing',
  tags: ['light', 'white'],
  downloads: 200,
  rating: 4.8,
  updatedAt: '2025-02-20T14:00:00Z',
  version: '1.2.0',
  screenshots: [],
  targetAgents: ['traework', 'qoderwork'],
  displayMeta: {
    appearance: 'light',
    colors: {
      accent: '#4f8cff',
      secondary: '#7ba7d8',
      background: '#f8fafc',
      text: '#1f2937',
      muted: '#6b7280',
      panel: '#ffffff',
      panelAlt: '#f8fafc',
      line: '#e5e7eb',
    },
  },
};

const autoTheme: CommunityTheme = {
  ...lightTheme,
  themeId: 'theme-auto-001',
  displayMeta: {
    appearance: 'auto',
    colors: lightTheme.displayMeta!.colors,
  },
};

const emptyColorsTheme: CommunityTheme = {
  themeId: 'theme-empty-001',
  name: 'Empty Colors',
  author: { id: 'author-3', displayName: 'EmptyAuthor' },
  description: 'Theme with no colors',
  tags: [],
  downloads: 0,
  rating: 0,
  updatedAt: '2025-03-01T00:00:00Z',
  version: '0.1.0',
  screenshots: [],
  targetAgents: [],
  displayMeta: {
    appearance: 'dark',
    colors: {},
  },
};

const noDisplayMetaTheme: CommunityTheme = {
  themeId: 'theme-nometa-001',
  name: 'No Meta',
  author: { id: 'author-4', displayName: 'MetaAuthor' },
  description: 'Theme with no display metadata',
  tags: [],
  downloads: 0,
  rating: 0,
  updatedAt: '2025-03-01T00:00:00Z',
  version: '0.1.0',
  screenshots: [],
  targetAgents: [],
};

// ---------------------------------------------------------------------------
// describe: AGENTSKIN_TOKEN_KEYS
// ---------------------------------------------------------------------------

describe('AGENTSKIN_TOKEN_KEYS', () => {
  it('contains exactly 14 keys', () => {
    expect(AGENTSKIN_TOKEN_KEYS).toHaveLength(14);
  });

  it('includes all required token keys', () => {
    const expected = [
      'accent',
      'secondary',
      'background',
      'foreground',
      'muted',
      'surface',
      'surfaceElevated',
      'border',
      'codeBackground',
      'codeForeground',
      'inputBackground',
      'buttonBackground',
      'buttonForeground',
      'focusRing',
    ];
    for (const key of expected) {
      expect(AGENTSKIN_TOKEN_KEYS).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// describe: bridgeColors
// ---------------------------------------------------------------------------

describe('bridgeColors', () => {
  it('returns all 14 tokens for a dark theme', () => {
    const tokens = bridgeColors(darkTheme);
    expect(Object.keys(tokens)).toHaveLength(14);
    for (const key of AGENTSKIN_TOKEN_KEYS) {
      expect(tokens[key]).toBeDefined();
      expect(typeof tokens[key]).toBe('string');
    }
  });

  it('maps dark theme colors directly (accent, background, text)', () => {
    const tokens = bridgeColors(darkTheme);
    expect(tokens.accent).toBe('#60a5fa');
    expect(tokens.background).toBe('#0f172a');
    expect(tokens.foreground).toBe('#eef2f7');
    expect(tokens.surface).toBe('#1e293b');
    expect(tokens.surfaceElevated).toBe('#334155');
    expect(tokens.border).toBe('#374151');
    expect(tokens.muted).toBe('#64748b');
    expect(tokens.secondary).toBe('#93b5d6');
  });

  it('maps light theme colors directly', () => {
    const tokens = bridgeColors(lightTheme);
    expect(tokens.accent).toBe('#4f8cff');
    expect(tokens.background).toBe('#f8fafc');
    expect(tokens.foreground).toBe('#1f2937');
    expect(tokens.surface).toBe('#ffffff');
    expect(tokens.surfaceElevated).toBe('#f8fafc');
    expect(tokens.border).toBe('#e5e7eb');
  });

  it('derives codeBackground darker than surface in dark mode', () => {
    const tokens = bridgeColors(darkTheme);
    // In dark mode, codeBackground = surface - 2 brightness
    const surfaceRgb = hexToRgb(tokens.surface)!;
    const codeBgRgb = hexToRgb(tokens.codeBackground)!;
    expect(codeBgRgb.r).toBeLessThanOrEqual(surfaceRgb.r);
    expect(codeBgRgb.g).toBeLessThanOrEqual(surfaceRgb.g);
    expect(codeBgRgb.b).toBeLessThanOrEqual(surfaceRgb.b);
  });

  it('derives codeBackground lighter than surface in light mode', () => {
    const tokens = bridgeColors(lightTheme);
    // In light mode, codeBackground = surface + 2 brightness
    const surfaceRgb = hexToRgb(tokens.surface)!;
    const codeBgRgb = hexToRgb(tokens.codeBackground)!;
    expect(codeBgRgb.r).toBeGreaterThanOrEqual(surfaceRgb.r);
    expect(codeBgRgb.g).toBeGreaterThanOrEqual(surfaceRgb.g);
    expect(codeBgRgb.b).toBeGreaterThanOrEqual(surfaceRgb.b);
  });

  it('sets codeForeground equal to foreground', () => {
    expect(bridgeColors(darkTheme).codeForeground).toBe('#eef2f7');
    expect(bridgeColors(lightTheme).codeForeground).toBe('#1f2937');
  });

  it('sets inputBackground equal to surface', () => {
    expect(bridgeColors(darkTheme).inputBackground).toBe('#1e293b');
    expect(bridgeColors(lightTheme).inputBackground).toBe('#ffffff');
  });

  it('sets buttonBackground equal to accent', () => {
    expect(bridgeColors(darkTheme).buttonBackground).toBe('#60a5fa');
    expect(bridgeColors(lightTheme).buttonBackground).toBe('#4f8cff');
  });

  it('derives buttonForeground as contrast color of accent (WCAG luminance)', () => {
    // #60a5fa WCAG luminance ~0.36 (< 0.5) → buttonForeground = #ffffff
    expect(bridgeColors(darkTheme).buttonForeground).toBe('#ffffff');
    // #4f8cff WCAG luminance ~0.28 (< 0.5) → buttonForeground = #ffffff
    expect(bridgeColors(lightTheme).buttonForeground).toBe('#ffffff');
  });

  it('sets focusRing using color-mix(in srgb, accent 40%, transparent)', () => {
    expect(bridgeColors(darkTheme).focusRing).toBe('color-mix(in srgb, #60a5fa 40%, transparent)');
    expect(bridgeColors(lightTheme).focusRing).toBe('color-mix(in srgb, #4f8cff 40%, transparent)');
  });

  it('treats auto appearance as light', () => {
    const tokens = bridgeColors(autoTheme);
    // Should use light defaults (surface = #ffffff)
    expect(tokens.surface).toBe('#ffffff');
    expect(tokens.background).toBe('#f8fafc');
  });

  it('falls back to dark defaults when colors are empty', () => {
    const tokens = bridgeColors(emptyColorsTheme);
    expect(tokens.accent).toBe('#60a5fa'); // dark default
    expect(tokens.surface).toBe('#1e293b'); // dark default
    expect(tokens.background).toBe('#0f172a'); // dark default
    expect(tokens.foreground).toBe('#eef2f7'); // dark default
  });

  it('falls back to light defaults when displayMeta is missing', () => {
    const tokens = bridgeColors(noDisplayMetaTheme);
    // appearance undefined → normalizeAppearance returns 'light'
    expect(tokens.accent).toBe('#4f8cff'); // light default
    expect(tokens.surface).toBe('#ffffff'); // light default
    expect(tokens.background).toBe('#f8fafc'); // light default
    expect(tokens.foreground).toBe('#1f2937'); // light default
  });

  it('handles partial color maps with mixed defaults', () => {
    const partialTheme: CommunityTheme = {
      ...darkTheme,
      displayMeta: {
        appearance: 'dark',
        colors: {
          accent: '#ff0000',
          // missing other colors
        },
      },
    };
    const tokens = bridgeColors(partialTheme);
    expect(tokens.accent).toBe('#ff0000');
    expect(tokens.surface).toBe('#1e293b'); // dark default
    expect(tokens.foreground).toBe('#eef2f7'); // dark default
  });
});

// ---------------------------------------------------------------------------
// describe: parseHex
// ---------------------------------------------------------------------------

describe('parseHex', () => {
  it('parses 6-digit hex colors', () => {
    expect(parseHex('#ff0000')).toBe('#ff0000');
    expect(parseHex('#4f8cff')).toBe('#4f8cff');
    expect(parseHex('#000000')).toBe('#000000');
    expect(parseHex('#ffffff')).toBe('#ffffff');
  });

  it('expands 3-digit hex to 6-digit', () => {
    expect(parseHex('#f00')).toBe('#ff0000');
    expect(parseHex('#fff')).toBe('#ffffff');
    expect(parseHex('#abc')).toBe('#aabbcc');
  });

  it('strips alpha channel from 8-digit hex', () => {
    expect(parseHex('#ff000080')).toBe('#ff0000');
    expect(parseHex('#4f8cffcc')).toBe('#4f8cff');
  });

  it('returns null for invalid hex strings', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#gggggg')).toBeNull();
    expect(parseHex('#12345')).toBeNull(); // 5 digits
    expect(parseHex(undefined)).toBeNull();
  });

  it('handles uppercase hex', () => {
    expect(parseHex('#FF0000')).toBe('#ff0000');
    expect(parseHex('#4F8CFF')).toBe('#4f8cff');
  });

  it('trims whitespace', () => {
    expect(parseHex('  #ff0000  ')).toBe('#ff0000');
  });
});

// ---------------------------------------------------------------------------
// describe: adjustBrightness
// ---------------------------------------------------------------------------

describe('adjustBrightness', () => {
  it('lightens a color with positive amount', () => {
    // #808080 = rgb(128,128,128) + 10 = rgb(138,138,138)
    const result = adjustBrightness('#808080', 10);
    const rgb = hexToRgb(result)!;
    expect(rgb.r).toBe(138);
    expect(rgb.g).toBe(138);
    expect(rgb.b).toBe(138);
  });

  it('darkens a color with negative amount', () => {
    // #808080 = rgb(128,128,128) - 10 = rgb(118,118,118)
    const result = adjustBrightness('#808080', -10);
    const rgb = hexToRgb(result)!;
    expect(rgb.r).toBe(118);
    expect(rgb.g).toBe(118);
    expect(rgb.b).toBe(118);
  });

  it('clamps channels to 0-255', () => {
    // #000000 - 10 should clamp to #000000
    expect(adjustBrightness('#000000', -10)).toBe('#000000');
    // #ffffff + 10 should clamp to #ffffff
    expect(adjustBrightness('#ffffff', 10)).toBe('#ffffff');
  });

  it('returns original hex for invalid input', () => {
    expect(adjustBrightness('invalid', 10)).toBe('invalid');
  });

  it('returns same color for zero adjustment', () => {
    expect(adjustBrightness('#4f8cff', 0)).toBe('#4f8cff');
  });
});

// ---------------------------------------------------------------------------
// describe: getContrastColor
// ---------------------------------------------------------------------------

describe('getContrastColor', () => {
  it('returns #000000 for light backgrounds (WCAG luminance > 0.5)', () => {
    expect(getContrastColor('#ffffff')).toBe('#000000');
    expect(getContrastColor('#f8fafc')).toBe('#000000');
    // #d4d4d4 WCAG luminance ~0.58 (> 0.5) → #000000
    expect(getContrastColor('#d4d4d4')).toBe('#000000');
  });

  it('returns #ffffff for dark backgrounds', () => {
    expect(getContrastColor('#000000')).toBe('#ffffff');
    expect(getContrastColor('#0f172a')).toBe('#ffffff');
    expect(getContrastColor('#1e293b')).toBe('#ffffff');
  });

  it('returns #ffffff for invalid input', () => {
    expect(getContrastColor('invalid')).toBe('#ffffff');
  });

  it('handles mid-gray correctly (WCAG luminance)', () => {
    // #808080 WCAG luminance ~0.216 (< 0.5) → #ffffff
    expect(getContrastColor('#808080')).toBe('#ffffff');
    // #bcbcbc WCAG luminance ~0.503 (> 0.5) → #000000
    expect(getContrastColor('#bcbcbc')).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// describe: hexToRgb / rgbToHex round-trip
// ---------------------------------------------------------------------------

describe('hexToRgb / rgbToHex round-trip', () => {
  it('round-trips correctly for various colors', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#4f8cff', '#60a5fa', '#0f172a'];
    for (const color of colors) {
      const rgb = hexToRgb(color)!;
      expect(rgbToHex(rgb.r, rgb.g, rgb.b)).toBe(color);
    }
  });

  it('hexToRgb returns null for invalid hex', () => {
    expect(hexToRgb('red')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });

  it('rgbToHex pads single-digit channels with zero', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(15, 15, 15)).toBe('#0f0f0f');
  });
});
