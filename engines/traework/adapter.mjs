/**
 * ENGINE: traework — Layer 1: Structural Adaptation
 * TraeWork CN (VS Code / solo-lite shell).
 * Art layer on #root::before, punch-through on chat panels.
 */
(() => {
  'use strict';
  const HOST_CLASS = 'codedrobe-host-traework';
  const MARKER = '__agentskin_traework_adapter__';
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
  backdrop-filter: blur(24px) saturate(1.15) !important;
}
html.${HOST_CLASS} .task-list-base [class*="item"]:hover,
html.${HOST_CLASS} .task-list-panel [class*="item"]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
}
html.${HOST_CLASS} .task-list-base [class*="active"],
html.${HOST_CLASS} .task-list-panel [class*="active"] {
  background: color-mix(in srgb, var(--agentskin-accent) 18%, transparent) !important;
  box-shadow: inset 3px 0 0 0 var(--agentskin-accent), inset 0 0 0 1px color-mix(in srgb, var(--agentskin-accent) 32%, transparent) !important;
}

/* === Composer === */
html.${HOST_CLASS} .chat-input-v2-input-box-editable {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent) !important;
  backdrop-filter: blur(14px) saturate(1.1) !important;
  color: var(--agentskin-text) !important;
  caret-color: var(--agentskin-accent) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 25%, transparent) !important;
  border-radius: 14px !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} .chat-input-v2-input-box-editable:focus,
html.${HOST_CLASS} .chat-input-v2-input-box-editable:focus-within {
  border-color: color-mix(in srgb, var(--agentskin-accent) 50%, transparent) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agentskin-accent) 10%, transparent), 0 4px 18px color-mix(in srgb, var(--agentskin-secondary) 12%, transparent) !important;
}
html.${HOST_CLASS} [class*="chat-input-v2"] [class*="placeholder"] {
  color: var(--agentskin-muted) !important;
}
html.${HOST_CLASS} [class*="chat-input-primary-glow"] {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 40%, transparent) !important;
  backdrop-filter: blur(14px) saturate(1.1) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  box-shadow: none !important;
}
html.${HOST_CLASS} [class*="chat-input-primary-glow"]:focus-within {
  border-color: color-mix(in srgb, var(--agentskin-accent) 45%, transparent) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agentskin-accent) 8%, transparent), 0 4px 16px color-mix(in srgb, var(--agentskin-secondary) 10%, transparent) !important;
}

/* === Buttons === */
html.${HOST_CLASS} button[class*="primary"],
html.${HOST_CLASS} button[class*="send"] {
  background: linear-gradient(135deg, var(--agentskin-accent) 0%, color-mix(in srgb, var(--agentskin-accent) 62%, var(--agentskin-secondary) 38%) 100%) !important;
  color: var(--agentskin-bg) !important;
  border: none !important;
  box-shadow: 0 2px 10px var(--agentskin-focus-ring, color-mix(in srgb, var(--agentskin-accent) 40%, transparent)) !important;
}
html.${HOST_CLASS} button[class*="primary"]:hover,
html.${HOST_CLASS} button[class*="send"]:hover {
  filter: brightness(1.07) !important;
  transform: translateY(-1px) !important;
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

  // Injection
  document.documentElement.classList.add(HOST_CLASS);
  if (heroUrl) {
    document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
  }

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STRUCTURAL_CSS);
  sheet.__agentskin = true;
  sheet.__agentskin_layer = 'adapter';
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets.filter(s => s.__agentskin_layer !== 'adapter'),
    sheet,
  ];

  // Self-healing
  const interval = setInterval(() => {
    if (!document.documentElement.classList.contains(HOST_CLASS)) document.documentElement.classList.add(HOST_CLASS);
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').includes('blob:')) {
      document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
    }
  }, 5000);

  window[MARKER] = { interval, sheet };
  return 'applied';
})()
