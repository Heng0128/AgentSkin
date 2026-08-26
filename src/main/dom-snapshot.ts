// SPDX-License-Identifier: MPL-2.0

/**
 * # dom-snapshot — Read-only DOM structure capture
 *
 * Walks a target agent's rendered DOM via a single CDP `Runtime.evaluate`
 * round-trip and returns a serializable snapshot of element structure:
 *
 *   - tag name + semantic class names
 *   - stable selector candidates (id, data-testid, role, aria-*)
 *   - viewport bounding box
 *   - a focused computed-style subset (layout + color only)
 *   - visibility flag
 *   - landmark matches against the adapter's known semantic anchors
 *
 * Deliberately **excludes** text content, form values, accessible names,
 * query/hash data, link hrefs, and media sources — this is a structural
 * snapshot for theme/studio analysis, not a content extraction tool.
 *
 * The walk runs inside the agent via `Runtime.evaluate` (one round trip)
 * rather than per-node protocol calls, keeping it fast for thousands of
 * nodes. Scripts / stylesheets / links / meta are skipped so the output
 * is inert.
 */

import type { AgentId } from '../shared/types';
import { type CdpSession, connectCdp } from './cdp/cdp-client';
import { findDomTargets } from './cdp/cdp-targets';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Bounding box in viewport coordinates (rounded to integer pixels). */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A stable selector candidate for targeting this element. */
export interface SelectorCandidate {
  /** The selector string (e.g. `#app`, `[data-testid="chat-input"]`, `.panel-root`). */
  selector: string;
  /** Kind of anchor — determines specificity ranking. */
  kind: 'id' | 'data-testid' | 'role' | 'class' | 'nth-child';
  /** Whether the selector matches exactly one element in the page. */
  unique: boolean;
}

/** A single captured DOM element (no text / no form values / no media). */
export interface DomElement {
  /** Best-effort unique selector for this element. */
  selector: string;
  /** Lowercased tag name (e.g. `div`, `button`, `input`). */
  tagName: string;
  /** Semantic class names (filtered to non-utility tokens). */
  classNames: string[];
  /** Viewport bounding box. */
  boundingBox: BoundingBox;
  /** Focused computed-style subset (layout + color). */
  computedStyle: Record<string, string>;
  /** Whether the element is visible (display !== none, opacity > 0, non-zero size). */
  isVisible: boolean;
  /** Stable selector candidates, ranked by specificity. */
  selectorCandidates: SelectorCandidate[];
  /** Depth in the DOM tree (0 = root). */
  depth: number;
  /** Number of direct element children. */
  childCount: number;
}

/** A landmark selector that matched (or missed) in the captured DOM. */
export interface LandmarkMatch {
  /** The landmark selector that was probed. */
  selector: string;
  /** Whether at least one element matched. */
  matched: boolean;
  /** Number of matched elements (0 when missed). */
  count: number;
  /** Bounding box of the first matched element, if any. */
  boundingBox?: BoundingBox;
}

/** The full DOM snapshot result. */
export interface DomSnapshot {
  /** Capture timestamp (ms since epoch). */
  timestamp: number;
  /** Adapter id (e.g. `traework`, `doubao`). */
  adapter: string;
  /** Page URL at capture time (query/hash stripped). */
  url: string;
  /** Captured elements (flat list, depth field encodes tree position). */
  elements: DomElement[];
  /** Landmark probe results. */
  landmarks: LandmarkMatch[];
  /** Total DOM elements walked (including skipped). */
  totalWalked: number;
  /** Capture duration in ms. */
  durationMs: number;
}

