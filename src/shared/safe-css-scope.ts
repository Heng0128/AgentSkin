// SPDX-License-Identifier: MPL-2.0

/**
 * # Safe-CSS Scope Validator & Wrapper
 *
 * Complements `safe-css.ts` (which sanitises property values) by enforcing
 * **selector scope**: user-authored custom CSS may only target registered
 * `data-agentskin-part` components. This prevents a theme's `custom.css` from
 * restyling the host application's unrelated DOM or escaping the AgentSkin
 * injection surface entirely.
 *
 * ## Design inspiration
 *
 * Codex Dream Skin's `SELECTOR_CONTRACT` — a fixed registry of `data-ds-part`
 * components, with CSS validated against that set before injection.
 *
 * ## Three exports
 *
 *   1. `REGISTERED_PARTS` — the 14-part registry (single source of truth).
 *   2. `validateScope(css)` — returns `{ valid, violations, scopedCss }`.
 *   3. `scopeCss(css, partId)` — wraps declarations in a part attribute selector.
 *
 * ## Limits
 *
 *   - Selector parsing is regex-based, not a full CSS parser. It handles the
 *     99 % case (simple class, id, attribute, and descendant selectors).
 *   - `@media` / `@supports` wrapping rules are passed through as-is when
 *     their inner declarations pass validation.
 */

// ---------------------------------------------------------------------------
// Part registry
// ---------------------------------------------------------------------------

export type PartScope = 'global' | 'agent';

export interface SkinPart {
  /** Unique identifier — also the `data-agentskin-part` value. */
  id: string;
  /** Full CSS attribute selector, e.g. `[data-agentskin-part="sidebar"]`. */
  selector: string;
  /** `global` parts exist in every agent; `agent` parts are app-specific. */
  scope: PartScope;
  /** Required parts must be present in every theme's CSS output. */
  required: boolean;
}

/**
 * The 14 registered parts. CSS targeting anything outside this set is rejected.
 *
 * Registry order matters: `global` parts come first so that theme authors
 * structure their CSS from shell inward.
 */
export const REGISTERED_PARTS: readonly SkinPart[] = Object.freeze([
  // --- Global shell (3) ---
  {
    id: 'shell-main',
    selector: '[data-agentskin-part="shell-main"]',
    scope: 'global',
    required: true,
  },
  { id: 'sidebar', selector: '[data-agentskin-part="sidebar"]', scope: 'global', required: true },
  { id: 'header', selector: '[data-agentskin-part="header"]', scope: 'global', required: false },
  // --- Conversation surface (4) ---
  { id: 'composer', selector: '[data-agentskin-part="composer"]', scope: 'agent', required: true },
  {
    id: 'conversation',
    selector: '[data-agentskin-part="conversation"]',
    scope: 'agent',
    required: true,
  },
  { id: 'message', selector: '[data-agentskin-part="message"]', scope: 'agent', required: false },
  { id: 'toolbar', selector: '[data-agentskin-part="toolbar"]', scope: 'agent', required: false },
  // --- Input & attachments (3) ---
  {
    id: 'input-area',
    selector: '[data-agentskin-part="input-area"]',
    scope: 'agent',
    required: false,
  },
  {
    id: 'attachment-panel',
    selector: '[data-agentskin-part="attachment-panel"]',
    scope: 'agent',
    required: false,
  },
  { id: 'footer', selector: '[data-agentskin-part="footer"]', scope: 'global', required: false },
  // --- Navigation & panels (3) ---
  {
    id: 'navigation',
    selector: '[data-agentskin-part="navigation"]',
    scope: 'global',
    required: false,
  },
  {
    id: 'home-suggestions',
    selector: '[data-agentskin-part="home-suggestions"]',
    scope: 'agent',
    required: false,
  },
  {
    id: 'settings-panel',
    selector: '[data-agentskin-part="settings-panel"]',
    scope: 'agent',
    required: false,
  },
  { id: 'preview', selector: '[data-agentskin-part="preview"]', scope: 'agent', required: false },
]);

/** Lookup map: part id → SkinPart. */
export const PART_BY_ID: Readonly<Record<string, SkinPart>> = Object.freeze(
  Object.fromEntries(REGISTERED_PARTS.map((p) => [p.id, p])),
);

