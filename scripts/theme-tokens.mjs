// SPDX-License-Identifier: MPL-2.0
//
// # theme-tokens.mjs
//
// Canonical single source of truth for the 14 required `--agentskin-*` design
// tokens. All consumers (check-themes.mjs, check-theme-staleness.mjs,
// check-variable-bridge.mjs, contract tests) import from here to prevent drift.
//
// Canonical token list (14 tokens):
//   1. --agentskin-bg
//   2. --agentskin-surface
//   3. --agentskin-surface-elevated
//   4. --agentskin-text
//   5. --agentskin-muted
//   6. --agentskin-accent
//   7. --agentskin-secondary
//   8. --agentskin-border
//   9. --agentskin-code-bg
//  10. --agentskin-code-fg
//  11. --agentskin-focus-ring
//  12. --agentskin-selection
//  13. --agentskin-button-bg
//  14. --agentskin-input-bg

/** The 14 required design tokens every agent CSS must declare. */
export const REQUIRED_TOKENS = [
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
];

/** Tokens that exist ONLY in the agent-CSS layer (per-agent derived). */
export const AGENT_ONLY_TOKENS = new Set(['--agentskin-button-bg', '--agentskin-input-bg']);

/** The 12 core tokens that palette.css must carry (excludes per-agent derived). */
export const PALETTE_TOKENS = REQUIRED_TOKENS.filter((t) => !AGENT_ONLY_TOKENS.has(t));

/** All agentskin tokens referenced by the variable bridge. */
export const AGENTSKIN_TOKENS = new Set([
  ...REQUIRED_TOKENS,
  '--agentskin-text-shadow',
  '--agentskin-art',
]);

/** Validate that a token list matches the canonical set. */
export function validateTokenList(tokens) {
  const canonical = new Set(REQUIRED_TOKENS);
  const provided = new Set(tokens);
  const missing = REQUIRED_TOKENS.filter((t) => !provided.has(t));
  const extra = [...provided].filter((t) => !canonical.has(t));
  return { missing, extra, valid: missing.length === 0 && extra.length === 0 };
}
