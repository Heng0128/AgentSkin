/**
 * ENGINE: codex — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the OpenAI Codex (ChatGPT desktop app) renderer via CDP
 * Runtime.evaluate. Codex is an Electron app using an `app://` renderer
 * scheme, rooted at `main[class*='MainContentSurface']` (CSS-Modules hashed
 * class; verified against a running renderer — NOT the legacy `main.main-surface`).
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
   Codex root: main[class*='MainContentSurface'] (verified against a running
   renderer at build 62640; the hashed CSS-Modules class, NOT the legacy
   main.main-surface). Bare [class*="main-surface"] is avoided — it would
   also match buttons (h-token-button-composer) and fade masks. The adapter's
   discoverAndOverrideTokens() is a secondary safety net that transparents any
   --color-token-bg-* property regardless of this selector. */
html.${HOST_CLASS} main[class*='MainContentSurface'] {
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
   Codex sidebar root: div.app-shell-left-panel (probe-verified 2026-08-23).
   PROBE NOTE: [class*="sidebar"] matched 43 elements (items, scroll masks,
   resize handles) — over-rendering. Use the exact panel root only. */
html.${HOST_CLASS} .app-shell-left-panel {
  background: var(--sidebar-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 22%, transparent)) !important;
}
/* Sidebar item hover: exact class only — no broad aside/nav/[class*=sidebar]
   button sprays. PROBE-VERIFIED: sidebar rows are button.sidebar-item. */
html.${HOST_CLASS} button.sidebar-item:hover,
html.${HOST_CLASS} [data-app-action-sidebar-project-id]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 10%, transparent) !important;
}
/* Active thread / project: exact data-app-action-* state attributes
   (probe-verified), NOT [aria-current] / [class*=active] / [data-state=active]. */
