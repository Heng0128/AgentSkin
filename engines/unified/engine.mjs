// SPDX-License-Identifier: MIT
/**
 * @fileoverview V3 Unified Engine — shared adapter factory for all six
 * AgentSkin desktop agents (traework, qode rwork, workbuddy, doubao,
 * codex, zcode).
 *
 * The engine exposes `window.__agentskin_shared_engine__` as a global
 * singleton before any adapter.mjs executes.  Each adapter obtains a
 * scoped adapter instance via `createAdapter(config)` and drives it
 * through `apply()` (initial injection) and `reinject()` (post-nav /
 * self-heal re-injection).
 *
 * Phase 1 (this file): minimal skeleton — config validation + empty
 * apply/reinject stubs.  Phase 2 will back the stubs with real CSS
 * injection, DeepCore bootstrap, route awareness, and health checks.
 * 2026-09-03: `.selfHeal` namespace (AdaptiveMutationObserver +
 * createSelfHeal) restored — the 2026-08-31 module unification dropped it
 * while traework/adapter.mjs still depends on it (unguarded call).
 *
 * Typical usage inside an adapter.mjs:
 *
 *   const engine = window.__agentskin_shared_engine__;
 *   if (!engine || typeof engine.createAdapter !== 'function') {
 *     return 'no-engine';
 *   }
 *   const adapter = engine.createAdapter(config);
 *   adapter.apply();
 *   // workbuddy may also call: adapter.reinject();
 */

/**
 * Creates a scoped adapter instance bound to the given agent config.
 * @param {object} config  Per-agent configuration object injected by
 *   the corresponding adapter-config.mjs (e.g. window.__agentskin_zcode_config__).
 * @returns {{ apply: () => string, reinject: () => string }}  Adapter instance.
 */
function createAdapter(config) {
  if (!config || typeof config !== 'object') {
    console.warn('[AgentSkin] unified-engine: invalid config, expected object');
    config = {};
  }
  const appId = config.appId || 'unknown';

  return {
    apply() {
      // 1. Mark as applied (read by theme-switcher-menu.ts and other UI)
      window.__agentskin__ = window.__agentskin__ || {};
      window.__agentskin__.hosts = window.__agentskin__.hosts || {};
      window.__agentskin__.hosts[appId] = {
        ...window.__agentskin__.hosts[appId],
        status: 'applied',
        appliedAt: Date.now(),
      };

      // 2. Start self-heal patrol (uses globals from the injection chain)
      if (typeof window.__agentskin_initPageScopePatrol === 'function') {
        try {
          window.__agentskin_createPatrolCleanup = window.__agentskin_initPageScopePatrol({
            startGuard: () => sessionStorage.getItem('__agentskin_disabled__') !== '1',
            intervalMs: 5000,
            cooldownMs: 200,
            onInvalidate: (reason) => {
              console.warn(`[AgentSkin] patrol: ${reason}, triggering re-inject`);
              // Re-inject notification via CustomEvent to the main process
              window.dispatchEvent(new CustomEvent('agentskin:patrol-invalidate', { detail: { appId, reason } }));
            },
          });
        } catch (err) {
          console.warn('[AgentSkin] patrol init failed:', err);
        }
      }

      return 'applied';
    },

    reinject() {
      // 1. Clean up old patrol
      if (typeof window.__agentskin_createPatrolCleanup === 'function') {
        try { window.__agentskin_createPatrolCleanup(); } catch {}
      }
      // 2. Re-apply
      return this.apply();
    },
  };
}

// ── Self-heal namespace (contract: engines/INDEX.md `.selfHeal`) ────
//
// Restored 2026-09-03: the 2026-08-31 unification deleted the 7 former
// shared modules (incl. self-heal.mjs) but this Phase-1 skeleton never
// reimplemented `.selfHeal` — traework/adapter.mjs:157 calls
// `window.__agentskin__?.createSelfHeal(...)` unguarded, so every traework
// injection died with "createSelfHeal is not a function" after CSS was
// already applied (self-heal / DeepCore / registration all skipped).
//
// Exposed BOTH top-level on `window.__agentskin__` (what the adapters
// actually call) and nested under `.selfHeal` (what INDEX.md documents).

/**
 * Throttled MutationObserver with mutation-storm (loop) detection.
 * Replaces the 6 per-adapter inline copies that were consolidated by
 * RFC 2026-08-31 (adaptive-mutation-observer.mjs).
 */
class AdaptiveMutationObserver {
  /**
   * @param {(mutations: MutationRecord[]) => void} callback
   * @param {{ throttleMs?: number, stormThreshold?: number }} [opts]
   */
  constructor(callback, opts = {}) {
    if (typeof callback !== 'function') {
      throw new TypeError('[AgentSkin] AdaptiveMutationObserver: callback required');
    }
    this._callback = callback;
    this._throttleMs = opts.throttleMs ?? 100;
    this._stormThreshold = opts.stormThreshold ?? 200;
    this._pending = [];
    this._timer = null;
    this._mo = new MutationObserver((muts) => this._onMutations(muts));
  }

