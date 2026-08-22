/**
 * ENGINE: workbuddy — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the WorkBuddy renderer via CDP Runtime.evaluate.
 * Handles everything that CANNOT be expressed as pure token overrides:
 *   - Art layer (#root::before with hero image)
 *   - Transparency punch-through (heuristic, not hardcoded selectors)
 *   - Input/composer styling (frosted glass + radius)
 *   - Popover/modal frosted glass (role-based selectors only)
 *
 * Level 4: Runtime token auto-discovery — scans agent stylesheets for
 *          custom properties matching bg/text/accent patterns and overrides
 *          any that our tokens.css missed (future-proofing).
 *
 * Level 5: DOM heuristic positioning — finds structural elements by semantic
 *          features (role, contenteditable, text content, position) instead
 *          of class names. Survives agent UI refactors.
 *
 * Self-healing: MutationObserver re-applies structural styles when the agent
 *               mutates its DOM (e.g., navigation, re-render).
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * The caller provides __AGENTSKIN_CONFIG__ with heroBlobUrl and palette info.
 */

/*
 * AdaptiveMutationObserver — three-layer throttle wrapper
 * Embedded from src/engine/src/runtime/adaptive-observer.mjs
 * Prevents observer storms from third-party agent re-renders.
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
  const HOST_CLASS = 'agentskin-host-workbuddy';
  const MARKER = '__agentskin_workbuddy_adapter__';
  if (window[MARKER]) return 'already-applied';

  const config = window.__AGENTSKIN_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  // ═══════════════════════════════════════════════════════════
  // STRUCTURAL CSS — uses only element selectors, pseudo-classes,
  // and minimal attribute patterns that are structurally stable.
  // ═══════════════════════════════════════════════════════════
  const STRUCTURAL_CSS = `
/* === Art layer on #root::before === */
#root {
  background: transparent !important;
}
#root::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background: var(--agentskin-art, none) right center / cover no-repeat !important;
}

/* === teams-container opaque base → transparent === */
.teams-container,
.teams-container.is-mac {
  background: transparent !important;
}
.teams-container > div {
  background: transparent !important;
}

/* === Grid item containers === */
[data-view-id] {
  background: transparent !important;
}
[class*="_gridViewItem_"] > div,
[class*="_gridView_"] > div > div {
  background: transparent !important;
}

/* === Inner content layers === */
.conversation-list,
.chat-container,
.wb-cb-chat,
.chat-main,
.message-list,
.main-content,
.main-content--welcome,
.sidebar-next,
.teams-content-wrapper,
.teams-main-content {
  background: transparent !important;
}

/* === Topbar: menubar + window controls — fully transparent === */
#workbuddy-menubar-container,
.codebuddy-menubar,
#workbuddy-window-controls-container,
.workbuddy-window-controls {
  background: transparent !important;
  backdrop-filter: none !important;
  border-bottom: none !important;
}
.workbuddy-window-control-button {
  background: transparent !important;
  color: var(--agentskin-text) !important;
}
.workbuddy-window-control-button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
}
.workbuddy-window-control-button.close:hover {
  background: #e53935 !important;
  color: #ffffff !important;
}

/* === Chat dialog top bar — fully transparent === */
.workbuddy-topbar {
  background: transparent !important;
  backdrop-filter: none !important;
  border-bottom: none !important;
}

/* === Composer main area === */
[class*="_mainArea_"] {
  background: color-mix(in srgb, var(--agentskin-surface) 50%, transparent) !important;
  border: none !important;
  border-radius: 12px !important;
  box-shadow: none !important;
}

/* === Sidebar section labels === */
.conversation-section-label,
.collapsible-section-header[class*="_header_"][class*="_headerSticky_"],
[class*="_headerTopPadding_"][class*="collapsible"] {
  background: transparent !important;
  background-color: transparent !important;
}

/* === Sidebar search box === */
.my-files-search {
  background: color-mix(in srgb, var(--agentskin-surface) 30%, transparent) !important;
  border: none !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}

