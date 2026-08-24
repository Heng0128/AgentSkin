/**
 * ENGINE: qoderwork — Layer 1: Structural Adaptation
 * QoderWork CN uses #root as app shell with --color-* tokens.
 * Art layer on #root::before, punch-through on layout containers.
 */


(() => {
  'use strict';

  // 幂等兜底：AdaptiveMutationObserver 由 deep-core.mjs 统一导出到
  // window（同份类，跨多次 Runtime.evaluate 复用）。此处仅在 window 上
  // 缺失时（deep-core 尚未加载）本地定义一份，避免重注入出现
  // "Identifier 'AdaptiveMutationObserver' has already been declared" 而中断
  // 整个 adapter（自愈失效 → hero 图片闪一下即消失）。
  if (!window.AdaptiveMutationObserver) {
    window.AdaptiveMutationObserver = class AdaptiveMutationObserver {
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
    };
  }


  const HOST_CLASS = 'agentskin-host-qoderwork';
  const MARKER = '__agentskin_qoderwork_adapter__';
  if (window[MARKER]) return 'already-applied';

  // ═══════════════════════════════════════════════════════════
  // 治本：adoptedStyleSheets setter 拦截（防止宿主替换数组时丢失图层）
  // ═══════════════════════════════════════════════════════════
  // 使用共享 Sheet 管理器（engines/shared/adopted-sheets-manager.mjs）拦截
  // adoptedStyleSheets setter（P1-7 fix）。管理器保证多 adapter 共存时
  // setter 只安装一次，owned sheets 统一管理。
  try {
    window.__agentskin_sheet_manager__?.install?.();
  } catch (e) {
    // 静默降级 — 后续 polling 作为安全网
  }

  // ═══════════════════════════════════════════════════════════
  // Token Discovery Agent — 共享模块（engines/shared/token-discovery.mjs）
  // 增量扫描 + 结果缓存替换原有的 O(n*m*k) 全量扫描
  // ═══════════════════════════════════════════════════════════
  const _tokenAgent = window.__agentskin_token_discovery__?.createAgent({
    knownPrefixes: ['--color-'],
    outputSelector: 'html.agentskin-host-qoderwork:root',
    categoryPatterns: {
      bg: /bg|background|container|layout/
    },
    valueTransforms: {
      bg: (v) => 'transparent'
    },
    bgValueFilter: (v) => (v.startsWith('#') || v.startsWith('rgb'))
  });

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
  background: var(--agentskin-art, none) right center / cover no-repeat !important;
}

/* === Layout shell transparent === */
html.${HOST_CLASS} .agents-layout-root,
html.${HOST_CLASS} .agents-layout-body,
html.${HOST_CLASS} .agents-content-area,
html.${HOST_CLASS} [class*="agents-content"],
html.${HOST_CLASS} [class*="chat-panel"],
html.${HOST_CLASS} [class*="message-list"],
html.${HOST_CLASS} [class*="conversation-panel"],
html.${HOST_CLASS} [class*="workspace-panel"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
}

/* === Sidebar: frosted glass === */
html.${HOST_CLASS} .agents-sidebar {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 20%, transparent) !important;
}
/* PROBE-VERIFIED 2026-08-23: nav items are button.group/extensions-nav;
   active is data-active="true". [class*="item"] also matched the resize
   handle (cursor-col-resize) — removed. */
html.${HOST_CLASS} .agents-sidebar button[class~="group/extensions-nav"]:hover,
html.${HOST_CLASS} .agents-sidebar [data-extension-nav-item="true"]:hover {
  background: var(--color-primary-bg-hover) !important;
}
html.${HOST_CLASS} .agents-sidebar [data-active="true"] {
  background: var(--color-primary-bg-hover) !important;
}

/* === Titlebar: kill shadow on promo card (签到/邀请,赚积分) === */
html.${HOST_CLASS} [class*="agents-header"],
html.${HOST_CLASS} [class*="titlebar"],
html.${HOST_CLASS} [class*="title-bar"],
html.${HOST_CLASS} [class*="top-bar"],
html.${HOST_CLASS} [class*="topbar"],
html.${HOST_CLASS} [class*="app-header"],
html.${HOST_CLASS} [class*="window-header"],
html.${HOST_CLASS} [class*="header"] {
  box-shadow: none !important;
  filter: none !important;
  border: none !important;
  border-bottom: none !important;
  outline: none !important;
}
html.${HOST_CLASS} [class*="agents-header"] *,
html.${HOST_CLASS} [class*="titlebar"] *,
html.${HOST_CLASS} [class*="title-bar"] *,
html.${HOST_CLASS} [class*="top-bar"] *,
html.${HOST_CLASS} [class*="topbar"] *,
html.${HOST_CLASS} [class*="app-header"] *,
html.${HOST_CLASS} [class*="window-header"] *,
html.${HOST_CLASS} [class*="header"] * {
  box-shadow: none !important;
  filter: none !important;
}
/* Pseudo-element shadows (gradient lines / ::after overlays) */
html.${HOST_CLASS} [class*="agents-header"]::after,
html.${HOST_CLASS} [class*="agents-header"]::before,
html.${HOST_CLASS} [class*="titlebar"]::after,
html.${HOST_CLASS} [class*="titlebar"]::before,
html.${HOST_CLASS} [class*="header"]::after,
html.${HOST_CLASS} [class*="header"]::before {
  box-shadow: none !important;
  display: none !important;
}

