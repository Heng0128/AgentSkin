// SPDX-License-Identifier: MPL-2.0
//
// # css-modules-matcher.mjs — CSS Modules Class Name Matching Utilities
//
// Provides pure functions for matching React CSS Modules class names that
// include content-based hash suffixes (e.g. `_assistantRow_14nyt_184`).
//
// Inspired by majiabin2020/workbuddy-theme-skin-skill's use of
// `[class*="prefix"]` attribute selectors for resilient DOM targeting.
//
// Exports:
//   - generateCssModulesSelector(prefix)  → CSS attribute selector string
//   - detectCssModulesPatterns(domSnapshot) → extracted pattern descriptors
//   - createMutationObserverConfig()        → MutationObserver init object
//
// All functions are pure and side-effect free.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Regex to detect a CSS Modules-generated class name.
 * Matches patterns like `_name_hash` or `name_hash` where the hash is
 * an alphanumeric suffix separated by underscore(s).
 * Captures: full match, prefix stem, and hash.
 *
 * Examples of matching class names:
 *   - `_assistantRow_14nyt_184`
 *   - `_header_abc123`
 *   - `_mainArea_def456`
 *   - `Button_base_x7k9`
 *
 * Non-matching examples:
 *   - `conversation-sidebar` (BEM, no hash)
 *   - `wb-button--primary` (BEM modifier)
 *   - `_agentskin-host-workbuddy` (AgentSkin host marker)
 */
export const CSS_MODULES_PATTERN = /^_([a-zA-Z][a-zA-Z0-9]*)(?:_[a-z0-9]{2,})+$/;

/**
 * Minimum stem length to consider a class name as a CSS Modules candidate.
 * Filters out trivial single-character stems like `_x_abc123`.
 */
export const MIN_STEM_LENGTH = 2;

// ---------------------------------------------------------------------------
// Selector generation
// ---------------------------------------------------------------------------

/**
 * Generate a `[class*="prefix"]` attribute selector for matching CSS Modules
 * class names that contain the given prefix substring.
 *
 * The selector uses the CSS3 substring attribute selector (`*=`) which
 * matches any element whose `class` attribute contains the prefix anywhere.
 * Combined with the CSS Modules convention of embedding the original component
 * name as a stable prefix (e.g. `_assistantRow_14nyt_184` always contains
 * `assistantRow`), this provides resilient matching across re-renders.
 *
 * @param {string} prefix — The stem or prefix to match (e.g. 'assistantRow', '_header').
 * @returns {string} A CSS attribute selector string, e.g. `[class*="assistantRow"]`.
 * @throws {TypeError} If prefix is not a non-empty string.
 *
 * @example
 * generateCssModulesSelector('assistantRow');
 * // Returns: [class*="assistantRow"]
 */
export function generateCssModulesSelector(prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new TypeError('generateCssModulesSelector: prefix must be a non-empty string');
  }

  // Escape special CSS characters in the prefix to prevent selector injection.
  const escaped = escapeCssString(prefix);
  return `[class*="${escaped}"]`;
}

/**
 * Generate multiple `[class*="prefix"]` selectors joined by a separator.
 *
 * @param {string[]} prefixes — Array of prefix strings.
 * @param {string} [separator=','] — Selector list separator.
 * @returns {string} Combined selector string.
 */
