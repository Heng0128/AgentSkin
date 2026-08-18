/**
 * ENGINE: traework — Layer 1: Structural Adaptation
 * TraeWork CN (VS Code / solo-lite shell).
 * Art layer on #root::before, punch-through on chat panels.
 */
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

  // Self-healing
  const interval = setInterval(() => {
    if (!document.documentElement.classList.contains(HOST_CLASS)) document.documentElement.classList.add(HOST_CLASS);
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').includes('blob:')) {
      document.documentElement.style.setProperty('--agentskin-art', `url("${heroUrl}")`);
    }
  }, 5000);

  window[MARKER] = { interval, sheet };
  return 'applied';
})()