/** Options for `snapshotDom`. */
export interface DomSnapshotOptions {
  /** Max elements to capture (default 2000). */
  maxElements?: number;
  /** Max DOM depth to walk (default 12). */
  maxDepth?: number;
  /** Extra landmark selectors to probe (merged with adapter defaults). */
  extraLandmarks?: string[];
  /** Command timeout for the CDP evaluate call (default 15000ms). */
  commandTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Landmark selectors per adapter (semantic anchors for theme targeting)
// ---------------------------------------------------------------------------

const LANDMARK_SELECTORS: Record<string, string[]> = {
  codex: [
    '.panel-container',
    '.agents-sidebar',
    '.chat-input-box',
    '.chat-input-textarea',
    '.agent-card',
    '.message-bubble',
    '.nav-item',
    '.toolbar-container',
    '.title-bar',
    '.settings-panel',
  ],
  doubao: [
    '.main-container',
    '.sidebar-nav',
    '.chat-input-area',
    '.chat-input-editor',
    '.conversation-list-item',
    '.message-content',
    '.model-selector',
    '.header-bar',
    '.panel-root',
    '.tab-bar',
  ],
  qoderwork: [
    '.panel-container',
    '.sidebar-wrapper',
    '.chat-input-container',
    '.chat-input-textarea',
    '.message-card',
    '.code-block',
    '.nav-item',
    '.top-bar',
    '.title-bar',
    '.editor-container',
  ],
  traework: [
    '.panel-container',
    '.agents-sidebar',
    '.chat-input-box',
    '.chat-input-textarea',
    '.agent-card',
    '.message-bubble',
    '.nav-item',
    '.toolbar-container',
    '.title-bar',
    '.settings-panel',
  ],
  workbuddy: [
    '.teams-main-content',
    '.wb-home-page',
    '.sidebar-panel',
    '.chat-input-container',
    '.input-toolbar',
    '.message-cell',
    '.conversation-list',
    '.nav-tab',
    '.header-bar',
    '.settings-modal',
  ],
  zcode: [
    '.panel-container',
    '.sidebar-wrapper',
    '.chat-input-container',
    '.chat-input-textarea',
    '.message-card',
    '.code-block',
    '.nav-item',
    '.top-bar',
    '.title-bar',
    '.editor-container',
  ],
};

const GLOBAL_LANDMARKS = [
  'body',
  ':root',
  'html',
  '.app-shell',
  '.main-layout',
  '[role="main"]',
  '[role="navigation"]',
  '[role="complementary"]',
];

// ---------------------------------------------------------------------------
// Computed-style properties to capture (layout + color only)
// ---------------------------------------------------------------------------

const SNAPSHOT_STYLE_PROPS = [
  'background-color',
  'color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'box-shadow',
  'display',
  'position',
  'visibility',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'top',
  'left',
  'right',
  'bottom',
  'transform',
  'z-index',
  'box-sizing',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'cursor',
  'pointer-events',
  'transition',
  'animation',
] as const;

// ---------------------------------------------------------------------------
// Tags to skip (non-semantic / inert)
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'noscript',
  'template',
  'svg',
  'path',
  'use',
  'symbol',
  'defs',
  'clippath',
  'mask',
  'filter',
  'stop',
  'lineargradient',
  'radialgradient',
]);

// ---------------------------------------------------------------------------
// Inline walk expression (runs inside the agent via Runtime.evaluate)
// ---------------------------------------------------------------------------

/**
 * Build the JavaScript expression that walks the DOM inside the agent.
 *
 * The expression is a self-contained async IIFE that:
 *   1. Walks `document.body` recursively (depth/node bounded).
 *   2. For each element, collects tag, classes, bounding box, a focused
 *      computed-style subset, visibility, and selector candidates.
 *   3. Skips script/style/link/meta and SVG internals.
 *   4. Returns a flat array of `RawDomElement` (see inline type).
 *
 * No text content, form values, accessible names, or media sources are
 * collected — the walk is purely structural.
 */
