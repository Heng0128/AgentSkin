// SPDX-License-Identifier: MPL-2.0
/**
 * DOUBAO Adapter Configuration
 * ------------------------------------------------------------
 * Config object consumed by the shared adapter engine
 * (engines/shared/adapter-engine.mjs).  Exposes doubao-specific
 * selectors, structural CSS, token overrides, geometry-based
 * input/sidebar/composer detection, and DeepCore settings.
 *
 * Loaded by the orchestrator BEFORE adapter.mjs and AFTER the
 * shared engine defines window.__agentskin_shared_engine__.
 *
 * Doubao is the MOST COMPLEX adapter.  This file preserves ALL
 * app-specific logic from the original:
 *   - CDP cdsState awareness + safeEval wrapper
 *   - Dark-mode token remap (80+ variables)
 *   - bgObserver watching body's style attribute
 *   - Generic punch-through scanner (data-agentskin-punched)
 *   - 3-level route fallback (data-testid > role > DOM-density)
 *   - Page-type detection (local/remote/extension)
 *   - Chromium-version warning
 *   - Input-line-frame / suggestion-glass killers
 *   - doubao background layer div recreation
 */

(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-doubao';
  const MARKER = '__agentskin_doubao_adapter__';

  // ═══════════════════════════════════════════════════════════
  // CDP SAFE-EVAL — timeout-protected wrapper for sub-operations
  // ═══════════════════════════════════════════════════════════
  function safeEval(expr, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP evaluate timeout')), timeoutMs);
      try {
        const result = expr();
        clearTimeout(timer);
        resolve(result);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PAGE-TYPE DETECTION
  // ═══════════════════════════════════════════════════════════
  function detectPageType() {
    const pathname = location.pathname || '';
    if (pathname.includes('local_webcontents/extensions/ai-views/')
      || pathname.includes('local_webcontents')) return 'local';
    if (location.protocol === 'https:' || location.protocol === 'http:') return 'remote';
    if (location.protocol === 'chrome-extension:' || location.protocol === 'blob:') return 'extension';
    return 'unknown';
  }

  // ═══════════════════════════════════════════════════════════
  // CHROMIUM VERSION DETECTION + WARNING
  // ═══════════════════════════════════════════════════════════
  function getChromiumVersion() {
    try {
      const m = navigator.userAgent.match(/Chrome\/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    } catch { return 0; }
  }

  function warnChromiumVersion() {
    const v = getChromiumVersion();
    if (v > 0 && v < 100) {
      console.warn(`[AgentSkin][doubao] Chromium 版本过低 (${v} < 100)，` +
        'doubao.dll 可能使用旧版 Blink，CDP 注入行为可能异常。请确认 doubao 已更新。');
    }
    return v;
  }

  // ═══════════════════════════════════════════════════════════
  // CDP CONNECTION STATE
  // ═══════════════════════════════════════════════════════════
  function buildCdpState() {
    const injected = typeof window.__AGENTSKIN_CONFIG__ !== 'undefined'
      && window.__AGENTSKIN_CONFIG__ !== null;
    return { injected, connectedAt: Date.now(), lastError: null };
  }

  // ═══════════════════════════════════════════════════════════
  // SELECTOR MAP — multi-version strategy with data-testid >
  // role > stable class > CSS Modules prefix.
  // ═══════════════════════════════════════════════════════════
  const SELECTORS = {
    rootContainer: 'body',
    mainSurface: ':is([data-testid="chat_list_wrapper"], [data-testid="chat_route_layout_leftside_nav"], [role="main"], [role="log"], [role="list"], [class*="message-list"], [class*="chat-content"])',
    sidebar: ':is([data-testid="chat_route_layout_leftside_nav"], [data-testid="flow_chat_sidebar"], [role="navigation"], [role="complementary"])',
    composer: ':is([data-testid="chat_input"], [role="textbox"], [class*="input-guidance"], [class*="input-container"][class*="flex"], textarea:not([hidden]))',
    chatListWrapper: '[data-testid="chat_list_wrapper"]',
    leftSideNav: ':is([data-testid="chat_route_layout_leftside_nav"], [role="navigation"], [role="complementary"])',
    flowChatSidebar: '[data-testid="flow_chat_sidebar"]',
    semanticTextScope: '[data-testid="chat_list_wrapper"], [data-testid="chat_route_layout_leftside_nav"], [role="main"], [role="log"], [class*="message-list"], [class*="chat-content"], [class*="greeting"], [class*="welcome"]',
    welcomeImage: ':is([class*="welcome"] img, [class*="home-bg"] img, [class*="illustration"], [class*="home-illustration"], [class*="welcome-image"], [class*="guide-image"], [class*="mascot"], [class*="welcome"] svg, [class*="home-header"] img, [class*="greeting"] img, [class*="logo-decoration"])',
    overlayDialog: '[role="dialog"]',
    overlayMenu: '[role="menu"]',
    'route:chat-list': '[data-testid="chat_list_wrapper"]',
    'route:chat-detail': ':is([data-testid="chat_input"], [role="textbox"], [contenteditable="true"])',
    'route:default': 'body',
  };

  // ═══════════════════════════════════════════════════════════
  // ROUTE DETECTION — 3-level fallback
  // ═══════════════════════════════════════════════════════════
  function detectRoute() {
    if (document.querySelector(SELECTORS.chatListWrapper)) return 'chat-list';
    if (document.querySelector(SELECTORS.composer)) return 'chat-detail';
    if (document.querySelector('[role="navigation"]') && document.querySelector('[role="main"]')) return 'chat-list';
    if (document.querySelector('[role="textbox"]')) return 'chat-detail';
    const textbox = document.querySelector('[contenteditable="true"], textarea');
    const leftNav = document.querySelector('nav, aside, [role="complementary"], [role="navigation"]');
    if (textbox && leftNav) return 'chat-list';
    if (textbox) return 'chat-detail';
    const main = document.querySelector('main, [role="main"]');
    if (main) {
      if (main.children.length >= 3) return 'chat-list';
      if (main.children.length === 1 && main.querySelector('[contenteditable="true"], textarea')) return 'chat-detail';
    }
    return 'unknown';
  }

  // ═══════════════════════════════════════════════════════════
  // L5 HEURISTIC DOM POSITIONING
  // ═══════════════════════════════════════════════════════════

  function findInputContainer() {
    const editable = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
    if (editable) {
      let el = editable.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 60 && rect.height < 300) return el;
        el = el.parentElement;
      }
    }
    const textbox = document.querySelector('[role="textbox"]');
    if (textbox) return textbox.closest('form') || textbox.parentElement?.parentElement?.parentElement;
    return document.querySelector('[data-testid="chat_input"]')
      || document.querySelector('[class*="input-guidance"]')
      || document.querySelector('[class*="input-container"]')
      || document.querySelector('[class*="chat-input"]');
  }

  function findGreetingElement() {
    // 2026-09-08 (audit D4): class anchors FIRST — greeting copy rotates
    // across releases (doubao-skin hit exactly this on 2026-08-30 and moved
    // to [class*="greeting-text-"]). Text-content matching stays as the
    // last-resort fallback only.
    const classCandidates = document.querySelectorAll(
      '[class*="greeting-text-"], [class*="greeting"], [class*="welcome-text"], h1, h2',
    );
    for (const el of classCandidates) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 100 && rect.width < 600 && rect.top > 100 && rect.top < 500
        && parseFloat(style.fontSize) >= 20) return el;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const patterns = /有什么我能帮你的|今天想聊点什么|你好.*我是豆包|想问点什么/;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (patterns.test(node.textContent) && node.textContent.length < 50) return node.parentElement;
    }
    return null;
  }

  function findSidebar() {
    const nav = document.querySelector('nav');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      if (rect.left < 60 && rect.width < 350 && rect.height > 400) return nav;
    }
    const all = document.querySelectorAll('div, aside, section');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.left < 60 && rect.width > 150 && rect.width < 350 && rect.height > 400
        && (style.position === 'fixed' || style.position === 'relative' || style.position === 'absolute')) return el;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // GENERIC PUNCH-THROUGH SCANNER
  // ═══════════════════════════════════════════════════════════
  function applyGenericPunchThrough() {
    const punched = [];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (!vw || !vh) return '';
    function alpha(c) {
      const m = (c || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const p = m[1].split(',').map(s => parseFloat(s));
      return p.length >= 4 ? p[3] : 1;
    }
    function isOpaque(cs) {
      if (alpha(cs.backgroundColor) > 0.05) return true;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('blob:')) return true;
      return false;
    }
    const candidates = document.querySelectorAll('div, section, main, aside, nav, article, header, footer');
    const rects = new Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) rects[i] = candidates[i].getBoundingClientRect();
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el.hasAttribute('data-agentskin-punched')) continue;
      const r = rects[i];
      if (r.width < vw * 0.8 || r.height < vh * 0.8) continue;
      if (isOpaque(getComputedStyle(el))) {
        el.setAttribute('data-agentskin-punched', '1');
        punched.push(el);
      }
    }
    if ('IntersectionObserver' in window) {
      const ioObs = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (el.hasAttribute('data-agentskin-punched') || !entry.isIntersecting) continue;
          const rect = entry.boundingClientRect;
          if (rect.width < vw * 0.8 || rect.height < vh * 0.8) continue;
          if (isOpaque(getComputedStyle(el))) { el.setAttribute('data-agentskin-punched', '1'); punched.push(el); }
        }
      }, { threshold: 0.01 });
      for (let i = 0; i < candidates.length; i++) {
        if (!candidates[i].hasAttribute('data-agentskin-punched')) ioObs.observe(candidates[i]);
      }
    }
    if (!punched.length) return '';
    return `\nhtml.${HOST_CLASS} [data-agentskin-punched],\nhtml.${HOST_CLASS} [data-agentskin-punched]::before,\nhtml.${HOST_CLASS} [data-agentskin-punched]::after {\n  background: transparent !important;\n  background-color: transparent !important;\n  background-image: none !important;\n}`;
  }

  // ═══════════════════════════════════════════════════════════
  // HEURISTIC STYLING — applies inline styles + returns CSS rules
  // ═══════════════════════════════════════════════════════════
  function applyHeuristicStyles() {
    const rules = [];
    const input = findInputContainer();
    if (input) {
      input.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) var(--ag-glass-bg-lg), transparent)', 'important');
      input.style.setProperty('border', '1px solid var(--ag-glass-border)', 'important');
      input.style.setProperty('border-radius', 'var(--dbx-radius-4xl, 24px)', 'important');
      input.style.setProperty('backdrop-filter', 'blur(var(--ag-glass-blur-lg)) saturate(var(--ag-glass-sat-lg))', 'important');
      input.setAttribute('data-agentskin-input', '1');
    }
    const cursorEl = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea') || document.querySelector('[role="textbox"]');
    if (cursorEl) {
      cursorEl.style.setProperty('border', 'none', 'important');
      cursorEl.style.setProperty('outline', 'none', 'important');
      cursorEl.style.setProperty('box-shadow', 'none', 'important');
      const cw = cursorEl.parentElement;
      if (cw) { cw.style.setProperty('border', 'none', 'important'); cw.style.setProperty('outline', 'none', 'important'); cw.style.setProperty('box-shadow', 'none', 'important'); }
    }
    const greeting = findGreetingElement();
    if (greeting) {
      greeting.setAttribute('data-agentskin-greeting', '1');
      rules.push(`\n[data-agentskin-greeting]::after,\n[data-agentskin-greeting]::before { display: none !important; }`);
    }
    const sidebar = findSidebar();
    if (sidebar) {
      sidebar.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) 10%, transparent)', 'important');
      sidebar.style.setProperty('border-right', 'none', 'important');
      sidebar.setAttribute('data-agentskin-sidebar', '1');
    }
    const mainArea = document.querySelector('[class*="flex-grow"][class*="items-center"]') || document.querySelector('main') || document.querySelector('[role="main"]');
    if (mainArea) { mainArea.style.setProperty('background', 'transparent', 'important'); mainArea.style.setProperty('background-color', 'transparent', 'important'); }
    rules.push(applyGenericPunchThrough());
    return rules.join('\n');
  }

  // Element matcher for style/class mutation observer
  function matchesHeuristicRules(el) {
    if (!el || el.nodeType !== 1) return false;
    return el.matches(
      '[data-testid="chat_input"], [class*="input-guidance"], ' +
      '[class*="input-container"], [class*="chat-input"], ' +
      '[contenteditable="true"], textarea, [role="textbox"], ' +
      '[class*="greeting"], [class*="welcome-text"], h1, h2, ' +
      '[data-testid="chat_route_layout_leftside_nav"], ' +
      '[data-testid="flow_chat_sidebar"], nav, ' +
      'main, [role="main"]'
    );
  }

  // Per-node heuristic override (called by shared engine on added nodes)
  function applyHeuristicOverride(node) {
    if (!node || node.nodeType !== 1) return;
    const role = node.getAttribute('role') || '';
    if (['dialog', 'menu', 'tooltip', 'listbox'].includes(role)) {
      node.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent)', 'important');
      node.style.setProperty('border', '1px solid var(--ag-glass-border)', 'important');
      return;
    }
    const style = node.getAttribute('style') || '';
    if (/background(?:-color)?\s*:/i.test(style) && !/transparent/i.test(style)) {
      node.style.setProperty('background', 'transparent', 'important');
      node.style.setProperty('background-color', 'transparent', 'important');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SELECTOR HEALTH CHECK
  // ═══════════════════════════════════════════════════════════
  function checkSelectorHealth() {
    const report = { healthy: true, issues: [], route: detectRoute() };
    const l1Checks = [
      { key: 'composer', selector: SELECTORS.composer, required: true },
      { key: 'sidebar', selector: SELECTORS.sidebar, required: true },
    ];
    for (const check of l1Checks) {
      try {
        if (check.required && document.querySelectorAll(check.selector).length === 0) {
          report.healthy = false;
          report.issues.push(`L1 missing: ${check.key} (${check.selector})`);
        }
      } catch (e) { report.issues.push(`Selector error: ${check.key}: ${e.message}`); }
    }
    return report;
  }

  // ═══════════════════════════════════════════════════════════
  // DARK MODE HELPERS
  // ═══════════════════════════════════════════════════════════
  // 2026-09-08 (audit D5): the app's OWN appearance is declared on host
  // attributes (html[data-theme], body[theme-mode]) and can differ from the
  // system media query (e.g. system dark + app pinned light). Read host
  // attributes first; system prefers-color-scheme is only the fallback.
  // Priority mirrors the doubao-skin runtime appMode() contract.
  function isDarkModePreferred() {
    try {
      const e = document.documentElement;
      const b = document.body;
      const host = (e && (e.getAttribute('data-theme') || e.getAttribute('theme-mode')))
        || (b && (b.getAttribute('theme-mode') || b.getAttribute('data-theme')));
      if (host === 'dark') return true;
      if (host === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch { return false; }
  }

  function getDarkModeTokenOverrides() {
    return {
      /* --- dbx-text-* --- */
      '--dbx-text-primary': 'var(--agentskin-text)',
      '--dbx-text-secondary': 'var(--agentskin-muted)',
      '--dbx-text-tertiary': 'color-mix(in srgb, var(--agentskin-muted) 70%, transparent)',
      '--dbx-text-disable': 'color-mix(in srgb, var(--agentskin-muted) 40%, transparent)',
      '--dbx-text-markdown': 'color-mix(in srgb, var(--agentskin-text) 95%, transparent)',
      '--dbx-text-n00-primary': 'var(--agentskin-bg)',
      '--dbx-text-n00-secondary': 'color-mix(in srgb, var(--agentskin-bg) 80%, transparent)',
      '--dbx-text-n00-tertiary': 'color-mix(in srgb, var(--agentskin-bg) 60%, transparent)',
      '--dbx-text-n00-disable': 'color-mix(in srgb, var(--agentskin-bg) 30%, transparent)',
      /* --- dbx-bg-* --- */
      '--dbx-bg-primary': 'var(--agentskin-bg)',
      '--dbx-bg-secondary': 'var(--agentskin-surface)',
      '--dbx-bg-tertiary': 'var(--agentskin-surface-elevated)',
      '--dbx-bg-float': 'var(--agentskin-surface-elevated)',
      '--dbx-bg-body-web': 'var(--agentskin-bg)',
      '--dbx-bg-base-web': 'var(--agentskin-bg)',
      '--dbx-bg-base-2': 'var(--agentskin-surface)',
      '--dbx-bg-base-5': 'var(--agentskin-surface-elevated)',
      '--dbx-bg-body-overlay-web': 'var(--agentskin-surface)',
      '--dbx-bg-body-white': 'var(--agentskin-bg)',
      '--dbx-bg-body-mac': 'color-mix(in srgb, var(--agentskin-bg) 85%, transparent)',
      '--dbx-bg-browser-win': 'var(--agentskin-bg)',
      '--dbx-bg-browser-mac': 'color-mix(in srgb, var(--agentskin-bg) 70%, transparent)',
      /* --- dbx-border-* / dbx-line-* --- */
      '--dbx-border-primary': 'var(--agentskin-border)',
      '--dbx-border-secondary': 'color-mix(in srgb, var(--agentskin-border) 70%, transparent)',
      '--dbx-line-divider-5': 'color-mix(in srgb, var(--agentskin-border) 50%, transparent)',
      '--dbx-line-divider-10': 'var(--agentskin-border)',
      '--dbx-line-7': 'color-mix(in srgb, var(--agentskin-border) 70%, transparent)',
      '--dbx-line-10': 'var(--agentskin-border)',
      '--dbx-line-15': 'color-mix(in srgb, var(--agentskin-border) 80%, var(--agentskin-text) 20%)',
      '--dbx-line-20-hover': 'color-mix(in srgb, var(--agentskin-border) 60%, var(--agentskin-text) 40%)',
      /* --- s-color-bg-* --- */
      '--s-color-bg-body': 'var(--agentskin-bg)',
      '--s-color-bg-primary': 'var(--agentskin-surface)',
      '--s-color-bg-secondary': 'color-mix(in srgb, var(--agentskin-surface) 92%, transparent)',
      '--s-color-bg-tertiary': 'color-mix(in srgb, var(--agentskin-surface) 85%, transparent)',
      '--s-color-bg-float': 'var(--agentskin-surface-elevated)',
      '--s-color-bg-dialogs': 'var(--agentskin-surface-elevated)',
      '--s-color-bg-dialogs-grey': 'var(--agentskin-surface)',
      /* --- s-color-text-* --- */
      '--s-color-text-primary': 'var(--agentskin-text)',
      '--s-color-text-secondary': 'var(--agentskin-muted)',
      '--s-color-text-tertiary': 'color-mix(in srgb, var(--agentskin-muted) 70%, transparent)',
      '--s-color-text-quaternary': 'color-mix(in srgb, var(--agentskin-muted) 50%, transparent)',
      '--s-color-text-disable': 'color-mix(in srgb, var(--agentskin-muted) 40%, transparent)',
      /* --- s-color-border-* --- */
      '--s-color-border-tertiary': 'var(--agentskin-border)',
      '--s-color-border-secondary': 'color-mix(in srgb, var(--agentskin-accent) 25%, transparent)',
      /* --- semi-color-bg-* --- */
      '--semi-color-bg-0': 'var(--agentskin-bg)',
      '--semi-color-bg-1': 'var(--agentskin-surface)',
      '--semi-color-bg-2': 'var(--agentskin-surface-elevated)',
      '--semi-color-bg-3': 'var(--agentskin-surface-elevated)',
      '--semi-color-bg-4': 'color-mix(in srgb, var(--agentskin-surface-elevated) 92%, #fff)',
      /* --- semi-color-text-* --- */
      '--semi-color-text-0': 'var(--agentskin-text)',
      '--semi-color-text-1': 'var(--agentskin-muted)',
      '--semi-color-text-2': 'color-mix(in srgb, var(--agentskin-muted) 75%, transparent)',
      '--semi-color-text-3': 'color-mix(in srgb, var(--agentskin-muted) 45%, transparent)',
      /* --- semi-color-* border/fill/disabled --- */
      '--semi-color-border': 'var(--agentskin-border)',
      '--semi-color-fill-0': 'color-mix(in srgb, var(--agentskin-text) 4%, transparent)',
      '--semi-color-fill-1': 'color-mix(in srgb, var(--agentskin-text) 8%, transparent)',
      '--semi-color-fill-2': 'color-mix(in srgb, var(--agentskin-text) 12%, transparent)',
      '--semi-color-disabled-bg': 'color-mix(in srgb, var(--agentskin-text) 4%, transparent)',
      '--semi-color-disabled-border': 'color-mix(in srgb, var(--agentskin-border) 50%, transparent)',
      '--semi-color-disabled-fill': 'color-mix(in srgb, var(--agentskin-text) 4%, transparent)',
      '--semi-color-disabled-text': 'color-mix(in srgb, var(--agentskin-muted) 40%, transparent)',
      /* --- ffc-* --- */
      '--ffc-text-primary': 'var(--agentskin-text)',
      '--ffc-text-secondary': 'var(--agentskin-muted)',
      '--ffc-text-tertiary': 'color-mix(in srgb, var(--agentskin-muted) 70%, transparent)',
      '--ffc-text-disabled': 'color-mix(in srgb, var(--agentskin-muted) 40%, transparent)',
      '--ffc-bg-float': 'var(--agentskin-surface-elevated)',
      '--ffc-bg-subtle': 'color-mix(in srgb, var(--agentskin-surface) 90%, transparent)',
      '--ffc-textarea-color': 'var(--agentskin-text)',
      '--ffc-textarea-placeholder-color': 'color-mix(in srgb, var(--agentskin-muted) 55%, transparent)',
      '--ffc-textarea-disabled-color': 'color-mix(in srgb, var(--agentskin-muted) 40%, transparent)',
      '--ffc-ai-edit-textarea-color': 'var(--agentskin-text)',
      '--ffc-ai-edit-textarea-placeholder-color': 'color-mix(in srgb, var(--agentskin-muted) 55%, transparent)',
      /* --- gray ramp --- */
      '--gray1': 'var(--agentskin-text)',
      '--gray2': 'color-mix(in srgb, var(--agentskin-text) 90%, var(--agentskin-bg))',
      '--gray3': 'color-mix(in srgb, var(--agentskin-text) 80%, var(--agentskin-bg))',
      '--gray4': 'color-mix(in srgb, var(--agentskin-text) 70%, var(--agentskin-bg))',
      '--gray5': 'color-mix(in srgb, var(--agentskin-text) 60%, var(--agentskin-bg))',
      '--gray6': 'color-mix(in srgb, var(--agentskin-text) 50%, var(--agentskin-bg))',
      '--gray7': 'color-mix(in srgb, var(--agentskin-text) 40%, var(--agentskin-bg))',
      '--gray8': 'color-mix(in srgb, var(--agentskin-text) 30%, var(--agentskin-bg))',
      '--gray9': 'color-mix(in srgb, var(--agentskin-text) 22%, var(--agentskin-bg))',
      '--gray10': 'color-mix(in srgb, var(--agentskin-text) 15%, var(--agentskin-bg))',
      '--gray11': 'color-mix(in srgb, var(--agentskin-text) 8%, var(--agentskin-bg))',
      '--gray12': 'var(--agentskin-bg)',
      /* --- semantic/structural --- */
      '--normal-bg': 'var(--agentskin-surface)',
      '--normal-bg-hover': 'var(--agentskin-surface-elevated)',
      '--normal-text': 'var(--agentskin-text)',
      '--normal-border': 'var(--agentskin-border)',
      '--hover-bg-color': 'color-mix(in srgb, var(--agentskin-text) 6%, transparent)',
      '--active-bg-color': 'color-mix(in srgb, var(--agentskin-accent) 14%, transparent)',
      '--left-side': 'var(--agentskin-surface)',
      '--input-guidance-input-container-background': 'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 78%, var(--agentskin-accent) 22%) 45%, transparent)',
      '--input-guidance-input-editor-color': 'var(--agentskin-text)',
      '--input-guidance-input-editor-placeholder-color': 'color-mix(in srgb, var(--agentskin-muted) 60%, transparent)',
    };
  }

  // LIVE COPY of engines/doubao/dark-mode-remap.mjs getDarkModeElementOverrides()
  // (CDP evaluate cannot import ESM — keep the two in sync when editing).
  // 2026-09-08 (audit D3): all colors now derive from --agentskin-* tokens
  // (previously 22 hard-coded VS Code greys that ignored the active theme),
  // and the fabricated `.dbx-history-item/.dbx-titlebar/.dbx-suggestion-card/
  // .dbx-composer-actions` exact classes (zero occurrences in any verified
  // Doubao DOM evidence) were removed. The [class*="..."] substring candidates
  // remain as unverified generic fallbacks pending selector-contract registration.
  function getDarkModeElementOverrides() {
    return `
/* === Dark-mode element overrides for doubao (derived from --agentskin-*) === */
html.${HOST_CLASS} [class*="account"],
html.${HOST_CLASS} [class*="user-info"] {
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} [class*="search"] input,
html.${HOST_CLASS} input[class*="search"],
html.${HOST_CLASS} [data-testid*="search"] input {
  background: var(--agentskin-surface) !important;
  color: var(--agentskin-text) !important;
  border-color: var(--agentskin-border) !important;
}
html.${HOST_CLASS} [class*="search"] input::placeholder,
html.${HOST_CLASS} input[class*="search"]::placeholder {
  color: color-mix(in srgb, var(--agentskin-muted) 70%, transparent) !important;
}
html.${HOST_CLASS} [class*="history-item"],
html.${HOST_CLASS} [class*="conversation-item"],
html.${HOST_CLASS} [class*="chat-item"],
html.${HOST_CLASS} [class*="session-item"] {
  color: var(--agentskin-muted) !important;
}
html.${HOST_CLASS} [class*="history-item"]:hover,
html.${HOST_CLASS} [class*="conversation-item"]:hover,
html.${HOST_CLASS} [class*="chat-item"]:hover,
html.${HOST_CLASS} [class*="session-item"]:hover {
  background: var(--agentskin-surface-elevated) !important;
}
html.${HOST_CLASS} [class*="history-item"][class*="active"],
html.${HOST_CLASS} [class*="conversation-item"][class*="active"] {
  background: var(--agentskin-surface-elevated) !important;
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} [class*="titlebar"],
html.${HOST_CLASS} [class*="header-bar"] {
  background: var(--agentskin-bg) !important;
  border-color: var(--agentskin-border) !important;
}
html.${HOST_CLASS} [class*="suggestion-card"],
html.${HOST_CLASS} [class*="recommend-card"],
html.${HOST_CLASS} [class*="guide-card"] {
  background: var(--agentskin-surface) !important;
  border-color: var(--agentskin-border) !important;
}
html.${HOST_CLASS} [class*="suggestion-card"]:hover,
html.${HOST_CLASS} [class*="recommend-card"]:hover {
  background: var(--agentskin-surface-elevated) !important;
}
html.${HOST_CLASS} [class*="message-content"],
html.${HOST_CLASS} [class*="chat-content"],
html.${HOST_CLASS} [class*="msg-body"] {
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} [class*="composer-actions"],
html.${HOST_CLASS} [class*="input-actions"],
html.${HOST_CLASS} [class*="chat-input-actions"] {
  color: color-mix(in srgb, var(--agentskin-muted) 80%, transparent) !important;
}
html.${HOST_CLASS} ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--agentskin-accent) 35%, transparent) !important;
}
html.${HOST_CLASS} ::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 50%, transparent) !important;
}`;
  }

  function buildDarkModeCss() {
    const tokens = getDarkModeTokenOverrides();
    const decls = Object.entries(tokens).map(([k, v]) => `${k}: ${v} !important;`).join('\n  ');
    return `html.${HOST_CLASS}:root {\n  ${decls}\n}\n` + getDarkModeElementOverrides();
  }

  // ═══════════════════════════════════════════════════════════
  // BACKGROUND LAYER — div recreation + observer
  // ═══════════════════════════════════════════════════════════
  const BG_LAYER_CLASS = 'agentskin-background-layer';
  const BG_LAYER_ID_PREFIX = 'agentskin-bg-';

  function removeBackgroundLayer() {
    const el = document.querySelector(`div.${BG_LAYER_CLASS}`);
    if (el) el.remove();
  }

  function createBackgroundLayer() {
    const artValue = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').trim();
    if (!artValue || artValue === 'none' || artValue === '') return null;
    const div = document.createElement('div');
    div.id = `${BG_LAYER_ID_PREFIX}${Date.now()}`;
    div.className = BG_LAYER_CLASS;
    div.setAttribute('aria-hidden', 'true');
    document.body.prepend(div);
    return div;
  }

  const SEMANTIC_TEXT_SCOPE = SELECTORS.semanticTextScope;

  // ═══════════════════════════════════════════════════════════
  // INPUT LINE-FRAME KILLER — appended AFTER L4 auto-discovery
  // ═══════════════════════════════════════════════════════════
  const INPUT_LINE_FRAME_CSS = `
html.${HOST_CLASS}:root,
html.${HOST_CLASS} [data-testid="chat_input"],
html.${HOST_CLASS} [class*="input-guidance"],
html.${HOST_CLASS} [class*="input-container"],
html.${HOST_CLASS} [class*="input-box"],
html.${HOST_CLASS} [class*="chat-input"],
html.${HOST_CLASS} [class*="composer"],
html.${HOST_CLASS} [class*="input-area"],
html.${HOST_CLASS} [class*="input-wrapper"] {
  --input-guidance-input-container-border: 1px solid transparent !important;
  --dbx-line-10: transparent !important;
  --dbx-fill-highlight-disable: transparent !important;
  --active-shadow: none !important;
}
html.${HOST_CLASS} [data-testid="chat_input"],
html.${HOST_CLASS} [class*="input-guidance"],
html.${HOST_CLASS} [class*="input-container"],
html.${HOST_CLASS} [class*="input-box"],
html.${HOST_CLASS} [class*="chat-input"],
html.${HOST_CLASS} [class*="composer"],
html.${HOST_CLASS} [class*="input-area"],
html.${HOST_CLASS} [class*="input-wrapper"],
html.${HOST_CLASS} [data-testid="chat_input"] *,
html.${HOST_CLASS} [class*="input-guidance"] *,
html.${HOST_CLASS} [class*="input-container"] *,
html.${HOST_CLASS} [data-testid="chat_input"]:focus-within,
html.${HOST_CLASS} [class*="input-guidance"]:focus-within,
html.${HOST_CLASS} [class*="input-container"]:focus-within {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [data-testid="chat_input"]::after,
html.${HOST_CLASS} [class*="input-guidance"]::after,
html.${HOST_CLASS} [class*="input-container"]::after,
html.${HOST_CLASS} [class*="input-box"]::after,
html.${HOST_CLASS} [class*="chat-input"]::after,
html.${HOST_CLASS} [class*="composer"]::after,
html.${HOST_CLASS} [class*="input-area"]::after,
html.${HOST_CLASS} [class*="input-wrapper"]::after {
  border: none !important;
  box-shadow: none !important;
}`;

  // ═══════════════════════════════════════════════════════════
  // SUGGESTION GLASS KILLER — appended AFTER L4 auto-discovery
  // ═══════════════════════════════════════════════════════════
  const SUGGEST_GLASS_KILLER = `
html.${HOST_CLASS} [class*="suggest"],
html.${HOST_CLASS} [class*="recommend"],
html.${HOST_CLASS} [class*="topic"],
html.${HOST_CLASS} [class*="quick-action"],
html.${HOST_CLASS} [class*="shortcut"],
html.${HOST_CLASS} [class*="suggest-message-list-wrapper"],
html.${HOST_CLASS} [class*="suggest"] *,
html.${HOST_CLASS} [class*="recommend"] *,
html.${HOST_CLASS} [class*="topic"] *,
html.${HOST_CLASS} [class*="suggest"]:hover,
html.${HOST_CLASS} [class*="recommend"]:hover,
html.${HOST_CLASS} [class*="topic"]:hover {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  border: none !important;
  border-color: transparent !important;
}`;

  // ═══════════════════════════════════════════════════════════
  // TOKEN DISCOVERY CONFIG
  // ═══════════════════════════════════════════════════════════
  const tokenConfig = {
    knownPrefixes: ['--dbx-', '--s-color-', '--ffc-', '--chat-', '--semi-color-'],
    excludeSuffix: '-raw',
    outputSelector: 'html.agentskin-host-doubao:root',
  };

  // ═══════════════════════════════════════════════════════════
  // DEEPCORE CONFIG
  // ═══════════════════════════════════════════════════════════
  const DEEP_CONFIG = {
    shadowMode: 'variables-only',
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true,
  };

  // ═══════════════════════════════════════════════════════════
  // DYNAMIC CSS — called on every reinject, returns latest
  // heuristic CSS + killers (appended AFTER token overrides).
  // Also applies inline heuristic styles as side-effect.
  // ═══════════════════════════════════════════════════════════
  function buildDynamicCss() {
    const heuristic = applyHeuristicStyles();
    return [heuristic, INPUT_LINE_FRAME_CSS, SUGGEST_GLASS_KILLER].filter(Boolean).join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // EXPORT — config object for shared engine + helpers for wrapper
  // ═══════════════════════════════════════════════════════════
  window.__agentskin_doubao_config__ = {
    agentId: 'doubao',
    hostClass: HOST_CLASS,
    marker: MARKER,
    selectors: SELECTORS,
    tokenConfig,
    deepConfig: DEEP_CONFIG,
    intervals: {
      selfHeal: 2000,
      sheetGuard: 1500,
      reinjectDebounce: 100,
      progressiveRetry: 2000,
    },
    applyHeuristicOverride,
    dynamicCss: buildDynamicCss,
    onReinject() {
      applyHeuristicStyles();
    },
    onHealthCheck(report) {
      if (!report) return;
      const checks = [
        { key: 'composer', sel: SELECTORS.composer, req: true },
        { key: 'sidebar', sel: SELECTORS.sidebar, req: true },
        { key: 'rootContainer', sel: SELECTORS.rootContainer, req: true },
      ];
      for (const c of checks) {
        try {
          if (c.req && document.querySelectorAll(c.sel).length === 0) {
            report.healthy = false;
            report.issues.push(`L1 missing: ${c.key} (${c.sel})`);
          }
        } catch (e) {
          report.healthy = false;
          report.issues.push('health-check error: ' + e.message);
        }
      }
    },
    // Helper namespace for thin wrapper (functions NOT consumed by shared engine)
    _helpers: {
      safeEval,
      detectPageType,
      getChromiumVersion,
      warnChromiumVersion,
      buildCdpState,
      isDarkModePreferred,
      buildDarkModeCss,
      matchesHeuristicRules,
      checkSelectorHealth,
      BG_LAYER_CLASS,
      BG_LAYER_ID_PREFIX,
      removeBackgroundLayer,
      createBackgroundLayer,
      HOST_CLASS,
      MARKER,
    },
  };
})();
