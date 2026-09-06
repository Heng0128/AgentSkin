// SPDX-License-Identifier: MPL-2.0

/**
 * # node-cascade — DevTools-grade single-node probe
 *
 * Shared by the offline snapshot (`snapshot-theme.ts`) and the live inspector
 * (`inspect-session.ts`). Replaces the old hand-rolled `getComputedStyle`
 * probe with the same CDP stack Chrome DevTools uses for its Elements panel:
 *
 *   - `CSS.getMatchedStylesForNode` → the full cascade: every matching rule
 *     (selector, origin, source, `!important`) — answers "which selector set
 *     this property?" which is the key to faithful theme replication.
 *   - `CSS.getComputedStyleForNode` → authoritative final computed values
 *     (all longhands), more reliable than `window.getComputedStyle`.
 *   - `CSS.getPlatformFontsForNode` → the actually-rendered font family
 *     names (resolves `@font-face`), so the font dimension is real.
 *   - `DOM.getBoxModel` → protocol-level geometry (absolute coords, aware of
 *     transforms and scroll), replacing `getBoundingClientRect`.
 *
 * Each sub-call is best-effort: if a domain is unavailable the corresponding
 * slice is left empty rather than throwing, so callers always get a result.
 */

import type { CssDeclaration, CssMatchedRule, NodeCascade } from '../../shared/types';
import type { CdpSession } from './cdp-client';

type SendCapable = Pick<CdpSession, 'send'>;

// --- Minimal CDP response shapes (only the fields we read) -------------------

interface CdpCssProperty {
  name: string;
  value: string;
  important?: boolean;
  disabled?: boolean;
}

interface CdpMatchedRule {
  rule: {
    selectorList?: { text?: string };
    origin?: string;
    styleSheetId?: string;
    style: { cssProperties: CdpCssProperty[] };
  };
}

interface GetMatchedStylesResult {
  inlineStyle?: { cssProperties: CdpCssProperty[] };
  attributesStyle?: { cssProperties: CdpCssProperty[] };
  matchedCSSRules?: CdpMatchedRule[];
  inherited?: Array<{ matchedCSSRules?: CdpMatchedRule[] }>;
}

interface GetComputedStyleResult {
  computedStyle: Array<{ name: string; value: string }>;
}

interface GetPlatformFontsResult {
  fonts: Array<{ familyName: string; glyphCount?: number }>;
}

interface GetBoxModelResult {
  model: {
    width: number;
    height: number;
    content: number[]; // [x1, y1, x2, y2, ...]
  };
}

// --- Helpers -----------------------------------------------------------------

function normalizeOrigin(origin: string | undefined, inline: boolean): CssMatchedRule['origin'] {
  if (inline) return 'inline';
  switch (origin) {
    case 'user-agent':
      return 'user-agent';
    case 'user':
      return 'user';
    case 'keyframes':
      return 'keyframes';
    default:
      return 'regular';
  }
}

function toDeclarations(props: CdpCssProperty[] | undefined): CssDeclaration[] {
  if (!props) return [];
  const out: CssDeclaration[] = [];
  for (const p of props) {
    // Skip empty-name entries (CSS sometimes emits a synthetic "" property).
    if (!p.name) continue;
    if (p.disabled) continue;
    out.push({
      name: p.name,
      value: p.value,
      important: Boolean(p.important),
    });
  }
  return out;
}

function sourceLabel(origin: CssMatchedRule['origin'], styleSheetId?: string): string {
  if (origin === 'inline') return 'inline style';
  if (origin === 'user-agent') return 'user agent stylesheet';
  if (origin === 'user') return 'user stylesheet';
  if (styleSheetId) return `stylesheet ${styleSheetId.slice(0, 8)}`;
  return 'author stylesheet';
}

// --- Public API --------------------------------------------------------------

/**
 * Capture the full cascade + computed style + fonts + geometry for one node.
 * `nodeId` must be a DOM-domain nodeId resolved in the current session
 * (via `DOM.querySelector` or `DOM.pushNodesByBackendIdsToFrontend`).
 */