function buildWalkExpression(maxElements: number, maxDepth: number, styleProps: string[]): string {
  return `(async function(){
    var PROPS = ${JSON.stringify(styleProps)};
    var SKIP = ${JSON.stringify([...SKIP_TAGS])};
    var MAX_EL = ${maxElements};
    var MAX_DEPTH = ${maxDepth};
    var count = 0;
    var results = [];

    // Utility-class heuristic: skip classes that look like Tailwind /
    // CSS-module hashes (short alphanumeric with no semantic meaning).
    function isSemanticClass(c){
      if (!c) return false;
      // Keep classes with semantic separators
      if (/[-_A-Z]/.test(c)) return true;
      // Skip pure hashes (e.g. "css-1w23xea", "sc-1a2b3c")
      if (/^(css|sc|cx|-[a-z0-9]{4,})$/i.test(c)) return false;
      // Skip single-char or pure numeric
      if (/^[a-z0-9]{1,3}$/i.test(c)) return false;
      return true;
    }

    function buildCandidates(el){
      var cands = [];
      // id
      var id = el.id;
      if (id && /^[a-zA-Z]/.test(id) && !/[^a-zA-Z0-9_-]/.test(id)) {
        cands.push({ selector: '#' + id, kind: 'id', unique: true });
      }
      // data-testid
      var testid = el.getAttribute && el.getAttribute('data-testid');
      if (testid) {
        cands.push({ selector: '[data-testid="' + testid.replace(/"/g, '\\\\"') + '"]', kind: 'data-testid', unique: true });
      }
      // role
      var role = el.getAttribute && el.getAttribute('role');
      if (role) {
        cands.push({ selector: '[role="' + role + '"]', kind: 'role', unique: false });
      }
      // semantic class (first one)
      var cls = el.getAttribute && el.getAttribute('class');
      if (cls) {
        var parts = cls.split(/\\s+/).filter(function(c){ return isSemanticClass(c); });
        if (parts.length > 0) {
          cands.push({ selector: '.' + parts[0], kind: 'class', unique: false });
        }
      }
      return cands;
    }

    function isVisible(el, cs){
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden') return false;
      var op = parseFloat(cs.opacity);
      if (!isNaN(op) && op <= 0) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return false;
      return true;
    }

    function walk(el, depth){
      if (!el || count >= MAX_EL || depth > MAX_DEPTH) return;
      if (el.nodeType !== 1) return;
      var tag = (el.tagName || 'div').toLowerCase();
      if (SKIP.indexOf(tag) !== -1) return;
      count++;

      var cs = window.getComputedStyle(el);
      var style = {};
      for (var i = 0; i < PROPS.length; i++) {
        var v = cs.getPropertyValue(PROPS[i]);
        if (v) style[PROPS[i]] = v;
      }

      var r = el.getBoundingClientRect();
      var box = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };

      var cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
      var classNames = cls.split(/\\s+/).filter(function(c){ return isSemanticClass(c); });

      var cands = buildCandidates(el);
      var best = cands.length > 0 ? cands[0].selector : tag;

      results.push({
        selector: best,
        tagName: tag,
        classNames: classNames,
        boundingBox: box,
        computedStyle: style,
        isVisible: isVisible(el, cs),
        selectorCandidates: cands,
        depth: depth,
        childCount: el.children ? el.children.length : 0
      });

      var kids = el.children;
      for (var k = 0; k < kids.length; k++) {
        walk(kids[k], depth + 1);
      }
      // Pierce open shadow roots
      if (el.shadowRoot && el.shadowRoot.mode === 'open') {
        var sk = el.shadowRoot.children;
        for (var s = 0; s < sk.length; s++) {
          walk(sk[s], depth + 1);
        }
      }
    }

    var root = document.body;
    if (!root) return JSON.stringify({ elements: [], totalWalked: 0 });
    walk(root, 0);
    return JSON.stringify({ elements: results, totalWalked: count });
  })()`;
}

// ---------------------------------------------------------------------------
// Landmark probe expression
// ---------------------------------------------------------------------------

function buildLandmarkExpression(selectors: string[]): string {
  return `(function(){
    var selectors = ${JSON.stringify(selectors)};
    var results = [];
    for (var i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      var matched = false;
      var count = 0;
      var box = null;
      try {
        var els = document.querySelectorAll(sel);
        count = els.length;
        if (count > 0) {
          matched = true;
          var r = els[0].getBoundingClientRect();
          box = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
        }
      } catch(e) {
        // invalid selector — report as miss
      }
      var entry = { selector: sel, matched: matched, count: count };
      if (box) entry.boundingBox = box;
      results.push(entry);
    }
    return JSON.stringify(results);
  })()`;
}

