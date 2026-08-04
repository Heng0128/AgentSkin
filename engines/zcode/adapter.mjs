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
  const HOST_CLASS = 'agentskin-host-zcode';
  const MARKER = '__agentskin_zcode_adapter__';
  if (window[MARKER]) return 'already-applied';

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

/* === Sidebar / nav containers: frosted glass ===
   The tint (--sidebar-bg) is semi-transparent; backdrop-filter blurs what's
   behind (hero art / injected wallpaper) for a true frosted-glass sidebar,
   matching the composer + popover treatment. On flat (art:false) themes the
   background is the palette's solid --agentskin-bg, so the blur is invisible
   but harmless. A slightly softer blur than the input keeps the persistent
   surface readable while still reading as glass. */
html.${HOST_CLASS} aside,
html.${HOST_CLASS} nav {
  background: var(--sidebar-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 22%, transparent)) !important;
  backdrop-filter: blur(16px) saturate(1.15) !important;
  -webkit-backdrop-filter: blur(16px) saturate(1.15) !important;
}
html.${HOST_CLASS} aside a:hover,
html.${HOST_CLASS} nav a:hover,
html.${HOST_CLASS} aside button:hover,
html.${HOST_CLASS} nav button:hover {
  background: var(--bg-hover, color-mix(in srgb, var(--agentskin-accent) 10%, transparent)) !important;
}
html.${HOST_CLASS} aside a[aria-current="true"],
html.${HOST_CLASS} aside a[aria-current="page"],
html.${HOST_CLASS} nav a[aria-current="true"],
html.${HOST_CLASS} nav a[aria-current="page"] {
  background: var(--bg-active, color-mix(in srgb, var(--agentskin-accent) 16%, transparent)) !important;
}

/* === Composer / input area: frosted glass ===
   The tint (--input-bg) is semi-transparent so the hero wallpaper/art shows
   through; backdrop-filter blurs what's behind for a true frosted-glass
   effect. On flat (art:false) themes the background is the palette's solid
   --agentskin-bg, so the blur is invisible but harmless. */
html.${HOST_CLASS} [contenteditable="true"],
html.${HOST_CLASS} textarea {
  background: var(--input-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent)) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  border-radius: 14px !important;
  box-shadow: none !important;
  backdrop-filter: blur(20px) saturate(1.2) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.2) !important;
  color: var(--agentskin-text) !important;
  caret-color: var(--agentskin-accent) !important;
}
html.${HOST_CLASS} [contenteditable="true"]:focus,
html.${HOST_CLASS} textarea:focus,
html.${HOST_CLASS} input:focus {
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

  // Self-healing
  let healTimer = null;
  const observer = new MutationObserver((mutations) => {
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
