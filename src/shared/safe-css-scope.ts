// SPDX-License-Identifier: MPL-2.0

/**
 * # Safe-CSS Scope Validator & Wrapper
 *
 * Complements `safe-css.ts` (which sanitises property values) by enforcing
 * **selector scope**: user-authored custom CSS may only target registered
 * `data-agentskin-part` components.
 *
 * ## Three exports
 *
 *   1. `REGISTERED_PARTS` — the 14-part registry.
 *   2. `validateScope(css)` — returns `{ valid, violations, scopedRules }`.
 *   3. `scopeCss(css, partId)` — wraps declarations in a part attribute selector.
 *
 * Inspired by Codex Dream Skin's `SELECTOR_CONTRACT`.
 */

// ---------------------------------------------------------------------------
// Part registry (14 parts)
// ---------------------------------------------------------------------------

export type PartScope = 'global' | 'agent';

export interface SkinPart {
  id: string;
  selector: string;
  scope: PartScope;
  required: boolean;
}

export const REGISTERED_PARTS: readonly SkinPart[] = Object.freeze([
  // Global shell
  {
    id: 'shell-main',
    selector: '[data-agentskin-part="shell-main"]',
    scope: 'global',
    required: true,
  },
  { id: 'sidebar', selector: '[data-agentskin-part="sidebar"]', scope: 'global', required: true },
  { id: 'header', selector: '[data-agentskin-part="header"]', scope: 'global', required: false },
  // Conversation surface
  { id: 'composer', selector: '[data-agentskin-part="composer"]', scope: 'agent', required: true },
  {
    id: 'conversation',
    selector: '[data-agentskin-part="conversation"]',
    scope: 'agent',
    required: true,
  },
  { id: 'message', selector: '[data-agentskin-part="message"]', scope: 'agent', required: false },
  { id: 'toolbar', selector: '[data-agentskin-part="toolbar"]', scope: 'agent', required: false },
  // Input & attachments
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
  // Navigation & panels
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

export const PART_BY_ID: Readonly<Record<string, SkinPart>> = Object.freeze(
  Object.fromEntries(REGISTERED_PARTS.map((p) => [p.id, p])),
);

export const VALID_SELECTORS: ReadonlySet<string> = Object.freeze(
  new Set(REGISTERED_PARTS.map((p) => p.selector)),
);

// ---------------------------------------------------------------------------
// Property contract
// ---------------------------------------------------------------------------

const ALLOWED_COSMETIC = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'opacity',
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
  'box-shadow',
  'backdrop-filter',
  'filter',
  'transform',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'cursor',
  'overflow',
  'overflow-x',
  'overflow-y',
]);

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

function isAllowedProperty(prop: string): boolean {
  const lower = prop.toLowerCase().trim();
  return lower.startsWith('--agentskin-') || ALLOWED_COSMETIC.has(lower);
}

const isBlockedProperty = (prop: string): boolean =>
  BLOCKED_PROPERTIES.has(prop.toLowerCase().trim());

// ---------------------------------------------------------------------------
// Global selector blocklist
// ---------------------------------------------------------------------------

const GLOBAL_SELECTOR_RE = /^\s*(html|body|:root|\*)\s*$/i;

// ---------------------------------------------------------------------------
// Scope validation
// ---------------------------------------------------------------------------

export interface ScopeValidationResult {
  valid: boolean;
  violations: string[];
  scopedRules: string[];
}

export function validateScope(input: string): ScopeValidationResult {
  const violations: string[] = [];
  const scopedRules: string[] = [];

  if (!input?.trim()) return { valid: true, violations, scopedRules };

  const css = input.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!css) return { valid: true, violations, scopedRules };

  for (const block of splitRuleBlocks(css)) {
    if (!block.selector.trim()) continue;

    // Recurse into @media / @supports
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
      if (GLOBAL_SELECTOR_RE.test(sel)) {
        violations.push(`Global selector "${sel}" is not allowed — scope to a registered part`);
        selectorValid = false;
      } else if (!targetsRegisteredPart(sel)) {
        violations.push(`Selector "${sel}" does not target a registered part`);
        selectorValid = false;
      }
    }

    if (!selectorValid) continue;

    const propViolations = validateProperties(block.body);
    violations.push(...propViolations);
    if (propViolations.length === 0) {
      scopedRules.push(`${block.selector} {\n${block.body}\n}`);
    }
  }

  return { valid: violations.length === 0, violations: dedupe(violations), scopedRules };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateProperties(body: string): string[] {
  const violations: string[] = [];
  for (const rawDecl of body.split(';')) {
    const decl = rawDecl.trim();
    if (!decl) continue;
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    if (isBlockedProperty(prop)) {
      violations.push(`Property "${prop}" is not allowed in scoped CSS`);
    } else if (!isAllowedProperty(prop)) {
      violations.push(`Property "${prop}" is not in the allowed property list`);
    }
  }
  return violations;
}

function targetsRegisteredPart(selector: string): boolean {
  for (const partSel of VALID_SELECTORS) {
    if (selector.includes(partSel)) return true;
  }
  return false;
}

function extractSelectors(rule: string): string[] {
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

interface RuleBlock {
  selector: string;
  body: string;
}

function splitRuleBlocks(css: string): RuleBlock[] {
  const blocks: RuleBlock[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    const selStart = i;
    while (i < css.length && css[i] !== '{') i++;
    if (i >= css.length) break;
    const selector = css.slice(selStart, i).trim();
    i++;
    let depth = 1;
    const bodyStart = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      if (depth > 0) i++;
    }
    blocks.push({ selector, body: css.slice(bodyStart, i).trim() });
    i++;
  }
  return blocks;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// CSS scoping wrapper
// ---------------------------------------------------------------------------

export function scopeCss(declarations: string, partId: string): string {
  const part = PART_BY_ID[partId];
  if (!part) {
    throw new Error(
      `Unknown part "${partId}". Valid parts: ${REGISTERED_PARTS.map((p) => p.id).join(', ')}`,
    );
  }
  const body = declarations.trim();
  if (!body) return '';
  const normalized = body.endsWith(';') ? body : `${body};`;
  return `${part.selector} {\n${normalized}\n}`;
}
