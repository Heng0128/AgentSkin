/**
 * ENGINE: doubao — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the Doubao renderer via CDP Runtime.evaluate.
 * Handles everything that CANNOT be expressed as pure token overrides:
 *   - Art layer (body::before with hero image)
 *   - Transparency punch-through (heuristic, not hardcoded selectors)
 *   - Input box styling (frosted glass + radius)
 *   - Greeting pseudo-element suppression
 *   - Welcome illustration hiding
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


  const HOST_CLASS = 'agentskin-host-doubao';
  const MARKER = '__agentskin_doubao_adapter__';
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
    knownPrefixes: ['--dbx-', '--s-color-', '--ffc-', '--chat-', '--semi-color-'],
    excludeSuffix: '-raw',
    outputSelector: 'html.agentskin-host-doubao:root'
  });

  const config = window.__AGENTSKIN_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  // ═══════════════════════════════════════════════════════════
  // STRUCTURAL CSS — uses only element selectors, pseudo-classes,
  // and minimal attribute patterns that are structurally stable.
  // ═══════════════════════════════════════════════════════════

  // Semantic text domain — where near-black inline text is most likely to be
  // chat/user content that must resolve to the theme foreground. Scoping the
  // text contrast fallback here (CV-01) stops it from blanketing every
  // component (links, badges, buttons, cards) with the theme value.
  const SEMANTIC_TEXT_SCOPE = '[data-testid="chat_list_wrapper"], [data-testid="chat_route_layout_leftside_nav"], [class*="message-list"], [class*="chat-content"], [role="log"], [class*="greeting"], [class*="welcome"]';
  const STRUCTURAL_CSS = `
/* === Bulk theme foreground via natural inheritance ===
   body carries the theme text color; descendants that do not set their
   own color inherit it. We DO NOT blanket p/span/div/li/... with a
   full-family color reset anymore (CV-01): that forced the theme value onto
   every component and destroyed the app's own color layering. */
html.${HOST_CLASS} body {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
/* === Forced text color: scoped to the semantic text domain only ===
   Neutralizes near-black inline text (the dark-on-dark failure mode) but
   ONLY inside chat/message content — interactive widgets and other regions
   keep their own colors. */
html.${HOST_CLASS} :is(${SEMANTIC_TEXT_SCOPE}) [style*="color: rgb(0"],
html.${HOST_CLASS} :is(${SEMANTIC_TEXT_SCOPE}) [style*="color: #000"],
html.${HOST_CLASS} :is(${SEMANTIC_TEXT_SCOPE}) [style*="color: black"],
html.${HOST_CLASS} :is(${SEMANTIC_TEXT_SCOPE}) [style*="color:rgb(0"],
html.${HOST_CLASS} :is(${SEMANTIC_TEXT_SCOPE}) [style*="color:#000"],
html.${HOST_CLASS} :is(${SEMANTIC_TEXT_SCOPE}) [style*="color:black"] {
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} body::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background: var(--agentskin-art, none) right center / cover no-repeat !important;
}

/* === Greeting pseudo-element suppression ===
   The greeting text element has ::after with opaque bg.
   Target by text content heuristic (applied via JS below). */

/* === Input area: frosted glass + radius ===
   Applied via JS heuristic to the actual input container. */

/* === Input area: frosted glass + radius (NO border line) ===
   Anchor: [data-testid="chat_input"] (stable product semantic, verified live
   63551: 1000x100 DIV). Falls back to the class patterns for older builds. */
html.${HOST_CLASS} [data-testid="chat_input"],
html.${HOST_CLASS} [class*="input-guidance"],
html.${HOST_CLASS} [class*="input-container"][class*="flex"] {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent) !important;
  border: none !important;
  border-radius: var(--dbx-radius-4xl, 24px) !important;
  /* Do NOT use overflow:hidden here. This container hosts the composer's
     inline popups (e.g. the "快速" skill menu). Clipping it hides all but the
     last row of that menu. border-radius already rounds the frosted bg. */
  box-shadow: none !important;
}
html.${HOST_CLASS} [data-testid="chat_input"]:focus-within,
html.${HOST_CLASS} [class*="input-guidance"]:focus-within,
html.${HOST_CLASS} [class*="input-container"][class*="flex"]:focus-within {
  border-color: transparent !important;
}

