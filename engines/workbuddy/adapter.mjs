/**
 * ENGINE: workbuddy — Layer 1: Structural Adaptation
 * WorkBuddy uses #root with teams-container grid layout.
 * Art layer on #root::before, punch-through on opaque containers.
 */
(() => {
  'use strict';
  const MARKER = '__agentskin_workbuddy_adapter__';
  if (window[MARKER]) return 'already-applied';

  const config = window.__CODEDROBE_CONFIG__ || {};
  const heroUrl = config.heroBlobUrl || '';

  const STRUCTURAL_CSS = `
/* === Art layer on #root::before === */
#root {
  background: transparent !important;
}
#root::before {
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

/* === teams-container opaque base → transparent === */
.teams-container,
.teams-container.is-mac {
  background: transparent !important;
}
.teams-container > div {
  background: transparent !important;
}

/* === Grid item containers === */
[data-view-id] {
  background: transparent !important;
}
[class*="_gridViewItem_"] > div,
[class*="_gridView_"] > div > div {
  background: transparent !important;
}

/* === Inner content layers === */
.conversation-list,
.chat-container,
.wb-cb-chat,
.chat-main,
.message-list,
.main-content,
.main-content--welcome,
.sidebar-next,
.teams-content-wrapper,
.teams-main-content {
  background: transparent !important;
}

/* === Topbar: menubar + window controls === */
#workbuddy-menubar-container,
.codebuddy-menubar,
#workbuddy-window-controls-container,
.workbuddy-window-controls {
  background: color-mix(in srgb, var(--agentskin-surface) 8%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
  border-bottom: none !important;
}
.workbuddy-window-control-button {
  background: transparent !important;
  color: var(--agentskin-text) !important;
}
.workbuddy-window-control-button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
}
.workbuddy-window-control-button.close:hover {
  background: #e53935 !important;
  color: #ffffff !important;
}

/* === Chat dialog top bar (conversation title + 搜索/分享/历史/提问/展开左栏) ===
   Native solid bg rgb(20,20,20). Punch it through to the art layer with a
   subtle frosted tint (consistent with the menubar/sidebar bars). Children
   (workbuddy-topbar-title / -options) are already transparent. */
.workbuddy-topbar {
  background: color-mix(in srgb, var(--agentskin-surface) 8%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
  border-bottom: none !important;
}

/* === Composer main area === */
[class*="_mainArea_"] {
  background: color-mix(in srgb, var(--agentskin-surface) 50%, transparent) !important;
  backdrop-filter: blur(14px) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 25%, transparent) !important;
  border-radius: 12px !important;
}

/* === Sidebar section labels === */
.conversation-section-label,
.collapsible-section-header[class*="_header_"][class*="_headerSticky_"],
[class*="_headerTopPadding_"][class*="collapsible"] {
  background: transparent !important;
  background-color: transparent !important;
}

/* === Sidebar search box === */
.my-files-search {
  background: color-mix(in srgb, var(--agentskin-surface) 30%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 15%, transparent) !important;
  border-radius: 8px !important;
  backdrop-filter: blur(8px) !important;
}

/* === Sidebar: frosted glass === */
[data-view-id="sidebar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  border-right: none !important;
  backdrop-filter: blur(24px) saturate(1.15);
}

/* === Main content: gradient for readability === */
[data-view-id="main-content"] {
  background: linear-gradient(180deg, transparent 0 55%, color-mix(in srgb, var(--agentskin-bg) 42%, transparent) 100%) !important;
}

/* === Detail panel: frosted glass === */
[data-view-id="detail-panel"] {
  background: color-mix(in srgb, var(--agentskin-surface) 72%, transparent) !important;
  backdrop-filter: blur(18px) saturate(1.08);
}

/* === Composer focus ring === */
[role="textbox"][contenteditable="true"]:focus,
.wb-home-composer [contenteditable="true"]:focus {
  outline: none !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agentskin-accent) 40%, transparent), 0 4px 18px color-mix(in srgb, var(--agentskin-secondary) 20%, transparent) !important;
}

/* === Recommendation chips above input: kill side shadows ===
   The .quick-actions row above the composer renders a pair of harsh
   box-shadows on both sides of each chip; our surface tint replaces them. */
.quick-actions,
.quick-actions__list,
[class*="quick-action"]:not(.quick-actions__item) {
  box-shadow: none !important;
}
.quick-actions *,
.quick-actions__list * {
  box-shadow: none !important;
}

/* === Tencent docs auth strip === */
.tencent-docs-auth-guide__permissions {
  background: transparent !important;
}
`;

  // Injection
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
    if (heroUrl && !getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').includes('blob:')) {
      document.documentElement.style.setProperty('--codedrobe-art', `url("${heroUrl}")`);
    }
  }, 5000);

  window[MARKER] = { interval, sheet };
  return 'applied';
})()