  /** @private */
  _onMutations(muts) {
    this._pending.push(...muts);
    // Storm guard: if far more mutations arrive than any legit UI churn
    // produces within one throttle window, our own writes are probably
    // feeding back — drop the batch instead of amplifying the loop.
    if (this._pending.length >= this._stormThreshold) {
      this._pending.length = 0;
      return;
    }
    if (this._timer === null) {
      this._timer = setTimeout(() => {
        this._timer = null;
        const batch = this._pending;
        this._pending = [];
        if (batch.length) this._callback(batch);
      }, this._throttleMs);
    }
  }

  observe(target, options) {
    this._mo.observe(target, options);
  }

  disconnect() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._pending.length = 0;
    this._mo.disconnect();
  }

  takeRecords() {
    return this._mo.takeRecords();
  }
}

/**
 * Unified structural self-heal coordinator (former unified-self-heal.mjs).
 * Periodically verifies the injection essentials (host class + sheet) and
 * re-injects rebuilt CSS through `onReinject` when they are broken.
 *
 * @param {object} cfg
 * @param {string} [cfg.HOST_CLASS]  html-level host class; heal when missing
 * @param {() => CSSStyleSheet|HTMLElement|null} [cfg.getSheet]
 *   Returns this layer's sheet/element, or null when the adapter manages a
 *   style element internally (sheet check skipped, e.g. traework).
 * @param {() => string} [cfg.rebuildCss]  Produce fresh CSS for re-injection
 * @param {(css: string) => void} [cfg.onReinject]  Receive rebuilt CSS
 * @param {string} [cfg.layer]  Layer tag for diagnostics only
 * @param {number} [cfg.intervalMs]  Check interval (default 2500)
 * @param {number} [cfg.cooldownMs]  Min gap between heals (default 1500)
 * @returns {{ start: () => void, stop: () => void, checkNow: () => boolean }}
 */
function createSelfHeal(cfg) {
  const c = cfg || {};
  const intervalMs = c.intervalMs || 2500;
  const cooldownMs = c.cooldownMs || 1500;
  let timer = null;
  let running = false;
  let lastHealAt = 0;

  function sheetIsBroken(sheet) {
    if (sheet === null || sheet === undefined) return false;
    try {
      if (sheet instanceof CSSStyleSheet) {
        return !document.adoptedStyleSheets.includes(sheet);
      }
      if (sheet instanceof Element) {
        return !sheet.isConnected;
      }
    } catch {
      return true;
    }
    return false;
  }

  /** @returns {boolean} true when essentials are broken and a heal fired */
  function checkNow() {
    const now = Date.now();
    if (now - lastHealAt < cooldownMs) return false;

    let broken = false;
    if (c.HOST_CLASS && !document.documentElement.classList.contains(c.HOST_CLASS)) {
      document.documentElement.classList.add(c.HOST_CLASS);
      broken = true;
    }
    if (typeof c.getSheet === 'function') {
      try {
        if (sheetIsBroken(c.getSheet())) broken = true;
      } catch {
        broken = true;
      }
    }
    if (broken && typeof c.rebuildCss === 'function' && typeof c.onReinject === 'function') {
      const css = c.rebuildCss() || '';
      if (css) c.onReinject(css);
      lastHealAt = Date.now();
    }
    return broken;
  }

  function tick() {
    try {
      checkNow();
    } catch (err) {
      console.warn('[AgentSkin] self-heal tick failed:', err);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    checkNow,
  };
}

const selfHealApi = { AdaptiveMutationObserver, createSelfHeal };

// ── Expose as global singleton ──────────────────────────────────────
// Ensure the namespace exists at module top level: adapters (e.g. traework)
// are thin IIFEs that never call createAdapter()/apply(), yet read
// `window.__agentskin__.*` directly.
window.__agentskin__ = window.__agentskin__ || {};
window.__agentskin_shared_engine__ = {
  createAdapter,
};

// Top-level — the surface adapters actually call.
window.__agentskin__.AdaptiveMutationObserver = AdaptiveMutationObserver;
window.__agentskin__.createSelfHeal = createSelfHeal;
// Nested alias — the documented INDEX.md namespace contract.
window.__agentskin__.selfHeal = selfHealApi;
// Bare global compat — CLEAR_ADAPTERS deletes bare keys, and DeepCore-era
// adapters resolve `window.AdaptiveMutationObserver` first (see INDEX.md).
window.AdaptiveMutationObserver = window.AdaptiveMutationObserver || AdaptiveMutationObserver;
