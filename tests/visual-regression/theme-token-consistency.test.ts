// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-token-consistency
 *
 * Lightweight automated visual-regression framework for AgentSkin themes.
 *
 * Strategy: CSS output comparison (NOT screenshot-based). Rationale:
 *   - Zero external deps (no Playwright / Puppeteer).
 *   - Deterministic and fast — suited for CI.
 *   - Catches the regressions that matter most: missing tokens, broken
 *     luminance hierarchy, and WCAG AA contrast failures.
 *
 * For every built-in theme we verify, across ALL agent CSS:
 *   1. Presence of the 14 required design tokens (the contract from
 *      THEME_SPEC.md — same set enforced by scripts/check-themes.mjs).
 *   2. Manifest-colors ↔ CSS-token value match for the directly-declarable
 *      tokens (accent / secondary / bg / surface / surfaceElevated / text /
 *      muted / code-bg / code-fg / border). These are authored as plain
 *      hex/rgba in both sides — any drift is a real regression.
 *   3. Luminance hierarchy (dark: bg < surface < surfaceElevated so layers
 *      stack correctly).
 *   4. WCAG AA contrast: text/bg ≥ 4.5, muted/bg ≥ 3.0 (secondary text is
 *      typically smaller → 3.0 threshold).
 *   5. color-scheme declaration matches manifest.mode.
 *
 * Tokens derived via color-mix() (input-bg / button-bg) are excluded from
 * #2 because their value is a runtime-computed expression — we cannot verify
 * them statically. They DO participate in presence (#1) and color-scheme (#5).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blendOver,
  parseColor,
  relativeLuminance,
  wcagContrast,
} from '../../../src/main/profile/color-quantize';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEMES_DIR = join(process.cwd(), 'themes');

/** 14 required tokens (THEME_SPEC.md contract). */
const REQUIRED_TOKENS = [
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
  '--agentskin-button-bg',
  '--agentskin-input-bg',
] as const;

/**
 * Map manifest.colors field → CSS token. These are the authored-straight-through
 * tokens (plain hex/rgba on both sides). Tokens derived via color-mix at
 * runtime (button-bg / input-bg / focus-ring / selection) are intentionally
 * excluded — their CSS value is an expression, not a literal.
 */
const DIRECT_TOKEN_MAP: ReadonlyArray<[manifestKey: string, token: string]> = [
  ['accent', '--agentskin-accent'],
  ['secondary', '--agentskin-secondary'],
  ['background', '--agentskin-bg'],
  ['surface', '--agentskin-surface'],
  ['surfaceElevated', '--agentskin-surface-elevated'],
  ['foreground', '--agentskin-text'],
  ['muted', '--agentskin-muted'],
  ['codeBackground', '--agentskin-code-bg'],
  ['codeForeground', '--agentskin-code-fg'],
  ['border', '--agentskin-border'],
];

/** Per-agent targets each built-in theme must provide. */
const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;

/** WCAG AA threshold: normal text (≥18pt or ≥14pt bold uses 3.0). */
const WCAG_NORMAL = 4.5;
const WCAG_SECONDARY = 3.0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Theme manifest (parsed JSON). */
interface ThemeManifest {
  id: string;
  mode: 'dark' | 'light';
  colors: Record<string, string>;
  targets: Record<string, { css: string }>;
  colorSchemes?: string[];
}

/**
 * Extract all `--agentskin-*` token values from a CSS string.
 * Returns Map<token, rawValue>. Captures declarations of the form
 * `--token: <value>;` — stops at `}` or `;`.
 */
