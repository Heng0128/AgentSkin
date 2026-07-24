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
 * The caller provides __CODEDROBE_CONFIG__ with heroBlobUrl and palette info.
 */

(() => {
  'use strict';
  const HOST_CLASS = 'codedrobe-host-doubao';
  const MARKER = '__agentskin_doubao_adapter__';
  if (window[MARKER]) return 'already-applied';

  const config = window.__CODEDROBE_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  // ═══════════════════════════════════════════════════════════
  // STRUCTURAL CSS — uses only element selectors, pseudo-classes,
  // and minimal attribute patterns that are structurally stable.
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
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--agentskin-surface) 26%, transparent) 0 16%,
      color-mix(in srgb, var(--agentskin-surface) 8%, transparent) 44%,
      transparent 70%),
    linear-gradient(180deg, transparent 0 50%,
      color-mix(in srgb, var(--agentskin-surface) 20%, transparent) 86% 100%),
    radial-gradient(120% 80% at 84% 14%,
      color-mix(in srgb, var(--agentskin-secondary, var(--agentskin-accent)) 30%, transparent), transparent 60%),
    var(--codedrobe-art, none) right center / cover no-repeat !important;
}

/* === Greeting pseudo-element suppression ===
   The greeting text element has ::after with opaque bg.
   Target by text content heuristic (applied via JS below). */

/* === Input area: frosted glass + radius ===
   Applied via JS heuristic to the actual input container. */

/* === Input area: frosted glass + radius (NO border line) ===
   The outer input wrapper uses "input-guidance" in its class. We keep the
   frosted translucent look but the visible border line is removed entirely
   (see the variable override + ::after kill below). */
html.${HOST_CLASS} [class*="input-guidance"],
html.${HOST_CLASS} [class*="input-container"][class*="flex"] {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent) !important;
  border: none !important;
  border-radius: var(--dbx-radius-4xl, 24px) !important;
  backdrop-filter: blur(24px) saturate(1.25) !important;
  overflow: hidden !important;
  box-shadow: none !important;
}
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

/* === Titlebar: fully transparent so art shows through (light glass) === */
html.${HOST_CLASS} [class*="h-header-height"] {
  background: transparent !important;
  backdrop-filter: blur(6px) saturate(1.1) !important;
  border-bottom: none !important;
}
html.${HOST_CLASS} [class*="h-header-height"] button {
  background: transparent !important;
  color: var(--agentskin-text) !important;
}
html.${HOST_CLASS} [class*="h-header-height"] button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
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

/* === Message bubbles: subtle surface tint === */
html.${HOST_CLASS} [class*="message"][class*="bubble"],
html.${HOST_CLASS} [class*="msg-content"],
html.${HOST_CLASS} [class*="message-content"],
html.${HOST_CLASS} [class*="bubble"] {
  background: color-mix(in srgb, var(--agentskin-surface) 25%, transparent) !important;
  border: none !important;
  backdrop-filter: blur(6px) !important;
}

/* === Active/selected items: accent tint === */
html.${HOST_CLASS} [class*="active"],
html.${HOST_CLASS} [class*="selected"],
html.${HOST_CLASS} [aria-selected="true"] {
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
  border: none !important;
}

/* === Primary buttons: frosted glass (neutral fill + accent border) === */
html.${HOST_CLASS} button[class*="primary"],
html.${HOST_CLASS} button[class*="send"],
html.${HOST_CLASS} [class*="btn-primary"],
html.${HOST_CLASS} [class*="btn-brand"] {
  background: color-mix(in srgb, var(--agentskin-surface) 20%, transparent) !important;
  backdrop-filter: blur(14px) saturate(1.15) !important;
  color: var(--agentskin-text) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 38%, transparent) !important;
}
html.${HOST_CLASS} button[class*="primary"]:hover,
html.${HOST_CLASS} button[class*="send"]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  backdrop-filter: blur(14px) saturate(1.2) !important;
}

/* === Code blocks === */
html.${HOST_CLASS} pre {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
  border-left: 3px solid color-mix(in srgb, var(--agentskin-accent) 50%, transparent) !important;
  border-radius: 10px !important;
}
html.${HOST_CLASS} code {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
}
html.${HOST_CLASS} pre code {
  border: none !important;
  background: transparent !important;
}

/* === Links === */
html.${HOST_CLASS} a {
  color: var(--agentskin-accent) !important;
}

