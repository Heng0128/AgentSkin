/**
 * ENGINE: qoderwork — Layer 1: Structural Adaptation
 * QoderWork CN uses #root as app shell with --color-* tokens.
 * Art layer on #root::before, punch-through on layout containers.
 */
(() => {
  'use strict';
  const HOST_CLASS = 'codedrobe-host-qoderwork';
  const MARKER = '__agentskin_qoderwork_adapter__';
  if (window[MARKER]) return 'already-applied';

  const config = window.__CODEDROBE_CONFIG__ || {};
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
  border-right: 1px solid color-mix(in srgb, var(--agentskin-accent) 10%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}
html.${HOST_CLASS} .agents-sidebar [class*="item"]:hover {
  background: var(--color-primary-bg-hover) !important;
}
html.${HOST_CLASS} .agents-sidebar [class*="active"] {
  background: var(--color-primary-bg-hover) !important;
  box-shadow: inset 3px 0 0 0 var(--color-primary), inset 0 0 0 1px var(--color-primary-border) !important;
}

/* === Right panel: frosted glass === */
html.${HOST_CLASS} [data-resizable-sidebar]:not(.agents-sidebar) {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 20%, transparent) !important;
  border-left: 1px solid color-mix(in srgb, var(--agentskin-accent) 10%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}

/* === Composer focus ring === */
html.${HOST_CLASS} .chat-input-editor-text:focus,
html.${HOST_CLASS} .chat-input-editor-text:focus-within {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 3px var(--color-primary-bg-hover), 0 4px 18px color-mix(in srgb, var(--agentskin-secondary) 20%, transparent) !important;
}

/* === Links === */
html.${HOST_CLASS} a {
  color: var(--color-primary) !important;
}

/* === Code blocks === */
html.${HOST_CLASS} pre {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-border) 60%, transparent) !important;
  border-left: 3px solid color-mix(in srgb, var(--agentskin-accent) 50%, transparent) !important;
  border-radius: 10px !important;
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
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agentskin-accent) 15%, transparent) !important;
}
`;

  // L5: Heuristic positioning (QoderWork has stable class names, minimal heuristic needed)
  function applyHeuristicStyles() {
    // QoderWork's layout classes are stable (.agents-sidebar, .agents-layout-body)
    // No heuristic needed — structural CSS above handles it.
    return '';
  }

  // L4: Token auto-discovery
  function discoverAndOverrideTokens() {
    const discovered = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.style) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith('--color-') && !prop.includes('agentskin')) discovered.add(prop);
          }
        }
      } catch {}
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const overrides = [];
    for (const prop of discovered) {
      const value = rootStyle.getPropertyValue(prop).trim();
      if (!value || value === 'transparent' || value.includes('--agentskin')) continue;
      if (/bg|background|container|layout/.test(prop) && (value.startsWith('#') || value.startsWith('rgb'))) {
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
    document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
  }

  const fullCss = [STRUCTURAL_CSS, applyHeuristicStyles(), discoverAndOverrideTokens()].filter(Boolean).join('\n');
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
      try { sheet.replaceSync([STRUCTURAL_CSS, applyHeuristicStyles(), discoverAndOverrideTokens()].filter(Boolean).join('\n')); } catch {}
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const interval = setInterval(() => {
    if (!document.documentElement.classList.contains(HOST_CLASS)) document.documentElement.classList.add(HOST_CLASS);
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').includes('blob:')) {
      document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
    }
  }, 5000);

  window[MARKER] = { observer, interval, sheet };
  return 'applied';
})()
