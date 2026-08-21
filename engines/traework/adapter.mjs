/**
 * ENGINE: traework — Layer 1: Structural Adaptation
 * TraeWork CN (VS Code / solo-lite shell).
 * Art layer on #root::before, punch-through on chat panels.
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
  const HOST_CLASS = 'agentskin-host-traework';
  const MARKER = '__agentskin_traework_adapter__';
  if (window[MARKER]) return 'already-applied';

  const config = window.__AGENTSKIN_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  const STRUCTURAL_CSS = `
/* === Art layer on #root::before === */
html.${HOST_CLASS} #root {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
html.${HOST_CLASS} #root::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background:
    var(--agentskin-art, none) right center / cover no-repeat !important;
}

/* === Punch-through: route surfaces transparent === */
html.${HOST_CLASS} .panel-container,
html.${HOST_CLASS} .solo-lite-layout,
html.${HOST_CLASS} .solo-lite-chat-panel-container,
html.${HOST_CLASS} [class*="chat-panel"],
html.${HOST_CLASS} [class*="message-list"],
html.${HOST_CLASS} [class*="conversation"],
html.${HOST_CLASS} [class*="main-content"],
html.${HOST_CLASS} [class*="workspace"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--agentskin-text) !important;
}

/* === Sidebar (frosted glass) === */
html.${HOST_CLASS} .task-list-base,
html.${HOST_CLASS} .task-list-panel {
  background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  border-right: none !important;
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} .task-list-base [class*="item"]:hover,
html.${HOST_CLASS} .task-list-panel [class*="item"]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
}
html.${HOST_CLASS} .task-list-base [class*="active"],
html.${HOST_CLASS} .task-list-panel [class*="active"] {
  background: color-mix(in srgb, var(--agentskin-accent) 18%, transparent) !important;
}

/* === Sidebar separator shadow: themeable divider where the app shows a
   native grey/solid border that follows its own light/dark theme === */
html.${HOST_CLASS} .task-list-base,
html.${HOST_CLASS} .task-list-panel {
  box-shadow: 1px 0 0 color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
}

/* === Sidebar list bottom fade shadow: the app paints a sticky gradient
   (.task-list-shadow-bottom) with a HARD-CODED color (rgb(38,38,38) in dark /
   light-grey in light). In the host's own themes this fade blended with the
   flat background and was invisible; our frosted/art surface makes it stand
   out jarringly. Match the host "invisible" state by removing it entirely. === */
html.${HOST_CLASS} .task-list-shadow-bottom,
html.${HOST_CLASS} .task-list-shadow-top {
  background-image: none !important;
  background: transparent !important;
}

/* === Sidebar circular group/new buttons (conversation-list round thumbs
   that otherwise use native grey rgba(212,212,212)/rgb(229,229,229)
   following the host theme) === */
html.${HOST_CLASS} .task-list-group-new-btn,
html.${HOST_CLASS} .solo-mobile-compact-btn {
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--agentskin-accent) 28%, transparent) !important;
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} .task-list-group-new-btn:hover,
html.${HOST_CLASS} .solo-mobile-compact-btn:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 22%, transparent) !important;
}

/* === Composer === */
html.${HOST_CLASS} .chat-input-v2-input-box-editable {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent) !important;
  color: var(--agentskin-text) !important;
  caret-color: var(--agentskin-accent) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 25%, transparent) !important;
  border-radius: 14px !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} .chat-input-v2-input-box-editable:focus,
html.${HOST_CLASS} .chat-input-v2-input-box-editable:focus-within {
  border-color: color-mix(in srgb, var(--agentskin-accent) 50%, transparent) !important;
}
html.${HOST_CLASS} [class*="chat-input-v2"] [class*="placeholder"] {
  color: var(--agentskin-muted) !important;
}
html.${HOST_CLASS} [class*="chat-input-primary-glow"] {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 40%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [class*="chat-input-primary-glow"]:focus-within {
  border-color: color-mix(in srgb, var(--agentskin-accent) 45%, transparent) !important;
}

/* === Composer outer editor part: neutralize the native opaque grey
   (rgb(23,23,23) in dark / light equivalent in light) so the frosted inner
   input stays the visual subject and the art punches through === */
/* Specificity: the host wins with !!important on the (0,4,0) selector
   .solo-lite .messageInputContainer .messageInputChatInput .chat-input-v2-editor-part,
   which beats our plain (0,2,1). Replicate the ancestor chain + host class so
   our transparent (0,5,1) outranks it. */
html.${HOST_CLASS} .solo-lite .messageInputContainer .messageInputChatInput .chat-input-v2-editor-part,
html.${HOST_CLASS} .solo-lite .messageInputChatInput .chat-input-v2-editor-part,
html.${HOST_CLASS} .chat-input-v2-editor-part {
  background: transparent !important;
}

/* === Composer plugin toolbar icons: repaint native grey pills
   (host uses #292929 / var(--bg-bg-white) following its theme) with an
   accent-tinted frosted pill so toolbar buttons keep our theme === */
html.${HOST_CLASS} [class*="messageInputPluginToolbarIconWrapper"] {
  background: color-mix(in srgb, var(--agentskin-accent) 10%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 22%, transparent) !important;
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} [class*="messageInputPluginToolbarIconWrapper"]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
}
html.${HOST_CLASS} [class*="messageInputPluginToolbar"] {
  background: transparent !important;
  border-color: color-mix(in srgb, var(--agentskin-accent) 18%, transparent) !important;
  color: var(--agentskin-text) !important;
}

/* === Message text === */
html.${HOST_CLASS} [class*="message"],
html.${HOST_CLASS} article {
  color: var(--agentskin-text);
}

