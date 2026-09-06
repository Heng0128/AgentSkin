/**
 * TRAE Work Adapter Configuration
 * ------------------------------------------------------------
 * Config object consumed by the traework thin wrapper
 * (engines/traework/adapter.mjs).  Exposes TRAE-specific selectors,
 * structural CSS, token overrides, route detection, browser-automation
 * anchors (data-trae-ref), and DeepCore settings.
 *
 * Traework-specific logic that CANNOT be expressed as pure token overrides:
 *   - Body-class-based route detection (task-view / chat-view / solo-lite-shell)
 *   - data-trae-ref proprietary anchors for browser automation
 *   - ICUBE (--vscode-icube-*) token transparency overrides
 *   - Solo-lite shell layout selectors (.solo-lite-layout, .chat-input-v2-*)
 *
 * Loaded by the orchestrator BEFORE adapter.mjs and AFTER the shared
 * engine defines window.__agentskin_shared_engine__.
 */

(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-traework';
  const MARKER = '__agentskin_traework_adapter__';
  const STYLE_ID = 'agentskin-style';

  // Orchestrator injection context (hero, themeId)
  const _injectCtx = window.__AGENTSKIN_CONFIG__ || {};
  const heroUrl = _injectCtx.heroBlobUrl || '';
  const themeId = _injectCtx.themeId || 'unknown';

  // ═══════════════════════════════════════════════════════════
  // ICUBE TOKEN DISCOVERY — BYTEDANCE 设计系统变量
  // 逆向分析确认：TRAE SOLO CN 使用 --vscode-icube-* 系列变量
  // (solo-lite.html: background-color: var(--vscode-icube-colorBg1))
  // 来源：vs/code/electron-browser/solo/solo-lite.html (VS Code OSS 散文件)
  // 2026-08-30: Extended prefixes — CDP scan found --vscode-icube-modalOverlay,
  // --vscode-icube-colorBrandTransparent, --vscode-icube-checkboxDisabledBackground
  // that were not captured by the original prefix set.
  // ═══════════════════════════════════════════════════════════
  const tokenConfig = {
    knownPrefixes: ['--vscode-icube-', '--icube-', '--vscode-'],
    // P2 specificity fix: use ':root' (0,0,1) instead of
    // 'html.agentskin-host-traework:root' (0,1,1) so the static tokens.css
    // declarations on 'html.agentskin-host-traework body' (also 0,1,1) always
    // win. Without this, the adapter's adoptedStyleSheet (appended AFTER the
    // tokens layer) would override tokens.css values at equal specificity,
    // causing token drift.
    outputSelector: ':root',
    categoryPatterns: {
      bg: /bg|background|colorBg|modalOverlay/,
      fg: /fg|foreground|colorFg|colorText/,
      border: /border|divider|Line/,
      accent: /primary|accent|brand|Brand/
    },
    valueTransforms: {
      bg: (v) => 'transparent'
    },
    bgValueFilter: (v) => (v.startsWith('#') || v.startsWith('rgb'))
  };

  // ═══════════════════════════════════════════════════════════
  // MULTI-VERSION SELECTOR STRATEGY
  // DreamSkin research: data-testid > role > stable class > CSS Modules prefix
  // 2026-08-30: Added data-trae-ref anchors (TRAE-proprietary browser automation
  // system, ASAR scan confirmed 17+ occurrences in workbench.desktop.main.js)
  // ═══════════════════════════════════════════════════════════
  const SELECTORS = {
    // L1 Core (required)
    rootContainer: '#root',
    taskListBase: '.task-list-base',
    taskListPanel: '.task-list-panel',
    // CDP 2026-08-30: .panel-container confirmed NOT to exist in DOM — removed from
    // fallback chain to keep selector health clean. Main container is .solo-lite-layout.
    mainSurface: ':is(.solo-lite-layout, .solo-lite-chat-panel-container, [class*="chat-panel"], [class*="message-list"], [class*="conversation"], [class*="main-content"], [class*="workspace"])',
    sidebar: ':is(.task-list-base, .task-list-panel, aside, [data-view-id="sidebar"])',
    composer: ':is(.chat-input-v2-input-box-editable, [contenteditable="true"], textarea)',

    // L2 Refinement (optional) - progressive rendering aware
    taskItem: ':is([class*="task-list-new-task-item"], [class*="task-list-skills-item"])',
    composerGlow: ':is([class*="chat-input-primary-glow"], [class*="chat-input-v2-editor-part"])',
    // CDP 2026-08-30: messageBubble only matches in chat-view with active messages
    // (conditional selector — NOT a breakage when absent in task-view)
    messageBubble: ':is([class*="message-bubble"], [class*="messageBubble"], [class*="msg-bubble"], [class*="chat-bubble"], [class*="message-content"], [class*="msg-content"], [data-trae-ref])',

    // Overlays (conditional — only present when overlay is active)
    overlayDialog: '[role="dialog"]',
    overlayMenu: '[role="menu"]',
    overlayTooltip: '[role="tooltip"]',
    overlayListbox: '[role="listbox"]',

    // TRAE-proprietary browser automation anchors (data-trae-ref system)
    // ASAR scan: 17+ elements tagged, used for browser snapshot navigation
    traeBrowserRoot: '[data-trae-ref="root"]',
    traeBrowserAny: '[data-trae-ref]',
  };

  // ═══════════════════════════════════════════════════════════
  // ROUTE DETECTION
  // 2026-08-30: Enhanced with body class detection (CDP confirmed stable classes:
  // "solo-lite windows icube-simple-style theme-icube vs-dark dark")
  // ═══════════════════════════════════════════════════════════
  function detectRoute() {
    const bodyCls = document.body.className || '';
    // Task view: sidebar (task-list-base/panel) is present
    if (document.querySelector(SELECTORS.taskListBase) || document.querySelector(SELECTORS.taskListPanel)) return 'task-view';
    // Chat view: composer is present (contenteditable chat input)
    if (document.querySelector(SELECTORS.composer)) return 'chat-view';
    // Fallback: body class hints
    if (bodyCls.includes('solo-lite')) return 'solo-lite-shell';
    return 'unknown';
  }

  // Body class state (stable anchors from CDP 2026-08-30)
  const bodyClassState = {
    isSoloLite: (document.body.className || '').includes('solo-lite'),
    isIcubeSimple: (document.body.className || '').includes('icube-simple-style'),
    isDark: (document.body.className || '').includes('vs-dark') || (document.body.className || '').includes(' dark'),
    isWindows: (document.body.className || '').includes('windows'),
  };

  // ═══════════════════════════════════════════════════════════
  // SELECTOR HEALTH CHECK - verify critical selectors match real DOM
  // 2026-08-30: Only L1 required selectors (rootContainer, sidebar) are checked
  // as unhealthy. Conditional selectors (messageBubble, overlay*) are reported
  // but NOT flagged as issues — they only match in specific views/states.
  // ═══════════════════════════════════════════════════════════
  function checkSelectorHealth() {
    const report = { healthy: true, issues: [], conditional: [], route: detectRoute(), bodyClassState };

    const l1Checks = [
      { key: 'rootContainer', selector: SELECTORS.rootContainer, required: true },
      { key: 'sidebar', selector: SELECTORS.sidebar, required: true },
    ];

    for (const check of l1Checks) {
      try {
        const found = document.querySelectorAll(check.selector);
        if (found.length === 0 && check.required) {
          report.healthy = false;
          report.issues.push(`L1 missing: ${check.key} (${check.selector})`);
        }
      } catch (e) {
        report.issues.push(`Selector error: ${check.key}: ${e.message}`);
      }
    }

    // Conditional selectors: report match status but don't flag as unhealthy
    const conditionalChecks = [
      { key: 'messageBubble', selector: SELECTORS.messageBubble },
      { key: 'overlayDialog', selector: SELECTORS.overlayDialog },
      { key: 'overlayMenu', selector: SELECTORS.overlayMenu },
      { key: 'overlayTooltip', selector: SELECTORS.overlayTooltip },
      { key: 'overlayListbox', selector: SELECTORS.overlayListbox },
    ];
    for (const check of conditionalChecks) {
      try {
        const found = document.querySelectorAll(check.selector);
        report.conditional.push({ key: check.key, matched: found.length > 0, count: found.length });
      } catch (e) {
        report.conditional.push({ key: check.key, matched: false, count: 0, error: e.message });
      }
    }

    return report;
  }

  // ═══════════════════════════════════════════════════════════
  // ICUBE TOKEN OVERRIDE — 将 BYTEDANCE ICUBE 变量映射到 agentskin
  // 这些变量由 @byted-icube/solo-lite/dist/index.css 定义
  // ═══════════════════════════════════════════════════════════
  function discoverAndOverrideTokens(tokenAgent) {
    tokenAgent?.scan();
    return tokenAgent?.getOverrides() || '';
  }

  // ═══════════════════════════════════════════════════════════
  // DEEP CONFIG (RFC 2026-08-20)
  // ═══════════════════════════════════════════════════════════
  const DEEP_CONFIG = {
    shadowMode: "open-only",
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true
  };

  // ═══════════════════════════════════════════════════════════
  // ELEMENT-LEVEL HEURISTIC GUARDS
  // ═══════════════════════════════════════════════════════════
  function matchesHeuristicRules(el) {
    if (!el || !(el instanceof Element)) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = el.getAttribute('role') || '';
    if (['dialog', 'menu', 'tooltip', 'listbox'].includes(role)) return true;
    if (tag === 'nav' || tag === 'aside') return true;
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox') return true;
    if (/(?:sidebar|panel|surface|composer|main-area|dialog|modal|popover|dropdown|header|container|wrapper|content|chat-input|message-list|task-list|solo-lite|panel-box|panel-border)/i.test(cls)) return true;
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
    if (/solo-lite|message-list|conversation|main-content|workspace|panel-box|panel-border/i.test(cls)) {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      if (/panel-box/i.test(cls)) el.style.setProperty('box-shadow', 'none', 'important');
      return;
    }
    el.style.setProperty('background-color', 'transparent', 'important');
  }

  // ═══════════════════════════════════════════════════════════
  // TOKEN AGENT INIT — returns initialized token agent
  // ═══════════════════════════════════════════════════════════
  function initTokenAgent() {
    const td = (window.__agentskin__ && window.__agentskin__.tokenDiscovery) || window.__agentskin_token_discovery__;
    if (td && typeof td.createAgent === 'function') {
      return td.createAgent(tokenConfig);
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // Config assembly — exposed to thin wrapper
  // ═══════════════════════════════════════════════════════════
  window.__agentskin_traework_config__ = {
    agentId: 'traework',
    hostClass: HOST_CLASS,
    marker: MARKER,
    styleId: STYLE_ID,
    injection: 'style-element',
    selectors: SELECTORS,
    deepConfig: DEEP_CONFIG,
    themeId,
    heroUrl,
    // Traework-specific helpers
    detectRoute,
    checkSelectorHealth,
    bodyClassState,
    tokenConfig,
    initTokenAgent,
    discoverAndOverrideTokens,
    matchesHeuristicRules,
    applyHeuristicStylesToElement,
    // Intervals for self-heal and progressive rendering
    intervals: {
      selfHeal: 2500,
      progressiveRetry: 2000,
    },
  };
})();
