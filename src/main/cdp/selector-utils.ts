// SPDX-License-Identifier: MPL-2.0

/**
 * # selector-utils
 *
 * CDP-based CSS selector generation and validation services.
 * Consolidates the previous selector-generator and selector-validator modules.
 *
 * Two functional areas:
 *   1. **Selector generation** — 5-strategy fallback chain to produce unique
 *      CSS selectors for DOM elements.
 *   2. **Selector validation** — batch probing of selectors against a live
 *      CDP session with bounded concurrency.
 */

import type { SelectorProbeResult, SelectorValidationReport } from '@shared/types/selector-probe';
import type { CdpSession } from './cdp-client';

// =============================================================================
// Section 1: Selector Generation
// =============================================================================

export type SelectorGenerationStrategy =
  | 'id'
  | 'class-combination'
  | 'attribute'
  | 'parent-context'
  | 'position-fallback';

export interface SelectorGenerationResult {
  /** The generated CSS selector string. */
  selector: string;
  /** Which strategy produced the selector. */
  strategy: SelectorGenerationStrategy;
  /** Whether the selector matches exactly one element in the document. */
  unique: boolean;
}

/** JSON-serializable result shape returned by the IIFE. */
interface RawGenerationResult {
  selector: string | null;
  strategy?: SelectorGenerationStrategy;
  unique?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Class filtering
// ---------------------------------------------------------------------------

/** Matches hash-based class names like `abc-1f2d3c`. */
const HASH_CLASS_RE = /^[a-z][a-z0-9]+-[a-f0-9]+$/i;

/**
 * Determine whether a class name is "useful" for selector generation.
 *
 * Filters out CSS Modules generated classes (`__`), hash-based names, and
 * excessively long class names — those are overly specific or unstable.
 */
function isUsefulClass(cls: string): boolean {
  return cls.length > 0 && !cls.startsWith('__') && !HASH_CLASS_RE.test(cls) && cls.length <= 25;
}

// ---------------------------------------------------------------------------
// Selector generation (runs inside the page)
// ---------------------------------------------------------------------------

/**
 * Build the IIFE that runs inside the page to generate a unique selector.
 *
 * The IIFE receives the target selector as a JSON-stringified literal to
 * avoid injection. It locates the target element then runs the 5-strategy
 * fallback chain. All DOM operations happen in the page context — the IIFE
 * returns a JSON string.
 */
function buildGenerationIife(targetSelector: string): string {
  const sel = JSON.stringify(targetSelector);
  return `(() => {
    var TARGETSel = ${sel};
    var HASH_CLASS_RE = /^[a-z][a-z0-9]+-[a-f0-9]+$/i;
    function isUsefulClass(cls) {
      return cls.length > 0 && !cls.startsWith('__') && !HASH_CLASS_RE.test(cls) && cls.length <= 25;
    }
    function testSelector(sel, targetEl) {
      try {
        var found = document.querySelectorAll(sel);
        return found.length === 1 && found[0] === targetEl;
      } catch (e) {
        return false;
      }
    }
    function cssEscape(s) {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
      return s.replace(/[^a-zA-Z0-9_-]/g, function(c) { return '\\\\' + c; });
    }

    var el = document.querySelector(TARGETSel);
    if (!el) {
      return JSON.stringify({ selector: null, error: 'target element not found' });
    }

    if (el.id) {
      var idSel = '#' + cssEscape(el.id);
      if (testSelector(idSel, el)) {
        return JSON.stringify({ selector: idSel, strategy: 'id', unique: true });
      }
    }

    if (el.className && typeof el.className === 'string') {
      var classes = el.className.trim().split(/\\s+/).filter(isUsefulClass);
      var maxClasses = Math.min(3, classes.length);
      for (var i = maxClasses; i > 0; i--) {
        var classCombo = classes.slice(0, i).map(function(c) { return cssEscape(c); }).join('.');
        var classSel = el.tagName.toLowerCase() + '.' + classCombo;
        if (testSelector(classSel, el)) {
          return JSON.stringify({ selector: classSel, strategy: 'class-combination', unique: true });
        }
      }
    }

    var uniqueAttrs = ['name', 'type', 'role', 'data-testid', 'aria-label', 'title', 'placeholder'];
    for (var a = 0; a < uniqueAttrs.length; a++) {
      var attr = uniqueAttrs[a];
      if (el.hasAttribute(attr)) {
        var attrVal = el.getAttribute(attr);
        var attrSel = el.tagName.toLowerCase() + '[' + attr + '="' + cssEscape(attrVal) + '"]';
        if (testSelector(attrSel, el)) {
          return JSON.stringify({ selector: attrSel, strategy: 'attribute', unique: true });
        }
      }
    }

    if (el.parentElement && el.parentElement !== document.body) {
      var parent = el.parentElement;
      var parentSel = null;
      if (parent.id) {
        var pidSel = '#' + cssEscape(parent.id);
        if (document.querySelectorAll(pidSel).length === 1) {
          parentSel = pidSel;
        }
      }
      if (!parentSel && parent.className && typeof parent.className === 'string') {
        var pClasses = parent.className.trim().split(/\\s+/).filter(isUsefulClass);
        var pMax = Math.min(3, pClasses.length);
        for (var pi = pMax; pi > 0; pi--) {
          var pCombo = pClasses.slice(0, pi).map(function(c) { return cssEscape(c); }).join('.');
          var pSel = parent.tagName.toLowerCase() + '.' + pCombo;
          if (document.querySelectorAll(pSel).length === 1) {
            parentSel = pSel;
            break;
          }
        }
      }
      if (parentSel) {
        var siblings = Array.from(parent.children).filter(function(child) {
          return child.tagName === el.tagName;
        });
        var tagIndex = siblings.indexOf(el) + 1;
        var nthSel = parentSel + ' > ' + el.tagName.toLowerCase() + ':nth-of-type(' + tagIndex + ')';
        if (testSelector(nthSel, el)) {
          return JSON.stringify({ selector: nthSel, strategy: 'parent-context', unique: true });
        }
      }
    }

    var current = el;
    var parts = [];
    var depth = 0;
    var maxDepth = 3;
    while (current && current !== document.body && depth < maxDepth) {
      var tag = current.tagName.toLowerCase();
      var sameTagSiblings = current.parentElement ?
        Array.from(current.parentElement.children).filter(function(child) {
          return child.tagName === current.tagName;
        }) : [];
      var childIndex = sameTagSiblings.indexOf(current) + 1;
      parts.unshift(tag + ':nth-of-type(' + childIndex + ')');
      current = current.parentElement;
      depth++;
      var testSel = parts.join(' > ');
      if (testSelector(testSel, el)) {
        return JSON.stringify({ selector: testSel, strategy: 'position-fallback', unique: true });
      }
    }
    if (parts.length > 0) {
      return JSON.stringify({ selector: parts.join(' > '), strategy: 'position-fallback', unique: false });
    }

    var fallbackParts = [];
    var fallbackCurrent = el;
    while (fallbackCurrent && fallbackCurrent !== document.body) {
      var ft = fallbackCurrent.tagName.toLowerCase();
      var fidx = fallbackCurrent.parentElement ?
        Array.from(fallbackCurrent.parentElement.children).indexOf(fallbackCurrent) + 1 : 1;
      fallbackParts.unshift(ft + ':nth-child(' + fidx + ')');
      fallbackCurrent = fallbackCurrent.parentElement;
    }
    fallbackParts.unshift('body');
    var fallbackSel = fallbackParts.join(' > ');
    return JSON.stringify({ selector: fallbackSel, strategy: 'position-fallback', unique: false });
  })()`;
}

// ---------------------------------------------------------------------------
// Public API — Generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique CSS selector for a target element.
 *
 * Locates the element via `targetSelector` then runs a 5-strategy fallback
 * chain inside the page to produce the most specific yet stable selector.
 *
 * @param session        An open CDP session (Runtime domain available).
 * @param targetSelector CSS selector to locate the target element.
 * @returns A {@link SelectorGenerationResult}, or `null` if the CDP call
 *          fails or the response is unparseable.
 */
export async function generateSelector(
  session: CdpSession,
  targetSelector: string,
): Promise<SelectorGenerationResult | null> {
  let raw: string;
  try {
    raw = await session.evaluate(buildGenerationIife(targetSelector));
  } catch {
    return null;
  }

  let parsed: RawGenerationResult;
  try {
    parsed = JSON.parse(raw) as RawGenerationResult;
  } catch {
    return null;
  }

  if (!parsed.selector) {
    return null;
  }

  return {
    selector: parsed.selector,
    strategy: parsed.strategy ?? 'position-fallback',
    unique: parsed.unique ?? false,
  };
}

// =============================================================================
// Section 2: Selector Validation
// =============================================================================

/** Default concurrency cap for batch validation. */
const DEFAULT_MAX_CONCURRENT = 4;

/** Hard upper bound for concurrent CDP probes to prevent socket flooding. */
const MAX_CONCURRENT_HARD_LIMIT = 16;

// ---------------------------------------------------------------------------
// Single-selector probe
// ---------------------------------------------------------------------------

/**
 * Validate a single selector against the target session.
 *
 * Uses one Runtime.evaluate call that:
 *   1. Checks selector syntax on a detached element.
 *   2. Counts matches in the live document.
 *   3. Captures the bounding box of the first match (if any).
 */
export async function probeSelector(
  session: CdpSession,
  selector: string,
): Promise<SelectorProbeResult> {
  const raw = await session.evaluate(`(() => {
    const sel = ${JSON.stringify(selector)};
    // 1. Syntax check on a detached element.
    try {
      document.createElement('div').querySelector(sel);
    } catch (e) {
      return JSON.stringify({
        kind: 'invalid',
        count: 0,
        error: String(e instanceof Error ? e.message : e),
      });
    }
    // 2. Match count in the live document.
    let count = 0;
    try {
      count = document.querySelectorAll(sel).length;
    } catch {
      // Should not happen after the detached check, but be defensive.
      return JSON.stringify({
        kind: 'invalid',
        count: 0,
        error: 'querySelectorAll threw after detached check passed',
      });
    }
    if (count === 0) {
      return JSON.stringify({ kind: 'miss', count: 0 });
    }
    // 3. Bounding box of the first match.
    let boundingBox;
    try {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        boundingBox = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }
    } catch {
      // Bounding box is best-effort; omit on failure.
    }
    return JSON.stringify({ kind: 'hit', count, boundingBox });
  })()`);

  let parsed: {
    kind: 'hit' | 'miss' | 'invalid';
    count: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
    error?: string;
  };

  try {
    // TODO: type-guard — 待渐进式加固
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // CDP returned malformed JSON — treat as miss with context.
    return {
      selector,
      kind: 'miss',
      count: 0,
      error: 'failed to parse CDP evaluate result',
    };
  }

  return {
    selector,
    kind: parsed.kind,
    count: parsed.count,
    boundingBox: parsed.boundingBox,
    error: parsed.error,
  };
}

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------

/**
 * Validate multiple selectors for an agent with bounded concurrency.
 *
 * Probes run with a module-level semaphore (maxConcurrent) to avoid
 * overwhelming the CDP socket. Results preserve input order regardless
 * of completion order.
 */
export async function validateSelectors(
  session: CdpSession,
  agentId: string,
  selectors: string[],
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
): Promise<SelectorValidationReport> {
  // Clamp concurrency to hard limit to prevent socket flooding.
  const concurrency = Math.min(Math.max(1, maxConcurrent), MAX_CONCURRENT_HARD_LIMIT);
  const results: SelectorProbeResult[] = new Array(selectors.length);

  // Semaphore-based concurrency limiter.
  let active = 0;
  let cursor = 0;

  return new Promise<SelectorValidationReport>((resolve) => {
    const next = (): void => {
      // All slots dispatched and nothing active → done.
      if (cursor >= selectors.length && active === 0) {
        resolve(buildReport(agentId, results));
        return;
      }
      // Dispatch up to concurrency probes.
      while (active < concurrency && cursor < selectors.length) {
        const index = cursor++;
        active++;
        probeSelector(session, selectors[index])
          .then((result) => {
            results[index] = result;
          })
          .catch((err: unknown) => {
            // CDP-level failure → mark as timeout with error context.
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[selector-validator] probe failed for "${selectors[index]}": ${message}`);
            results[index] = {
              selector: selectors[index],
              kind: 'timeout',
              count: 0,
              error: message,
            };
          })
          .finally(() => {
            active--;
            next();
          });
      }
    };

    next();
  });
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(agentId: string, results: SelectorProbeResult[]): SelectorValidationReport {
  let hit = 0;
  let miss = 0;
  let invalid = 0;
  let timeout = 0;

  for (const r of results) {
    switch (r.kind) {
      case 'hit':
        hit++;
        break;
      case 'miss':
        miss++;
        break;
      case 'invalid':
        invalid++;
        break;
      case 'timeout':
        timeout++;
        break;
    }
  }

  return {
    agentId,
    results,
    summary: { total: results.length, hit, miss, invalid, timeout },
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------

export { buildGenerationIife, isUsefulClass };