/* === Kill unnecessary borders/shadows across UI === */
.sidebar-next-main-header,
.my-files-flat-header {
  border-bottom: none !important;
}
[class*="_dropdownRoot_"],
[class*="_dropdown_"][class*="view-selector"],
.my-files-filter-dropdown,
.my-files-filter-btn {
  border: none !important;
  box-shadow: none !important;
}
.my-files-tab {
  border: none !important;
  border-bottom: none !important;
  box-shadow: none !important;
}
.my-files-tab.active {
  border-bottom: 2px solid var(--agentskin-accent) !important;
}

/* === Sidebar: frosted glass === */
[data-view-id="sidebar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  border-right: none !important;
}

/* === Main content: gradient for readability === */
[data-view-id="main-content"] {
  background: transparent !important;
}

/* === Detail panel: frosted glass === */
[data-view-id="detail-panel"] {
  background: color-mix(in srgb, var(--agentskin-surface) 72%, transparent) !important;
}

/* === Popovers / modals: frosted glass === */
[role="dialog"],
[role="menu"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent) !important;
  border: none !important;
}

/* === Recommendation chips above input: kill side shadows === */
.quick-actions,
.quick-actions__list,
[class*="quick-action"]:not(.quick-actions__item) {
  box-shadow: none !important;
}
.quick-actions *,
.quick-actions__list * {
  box-shadow: none !important;
}