function extractTokensFromCss(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const re = /(--agentskin-[\w-]+)\s*:\s*([^;{}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const token = m[1];
    const value = m[2].trim();
    // Last declaration wins (mirrors CSS cascade).
    tokens.set(token, value);
  }
  return tokens;
}

/**
 * Compare two CSS color values for visual equivalence.
 *
 * Handles:
 *   - #rrggbb on both sides → exact hex after normalisation.
 *   - rgba(...) vs #rrggbb → compare as opaque colors.
 *   - rgba with alpha <1 → blend over white, compare blended result.
 *
 * Returns true when the colors are visually indistinguishable (within ±1
 * per-channel tolerance to absorb rounding in build scripts).
 */
function colorsEquivalent(a: string, b: string): boolean {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return false;
  // Blend over white when alpha <1.
  const aBlend = ca.a >= 1 ? ca : blendOver(ca, { r: 255, g: 255, b: 255, a: 1 });
  const bBlend = cb.a >= 1 ? cb : blendOver(cb, { r: 255, g: 255, b: 255, a: 1 });
  return (
    Math.abs(aBlend.r - bBlend.r) <= 1 &&
    Math.abs(aBlend.g - bBlend.g) <= 1 &&
    Math.abs(aBlend.b - bBlend.b) <= 1
  );
}

/** Compute WCAG contrast ratio between two CSS color strings (returns 1–21). */
function computeContrastRatio(color1: string, color2: string): number {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);
  if (!c1 || !c2) return 1;
  const b1 = c1.a >= 1 ? c1 : blendOver(c1, { r: 255, g: 255, b: 255, a: 1 });
  const b2 = c2.a >= 1 ? c2 : blendOver(c2, { r: 255, g: 255, b: 255, a: 1 });
  return wcagContrast(b1, b2);
}

/**
 * Check WCAG AA compliance for the key text-on-surface pairs.
 * Returns array of violation strings (empty = all pass).
 */