/* === Popovers / modals: frosted glass === */
html.${HOST_CLASS} [role="dialog"],
html.${HOST_CLASS} [role="menu"],
html.${HOST_CLASS} [role="tooltip"],
html.${HOST_CLASS} [role="listbox"],
html.${HOST_CLASS} [class*="popover"],
html.${HOST_CLASS} [class*="dropdown"],
html.${HOST_CLASS} [class*="modal"],
html.${HOST_CLASS} [class*="tooltip"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent) !important;
  backdrop-filter: blur(20px) saturate(1.1) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 30%, transparent) !important;
}
`;

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
    // Strategy 3: fallback to class pattern (least stable)
    return document.querySelector('[class*="input-guidance"]')
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
      if (rect.left < 10 && rect.width < 350 && rect.height > 400) return nav;
    }
    // Strategy 2: fixed/absolute left panel
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

    // Input container: frosted glass + radius (border line removed — the
    // cursor line-frame is killed via the CSS variable overrides below).
    const input = findInputContainer();
    if (input) {
      input.style.setProperty('background',
        'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent)', 'important');
      input.style.setProperty('border', 'none', 'important');
      input.style.setProperty('border-radius', 'var(--dbx-radius-4xl, 24px)', 'important');
      input.style.setProperty('backdrop-filter', 'blur(24px) saturate(1.25)', 'important');
      input.style.setProperty('overflow', 'hidden', 'important');
      input.style.setProperty('box-shadow', 'none', 'important');
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
      sidebar.style.setProperty('backdrop-filter', 'blur(24px) saturate(1.15)', 'important');
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

    return rules.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  // L4: RUNTIME TOKEN AUTO-DISCOVERY
  // Scans agent stylesheets for custom properties we haven't
  // overridden yet, classifies them, and generates overrides.
  // ═══════════════════════════════════════════════════════════

  function discoverAndOverrideTokens() {
    const knownPrefixes = ['--dbx-', '--s-color-', '--ffc-', '--chat-', '--semi-color-'];
    const bgPatterns = /bg|background|surface|fill(?!-highlight)|body(?!-web)/;
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
            if (prop.endsWith('-raw')) continue; // raw values handled separately
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
        // Background token → make semi-transparent surface
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
      return `html.${HOST_CLASS}:root {\n  ${overrides.map(o => o + ' !important').join(';\n  ')};\n}`;
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
    document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
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
html.${HOST_CLASS} [class*="input-guidance"],
html.${HOST_CLASS} [class*="input-container"],
html.${HOST_CLASS} [class*="input-box"],
html.${HOST_CLASS} [class*="chat-input"],
html.${HOST_CLASS} [class*="composer"],
html.${HOST_CLASS} [class*="input-area"],
html.${HOST_CLASS} [class*="input-wrapper"],
html.${HOST_CLASS} [class*="input-guidance"] *,
html.${HOST_CLASS} [class*="input-container"] *,
html.${HOST_CLASS} [class*="input-guidance"]:focus-within,
html.${HOST_CLASS} [class*="input-container"]:focus-within {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [class*="input-guidance"] ::after,
html.${HOST_CLASS} [class*="input-container"] ::after,
html.${HOST_CLASS} [class*="input-box"] ::after,
html.${HOST_CLASS} [class*="chat-input"] ::after,
html.${HOST_CLASS} [class*="composer"] ::after,
html.${HOST_CLASS} [class*="input-area"] ::after,
html.${HOST_CLASS} [class*="input-wrapper"] ::after {
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

  // ═══════════════════════════════════════════════════════════
  // GENERIC BUTTON GLASS — appended AFTER L4
  // Doubao's generic buttons (not just primary/send) draw their fill from
  // --dbx-fill-* variables, which L4's token auto-discovery re-casts into an
  // ~85% opaque surface block. Force a frosted-glass (semi-transparent) look
  // on every button-like element so the opaque block is replaced. Placed LAST
  // so it beats both L4's variable override and Doubao's own !important fills.
  // (Header buttons keep their own transparent rule via higher specificity.)
  // ═══════════════════════════════════════════════════════════
  const BUTTON_GLASS_CSS = `
html.${HOST_CLASS} button,
html.${HOST_CLASS} [role="button"],
html.${HOST_CLASS} [class*="btn"],
html.${HOST_CLASS} [class*="button"] {
  background: color-mix(in srgb, var(--agentskin-surface) 18%, transparent) !important;
  backdrop-filter: blur(12px) saturate(1.12) !important;
  -webkit-backdrop-filter: blur(12px) saturate(1.12) !important;
  color: var(--agentskin-text) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 30%, transparent) !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} button:hover,
html.${HOST_CLASS} [role="button"]:hover,
html.${HOST_CLASS} [class*="btn"]:hover,
html.${HOST_CLASS} [class*="button"]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 18%, transparent) !important;
  backdrop-filter: blur(12px) saturate(1.18) !important;
  -webkit-backdrop-filter: blur(12px) saturate(1.18) !important;
}
`;

  // Rebuild with the line-frame override + suggestion killer + button glass
  // appended LAST so they beat L4's token auto-discovery.
  const finalCss = [fullCss, INPUT_LINE_FRAME_CSS, SUGGEST_GLASS_KILLER, BUTTON_GLASS_CSS].filter(Boolean).join('\n');
  const finalSheet = new CSSStyleSheet();
  finalSheet.replaceSync(finalCss);
  finalSheet.__agentskin = true;
  finalSheet.__agentskin_layer = 'adapter';
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    finalSheet,
  ];

  // ═══════════════════════════════════════════════════════════
  // SELF-HEALING: MutationObserver
  // Re-applies heuristic styles when DOM changes significantly.
  // ═══════════════════════════════════════════════════════════

  let healTimer = null;
  const observer = new MutationObserver((mutations) => {
    // Debounce: only re-apply if structural changes (added/removed nodes)
    const structural = mutations.some(m => m.addedNodes.length > 2 || m.removedNodes.length > 2);
    if (!structural) return;
    if (healTimer) clearTimeout(healTimer);
    healTimer = setTimeout(() => {
      const newRules = applyHeuristicStyles();
      const newDiscovered = discoverAndOverrideTokens();
      const updatedCss = [STRUCTURAL_CSS, newRules, newDiscovered, INPUT_LINE_FRAME_CSS, SUGGEST_GLASS_KILLER, BUTTON_GLASS_CSS].filter(Boolean).join('\n');
      try { finalSheet.replaceSync(updatedCss); } catch {}
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // 5. Periodic re-check (agent may re-render without DOM mutations)
  const interval = setInterval(() => {
    if (!document.documentElement.classList.contains(HOST_CLASS)) {
      document.documentElement.classList.add(HOST_CLASS);
    }
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').includes('blob:')) {
      document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
    }
  }, 5000);

  window[MARKER] = { observer, interval, sheet: finalSheet };
  return 'applied';
})()