html.${HOST_CLASS} button.sidebar-item[data-app-action-sidebar-thread-selected="true"],
html.${HOST_CLASS} [data-app-action-sidebar-thread-selected="true"],
html.${HOST_CLASS} [data-app-action-sidebar-thread-active="true"] {
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

/* === Buttons ===
   PROBE-VERIFIED 2026-08-23: Codex primary button colors are driven by the
   native --color-token-* design tokens (--color-token-primary / --color-token-
   bg-primary), overridden in the per-theme codex.css. A DOM-level
   button[class*="primary"] selector matched 6 toolbar buttons (hide-sidebar,
   back, forward, mode-switch, search) — NOT the composer send button — and
   painted them accent-bg (over-rendering). Removed: no DOM button override.
   The theme token layer owns button styling. */

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

  // DEEP_CONFIG — DeepCore configuration (RFC 2026-08-20 §4.9 Step 2)
  // IMPORTANT: Use double-quote strings only — backtick templates would break
  // structural-template.ts regex extraction (P1-4 fix).
  // Position: AFTER STRUCTURAL_CSS to avoid regex mis-match.
  const DEEP_CONFIG = {
    shadowMode: "open-only",
    routes: [
      { id: "composer-open", test: { selector: "[data-composer-expanded]" }, enterFragment: "panel-composer", exitFragment: null }
    ],
    fragments: {
      "panel-composer": "html." + HOST_CLASS + " .composer-surface-chrome { box-shadow: 0 0 0 2px var(--agentskin-accent) !important; }"
    },
    exposedState: [],
    enabled: true
  };

  // L4: Token auto-discovery — scans agent stylesheets for custom properties.
  //
  // PROBE-VERIFIED 2026-08-23 (see docs/reports/codex-injection-benchmark):
  // Codex is a single-layer CSS-variable architecture — components do NOT paint
  // their own background (buttons/inputs/sidebar items compute to transparent);
  // all surfaces come from a small set of page-level --color-token-* variables.
  // Overriding ONLY those page-level background tokens lets the art backdrop show
  // through while keeping control surfaces (dropdown/menu/list-hover/input-border/
  // border-*) intact. The previous blanket rule (any prop matching
  // /bg|background|container|layout|surface/) also zeroed --color-token-side-bar-
  // background, --color-token-bg-primary, --color-token-main-surface-primary and
  // --vscode-token-* (a namespace that is referenced but never assigned) — that
  // erased every surface and produced the "错杂 / 难看" rendering.
  function discoverAndOverrideTokens() {
    // Page-level background tokens that should go transparent so the hero art
    // shows through. Components reference these via Tailwind @theme; they are
    // the ONLY surfaces we want to let the backdrop pierce.
    const PAGE_BG_TOKENS = [
      "--color-token-bg-primary",
      "--color-token-bg-secondary",
      "--color-token-bg-tertiary",
      "--color-token-side-bar-background",
      "--color-token-main-surface-primary",
      "--color-token-diff-surface",
    ];
    const rootStyle = getComputedStyle(document.documentElement);
    const overrides = [];
    for (const prop of PAGE_BG_TOKENS) {
      const value = rootStyle.getPropertyValue(prop).trim();
      if (!value || value === "transparent" || value.includes("--agentskin")) continue;
      // Only transparent solid colors we can see; skip empty/fallback chains.
      if (value.startsWith("#") || value.startsWith("rgb")) {
        overrides.push(`${prop}: transparent`);
      }
    }
    if (overrides.length > 0) {
      return `html.${HOST_CLASS}:root {\n  ${overrides.map(o => o + " !important").join(";\n  ")};\n}`;
    }
    return "";
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

  // ═══════════════════════════════════════════════════════════
  // DEEP-CORE INTEGRATION (RFC 2026-08-20 §4.9 Step 3)
  // Try DeepCore first; fall back to legacy self-healing on failure.
  // ═══════════════════════════════════════════════════════════
  let deepCoreInstance = null;
  if (DEEP_CONFIG.enabled && typeof DeepCore !== "undefined") {
    try {
      deepCoreInstance = new DeepCore(DEEP_CONFIG, { agent: "codex", themeId: config.themeId || "unknown", heroUrl: heroUrl, HOST_CLASS: HOST_CLASS });
      deepCoreInstance._adapterSheet = sheet;
      return "applied";
    } catch (err) {
      console.warn("[codex-adapter] DeepCore init failed, fallback:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SELF-HEALING (fallback when DeepCore unavailable)
  // Rebuilds the adopted sheet on structural DOM changes. NO element-level
  // heuristic guards — PROBE-VERIFIED 2026-08-23: the previous regex guards
  // (applyHeuristicStylesToElement with /sidebar|composer|header|popover|primary/)
  // painted toolbar buttons / text spans against Codex's Tailwind utility DOM
  // (87 elements), producing the "错乱 / 像把别的组件安到 Codex" rendering.
  // All component styling now lives in the theme CSS layer with exact anchors.
  let healTimer = null;
  const observer = new AdaptiveMutationObserver((mutations) => {
    // Only structural changes (new/removed subtrees) need a sheet rebuild.
    const structural = mutations.some(m => m.addedNodes.length > 1 || m.removedNodes.length > 1);
    if (!structural) return;
    if (healTimer) clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      try { sheet.replaceSync([STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join("\n")); } catch {}
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: scheduleReinject (debounced reinject)
  // 100ms debounce coalesces rapid mutation bursts into a single
  // reinject, preventing observer storms from React re-renders.
  // ═══════════════════════════════════════════════════════════
  let reinjectTimeout = null;
  function scheduleReinject() {
    if (reinjectTimeout) clearTimeout(reinjectTimeout);
    reinjectTimeout = setTimeout(() => {
      try { sheet.replaceSync([STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join("\n")); } catch {}
      // Ensure host class survives React re-renders
      if (!document.documentElement.classList.contains(HOST_CLASS)) {
        document.documentElement.classList.add(HOST_CLASS);
      }
      reinjectTimeout = null;
    }, 100);
  }

  // Expected adoptedStyleSheets layers (adapter sheet = 1)
  const expectedLayers = 1;

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: 2s periodic re-check (enhanced from 5s)
  // Checks host class, hero URL, and adoptedStyleSheets presence.
  // Triggers debounced reinject if any layer is missing.
  // ═══════════════════════════════════════════════════════════
  const interval = setInterval(() => {
    let needsReinject = false;
    // Check host class
    if (!document.documentElement.classList.contains(HOST_CLASS)) {
      document.documentElement.classList.add(HOST_CLASS);
      needsReinject = true;
    }
    // Check hero URL
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue("--agentskin-art").includes("blob:")) {
      document.documentElement.style.setProperty("--agentskin-art", `url("${heroUrl}")`);
      needsReinject = true;
    }
    // Check adoptedStyleSheets — host may have replaced the array
    const agentskinSheets = document.adoptedStyleSheets.filter(s => s.__agentskin);
    if (agentskinSheets.length < expectedLayers) {
      needsReinject = true;
    }
    if (needsReinject) scheduleReinject();
  }, 2000);

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: adoptedStyleSheets watchdog (1.5s)
  // Ensures adapter sheet survives host overrides. Reinjects the
  // full sheet if it was removed from the adoptedStyleSheets array.
  // ═══════════════════════════════════════════════════════════
  const sheetGuardInterval = setInterval(() => {
    const sheets = document.adoptedStyleSheets.filter(s => s.__agentskin_layer === 'adapter');
    if (sheets.length < expectedLayers) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  }, 1500);

  window[MARKER] = { observer, interval, sheetGuardInterval, sheet };
  return "applied";
})()