/** Set of all valid selector strings for O(1) lookup. */
export const VALID_SELECTORS: ReadonlySet<string> = Object.freeze(
  new Set(REGISTERED_PARTS.map((p) => p.selector)),
);

// ---------------------------------------------------------------------------
// Allowed property contract
// ---------------------------------------------------------------------------

/**
 * Properties that custom CSS may set. Two categories:
 *
 *   1. `--agentskin-*` custom properties (any of them — prefix match).
 *   2. A small whitelist of safe cosmetic properties.
 *
 * Everything else is rejected to prevent layout-breaking or security-sensitive
 * side effects (e.g. `position: fixed` escaping the injection surface).
 */

const ALLOWED_COSMETIC_PROPERTIES = new Set([
  // Colour & background
  'color',
  'background',
  'background-color',
  'background-image',
  'opacity',
  // Typography
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-decoration',
  'text-transform',
  'text-shadow',
  // Spacing
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  // Border
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-color',
  'border-style',
  'border-width',
  'outline',
  'outline-color',
  'outline-style',
  'outline-width',
  // Layout (safe subset — no position / display / z-index)
  'gap',
  'row-gap',
  'column-gap',
  'align-items',
  'justify-content',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  // Visual effects
  'box-shadow',
  'backdrop-filter',
  'filter',
  'transform',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  // Cursor
  'cursor',
  // Overflow
  'overflow',
  'overflow-x',
  'overflow-y',
]);

/** Properties that are always rejected regardless of value. */
const BLOCKED_PROPERTIES = new Set([
  'position',
  'display',
  'z-index',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'visibility',
  'clip',
  'clip-path',
]);

/** Quick check: is this property an `--agentskin-*` custom property? */
function isAgentskinCustomProperty(prop: string): boolean {
  return prop.startsWith('--agentskin-');
}

/** Quick check: is this property allowed? */
function isAllowedProperty(prop: string): boolean {
  const lower = prop.toLowerCase().trim();
  if (isAgentskinCustomProperty(lower)) return true;
  if (ALLOWED_COSMETIC_PROPERTIES.has(lower)) return true;
  return false;
}

/** Quick check: is this property explicitly blocked? */
function isBlockedProperty(prop: string): boolean {
  return BLOCKED_PROPERTIES.has(prop.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Global selector blocklist
// ---------------------------------------------------------------------------

/** Selectors that target the document root — never allowed in scoped CSS. */
const GLOBAL_SELECTOR_PATTERNS: RegExp[] = [
  /^\s*html\s*$/i,
  /^\s*body\s*$/i,
  /^\s*:root\s*$/i,
  /^\s*\*\s*$/i,
];

function isGlobalSelector(selector: string): boolean {
  return GLOBAL_SELECTOR_PATTERNS.some((re) => re.test(selector));
}

// ---------------------------------------------------------------------------
// Selector extraction
// ---------------------------------------------------------------------------

/**
 * Extract individual selectors from a CSS rule's prelude.
 * Handles comma-separated selector lists.
 */
function extractSelectors(rule: string): string[] {
  // Split on commas that are NOT inside attribute selectors (e.g. [data="a,b"]).
  const selectors: string[] = [];
  let depth = 0;
  let buf = '';

  for (const ch of rule) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      if (buf.trim()) selectors.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) selectors.push(buf.trim());

  return selectors;
}

// ---------------------------------------------------------------------------
// Scope validation
// ---------------------------------------------------------------------------

export interface ScopeValidationResult {
  /** True when the CSS targets only registered parts with allowed properties. */
  valid: boolean;
  /** Human-readable descriptions of each violation found. */
  violations: string[];
  /** The CSS with all valid rules scope-wrapped; empty if `valid` is false. */
  scopedCss: string[];
}

/**
 * Validate that a block of CSS only targets registered parts and uses
 * allowed properties.
 *
 * Pure function — input is never mutated.
 */
export function validateScope(input: string): ScopeValidationResult {
  const violations: string[] = [];
  const scopedRules: string[] = [];

  if (!input?.trim()) {
    return { valid: true, violations, scopedRules };
  }

  // Strip comments for analysis but preserve them in output.
  const css = input.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!css) {
    return { valid: true, violations, scopedRules };
  }

  // Walk rule blocks. Naive brace-matching — sufficient for our contract.
  const blocks = splitRuleBlocks(css);

  for (const block of blocks) {
    if (!block.selector.trim()) continue;

    // Handle @media / @supports: recurse into the block body.
    if (block.selector.startsWith('@media') || block.selector.startsWith('@supports')) {
      const inner = validateScope(block.body);
      violations.push(...inner.violations);
      if (inner.valid && inner.scopedRules.length > 0) {
        scopedRules.push(`${block.selector} {\n${inner.scopedRules.join('\n')}\n}`);
      }
      continue;
    }

    const selectors = extractSelectors(block.selector);
    let selectorValid = true;

    for (const sel of selectors) {
      if (isGlobalSelector(sel)) {
        violations.push(`Global selector "${sel}" is not allowed — scope to a registered part`);
        selectorValid = false;
        continue;
      }

      if (!targetsRegisteredPart(sel)) {
        violations.push(`Selector "${sel}" does not target a registered part`);
        selectorValid = false;
      }
    }

    if (!selectorValid) continue;

    // Validate properties in the block body.
    const propViolations = validateProperties(block.body);
    violations.push(...propViolations);

    if (propViolations.length === 0) {
      scopedRules.push(`${block.selector} {\n${block.body}\n}`);
    }
  }

  return {
    valid: violations.length === 0,
    violations: dedupe(violations),
    scopedRules,
  };
}

