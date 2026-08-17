/**
 * ENGINE: codex — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the OpenAI Codex (ChatGPT desktop app) renderer via CDP
 * Runtime.evaluate. Codex is an Electron app using an `app://` renderer
 * scheme, rooted at `main.main-surface`.
 *
 * Handles everything that CANNOT be expressed as pure token overrides:
 *   - Art layer (body::before with hero image)
 *   - Transparency punch-through (heuristic, not hardcoded selectors)
 *   - Sidebar / composer structural styling
 *   - Popover / modal frosted glass
 *
 * Self-healing: MutationObserver re-applies structural styles when the app
 * mutates its DOM (e.g., navigation, re-render).
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * The caller provides __AGENTSKIN_CONFIG__ with heroBlobUrl and palette info.
 */

/*
 * AdaptiveMutationObserver — three-layer throttle wrapper
 * Embedded from src/engine/src/runtime/adaptive-observer.mjs
 */
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
    const filtered = records.filter(r => !this._isLooping(r.target));
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

(() => {
  'use strict';
  const HOST_CLASS = 'agentskin-host-codex';
  const MARKER = '__agentskin_codex_adapter__';
  if (window[MARKER]) return 'already-applied';

  const config = window.__AGENTSKIN_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  // ═══════════════════════════════════════════════════════════
  // STRUCTURAL CSS — uses element/role/attribute selectors that
  // survive Codex UI refactors.
  // ═══════════════════════════════════════════════════════════
  // STRUCTURAL_CSS — selectors verified against Codex (ChatGPT desktop) real DOM.
  // Codex uses Tailwind v4 utility classes + --color-token-* CSS variables, NOT
  // semantic class names like "message-bubble" or "btn-primary". Only selectors
  // that match real DOM elements (or standard HTML elements present in chat view)
  // are included. Dead selectors removed: [class*="message"][class*="bubble"],
  // [class*="msg-content"], [class*="message-content"], [data-message-id],
  // button[class*="send"], [class*="btn-primary"], [class*="chat-input-box"],
  // form[class*="message"], aside[class*="nav"], [class*="dropdown"] (matched
  // 11 elements including dropdown label text spans, not containers).
  const STRUCTURAL_CSS = `
/* === Art layer: body::before fixed hero === */
html.${HOST_CLASS} body {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
html.${HOST_CLASS} body::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background: var(--agentskin-art, none) right center / cover no-repeat !important;
}

/* === Main app surface: transparent for art punch-through ===
   Codex root: main.main-surface (verified). Avoid bare [class*="main-surface"]
   which also matches buttons (h-token-button-composer) and fade masks. */
html.${HOST_CLASS} main.main-surface,
html.${HOST_CLASS} main[class*="main-surface"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--agentskin-text) !important;
}

/* === App header tint: semi-transparent frosted bar ===
   Codex header: div.app-header-tint (top bar, z-40) and
   header.app-header-tint (content header, z-30, fixed). */
html.${HOST_CLASS} .app-header-tint {
  background: color-mix(in srgb, var(--agentskin-surface) 8%, transparent) !important;
}

/* === Sidebar: frosted glass ===
   Codex sidebar: nav.sidebar-foreground-muted (verified).
   [class*="sidebar"] matches 43 elements (items, scroll masks, resize handles)
   which is acceptable — they all need the frosted treatment. */
html.${HOST_CLASS} nav,
html.${HOST_CLASS} [class*="sidebar"] {
  background: var(--sidebar-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 22%, transparent)) !important;
}
html.${HOST_CLASS} nav a:hover,
html.${HOST_CLASS} [class*="sidebar"] a:hover,
html.${HOST_CLASS} nav button:hover,
html.${HOST_CLASS} aside button:hover,
html.${HOST_CLASS} [class*="sidebar"] button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 10%, transparent) !important;
}
/* Codex chat rows are <button class="sidebar-item">; the active thread is flagged
   with the data-app-action-sidebar-thread-selected attribute, not [aria-current]. */
html.${HOST_CLASS} button.sidebar-item[data-app-action-sidebar-thread-selected],
html.${HOST_CLASS} [data-app-action-sidebar-thread-selected],
html.${HOST_CLASS} nav a[aria-current="true"],
html.${HOST_CLASS} nav a[aria-current="page"],
html.${HOST_CLASS} nav button[data-state="active"],
html.${HOST_CLASS} [class*="sidebar"] [aria-current="true"],
html.${HOST_CLASS} [class*="sidebar"] [aria-current="page"],
html.${HOST_CLASS} [class*="sidebar"] button[data-state="active"] {
  background: color-mix(in srgb, var(--agentskin-accent) 16%, transparent) !important;
  box-shadow: inset 3px 0 0 0 var(--agentskin-accent) !important;
}

/* === Composer / input area: frosted glass ===
   Codex composer: div.composer-surface-chrome (verified, 736x99).
   PRECISE selectors only — [class*="composer"] also matches:
   - z-60 overlay span (max-w-(--composer-adjacent-max-width), 790x814)
   - toolbar buttons (h-token-button-composer, size-token-button-composer)
   - suggestion containers (inset-x-[var(--composer-suggestion-inline-inset)])
   all of which would get input-bg tinting the full viewport. */
html.${HOST_CLASS} .composer-surface-chrome,
html.${HOST_CLASS} [class*="composer-surface"],
html.${HOST_CLASS} [class*="_multilineSurface_"] {
  background: var(--input-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent)) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  border-radius: 16px !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [contenteditable="true"]:focus,
html.${HOST_CLASS} textarea:focus {
  outline: none !important;
  border-color: var(--agentskin-accent) !important;
}

/* === Buttons: accent-tinted, no extra shadow ===
   Codex primary buttons: button[class*="primary"] (verified, 4 matches).
   Dead selectors removed: button[class*="send"], [class*="btn-primary"]. */
html.${HOST_CLASS} button[class*="primary"] {
  background: var(--button-primary-bg, var(--agentskin-accent)) !important;
  color: var(--button-primary-fg, #ffffff) !important;
  border: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} button[class*="primary"]:hover {
  background: var(--button-primary-hover, color-mix(in srgb, var(--agentskin-accent) 85%, white)) !important;
}

/* === Code blocks (visible in chat view) === */
html.${HOST_CLASS} pre {
  background: var(--code-bg, var(--agentskin-code-bg)) !important;
  color: var(--code-fg, var(--agentskin-code-fg)) !important;
}
html.${HOST_CLASS} code {
  background: var(--code-bg, var(--agentskin-code-bg)) !important;
  color: var(--code-fg, var(--agentskin-code-fg)) !important;
}
html.${HOST_CLASS} pre code {
  border: none !important;
  background: transparent !important;
}

/* === Links (visible in chat view) === */
html.${HOST_CLASS} a {
  color: var(--agentskin-accent) !important;
}

/* === Popovers / modals / dialogs: frosted glass ===
   Role-based selectors match when dialogs/menus open.
   [class*="dropdown"] removed — matched 11 elements including _dropdownLabelText_
   text spans (52x18), not dropdown containers. Use role-based selectors instead. */
html.${HOST_CLASS} [role="dialog"],
html.${HOST_CLASS} [role="menu"],
html.${HOST_CLASS} [role="tooltip"],
html.${HOST_CLASS} [role="listbox"],
html.${HOST_CLASS} [class*="popover"],
html.${HOST_CLASS} [class*="modal"],
html.${HOST_CLASS} [class*="tooltip"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent) !important;
  border: none !important;
}
`;

  // ═══════════════════════════════════════════════════════════
  // L5: HEURISTIC DOM POSITIONING
  // Finds elements by semantic features when class names drift.
  // ═══════════════════════════════════════════════════════════

  function findSidebar() {
    // Strategy 1: <nav> on the left
    const nav = document.querySelector('nav');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      if (rect.left < 60 && rect.width < 350 && rect.height > 400) return nav;
    }
    // Strategy 2: <aside> with nav-like role
    const aside = document.querySelector('aside[role="navigation"], aside[class*="nav"]');
    if (aside) {
      const rect = aside.getBoundingClientRect();
      if (rect.left < 60 && rect.width < 350 && rect.height > 400) return aside;
    }
    return null;
  }

  function findComposer() {
    // Strategy 1: contenteditable or textarea → walk up to container
    const editable = document.querySelector('[contenteditable="true"]')
      || document.querySelector('textarea');
    if (editable) {
      let el = editable.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 60 && rect.height < 300) return el;
        el = el.parentElement;
      }
    }
    // Strategy 2: form containing a textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const form = textarea.closest('form');
      if (form) return form;
    }
    return null;
  }

  // L4: Token auto-discovery — scans agent stylesheets for custom properties
  function discoverAndOverrideTokens() {
    const discovered = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.style) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith('--') && !prop.includes('agentskin')) discovered.add(prop);
          }
        }
      } catch {}
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const overrides = [];
    for (const prop of discovered) {
      const value = rootStyle.getPropertyValue(prop).trim();
      if (!value || value === 'transparent' || value.includes('--agentskin')) continue;
      if (/bg|background|container|layout|surface/.test(prop)
          && (value.startsWith('#') || value.startsWith('rgb'))) {
        overrides.push(`${prop}: transparent`);
      }
    }
    if (overrides.length > 0) {
      return `html.${HOST_CLASS}:root {\n  ${overrides.map(o => o + ' !important').join(';\n  ')};\n}`;
    }
    return '';
  }

  // Injection
  document.documentElement.classList.add(HOST_CLASS);
  if (heroUrl) {
    document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
  }

  const fullCss = [STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join('\n');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(fullCss);
  sheet.__agentskin = true;
  sheet.__agentskin_layer = 'adapter';
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    sheet,
  ];

  // Self-healing (with adaptive throttle to prevent observer storms)
  let healTimer = null;
  const observer = new AdaptiveMutationObserver((mutations) => {
    const structural = mutations.some(m => m.addedNodes.length > 3 || m.removedNodes.length > 3);
    if (!structural) return;
    if (healTimer) clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      try { sheet.replaceSync([STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join('\n')); } catch {}
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const interval = setInterval(() => {
    if (!document.documentElement.classList.contains(HOST_CLASS)) document.documentElement.classList.add(HOST_CLASS);
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').includes('blob:')) {
      document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
    }
  }, 5000);

  window[MARKER] = { observer, interval, sheet };
  return 'applied';
})()
