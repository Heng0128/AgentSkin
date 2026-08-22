/**
 * HYBRID-INJECTOR — CDP Strategy API for AgentSkin engines
 * ============================================================
 * Portable pattern merged from GitHub Top 5:
 *   1. Dark Reader Dynamic Theme  → incremental setProperty + rAF batching
 *   2. Stylus apply.js             → stylesheet lifecycle (add/remove/dedup/scope)
 *   3. Puppeteer CDP batch         → setStyleTexts atomic full-theme switch
 *   4. Catppuccin tokenColors      → semantic token naming (14-token contract)
 *   5. Shadow DOM adoptedStyleSets → cross-boundary style penetration
 *
 * Hybrid strategy:
 *   - Incremental (1-2 tokens, live slider) → setProperty O(1) per token
 *   - Batch (14 tokens, full theme switch)  → CDP setStyleTexts atomic replace
 *   - Dynamic (100+ elements)               → CSS custom property inheritance
 *
 * Pure script (no import/export) — concatenated ahead of adapter.mjs by the
 * main process, executed in CDP Runtime.evaluate context where ES module
 * resolution is unavailable. IIFE-wrapped with idempotency guard (same
 * pattern as deep-core.mjs).
 *
 * @agentskin-engine-keep-alive
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Idempotency guard — short-circuit re-injection.
  // ---------------------------------------------------------------------------
  if (window.__AGENTSKIN_HYBRID_INJECTOR_LOADED__) return;
  window.__AGENTSKIN_HYBRID_INJECTOR_LOADED__ = true;

  // ---------------------------------------------------------------------------
  // rAF batching queue — coalesces rapid token changes into a single frame.
  // Dark Reader pattern: slider drags fire 60+ events/sec; we collapse them
  // into one setProperty pass per frame.
  // ---------------------------------------------------------------------------
  let _rafQueue = null;
  let _rafId = 0;
  let _rafCallbacks = [];

  function _rafFlush() {
    const items = _rafQueue;
    const cbs = _rafCallbacks;
    _rafQueue = null;
    _rafId = 0;
    _rafCallbacks = [];
    if (items) {
      const root = document.documentElement;
      for (const [k, v] of items) root.style.setProperty(k, v);
    }
    for (const cb of cbs) { try { cb(); } catch {} }
  }

  function _rafSchedule() {
    if (_rafId) return;
    _rafId = (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (f => setTimeout(f, 16)))(_rafFlush);
  }

  // ---------------------------------------------------------------------------
  // StyleSheet Registry — Stylus apply.js pattern.
  // Manages stylesheet lifecycle: add/remove/dedup/scope-isolation.
  // ---------------------------------------------------------------------------
  const _sheets = new Map(); // id -> { sheet, meta }

  function _ensureSheet(id) {
    const existing = _sheets.get(id);
    if (existing) return existing;
    const sheet = new CSSStyleSheet();
    sheet.__agentskin = true;
    sheet.__agentskin_layer = id;
    const entry = { sheet, meta: { id, active: false } };
    _sheets.set(id, entry);
    return entry;
  }

  function _adoptSheet(id) {
    const entry = _sheets.get(id);
    if (!entry || entry.meta.active) return;
    const sheets = document.adoptedStyleSheets || [];
    const filtered = sheets.filter(s => !(s.__agentskin === true && s.__agentskin_layer === id));
    filtered.push(entry.sheet);
    document.adoptedStyleSheets = filtered;
    entry.meta.active = true;
  }

  function _removeSheet(id) {
    const entry = _sheets.get(id);
    if (!entry || !entry.meta.active) return;
    document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(
      s => !(s.__agentskin === true && s.__agentskin_layer === id)
    );
    entry.meta.active = false;
  }

  // ---------------------------------------------------------------------------
  // HybridInjector — main entry point.
  // ---------------------------------------------------------------------------
  class HybridInjector {
    constructor() {
      this.tokenCache = new Map(); // last-known token values for dedup
    }

    /**
     * Incremental update — setProperty on documentElement.
     * O(1) per token. Uses rAF batching for rapid successive calls.
     * Pattern: Dark Reader Dynamic Theme Generator.
     *
     * @param {Record<string,string>} tokens — { "--agentskin-accent": "#ff0000", ... }
     * @param {boolean} immediate — skip rAF batching (for tests / single updates)
     */
    applyIncremental(tokens, immediate = false) {
      if (!tokens || typeof tokens !== 'object') return 0;
      const keys = Object.keys(tokens);
      if (keys.length === 0) return 0;

      if (immediate) {
        const root = document.documentElement;
        let applied = 0;
        for (const k of keys) {
          const v = tokens[k];
          if (this.tokenCache.get(k) === v) continue; // dedup
          root.style.setProperty(k, v);
          this.tokenCache.set(k, v);
          applied++;
        }
        return applied;
      }

      // rAF batching
      if (!_rafQueue) _rafQueue = [];
      let count = 0;
      for (const k of keys) {
        const v = tokens[k];
        if (this.tokenCache.get(k) === v) continue;
        _rafQueue.push([k, v]);
        this.tokenCache.set(k, v);
        count++;
      }
      if (count > 0) _rafSchedule();
      return count;
    }

    /**
     * Full theme switch — replace entire CSS layer atomically.
     * Pattern: Puppeteer CDP batch setStyleTexts.
     * Uses CSSStyleSheet.replaceSync for single-pass replacement.
     *
     * @param {string} layerId — layer identifier (e.g. "palette", "tokens")
     * @param {string} css — full CSS source
     */
    applyFullTheme(layerId, css) {
      const entry = _ensureSheet(layerId);
      try {
        entry.sheet.replaceSync(css);
      } catch {
        // Fallback: remove + re-add on parse failure
        _removeSheet(layerId);
        entry.sheet = new CSSStyleSheet();
        entry.sheet.__agentskin = true;
        entry.sheet.__agentskin_layer = layerId;
        entry.sheet.replaceSync(css);
        _sheets.set(layerId, entry);
      }
      _adoptSheet(layerId);
      return entry.sheet.cssRules.length;
    }

    /**
     * Batch atomic update — CDP DOM.setStyleTexts equivalent.
     * Replaces multiple style rules in a single pass.
     * Pattern: Puppeteer CDP batch setStyleTexts.
     *
     * @param {string} layerId — target layer
     * @param {Array<{selectorText: string, style: Record<string,string>}>} rules
     */
    applyBatch(layerId, rules) {
      if (!Array.isArray(rules) || rules.length === 0) return 0;
      const css = rules.map(r => `${r.selectorText} { ${Object.entries(r.style).map(([k, v]) => `${k}: ${v}`).join('; ')} }`).join('\n');
      return this.applyFullTheme(layerId, css);
    }

    /**
     * Hot-replace a single layer without flicker.
     * Pattern: Stylus apply.js hotReplace.
     *
     * @param {string} layerId
     * @param {string} newCss
     */
    hotReplace(layerId, newCss) {
      const entry = _sheets.get(layerId);
      if (!entry) return this.applyFullTheme(layerId, newCss);
      try {
        entry.sheet.replaceSync(newCss);
        return entry.sheet.cssRules.length;
      } catch {
        return this.applyFullTheme(layerId, newCss);
      }
    }

    /**
     * Remove a layer by id.
     * @param {string} layerId
     */
    removeLayer(layerId) {
      _removeSheet(layerId);
    }

    /**
     * Dispose all layers and reset state.
     */
    dispose() {
      for (const id of [..._sheets.keys()]) _removeSheet(id);
      _sheets.clear();
      this.tokenCache.clear();
      if (_rafId) {
        if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(_rafId);
        _rafId = 0;
      }
      _rafQueue = null;
      _rafCallbacks = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Export to global scope.
  // ---------------------------------------------------------------------------
  window.HybridInjector = HybridInjector;

})();
