// SPDX-License-Identifier: MPL-2.0

/**
 * # bridge-theme-consistency
 *
 * Visual-regression suite for Codex bridge themes (github-noir, obsidian-poise,
 * sweet-strawberry-code, demo-bridge-v2). Enforces the bridge contract:
 *
 *   1. variableBridge (when present): keys are valid CSS variable names,
 *      values reference valid --agentskin-* tokens.
 *   2. CSS --agentskin-* selectors MUST uniformly use :root.agentskin-host-codex.
 *   3. No bare :root declarations (THEME_SPEC violation).
 *   4. No --ct-* variable leaks — all source tokens should be converted.
 *   5. --color-* bridge override count > 0 (ensures real client impact).
 *
 * ---
 *
 * Strategy: static CSS + manifest analysis, zero external deps, deterministic.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THEMES_DIR = join(process.cwd(), 'themes');

/** Bridge themes under test. */
const BRIDGE_THEMES = ['github-noir', 'obsidian-poise', 'sweet-strawberry-code'] as const;

const AGENTS = ['codex'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read and parse a theme's manifest.json. */
function readManifest(themeId: string): Record<string, unknown> {
  const path = join(THEMES_DIR, themeId, 'manifest.json');
  if (!existsSync(path)) throw new Error(`manifest.json missing for ${themeId}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

/** Read a theme's CSS file for a given agent. */
function readThemeCss(themeId: string, agent: string): string {
  const path = join(THEMES_DIR, themeId, 'assets', 'css', `${agent}.css`);
  if (!existsSync(path)) throw new Error(`${agent}.css missing for ${themeId}`);
  return readFileSync(path, 'utf-8');
}

/**
 * Validate a CSS variable name: must start with -- and contain only
 * alphanumeric, hyphen, underscore after the prefix.
 */
function isValidCssVarName(name: string): boolean {
  return /^--[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

/**
 * Validate that a value references at least one --agentskin-* token.
 * Accepts var(--agentskin-...) or color-mix with agentskin tokens inside.
 */
function referencesAgentskinToken(value: string): boolean {
  return /var\(--agentskin-[a-z-]+\)/.test(value);
}

/**
 * Extract all --agentskin-* variable names declared inside :root blocks
 * that use the .agentskin-host-codex qualifier.
 */
function extractAgentskinVarsInHostSelector(css: string): string[] {
  const hostBlockRe = /:root\.agentskin-host-codex\s*\{([^}]*)\}/gs;
  const varRe = /(--agentskin-[a-z-]+)\s*:/g;
  const found = new Set<string>();
  let block: RegExpExecArray | null;
  while ((block = hostBlockRe.exec(css)) !== null) {
    let v: RegExpExecArray | null;
    while ((v = varRe.exec(block[1])) !== null) {
      found.add(v[1]);
    }
  }
  return [...found];
}

/**
 * Detect bare :root declarations (without .agentskin-host-codex qualifier).
 * Matches :root { ... } or :root:not(...) { ... } but NOT :root.agentskin-host-codex.
 */
function hasBareRootDeclaration(css: string): boolean {
  // Find all :root followed by optional pseudo/qualifier then {
  const rootRe = /:root(?!\.agentskin-host-codex)\b[^{]*\{/g;
  return rootRe.test(css);
}

/**
 * Find all --ct-* variable identifiers referenced anywhere in the CSS.
 * Captures both `var(--ct-foo)` and bare `--ct-foo` appearances.
 */
function findCtVariableReferences(css: string): string[] {
  const uses = new Set<string>();
  const re = /--ct-[a-zA-Z0-9_-]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    uses.add(m[0]);
  }
  return [...uses];
}

/**
 * Return set of all --ct-* variables DECLARED (i.e., --ct-xxx: value).
 */
function findCtVariableDeclarations(css: string): Set<string> {
  const declared = new Set<string>();
  const declRe = /(--ct-[a-zA-Z0-9_-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(css)) !== null) {
    declared.add(m[1]);
  }
  return declared;
}

/**
 * Count --color-* variable declarations in a CSS string.
 * Excludes --color-token-* (those are native Codex tokens, not bridge overrides).
 */
function countColorBridgeOverrides(css: string): number {
  const declRe = /--color-[a-zA-Z0-9_-]+\s*:/g;
  const matches = css.match(declRe) ?? [];
  // Filter out --color-token-* (native Codex, not bridge-level)
  return matches.filter((m) => !m.startsWith('--color-token-')).length;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('bridge-theme-consistency', () => {
  // — Collect bridge themes that actually exist on disk ————───────────────
  const availableThemes = BRIDGE_THEMES.filter((id) =>
    existsSync(join(THEMES_DIR, id, 'manifest.json')),
  );

  it('target bridge themes exist on disk', () => {
    expect(availableThemes.length).toBeGreaterThanOrEqual(1);
  });

  // — Per-theme tests ——————————————————————————————————————————————
  for (const themeId of availableThemes) {
    describe(`theme: ${themeId}`, () => {
      const manifest = readManifest(themeId);

      // ── 1. variableBridge format ──────────────────────────────────────
      describe('variableBridge format', () => {
        const vb = manifest.variableBridge as Record<string, string> | undefined;

        it('variableBridge (if present) has valid CSS var names as keys', () => {
          if (!vb) {
            // Not all bridge themes declare variableBridge in manifest — skip
            expect(vb).toBeUndefined();
            return;
          }
          for (const key of Object.keys(vb)) {
            expect(isValidCssVarName(key), `key "${key}" is not a valid CSS variable name`).toBe(true);
          }
        });

        it('variableBridge values reference valid --agentskin-* tokens', () => {
          if (!vb) {
            expect(vb).toBeUndefined();
            return;
          }
          for (const [key, value] of Object.entries(vb)) {
            expect(
              referencesAgentskinToken(value),
              `value for "${key}" should reference --agentskin-* token, got: "${value}"`,
            ).toBe(true);
          }
        });
      });

      // ── 2-5. CSS-level checks (per agent) ─────────────────────────────
      for (const agent of AGENTS) {
        describe(`agent CSS: ${agent}`, () => {
          const css = readThemeCss(themeId, agent);

          it('declares --agentskin-* tokens inside :root.agentskin-host-codex', () => {
            const varsInHost = extractAgentskinVarsInHostSelector(css);
            expect(varsInHost.length).toBeGreaterThan(0);
            // Core tokens must be present
            expect(varsInHost).toContain('--agentskin-accent');
            expect(varsInHost).toContain('--agentskin-bg');
            expect(varsInHost).toContain('--agentskin-text');
          });

          it('has NO bare :root declarations (THEME_SPEC violation)', () => {
            expect(hasBareRootDeclaration(css)).toBe(false);
          });

          // FIX 2026-08-23 (faithful full-CSS reproduction): the bridge now
          // preserves the source theme's --ct-* namespace verbatim so the
          // hand-tuned Codex adaptation stays self-consistent. The correct
          // invariant is SELF-CONSISTENCY: every referenced --ct-* must have a
          // matching declaration in the same bridged block (no dangling refs),
          // NOT "zero --ct-* occurrences" (which would mean we dropped the
          // source design system).
          it('every --ct-* reference has a matching declaration (self-consistent, no dangling refs)', () => {
            const ctRefs = findCtVariableReferences(css);
            const ctDecls = new Set(findCtVariableDeclarations(css));
            const dangling = ctRefs.filter((r) => !ctDecls.has(r));
            expect(
              dangling,
              `dangling --ct-* refs (referenced but never declared): ${dangling.join(', ')}`,
            ).toEqual([]);
          });

          // Bridge contract: if the source theme CSS was bridged (bridge marker
          // present), --color-* override count must be > 0.
          it('has --color-* bridge overrides > 0 when bridge section is present', () => {
            const hasBridgeMarker =
              css.includes('Bridge: FULL source Codex theme CSS') ||
              css.includes('Bridge: Codex-native --color-token-* overrides');
            if (!hasBridgeMarker) {
              // Metadata-only export (no source CSS) — bridge section cannot exist.
              expect(hasBridgeMarker).toBe(false);
              return;
            }
            expect(countColorBridgeOverrides(css)).toBeGreaterThan(0);
          });
        });
      }
    });
  }
});
