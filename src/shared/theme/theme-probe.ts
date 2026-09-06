// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-probe
 *
 * Theme compatibility pre-check — validates that a theme's CSS selectors
 * are compatible with a target agent's verification contract before
 * installation. Prevents misaligned styles by detecting missing DOM nodes
 * early.
 *
 * Inspired by CodeDrobe/core's probe mechanism: check adapter and theme
 * node existence before installation, report incompatibility clearly.
 *
 * ## Architecture
 *
 * ```
 *  theme-probe.ts (pure logic, DOM-free)
 *  ├── ProbeResult — compatibility result type
 *  ├── probeThemeCompatibility(manifest, agentId) — main entry point
 *  ├── extractCssSelectors(css) — CSS selector extraction
 *  └── collectContractSelectors(contract) — gather known selectors
 *
 *  contracts/*.contract.json (per-adapter verification contracts)
 *  contract-validator.ts (loadContract)
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { probeThemeCompatibility } from '@shared/theme/theme-probe';
 *
 * const result = probeThemeCompatibility(themeManifest, 'doubao');
 * if (!result.compatible) {
 *   console.warn('Compatibility issues:', result.warnings);
 *   console.warn('Missing nodes:', result.missingNodes);
 * }
 * ```
 */

import { loadContract, type VerificationContract } from '../injection/contract-validator';
import type { AgentId } from '../types/agent';
import type { ThemeManifest } from '../types/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a theme compatibility pre-check.
 *
 * `compatible` is `true` when all CSS selectors in the theme's target CSS
 * match at least one selector in the agent's verification contract. When
 * `false`, `missingNodes` lists the unmatched selectors and `warnings`
 * provides human-readable explanations.
 *
 * This is a **warning** result, not a blocker — installation can proceed
 * even when `compatible` is `false`.
 */