export function generateCssModulesSelectors(prefixes, separator = ',') {
  if (!Array.isArray(prefixes)) {
    throw new TypeError('generateCssModulesSelectors: prefixes must be an array');
  }
  return prefixes.map(generateCssModulesSelector).join(separator);
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

/**
 * Extract CSS Modules class name patterns from a DOM snapshot.
 *
 * The `domSnapshot` can be:
 *   - A string of space-separated class names (e.g. element's className)
 *   - An array of class name strings
 *   - An array of objects with a `className` or `class` property
 *
 * Returns an array of pattern descriptors, each with:
 *   - `original`: the full matched class name
 *   - `stem`: the extracted component name (without hash)
 *   - `selector`: a ready-to-use `[class*="stem"]` selector
 *
 * @param {string|string[]|Array<{className?:string, class?:string}>} domSnapshot
 * @returns {Array<{original: string, stem: string, selector: string}>}
 *
 * @example
 * detectCssModulesPatterns('_assistantRow_14nyt_184 conversation-sidebar');
 * // Returns: [{
 * //   original: '_assistantRow_14nyt_184',
 * //   stem: 'assistantRow',
 * //   selector: '[class*="assistantRow"]',
 * // }]
 */
export function detectCssModulesPatterns(domSnapshot) {
  if (domSnapshot == null) return [];

  // Normalize input to an array of class name strings.
  const classNames = normalizeToClassNames(domSnapshot);

  const results = [];
  const seen = new Set();

  for (const className of classNames) {
    const match = className.match(CSS_MODULES_PATTERN);
    if (!match) continue;

    const stem = match[1]; // captured group 1: the component name
    if (stem.length < MIN_STEM_LENGTH) continue;

    // Deduplicate by original class name.
    if (seen.has(className)) continue;
    seen.add(className);

    results.push({
      original: className,
      stem,
      selector: generateCssModulesSelector(stem),
    });
  }

  return results;
}

/**
 * Extract unique CSS Modules stem names from a DOM snapshot.
 * Convenience wrapper that returns just the stem strings.
 *
 * @param {string|string[]|Array<{className?:string, class?:string}>} domSnapshot
 * @returns {string[]} Array of unique stem names.
 */
export function extractCssModulesStems(domSnapshot) {
  return detectCssModulesPatterns(domSnapshot).map((p) => p.stem);
}

/**
 * Group CSS Modules patterns by their stem prefix (first lowercase segment).
 * Useful for identifying component families.
 *
 * @param {Array<{original: string, stem: string, selector: string}>} patterns
 *   Output from detectCssModulesPatterns.
 * @returns {Record<string, Array<{original: string, stem: string, selector: string}>>}
 */
export function groupPatternsByPrefix(patterns) {
  const groups = {};
  for (const pattern of patterns) {
    // Extract prefix: characters from stem start up to first uppercase
    // (or entire stem if no uppercase). E.g. 'assistantRow' → 'assistant'.
    const prefixMatch = pattern.stem.match(/^([a-z]+)/);
    const prefix = prefixMatch ? prefixMatch[1] : pattern.stem;
    if (!groups[prefix]) {
      groups[prefix] = [];
    }
    groups[prefix].push(pattern);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// MutationObserver configuration
// ---------------------------------------------------------------------------

/**
 * Create a MutationObserver configuration optimized for detecting CSS Modules
 * class name changes in a React application.
 *
 * React's reconciliation can replace the `class` attribute entirely on
 * re-render (even when the visible class names don't change semantically).
 * The config enables:
 *   - `attributes: true` — watch for attribute changes
 *   - `attributeFilter: ['class']` — only watch the `class` attribute (perf)
 *   - `subtree: true` — watch all descendants (React re-renders subtrees)
 *   - `childList: true` — detect added/removed nodes
 *   - `attributeOldValue: true` — capture previous class for diffing
 *
 * @param {object} [overrides] — Partial config to merge over defaults.
 * @returns {MutationObserverInit} MutationObserver configuration object.
 *
 * @example
 * const observer = new MutationObserver((mutations) => {
 *   for (const m of mutations) {
 *     if (m.type === 'attributes' && m.attributeName === 'class') {
 *       // Re-inject styles targeting new class names
 *     }
 *   }
 * });
 * observer.observe(document.body, createMutationObserverConfig());
 */
export function createMutationObserverConfig(overrides = {}) {
  return {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
    childList: true,
    attributeOldValue: true,
    ...overrides,
  };
}

/**
 * Create a debounced MutationObserver callback wrapper.
 * Groups rapid successive mutations (common in React batched updates)
 * and invokes the callback once per frame.
 *
 * @param {(mutations: MutationRecord[]) => void} callback — Handler function.
 * @param {number} [delay=0] — Debounce delay in ms (0 = next microtask).
 * @returns {(mutations: MutationRecord[]) => void} Debounced handler.
 */
export function createDebouncedMutationCallback(callback, delay = 0) {
  if (typeof callback !== 'function') {
    throw new TypeError('createDebouncedMutationCallback: callback must be a function');
  }

  let pending = [];
  let timerId = null;

  return function debouncedCallback(mutations) {
    pending.push(...mutations);
    if (timerId !== null) return;

    timerId = setTimeout(() => {
      const batch = pending;
      pending = [];
      timerId = null;
      callback(batch);
    }, delay);
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize various DOM snapshot formats into an array of class name strings.
 *
 * @param {string|string[]|Array<{className?:string, class?:string}>} input
 * @returns {string[]}
 */
function normalizeToClassNames(input) {
  if (typeof input === 'string') {
    return input.trim().split(/\s+/).filter(Boolean);
  }

  if (Array.isArray(input)) {
    const result = [];
    for (const item of input) {
      if (typeof item === 'string') {
        result.push(item);
      } else if (item && typeof item === 'object') {
        // Support both 'className' (React/DOM) and 'class' (HTML) property names.
        const value = item.className ?? item.class;
        if (typeof value === 'string' && value.length > 0) {
          result.push(...value.trim().split(/\s+/).filter(Boolean));
        }
      }
    }
    return result;
  }

  return [];
}

/**
 * Escape special CSS characters in a string for safe use inside an
 * attribute selector value (double-quoted).
 *
 * Escapes: double-quote and backslash. These are the only characters
 * that can break out of a quoted CSS attribute selector value.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeCssString(str) {
  let result = '';
  for (const ch of str) {
    if (ch === '"') {
      result += '\\"';
    } else if (ch === '\\') {
      result += '\\\\';
    } else {
      result += ch;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Default export (convenience object)
// ---------------------------------------------------------------------------

export default {
  CSS_MODULES_PATTERN,
  MIN_STEM_LENGTH,
  generateCssModulesSelector,
  generateCssModulesSelectors,
  detectCssModulesPatterns,
  extractCssModulesStems,
  groupPatternsByPrefix,
  createMutationObserverConfig,
  createDebouncedMutationCallback,
};