/* === Welcome illustration hiding === */
html.${HOST_CLASS} [class*="welcome"] img,
html.${HOST_CLASS} [class*="home-bg"] img,
html.${HOST_CLASS} [class*="illustration"],
html.${HOST_CLASS} [class*="home-illustration"],
html.${HOST_CLASS} [class*="welcome-image"],
html.${HOST_CLASS} [class*="guide-image"],
html.${HOST_CLASS} [class*="mascot"],
html.${HOST_CLASS} [class*="welcome"] svg,
html.${HOST_CLASS} [class*="home-header"] img,
html.${HOST_CLASS} [class*="greeting"] img,
html.${HOST_CLASS} [class*="logo-decoration"] {
  display: none !important;
}

/* === Titlebar: fully transparent so art shows through === */
html.${HOST_CLASS} [class*="h-header-height"] {
  background: transparent !important;
  backdrop-filter: none !important;
  border-bottom: none !important;
}
html.${HOST_CLASS} [class*="h-header-height"] button {
  background: transparent !important;
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} [class*="h-header-height"] button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
}

/* === Sidebar: kill borders, shadows, opaque bg ===
   Anchor: [data-testid="chat_route_layout_leftside_nav"] (stable, verified
   live 63551: 220x875 NAV) + [data-testid="flow_chat_sidebar"]; class
   patterns kept as fallback for older builds. */
