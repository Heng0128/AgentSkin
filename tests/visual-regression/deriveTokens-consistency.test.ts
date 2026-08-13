// SPDX-License-Identifier: MPL-2.0

/**
 * # deriveTokens ↔ tokenBlock consistency
 *
 * Verifies that `deriveTokens()` in scripts/build-theme-package.mjs produces
 * the same token derivation logic as `tokenBlock()` in scripts/theme-utils.mjs.
 *
 * The core invariant: when accent/surface are overridden, input-bg must be
 * derived from color-mix(surface 82% + accent 18%) 45% transparent (not the
 * hardcoded DEFAULT), and button-bg must track accent (not the hardcoded
 * DEFAULT). This mirrors tokenBlock() L208/L220 exactly.
 */

import { describe, expect, it } from 'vitest';
import { deriveTokens } from '../../scripts/build-theme-package.mjs';
import { tokenBlock } from '../../scripts/theme-utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a single --agentskin-* token value from a tokenBlock() output. */
function extractToken(block: string, token: string): string | undefined {
  const re = new RegExp(`${token}:\\s*([^;]+);`);
  const m = block.match(re);
  return m?.[1]?.trim();
}

/** Build a tokenBlock() input from a flat color map (what deriveTokens emits). */
function fakeCtx(tokens: Record<string, string>, isLight = false) {
  return {
    isLight,
    colors: {
      accent: tokens['--agentskin-accent'],
      background: tokens['--agentskin-bg'],
      surface: tokens['--agentskin-surface'],
      surfaceElevated: tokens['--agentskin-surface-elevated'],
      foreground: tokens['--agentskin-text'],
      muted: tokens['--agentskin-muted'],
      secondary: tokens['--agentskin-secondary'],
      border: tokens['--agentskin-border'],
      codeBackground: tokens['--agentskin-code-bg'],
      codeForeground: tokens['--agentskin-code-fg'],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveTokens ↔ tokenBlock token derivation consistency', () => {
  it('derives input-bg via color-mix(surface+accent) — not DEFAULT fallback', () => {
    // Custom accent + surface, no explicit input-bg
    const { tokens } = deriveTokens({
      '--agentskin-accent': '#ff0000',
      '--agentskin-surface': '#1a1a1a',
      '--agentskin-bg': '#111111',
      '--agentskin-text': '#ffffff',
      '--agentskin-secondary': '#00ff00',
      '--agentskin-muted': '#888888',
      '--agentskin-border': '#ff00002e',
      '--agentskin-code-bg': '#0a0a0a',
      '--agentskin-code-fg': '#cccccc',
      '--agentskin-surface-elevated': '#2a2a2a',
    });
    // Must NOT be the hardcoded DEFAULT #332e51
    expect(tokens['--agentskin-input-bg']).not.toBe('#332e51');
    // Must be the same color-mix expression tokenBlock() produces
    const block = tokenBlock(fakeCtx(tokens));
    const blockInputBg = extractToken(block, '--agentskin-input-bg');
    expect(tokens['--agentskin-input-bg']).toBe(blockInputBg);
  });

  it('derives button-bg = accent — not DEFAULT fallback', () => {
    const { tokens } = deriveTokens({
      '--agentskin-accent': '#ff0000',
      '--agentskin-surface': '#1a1a1a',
      '--agentskin-bg': '#111111',
      '--agentskin-text': '#ffffff',
      '--agentskin-secondary': '#00ff00',
      '--agentskin-muted': '#888888',
      '--agentskin-border': '#ff00002e',
      '--agentskin-code-bg': '#0a0a0a',
      '--agentskin-code-fg': '#cccccc',
      '--agentskin-surface-elevated': '#2a2a2a',
    });
    // Must NOT be the hardcoded DEFAULT #9d8bff
    expect(tokens['--agentskin-button-bg']).not.toBe('#9d8bff');
    // Must equal accent
    expect(tokens['--agentskin-button-bg']).toBe('#ff0000');
    // Must match tokenBlock() output
    const block = tokenBlock(fakeCtx(tokens));
    const blockButtonBg = extractToken(block, '--agentskin-button-bg');
    expect(tokens['--agentskin-button-bg']).toBe(blockButtonBg);
  });

  it('preserves explicit input-bg override (no regression)', () => {
    const { tokens } = deriveTokens({
      '--agentskin-accent': '#ff0000',
      '--agentskin-surface': '#1a1a1a',
      '--agentskin-bg': '#111111',
      '--agentskin-input-bg': '#custom99',
    });
    expect(tokens['--agentskin-input-bg']).toBe('#custom99');
  });

  it('preserves explicit button-bg override (no regression)', () => {
    const { tokens } = deriveTokens({
      '--agentskin-accent': '#ff0000',
      '--agentskin-surface': '#1a1a1a',
      '--agentskin-bg': '#111111',
      '--agentskin-button-bg': '#customAA',
    });
    expect(tokens['--agentskin-button-bg']).toBe('#customAA');
  });

  it('all four derived tokens (input-bg, button-bg, focus-ring, selection) track accent', () => {
    const { tokens } = deriveTokens({
      '--agentskin-accent': '#00cc88',
      '--agentskin-surface': '#0a0a0a',
      '--agentskin-bg': '#050505',
      '--agentskin-text': '#eeeeee',
      '--agentskin-secondary': '#ff6600',
      '--agentskin-muted': '#777777',
      '--agentskin-border': '#00cc882e',
      '--agentskin-code-bg': '#020202',
      '--agentskin-code-fg': '#bbbbbb',
      '--agentskin-surface-elevated': '#1a1a1a',
    });
    // focus-ring: color-mix(accent 40%)
    expect(tokens['--agentskin-focus-ring']).toBe('color-mix(in srgb, #00cc88 40%, transparent)');
    // selection: color-mix(accent 32%)
    expect(tokens['--agentskin-selection']).toBe('color-mix(in srgb, #00cc88 32%, transparent)');
    // button-bg = accent
    expect(tokens['--agentskin-button-bg']).toBe('#00cc88');
    // input-bg = color-mix(surface+accent)
    expect(tokens['--agentskin-input-bg']).toBe(
      'color-mix(in srgb, color-mix(in srgb, #0a0a0a 82%, #00cc88 18%) 45%, transparent)',
    );
  });

  it('empty root → all tokens fall back to DEFAULT (backward compat)', () => {
    const { tokens } = deriveTokens({});
    expect(tokens['--agentskin-accent']).toBe('#9d8bff');
    expect(tokens['--agentskin-input-bg']).toBe(
      'color-mix(in srgb, color-mix(in srgb, #2b254a 82%, #9d8bff 18%) 45%, transparent)',
    );
    expect(tokens['--agentskin-button-bg']).toBe('#9d8bff');
    expect(tokens['--agentskin-focus-ring']).toBe('color-mix(in srgb, #9d8bff 40%, transparent)');
    expect(tokens['--agentskin-selection']).toBe('color-mix(in srgb, #9d8bff 32%, transparent)');
  });

  it('input-bg expression structurally matches tokenBlock() pattern', () => {
    // Verify the derived input-bg always has the double color-mix structure
    // regardless of accent/surface combination — this is the exact pattern
    // from theme-utils.mjs tokenBlock() L220.
    const { tokens } = deriveTokens({
      '--agentskin-accent': '#abcdef',
      '--agentskin-surface': '#123456',
      '--agentskin-bg': '#000000',
      '--agentskin-text': '#ffffff',
      '--agentskin-secondary': '#fedcba',
      '--agentskin-muted': '#888888',
      '--agentskin-border': '#abcdef2e',
      '--agentskin-code-bg': '#111111',
      '--agentskin-code-fg': '#cccccc',
      '--agentskin-surface-elevated': '#222222',
    });
    const expected =
      'color-mix(in srgb, color-mix(in srgb, #123456 82%, #abcdef 18%) 45%, transparent)';
    expect(tokens['--agentskin-input-bg']).toBe(expected);
  });
});
