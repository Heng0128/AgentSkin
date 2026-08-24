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
  DEEP_CORE_GLOBAL,
  hostClassFor,
  RENDERER_CONFIG_GLOBAL,
  SHADOW_ORIG_REF,
  SHEET_LAYER_FLAG,
  SHEET_OWNED_FLAG,
} from './injection-constants';
import { AGENT_IDS } from './types';

/**
 * Determine whether the theme is fully applied based on a verifyTheme result.
 *
 * Three conditions must ALL hold:
 *   1. accent token is non-empty (CSS variable actually inherited/cascade)
 *   2. At least one owned adoptedStyleSheet exists
 *   3. Every required engine layer (palette, tokens, cosmetic) is present
 *      with ruleCount > 0 (when layer data is available)
 *
 * Consumers: waitForTheme (shared.ts), watchdog skip decision (cdp-fanout.ts).
 */
export function isThemeFullyApplied(
  v: {
    accent: string;
    adoptedSheetCount: number;
    layers?: Record<string, number>;
    artResolved?: boolean;
  },
  opts?: {
    /** When true, require the hero art variable to actually resolve. */ requireHero?: boolean;
  },
): boolean {
  if (!v || v.adoptedSheetCount <= 0) return false;
  if (!v.accent) return false;
  // If layers data is unavailable (old client), fall back to count-only check;
  // when the theme requires a hero, still gate on art actually resolving so a
  // lost hero blob (CSS present, background empty) is not treated as complete.
  if (!v.layers) return opts?.requireHero ? v.artResolved === true : true;
  const required = ['palette', 'tokens', 'cosmetic'];
  for (const layer of required) {
    if (!v.layers[layer] || v.layers[layer] <= 0) return false;
  }
  // 2026-08-23 hero 修复:当主题带 hero 背景时，若 --agentskin-art 未解析为
  // url(blob:)，则不视为"已完全应用"，watchdog 才不会被跳过、从而补注入 hero。
  if (opts?.requireHero && !v.artResolved) return false;
  return true;
}

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
 *
 * C-3 fix (2026-08-23): adapters also stash `sheetGuardInterval` (and doubao
 * `sheetPoll`) inside the marker — clear those too, otherwise the interval
 * survives restore and keeps re-injecting sheets on later targets.
 */
export const CLEAR_ADAPTERS_BODY = [
  `var markers = ${JSON.stringify(ADAPTER_MARKERS)};`,
  'for (var i = 0; i < markers.length; i++) {',
  '  var m = markers[i];',
  '  if (window[m]) {',
  '    if (window[m].observer) window[m].observer.disconnect();',
  '    if (window[m].interval) clearInterval(window[m].interval);',
  '    if (window[m].sheetGuardInterval) clearInterval(window[m].sheetGuardInterval);',
  '    if (window[m].sheetPoll) clearInterval(window[m].sheetPoll);',
  '    delete window[m];',
  '  }',
  '}',
  // 治本：卸载 adoptedStyleSheets setter hook，恢复原始 descriptor
  'if (window.__agentskin_originalAdoptedSheetsDesc) {',
  '  try { Object.defineProperty(Document.prototype, "adoptedStyleSheets", window.__agentskin_originalAdoptedSheetsDesc); } catch (e) {}',
  '}',
  'delete window.__agentskin_originalAdoptedSheetsDesc;',
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

/**
 * JS body: tear down the DeepCore runtime — restore patched `attachShadow`,
 * unregister fragment sheets, dispose the runtime handle, and delete the
 * shadow-orig reference. Best-effort (wrapped in try-catch by caller).
 * Internal — only consumed by {@link buildClearEngineInjectionExpression}.
 */
const CLEAR_DEEP_CORE_BODY = [
  `if (window.${SHADOW_ORIG_REF}) {`,
  '  try { Element.prototype.attachShadow = window.__agentskin_shadow_orig__; } catch (e) {}',
  '}',
  `delete window.${SHADOW_ORIG_REF};`,
  `if (window.${DEEP_CORE_GLOBAL} && window.${DEEP_CORE_GLOBAL}.dispose) {`,
  '  try { window.__AGENTSKIN_DEEP_CORE__.dispose(); } catch (e) {}',
  '}',
  `delete window.${DEEP_CORE_GLOBAL};`,
  'delete window.__AGENTSKIN_DEEP_CORE_LOADED__;',
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
 * Clears only previously-owned **unnamed** sheets (no `__agentskin_layer`),
 * then adds the new one tagged with `__agentskin` but no layer name.
 * Returns `'ok:<ruleCount>'` or `'err:<message>'`.
 *
 * Preserves named engine layers (palette/tokens/cosmetic/theme/custom) so
 * that legacy fallback injection (via `injectThemeViaCdp`) does not wipe
 * out the engine's multi-layer architecture. Only the legacy unnamed sheet
 * from a previous `injectCssAdopted` call is replaced.
 *
 * Replaces the inline logic in `injectCssAdopted()`.
 */
export function buildAdoptOwnedSheetExpression(css: string): string {
  const escaped = escapeCssForTemplateLiteral(css);
  return `(() => {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(\`${escaped}\`);
      document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(
        s => !(s.${SHEET_OWNED_FLAG} === true && !s.${SHEET_LAYER_FLAG})
      );
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
      ${CLEAR_DEEP_CORE_BODY}
    } catch (e) { /* best-effort */ }
    return 'ok';
  })()`;
}