export interface ProbeResult {
  /** Whether all theme selectors are known to the agent's contract. */
  compatible: boolean;
  /** CSS selectors from the theme that are not in the verification contract. */
  missingNodes: string[];
  /** Human-readable warning messages. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Selectors that are always valid (not agent-specific)
// ---------------------------------------------------------------------------

/**
 * Universal selectors that exist in every DOM and don't need contract
 * verification. These are excluded from the missing nodes check.
 */
const UNIVERSAL_SELECTORS = new Set([':root', 'html', 'body', '*']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe theme compatibility for a specific agent.
 *
 * Extracts CSS selectors from the theme manifest's `targets[agentId].css`
 * field, then checks each selector against the agent's verification
 * contract (loaded via `contract-validator`). Selectors not found in the
 * contract are reported as `missingNodes`.
 *
 * Pure function — no side effects, safe to call repeatedly.
 *
 * @param manifest  The theme manifest to probe.
 * @param agentId   Target agent identifier.
 * @returns Compatibility result with pass/fail status, missing nodes, and warnings.
 *
 * @example
 * ```ts
 * const result = probeThemeCompatibility(themeManifest, 'doubao');
 * if (!result.compatible) {
 *   console.warn('Potential compatibility issues:');
 *   for (const warning of result.warnings) {
 *     console.warn(`  - ${warning}`);
 *   }
 * }
 * ```
 */
export function probeThemeCompatibility(manifest: ThemeManifest, agentId: AgentId): ProbeResult {
  // Load the verification contract for this agent.
  const contract = loadContract(agentId);
  if (!contract) {
    return {
      compatible: false,
      missingNodes: [],
      warnings: [
        `Agent "${agentId}" has no verification contract — compatibility cannot be validated`,
      ],
    };
  }

  // Extract the CSS for this agent from the theme manifest.
  const targetCss = manifest.targets?.[agentId]?.css;
  if (!targetCss || targetCss.trim().length === 0) {
    // No CSS targets for this agent — nothing to probe.
    return { compatible: true, missingNodes: [], warnings: [] };
  }

  // Extract selectors from the CSS.
  const selectors = extractCssSelectors(targetCss);

  if (selectors.length === 0) {
    // CSS contains no selectors (e.g., only @import or comments) — nothing to probe.
    return { compatible: true, missingNodes: [], warnings: [] };
  }

  // Collect all known selectors from the verification contract.
  const knownSelectors = collectContractSelectors(contract);

  // Find selectors that are not in the contract and not universal.
  const missingNodes = selectors.filter(
    (sel) => !knownSelectors.has(sel) && !UNIVERSAL_SELECTORS.has(sel),
  );

  const warnings: string[] = [];
  if (missingNodes.length > 0) {
    warnings.push(
      `Theme targets ${missingNodes.length} selector(s) not in the "${agentId}" verification contract: ${missingNodes.join(', ')}`,
    );
  }

  return {
    compatible: missingNodes.length === 0,
    missingNodes,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// CSS selector extraction
// ---------------------------------------------------------------------------

/**
 * Extract CSS selectors from a CSS string.
 *
 * Handles:
 * - Simple selectors (`.class`, `#id`, `tag`, `[attr]`)
 * - Compound selectors (`.a .b`, `.a > .b`, `.a, .b`)
 * - At-rules (`@media`, `@supports`) — selectors inside are extracted recursively
 * - CSS comments (stripped)
 *
 * Does **not** attempt full CSS parsing — it extracts the text before each
 * `{` block as a selector, which covers the vast majority of theme CSS.
 *
 * @param css  Raw CSS string.
 * @returns Array of unique selector strings (order preserved, duplicates removed).
 */
export function extractCssSelectors(css: string): string[] {
  const selectors: string[] = [];
  const seen = new Set<string>();

  // Strip CSS comments first.
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');

  extractFromCss(cleaned, selectors, seen);

  return selectors;
}

/**
 * Walk through a CSS string, extracting selectors and recursing into
 * nested blocks. Pure state-machine parser.
 */
function extractFromCss(css: string, out: string[], seen: Set<string>): void {
  const len = css.length;
  let i = 0;

  while (i < len) {
    // Skip whitespace.
    while (i < len && /\s/.test(css[i])) i++;
    if (i >= len) break;

    // Handle @-rules.
    if (css[i] === '@') {
      i = skipAtRule(css, i, out, seen);
      continue;
    }

    // Read selector text up to the next `{`.
    const selStart = i;
    while (i < len && css[i] !== '{') i++;

    if (i >= len) break; // No opening brace — malformed, stop.

    const selectorText = css.slice(selStart, i).trim();
    i++; // Skip `{`.

    // Skip past the matching `}` of this declaration block.
    i = skipBraceBlock(css, i);
    i++; // Skip past the closing `}` itself.

    // Split compound selectors by comma and add each.
    if (selectorText.length > 0) {
      for (const sel of selectorText.split(',')) {
        const trimmed = sel.trim();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
          seen.add(trimmed);
          out.push(trimmed);
        }
      }
    }
  }
}

/**
 * Skip past a CSS at-rule.
 *
 * If it's `@media` or `@supports`, recurse into the block to extract
 * nested selectors. Otherwise skip the entire at-rule (including any
 * `{}` block).
 *
 * @returns The index to continue parsing from.
 */
function skipAtRule(css: string, start: number, out: string[], seen: Set<string>): number {
  const len = css.length;

  // Check if this is a nested-rule at-rule (@media, @supports).
  const rest = css.slice(start);
  const isNestedRule = /^@(media|supports)\b/i.test(rest);

  // Find the opening `{` or the terminating `;`.
  let i = start;
  while (i < len && css[i] !== '{' && css[i] !== ';') i++;

  if (i >= len) return len; // Malformed — ran off the end.

  if (css[i] === ';') {
    // Single-line at-rule like `@import ...;` or `@charset ...;`.
    return i + 1;
  }

  // css[i] === '{' — skip past the matching `}`.
  const blockStart = i + 1;
  const blockEnd = skipBraceBlock(css, blockStart);

  if (isNestedRule) {
    // Extract selectors from inside the block.
    const blockContent = css.slice(blockStart, blockEnd);
    extractFromCss(blockContent, out, seen);
  }
  // For non-nested rules (@font-face, @keyframes, etc.), ignore block content.

  return blockEnd + 1;
}

/**
 * Given a position immediately after an opening `{`, find the matching
 * `}` and return its index. Handles nested braces.
 */
function skipBraceBlock(css: string, start: number): number {
  const len = css.length;
  let depth = 1;
  let i = start;
  while (i < len && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    if (depth > 0) i++;
  }
  return i; // Points at `}` (or len if unbalanced).
}

// ---------------------------------------------------------------------------
// Contract selector collection
// ---------------------------------------------------------------------------

/**
 * Collect all CSS selectors from a verification contract.
 *
 * Walks through all `required`, `recommended`, and `contexts` checks,
 * gathering every selector into a single set for O(1) lookup.
 *
 * @param contract  The verification contract to extract selectors from.
 * @returns Set of all selector strings in the contract.
 */
export function collectContractSelectors(contract: VerificationContract): Set<string> {
  const selectors = new Set<string>();

  for (const check of contract.required) {
    for (const sel of check.any) {
      selectors.add(sel);
    }
  }

  for (const check of contract.recommended) {
    for (const sel of check.any) {
      selectors.add(sel);
    }
  }

  for (const ctx of contract.contexts) {
    for (const sel of ctx.when.any) {
      selectors.add(sel);
    }
    for (const check of ctx.required) {
      for (const sel of check.any) {
        selectors.add(sel);
      }
    }
  }

  return selectors;
}
