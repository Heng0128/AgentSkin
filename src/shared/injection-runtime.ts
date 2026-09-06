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
  STYLE_ID,
} from './injection-constants';
import { AGENT_IDS } from './types';

/**
 * Three-tier verdict for theme application state.
 *
 *   - `full`    — accent + sheets + all required layers present (and hero resolved
 *                 when required). Safe to skip re-injection.
 *   - `partial` — accent and sheets exist but some required layer is missing, or
 *                 layers data is unavailable (old client), or hero not resolved.
 *                 Watchdog should re-inject the missing layers.
 *   - `failed`  — no accent or no owned sheets at all. Full re-injection needed.
 *
 * RC4-A: replaces the boolean `isThemeFullyApplied` with graded degradation so
 * the watchdog can make a nuanced decision instead of a binary skip/re-inject.
 */
export type ThemeApplyVerdict = 'full' | 'partial' | 'failed';

/**
 * Determine the detailed theme application verdict based on a verifyTheme result.
 *
 * This is the RC4-A enhanced version that returns a three-tier verdict instead
 * of a flat boolean. New code should use this function; existing callers that
 * need a boolean can use {@link isThemeFullyApplied} (which maps `full` → true,
 * everything else → false).
 *
 * Consumers: waitForTheme (shared.ts), watchdog skip decision (cdp-fanout.ts),
 * watchdog reload decision (reload-watchdog.ts).
 */
export function isThemeFullyApplyVerdict(
  v: {
    accent: string;
    adoptedSheetCount: number;
    layers?: Record<string, number>;
    artResolved?: boolean;
  },
  opts?: {
    /** When true, require the hero art variable to actually resolve. */
    requireHero?: boolean;
  },
): ThemeApplyVerdict {
  if (!v || v.adoptedSheetCount <= 0) return 'failed';
  if (!v.accent) return 'failed';
  // If layers data is unavailable (old client), we cannot confirm full —
  // report 'partial' so the watchdog still re-injects rather than skipping.
  if (!v.layers) return opts?.requireHero && v.artResolved === true ? 'full' : 'partial';
  const required = ['palette', 'tokens', 'cosmetic'];
  for (const layer of required) {
    if (!v.layers[layer] || v.layers[layer] <= 0) return 'partial';
  }
  // Hero gating: when the theme carries a hero, an unresolved art variable means
  // the background is still a solid color — treat as 'partial' so the watchdog
  // re-injects the hero blob.
  if (opts?.requireHero && !v.artResolved) return 'partial';
  return 'full';
}

/**
 * Determine whether the theme is fully applied based on a verifyTheme result.
 *
 * Backward-compatible boolean wrapper around {@link isThemeFullyApplyVerdict}.
 * Maps `full` → true, `partial`/`failed` → false.
 *
 * @deprecated Use {@link isThemeFullyApplyVerdict} for new code that needs to
 * distinguish partial from failed states.
 */
