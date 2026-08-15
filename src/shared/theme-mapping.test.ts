// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import {
  paletteToSemanticColors,
  SEMANTIC_TO_AGENTSKIN,
  semanticColorsToPalette,
} from './theme-mapping';

// ---------------------------------------------------------------------------
// semanticColorsToPalette
// ---------------------------------------------------------------------------

describe('semanticColorsToPalette', () => {
  it('converts all known semantic colors to --agentskin-* tokens', () => {
    const colors = {
      background: '#0E1116',
      foreground: '#E5E7EB',
      accent: '#FF453A',
      secondary: '#6B7280',
      surface: '#1A1D23',
      surfaceElevated: '#252830',
      muted: '#3A3D45',
      border: '#2A2D35',
      codeBackground: '#121519',
      codeForeground: '#E5E7EB',
      inputBackground: '#151820',
      buttonBackground: '#FF453A',
      buttonForeground: '#FFFFFF',
      focusRing: '#FF453A',
    };
    const palette = semanticColorsToPalette(colors);
    expect(palette).toEqual({
      '--agentskin-bg': '#0E1116',
      '--agentskin-text': '#E5E7EB',
      '--agentskin-accent': '#FF453A',
      '--agentskin-secondary': '#6B7280',
      '--agentskin-surface': '#1A1D23',
      '--agentskin-surface-elevated': '#252830',
      '--agentskin-muted': '#3A3D45',
      '--agentskin-border': '#2A2D35',
      '--agentskin-code-bg': '#121519',
      '--agentskin-code-fg': '#E5E7EB',
      '--agentskin-input-bg': '#151820',
      '--agentskin-button-bg': '#FF453A',
      '--agentskin-button-fg': '#FFFFFF',
      '--agentskin-focus-ring': '#FF453A',
    });
  });

  it('returns empty object for undefined input', () => {
    expect(semanticColorsToPalette(undefined)).toEqual({});
  });

  it('ignores non-string values', () => {
    const palette = semanticColorsToPalette({ background: 123, accent: '#FF453A' });
    expect(palette).toEqual({ '--agentskin-accent': '#FF453A' });
  });
});

// ---------------------------------------------------------------------------
// paletteToSemanticColors (A-11)
// ---------------------------------------------------------------------------

describe('paletteToSemanticColors', () => {
  it('converts --agentskin-* tokens back to semantic color names', () => {
    const palette = {
      '--agentskin-bg': '#0E1116',
      '--agentskin-text': '#E5E7EB',
      '--agentskin-accent': '#FF453A',
    };
    const colors = paletteToSemanticColors(palette);
    expect(colors).toEqual({
      background: '#0E1116',
      foreground: '#E5E7EB',
      accent: '#FF453A',
    });
  });

  it('returns empty object for undefined input', () => {
    expect(paletteToSemanticColors(undefined)).toEqual({});
  });

  it('ignores unknown palette tokens', () => {
    const palette = {
      '--agentskin-bg': '#0E1116',
      '--unknown-token': '#FFFFFF',
    };
    const colors = paletteToSemanticColors(palette);
    expect(colors).toEqual({ background: '#0E1116' });
  });
});

// ---------------------------------------------------------------------------
// Roundtrip (A-11)
// ---------------------------------------------------------------------------

describe('roundtrip: semantic → palette → semantic', () => {
  it('roundtrips all 14 semantic colors without loss', () => {
    const allSemantic: Record<string, string> = {};
    for (const semantic of Object.keys(SEMANTIC_TO_AGENTSKIN)) {
      allSemantic[semantic] = '#AABBCC';
    }
    const palette = semanticColorsToPalette(allSemantic);
    const back = paletteToSemanticColors(palette);
    expect(back).toEqual(allSemantic);
  });

  it('roundtrips palette → semantic → palette without loss', () => {
    const allPalette: Record<string, string> = {};
    for (const token of Object.values(SEMANTIC_TO_AGENTSKIN)) {
      allPalette[token] = '#112233';
    }
    const semantic = paletteToSemanticColors(allPalette);
    const back = semanticColorsToPalette(semantic);
    expect(back).toEqual(allPalette);
  });
});

// ---------------------------------------------------------------------------
// Dev-mode warnings (A-16)
// ---------------------------------------------------------------------------

describe('dev-mode warnings for unmapped keys', () => {
  it('warns on unmapped semantic color in non-production', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      semanticColorsToPalette({
        background: '#000',
        unknownColor: '#FFF',
      });
      expect(spy).toHaveBeenCalledWith('[theme-mapping] unmapped semantic color:', 'unknownColor');
    } finally {
      spy.mockRestore();
    }
  });

  it('warns on unmapped palette token in non-production', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      paletteToSemanticColors({
        '--agentskin-bg': '#000',
        '--unknown-token': '#FFF',
      });
      expect(spy).toHaveBeenCalledWith(
        '[theme-mapping] unmapped palette token:',
        '--unknown-token',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