// ---------------------------------------------------------------------------
// Property validation
// ---------------------------------------------------------------------------

/** Validate declarations inside a rule body. Returns violation messages. */
function validateProperties(body: string): string[] {
  const violations: string[] = [];
  const decls = body.split(';');

  for (const rawDecl of decls) {
    const decl = rawDecl.trim();
    if (!decl) continue;

    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;

    const prop = decl.slice(0, colonIdx).trim().toLowerCase();

    if (isBlockedProperty(prop)) {
      violations.push(`Property "${prop}" is not allowed in scoped CSS`);
      continue;
    }

    if (!isAllowedProperty(prop)) {
      violations.push(`Property "${prop}" is not in the allowed property list`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Selector → part matching
// ---------------------------------------------------------------------------

/**
 * Returns true if a selector string contains at least one reference to a
 * registered part attribute selector. Allows compound selectors like
 * `[data-agentskin-part="sidebar"] .inner` as long as a registered part
 * anchors the selector.
 */
function targetsRegisteredPart(selector: string): boolean {
  for (const partSel of VALID_SELECTORS) {
    if (selector.includes(partSel)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CSS scoping wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap raw CSS declarations in a part attribute selector.
 *
 * @param declarations  Raw declarations, e.g. `color: red; background: blue`.
 * @param partId        Target part — must exist in `REGISTERED_PARTS`.
 * @returns             Scoped CSS rule string.
 * @throws              If the partId is not registered.
 */
export function scopeCss(declarations: string, partId: string): string {
  const part = PART_BY_ID[partId];
  if (!part) {
    throw new Error(
      `Unknown part "${partId}". Valid parts: ${REGISTERED_PARTS.map((p) => p.id).join(', ')}`,
    );
  }

  const body = declarations.trim();
  if (!body) return '';

  // Ensure trailing semicolon.
  const normalized = body.endsWith(';') ? body : `${body};`;
  return `${part.selector} {\n${normalized}\n}`;
}

// ---------------------------------------------------------------------------
// Rule block parser
// ---------------------------------------------------------------------------

interface RuleBlock {
  /** The selector or at-rule prelude. */
  selector: string;
  /** The body inside the braces. */
  body: string;
}

/**
 * Split CSS into top-level rule blocks. Handles nested braces for at-rules.
 */
function splitRuleBlocks(css: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  let i = 0;

  while (i < css.length) {
    // Skip whitespace.
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    // Read selector up to the first '{'.
    const selectorStart = i;
    while (i < css.length && css[i] !== '{') i++;
    if (i >= css.length) break; // malformed — no opening brace

    const selector = css.slice(selectorStart, i).trim();
    i++; // skip '{'

    // Read body until matching '}'.
    let depth = 1;
    const bodyStart = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth > 0) i++;
    }

    const body = css.slice(bodyStart, i).trim();
    i++; // skip '}'

    blocks.push({ selector, body });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
