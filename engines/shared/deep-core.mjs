// SPDX-License-Identifier: MPL-2.0

/**
 * deep-core.mjs — DeepCore Shared Runtime
 *
 * This is a PURE SCRIPT (no import/export). It is designed to be concatenated
 * ahead of an adapter.mjs source string by the main process, then executed in
 * a CDP `Runtime.evaluate` context where ES module resolution is unavailable.
 *
 * Note: This script uses conventional _private properties (not JS #private
 * fields) because #private fields cannot cross eval()/new Function() scope
 * boundaries needed for unit testing. In the evaluate context, the entire
 * script runs in the same scope, so _ prefix is sufficient convention.
 *
 * @see RFC docs/rfc/2026-08-20-cdp-deep-adaptation-architecture.md
 * @agentskin-engine-keep-alive
 */

// ---------------------------------------------------------------------------
// DeepCore variable (declared as `var` outside the guard)
//
// `var` can be re-declared across multiple Runtime.evaluate calls without
// throwing (V8 allows `var x; var x;` but NOT `class x{}; class x{}`).
// Inside the guard, a class EXPRESSION is assigned to this var.
// This also makes DeepCore stub-injectable for fault-testing.
// ---------------------------------------------------------------------------

var DeepCore = null;

// ---------------------------------------------------------------------------
// Idempotency guard — defend against double injection in the same context.
// When the same evaluate context receives deep-core.mjs multiple times
// (e.g. CDP probe sequences, hot-reload, or adapter retry), class
// declarations would throw "Identifier 'X' has already been declared".
// The guard wraps all declarations in a single block so class scope stays
// internal; exports still run so adapter code can always access globals.
// ---------------------------------------------------------------------------

if (!window.__AGENTSKIN_DEEP_CORE_LOADED__) {
window.__AGENTSKIN_DEEP_CORE_LOADED__ = true;

// ---------------------------------------------------------------------------
// SafeAttachShadowPatcher — attachShadow patch with singleton guard + restore
// ---------------------------------------------------------------------------

class SafeAttachShadowPatcher {
  static _orig = null;          // Original attachShadow reference
  static _patched = false;      // Singleton guard
  static _owned = new WeakMap(); // host element → Set<ShadowRoot>
  static _inject = null;        // Current inject function

  /**
   * Install the patch. If already installed, only updates the inject function.
   * @param {(root: ShadowRoot, host: Element) => void} injectFn
   */
  static install(injectFn) {
    if (this._patched) {
      this._inject = injectFn;
      return;
    }
    this._orig = Element.prototype.attachShadow;
    this._inject = injectFn;
    const self = this;
    const orig = this._orig;

    Element.prototype.attachShadow = function (...args) {
      const root = orig.apply(this, args);
      if (!self._owned.has(self._hostKey(this))) {
        self._owned.set(self._hostKey(this), new Set());
      }
      self._owned.get(self._hostKey(this)).add(root);
      try { self._inject && self._inject(root, this); } catch (e) { /* 静默 */ }
      return root;
    };

    this._patched = true;
    // Save original reference for remote cleanup by removeEngineInjection
    window.__agentskin_shadow_orig__ = orig;
  }

  static uninstall() {
    if (!this._patched) return;
    Element.prototype.attachShadow = this._orig;
    this._orig = null;
    this._patched = false;
    this._inject = null;
    delete window.__agentskin_shadow_orig__;
  }

  static get isPatched() { return this._patched; }

  // Use the element itself as the WeakMap key
  static _hostKey(el) { return el; }
}

// ---------------------------------------------------------------------------
// FragmentRegistry — Modular CSS fragment lifecycle management
// ---------------------------------------------------------------------------

class FragmentRegistry {
  static _fragments = new Map(); // id -> { css, sheet?, active }

  /**
   * Register a CSS fragment. Does not yet inject it.
   * @param {string} id Fragment identifier
   * @param {string} css CSS source text
   */
  static register(id, css) {
    this._fragments.set(id, { css, sheet: null, active: false });
  }

  /**
   * Activate a fragment by adopting its CSS into document.adoptedStyleSheets.
   * Inserted BEFORE the 'custom' layer so custom CSS always wins.
   * @param {string} id Fragment identifier
   */
  static activate(id) {
    const frag = this._fragments.get(id);
    if (!frag || frag.active) return;

    let sheet = frag.sheet;
    if (!sheet) {
      sheet = new CSSStyleSheet();
      try {
        sheet.replaceSync(frag.css);
      } catch (e) {
        console.warn('[DeepCore] FragmentRegistry.activate: replaceSync failed for', id, e);
        return;
      }
      sheet.__agentskin_fragment = id;
      frag.sheet = sheet;
    }

    // Insert before 'custom' layer (custom always wins)
    const sheets = [...(document.adoptedStyleSheets || [])];
    const customIdx = sheets.findIndex(s => s.__agentskin_layer === 'custom');
    const insertAt = customIdx >= 0 ? customIdx : sheets.length;
    sheets.splice(insertAt, 0, sheet);
    document.adoptedStyleSheets = sheets;
    frag.active = true;
  }

  /**
   * Deactivate a fragment and remove its CSS from adoptedStyleSheets.
   * @param {string} id Fragment identifier
   */
  static deactivate(id) {
    const frag = this._fragments.get(id);
    if (!frag || !frag.active) return;
    document.adoptedStyleSheets = (document.adoptedStyleSheets || []).filter(
      s => s.__agentskin_fragment !== id
    );
    frag.active = false;
  }

  /**
   * Hot-replace fragment CSS without flicker. Uses replaceSync for atomic update.
   * Falls back to deactivate+activate if replace fails.
   * @param {string} id Fragment identifier
   * @param {string} newCss New CSS source
   */
  static hotReplace(id, newCss) {
    const frag = this._fragments.get(id);
    if (!frag) {
      this.register(id, newCss);
      this.activate(id);
      return;
    }
    if (frag.sheet) {
      try {
        frag.sheet.replaceSync(newCss);
        return;
      } catch (e) {
        // Fall through to deactivate+activate
      }
    }
    this.deactivate(id);
    frag.css = newCss;
    frag.sheet = null;
    this.activate(id);
  }

  /**
   * Dispose all fragments and clear registry.
   */
  static dispose() {
    for (const id of [...this._fragments.keys()]) {
      this.deactivate(id);
    }
    this._fragments.clear();
  }
}

// ---------------------------------------------------------------------------
// RouteDetector — SPA route awareness with history patch + restore
// ---------------------------------------------------------------------------

function _testRoute(route) {
  if (route.test.selector) {
    return !!document.querySelector(route.test.selector);
  }
  if (route.test.urlPattern) {
    const url = location.hash || location.pathname;
    if (route.test.urlPattern.endsWith('*')) {
      return url.startsWith(route.test.urlPattern.slice(0, -1));
    }
    return url === route.test.urlPattern;
  }
  return false;
}

function initRouteDetector(routes, onTransition) {
  const state = { current: null };

  function detect() {
    for (const route of routes) {
      if (_testRoute(route)) {
        if (route.id !== state.current) {
          onTransition && onTransition(state.current, route);
          state.current = route.id;
        }
        return;
      }
    }
    // No route matched
    if (state.current !== null) {
      onTransition && onTransition(state.current, null);
      state.current = null;
    }
  }

  // Patch SPA navigation methods
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) { origPush.apply(this, args); detect(); };
  history.replaceState = function (...args) { origReplace.apply(this, args); detect(); };

  const onPop = () => detect();
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);

  // Initial detection
  detect();

  // Return restore function (P1-1 fix)
  return {
    disconnect() {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    }
  };
}

