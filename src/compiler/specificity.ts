// SPDX-License-Identifier: MPL-2.0

/**
 * # Specificity Guard (λ P0-1)
 *
 * Per-adapter CSS specificity profiler and guard. Detects when emitted
 * selectors exceed the adapter's `!important` budget or max-specificity
 * ceiling, and can auto-wrap rules in `@layer agentskin` to defuse
 * specificity wars without escalating `!important` counts.
 *
 * ## Specificity model (W3C CSS Selectors Level 4)
 *
 *   a = #id            selectors
 *   b = .class / [attr] / :pseudo-class selectors
 *   c = element / ::pseudo-element selectors
 *
 * Returned as `[a, b, c]`. Higher tuple = higher specificity.
 *
 * ## Scope strategies (per adapter host)
 *
 * | scopeStrategy      | example                                  | specificity |
 * |--------------------|------------------------------------------|:-----------:|
 * | host-class-only    | `:root.agentskin-host-codex`             | (0,1,0)     |
 * | host-root          | `html.agentskin-host-doubao:root`        | (0,2,1)     |
 * | body-descendant    | `html.agentskin-host-traework body`      | (0,1,2)     |
 * | html-descendant    | `html.agentskin-host-workbuddy .sidebar` | (0,1,2)     |
 *
 * Zero external dependencies — pure regex-based selector parsing.
 */

import type { AgentId } from '../shared/types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScopeStrategy = 'host-class-only' | 'host-root' | 'body-descendant' | 'html-descendant';

export interface SpecificityProfile {
  adapterId: AgentId;
  scopeStrategy: ScopeStrategy;
  /** Maximum number of !important declarations allowed in one build. */
  importantBudget: number;
  /** Ordered fix strategies to apply when a rule violates the budget. */
  fallbackOrder: Array<'wrap-host' | 'add-layer' | 'force-important'>;
  /** [class, id, element] ceiling — any selector above this is a violation. */
  maxSpecificity: [number, number, number];
  /** When true, decoration tokens (shadow-accent) get auto-guarded. */
  decorationGuard: boolean;
}

