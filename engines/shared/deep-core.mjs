// SPDX-License-Identifier: MPL-2.0

/**
 * deep-core.mjs — DeepCore Shared Runtime
 *
 * This is a PURE SCRIPT (no import/export). It is designed to be concatenated
 * ahead of an adapter.mjs source string by the main process, then executed in
 * a CDP `Runtime.evaluate` context where ES module resolution is unavailable.
 *
 * ## Architecture: IIFE-wrapped with idempotency guard
 *
 * The entire script runs inside an IIFE (Immediately Invoked Function Expression).
 * This is REQUIRED because:
 *
 *   1. V8 persists global lexical bindings across Runtime.evaluate calls in the
 *      same page. A top-level `class X {}` declaration creates a binding in the
 *      global lexical environment that persists across calls. Re-evaluating the
 *      same script throws "Identifier 'X' has already been declared".
 *
 *   2. Wrapping in an IIFE makes all class/function declarations function-scoped.
 *      Each IIFE invocation gets a fresh scope, so re-injection does not throw.
 *
 *   3. The idempotency guard (`__AGENTSKIN_DEEP_CORE_LOADED__`) short-circuits
 *      re-injection: on second call, the IIFE returns immediately without
 *      re-evaluating the class declarations. The first call's window.X exports
 *      remain valid.
 *
 * Note: This script uses conventional _private properties (not JS #private
 * fields) because #private fields cannot cross eval()/new Function() scope
 * boundaries needed for unit testing. In the evaluate context, the entire
 * script runs in the same scope, so _ prefix is sufficient convention.
 *
 * ## Instance Fields (not static)
 *
 * SafeAttachShadowPatcher and FragmentRegistry were rewritten from static
 * classes to instance classes. Each new DeepCore() creates its own independent
 * instances, ensuring dispose() does not destroy state belonging to other
 * DeepCore instances.
 *
 * SafeAttachShadowPatcher still maintains a module-level singleton on
 * Element.prototype.attachShadow (only one patched method can exist on the
 * global prototype). Coordination is handled via _currentPatcher so that a
 * later DeepCore install() takes over the patched wrapper (repointing it to
 * its own inject callback) and uninstall() only restores the original when
 * the last patcher releases.
 *
 * @see RFC docs/rfc/2026-08-20-cdp-deep-adaptation-architecture.md
 * @agentskin-engine-keep-alive
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Idempotency guard — short-circuit re-injection.
  // On first call: flag is undefined → proceed.
  // On re-injection: flag is true → return early. No class declarations are
  // evaluated → no "already declared" SyntaxError.
  // ---------------------------------------------------------------------------

  if (window.__AGENTSKIN_DEEP_CORE_LOADED__) {
    return;
  }
  window.__AGENTSKIN_DEEP_CORE_LOADED__ = true;

  // ---------------------------------------------------------------------------
  // SafeAttachShadowPatcher — attachShadow patch with instance restore
  //
  // Wraps Element.prototype.attachShadow so that every newly created shadow root
  // (from any host) is passed through a single inject callback.
  //
  // State is per-instance. Only ONE patched method exists on the global
  // prototype at a time; a module-level coordinator (_currentPatcher) keeps
  // track of which instance is currently installed so that a newer install
  // can repoint the wrapper before an older instance is disposed.
  // ---------------------------------------------------------------------------

  // Module-level: singleton semantics for the patched prototype method.
  // Only one of these exists per IIFE regardless of how many DeepCore instances
  // are created — because Element.prototype.attachShadow cannot be patched
  // multiple times without nesting.
  let _origAttachShadow = null;
  let _currentPatcher = null; // SafeAttachShadowPatcher instance currently owning the patch

  class SafeAttachShadowPatcher {
    constructor() {
      this._inject = null;        // Current inject function (root, host) => void
      this._owned = new WeakMap(); // host element → Set<ShadowRoot>
      this._patching = false;     // Whether THIS instance currently owns the patch
    }

    /**
     * Install or update the patch.
     * - If no patch exists yet: captures the original, installs the wrapper.
     * - If another patcher owns the patch: transfers ownership to this instance.
     * - If this instance already owns the patch: just updates the inject fn.
     * @param {(root: ShadowRoot, host: Element) => void} injectFn
     */
    install(injectFn) {
      this._inject = injectFn;

      // This instance already owns the patch → just update the callback.
      if (this._patching) return;

      // First install ever → capture original and install the wrapper.
      if (!_currentPatcher) {
        _origAttachShadow = Element.prototype.attachShadow;

        const orig = _origAttachShadow;

        // The wrapper reads _currentPatcher dynamically at call time so a
        // newer patcher can take over simply by setting _currentPatcher.
        const wrapper = function (...args) {
          const root = orig.apply(this, args);
          const p = _currentPatcher;
          if (p) {
            const key = this;
            if (!p._owned.has(key)) {
              p._owned.set(key, new Set());
            }
            p._owned.get(key).add(root);
            try { p._inject && p._inject(root, this); } catch (e) { /* 静默 */ }
          }
          return root;
        };

        Element.prototype.attachShadow = wrapper;

        // Expose the original for the main-process cleanup expression.
        window.__agentskin_shadow_orig__ = orig;
      }
      // Another patcher owns the patch → transfer ownership. Keep the same
      // wrapper; just swap _currentPatcher. The wrapper reads the current
      // patcher at call time, so the new patcher's callback takes effect
      // immediately. The old patcher keeps its _owned bookkeeping for its
      // own eventual dispose() but no longer receives inject calls.
      else {
        _currentPatcher._patching = false;
      }

      _currentPatcher = this;
      this._patching = true;
    }

    /**
     * Restore the original attachShadow and clean up.
     * Safe to call multiple times; only acts if this instance owns the patch.
     */
    uninstall() {
      if (!this._patching) return;
      Element.prototype.attachShadow = _origAttachShadow;
      this._patching = false;
      this._inject = null;
      _origAttachShadow = null;
      _currentPatcher = null;
      delete window.__agentskin_shadow_orig__;
    }

    get isPatched() { return this._patching; }
  }

  // ---------------------------------------------------------------------------
  // FragmentRegistry — Modular CSS fragment lifecycle management
  //
  // Each instance holds its own _fragments Map so that two DeepCore instances
  // can coexist without one's dispose() destroying the other's fragments.
  // ---------------------------------------------------------------------------

  class FragmentRegistry {
    constructor() {
      this._fragments = new Map(); // id -> { css, sheet?, active }
    }

    /**
     * Register a CSS fragment. Does not yet inject it.
     * @param {string} id Fragment identifier
     * @param {string} css CSS source text
     */
    register(id, css) {
      this._fragments.set(id, { css, sheet: null, active: false });
    }

    /**
     * Activate a fragment by adopting its CSS into document.adoptedStyleSheets.
     * Inserted BEFORE the 'custom' layer so custom CSS always wins.
     * @param {string} id Fragment identifier
     */
    activate(id) {
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
    deactivate(id) {
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
    hotReplace(id, newCss) {
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
    dispose() {
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
    const readAll = function () {
      const result = {};
      for (const s of stateSpecs) {
        result[s.key] = _readState(s);
      }
      return result;
    };
    let prev = readAll();

    const check = function () {
      const next = readAll();
      const changes = stateSpecs.filter(function (s) { return prev[s.key] !== next[s.key]; });
      if (changes.length) {
        prev = next;
        onStateChange && onStateChange(changes, next);
      }
    };

    const interval = setInterval(check, 1000);
    return {
      interval: interval,
      readAll: readAll,
      disconnect: function () { clearInterval(interval); }
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
  // DeepCore — Main entry point
  //
  // Each instance owns independent:
  //   this._fragmentRegistry  (was FragmentRegistry._fragments static)
  //   this._shadowPatcher     (was SafeAttachShadowPatcher._orig/_patched/_owned/_inject static)
  //
  // dispose() only cleans up THIS instance's state — other DeepCore instances
  // are unaffected.
  // ---------------------------------------------------------------------------

  class DeepCore {
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

      // Per-instance state (was static fields on helper classes)
      this._fragmentRegistry = new FragmentRegistry();
      this._shadowPatcher = new SafeAttachShadowPatcher();

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
      // 1. Register all fragments (instance-level registry)
      const fragments = this._config.fragments || {};
      for (const id in fragments) {
        this._fragmentRegistry.register(id, fragments[id]);
      }

      // 2. ShadowPiercer (layered degradation)
      this._initShadowPiercer();

      // 3. RouteDetector (with history restore)
      const self = this;
      const routeHandle = initRouteDetector(this._config.routes || [], function (from, to) {
        if (to && to.enterFragment) self._fragmentRegistry.activate(to.enterFragment);
        if (from) {
          const routes = self._config.routes || [];
          for (let i = 0; i < routes.length; i++) {
            if (routes[i].id === from && routes[i].exitFragment) {
              self._fragmentRegistry.deactivate(routes[i].exitFragment);
              break;
            }
          }
        }
      });
      this._disposers.push(routeHandle);

      // 4. ContextAwareEngine
      const contextHandle = initContextEngine(this._config.exposedState || [], function () {
        // State change callback - can trigger fragment switching in future
      });
      this._observers.push({ disconnect: function () { contextHandle.disconnect(); } });

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
      const obs = new MutationObserver(function (mutations) {
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
        this._shadowPatcher.install(function (root) { injectIntoRoot(root); });
      }
    }

    _initFallbackObserver() {
      // Placeholder: wraps existing AdaptiveMutationObserver self-healing logic
      // In T7-T9, this will be replaced with the full AdaptiveMutationObserver
      // wrapping from the existing adapter.mjs code.
    }

    // ── Public API (preserved contract) ─────────────────────────────────────

    /**
     * Full cleanup — dispose ONLY this instance's state.
     * Does not affect other DeepCore instances (there should be at most one
     * live at a time anyway, but static safety is guaranteed).
     */
    dispose() {
      for (let i = 0; i < this._observers.length; i++) {
        try { this._observers[i].disconnect && this._observers[i].disconnect(); } catch (e) { /* ignore */ }
      }
      for (let i = 0; i < this._disposers.length; i++) {
        try { this._disposers[i].disconnect && this._disposers[i].disconnect(); } catch (e) { /* ignore */ }
      }
      this._fragmentRegistry.dispose();
      this._shadowPatcher.uninstall();
      this._observers = [];
      this._disposers = [];
      delete window.__AGENTSKIN_DEEP_CORE__;
      delete window.__AGENTSKIN_DEEP_CORE_LOADED__;
      // Note: window[this._marker] is cleaned by main process CLEAR_ADAPTERS_BODY
    }

    /**
     * Activate a registered fragment by id.
     * @param {string} id Fragment identifier
     */
    activateFragment(id) {
      this._fragmentRegistry.activate(id);
    }

    /**
     * Deactivate a fragment by id.
     * @param {string} id Fragment identifier
     */
    deactivateFragment(id) {
      this._fragmentRegistry.deactivate(id);
    }

    /**
     * Hot-replace fragment CSS without flicker.
     * @param {string} id Fragment identifier
     * @param {string} newCss New CSS source
     */
    hotReplace(id, newCss) {
      this._fragmentRegistry.hotReplace(id, newCss);
    }

    /**
     * Read all context state values as a key→value map.
     * Returns the current snapshot computed via initContextEngine's readAll probe.
     */
    readContextState() {
      const specs = this._config.exposedState || [];
      const result = {};
      for (const s of specs) {
        result[s.key] = _readState(s);
      }
      return result;
    }
  }

  // ---------------------------------------------------------------------------
  // AdaptiveMutationObserver — three-layer throttle MutationObserver wrapper
  // Exported on window so every adapter reuses the SAME class instance across
  // repeated Runtime.evaluate calls. V8 persists global lexical bindings
  // across evaluate calls, so a top-level `class X {}` in an adapter re-throw
  // "Identifier 'X' has already been declared" on re-injection and abort the
  // whole adapter (breaking self-heal → hero image flashes then vanishes).
  // Defining it ONCE here (inside the idempotency-guarded IIFE) and letting
  // adapters fall back to window.AdaptiveMutationObserver eliminates that.
  // ---------------------------------------------------------------------------

  class AdaptiveMutationObserver {
    constructor(callback, opts = {}) {
      this.callback = callback;
      this.throttleWindow = opts.throttleWindow ?? 10000;
      this.throttleMaxAttempts = opts.throttleMaxAttempts ?? 50;
      this.retryTimeout = opts.retryTimeout ?? 2000;
      this.loopThreshold = opts.loopThreshold ?? 1000;
      this.loopMaxCycles = opts.loopMaxCycles ?? 10;
      this.attemptCount = 0;
      this.windowStart = Date.now();
      this.isThrottled = false;
      this.elementChanges = new WeakMap();
      this._throttleTimer = null;
      this.observer = new MutationObserver((records) => {
        this._handleMutations(records);
      });
    }
    observe(target, options) { this.observer.observe(target, options); }
    disconnect() {
      this.observer.disconnect();
      if (this._throttleTimer) { clearTimeout(this._throttleTimer); this._throttleTimer = null; }
    }
    takeRecords() { return this.observer.takeRecords(); }
    _handleMutations(records) {
      const filtered = records.filter((r) => !this._isLooping(r.target));
      if (filtered.length === 0) return;
      if (this.isThrottled) return;
      const now = Date.now();
      if (now - this.windowStart > this.throttleWindow) { this.windowStart = now; this.attemptCount = 0; }
      this.attemptCount++;
      if (this.attemptCount > this.throttleMaxAttempts) { this._enterCooldown(); return; }
      this.callback(filtered);
    }
    _isLooping(node) {
      const last = this.elementChanges.get(node);
      const now = Date.now();
      if (!last || now - last.time > this.loopThreshold) {
        this.elementChanges.set(node, { count: 1, time: now });
        return false;
      }
      last.count++; last.time = now;
      return last.count > this.loopMaxCycles;
    }
    _enterCooldown() {
      this.isThrottled = true;
      console.warn(`[AgentSkin] MutationObserver throttled for ${this.retryTimeout}ms`);
      this._throttleTimer = setTimeout(() => {
        this.isThrottled = false; this.attemptCount = 0;
        this.windowStart = Date.now(); this._throttleTimer = null;
      }, this.retryTimeout);
    }
  }

  // ---------------------------------------------------------------------------
  // Export to global scope for evaluate context.
  // Classes are function-scoped inside the IIFE; assign to window so that
  // subsequent adapter code (concatenated after this script) can access them.
  // ---------------------------------------------------------------------------

  window.DeepCore = DeepCore;
  window.SafeAttachShadowPatcher = SafeAttachShadowPatcher;
  window.FragmentRegistry = FragmentRegistry;
  window.AdaptiveMutationObserver = AdaptiveMutationObserver;

})();
