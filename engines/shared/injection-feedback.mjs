/**
 * INJECTION-FEEDBACK — CDP injection operation feedback overlay
 * ============================================================
 * Lightweight fixed-position overlay showing real-time injection status
 * (loading / success / error / cancelled). Zero external dependency, pure
 * JS IIFE. Idempotent re-injection, multi-instance isolation, light/dark
 * auto-adaptation via prefers-color-scheme, data-agentskin-* namespace.
 *
 * Inspired by: Codex Dream Skin renderer-inject.js
 *
 * @agentskin-engine-keep-alive
 */

(function () {
  'use strict';

  if (window.__AGENTSKIN_FEEDBACK_LOADED__) return;
  window.__AGENTSKIN_FEEDBACK_LOADED__ = true;

  const OVERLAY_ID = 'agentskin-feedback-overlay';
  const STYLE_ID = 'agentskin-feedback-styles';
  const STATUS_VALUES = new Set(['loading', 'success', 'error', 'cancelled']);
  const SUCCESS_AUTO_HIDE_MS = 2000;
  const MESSAGES = {
    loading: 'Applying theme...',
    success: 'Theme applied',
    error: 'Theme application failed',
    cancelled: 'Operation cancelled',
  };

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const css = [
      `#${OVERLAY_ID}{position:fixed;top:16px;right:16px;z-index:999999;padding:12px 16px;border-radius:8px;font:12px/1.4 system-ui,sans-serif;display:flex;align-items:center;gap:8px;max-width:280px;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,.15);background:rgba(var(--agentskin-feedback-bg,40,40,40),.9);color:rgba(var(--agentskin-feedback-text,245,245,245),1);backdrop-filter:blur(6px);transition:opacity .2s ease-out,transform .2s ease-out;opacity:0;transform:translateY(-8px);pointer-events:none}`,
      `#${OVERLAY_ID}[data-agentskin-feedback="active"]{opacity:1;transform:translateY(0);pointer-events:auto}`,
      `#${OVERLAY_ID} .af-spinner{width:14px;height:14px;border:2px solid rgba(var(--agentskin-feedback-text,245,245,245),.3);border-top-color:rgba(var(--agentskin-feedback-accent,100,180,255),1);border-radius:50%;animation:af-spin .6s linear infinite;flex-shrink:0}`,
      `#${OVERLAY_ID} .af-icon{width:14px;height:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center}`,
      `#${OVERLAY_ID} .af-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
      `#${OVERLAY_ID} .af-progress{position:absolute;bottom:0;left:0;height:2px;background:rgba(var(--agentskin-feedback-accent,100,180,255),1);border-radius:0 0 8px 8px;transition:width .3s ease-out;width:0%}`,
      `#${OVERLAY_ID}[data-agentskin-feedback-status="success"] .af-icon::before{content:"\\2713";color:#4ade80;font-weight:bold}`,
      `#${OVERLAY_ID}[data-agentskin-feedback-status="error"] .af-icon::before{content:"\\2717";color:#f87171;font-weight:bold}`,
      `#${OVERLAY_ID}[data-agentskin-feedback-status="cancelled"] .af-icon::before{content:"\\2014";color:#fbbf24}`,
      `@keyframes af-spin{to{transform:rotate(360deg)}}`,
      `@media(prefers-color-scheme:light){` +
        `#${OVERLAY_ID}{--agentskin-feedback-bg:250,250,250;--agentskin-feedback-text:30,30,30}}`,
    ].join('\n');
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  class InjectionFeedback {
    constructor() {
      this._id = Math.random().toString(36).slice(2, 10);
      this._el = null;
      this._timer = null;
      this._progressBar = null;
      this._visible = false;
      this._disposed = false;
    }

    _ensureEl() {
      if (this._el) return this._el;
      if (typeof document === 'undefined') return null;
      ensureStyles();
      let el = document.getElementById(OVERLAY_ID);
      if (!el) {
        el = document.createElement('div');
        el.id = OVERLAY_ID;
        el.setAttribute('data-agentskin-feedback', '');
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
      }
      this._el = el;
      return el;
    }

    showStatus(status, message) {
      if (this._disposed || !STATUS_VALUES.has(status)) return;
      const el = this._ensureEl();
      if (!el) return;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      el.innerHTML = '';
      el.setAttribute('data-agentskin-feedback-status', status);
      el.setAttribute('data-agentskin-feedback', 'active');
      el.setAttribute('data-af-instance', this._id);
      if (status === 'loading') {
        const s = document.createElement('div');
        s.className = 'af-spinner';
        el.appendChild(s);
      } else {
        const i = document.createElement('div');
        i.className = 'af-icon';
        el.appendChild(i);
      }
      const t = document.createElement('span');
      t.className = 'af-text';
      t.textContent = message || MESSAGES[status] || '';
      el.appendChild(t);
      if (!this._progressBar) {
        const bar = document.createElement('div');
        bar.className = 'af-progress';
        bar.setAttribute('data-agentskin-feedback', 'progress');
        el.appendChild(bar);
        this._progressBar = bar;
      }
      this._progressBar.style.width = '0%';
      this._visible = true;
      if (status === 'success') {
        this._timer = setTimeout(() => this.hideStatus(), SUCCESS_AUTO_HIDE_MS);
      }
    }

    hideStatus() {
      if (this._disposed || !this._el) return;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._el.setAttribute('data-agentskin-feedback', '');
      this._el.removeAttribute('data-agentskin-feedback-status');
      this._el.removeAttribute('data-af-instance');
      this._visible = false;
    }

    updateProgress(percent) {
      if (this._disposed || !this._progressBar) return;
      this._progressBar.style.width = Math.max(0, Math.min(100, percent)) + '%';
    }

    dispose() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (this._el && this._el.getAttribute('data-af-instance') === this._id) {
        this.hideStatus();
      }
      this._el = null;
      this._progressBar = null;
      this._disposed = true;
    }

    get isVisible() { return this._visible && !this._disposed; }
    get instanceId() { return this._id; }
  }

  window.InjectionFeedback = InjectionFeedback;
  window.__AGENTSKIN_FEEDBACK__ = { InjectionFeedback, STATUS_VALUES };

})();