html.${HOST_CLASS} [data-testid="chat_route_layout_leftside_nav"],
html.${HOST_CLASS} [data-testid="flow_chat_sidebar"],
html.${HOST_CLASS} [class*="left-side"] > div[class*="relative"][class*="fixed"] {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [data-testid="chat_route_layout_leftside_nav"] [class*="rounded-full"][class*="size-20"],
html.${HOST_CLASS} [data-testid="chat_route_layout_leftside_nav"] [class*="rounded-full"][class*="size-22"],
html.${HOST_CLASS} [class*="left-side"] [class*="rounded-full"][class*="size-20"],
html.${HOST_CLASS} [class*="left-side"] [class*="rounded-full"][class*="size-22"] {
  border: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [data-testid="chat_route_layout_leftside_nav"] [class*="rounded-dbx"][class*="border"],
html.${HOST_CLASS} [class*="left-side"] [class*="rounded-dbx"][class*="border"] {
  border: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [class*="sidebar_nav_item"],
html.${HOST_CLASS} [class*="sidebar_nav_item"] * {
  box-shadow: none !important;
  border: none !important;
}
html.${HOST_CLASS} [data-testid="chat_route_layout_leftside_nav"] img[class*="border"],
html.${HOST_CLASS} [class*="left-side"] img[class*="border"] {
  border: none !important;
}

/* === Suggestion bar: glass CANCELLED (enforced by SUGGEST_GLASS_KILLER
   appended AFTER L4 so token auto-discovery can't re-add a fill). === */
html.${HOST_CLASS} [class*="suggest"],
html.${HOST_CLASS} [class*="welcome"],
html.${HOST_CLASS} [class*="guide"],
html.${HOST_CLASS} [class*="recommend"],
html.${HOST_CLASS} [class*="topic"],
html.${HOST_CLASS} [class*="quick-action"],
html.${HOST_CLASS} [class*="shortcut"] {
  background: transparent !important;
  border: none !important;
  backdrop-filter: none !important;
}
html.${HOST_CLASS} [class*="suggest"]:hover,
html.${HOST_CLASS} [class*="welcome"]:hover,
html.${HOST_CLASS} [class*="guide"]:hover,
html.${HOST_CLASS} [class*="recommend"]:hover,
html.${HOST_CLASS} [class*="topic"]:hover {
  background: transparent !important;
}
html.${HOST_CLASS} [class*="suggest"],
html.${HOST_CLASS} [class*="recommend"],
html.${HOST_CLASS} [class*="topic"] {
  outline: none !important;
  box-shadow: none !important;
  border-image: none !important;
}

/* === Suggestion cards: kill stacked shadows/backdrop on CHILDREN ===
   Each suggestion card wraps inner chips that carry their own box-shadow
   and backdrop-filter, which stacks into multiple "glass" shadows. Strip
   them recursively so only our single frosted surface tint remains. */
html.${HOST_CLASS} [class*="suggest"] *,
html.${HOST_CLASS} [class*="recommend"] *,
html.${HOST_CLASS} [class*="topic"] * {
  background: transparent !important;
  border-color: transparent !important;
  outline: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

/* Suggestion BAR wrapper: cancel the big frosted glass on the container itself
   (the inner chips above are already cleared by the `*` rule). Only kills the
   wrapper's own backdrop — inner suggestion chips keep their subtle tint. */
html.${HOST_CLASS} [class*="suggest-message-list-wrapper"] {
  background: transparent !important;
  backdrop-filter: none !important;
}
`;

  // DEEP_CONFIG (RFC 2026-08-20) — double quotes only, after STRUCTURAL_CSS
  // 豆包使用 chromium-webview，采用 variables-only 模式（T14 确认后可升级）
  const DEEP_CONFIG = {
    shadowMode: "variables-only",
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
        if (rect.width > 300 && rect.height > 60 && rect.height < 300) return el;
        el = el.parentElement;
      }
    }
    // Strategy 2: role=textbox
    const textbox = document.querySelector('[role="textbox"]');
    if (textbox) {
      let el = textbox.closest('form') || textbox.parentElement?.parentElement?.parentElement;
      if (el) return el;
    }
    // Strategy 3: stable data-testid (product semantic, survives refactors)
    return document.querySelector('[data-testid="chat_input"]')
      || document.querySelector('[class*="input-guidance"]')
      || document.querySelector('[class*="input-container"]')
      || document.querySelector('[class*="chat-input"]');
  }

  function findGreetingElement() {
    // Strategy 1: find by text content (most stable across renames)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const patterns = /有什么我能帮你的|今天想聊点什么|你好.*我是豆包|想问点什么/;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (patterns.test(node.textContent) && node.textContent.length < 50) {
        return node.parentElement;
      }
    }
    // Strategy 2: large centered text in the main area
    const candidates = document.querySelectorAll('div[class*="greeting"], div[class*="welcome-text"], h1, h2');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 100 && rect.width < 600 && rect.top > 100 && rect.top < 500
          && parseFloat(style.fontSize) >= 20 && style.textAlign === 'center') {
        return el;
      }
    }
    return null;
  }

  function findSidebar() {
    // Strategy 1: nav element on the left
    const nav = document.querySelector('nav');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      // Widened from rect.left < 10 to rect.left < 60 — Doubao's nav can
      // have a small left offset (padding/margin/border) that pushes it
      // past 10px, causing the sidebar heuristic to miss it and leave
      // NAV.left-side-U7A0kz opaque (the #1 blocker in health reports).
      if (rect.left < 60 && rect.width < 350 && rect.height > 400) return nav;
    }
    // Strategy 2: fixed/absolute left panel
    const all = document.querySelectorAll('div, aside, section');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.left < 60 && rect.width > 150 && rect.width < 350 && rect.height > 400
          && (style.position === 'fixed' || style.position === 'relative' || style.position === 'absolute')) {
        return el;
      }
    }
    return null;
  }

  function applyHeuristicStyles() {
    const rules = [];

    // Input container: frosted glass + radius (border line removed — the
    // cursor line-frame is killed via the CSS variable overrides below).
    const input = findInputContainer();
    if (input) {
      input.style.setProperty('background',
        'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent)', 'important');
      input.style.setProperty('border', 'none', 'important');
      input.style.setProperty('border-radius', 'var(--dbx-radius-4xl, 24px)', 'important');
      input.style.setProperty('backdrop-filter', 'blur(24px) saturate(1.25)', 'important');
      // Do NOT set overflow:hidden on the composer container: it hosts inline
      // popups (the "快速" skill menu). Clipping it hides all but the last item.
      input.setAttribute('data-agentskin-input', '1');
    }

    // Inner line-frame around the cursor: Doubao draws a thin gold line on the
    // editable element's immediate wrapper. Kill border/outline there so only
    // the outer frosted container border remains.
    const cursorEl = document.querySelector('[contenteditable="true"]')
      || document.querySelector('textarea')
      || document.querySelector('[role="textbox"]');
    if (cursorEl) {
      cursorEl.style.setProperty('border', 'none', 'important');
      cursorEl.style.setProperty('outline', 'none', 'important');
      cursorEl.style.setProperty('box-shadow', 'none', 'important');
      const cursorWrap = cursorEl.parentElement;
      if (cursorWrap) {
        cursorWrap.style.setProperty('border', 'none', 'important');
        cursorWrap.style.setProperty('outline', 'none', 'important');
        cursorWrap.style.setProperty('box-shadow', 'none', 'important');
      }
    }

    // Greeting: suppress pseudo-elements
    const greeting = findGreetingElement();
    if (greeting) {
      greeting.setAttribute('data-agentskin-greeting', '1');
      rules.push(`
        [data-agentskin-greeting]::after,
        [data-agentskin-greeting]::before { display: none !important; }
      `);
    }

    // Sidebar: ultra-transparent frost
    const sidebar = findSidebar();
    if (sidebar) {
      sidebar.style.setProperty('background',
        'color-mix(in srgb, var(--agentskin-surface) 10%, transparent)', 'important');
      sidebar.style.setProperty('border-right', 'none', 'important');
      sidebar.setAttribute('data-agentskin-sidebar', '1');
    }

    // Punch-through: make main content area transparent
    const mainArea = document.querySelector('[class*="flex-grow"][class*="items-center"]')
      || document.querySelector('main')
      || document.querySelector('[role="main"]');
    if (mainArea) {
      mainArea.style.setProperty('background', 'transparent', 'important');
      mainArea.style.setProperty('background-color', 'transparent', 'important');
    }

    // Generic punch-through: neutralize any remaining opaque full-bleed
    // elements that the targeted heuristics above missed. This is the same
    // strategy as the wallpaper punch-through script — walk the DOM and
    // add a transparent class to any element covering >=80% of the viewport
    // with an opaque background. Without this, Doubao's root containers
    // (DIV.relative, #root > div, etc.) stay opaque and completely hide
    // the hero art layer, giving "apply succeeded but nothing visible".
    rules.push(applyGenericPunchThrough());

    return rules.join('\n');
  }

  /**
   * Generic DOM scan that finds opaque full-bleed elements and emits a CSS
   * rule to neutralize them. Targets elements that:
   *   - Cover >=80% of viewport width AND height
   *   - Have an opaque backgroundColor OR backgroundImage (not blob:)
   *   - Are not the art layer itself (body::before)
   * Returns a CSS string with a scoped rule using data-agentskin-punched.
   *
   * Optimization (2026-08-20): Replaced recursive DOM walk with batch
   * queries to minimize forced reflow (layout thrashing):
   *   1. querySelectorAll targets only block-level containers (skips spans,
   *      text nodes, inline elements that rarely cover 80% viewport).
   *   2. getBoundingClientRect is read in a single synchronous loop — the
   *      browser batches all reads into one layout pass.
   *   3. Only elements passing the geometric filter proceed to the expensive
   *      getComputedStyle call. Typically <5% of elements qualify, reducing
   *      style recalculations by ~20x on large DOMs.
   *   4. data-agentskin-punched attribute provides idempotency — already-
   *      tagged elements are skipped on re-entry (e.g., MutationObserver).
   *   5. IntersectionObserver marks lazily-rendered elements (SPA nav, lazy
   *      images) that appear after the initial synchronous scan.
   */
  function applyGenericPunchThrough() {
    const punched = [];
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (!vw || !vh) return '';

    function alpha(c) {
      const m = (c || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const p = m[1].split(',').map(s => parseFloat(s));
      if (p.length < 3) return 0;
      return p.length >= 4 ? p[3] : 1;
    }
    function isOpaque(cs) {
      if (alpha(cs.backgroundColor) > 0.05) return true;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('blob:')) return true;
      return false;
    }

    // ── Phase 1: Candidate selection (no reflow) ──────────────────────
    // Only block-level elements are plausible for ≥80% viewport coverage.
    const SELECTORS = 'div, section, main, aside, nav, article, header, footer';
    const candidates = document.querySelectorAll(SELECTORS);

    // ── Phase 2: Batch read bounding rects (single reflow) ────────────
    // A single synchronous loop lets the browser coalesce all reads into
    // one layout flush, avoiding interleaved read→write→read cycles.
    const rects = new Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      rects[i] = candidates[i].getBoundingClientRect();
    }

    // ── Phase 3: Geometry filter + conditional style evaluation ────────
    // Only ~1–5% of elements typically pass the ≥80% viewport threshold,
    // so getComputedStyle (the expensive call) is skipped for ~95–99%.
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];

      // Idempotency guard: skip already-processed elements
      if (el.hasAttribute('data-agentskin-punched')) continue;

      const r = rects[i];
      if (r.width < vw * 0.8 || r.height < vh * 0.8) continue;

      const cs = getComputedStyle(el);
      if (isOpaque(cs)) {
        el.setAttribute('data-agentskin-punched', '1');
        punched.push(el);
      }
    }

    // ── Phase 4: IntersectionObserver — catch late-appearing elements ──
    // Elements rendered after the initial scan (SPA navigation, deferred
    // components, lazy images) are detected via their visibility threshold.
    // The CSS rule (returned below) uses [data-agentskin-punched], so any
    // element tagged by the observer is automatically styled by the same
    // injected stylesheet — no re-injection needed.
    if ('IntersectionObserver' in window && candidates.length > 0) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (el.hasAttribute('data-agentskin-punched')) continue;
          if (!entry.isIntersecting) continue;

          const rect = entry.boundingClientRect;
          if (rect.width < vw * 0.8 || rect.height < vh * 0.8) continue;

          // Must call getComputedStyle here inside the async callback.
          // The CSS rule already targets [data-agentskin-punched] generically,
          // so tagging alone is sufficient for styling to take effect.
          const cs = getComputedStyle(el);
          if (isOpaque(cs)) {
            el.setAttribute('data-agentskin-punched', '1');
            punched.push(el);
          }
        }
      }, { threshold: 0.01 });

      for (let i = 0; i < candidates.length; i++) {
        if (!candidates[i].hasAttribute('data-agentskin-punched')) {
          observer.observe(candidates[i]);
        }
      }
    }

    // ── Phase 5: Return CSS (unchanged output contract) ───────────────
    if (!punched.length) return '';

    // The same CSS rule covers initial + late-observed punched elements.
    return `
html.${HOST_CLASS} [data-agentskin-punched] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}
html.${HOST_CLASS} [data-agentskin-punched]::before,
html.${HOST_CLASS} [data-agentskin-punched]::after {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}`;
  }

  // ═══════════════════════════════════════════════════════════
  // L4: RUNTIME TOKEN AUTO-DISCOVERY
  // Scans agent stylesheets for custom properties we haven't
  // overridden yet, classifies them, and generates overrides.
  // ═══════════════════════════════════════════════════════════

  function discoverAndOverrideTokens() {
    _tokenAgent?.scan();
    return _tokenAgent?.getOverrides() || '';
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
  // The actual sheet (finalSheet) is built below with INPUT_LINE_FRAME_CSS appended LAST.

  // NOTE: INPUT_LINE_FRAME_CSS is appended LAST (after L4 auto-discovered
  // overrides) on purpose — L4 re-scans Doubao's --dbx-*/--input-guidance-*
  // border variables and would otherwise re-introduce the line frame.

  // ═══════════════════════════════════════════════════════════
  // INPUT LINE-FRAME KILLER (root cause) — appended AFTER L4
  // Doubao draws every input border through CSS variables:
  //   --input-guidance-input-container-border   → element borders (incl. focus)
  //   --dbx-line-10 / --dbx-fill-highlight-disable → the focus ::after ring
  // Override them at the source with !important + high specificity so the gold
  // line cannot reappear in ANY state. The :root override also reaches the
  // outer wrapper (depth 5), which is NOT itself an "input-guidance" element.
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
  // SUGGESTION BAR GLASS KILLER — appended AFTER L4
  // The conversation suggestion bar (wrapper + chips + Doubao's inner
  // content-KTJ1Rj with blur(6px)) must be fully transparent with NO
  // frosted glass. STRUCTURAL_CSS above already sets the base to transparent;
  // this killer is placed LAST so L4's token auto-discovery cannot re-introduce
  // a background/border variable, and so it beats Doubao's own !important blur.
  // ═══════════════════════════════════════════════════════════
  const SUGGEST_GLASS_KILLER = `
html.${HOST_CLASS} [class*="suggest"],
html.${HOST_CLASS} [class*="recommend"],
html.${HOST_CLASS} [class*="topic"],
html.${HOST_CLASS} [class*="quick-action"],
html.${HOST_CLASS} [class*="shortcut"],
html.${HOST_CLASS} [class*="content-KTJ1Rj"],
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
}
`;

  // Rebuild with the line-frame override + suggestion killer appended LAST
  // so they beat L4's token auto-discovery.
  const finalCss = [fullCss, INPUT_LINE_FRAME_CSS, SUGGEST_GLASS_KILLER].filter(Boolean).join('\n');
  let finalSheet = new CSSStyleSheet();
  finalSheet.replaceSync(finalCss);
  finalSheet.__agentskin = true;
  finalSheet.__agentskin_layer = 'adapter';
  try { window.__agentskin_sheet_manager__?.adopt?.(finalSheet); } catch {}
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    finalSheet,
  ];

  // ═══════════════════════════════════════════════════════════
  // SELF-HEALING: MutationObserver (with adaptive throttle)
  // Re-applies heuristic styles when DOM changes significantly.
  // Wrapped in AdaptiveMutationObserver to prevent observer storms
  // from third-party agent re-renders.
  // ═══════════════════════════════════════════════════════════

  let healTimer = null;

  /**
   * Matches elements that the L5 heuristics target. Used by the inline
   * style guard to decide whether a style/class mutation warrants a
   * re-run of applyHeuristicStyles without waiting for a structural change.
   */
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

  const observer = new window.AdaptiveMutationObserver((mutations) => {
    // Inline style guard: when style/class mutates on heuristic targets,
    // re-apply heuristic styles immediately (prevents flash of
    // unthemed content after Doubao re-renders an input/greeting/sidebar).
    for (const m of mutations) {
      if (m.type !== 'attributes') continue;
      if (m.attributeName === 'style' || m.attributeName === 'class') {
        if (matchesHeuristicRules(m.target)) applyHeuristicStyles();
      }
    }

    // Structural change guard: lowered threshold (>1 instead of >2)
    // catches smaller re-renders that still break layout/theme.
    const structural = mutations.some(m => m.addedNodes.length > 1 || m.removedNodes.length > 1);
    if (!structural) return;
    if (healTimer) clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      const newRules = applyHeuristicStyles();
      const newDiscovered = discoverAndOverrideTokens();
      const updatedCss = [STRUCTURAL_CSS, newRules, newDiscovered, INPUT_LINE_FRAME_CSS, SUGGEST_GLASS_KILLER].filter(Boolean).join('\n');
      try { finalSheet.replaceSync(updatedCss); } catch {}
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  // 治本：同时观察 documentElement（host class / hero URL 所在），立即捕获清除
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

  // ═══════════════════════════════════════════════════════════
  // ANTI-RERENDER: scheduleReinject (debounced reinject)
  // 100ms debounce coalesces rapid mutation bursts into a single
  // reinject, preventing observer storms from React re-renders.
  // Wraps the existing reinjectSheet() with debounce + host class guard.
  // ═══════════════════════════════════════════════════════════
  let reinjectTimeout = null;
  function scheduleReinject() {
    if (reinjectTimeout) clearTimeout(reinjectTimeout);
    reinjectTimeout = setTimeout(() => {
      reinjectSheet();
      // Ensure host class survives React re-renders
      if (!document.documentElement.classList.contains(HOST_CLASS)) {
        document.documentElement.classList.add(HOST_CLASS);
      }
      reinjectTimeout = null;
    }, 100);
  }

  // Expected adoptedStyleSheets layers (adapter sheet = 1)
  const expectedLayers = 1;

  // Reinject helper: rebuilds the full CSS sheet and re-adds it to
  // document.adoptedStyleSheets. Doubao's chromium-webview can silently
  // drop adoptedStyleSheets after navigation or over-aggressive internal
  // style resets, so this is the canonical recovery path.
  function reinjectSheet() {
    const newSheet = finalSheet = new CSSStyleSheet();
    // P1-9 fix: sync window[MARKER].sheet with the new sheet so self-heal
    // checks compare against the current sheet, not the stale reference.
    if (window[MARKER]) window[MARKER].sheet = newSheet;
    const currentHeuristic = applyHeuristicStyles();
    const currentDiscovered = discoverAndOverrideTokens();
    const css = [STRUCTURAL_CSS, currentHeuristic, currentDiscovered, INPUT_LINE_FRAME_CSS, SUGGEST_GLASS_KILLER].filter(Boolean).join('\n');
    newSheet.replaceSync(css);
    newSheet.__agentskin = true;
    newSheet.__agentskin_layer = 'adapter';
    document.adoptedStyleSheets = [
      ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
      newSheet,
    ];
  }

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
  const sheetPoll = setInterval(() => {
    const sheets = document.adoptedStyleSheets.filter(s => s.__agentskin);
    if (sheets.length < expectedLayers) reinjectSheet();
  }, 1500);

  // DEEP-CORE INTEGRATION (RFC 2026-08-20)
  // NOTE: DeepCore init is now AFTER self-heal intervals are established.
  // If DeepCore succeeds, it enhances the adapter but the self-heal
  // intervals continue running as a safety net.
  if (DEEP_CONFIG.enabled && typeof DeepCore !== "undefined") {
    try {
      new DeepCore(DEEP_CONFIG, { agent: "doubao", themeId: config.themeId || "unknown", heroUrl: heroUrl, HOST_CLASS: HOST_CLASS });
    } catch (err) {
      console.warn("[doubao-adapter] DeepCore init failed, fallback:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BACKGROUND SELF-HEAL — independent art layer + observer
  // Mirror of engines/doubao/background-self-heal.mjs (search that file
  // for the canonical implementation; this inline copy is required because
  // the adapter is evaluated as a bare string via CDP and cannot import).
  //
  // Strategy: the theme CSS paints the hero on a real
  //   div.agentskin-background-layer { position:fixed; inset:0; z-index:-1 }
  // element rather than body::before. When Doubao's data-theme switch mutates
  // body's style attribute, this observer restores the div if it was removed.
  // z-index:-1 keeps the art behind all content; pointer-events:none keeps
  // interaction穿透; aria-hidden=true removes it from the a11y tree.
  // ═══════════════════════════════════════════════════════════
  const BG_LAYER_CLASS = 'agentskin-background-layer';
  const BG_LAYER_ID_PREFIX = 'agentskin-bg-';

  function removeBackgroundLayer() {
    const existing = document.querySelector(`div.${BG_LAYER_CLASS}`);
    if (existing) existing.remove();
  }

  function createBackgroundLayer() {
    const artValue = getComputedStyle(document.documentElement)
      .getPropertyValue('--agentskin-art')
      .trim();
    if (!artValue || artValue === 'none' || artValue === '') return null;
    const div = document.createElement('div');
    div.id = `${BG_LAYER_ID_PREFIX}${Date.now()}`;
    div.className = BG_LAYER_CLASS;
    div.setAttribute('aria-hidden', 'true');
    document.body.prepend(div);
    return div;
  }

  // Create the layer only when --agentskin-art is actually set.
  createBackgroundLayer();

  // Self-heal observer: watch body's style attribute for Doubao's reset.
  const bgObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'style' || m.target !== document.body) continue;
      const body = document.body;
      const bgImg = body.style.backgroundImage;
      const bgColor = body.style.backgroundColor;
      if (bgImg === '' || bgImg === 'none' || bgColor === '' || bgColor === 'transparent') {
        const existing = document.querySelector(`div.${BG_LAYER_CLASS}`);
        if (!existing) {
          removeBackgroundLayer();
          createBackgroundLayer();
        }
      }
    }
  });
  bgObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });

  window[MARKER] = { observer, interval, sheetPoll, sheet: finalSheet, bgObserver };
  return "applied";
})()