/* === Right panel: frosted glass === */
html.${HOST_CLASS} [data-resizable-sidebar]:not(.agents-sidebar) {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 20%, transparent) !important;
}

/* === Composer focus ring === */
html.${HOST_CLASS} .chat-input-editor-text:focus,
html.${HOST_CLASS} .chat-input-editor-text:focus-within {
  border-color: var(--color-primary) !important;
}

/* === Links === */
html.${HOST_CLASS} a {
  color: var(--color-primary) !important;
}

/* === Code blocks === */
html.${HOST_CLASS} pre {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
}
html.${HOST_CLASS} code {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
}
html.${HOST_CLASS} pre code { border: none !important; background: transparent !important; }

/* === Inputs focus === */
html.${HOST_CLASS} input:focus,
html.${HOST_CLASS} textarea:focus,
html.${HOST_CLASS} select:focus {
  outline: none !important;
  border-color: var(--color-primary) !important;
}
`;

  // L5: Heuristic positioning (QoderWork has stable class names, minimal heuristic needed)
  function applyHeuristicStyles() {
    // QoderWork's layout classes are stable (.agents-sidebar, .agents-layout-body)
    // No heuristic needed — structural CSS above handles it.
    return '';
  }

  // L4: Token auto-discovery (delegated to shared token-discovery module)
  function discoverAndOverrideTokens() {
    _tokenAgent?.scan();
    return _tokenAgent?.getOverrides() || '';
  }

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

  const fullCss = [STRUCTURAL_CSS, applyHeuristicStyles(), discoverAndOverrideTokens()].filter(Boolean).join('\n');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(fullCss);
  sheet.__agentskin = true;
  sheet.__agentskin_layer = 'adapter';
  try { window.__agentskin_sheet_manager__?.adopt?.(sheet); } catch {}
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    sheet,
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
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox') return true;
    if (/(?:sidebar|panel|surface|composer|main-area|dialog|modal|popover|dropdown|header|container|wrapper|content|agents-layout|chat-input|message-list|conversation|workspace)/i.test(cls)) return true;
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
    if (tag === 'nav' || tag === 'aside' || /agents-sidebar/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 20%, transparent)', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /chat-input|composer|editor/i.test(cls)) {
      el.style.setProperty('border-color', 'var(--color-primary)', 'important');
      return;
    }
    if (/agents-layout|agents-content|chat-panel|message-list|conversation-panel|workspace-panel/i.test(cls)) {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      el.style.setProperty('backdrop-filter', 'none', 'important');
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
  const observer = new window.AdaptiveMutationObserver((mutations) => {
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
      try { sheet.replaceSync([STRUCTURAL_CSS, applyHeuristicStyles(), discoverAndOverrideTokens()].filter(Boolean).join('\n')); } catch {}
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  // 治本：同时观察 documentElement（host class / hero URL 所在），立即捕获清除
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: scheduleReinject (debounced reinject)
  // 100ms debounce coalesces rapid mutation bursts into a single
  // reinject, preventing observer storms from React re-renders.
  // ═══════════════════════════════════════════════════════════
  let reinjectTimeout = null;
  function scheduleReinject() {
    if (reinjectTimeout) clearTimeout(reinjectTimeout);
    reinjectTimeout = setTimeout(() => {
      try { sheet.replaceSync([STRUCTURAL_CSS, applyHeuristicStyles(), discoverAndOverrideTokens()].filter(Boolean).join('\n')); } catch {}
      // 治本：重新追加 sheet 到数组（如果被宿主移除）
      if (document.adoptedStyleSheets.indexOf(sheet) === -1) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat(sheet);
      }
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
    // Check hero URL — always re-set the CSS variable unconditionally so
    // that if the host's React re-render clears the inline style, the next
    // interval tick restores it. (RC3 fix: previously only re-set when the
    // value did not include 'blob:', which prevented recovery after the
    // variable was cleared entirely.)
    if (heroUrl) {
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

  // DEEP-CORE INTEGRATION (RFC 2026-08-20)
  // NOTE: DeepCore init is now AFTER self-heal intervals are established.
  // If DeepCore succeeds, it enhances the adapter but the self-heal
  // intervals continue running as a safety net.
  if (DEEP_CONFIG.enabled && typeof DeepCore !== "undefined") {
    try {
      const deepCoreInstance = new DeepCore(DEEP_CONFIG, { agent: "qoderwork", themeId: config.themeId || "unknown", heroUrl: heroUrl, HOST_CLASS: HOST_CLASS });
    } catch (err) {
      console.warn("[qoderwork-adapter] DeepCore init failed, fallback:", err);
    }
  }

  window[MARKER] = { observer, interval, sheetGuardInterval, sheet, tokenAgent: _tokenAgent };
  return "applied";
})()