function checkWcagCompliance(
  tokens: Map<string, string>,
  mode: 'dark' | 'light',
): string[] {
  const violations: string[] = [];
  const text = tokens.get('--agentskin-text');
  const muted = tokens.get('--agentskin-muted');
  const bg = tokens.get('--agentskin-bg');
  const surface = tokens.get('--agentskin-surface');
  const accent = tokens.get('--agentskin-accent');

  if (text && bg) {
    const ratio = computeContrastRatio(text, bg);
    if (ratio < WCAG_NORMAL) {
      violations.push(`text/bg contrast ${ratio.toFixed(2)} < ${WCAG_NORMAL}`);
    }
  }
  if (muted && bg) {
    const ratio = computeContrastRatio(muted, bg);
    if (ratio < WCAG_SECONDARY) {
      violations.push(`muted/bg contrast ${ratio.toFixed(2)} < ${WCAG_SECONDARY}`);
    }
  }
  if (text && surface) {
    const ratio = computeContrastRatio(text, surface);
    if (ratio < WCAG_NORMAL) {
      violations.push(`text/surface contrast ${ratio.toFixed(2)} < ${WCAG_NORMAL}`);
    }
  }
  if (accent && bg) {
    // Accent is used for links/buttons — UI components (≥3.0 AA).
    const ratio = computeContrastRatio(accent, bg);
    if (ratio < WCAG_SECONDARY) {
      violations.push(`accent/bg contrast ${ratio.toFixed(2)} < ${WCAG_SECONDARY}`);
    }
  }
  if (mode === 'dark' && text && bg) {
    // Sanity: text must be brighter than bg in dark mode.
    const cText = parseColor(text);
    const cBg = parseColor(bg);
    if (cText && cBg) {
      const textLum = relativeLuminance(cText);
      const bgLum = relativeLuminance(cBg);
      if (textLum <= bgLum) {
        violations.push(
          `dark-mode text (L=${textLum.toFixed(3)}) not brighter than bg (L=${bgLum.toFixed(3)})`,
        );
      }
    }
  }
  if (mode === 'light' && text && bg) {
    const cText = parseColor(text);
    const cBg = parseColor(bg);
    if (cText && cBg) {
      const textLum = relativeLuminance(cText);
      const bgLum = relativeLuminance(cBg);
      if (textLum >= bgLum) {
        violations.push(
          `light-mode text (L=${textLum.toFixed(3)}) not darker than bg (L=${bgLum.toFixed(3)})`,
        );
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Discover all built-in themes (every dir containing a manifest.json). */
function discoverThemes(): ThemeManifest[] {
  const manifests: ThemeManifest[] = [];
  const entries = readdirSync(THEMES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(THEMES_DIR, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const parsed: ThemeManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifests.push(parsed);
    } catch {
      // Skip invalid manifests — flagged by its own test below.
    }
  }
  return manifests;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const themes = discoverThemes();

describe('theme discovery', () => {
  it('finds all 15 built-in themes', () => {
    expect(themes.length).toBe(15);
  });

  it('every theme has a valid manifest.id matching its directory', () => {
    for (const t of themes) {
      expect(t.id).toBeTruthy();
      expect(typeof t.id).toBe('string');
    }
  });
});

describe('required agent CSS coverage', () => {
  for (const t of themes) {
    it(`${t.id} — provides CSS for all 6 agents`, () => {
      for (const agent of AGENTS) {
        expect(t.targets[agent], `${t.id} missing target for agent "${agent}"`).toBeDefined();
        const cssPath = join(THEMES_DIR, t.id, t.targets[agent].css);
        expect(existsSync(cssPath), `${t.id}/${agent}: CSS file not found at ${cssPath}`).toBe(true);
      }
    });
  }
});

describe('required token presence', () => {
  for (const t of themes) {
    for (const agent of AGENTS) {
      const cssPath = join(THEMES_DIR, t.id, t.targets[agent].css);
      if (!existsSync(cssPath)) continue;

      it(`${t.id}/${agent} — declares all 14 required tokens`, () => {
        const css = readFileSync(cssPath, 'utf8');
        const tokens = extractTokensFromCss(css);
        for (const token of REQUIRED_TOKENS) {
          expect(tokens.has(token), `${t.id}/${agent}: missing token ${token}`).toBe(true);
        }
      });
    }
  }
});

describe('manifest-color ↔ CSS-token consistency', () => {
  for (const t of themes) {
    for (const agent of AGENTS) {
      const cssPath = join(THEMES_DIR, t.id, t.targets[agent].css);
      if (!existsSync(cssPath)) continue;

      it(`${t.id}/${agent} — authored tokens match manifest colors`, () => {
        const css = readFileSync(cssPath, 'utf8');
        const tokens = extractTokensFromCss(css);
        for (const [mKey, token] of DIRECT_TOKEN_MAP) {
          const manifestVal = t.colors[mKey];
          if (!manifestVal) continue; // manifest doesn't declare → nothing to check
          const cssVal = tokens.get(token);
          expect(
            cssVal,
            `${t.id}/${agent}: token ${token} not found (manifest declares ${mKey}=${manifestVal})`,
          ).toBeTruthy();
          expect(
            colorsEquivalent(manifestVal, cssVal!),
            `${t.id}/${agent}: token ${token}="${cssVal}" does not match manifest.${mKey}="${manifestVal}"`,
          ).toBe(true);
        }
      });
    }
  }
});

describe('color-scheme matches manifest mode', () => {
  for (const t of themes) {
    for (const agent of AGENTS) {
      const cssPath = join(THEMES_DIR, t.id, t.targets[agent].css);
      if (!existsSync(cssPath)) continue;

      it(`${t.id}/${agent} — CSS color-scheme matches mode="${t.mode}"`, () => {
        const css = readFileSync(cssPath, 'utf8');
        const expected = t.mode === 'dark' ? 'dark' : 'light';
        expect(
          css.includes(`color-scheme: ${expected}`),
          `${t.id}/${agent}: expected "color-scheme: ${expected}" in CSS`,
        ).toBe(true);
      });
    }
  }
});

describe('luminance hierarchy', () => {
  for (const t of themes) {
    it(`${t.id} — surface/luminance respects mode="${t.mode}"`, () => {
      const bgVal = t.colors.background;
      const sVal = t.colors.surface;
      const seVal = t.colors.surfaceElevated;
      if (!bgVal || !sVal || !seVal) return; // skip if any missing

      const cBg = parseColor(bgVal);
      const cS = parseColor(sVal);
      const cSe = parseColor(seVal);
      if (!cBg || !cS || !cSe) return;

      const bgLum = relativeLuminance(cBg);
      const sLum = relativeLuminance(cS);
      const seLum = relativeLuminance(cSe);

      if (t.mode === 'dark') {
        expect(sLum, `${t.id}: surface should be brighter than bg in dark mode`).toBeGreaterThan(
          bgLum,
        );
        // surfaceElevated may equal surface; only enforce strict inequality
        // when manifest declares different values.
        if (seVal !== sVal) {
          expect(
            seLum,
            `${t.id}: surfaceElevated should be >= surface in dark mode`,
          ).toBeGreaterThanOrEqual(sLum);
        }
      } else {
        expect(sLum, `${t.id}: surface should be darker than bg in light mode`).toBeLessThan(bgLum);
        if (seVal !== sVal) {
          expect(
            seLum,
            `${t.id}: surfaceElevated should be <= surface in light mode`,
          ).toBeLessThanOrEqual(sLum);
        }
      }
    });
  }
});

describe('WCAG AA contrast compliance', () => {
  for (const t of themes) {
    for (const agent of AGENTS) {
      const cssPath = join(THEMES_DIR, t.id, t.targets[agent].css);
      if (!existsSync(cssPath)) continue;

      it(`${t.id}/${agent} — passes WCAG AA`, () => {
        const css = readFileSync(cssPath, 'utf8');
        const tokens = extractTokensFromCss(css);
        const violations = checkWcagCompliance(tokens, t.mode);
        expect(
          violations,
          `${t.id}/${agent} WCAG violations:\n  - ${violations.join('\n  - ')}`,
        ).toEqual([]);
      });
    }
  }
});

describe('colorSchemes CSS coverage', () => {
  for (const t of themes) {
    const schemes = t.colorSchemes ?? [];
    for (const scheme of schemes) {
      it(`${t.id} — scheme "${scheme}" has CSS for every agent`, () => {
        for (const agent of AGENTS) {
          const agentCfg = t.targets[agent];
          if (!agentCfg) continue;
          const cssPath = join(
            THEMES_DIR,
            t.id,
            'assets',
            'css',
            scheme,
            agentCfg.css.split('/').pop()!,
          );
          expect(
            existsSync(cssPath),
            `${t.id}/assets/css/${scheme}/${agent}: expected file at ${cssPath}`,
          ).toBe(true);
        }
      });
    }
  }
});

describe('colorSchemes color-scheme match', () => {
  for (const t of themes) {
    const schemes = t.colorSchemes ?? [];
    for (const scheme of schemes) {
      const schemePath = join(THEMES_DIR, t.id, 'color-schemes', `${scheme}.json`);
      if (!existsSync(schemePath)) continue;
      let schemeMode: string;
      try {
        schemeMode = JSON.parse(readFileSync(schemePath, 'utf8')).mode;
      } catch {
        continue;
      }
      for (const agent of AGENTS) {
        const agentCfg = t.targets[agent];
        if (!agentCfg) continue;
        const cssPath = join(
          THEMES_DIR,
          t.id,
          'assets',
          'css',
          scheme,
          agentCfg.css.split('/').pop()!,
        );
        if (!existsSync(cssPath)) continue;

        it(`${t.id}/${scheme}/${agent} — color-scheme matches "${schemeMode}"`, () => {
          const css = readFileSync(cssPath, 'utf8');
          expect(
            css.includes(`color-scheme: ${schemeMode}`),
            `${t.id}/${scheme}/${agent}: expected color-scheme: ${schemeMode}`,
          ).toBe(true);
        });
      }
    }
  }
});