export async function captureNodeCascade(
  session: SendCapable,
  nodeId: number,
  opts?: { pseudoStates?: string[] },
): Promise<NodeCascade> {
  const cascade: NodeCascade = {
    computed: [],
    matchedRules: [],
    platformFonts: [],
    boxModel: null,
  };

  // Optionally force pseudo-classes (hover/focus/active) so the captured
  // computed/matched values reflect the pseudo-affected state. Reset after.
  const pseudo = opts?.pseudoStates ?? [];
  if (pseudo.length) {
    try {
      await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudo });
    } catch {
      /* pseudo forcing unsupported — fall through to normal capture */
    }
  }

  // 1) Cascade (matched rules + inline). Best-effort.
  try {
    const matched = await session.send<GetMatchedStylesResult>('CSS.getMatchedStylesForNode', {
      nodeId,
    });

    if (matched.inlineStyle) {
      cascade.matchedRules.push({
        selector: null,
        origin: 'inline',
        source: 'inline style',
        declarations: toDeclarations(matched.inlineStyle.cssProperties),
      });
    }

    if (matched.attributesStyle) {
      cascade.matchedRules.push({
        selector: null,
        origin: 'inline',
        source: 'presentational attributes',
        declarations: toDeclarations(matched.attributesStyle.cssProperties),
      });
    }

    const pushRules = (rules: CdpMatchedRule[] | undefined) => {
      if (!rules) return;
      for (const r of rules) {
        const origin = normalizeOrigin(r.rule.origin, false);
        cascade.matchedRules.push({
          selector: r.rule.selectorList?.text ?? null,
          origin,
          source: sourceLabel(origin, r.rule.styleSheetId),
          styleSheetId: r.rule.styleSheetId,
          declarations: toDeclarations(r.rule.style.cssProperties),
        });
      }
    };

    pushRules(matched.matchedCSSRules);
    if (matched.inherited) {
      for (const inh of matched.inherited) pushRules(inh.matchedCSSRules);
    }
  } catch {
    // CSS domain unavailable — leave matchedRules empty.
  }

  // 2) Authoritative computed values. Best-effort.
  try {
    const computed = await session.send<GetComputedStyleResult>('CSS.getComputedStyleForNode', {
      nodeId,
    });
    cascade.computed = (computed.computedStyle ?? []).map((c) => ({
      property: c.name,
      value: c.value,
    }));
  } catch {
    /* leave computed empty */
  }

  // 3) Actually-rendered fonts. Best-effort.
  try {
    const fonts = await session.send<GetPlatformFontsResult>('CSS.getPlatformFontsForNode', {
      nodeId,
    });
    cascade.platformFonts = (fonts.fonts ?? []).map((f) => f.familyName);
  } catch {
    /* leave platformFonts empty */
  }

  // 4) Protocol-level box model. Best-effort.
  try {
    const box = await session.send<GetBoxModelResult>('DOM.getBoxModel', { nodeId });
    if (box?.model) {
      const [x1, y1] = box.model.content;
      cascade.boxModel = {
        width: Math.round(box.model.width),
        height: Math.round(box.model.height),
        left: Math.round(x1),
        top: Math.round(y1),
      };
    }
  } catch {
    /* leave boxModel null */
  }

  // Release any forced pseudo state so the live session is left clean.
  if (pseudo.length) {
    try {
      await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    } catch {
      /* ignore */
    }
  }

  return cascade;
}

/**
 * Build the compact `styles` subset (the old computed-style contract) from a
 * full computed map, for the properties the replica renderer cares about.
 * Keeps `computeSignature` and the mock frame working unchanged.
 */
export function compactStylesFromComputed(
  computed: Array<{ property: string; value: string }>,
  props: readonly string[],
): Array<{ property: string; value: string }> {
  const map = new Map(computed.map((c) => [c.property, c.value]));
  const out: Array<{ property: string; value: string }> = [];
  for (const p of props) {
    const v = map.get(p);
    if (v !== undefined) out.push({ property: p, value: v });
  }
  return out;
}
