/**
 * ENGINE: zcode — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the ZCode desktop app renderer via CDP
 * Runtime.evaluate. ZCode is a packaged Electron app
 * (@zcode/desktop, v3.6.5+) whose renderer is a local Vite/React
 * build served via file:// and rooted at `#root`.
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


  const HOST_CLASS = 'agentskin-host-zcode';
  const MARKER = '__agentskin_zcode_adapter__';
  // 运行时语义锚点（CV-06/CV-07 域限定）：把 frosted-glass 与输入框样式限定到
  // 真正的侧边栏与 composer，而非 `aside, nav` / 全局输入框——避免误伤顶部导航栏、
  // 代码编辑器与搜索框。由 findSidebar/findComposer 按几何/语义特征解析后打标。
  const SIDEBAR_ATTR = 'data-agentskin-sidebar';
  const COMPOSER_ATTR = 'data-agentskin-composer';
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

  const _tokenAgent = window.__agentskin_token_discovery__?.createAgent({
    knownPrefixes: [],
    outputSelector: 'html.agentskin-host-zcode:root',
    categoryPatterns: {
      bg: /bg|background|container|layout|surface/
    },
    valueTransforms: {
      bg: (v) => 'transparent'
    },
    bgValueFilter: (v) => (v.startsWith('#') || v.startsWith('rgb'))
  });

  const config = window.__AGENTSKIN_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  // ═══════════════════════════════════════════════════════════
  // STRUCTURAL CSS — uses element/role/attribute selectors that
  // survive ZCode UI refactors. Selectors are intentionally
  // conservative: the app is a fresh Vite/React build, so we anchor
  // on stable landmarks (#root, body, main, [contenteditable], pre,
  // role-based popovers) rather than hashed CSS-module class names.
  // ═══════════════════════════════════════════════════════════
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

/* === App root surface: transparent for art punch-through === */
html.${HOST_CLASS} #root {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--agentskin-text) !important;
}

/* === Main app surface === */
html.${HOST_CLASS} main,
html.${HOST_CLASS} [role="main"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--agentskin-text) !important;
}

/* === Sidebar containers: frosted glass (scoped to sidebar anchor, CV-06) ===
   Prior version blended 'aside, nav' indiscriminately, styling the top nav like
   a sidebar and double-tinting layered <aside> wrappers. Now the frosted-glass
   + hover/active tints attach to [data-agentskin-sidebar] (set at runtime by
   findSidebar), so the persistent left pane reads as glass while the top nav
   and any nested <aside>/<nav> outside the detected sidebar stay native. */
html.${HOST_CLASS} [${SIDEBAR_ATTR}] {
  background: var(--sidebar-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 22%, transparent)) !important;
  backdrop-filter: blur(16px) saturate(1.15) !important;
  -webkit-backdrop-filter: blur(16px) saturate(1.15) !important;
}
html.${HOST_CLASS} [${SIDEBAR_ATTR}] a:hover,
html.${HOST_CLASS} [${SIDEBAR_ATTR}] button:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--agentskin-accent) 10%, transparent)) !important;
}
html.${HOST_CLASS} [${SIDEBAR_ATTR}] a[aria-current="true"],
html.${HOST_CLASS} [${SIDEBAR_ATTR}] a[aria-current="page"] {
  background: var(--bg-active, color-mix(in srgb, var(--agentskin-accent) 16%, transparent)) !important;
}

/* === Composer / input area: frosted glass (scoped to composer anchor, CV-07) ===
   Prior version hit every [contenteditable="true"]/textarea, so the code editor,
   search box and other text surfaces were all over-rendered. Now the input glass
   targets [data-agentskin-composer] ... editable surfaces only. */
html.${HOST_CLASS} [${COMPOSER_ATTR}] [contenteditable="true"],
html.${HOST_CLASS} [${COMPOSER_ATTR}] textarea {
  background: var(--input-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent)) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  border-radius: 14px !important;
  box-shadow: none !important;
  backdrop-filter: blur(20px) saturate(1.2) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.2) !important;
  color: var(--agentskin-text) !important;
  caret-color: var(--agentskin-accent) !important;
}
html.${HOST_CLASS} [${COMPOSER_ATTR}] [contenteditable="true"]:focus,
html.${HOST_CLASS} [${COMPOSER_ATTR}] textarea:focus,
html.${HOST_CLASS} [${COMPOSER_ATTR}] input:focus {
  outline: none !important;
  border-color: var(--agentskin-accent) !important;
  box-shadow: 0 0 0 2px var(--agentskin-focus-ring, color-mix(in srgb, var(--agentskin-accent) 38%, transparent)) !important;
}

