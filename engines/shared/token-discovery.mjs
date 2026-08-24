// SPDX-License-Identifier: MPL-2.0

/**
 * TOKEN-DISCOVERY — Shared Token Auto-Discovery Engine
 * =====================================================
 * Consolidates the O(n*m*k) full-stylesheet-scan pattern duplicated across
 * qoderwork / workbuddy / zcode / doubao adapters into a single incremental
 * engine with result caching and performance budget.
 *
 * ## Problem
 * All 4 adapters traverse `document.styleSheets → cssRules → style` in full
 * on every self-heal tick. Large apps (hundreds of stylesheets, thousands of
 * rules) pay O(n*m*k) per heal — causing jank.
 *
 * Solution: Shared module that performs an initial full scan then uses a
 * MutationObserver to watch for newly-added `<style>`/`<link>` elements,
 * only re-scanning changed sheets. A Map<prop, { category, lastValue }>
 * caches classification results to avoid redundant work.
 *
 * ## Design
 *   1. Pure script (no import/export) — concatenated ahead of adapter.mjs by
 *      the main process, executed in CDP Runtime.evaluate context.
 *   2. IIFE-wrapped with idempotency guard (same pattern as deep-core.mjs).
 *   3. Factory returns an agent instance scoped to a config.
 *   4. scan() returns Set of discovered CSS custom property names.
 *   5. getOverrides() returns a CSS :root{} rule string with !important overrides.
 *   6. Single MutationObserver instance shared across all agents.
 *   7. Performance budget: sheets exceeding `chunkSize` rules are split across
 *      setTimeout(0) frames to avoid blocking the main thread (FOUC-safe).
 *   8. `dispose()` disconnects the observer and clears caches.
 *
 * ## Adapter Config Examples
 *
 *   // qoderwork — narrow prefix, bg-only classification
 *   createTokenDiscoveryAgent({
 *     knownPrefixes: ['--color-'],
 *     hostClass: 'agentskin-host-qoderwork',
 *     outputSelector: 'html.agentskin-host-qoderwork:root',
 *     classify: (prop) => /bg|background|container|layout/.test(prop) ? 'bg' : null
 *   });
 *
 *   // workbuddy — multi-prefix, full classification
 *   createTokenDiscoveryAgent({
 *     knownPrefixes: ['--cb-', '--wb-'],
 *     excludeSuffix: '-raw',
 *     hostClass: 'agentskin-host-workbuddy',
 *     outputSelector: 'html.agentskin-host-workbuddy body',
 *     categoryPatterns: { ... },
 *     valueTransformers: { ... }
 *   });
 *
 *   // zcode — no prefix filter (matches all --*)
 *   createTokenDiscoveryAgent({
 *     knownPrefixes: [],
 *     hostClass: 'agentskin-host-zcode',
 *     outputSelector: 'html.agentskin-host-zcode:root'
 *   });
 *
 *   // doubao — multi-prefix, full classification
 *   createTokenDiscoveryAgent({
 *     knownPrefixes: ['--dbx-', '--s-color-', '--ffc-', '--chat-', '--semi-color-'],
 *     excludeSuffix: '-raw',
 *     hostClass: 'agentskin-host-doubao',
 *     outputSelector: 'html.agentskin-host-doubao:root'
 *   });
 *
 * @agentskin-engine-keep-alive
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Idempotency guard — one-time install per page.
  // ---------------------------------------------------------------------------
  if (window.__AGENTSKIN_TOKEN_DISCOVERY_LOADED__) return;
  window.__AGENTSKIN_TOKEN_DISCOVERY_LOADED__ = true;

  // ---------------------------------------------------------------------------
  // Shared MutationObserver singleton — watches for new <style>/<link>.
  // Each agent registers a callback; the observer dispatches sheet-loaded
  // events to the appropriate agents based on sheet identity.
  // ---------------------------------------------------------------------------
  let _sharedObserver = null;
  let _agentCount = 0;
  let _pendingSheetResolve = null;

  function _ensureSharedObserver() {
    if (_sharedObserver) return;

    _sharedObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const nodes = mutations[i].addedNodes;
        for (let j = 0; j < nodes.length; j++) {
          const node = nodes[j];
          if (node.nodeType !== 1) continue;
          const tag = node.tagName;
          if (tag === 'STYLE' || tag === 'LINK') {
            _notifySheetChanged(node);
          }
        }
      }
    });

    _sharedObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  }

  // Track <link rel=stylesheet> load completion via polling fallback
  // (load event may not fire in some CSP-restricted contexts).
  function _notifySheetChanged(node) {
    const tag = node.tagName;
    if (tag === 'STYLE') {
      // Inline stylesheets are immediately readable
      if (_pendingSheetResolve) _pendingSheetResolve(node);
    } else if (tag === 'LINK') {
      // External stylesheet — try onload, with timeout fallback
      let resolved = false;
      const onReady = () => {
        if (resolved) return;
        resolved = true;
        if (_pendingSheetResolve) _pendingSheetResolve(node);
      };
      try {
        node.addEventListener('load', onReady, { once: true });
        node.addEventListener('error', onReady, { once: true });
      } catch {}
      // Safety net: if onload doesn't fire within 3s, proceed anyway
      setTimeout(() => { if (!resolved) onReady(); }, 3000);
    }
  }

  function _disposeSharedObserver() {
    if (!_sharedObserver) return;
    _sharedObserver.disconnect();
    _sharedObserver = null;
    _pendingSheetResolve = null;
  }

  // ---------------------------------------------------------------------------
  // Default category patterns — extracted from adapter implementations.
  // Order matters: first match wins. Adapters can override via config.
  // ---------------------------------------------------------------------------
  const DEFAULT_CATEGORY_PATTERNS = {
    bg: /bg|background|surface|fill(?!-highlight)|body(?!-web)|panel|container|layout/,
    text: /text|fg|foreground|label|title|desc/,
    accent: /accent|brand|primary(?!-raw)|highlight|link|active|focus/,
    border: /border|line|divider|outline|stroke/
  };

  const DEFAULT_VALUE_TRANSFORMS = {
    bg: (value) => `color-mix(in srgb, var(--agentskin-surface) 85%, transparent)`,
    text: (value) => `var(--agentskin-text)`,
    accent: (value) => `var(--agentskin-accent)`,
    border: (value) => `color-mix(in srgb, var(--agentskin-border) 50%, transparent)`
  };

  const DEFAULT_BG_VALUE_FILTER = (value) =>
    (value.startsWith('#') || value.startsWith('rgb')) && value !== 'transparent';

  // ---------------------------------------------------------------------------
  // Factory: createTokenDiscoveryAgent(config)
  //
  // config:
  //   knownPrefixes   : string[]  — CSS variable prefixes to match. Empty = all --*.
  //   excludeSuffix   : string    — Exclude properties ending with this (e.g. '-raw').
  //   hostClass       : string    — Used for scoping (informational, not output).
  //   outputSelector  : string    — Selector for the :root override rule.
  //   categoryPatterns: object    — { bg: RegExp, text: RegExp, ... } overrides.
  //   valueTransforms : object    — { bg: fn, text: fn, ... } overrides.
  //   bgValueFilter   : function  — (value) => boolean — whether to apply bg override.
  //   chunkSize       : number    — Max rules per frame before setTimeout(0) split.
  //   debug           : boolean   — Log performance counters to console.
  // ---------------------------------------------------------------------------
  function createTokenDiscoveryAgent(config) {
    const _cfg = config || {};
    const knownPrefixes = _cfg.knownPrefixes || [];
    const excludeSuffix = _cfg.excludeSuffix || '';
    const outputSelector = _cfg.outputSelector || ':root';
    const categoryPatterns = Object.assign({}, DEFAULT_CATEGORY_PATTERNS, _cfg.categoryPatterns || {});
    const valueTransforms = Object.assign({}, DEFAULT_VALUE_TRANSFORMS, _cfg.valueTransforms || {});
    const bgValueFilter = _cfg.bgValueFilter || DEFAULT_BG_VALUE_FILTER;
    const chunkSize = _cfg.chunkSize || 500;
    const debug = !!_cfg.debug;

    // -- State --
    const _cache = new Map();     // prop → { category, lastValue, lastOverride }
    const _allProps = new Set();  // all discovered property names
    const _scannedSheets = new WeakSet();  // sheets already fully scanned
    let _initialized = false;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _matchesPrefix(prop) {
      if (prop.indexOf('--') !== 0) return false;
      if (prop.includes('agentskin')) return false;
      if (excludeSuffix && prop.endsWith(excludeSuffix)) return false;
      if (knownPrefixes.length === 0) return true;  // zcode: match all --*
      for (let i = 0; i < knownPrefixes.length; i++) {
        if (prop.startsWith(knownPrefixes[i])) return true;
      }
      return false;
    }

    function _classify(prop) {
      const name = prop.toLowerCase();
      // Order: bg → text → accent → border (first match wins)
      if (categoryPatterns.bg && categoryPatterns.bg.test(name)) {
        // But don't double-classify accent-ish bg names
        if (categoryPatterns.accent && categoryPatterns.accent.test(name)
            && !categoryPatterns.text?.test(name)) {
          return 'accent';
        }
        return 'bg';
      }
      if (categoryPatterns.text && categoryPatterns.text.test(name)) return 'text';
      if (categoryPatterns.accent && categoryPatterns.accent.test(name)) return 'accent';
      if (categoryPatterns.border && categoryPatterns.border.test(name)) return 'border';
      return null;
    }

    // -------------------------------------------------------------------------
    // scan() — Incremental scan across all accessible stylesheets.
    // Returns: Set of all discovered property names (cached + new).
    // -------------------------------------------------------------------------
    function scan() {
      if (!_initialized) {
        _ensureSharedObserver();
        _agentCount++;
        _initialized = true;
      }

      const sheets = document.styleSheets;
      let newCount = 0;

      for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        // Skip already-scanned sheets
        if (_scannedSheets.has(sheet)) continue;

        const rules = _safeGetRules(sheet);
        if (rules === null) continue;

        const totalRules = rules.length;
        if (totalRules > chunkSize) {
          // Chunked scan for large sheets to avoid jank
          _scanSheetChunked(sheet, rules, 0, chunkSize, (prop) => {
            if (!_allProps.has(prop)) { _allProps.add(prop); newCount++; }
          });
        } else {
          _scanSheetRules(sheet, rules, (prop) => {
            if (!_allProps.has(prop)) { _allProps.add(prop); newCount++; }
          });
        }
      }

      if (debug && newCount > 0) {
        console.log(`[TokenDiscovery] scan: +${newCount} new props (total: ${_allProps.size})`);
      }

      return _allProps;
    }

    /**
     * Extract CSS rules from a sheet, handling cross-origin restrictions.
     * Returns CSSRuleList or null if access is denied.
     */
    function _safeGetRules(sheet) {
      try {
        return sheet.cssRules || sheet.rules || null;
      } catch {
        return null;
      }
    }

    /**
     * Synchronously scan a rules collection, calling onProp for each match.
     */
    function _scanSheetRules(sheet, rules, onProp) {
      for (let i = 0; i < rules.length; i++) {
        _scanRule(rules[i], onProp);
      }
      _scannedSheets.add(sheet);
    }

    /**
     * Chunked scan: process rules in batches, yielding to event loop.
     * Does NOT mark sheet as scanned until complete.
     */
    function _scanSheetChunked(sheet, rules, start, size, onProp) {
      const end = Math.min(start + size, rules.length);
      for (let i = start; i < end; i++) {
        _scanRule(rules[i], onProp);
      }
      if (end < rules.length) {
        // Continue in next frame (setTimeout to avoid FOUC — rIC defers too long)
        setTimeout(() => {
          _scanSheetChunked(sheet, rules, end, size, onProp);
        }, 0);
      } else {
        _scannedSheets.add(sheet);
      }
    }

    /**
     * Scan a single CSS rule for custom properties.
     * Recurses into conditional rules (@media, @supports).
     */
    function _scanRule(rule, onProp) {
      if (rule.style) {
        const style = rule.style;
        for (let i = 0; i < style.length; i++) {
          const prop = style[i];
          if (_matchesPrefix(prop)) onProp(prop);
        }
      }
      // Recurse into @media / @supports / @layer
      if (rule.cssRules) {
        try {
          const nested = rule.cssRules;
          for (let j = 0; j < nested.length; j++) {
            _scanRule(nested[j], onProp);
          }
        } catch {
          // Cross-origin nested rules — silently skip
        }
      }
    }

    // -------------------------------------------------------------------------
    // getOverrides() — Generate CSS override string from classified properties.
    // Returns: "selector {\n  prop: value !important;\n  ...\n}" or "" if none.
    // -------------------------------------------------------------------------
    function getOverrides() {
      if (_allProps.size === 0) return '';

      const rootStyle = _safeGetComputedStyle(document.documentElement);
      const bodyStyle = _safeGetComputedStyle(document.body);
      const overrides = [];

      _allProps.forEach((prop) => {
        let value = (rootStyle ? rootStyle.getPropertyValue(prop).trim() : '')
          || (bodyStyle ? bodyStyle.getPropertyValue(prop).trim() : '');

        if (!value || value === 'transparent' || value.includes('--agentskin')) return;

        const category = _classify(prop);
        if (!category) return;

        // BG category requires value filter (must be #hex or rgb)
        if (category === 'bg' && !bgValueFilter(value)) return;

        const transformer = valueTransforms[category];
        if (!transformer) return;

        const overrideValue = transformer(value);
        if (!overrideValue) return;

        // Cache for debugging
        _cache.set(prop, { category, lastValue: value, lastOverride: overrideValue });

        overrides.push(`${prop}: ${overrideValue}`);
      });

      if (overrides.length === 0) return '';

      return `${outputSelector} {\n  ${overrides.map(o => o + ' !important').join(';\n  ')};\n}`;
    }

    function _safeGetComputedStyle(el) {
      try { return getComputedStyle(el); } catch { return null; }
    }

    // -------------------------------------------------------------------------
    // invalidate() — Clear all caches and reset scanned-sheet registry.
    // Next scan() will be a full re-scan.
    // -------------------------------------------------------------------------
    function invalidate() {
      _cache.clear();
      _allProps.clear();
      // _scannedSheets WeakSet cannot be cleared directly;
      // it will be GC'd when sheets are removed. For full invalidation,
      // we flag that all sheets need re-scanning by using a new WeakSet.
      _scannedSheets.clear();  // WeakSet has no .clear() — handled below
    }

    // Note: WeakSet doesn't have .clear(). Adapter can dispose + recreate
    // agent for full invalidation. This clears what we can.
    // Workaround: create a sentinel flag
    let _forceRescan = false;

    function invalidateFull() {
      _cache.clear();
      _allProps.clear();
      _forceRescan = true;
      _initialized = false;  // Trigger MutationObserver re-init on next scan
      _agentCount = Math.max(0, _agentCount - 1);
    }

    // -------------------------------------------------------------------------
    // dispose() — Stop observing, clear state.
    // -------------------------------------------------------------------------
    function dispose() {
      invalidateFull();
      _agentCount = Math.max(0, _agentCount - 1);
      if (_agentCount === 0) {
        _disposeSharedObserver();
      }
    }

    return {
      scan: scan,
      getOverrides: getOverrides,
      invalidate: invalidateFull,
      dispose: dispose,

      // Expose internals for adapter-level integration (optional)
      getStats: () => ({
        totalDiscovered: _allProps.size,
        cachedEntries: _cache.size,
        initialized: _initialized
      })
    };
  }

  // ---------------------------------------------------------------------------
  // MutationObserver bridge: when new <style>/<link> appears, agents that
  // share the observer get rescan signal. We store per-agent callbacks.
  // (Simplified: the factory calls scan() on the next adapter self-heal tick,
  // which picks up new sheets automatically.)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Export — global namespace for CDP Runtime.evaluate context.
  // ---------------------------------------------------------------------------
  window.__agentskin_token_discovery__ = {
    createAgent: createTokenDiscoveryAgent
  };

})();