/* === Tencent docs auth strip === */
.tencent-docs-auth-guide__permissions {
  background: transparent !important;
}
`;

  // DEEP_CONFIG (RFC 2026-08-20) — double quotes only, after STRUCTURAL_CSS
  // WorkBuddy 13+ target，强制 open-only 避免多 target 原型污染（RFC R5）
  const DEEP_CONFIG = {
    shadowMode: "open-only",
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true
  };

  // ═══════════════════════════════════════════════════════════
  // L5: HEURISTIC DOM POSITIONING
  // Finds elements by semantic features, applies scoped styles.
  // ═══════════════════════════════════════════════════════════

  function findInputContainer() {
    // Strategy 1: contenteditable or textarea → walk up to container
    const editable = document.querySelector('[contenteditable="true"]')
      || document.querySelector('textarea');
    if (editable) {
      let el = editable.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 50 && rect.height < 300) return el;
        el = el.parentElement;
      }
    }
    // Strategy 2: role=textbox
    const textbox = document.querySelector('[role="textbox"]');
    if (textbox) {
      let el = textbox.closest('form') || textbox.parentElement?.parentElement?.parentElement;
      if (el) return el;
    }
    // Strategy 3: fallback to class pattern (least stable)
    return document.querySelector('[class*="_mainArea_"]')
      || document.querySelector('[class*="composer"]')
      || document.querySelector('[class*="chat-input"]');
  }

  function findSidebar() {
    // Strategy 1: data-view-id sidebar
    const sidebar = document.querySelector('[data-view-id="sidebar"]');
    if (sidebar) return sidebar;
    // Strategy 2: nav element on the left
    const nav = document.querySelector('nav');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      if (rect.left < 10 && rect.width < 350 && rect.height > 400) return nav;
    }
    // Strategy 3: fixed/absolute left panel
    const all = document.querySelectorAll('div, aside, section');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.left < 10 && rect.width > 150 && rect.width < 350 && rect.height > 400
          && (style.position === 'fixed' || style.position === 'relative' || style.position === 'absolute')) {
        return el;
      }
    }
    return null;
  }

  function applyHeuristicStyles() {
    const rules = [];

    // Input container: frosted glass + radius
    const input = findInputContainer();
    if (input) {
      input.style.setProperty('background',
        'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent)', 'important');
      input.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent)', 'important');
      input.style.setProperty('border-radius', '14px', 'important');
      input.setAttribute('data-agentskin-input', '1');
    }

    // Sidebar: ultra-transparent frost
    const sidebar = findSidebar();
    if (sidebar) {
      sidebar.style.setProperty('background',
        'color-mix(in srgb, var(--agentskin-surface) 12%, transparent)', 'important');
      sidebar.style.setProperty('border-right', 'none', 'important');
      sidebar.setAttribute('data-agentskin-sidebar', '1');
    }

    // Punch-through: make main content area transparent
    const mainArea = document.querySelector('[data-view-id="main-content"]')
      || document.querySelector('main')
      || document.querySelector('[role="main"]');
    if (mainArea) {
      mainArea.style.setProperty('background', 'transparent', 'important');
      mainArea.style.setProperty('background-color', 'transparent', 'important');
    }

    return rules.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // L4: RUNTIME TOKEN AUTO-DISCOVERY
  // Scans agent stylesheets for custom properties we haven't
  // overridden yet, classifies them, and generates overrides.
  // ═══════════════════════════════════════════════════════════

  function discoverAndOverrideTokens() {
    const knownPrefixes = ['--cb-', '--wb-'];
    const bgPatterns = /bg|background|surface|fill|panel/;
    const textPatterns = /text|fg|foreground|label|title|desc/;
    const accentPatterns = /accent|brand|primary(?!-raw)|highlight|link|active|focus/;
    const borderPatterns = /border|line|divider|outline|stroke/;

    const discovered = new Set();
    let sheets = 0, failed = 0;

    for (const sheet of document.styleSheets) {
      sheets++;
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.style) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (!prop.startsWith('--')) continue;
            if (!knownPrefixes.some(p => prop.startsWith(p))) continue;
            if (prop.endsWith('-raw')) continue;
            discovered.add(prop);
          }
        }
      } catch { failed++; }
    }

    // Check which ones are NOT already overridden by our tokens.css
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const overrides = [];

    for (const prop of discovered) {
      const value = rootStyle.getPropertyValue(prop).trim() || bodyStyle.getPropertyValue(prop).trim();
      if (!value) continue;

      // Skip if already transparent or already using our vars
      if (value === 'transparent' || value.includes('--agentskin')) continue;

      // Classify and generate override
      const name = prop.toLowerCase();
      if (bgPatterns.test(name) && !accentPatterns.test(name)) {
        if (value.startsWith('#') || value.startsWith('rgb')) {
          overrides.push(`${prop}: color-mix(in srgb, var(--agentskin-surface) 85%, transparent)`);
        }
      } else if (textPatterns.test(name)) {
        overrides.push(`${prop}: var(--agentskin-text)`);
      } else if (accentPatterns.test(name)) {
        overrides.push(`${prop}: var(--agentskin-accent)`);
      } else if (borderPatterns.test(name)) {
        overrides.push(`${prop}: color-mix(in srgb, var(--agentskin-border) 50%, transparent)`);
      }
    }

    if (overrides.length > 0) {
      return `html.agentskin-host-workbuddy body {\n  ${overrides.map(o => o + ' !important').join(';\n  ')};\n}`;
    }
    return '';
  }

  // ═══════════════════════════════════════════════════════════
  // INJECTION
  // ═══════════════════════════════════════════════════════════

  // 1. Ensure host class
  document.documentElement.classList.add(HOST_CLASS);

  // 2. Set hero blob URL
  if (heroUrl) {
    document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
  }

  // 3. Build combined CSS: structural + heuristic + auto-discovered
  let heuristicRules = applyHeuristicStyles();
  let discoveredCss = discoverAndOverrideTokens();
  const fullCss = [STRUCTURAL_CSS, heuristicRules, discoveredCss].filter(Boolean).join('\n');

  // 4. Inject via adoptedStyleSheets (stealth — survives MutationObserver anti-tamper).
  const finalSheet = new CSSStyleSheet();
  finalSheet.replaceSync(fullCss);
  finalSheet.__agentskin = true;
  finalSheet.__agentskin_layer = 'adapter';
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    finalSheet,
  ];

  // ═══════════════════════════════════════════════════════════
  // ELEMENT-LEVEL HEURISTIC GUARDS
  // Checks if a mutated element matches structural patterns and
  // applies targeted styles when style/class attributes change.
  // ═══════════════════════════════════════════════════════════

  function matchesHeuristicRules(el) {
    if (!el || !(el instanceof Element)) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = el.getAttribute('role') || '';
    if (['dialog', 'menu', 'tooltip', 'listbox'].includes(role)) return true;
    if (tag === 'nav' || tag === 'aside') return true;
    if (el.hasAttribute('data-view-id')) return true;
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox') return true;
    if (/(?:sidebar|panel|surface|composer|main-area|dialog|modal|popover|dropdown|header|container|wrapper|content)/i.test(cls)) return true;
    const style = el.getAttribute('style') || '';
    if (/background(?:-color)?\s*:/i.test(style) && !/transparent/i.test(style)) return true;
    return false;
  }

  function applyHeuristicStylesToElement(el) {
    if (!el || !(el instanceof Element)) return;
    const cls = typeof el.className === 'string' ? el.className : '';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = el.getAttribute('role') || '';
    if (['dialog', 'menu', 'tooltip', 'listbox'].includes(role)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent)', 'important');
      el.style.setProperty('border', 'none', 'important');
      return;
    }
    if (tag === 'nav' || tag === 'aside' || /sidebar/i.test(cls) || el.getAttribute('data-view-id') === 'sidebar') {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) 12%, transparent)', 'important');
      el.style.setProperty('border-right', 'none', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /composer|main-area/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent)', 'important');
      el.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent)', 'important');
      el.style.setProperty('border-radius', '14px', 'important');
      return;
    }
    el.style.setProperty('background', 'transparent', 'important');
    el.style.setProperty('background-color', 'transparent', 'important');
  }

  // ═══════════════════════════════════════════════════════════
  // SELF-HEALING: MutationObserver (with adaptive throttle)
  // Re-applies heuristic styles when DOM changes significantly.
  // Wrapped in AdaptiveMutationObserver to prevent observer storms
  // from third-party agent re-renders.
  // Enhanced: observes style/class attributes, lowered threshold.
  // ═══════════════════════════════════════════════════════════

  let healTimer = null;
  const observer = new AdaptiveMutationObserver((mutations) => {
    // Guard: handle style/class attribute changes on existing elements
    for (const m of mutations) {
      if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
        if (matchesHeuristicRules(m.target)) applyHeuristicStylesToElement(m.target);
      }
    }
    // Guard: handle structural DOM changes (lowered threshold: >1)
    const structural = mutations.some(m => m.addedNodes.length > 1 || m.removedNodes.length > 1);
    if (!structural) return;
    if (healTimer) clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      const newRules = applyHeuristicStyles();
      const newDiscovered = discoverAndOverrideTokens();
      const updatedCss = [STRUCTURAL_CSS, newRules, newDiscovered].filter(Boolean).join('\n');
      try { finalSheet.replaceSync(updatedCss); } catch {}
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  // DEEP-CORE INTEGRATION (RFC 2026-08-20)
  if (DEEP_CONFIG.enabled && typeof DeepCore !== "undefined") {
    try {
      const deepCoreInstance = new DeepCore(DEEP_CONFIG, { agent: "workbuddy", themeId: config.themeId || "unknown", heroUrl: heroUrl, HOST_CLASS: HOST_CLASS });
      return "applied";
    } catch (err) {
      console.warn("[workbuddy-adapter] DeepCore init failed, fallback:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: scheduleReinject (debounced reinject)
  // 100ms debounce coalesces rapid mutation bursts into a single
  // reinject, preventing observer storms from React re-renders.
  // ═══════════════════════════════════════════════════════════
  let reinjectTimeout = null;
  function scheduleReinject() {
    if (reinjectTimeout) clearTimeout(reinjectTimeout);
    reinjectTimeout = setTimeout(() => {
      const newRules = applyHeuristicStyles();
      const newDiscovered = discoverAndOverrideTokens();
      const updatedCss = [STRUCTURAL_CSS, newRules, newDiscovered].filter(Boolean).join('\n');
      try { finalSheet.replaceSync(updatedCss); } catch {}
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
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').includes('blob:')) {
      document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
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
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, finalSheet];
    }
  }, 1500);

  window[MARKER] = { observer, interval, sheetGuardInterval, sheet: finalSheet };
  return "applied";
})()