// ---------------------------------------------------------------------------
// ContextAwareEngine — Read application state from window/DOM/storage
// ---------------------------------------------------------------------------

function _readState(spec) {
  try {
    switch (spec.from) {
      case 'window':
        return spec.path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
      case 'dom':
        return document.querySelector(spec.selector) && document.querySelector(spec.selector).getAttribute(spec.attr);
      case 'sessionStorage':
        return sessionStorage.getItem(spec.path);
      case 'localStorage':
        return localStorage.getItem(spec.path);
      default:
        return undefined;
    }
  } catch (e) {
    return undefined;
  }
}

function initContextEngine(stateSpecs, onStateChange) {
  const readAll = function() {
    const result = {};
    for (const s of stateSpecs) {
      result[s.key] = _readState(s);
    }
    return result;
  };
  let prev = readAll();

  const check = function() {
    const next = readAll();
    const changes = stateSpecs.filter(function(s) { return prev[s.key] !== next[s.key]; });
    if (changes.length) {
      prev = next;
      onStateChange && onStateChange(changes, next);
    }
  };

  const interval = setInterval(check, 1000);
  return {
    interval: interval,
    readAll: readAll,
    disconnect: function() { clearInterval(interval); }
  };
}

// ---------------------------------------------------------------------------
// scanOpenShadowsAsync — Chunked async open-shadow DOM scan (P1-5 fix)
// ---------------------------------------------------------------------------

function scanOpenShadowsAsync(onFound) {
  const CHUNK_SIZE = 200;
  const nodes = document.querySelectorAll('*');
  let idx = 0;

  function processChunk() {
    const end = Math.min(idx + CHUNK_SIZE, nodes.length);
    for (; idx < end; idx++) {
      const el = nodes[idx];
      if (el.shadowRoot && el.shadowRoot.mode === 'open') {
        onFound(el.shadowRoot, el);
      }
    }
    if (idx < nodes.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processChunk, { timeout: 100 });
      } else {
        setTimeout(processChunk, 0);
      }
    }
  }
  processChunk();
}

// ---------------------------------------------------------------------------
// DeepCore — Main entry point (encapsulates all modules above)
// Assigned as a class EXPRESSION to the outer `var DeepCore`.
// ---------------------------------------------------------------------------