/* === Buttons: accent-tinted === */
html.${HOST_CLASS} button[class*="primary"],
html.${HOST_CLASS} button[class*="send"],
html.${HOST_CLASS} button[class*="submit"] {
  background: var(--button-primary-bg, var(--agentskin-accent)) !important;
  color: var(--button-primary-fg, #ffffff) !important;
  border: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} button[class*="primary"]:hover,
html.${HOST_CLASS} button[class*="send"]:hover,
html.${HOST_CLASS} button[class*="submit"]:hover {
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

/* === Popovers / modals / dialogs: frosted glass === */
html.${HOST_CLASS} [role="dialog"],
html.${HOST_CLASS} [role="menu"],
html.${HOST_CLASS} [role="tooltip"],
html.${HOST_CLASS} [role="listbox"],
html.${HOST_CLASS} [class*="popover"],
html.${HOST_CLASS} [class*="modal"],
html.${HOST_CLASS} [class*="tooltip"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.25) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.25) !important;
  border: none !important;
}
`;

  // ═══════════════════════════════════════════════════════════
  // L5: HEURISTIC DOM POSITIONING
  // Finds elements by semantic features when class names drift.
  // ═══════════════════════════════════════════════════════════

  function findSidebar() {
    // Strategy 1: <aside> or <nav> on the left
    const candidate = document.querySelector('aside[role="navigation"], aside, nav');
    if (candidate) {
      const rect = candidate.getBoundingClientRect();
      if (rect.left < 60 && rect.width < 400 && rect.height > 300) return candidate;
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

  // 运行时语义锚点打标（CV-06/CV-07）：解析侧边栏与 composer 并附加属性，
  // 使 STRUCTURAL_CSS 中的域限定选择器命中。幂等——重复调用不报错、不重复标记。
  function applySemanticAnchors() {
    const sidebar = findSidebar();
    if (sidebar) {
      try { sidebar.setAttribute(SIDEBAR_ATTR, ''); } catch {}
    }
    const composer = findComposer();
    if (composer) {
      try { composer.setAttribute(COMPOSER_ATTR, ''); } catch {}
    }
  }

  function discoverAndOverrideTokens() {
    _tokenAgent?.scan();
    return _tokenAgent?.getOverrides() || '';
  }

  // Injection
  document.documentElement.classList.add(HOST_CLASS);
  if (heroUrl) {
    document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
  }

  // CV-06/CV-07 语义锚点打标：先于 CSS 生成执行，确保 `[data-agentskin-sidebar]` /
  // `[data-agentskin-composer]` 域限定选择器在样式表注入前就已命中目标 DOM。
  // （此前 applySemanticAnchors 只定义不调用，导致毛玻璃侧边栏/输入框从未生效。）
  applySemanticAnchors();

  const fullCss = [STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join('\n');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(fullCss);
  sheet.__agentskin = true;
  sheet.__agentskin_layer = 'adapter';
  try { window.__agentskin_sheet_manager__?.adopt?.(sheet); } catch {}
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    sheet,
  ];

  // DEEP_CONFIG (RFC 2026-08-20) — double quotes only, after STRUCTURAL_CSS
  const DEEP_CONFIG = {
    shadowMode: "open-only",
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true
  };

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
    if (el.hasAttribute('data-agentskin-sidebar')) return true;
    if (el.hasAttribute('data-agentskin-composer')) return true;
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox') return true;
    if (/(?:sidebar|surface|composer|main-area|dialog|modal|popover|dropdown|header|container|wrapper|content|input)/i.test(cls)) return true;
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
    if (tag === 'nav' || tag === 'aside' || /sidebar/i.test(cls) || el.hasAttribute('data-agentskin-sidebar')) {
      el.style.setProperty('background', 'var(--sidebar-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 22%, transparent))', 'important');
      el.style.setProperty('border-right', 'none', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /composer/i.test(cls) || el.hasAttribute('data-agentskin-composer')) {
      el.style.setProperty('background', 'var(--input-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent))', 'important');
      el.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent)', 'important');
      el.style.setProperty('border-radius', '14px', 'important');
      return;
    }
    el.style.setProperty('background', 'transparent', 'important');
    el.style.setProperty('background-color', 'transparent', 'important');
  }

  // ═══════════════════════════════════════════════════════════
  // SELF-HEALING: MutationObserver (with adaptive throttle)
  // Re-applies structural styles when DOM changes significantly.
  // Wrapped in AdaptiveMutationObserver to prevent observer storms
  // from third-party agent re-renders.
  // Enhanced: observes style/class attributes, lowered threshold,
  // element-level heuristic guards.
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
      applySemanticAnchors();
      try { sheet.replaceSync([STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join('\n')); } catch {}
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
      applySemanticAnchors();
      try { sheet.replaceSync([STRUCTURAL_CSS, discoverAndOverrideTokens()].filter(Boolean).join('\n')); } catch {}
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
  // NOTE: This interval MUST be established BEFORE DeepCore init so that
  // even if DeepCore succeeds and returns early, the self-heal mechanism
  // is already running. (RC1 fix: was previously placed AFTER DeepCore,
  // causing the interval to never start when DeepCore init succeeded.)
  // ═══════════════════════════════════════════════════════════
  const interval = setInterval(() => {
    let needsReinject = false;
    // Check host class
    if (!document.documentElement.classList.contains(HOST_CLASS)) {
      document.documentElement.classList.add(HOST_CLASS);
      needsReinject = true;
    }
    // Re-apply semantic anchors (findSidebar/findComposer may have moved)
    applySemanticAnchors();
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
  // NOTE: Same as above — established BEFORE DeepCore for RC1 fix.
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
      new DeepCore(DEEP_CONFIG, { agent: "zcode", themeId: config.themeId || "unknown", heroUrl: heroUrl, HOST_CLASS: HOST_CLASS });
    } catch (err) {
      console.warn("[zcode-adapter] DeepCore init failed, fallback:", err);
    }
  }

  window[MARKER] = { observer, interval, sheetGuardInterval, sheet };
  return "applied";
})()
