// SPDX-License-Identifier: MPL-2.0

/**
 * # Injection Runtime Kernel
 *
 * Shared DOM-manipulation expressions for CDP theme/wallpaper injection.
 *
 * ## Why this exists
 *
 * Before this module, the same adoptedStyleSheet / adapter-marker / host-class
 * manipulation logic was inlined as template-literal strings in three places:
 *   - `cdp-inject.ts` `applyLayers()` (persistence script, ES5)
 *   - `cdp-inject.ts` `injectCssLayer()` / `injectCssAdopted()` (ephemeral)
 *   - `cdp-inject.ts` `removeEngineInjection()` (cleanup)
 *
 * A single typo in any of those would silently break injection or restore.
 * This module defines each DOM primitive exactly once and exports it as either:
 *   - A **snippet** (JS body, no wrapper) for embedding inside larger scripts
 *     like the persistence script. Uses ES5 syntax so it runs in fresh
 *     document contexts that may not support arrow functions.
 *   - A **builder** (complete IIFE expression) for direct `session.evaluate()`
 *     calls. Uses modern syntax since it only runs in contexts that already
 *     support `CSSStyleSheet`.
 *
 * ## Contract
 *
 * All identifiers (`__agentskin`, `__agentskin_layer`, `__AGENTSKIN_CONFIG__`,
 * adapter markers, host classes) come from {@link injection-constants} — never
 * hard-code them here.
 */

import {
  ADAPTER_MARKERS,
  hostClassFor,
  RENDERER_CONFIG_GLOBAL,
  SHEET_LAYER_FLAG,
  SHEET_OWNED_FLAG,
} from './injection-constants';
import { AGENT_IDS } from './types';

// ---------------------------------------------------------------------------
// CSS escaping
// ---------------------------------------------------------------------------

/**
 * Escape CSS text for safe embedding inside a JS template literal
 * (backtick string). Applied before injecting CSS via `session.evaluate()`.
 *
 * Internal — only used by the build*Expression builders in this module.
 */