DeepCore = class DeepCore {
  constructor(config, ctx) {
    // Dispose any previous instance first (idempotent)
    if (window.__AGENTSKIN_DEEP_CORE__) {
      try { window.__AGENTSKIN_DEEP_CORE__.dispose(); } catch (e) { /* ignore */ }
    }

    this._config = config || {};
    this._ctx = ctx || {};
    this._observers = [];
    this._disposers = [];
    this._marker = '__agentskin_' + (this._ctx.agent || 'unknown') + '_adapter__';

    try {
      this._init();
      window.__AGENTSKIN_DEEP_CORE__ = this;
      // P0-2 fix: Write back to window[MARKER] for existing cleanup chain
      window[this._marker] = { observers: this._observers, interval: null, deepCore: true };
    } catch (err) {
      console.warn('[DeepCore] init failed, adapter fallback:', err);
      throw err; // Re-throw so adapter can fallback to legacy logic
    }
  }

  _init() {
    // 1. Register all fragments
    const fragments = this._config.fragments || {};
    for (const id in fragments) {
      FragmentRegistry.register(id, fragments[id]);
    }

    // 2. ShadowPiercer (layered degradation)
    this._initShadowPiercer();

    // 3. RouteDetector (with history restore)
    const self = this;
    const routeHandle = initRouteDetector(this._config.routes || [], function(from, to) {
      if (to && to.enterFragment) FragmentRegistry.activate(to.enterFragment);
      if (from) {
        const routes = self._config.routes || [];
        for (let i = 0; i < routes.length; i++) {
          if (routes[i].id === from && routes[i].exitFragment) {
            FragmentRegistry.deactivate(routes[i].exitFragment);
            break;
          }
        }
      }
    });
    this._disposers.push(routeHandle);

    // 4. ContextAwareEngine
    const contextHandle = initContextEngine(this._config.exposedState || [], function() {
      // State change callback - can trigger fragment switching in future
    });
    this._observers.push({ disconnect: function() { contextHandle.disconnect(); } });

    // 5. Fallback observer (wraps existing AdaptiveMutationObserver logic)
    this._initFallbackObserver();
  }

  _initShadowPiercer() {
    const config = this._config;

    // Layer 1: CSS variables (always applied, zero side effects)
    if (config.variables && document.documentElement) {
      const vars = config.variables;
      for (const k in vars) {
        document.documentElement.style.setProperty(k, vars[k]);
      }
    }

    // Layer 2: Existing open shadowRoots → adoptedSheets
    const injectIntoRoot = (root) => {
      if (config.shadowCss && root) {
        const sheet = new CSSStyleSheet();
        try {
          sheet.replaceSync(config.shadowCss);
          sheet.__agentskin = true;
          root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), sheet];
        } catch (e) { /* sheet replace failed, skip */ }
      }
    };

    scanOpenShadowsAsync(injectIntoRoot);

    // Also observer future open shadowRoots
    const obs = new MutationObserver(function(mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (node.nodeType === 1 && node.shadowRoot && node.shadowRoot.mode === 'open') {
            injectIntoRoot(node.shadowRoot);
          }
        }
      }
    });
    if (document.documentElement) {
      obs.observe(document.documentElement, { childList: true, subtree: true });
      this._observers.push(obs);
    }

    // Layer 3: attachShadow patch (only when mode='all')
    if (config.shadowMode === 'all') {
      SafeAttachShadowPatcher.install(function(root) { injectIntoRoot(root); });
    }
  }

  _initFallbackObserver() {
    // Placeholder: wraps existing AdaptiveMutationObserver self-healing logic
    // In T7-T9, this will be replaced with the full AdaptiveMutationObserver
    // wrapping from the existing adapter.mjs code.
  }

  /**
   * Full cleanup — dispose fragments, restore prototypes, disconnect observers.
   */
  dispose() {
    for (let i = 0; i < this._observers.length; i++) {
      try { this._observers[i].disconnect && this._observers[i].disconnect(); } catch (e) { /* ignore */ }
    }
    for (let i = 0; i < this._disposers.length; i++) {
      try { this._disposers[i].disconnect && this._disposers[i].disconnect(); } catch (e) { /* ignore */ }
    }
    FragmentRegistry.dispose();
    SafeAttachShadowPatcher.uninstall();
    this._observers = [];
    this._disposers = [];
    delete window.__AGENTSKIN_DEEP_CORE__;
    delete window.__AGENTSKIN_DEEP_CORE_LOADED__;
    // Note: window[this._marker] is cleaned by main process CLEAR_ADAPTERS_BODY
  }
}

// Export to global scope for evaluate context — inside the guard.
// All three classes are block-scoped; re-export so global/window access works.
window.DeepCore = DeepCore;
window.SafeAttachShadowPatcher = SafeAttachShadowPatcher;
window.FragmentRegistry = FragmentRegistry;

} // __AGENTSKIN_DEEP_CORE_LOADED__ guard