/* === Message bubbles: kill native squared box-shadow on side bubbles ===
   The host applies a harsh square box-shadow to chat bubbles; our frosted
   surface tint replaces it, so the native shadow must be removed. */
html.${HOST_CLASS} [class*="message-bubble"],
html.${HOST_CLASS} [class*="messageBubble"],
html.${HOST_CLASS} [class*="msg-bubble"],
html.${HOST_CLASS} [class*="chat-bubble"],
html.${HOST_CLASS} [class*="bubble"],
html.${HOST_CLASS} [class*="message-content"],
html.${HOST_CLASS} [class*="msg-content"] {
  box-shadow: none !important;
  outline: none !important;
}

/* === User-message bubble surface: the native grey rounded box
   (.user-message__text-box paints rgba(212,212,212,0.06) + 16px radius in
   the host's default theme) reads as a leftover "<bubble ring>" against our
   art surface once the box-shadow is gone. Match the host "flat" state by
   clearing its surface and letting the art / text-only bubble take over. === */
html.${HOST_CLASS} .user-message__text-box,
html.${HOST_CLASS} [class*="user-message__text-box"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
}

/* === Message-navigator fade mask: the app overlays a sticky HARD-CODED dark
   gradient (.user-message-navigator__mask--top/bottom paints rgb(23,23,23)
   to transparent) at the top/bottom of the message list. Same class of issue
   as .task-list-shadow-bottom — on our art surface it reads as a shadow band
   behind the bubbles. Match the host "invisible" state by removing it. === */
html.${HOST_CLASS} [class*="user-message-navigator__mask"] {
  background-image: none !important;
  background: transparent !important;
}

/* === Avatar badges === */
html.${HOST_CLASS} [class*="agent-avatar"],
html.${HOST_CLASS} [class*="avatar"] {
  background: var(--agentskin-surface) !important;
  color: var(--agentskin-text) !important;
  border-color: var(--agentskin-border) !important;
}

/* === File links === */
html.${HOST_CLASS} .markdown-file-link,
html.${HOST_CLASS} [class*="file-link"],
html.${HOST_CLASS} a[class*="link"] {
  color: var(--agentskin-accent) !important;
}
html.${HOST_CLASS} .markdown-file-link:hover,
html.${HOST_CLASS} [class*="file-link"]:hover,
html.${HOST_CLASS} a[class*="link"]:hover {
  color: var(--agentskin-secondary) !important;
}

/* === Mode switcher / tabs === */
html.${HOST_CLASS} [class*="mode-switcher"] [class*="btn"],
html.${HOST_CLASS} [class*="tab-item"],
html.${HOST_CLASS} [class*="segmented"] [class*="item"] {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
html.${HOST_CLASS} [class*="mode-switcher"] [class*="active"],
html.${HOST_CLASS} [class*="tab-item"][class*="active"],
html.${HOST_CLASS} [class*="segmented"] [class*="active"] {
  color: var(--agentskin-accent) !important;
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
}
`;

  // DEEP_CONFIG (RFC 2026-08-20) — double quotes only, after STRUCTURAL_CSS
  const DEEP_CONFIG = {
    shadowMode: "open-only",
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true
  };

  // Injection
  document.documentElement.classList.add(HOST_CLASS);
  if (heroUrl) {
    document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
  }

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STRUCTURAL_CSS);
  sheet.__agentskin = true;
  sheet.__agentskin_layer = 'adapter';
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    sheet,
  ];

  // DEEP-CORE INTEGRATION (RFC 2026-08-20)
  if (DEEP_CONFIG.enabled && typeof DeepCore !== "undefined") {
    try {
      const deepCoreInstance = new DeepCore(DEEP_CONFIG, { agent: "traework", themeId: config.themeId || "unknown", heroUrl: heroUrl, HOST_CLASS: HOST_CLASS });
      return "applied";
    } catch (err) {
      console.warn("[traework-adapter] DeepCore init failed, fallback:", err);
    }
  }

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
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox') return true;
    if (/(?:sidebar|panel|surface|composer|main-area|dialog|modal|popover|dropdown|header|container|wrapper|content|chat-input|message-list|task-list|solo-lite)/i.test(cls)) return true;
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
    if (tag === 'nav' || tag === 'aside' || /sidebar|task-list/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) 15%, transparent)', 'important');
      el.style.setProperty('border-right', 'none', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /chat-input|composer|editor-part/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent)', 'important');
      el.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 25%, transparent)', 'important');
      el.style.setProperty('border-radius', '14px', 'important');
      return;
    }
    if (/panel-container|solo-lite|message-list|conversation|main-content|workspace/i.test(cls)) {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      return;
    }
    el.style.setProperty('background-color', 'transparent', 'important');
  }

  // ═══════════════════════════════════════════════════════════
  // SELF-HEALING: MutationObserver (with adaptive throttle)
  // Re-applies heuristic styles when DOM changes significantly.
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
      try { sheet.replaceSync(STRUCTURAL_CSS); } catch {}
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: scheduleReinject (debounced reinject)
  // 100ms debounce coalesces rapid mutation bursts into a single
  // reinject, preventing observer storms from React re-renders.
  // ═══════════════════════════════════════════════════════════
  let reinjectTimeout = null;
  function scheduleReinject() {
    if (reinjectTimeout) clearTimeout(reinjectTimeout);
    reinjectTimeout = setTimeout(() => {
      try { sheet.replaceSync(STRUCTURAL_CSS); } catch {}
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
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  }, 1500);

  window[MARKER] = { observer, interval, sheetGuardInterval, sheet };
  return "applied";
})()
