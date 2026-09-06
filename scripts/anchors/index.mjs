// SPDX-License-Identifier: MPL-2.0
//
// # anchors/index.mjs — per-agent semantic anchor registry
//
// Single source of truth for the stable selectors used by the per-agent CSS
// generators. All broad `[class*=...]` / `[class^=...]` selectors in the
// generators must be replaced with these precise anchors.
//
// Anchor priority (from CDP probe sessions, see scripts/dev/cdp-*.mjs):
//   1. data-* attributes (data-testid, data-active, data-view-id)
//   2. exact stable class names (BEM / semantic, e.g. .agents-sidebar)
//   3. app-specific stable hash prefixes (e.g. [class*="main-with-nav"])
//      — only when the prefix is stable across versions.
//
// PROBE-DATE 2026-08-23 (all anchors verified live on Windows):
//   codex 59480 / qoderwork 64833 / workbuddy 57556 / doubao 64318 / zcode 58728
//   traework 54564 — OFFLINE at probe time, anchors pending.

const doubao = {
  /** Center column wrapper (opaque --dbx-bg-base-web container).
      PROBE: div.main-with-nav-<hash> — stable prefix. */
  mainColumn: '[class*="main-with-nav"]',
  /** Center content root (opaque --dbx-bg-base-web container).
      PROBE: main.center-bg-<hash> — stable prefix. */
  mainContent: 'main[class*="center-bg"]',
  /** Full app layout wrapper. PROBE: testid is HYPHENATED chat-route-layout
      (the generator historically used chat_route_layout underscore — wrong). */
  layout: '[data-testid="chat-route-layout"]',
  /** Left sidebar root. PROBE: chat_route_layout_leftside_nav → flow_chat_sidebar. */
  sidebar: '[data-testid="chat_route_layout_leftside_nav"]',
  sidebarInner: '[data-testid="flow_chat_sidebar"]',
  /** Top titlebar (~56px, frosted). PROBE: class contains h-header-height. */
  header: '[class*="h-header-height"]',
  /** Composer / input guidance area. PROBE: chat_input / chat_input_input. */
  composer: '[data-testid="chat_input"]',
  composerInput: '[data-testid="chat_input_input"]',
  /** Conversation rows. PROBE: data-testid conversation-list-v2-item. */
  conversationItem: '[data-testid="conversation-list-v2-item"]',
  /** Buttons carry exact data attributes. */
  navItem: '[data-dbx-name="button"]',
  /** Active state is an exact attribute, NOT a class. */
  navActive: '[data-active="true"]',
  /** Message bubbles. PROBE: testid ends with _message / contains message_bubble. */
  message: '[data-testid$="_message"], [data-testid*="message_bubble"]',
  /** Send button. PROBE: data-testid send_btn (rendered only in chat view). */
  sendButton: '[data-testid="send_btn"]',
  /** Art layer mounts on body::before (no #root). */
  artHost: 'body',
};

const codex = {
  /** Left panel. PROBE: aside.app-shell-left-panel (exact, unique, 240px). */
  sidebar: 'aside.app-shell-left-panel',
  /** Sidebar scroll region. PROBE: data-app-action-sidebar-scroll. */
  sidebarScroll: '[data-app-action-sidebar-scroll]',
  /** Top toolbar (fixed header over art). PROBE: header.pointer-events-none.fixed.z-30. */
  header: 'header.pointer-events-none.fixed',
  /** Main surface. PROBE: main._MainContentSurface_<hash> (stable prefix, 1202x878). */
  main: 'main[class*="_MainContentSurface_"]',
  /** Sidebar item rows are exact button.sidebar-item. */
  navItem: 'button.sidebar-item',
  /** Thread rows. PROBE: data-app-action-sidebar-thread-row. */
  threadRow: '[data-app-action-sidebar-thread-row]',
  /** Project rows. PROBE: data-app-action-sidebar-project-id. */
  projectRow: '[data-app-action-sidebar-project-id]',
  /** Active thread. PROBE: data-app-action-sidebar-thread-selected/active. */
  navActive:
    '[data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-active="true"]',
  /** Composer root. PROBE: data-codex-composer-root. */
  composer: '[data-codex-composer-root]',
  /** Composer editable. PROBE: [contenteditable="true"].ProseMirror. */
  composerInput: '[contenteditable="true"].ProseMirror',
  /** User message bubble. PROBE: data-user-message-bubble="true". */
  userMessage: '[data-user-message-bubble="true"]',
  /** Assistant turn. PROBE: data-local-conversation-final-assistant. */
  assistantMessage: '[data-local-conversation-final-assistant]',
  /** Timeline scroll. PROBE: data-app-action-timeline-scroll. */
  timelineScroll: '[data-app-action-timeline-scroll]',
};

const qoderwork = {
  /** Outer sidebar (frosted glass). PROBE: .agents-sidebar (exact, 248px). */
  sidebar: '.agents-sidebar',
  /** Inner sidebar content wrapper (opaque --color-bg container).
      PROBE: div.group/sidebar[data-sidebar-content="true"]. */
  sidebarContent: '[data-sidebar-content="true"]',
  /** Main content area. PROBE: .agents-content-area (1188x868). */
  main: '.agents-content-area',
  /** Chat view root. PROBE: .agents-chat-view-root. */
  chatRoot: '.agents-chat-view-root',
  /** Extension nav items. PROBE: button.group/extensions-nav (exact Tailwind marker). */
  navItem: 'button[class~="group/extensions-nav"]',
  /** Active state is an exact attribute. */
  navActive: '[data-active="true"], [data-extension-nav-item="true"]',
  /** Right resizable panel. PROBE: [data-resizable-sidebar]:not(.agents-sidebar). */
  rightPanel: '[data-resizable-sidebar]:not(.agents-sidebar)',
  /** Composer editable. PROBE: [contenteditable="true"].chat-input-editor-text. */
  composerInput: '[contenteditable="true"].chat-input-editor-text',
  /** Send button. PROBE: button[class*="SendButton-send"]. */
  sendButton: 'button[class*="SendButton-send"]',
};

