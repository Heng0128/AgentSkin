// SPDX-License-Identifier: MPL-2.0

/**
 * # workbuddy landmarks — stable DOM anchors for WorkBuddy.
 *
 * PROBE-VERIFIED selectors from the CSS generators and THEME_SPEC.md.
 * WorkBuddy uses a `--cb-*` design token system and has a team-oriented
 * layout with conversation sidebar and chat container.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const workbuddyLandmarks = {
  required: [
    {
      name: 'teams-root',
      selectors: ['.teams-container', 'body[data-application-name="workbuddy"]'],
    },
    {
      name: 'host-root',
      selectors: ['html.agentskin-host-workbuddy', 'body[data-application-name="workbuddy"]'],
    },
  ],
  recommended: [
    {
      name: 'sidebar',
      selectors: ['.conversation-sidebar', '.conversation-list'],
    },
    {
      name: 'workspace',
      selectors: ['.teams-main-content', '.main-content', '.chat-container', '.wb-home-page'],
    },
    {
      name: 'composer',
      selectors: [
        "[role='textbox'][contenteditable='true']",
        '.wb-home-composer [contenteditable="true"]',
        '[contenteditable="true"]',
      ],
    },
    {
      name: 'markdown',
      selectors: ['.cb-markdown'],
    },
    {
      name: 'detail-panel',
      selectors: ['.detail-panel-container'],
    },
    {
      name: 'chat-pane',
      selectors: ['.claw-agent-chat-pane', '.claw-agent-chat-topbar'],
    },
    {
      name: 'menubar',
      selectors: ['.codebuddy-menubar', '.codebuddy-menu-container'],
    },
    {
      name: 'sidebar-states',
      selectors: ['.sidebar-collapsed', '.sidebar-animating'],
    },
    {
      name: 'home-composer',
      selectors: ['.wb-home-composer', '.wb-home-composer__input-slot', '.wb-scene-tabs'],
    },
    {
      name: 'main-area',
      selectors: ['[class*="_mainArea_"]', '[class*="_title_"]', '[class*="_time_"]'],
    },
    {
      name: 'portal-fallback',
      selectors: [
        '[role="dialog"]',
        '[role="menu"]',
        '[role="tooltip"]',
        '[role="tablist"]',
        '[role="tab"]',
      ],
    },
  ],
};

export default workbuddyLandmarks;