export interface SpecificityReport {
  profile: SpecificityProfile;
  violated: boolean;
  /** Count of !important in the scanned CSS. */
  actualBudget: number;
  /** Selectors that exceeded maxSpecificity. */
  overflowSelectors: string[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Preset profiles for the 6 supported adapters. */
export const AGENT_SPECIFICITY_PROFILES: Record<AgentId, SpecificityProfile> = {
  codex: {
    adapterId: 'codex',
    scopeStrategy: 'host-class-only',
    importantBudget: 150,
    fallbackOrder: ['add-layer', 'wrap-host'],
    maxSpecificity: [0, 2, 0],
    decorationGuard: false,
  },
  doubao: {
    adapterId: 'doubao',
    scopeStrategy: 'host-root',
    importantBudget: 150,
    fallbackOrder: ['add-layer', 'force-important'],
    maxSpecificity: [0, 2, 1],
    decorationGuard: true,
  },
  qoderwork: {
    adapterId: 'qoderwork',
    scopeStrategy: 'host-root',
    importantBudget: 200,
    fallbackOrder: ['add-layer', 'wrap-host'],
    maxSpecificity: [0, 2, 1],
    decorationGuard: false,
  },
  zcode: {
    adapterId: 'zcode',
    scopeStrategy: 'host-root',
    importantBudget: 200,
    fallbackOrder: ['add-layer', 'wrap-host'],
    maxSpecificity: [0, 2, 1],
    decorationGuard: false,
  },
  workbuddy: {
    adapterId: 'workbuddy',
    scopeStrategy: 'body-descendant',
    importantBudget: 250,
    fallbackOrder: ['wrap-host', 'add-layer'],
    maxSpecificity: [0, 1, 2],
    decorationGuard: true,
  },
  traework: {
    adapterId: 'traework',
    scopeStrategy: 'body-descendant',
    importantBudget: 250,
    fallbackOrder: ['wrap-host', 'add-layer'],
    maxSpecificity: [0, 1, 2],
    decorationGuard: false,
  },
};

// ---------------------------------------------------------------------------
// Specificity calculation (W3C)
// ---------------------------------------------------------------------------

/**
 * Calculate CSS selector specificity as a 3-tuple `[a, b, c]`.
 *
 *   a = ID selectors (`#id`)
 *   b = class selectors (`.cls`), attribute selectors (`[attr]`), pseudo-classes (`:hover`)
 *   c = type/element selectors (`div`), pseudo-elements (`::before`, `::-webkit-*`)
 *
 * Handles compound selectors separated by combinators (space, `>`, `+`, `~`).
 * Does NOT account for `:not()` inner specificity (treated as :not itself only).
 *
 * @example
 *   calculateSpecificity(':root.agentskin-host-codex')        // [0, 2, 0]
 *   calculateSpecificity('html.agentskin-host-doubao:root')   // [0, 2, 1]
 *   calculateSpecificity('html.agentskin-host-traework body') // [0, 1, 2]
 */
export function calculateSpecificity(selector: string): [number, number, number] {
  let a = 0;
  let b = 0;
  let c = 0;

  // Strip string contents (attribute selectors may contain [attr="..."]).
  const cleaned = selector.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');

  // Split on combinators: ' ', '>', '+', '~'.
  const parts = cleaned.split(/\s*[>+~]\s*|\s+/).filter(Boolean);

  for (const part of parts) {
    // ID selectors
    const idMatches = part.match(/#[a-zA-Z_-][\w-]*/g);
    if (idMatches) a += idMatches.length;

    // Class selectors
    const classMatches = part.match(/\.[a-zA-Z_-][\w-]*/g);
    if (classMatches) b += classMatches.length;

    // Attribute selectors [...]
    const attrMatches = part.match(/\[[^\]]+\]/g);
    if (attrMatches) b += attrMatches.length;

    // Pseudo-elements (::before, ::after, ::-webkit-scrollbar, etc.)
    const pseudoElemMatches = part.match(/::[a-zA-Z-][\w-]*/g);
    if (pseudoElemMatches) c += pseudoElemMatches.length;

    // Pseudo-classes (:root, :hover, :not(), :first-child, etc.)
    // Strip pseudo-elements first so '::' is not matched as ':'.
    const withoutPseudoElem = part.replace(/::[a-zA-Z-][\w-]*/g, '');
    const pseudoClassMatches = withoutPseudoElem.match(/:[a-zA-Z-][\w-]*(?:\([^)]*\))?/g);
    if (pseudoClassMatches) b += pseudoClassMatches.length;

    // Element / type selectors — strip everything else and check what remains.
    let remaining = part;
    remaining = remaining.replace(/#[a-zA-Z_-][\w-]*/g, ''); // strip IDs
    remaining = remaining.replace(/\.[a-zA-Z_-][\w-]*/g, ''); // strip classes
    remaining = remaining.replace(/\[[^\]]+\]/g, ''); // strip attributes
    remaining = remaining.replace(/::[a-zA-Z-][\w-]*/g, ''); // strip pseudo-elements
    remaining = remaining.replace(/:[a-zA-Z-][\w-]*(?:\([^)]*\))?/g, ''); // strip pseudo-classes
    remaining = remaining.trim();

    // What's left is empty, '*', or a single element name.
    if (remaining && remaining !== '*' && /^[a-zA-Z][\w-]*$/.test(remaining)) {
      c++;
    }
  }

  return [a, b, c];
}

// ---------------------------------------------------------------------------
// CSS rule extraction
// ---------------------------------------------------------------------------

interface CssRule {
  /** Full selector string for this rule. */
  selector: string;
  /** Declaration block (between `{` and `}`). */
  declarations: string;
  /** Whether this rule is inside a `@layer` block. */
  inLayer: boolean;
}

/**
 * Lightweight CSS rule extractor. Strips comments, then walks `{…}` blocks
 * to collect selector + declaration pairs. Handles nested `@media` blocks.
 */
function extractRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  let i = 0;
  const len = stripped.length;
  let inLayer = false;

  while (i < len) {
    // Track @layer blocks.
    if (stripped.slice(i, i + 6) === '@layer') {
      inLayer = true;
    }

    const braceOpen = stripped.indexOf('{', i);
    if (braceOpen === -1) break;

    const selector = stripped.slice(i, braceOpen).trim();

    // Find matching closing brace.
    let depth = 1;
    let j = braceOpen + 1;
    while (j < len && depth > 0) {
      if (stripped[j] === '{') depth++;
      else if (stripped[j] === '}') depth--;
      j++;
    }
    if (depth !== 0) break; // malformed

    const declarations = stripped.slice(braceOpen + 1, j - 1);

    if (selector && !selector.startsWith('@')) {
      rules.push({ selector, declarations, inLayer });
    }

    i = j;
  }

  return rules;
}

// ---------------------------------------------------------------------------
// !important counting
// ---------------------------------------------------------------------------

