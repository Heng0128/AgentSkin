// SPDX-License-Identifier: MPL-2.0

/**
 * 14-Token Theme Contract Test
 *
 * Verifies that every theme's generated CSS files contain all 14 required
 * `--agentskin-*` design tokens. This is the canonical "14 variables"
 * contract defined in `scripts/check-themes.mjs` (C2 invariant guard).
 *
 * A theme that omits even one token renders broken on the target agent,
 * because the per-agent CSS relies on every variable being declared.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 14 required `--agentskin-*` design tokens.
 * Source of truth: `scripts/check-themes.mjs` REQUIRED_TOKENS.
 * Mirror here to keep the contract test self-contained.
 */
const REQUIRED_TOKENS = [
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
  '--agentskin-button-bg',
  '--agentskin-input-bg',
] as const;

/**
 * The 12 core tokens that `palette.css` must carry.
 * `button-bg` and `input-bg` are derived in the per-agent CSS layer,
 * so they are not required in the palette itself.
 */
const PALETTE_TOKENS = REQUIRED_TOKENS.filter(
  (t) => t !== '--agentskin-button-bg' && t !== '--agentskin-input-bg',
);

const THEMES_DIR = join(__dirname, '../../themes');

/** Token match pattern: `--agentskin-xxx:` at the start of a CSS value assignment. */
function tokenPattern(token: string) {
  return new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
}

describe('14-Token Theme Contract', () => {
  /** Top-level entries under themes/ that are theme directories. */
  const themeDirs = readdirSync(THEMES_DIR).filter((name) => {
    if (name.startsWith('.') || name.startsWith('_')) return false;
    const full = join(THEMES_DIR, name);
    try {
      return statSync(full).isDirectory();
    } catch {
      return false;
    }
  });

  it('has at least one theme', () => {
    expect(themeDirs.length).toBeGreaterThan(0);
  });

  for (const themeId of themeDirs) {
    describe(`theme: ${themeId}`, () => {
      const themePath = join(THEMES_DIR, themeId);
      const manifestPath = join(themePath, 'manifest.json');

      it('has a parseable manifest.json with id matching directory name', () => {
        expect(existsSync(manifestPath), `manifest.json should exist at ${manifestPath}`).toBe(true);
        const raw = readFileSync(manifestPath, 'utf-8');
        let manifest: { id?: string; colors?: Record<string, unknown> };
        expect(() => {
          manifest = JSON.parse(raw);
        }).not.toThrow();
        expect(manifest!.id).toBe(themeId);
        expect(manifest!.colors).toBeTypeOf('object');
        expect(manifest!.colors!.background).toBeTypeOf('string');
      });

      it('contains all 13 required color keys in manifest.colors', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const colors = manifest.colors ?? {};
        // 13 manifest color keys map to the 14 --agentskin-* CSS tokens.
        // The 14th token (--agentskin-selection) is derived from accent via
        // color-mix at CSS generation time, so it is NOT declared in the manifest.
        const expectedKeys = [
          'background', 'surface', 'surfaceElevated', 'foreground',
          'muted', 'accent', 'secondary', 'border',
          'codeBackground', 'codeForeground', 'focusRing',
          'buttonBackground', 'inputBackground',
        ];
        const missing = expectedKeys.filter((k) => typeof colors[k] !== 'string');
        expect(missing, `manifest.colors missing keys: ${missing.join(', ')}`).toEqual([]);
      });

      it('generated palette.css declares the 12 core --agentskin-* tokens', () => {
        const palettePath = join(themePath, 'palette.css');
        if (!existsSync(palettePath)) {
          // Some themes may store palette inline; skip if file absent.
          return;
        }
        const css = readFileSync(palettePath, 'utf-8');
        const missing = PALETTE_TOKENS.filter((t) => !tokenPattern(t).test(css));
        expect(missing, `palette.css missing tokens: ${missing.join(', ')}`).toEqual([]);
      });

      it('every target agent CSS declares all 14 --agentskin-* tokens', () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const targets = (manifest.targets ?? {}) as Record<string, { css?: string }>;
        const agentIds = Object.keys(targets);

        // Skip themes with no declared targets (edge case).
        if (agentIds.length === 0) return;

        for (const agentId of agentIds) {
          const cssPath = targets[agentId]?.css;
          if (!cssPath) continue;
          const fullCssPath = join(themePath, cssPath);
          if (!existsSync(fullCssPath)) continue;

          const css = readFileSync(fullCssPath, 'utf-8');
          const missing = REQUIRED_TOKENS.filter((t) => !tokenPattern(t).test(css));
          expect(
            missing,
            `agent CSS ${agentId} (${cssPath}) missing tokens: ${missing.join(', ')}`,
          ).toEqual([]);
        }
      });
    });
  }
});