export function isThemeFullyApplied(
  v: {
    accent: string;
    adoptedSheetCount: number;
    layers?: Record<string, number>;
    artResolved?: boolean;
  },
  opts?: {
    /** When true, require the hero art variable to actually resolve. */
    requireHero?: boolean;
  },
): boolean {
  return isThemeFullyApplyVerdict(v, opts) === 'full';
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
export const CLEAR_OWNED_SHEETS_BODY =
  `document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(` +
  `function(s) { return !s.${SHEET_OWNED_FLAG}; });`;

/**
 * JS body: clear the `--agentskin-art` CSS variable and revoke its Blob URL.
 * Called during theme SWITCH (not remove) so the `hasActiveHeroArt` idempotency
 * gate in hero-inject returns false and the new theme's hero is actually
 * transferred. Without this, the old blob URL persists and the new hero is
 * skipped — leaving the background image stuck on the previous theme (or gone
 * if the old blob was revoked).
 *
 * Also clears `--agentskin-asset-*` variables for the same reason.
 */
export const CLEAR_ART_VAR_BODY = [
  'var root = document.documentElement;',
  'if (root) {',
  '  var _artUrl = root.style.getPropertyValue("--agentskin-art");',
  '  if (_artUrl && _artUrl.indexOf("blob:") !== -1) {',
  '    try { var _m = _artUrl.match(/url\\(["\']?(blob:[^"\')]+)/); if (_m && _m[1]) URL.revokeObjectURL(_m[1]); } catch (e) {}',
  '  }',
  '  root.style.removeProperty("--agentskin-art");',
  '  var _attrs = root.dataset;',
  '  for (var _k in _attrs) {',
  '    if (_k.indexOf("agentskinAssetBlobUrl") === 0 || _k === "agentskinArtBlobUrl") {',
  '      try { URL.revokeObjectURL(_attrs[_k]); } catch (e) {}',
  '      delete _attrs[_k];',
  '    }',
  '  }',
  '}',
].join('\n');

/**
 * Legacy bare global keys set by the engine and adapters prior to the 2026-09-01
 * `window.__agentskin__` namespace consolidation. The engine now exports its
 * public API exclusively via `window.__agentskin__`, but these bare globals
 * are still removed during theme restore / switch so that stale references
 * from an older injection don't survive into the next apply phase.
 *
 * Once the engine has fully stopped setting these keys (target: P1), this
 * array becomes empty and the CLEAR snippets reduce to a single
 * `delete window.__agentskin__`.
 */
export const LEGACY_BARE_GLOBALS = [
  // --- Former subsystems (absorbed into unified engine 2026-08-31) ---
  '__agentskin_shared_engine__',
  '__agentskin_unified_engine__',
  '__agentskin_sheet_manager__',
  '__agentskin_token_discovery__',
  '__agentskin_visual_engine__',
  '__agentskin_wallpaper__',
  // --- Per-module loaded flags (now maintained inside __agentskin__) ---
  '__AGENTSKIN_TOKEN_DISCOVERY_LOADED__',
  '__AGENTSKIN_SHEET_MANAGER_LOADED__',
  '__AGENTSKIN_STYLE_INJECTOR_LOADED__',
  '__AGENTSKIN_DEEP_CORE_LOADED__',
  '__AGENTSKIN_SELF_HEAL_LOADED__',
  '__AGENTSKIN_UNIFIED_ENGINE_LOADED__',
  // --- Internal state (now maintained inside __agentskin__) ---
  '__agentskin_originalAdoptedSheetsDesc',
  '__agentskin_glass_tokens__',
] as const;

/**
 * JS body: disconnect all adapter markers (observer + interval) and delete them.
 * No scope variables required — iterates the constant marker list.
 *
 * C-3 fix (2026-08-23): adapters also stash `sheetGuardInterval` (and doubao
 * `sheetPoll`) inside the marker — clear those too, otherwise the interval
 * survives restore and keeps re-injecting sheets on later targets.
 *
 * Background self-heal (2026-08-25): the doubao adapter stashes a `bgObserver`
 * (MutationObserver on body[style]) inside the marker. Disconnect it here so
 * restore doesn't leave a zombie observer watching a dead document.
 *
 * 2026-09-01: Legacy bare globals are now enumerated via
 * {@link LEGACY_BARE_GLOBALS} — this keeps the CLEAR chain explicit and
 * resilient to future bare-global removals.
 */
export const CLEAR_ADAPTERS_BODY = [
  `var markers = ${JSON.stringify(ADAPTER_MARKERS)};`,
  'for (var i = 0; i < markers.length; i++) {',
  '  var m = markers[i];',
  '  if (window[m]) {',
  '    if (window[m].observer) window[m].observer.disconnect();',
  '    if (window[m].bgObserver) window[m].bgObserver.disconnect();',
  '    if (window[m].artLayerObserver) window[m].artLayerObserver.disconnect();',
  '    if (window[m].selfHeal && window[m].selfHeal.stop) window[m].selfHeal.stop();',
  '    if (window[m].interval) clearInterval(window[m].interval);',
  '    if (window[m].progressiveInterval) clearInterval(window[m].progressiveInterval);',
  '    if (window[m].sheetGuardInterval) clearInterval(window[m].sheetGuardInterval);',
  '    if (window[m].sheetPoll) clearInterval(window[m].sheetPoll);',
  '    delete window[m];',
  '  }',
  '}',
  // 治本：卸载 adoptedStyleSheets setter hook，恢复原始 descriptor
  'if (window.__agentskin_originalAdoptedSheetsDesc) {',
  '  try { Object.defineProperty(Document.prototype, "adoptedStyleSheets", window.__agentskin_originalAdoptedSheetsDesc); } catch (e) {}',
  '}',
  // 清除 legacy bare globals（2026-09-01 namespace 迁移）
  `var legacy = ${JSON.stringify(LEGACY_BARE_GLOBALS)};`,
  'for (var li = 0; li < legacy.length; li++) { delete window[legacy[li]]; }',
  // 清除主命名空间（引擎子系统）
  'delete window.__agentskin__;',
  // 清除 DeepCore markers
  `delete window.${SHADOW_ORIG_REF};`,
  'delete window.__agentskin_shadow_orig__;',
].join('\n');

/**
 * JS body: remove all known host classes from <html>, clear the hero art CSS
 * variable, and clear the renderer config global. Also removes the legacy
 * `agentskin-theme` class and any `div.agentskin-background-layer` elements
 * created by the doubao background self-heal. No scope variables required.
 *
 * Consumed by {@link buildClearEngineInjectionExpression} and imported
 * directly by `engine-strategy.ts` for the single-style cleanup path.
 */
export const CLEAR_HOST_BODY = [
  'var root = document.documentElement;',
  'if (root) {',
  `  root.classList.remove(${JSON.stringify(AGENT_IDS.map((id) => hostClassFor(id)))}, 'agentskin-theme');`,
  "  root.style.removeProperty('--agentskin-art');",
  '}',
  // Remove doubao background self-heal div(s) so restore leaves no orphan.
  'var bgLayers = document.querySelectorAll("div.agentskin-background-layer");',
  'for (var bi = 0; bi < bgLayers.length; bi++) { bgLayers[bi].remove(); }',
  // Remove traework art layer div(s) (theme-switch residue prevention)
  'var artLayers = document.querySelectorAll(\'div[id^="agentskin-"][id*="art-layer"]\');',
  'for (var ai = 0; ai < artLayers.length; ai++) { artLayers[ai].remove(); }',
  // Remove the unified style element (single-source-of-truth for all AgentSkin CSS)
  `var styleEl = document.getElementById(${JSON.stringify(STYLE_ID)});`,
  'if (styleEl) { styleEl.textContent = ""; styleEl.remove(); }',
  `delete window.${RENDERER_CONFIG_GLOBAL};`,
].join('\n');

/**
 * JS body: tear down the DeepCore runtime — restore patched `attachShadow`,
 * unregister fragment sheets, dispose the runtime handle, and delete the
 * shadow-orig reference. Best-effort (wrapped in try-catch by caller).
 * Internal — only consumed by {@link buildClearEngineInjectionExpression}.
 */
/**
 * JS body: tear down the DeepCore runtime — restore patched `attachShadow`,
 * unregister fragment sheets, dispose the runtime handle. Best-effort
 * (wrapped in try-catch by caller).
 *
 * Note: `__agentskin_shadow_orig__` cleanup is now handled by
 * {@link CLEAR_ADAPTERS_BODY} via {@link LEGACY_BARE_GLOBALS}. This
 * snippet only deals with live object disposal.
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

// ---------------------------------------------------------------------------
// 2026-09-01 — Atomic Injection (DreamWork / Codex-Dream-Skin aligned)
//
// Background image and CSS are packed into a SINGLE IIFE that executes in ONE
// CDP evaluate.  This eliminates every race condition and the white-flash that
// plagued the old multi-step flow (CSS here, blob there, variable elsewhere).
// ---------------------------------------------------------------------------

/**
 * Build the atomic CSS + Hero injection expression.
 *
 * The expression executes synchronously inside one CDP evaluate. It:
 *   1. Writes the full CSS to `<style id="agentskin-style">`.
 *   2. If `heroDataUrl` is a non-empty data URL, converts it in-page to a Blob
 *      (IIFE-synchronous) and assigns the Blob URL to `--agentskin-art`.
 *
 * Because CSS and `--agentskin-art` are set inside the same synchronous frame,
 * there is no visual gap — the user never sees white background.
 *
 * @returns `'ok:<bytes>'` or `'err:<message>'`.
 */
export function buildAtomicInjectionExpression(opts: {
  css: string;
  heroDataUrl: string | null;
  agentId: string;
}): string {
  const escaped = escapeCssForTemplateLiteral(opts.css);
  const styleIdJson = JSON.stringify(STYLE_ID);
  const hostClass = hostClassFor(opts.agentId);
  const hasHero = !!opts.heroDataUrl && opts.heroDataUrl.length > 10;
  const heroJson = JSON.stringify(hasHero ? opts.heroDataUrl : '');

  const heroConversion = hasHero
    ? `
      try {
        var _comma = ${heroJson}.indexOf(',');
        var _mime = /^data:([^;,]+)/.exec(${heroJson})?.[1] || 'image/png';
        var _b64 = atob(${heroJson}.slice(_comma + 1));
        var _bytes = new Uint8Array(_b64.length);
        for (var _i = 0; _i < _b64.length; _i++) _bytes[_i] = _b64.charCodeAt(_i);
        var _artUrl = URL.createObjectURL(new Blob([_bytes], { type: _mime }));
        _root.style.setProperty('--agentskin-art', 'url(' + _artUrl + ')');
        _root.dataset.agentskinArt = _artUrl;
        if (window.__agentskin__ && window.__agentskin__.artUrl) {
          try { URL.revokeObjectURL(window.__agentskin__.artUrl); } catch (_e) {}
        }
        window.__agentskin__ = window.__agentskin__ || {};
        window.__agentskin__.artUrl = _artUrl;
      } catch (_e) { /* hero failure: --agentskin-art stays unset */ }`
    : '';

  return `(() => {
    try {
      var _root = document.documentElement;

      // --- Step 1: Write all CSS (palette + tokens + cosmetic + theme + custom + adapter) ---
      var _style = document.getElementById(${styleIdJson});
      if (!_style) {
        _style = document.createElement('style');
        _style.id = ${styleIdJson};
        (_root || document.head).appendChild(_style);
      }
      _style.textContent = \`${escaped}\`;

      // --- Step 2: Atomic hero image (CSS + blob + variable in same frame) ---
${heroConversion}

      // --- Step 3: Host class + state marker ---
      if (_root) {
        if (!_root.classList.contains(${JSON.stringify(hostClass)})) {
          _root.classList.add(${JSON.stringify(hostClass)});
        }
        _root.dataset.agentskinReady = '1';
      }
      window.__agentskin__ = window.__agentskin__ || {};
      window.__agentskin__.appliedAt = Date.now();

      return 'ok:' + _style.textContent.length;
    } catch (e) { return 'err:' + e.message; }
  })()`;
}

/**
 * Build the atomic CLEAR expression that prepares a page for fresh atomic
 * injection.  Removes host class, the `<style>` element, adapter markers,
 * legacy globals, and revokes old Blob URLs from a previous theme.
 *
 * Returns `'ok'` on success (best-effort).
 */
export function buildAtomicClearExpression(): string {
  const hostClassExpr = AGENT_IDS.map(
    (id) => `_root.classList.remove(${JSON.stringify(hostClassFor(id))});`,
  ).join('\n      ');
  return `(() => {
    try {
      var _root = document.documentElement;
      // Remove host classes
      ${hostClassExpr}
      // Drop the <style> element
      var _s = document.getElementById(${JSON.stringify(STYLE_ID)});
      if (_s) { _s.textContent = ''; _s.remove(); }
      // Revoke old blob URLs held on dataset
      if (_root && _root.dataset) {
        for (var _k in _root.dataset) {
          if (_k.indexOf('agentskin') === 0 && _root.dataset[_k].indexOf('blob:') === 0) {
            try { URL.revokeObjectURL(_root.dataset[_k]); } catch (e) {}
            delete _root.dataset[_k];
          }
        }
      }
      // Disconnect adapter markers
      var _markers = ${JSON.stringify(ADAPTER_MARKERS)};
      for (var i = 0; i < _markers.length; i++) {
        var _m = _markers[i];
        if (window[_m]) {
          try { if (window[_m].observer) window[_m].observer.disconnect(); } catch (e) {}
          try { if (window[_m].bgObserver) window[_m].bgObserver.disconnect(); } catch (e) {}
          try { if (window[_m].interval) clearInterval(window[_m].interval); } catch (e) {}
          try { if (window[_m].selfHeal && window[_m].selfHeal.stop) window[_m].selfHeal.stop(); } catch (e) {}
          delete window[_m];
        }
      }
      // Remove legacy bare globals
      var _legacy = ${JSON.stringify(LEGACY_BARE_GLOBALS)};
      for (var j = 0; j < _legacy.length; j++) { delete window[_legacy[j]]; }
      // Revoke previous art URL from __agentskin__ namespace
      if (window.__agentskin__ && window.__agentskin__.artUrl) {
        try { URL.revokeObjectURL(window.__agentskin__.artUrl); } catch (e) {}
        window.__agentskin__.artUrl = '';
      }
      return 'ok';
    } catch (e) { return 'err:' + e.message; }
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
 * Build a JS IIFE expression that atomically sets BOTH the unified `<style>`
 * element content AND the `--agentskin-art` CSS variable in a SINGLE evaluate
 * call.
 *
 * 2026-09-01: This eliminates the background-image flash that occurred when
 * `--agentskin-art` was set by an earlier `injectHeroAssets` step but the CSS
 * rule that consumes it (`background: var(--agentskin-art)`) wasn't injected
 * until a later `buildStyleExpression` call. For large hero images (4K/8K,
 * chunked transfer), the gap spanned hundreds of milliseconds — the user saw a
 * white flash between theme clear and background appearance.
 *
 * When `heroUrl` is provided, the expression:
 *   1. Gets-or-creates the `<style id="agentskin-style">` element
 *   2. Writes ALL CSS layers to textContent
 *   3. Sets `document.documentElement.style.setProperty('--agentskin-art', ...)`
 *
 * All three operations happen synchronously within one CDP round-trip, so the
 * background rule and its resolved Blob URL become visible simultaneously.
 *
 * @param css - All CSS layers concatenated (palette + tokens + cosmetic + theme + custom).
 * @param heroUrl - Optional Blob URL to set as `--agentskin-art`. When provided,
 *   the variable is updated atomically with the CSS.
 * @returns `'ok:<length>'` on success or `'err:<message>'` on failure.
 */
export function buildStyleWithHeroExpression(css: string, heroUrl?: string): string {
  const escaped = escapeCssForTemplateLiteral(css);
  const styleIdJson = JSON.stringify(STYLE_ID);
  const heroSet = heroUrl
    ? `try { document.documentElement.style.setProperty('--agentskin-art', 'url(' + ${JSON.stringify(heroUrl)} + ')'); } catch(e) {}`
    : '';
  return `(() => {
    try {
      var style = document.getElementById(${styleIdJson});
      if (!style) {
        style = document.createElement('style');
        style.id = ${styleIdJson};
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = \`${escaped}\`;
      ${heroSet}
      return 'ok:' + style.textContent.length;
    } catch(e) { return 'err:' + e.message; }
  })()`;
}

/**
 * Build a JS IIFE expression that injects CSS via a single `<style>` element.
 * This is the DreamSkin-aligned approach: all theme CSS is concatenated into
 * one string and written to a single `<style id="agentskin-style">` element.
 *
 * Advantages over adoptedStyleSheets:
 *   1. No cascade conflicts — single source, one rule wins by source order
 *   2. Theme switching is a simple `style.textContent = newCss` replacement —
 *      zero residue from previous themes
 *   3. No specificity wars against token-discovery since both CSS blocks live
 *      in the same style element (static CSS first, dynamic overrides after)
 *   4. Background images work reliably — `body { background-image: url(...) }`
 *      in a single style element cannot be overridden by host CSS loaded later
 *      (the style element is the last author stylesheet before UA overrides)
 *
 * For atomic CSS + hero injection that eliminates background-image flash,
 * see {@link buildStyleWithHeroExpression}.
 *
 * The function reuses an existing `#agentskin-style` element if present,
 * otherwise creates one and appends it to `<head>`.
 *
 * Returns `'ok:<length>'` on success or `'err:<message>'` on failure.
 */
export function buildStyleExpression(css: string): string {
  return buildStyleWithHeroExpression(css);
}

/**
 * Build a JS IIFE expression that appends CSS to the existing single `<style>`
 * element (for dynamic token-discovery overrides). Creates the element if absent.
 * Returns `'ok:<length>'` or `'err:<message>'`.
 */
export function appendStyleExpression(css: string): string {
  const escaped = escapeCssForTemplateLiteral(css);
  const styleIdJson = JSON.stringify(STYLE_ID);
  return `(() => {
    try {
      var style = document.getElementById(${styleIdJson});
      if (!style) {
        style = document.createElement('style');
        style.id = ${styleIdJson};
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = (style.textContent || '') + \`\\n${escaped}\`;
      return 'ok:' + style.textContent.length;
    } catch(e) { return 'err:' + e.message; }
  })()`;
}

/**
 * Build a JS IIFE expression that clears the single `<style>` element content.
 * Used during theme switch / restore to remove all AgentSkin CSS in one shot.
 */
export function clearStyleExpression(): string {
  const styleIdJson = JSON.stringify(STYLE_ID);
  return `(() => {
    try {
      var style = document.getElementById(${styleIdJson});
      if (style) { style.textContent = ''; style.remove(); }
      return 'ok';
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

// ---------------------------------------------------------------------------
// WCAG AA Contrast Fallback (ported from V2 renderer-payload.mjs)
// ---------------------------------------------------------------------------

/**
 * Build a JS IIFE expression that checks the body's foreground/background
 * contrast ratio and, when it falls below WCAG AA (4.5:1), injects
 * `--agentskin-readable-text` and `--agentskin-readable-shadow` onto `:root`.
 *
 * Algorithm (mirrors V2 `applyContrastFallback`):
 *   1. Read `getComputedStyle(document.body)` for `color` and `backgroundColor`.
 *   2. Parse both to RGB (supports `rgba()` and `#rrggbb`).
 *   3. Compute WCAG relative luminance (Rec. 709) and contrast ratio.
 *   4. If ratio >= 4.5, no action needed.
 *   5. Otherwise binary-search a grey (`mix(bg, grey, t)`) that achieves >= 4.5:1,
 *      preferring the smallest `t` (closest to background) for minimal visual change.
 *   6. Inject `--agentskin-readable-text: #rrggbb` and `--agentskin-readable-shadow`.
 *
 * Returns `'contrast-check-done'`.
 */
export function buildContrastFallbackExpression(): string {
  return `(() => {
    try {
      var _body = document.body;
      if (!_body) return 'contrast-check-done';
      var _cs = getComputedStyle(_body);
      var _bgCss = _cs.backgroundColor;
      var _fgCss = _cs.color;

      // --- parse CSS color → [r, g, b] ---
      var _parseColor = function(css) {
        var s = (css || '').trim();
        // NOTE: this source lives inside a template literal, so every regex
        // backslash must be doubled to survive string escaping and reach the
        // page as a single backslash. Collapsing them to one backslash silently
        // degrades the pattern to /^s*rgba?(s*(d+).../ -> "Unterminated group".
        var rgba = /^\\s*rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/.exec(s);
        if (rgba) return [+rgba[1], +rgba[2], +rgba[3]];
        if (s.charAt(0) === '#') {
          var hex = s.slice(1);
          if (hex.length === 3) hex = hex.charAt(0)+hex.charAt(0)+hex.charAt(1)+hex.charAt(1)+hex.charAt(2)+hex.charAt(2);
          if (hex.length === 6) return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
        }
        return null;
      };

      var _bg = _parseColor(_bgCss);
      var _fg = _parseColor(_fgCss);
      if (!_bg || !_fg) return 'contrast-check-done';

      // --- WCAG relative luminance (Rec. 709) ---
      var _lum = function(r, g, b) {
        var c = [r/255, g/255, b/255].map(function(s) {
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };

      var _contrast = function(a, b) {
        var l1 = _lum(a[0], a[1], a[2]);
        var l2 = _lum(b[0], b[1], b[2]);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      };

      var _ratio = _contrast(_bg, _fg);
      if (_ratio >= 4.5) return 'contrast-check-done';

      // --- Binary search for smallest grey mix(bg, fg, t) that meets AA ---
      // The readable color is a grey between black and white that contrasts with bg.
      // Strategy: search over t ∈ [0,1] mixing grey=(1-t)*0 + t*255 → grey level = t*255.
      var _bgLum = _lum(_bg[0], _bg[1], _bg[2]);
      // Determine whether to search dark or white grey based on bg luminance
      var _searchDark = _bgLum > 0.5;
      var _lo = 0.0, _hi = 1.0;
      for (var _i = 0; _i < 30; _i++) {
        var _mid = (_lo + _hi) / 2;
        var _v;
        if (_searchDark) {
          _v = Math.round((1 - _mid) * 255); // from white(1.0) → black(0.0)
        } else {
          _v = Math.round(_mid * 255);       // from black(0.0) → white(1.0)
        }
        var _gLum = _lum(_v, _v, _v);
        var _gr = (Math.max(_gLum, _bgLum) + 0.05) / (Math.min(_gLum, _bgLum) + 0.05);
        if (_gr >= 4.5) {
          if (_searchDark) _lo = _mid; else _hi = _mid;
        } else {
          if (_searchDark) _hi = _mid; else _lo = _mid;
        }
      }
      var _finalT = _searchDark ? _lo : _hi;
      var _gv = _searchDark ? Math.round((1 - _finalT) * 255) : Math.round(_finalT * 255);
      _gv = Math.min(255, Math.max(0, _gv));

      // --- Convert grey to hex ---
      var _toHex = function(v) {
        return v.toString(16).padStart(2, '0');
      };
      var _hex = '#' + _toHex(_gv) + _toHex(_gv) + _toHex(_gv);

      // --- Choose shadow color based on text luminance ---
      var _textLum = _lum(_gv, _gv, _gv);
      var _shadowColor = _textLum > 0.5 ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';

      // --- Inject CSS variables on :root ---
      var _root = document.documentElement;
      if (_root) {
        _root.style.setProperty('--agentskin-readable-text', _hex);
        _root.style.setProperty('--agentskin-readable-shadow', '0 0 3px ' + _shadowColor);
      }
    } catch (e) { /* non-fatal — contrast fallback is best-effort */ }
    return 'contrast-check-done';
  })()`;
}