/** Count the number of `!important` occurrences in a CSS string. */
function countImportant(css: string): number {
  return (css.match(/!important/g) || []).length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a CSS string against a SpecificityProfile.
 *
 * Reports whether the `!important` count exceeds the budget and whether
 * any selector exceeds the profile's maxSpecificity ceiling.
 */
export function validateSpecificity(css: string, profile: SpecificityProfile): SpecificityReport {
  const actualBudget = countImportant(css);
  const rules = extractRules(css);
  const overflowSelectors: string[] = [];
  const recommendations: string[] = [];

  let violated = false;

  // Check !important budget.
  if (actualBudget > profile.importantBudget) {
    violated = true;
    recommendations.push(
      `!important count ${actualBudget} exceeds budget ${profile.importantBudget}. ` +
        `Apply fallback: ${profile.fallbackOrder.join(' → ')}`,
    );
  }

  // Check per-selector specificity ceiling.
  for (const rule of rules) {
    // Split combined selectors (comma-separated).
    const selectors = rule.selector.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      if (!sel) continue;
      const spec = calculateSpecificity(sel);
      if (
        spec[0] > profile.maxSpecificity[0] ||
        (spec[0] === profile.maxSpecificity[0] && spec[1] > profile.maxSpecificity[1]) ||
        (spec[0] === profile.maxSpecificity[0] &&
          spec[1] === profile.maxSpecificity[1] &&
          spec[2] > profile.maxSpecificity[2])
      ) {
        overflowSelectors.push(sel);
      }
    }
  }

  if (overflowSelectors.length > 0) {
    violated = true;
    recommendations.push(
      `${overflowSelectors.length} selector(s) exceed maxSpecificity (${profile.maxSpecificity.join(',')}). ` +
        `Consider @layer wrap or selector simplification.`,
    );
  }

  // decorationGuard warning.
  if (profile.decorationGuard) {
    const hasDecoration = /\.decoration|shadow-accent|::before|::after/.test(css);
    if (hasDecoration) {
      recommendations.push(
        'DecorationGuard enabled: verify --agentskin-shadow-accent specificity.',
      );
    }
  }

  return {
    profile,
    violated,
    actualBudget,
    overflowSelectors,
    recommendations,
  };
}

/**
 * Auto-fix specificity violations in a CSS string.
 *
 * For each violation detected via `validateSpecificity`:
 *
 * 1. If `add-layer` is in fallbackOrder, and the rule is NOT already in a
 *    `@layer` block, wrap it in `@layer agentskin { ... }`.
 * 2. If `force-important` is in fallbackOrder and !important count is under
 *    budget, add `!important` to overflow-selector declarations.
 * 3. If `wrap-host` is in fallbackOrder, the caller is advised to re-emit
 *    with a higher-specificity host (this function only logs the issue).
 *
 * Returns the guarded CSS and the validation report. Rules already inside
 * `@layer agentskin` are left untouched.
 */
export function guardSpecificity(
  css: string,
  profile: SpecificityProfile,
): { guarded: string; report: SpecificityReport } {
  const report = validateSpecificity(css, profile);

  if (!report.violated) {
    return { guarded: css, report };
  }

  let guarded = css;
  const rules = extractRules(css);
  const overflowSet = new Set(report.overflowSelectors);

  for (const rule of rules) {
    if (rule.inLayer) continue;
    if (overflowSet.size === 0) break;

    const selectors = rule.selector.split(',').map((s) => s.trim());
    const hasOverflow = selectors.some((s) => overflowSet.has(s));
    if (!hasOverflow) continue;

    // Build search pattern: normalize whitespace for reliable matching.
    const declTrimmed = rule.declarations.trim();
    const ruleText = `${rule.selector} { ${declTrimmed} }`;

    if (profile.fallbackOrder.includes('add-layer')) {
      guarded = guarded.replace(ruleText, `@layer agentskin {\n  ${ruleText}\n}`);
      overflowSet.clear();
    } else if (profile.fallbackOrder.includes('force-important')) {
      // Add !important to each declaration that doesn't already have it.
      const decls = declTrimmed
        .split(';')
        .map((d) => {
          const t = d.trim();
          if (!t || t.endsWith('!important')) return t;
          return `${t} !important`;
        })
        .filter(Boolean)
        .join('; ');
      guarded = guarded.replace(ruleText, `${rule.selector} { ${decls} }`);
      overflowSet.clear();
    }
  }

  // Re-validate after fixes.
  const postReport = validateSpecificity(guarded, profile);

  return { guarded, report: postReport };
}