// ---------------------------------------------------------------------------
// URL sanitization (strip query + hash)
// ---------------------------------------------------------------------------

function sanitizeUrl(raw: string): string {
  if (!raw) return '';
  let idx: number;
  try {
    idx = raw.search(/[?#]/);
    return idx === -1 ? raw : raw.slice(0, idx);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a read-only DOM snapshot of the agent reachable at `port`.
 *
 * Connects to the first DOM-bearing CDP target, walks the rendered DOM via a
 * single `Runtime.evaluate`, and returns a structured snapshot. Never
 * mutates the target — purely a read operation.
 *
 * @param adapter  Agent id (e.g. `traework`, `doubao`).
 * @param port     CDP debug port.
 * @param options  Optional capture bounds.
 * @returns A `DomSnapshot`, or `null` if no DOM target is reachable.
 */
export async function snapshotDom(
  adapter: AgentId,
  port: number,
  options: DomSnapshotOptions = {},
): Promise<DomSnapshot | null> {
  const maxElements = options.maxElements ?? 2000;
  const maxDepth = options.maxDepth ?? 12;
  const commandTimeoutMs = options.commandTimeoutMs ?? 15000;
  const startedAt = Date.now();

  // Discover DOM-bearing targets
  const targets = await findDomTargets(port);
  if (targets.length === 0 || !targets[0].webSocketDebuggerUrl) {
    return null;
  }

  const wsUrl = targets[0].webSocketDebuggerUrl;
  let session: CdpSession | null = null;

  try {
    session = await connectCdp(wsUrl, 5000, commandTimeoutMs);

    // Capture page URL (sanitized)
    let pageUrl = '';
    try {
      const urlResult = await session.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      });
      pageUrl = sanitizeUrl(urlResult?.result?.value ?? '');
    } catch {
      // Best-effort URL capture
    }

    // DOM Element type for JSON parse result
    interface RawWalkResult {
      elements: DomElement[];
      totalWalked: number;
    }

    // Walk DOM (best-effort: a walk failure leaves elements empty)
    let elements: DomElement[] = [];
    let totalWalked = 0;
    try {
      const walkExpr = buildWalkExpression(maxElements, maxDepth, [...SNAPSHOT_STYLE_PROPS]);
      const walkResult = await session.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: walkExpr,
        returnByValue: true,
        awaitPromise: true,
      });

      const walkRaw = walkResult?.result?.value;
      if (walkRaw && typeof walkRaw === 'string' && walkRaw !== 'null') {
        try {
          const parsed = JSON.parse(walkRaw) as RawWalkResult;
          elements = parsed.elements ?? [];
          totalWalked = parsed.totalWalked ?? 0;
        } catch {
          // Malformed result — leave elements empty
        }
      }
    } catch {
      // Walk evaluate failed (timeout, renderer gone) — leave elements empty
    }

    // Probe landmarks
    const baseLandmarks = LANDMARK_SELECTORS[adapter] ?? GLOBAL_LANDMARKS;
    const extraLandmarks = options.extraLandmarks ?? [];
    const allLandmarks = [...new Set([...baseLandmarks, ...GLOBAL_LANDMARKS, ...extraLandmarks])];

    let landmarks: LandmarkMatch[] = [];
    try {
      const lmExpr = buildLandmarkExpression(allLandmarks);
      const lmResult = await session.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: lmExpr,
        returnByValue: true,
      });
      const lmRaw = lmResult?.result?.value;
      if (lmRaw && typeof lmRaw === 'string' && lmRaw !== 'null') {
        landmarks = JSON.parse(lmRaw) as LandmarkMatch[];
      }
    } catch {
      // Best-effort landmark probe
    }

    return {
      timestamp: Date.now(),
      adapter,
      url: pageUrl,
      elements,
      landmarks,
      totalWalked,
      durationMs: Date.now() - startedAt,
    };
  } catch {
    return null;
  } finally {
    if (session) session.close();
  }
}
