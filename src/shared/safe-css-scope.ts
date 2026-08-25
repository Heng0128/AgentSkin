// SPDX-License-Identifier: MPL-2.0

/**
 * # Safe-CSS Scope Validator & Wrapper
 *
 * Complements `safe-css.ts` (which sanitises property values) by enforcing
 * **selector scope**: user-authored custom CSS may only target registered
 * `data-agentskin-part` components.
 *
 * Exports: `REGISTERED_PARTS`, `validateScope(css)`, `scopeCss(css, partId)`.
 * Inspired by Codex Dream Skin's `SELECTOR_CONTRACT`.
 */

export type PartScope = 'global' | 'agent';

export interface SkinPart {
  id: string;
  selector: string;
  scope: PartScope;
  required: boolean;
}

// ---------------------------------------------------------------------------
// Part registry (14 parts)
// ---------------------------------------------------------------------------

const sel = (id: string): string => `[data-agentskin-part="${id}"]`;

export const REGISTERED_PARTS: readonly SkinPart[] = Object.freeze([
  { id: 'shell-main', selector: sel('shell-main'), scope: 'global', required: true },
  { id: 'sidebar', selector: sel('sidebar'), scope: 'global', required: true },
  { id: 'header', selector: sel('header'), scope: 'global', required: false },
  { id: 'composer', selector: sel('composer'), scope: 'agent', required: true },
  { id: 'conversation', selector: sel('conversation'), scope: 'agent', required: true },
  { id: 'message', selector: sel('message'), scope: 'agent', required: false },
  { id: 'toolbar', selector: sel('toolbar'), scope: 'agent', required: false },
  { id: 'input-area', selector: sel('input-area'), scope: 'agent', required: false },
  { id: 'attachment-panel', selector: sel('attachment-panel'), scope: 'agent', required: false },
  { id: 'footer', selector: sel('footer'), scope: 'global', required: false },
  { id: 'navigation', selector: sel('navigation'), scope: 'global', required: false },
  { id: 'home-suggestions', selector: sel('home-suggestions'), scope: 'agent', required: false },
  { id: 'settings-panel', selector: sel('settings-panel'), scope: 'agent', required: false },
  { id: 'preview', selector: sel('preview'), scope: 'agent', required: false },
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
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'border-color',
  'border-style',
  'border-width',
  'outline',
  'outline-color',
  'outline-style',
  'outline-width',
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

const BLOCKED = new Set([
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

const isAllowed = (prop: string): boolean => {
  const l = prop.toLowerCase().trim();
  return l.startsWith('--agentskin-') || ALLOWED_COSMETIC.has(l);
};

const isBlocked = (prop: string): boolean => BLOCKED.has(prop.toLowerCase().trim());

const GLOBAL_RE = /^\s*(html|body|:root|\*)\s*$/i;

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

  for (const block of splitBlocks(css)) {
    if (!block.selector.trim()) continue;

    if (block.selector.startsWith('@media') || block.selector.startsWith('@supports')) {
      const inner = validateScope(block.body);
      violations.push(...inner.violations);
      if (inner.valid && inner.scopedRules.length > 0) {
        scopedRules.push(`${block.selector} {\n${inner.scopedRules.join('\n')}\n}`);
      }
      continue;
    }

    let selectorValid = true;
    for (const sel of extractSelectors(block.selector)) {
      if (GLOBAL_RE.test(sel)) {
        violations.push(`Global selector "${sel}" is not allowed — scope to a registered part`);
        selectorValid = false;
      } else if (!targetsPart(sel)) {
        violations.push(`Selector "${sel}" does not target a registered part`);
        selectorValid = false;
      }
    }
    if (!selectorValid) continue;

    const propViolations = validateProps(block.body);
    violations.push(...propViolations);
    if (propViolations.length === 0) scopedRules.push(`${block.selector} {\n${block.body}\n}`);
  }

  return { valid: violations.length === 0, violations: dedupe(violations), scopedRules };
}

function validateProps(body: string): string[] {
  const violations: string[] = [];
  for (const raw of body.split(';')) {
    const decl = raw.trim();
    if (!decl) continue;
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (isBlocked(prop)) violations.push(`Property "${prop}" is not allowed in scoped CSS`);
    else if (!isAllowed(prop))
      violations.push(`Property "${prop}" is not in the allowed property list`);
  }
  return violations;
}

function targetsPart(selector: string): boolean {
  for (const s of VALID_SELECTORS) {
    if (selector.includes(s)) return true;
  }
  return false;
}

function extractSelectors(rule: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of rule) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

interface Block {
  selector: string;
  body: string;
}

function splitBlocks(css: string): Block[] {
  const blocks: Block[] = [];
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
  if (!part)
    throw new Error(
      `Unknown part "${partId}". Valid parts: ${REGISTERED_PARTS.map((p) => p.id).join(', ')}`,
    );
  const body = declarations.trim();
  if (!body) return '';
  return `${part.selector} {\n${body.endsWith(';') ? body : `${body};`}\n}`;
}