const workbuddy = {
  /** Conversation sidebar wrapper. PROBE: [data-view-id="sidebar"] → .conversation-sidebar. */
  sidebar: '[data-view-id="sidebar"]',
  /** Conversation list (internal scroll container). PROBE: .conversation-list-content. */
  conversationList: '.conversation-list-content',
  /** Main content view. PROBE: [data-view-id="main-content"] (1176x882). */
  main: '[data-view-id="main-content"]',
  /** Detail panel. PROBE: [data-view-id="detail-panel"] (collapsed to 0 width). */
  detailPanel: '[data-view-id="detail-panel"]',
  /** Composer main area. PROBE: [class*="_mainArea_"] (CSS module, stable). */
  mainArea: '[class*="_mainArea_"]',
  /** Home composer input slot. PROBE: .wb-home-composer__input-slot (exact BEM). */
  composer: '.wb-home-composer__input-slot',
  /** Composer editable. PROBE: [role="textbox"][contenteditable="true"]. */
  composerInput: '[role="textbox"][contenteditable="true"]',
  /** Quick action pills. PROBE: .quick-actions__item (exact BEM). */
  quickActions: '.quick-actions__item',
  /** Rows are conversation-item-* (exact BEM, scoped under sidebar). */
  conversationItem: '.conversation-sidebar [class*="conversation-item"]',
  /** Tab items. PROBE: .conversation-list-tab-button + .active + aria-selected. */
  tabItem: '.conversation-list-tab-button',
  /** Menubar. PROBE: #workbuddy-menubar-container / .codebuddy-menubar. */
  menubar: '#workbuddy-menubar-container, .codebuddy-menubar',
};

const zcode = {
  /** Workspace root column. PROBE: div.flex.h-dvh (exact). */
  root: '.flex.h-dvh',
  /** Left workspace panel. PROBE: [data-workspace-sidebar-panel="true"] (264px). */
  sidebar: '[data-workspace-sidebar-panel="true"]',
  /** Main column. PROBE: main.relative.flex.h-full.flex-col (1174x864). */
  main: 'main.relative.flex.h-full.flex-col',
  /** Header. PROBE: HEADER.@container/workspace-header.flex.h-12.border-b (1174x48). */
  header: 'header.\\@container/workspace-header',
  /** Sidebar items. PROBE: button[data-slot="button"][data-variant="ghost"]. */
  navItem: 'button[data-slot="button"][data-variant="ghost"]',
  /** Section trigger. PROBE: [data-slot="collapsible-trigger"]. */
  sectionTrigger: '[data-slot="collapsible-trigger"]',
  /** Active state. PROBE: [data-slot="tabs-trigger"][data-state="active"], [aria-current]. */
  navActive: '[data-slot="tabs-trigger"][data-state="active"], [aria-current]',
  /** Composer editable. PROBE: [contenteditable="true"] (839x40). */
  composerInput: '[contenteditable="true"]',
  /** Assistant turn. PROBE: .group/assistant-turn. */
  assistantTurn: '.group\\/assistant-turn',
  /** User row. PROBE: .group/user-row[data-row-id]. */
  userRow: '.group\\/user-row[data-row-id]',
};

const traework = {
  // PROBE-PENDING: TRAE Work offline at live probe (2026-08-23). Anchors below
  // are PROBE-VERIFIED by earlier sessions and encoded in traeworkCss.mjs;
  // re-verify live when the app is online.
  /** Sidebar (frosted glass). PROBE: .task-list-base / .task-list-panel. */
  sidebar: '.task-list-base, .task-list-panel',
  /** Task rows. PROBE: .task-list-new-task-item (exact class). */
  taskItem: '.task-list-new-task-item',
  /** Main content / chat panels. PROBE 2026-08-23 (live): .panel-container
      (1139x856) is the main column; .solo-lite-chat-panel-container was 0-hit
      (dead selector). */
  main: '.panel-container',
  /** Composer editable. PROBE: .chat-input-v2-input-box-editable (exact, 767x40). */
  composer: '.chat-input-v2-input-box-editable',
  /** Composer container. PROBE: .chat-input-v2-container (800x127) is the
      frosted wrapper holding the editable. */
  composerContainer: '[class*="chat-input-v2-container"]',
  /** Buttons. PROBE: .solo-common-button / .solo-header-btn / .solo-icon-btn. */
  button: '.solo-common-button, .solo-header-btn, .solo-icon-btn',
  /** Tabs. PROBE: button[role="tab"] + aria-selected for active. */
  tab: 'button[role="tab"]',
  tabActive: 'button[role="tab"][aria-selected="true"]',
  /** Message text. PROBE: [role="log"] / article (NOT [class*="message"]). */
  messageText: '[role="log"], article',
  /** File links. PROBE: .markdown-file-link / [class*="file-link"]. */
  fileLink: '.markdown-file-link, [class*="file-link"]',
};

export const ANCHORS = {
  doubao,
  codex,
  qoderwork,
  workbuddy,
  zcode,
  traework,
};

export const AGENTS = Object.freeze(Object.keys(ANCHORS));