function escapeCssForTemplateLiteral(css: string): string {
  return css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// ---------------------------------------------------------------------------
// Snippets (JS bodies — ES5, for embedding in larger scripts)
//
// These are intentionally written as plain strings (not functions) so they can
// be interpolated into both the persistence script (which runs in a fresh
// document context) and ephemeral evaluate expressions. They reference
// variables that the surrounding script must define (documented per snippet).
// ---------------------------------------------------------------------------

/**
 * JS body: adopt a single named CSS layer.
 *
 * Expected in-scope variables: `layerName` (string), `layerCss` (string).
 * Idempotent — removes any existing layer with the same name before adding.
 *
 * Uses ES5 syntax so it works inside the persistence script's `applyLayers()`
 * loop AND in ephemeral evaluate expressions.
 */
export const ADOPT_LAYER_BODY = [
  'document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(function(s) {',
  `  return !(s.${SHEET_OWNED_FLAG} === true && s.${SHEET_LAYER_FLAG} === layerName);`,
  '});',
  'var sheet = new CSSStyleSheet();',
  'sheet.replaceSync(layerCss);',
  `sheet.${SHEET_OWNED_FLAG} = true;`,
  `sheet.${SHEET_LAYER_FLAG} = layerName;`,
  'document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);',
].join('\n');

/**
 * JS body: remove all AgentSkin-owned adoptedStyleSheets.
 * No scope variables required — operates only on `document`.
 *
 * Internal — only consumed by {@link buildClearEngineInjectionExpression}.
 */
const CLEAR_OWNED_SHEETS_BODY =
  `document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(` +
  `function(s) { return !s.${SHEET_OWNED_FLAG}; });`;

/**
 * JS body: disconnect all adapter markers (observer + interval) and delete them.
 * No scope variables required — iterates the constant marker list.
 */
export const CLEAR_ADAPTERS_BODY = [
  `var markers = ${JSON.stringify(ADAPTER_MARKERS)};`,
  'for (var i = 0; i < markers.length; i++) {',
  '  var m = markers[i];',
  '  if (window[m]) {',
  '    if (window[m].observer) window[m].observer.disconnect();',
  '    if (window[m].interval) clearInterval(window[m].interval);',
  '    delete window[m];',
  '  }',
  '}',
].join('\n');

/**
 * JS body: remove all known host classes from <html>, clear the hero art CSS
 * variable, and clear the renderer config global. Also removes the legacy
 * `agentskin-theme` class. No scope variables required.
 *
 * Internal — only consumed by {@link buildClearEngineInjectionExpression}.
 */
const CLEAR_HOST_BODY = [
  'var root = document.documentElement;',
  'if (root) {',
  `  root.classList.remove(${JSON.stringify(AGENT_IDS.map((id) => hostClassFor(id)))}, 'agentskin-theme');`,
  "  root.style.removeProperty('--agentskin-art');",
  '}',
  `delete window.${RENDERER_CONFIG_GLOBAL};`,
].join('\n');

// ---------------------------------------------------------------------------
// Expression builders (complete IIFEs — for direct session.evaluate())
// ---------------------------------------------------------------------------

/**
 * Build a JS IIFE expression that adopts a single named CSS layer via
 * `CSSStyleSheet`. Idempotent — removes any existing layer with the same
 * name before adding the new one. Returns `'ok:<ruleCount>'` on success or
 * `'err:<message>'` on failure.
 *
 * Replaces the inline logic that was previously duplicated in
 * `injectCssLayer()` and the persistence script's `applyLayers()` loop.
 */
export function buildAdoptLayerExpression(layerName: string, css: string): string {
  const escaped = escapeCssForTemplateLiteral(css);
  const nameJson = JSON.stringify(layerName);
  return `(() => {
    try {
      document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(
        s => !(s.${SHEET_OWNED_FLAG} === true && s.${SHEET_LAYER_FLAG} === ${nameJson})
      );
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(\`${escaped}\`);
      sheet.${SHEET_OWNED_FLAG} = true;
      sheet.${SHEET_LAYER_FLAG} = ${nameJson};
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return 'ok:' + sheet.cssRules.length;
    } catch(e) { return 'err:' + e.message; }
  })()`;
}

/**
 * Build a JS IIFE expression that adopts a single unnamed owned stylesheet.
 * Clears ALL previously-owned sheets first, then adds the new one tagged
 * with `__agentskin` but no layer name. Returns `'ok:<ruleCount>'` or
 * `'err:<message>'`.
 *
 * Replaces the inline logic in `injectCssAdopted()`.
 */
export function buildAdoptOwnedSheetExpression(css: string): string {
  const escaped = escapeCssForTemplateLiteral(css);
  return `(() => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(\`${escaped}\`);
      document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG} !== true);
      sheet.${SHEET_OWNED_FLAG} = true;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return 'ok:' + sheet.cssRules.length;
    } catch(e) { return 'err:' + e.message; }
  })()`;
}

/**
 * Build a JS IIFE expression that tears down the full engine injection state:
 *   1. Remove all AgentSkin-owned adoptedStyleSheets
 *   2. Disconnect all adapter markers (observer + interval)
 *   3. Remove all host classes + the config global
 *
 * Used by `removeEngineInjection()` to clean up after a restore. The
 * sessionStorage disable-flag set is NOT included here — callers set it
 * separately because it must happen before the persistence script's next
 * run, not as part of the DOM teardown.
 *
 * Returns `'ok'`. Never throws — all operations are try-caught.
 */
export function buildClearEngineInjectionExpression(): string {
  return `(() => {
    try {
      ${CLEAR_OWNED_SHEETS_BODY}
      ${CLEAR_ADAPTERS_BODY}
      ${CLEAR_HOST_BODY}
    } catch (e) { /* best-effort */ }
    return 'ok';
  })()`;
}
