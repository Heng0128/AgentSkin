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
      // 2026-09-08 probe: .main-content/.chat-container 在当前 Windows 构建零命中
      // （豆皮 5.3.14 macOS 有证 → 版本漂移兜底保留末位）。
      selectors: ['.teams-main-content', '.wb-home-page__main-content', '.wb-home-page', '.main-content', '.chat-container'],
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
      // 2026-09-08 probe: .detail-panel-container 零命中；实证为 [class*="detail-panel"]（hit=2）。
      selectors: ['[class*="detail-panel"]', '[class*="detail-sidebar"]'],
    },
    {
      // LEGACY (codebuddy-era) anchors — zero on 2026-09-08 Windows build, kept as
      // version-drift insurance for older macOS builds only. Do not build new rules on them.
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
      // 2026-09-08 probe: [class*="_mainArea_"] 两次采样均零（CSS Module 已轮换）；
      // 主区承载改用 workspace 组（.teams-main-content/.wb-home-page__main-content）。
      // _time_ 实证存活（hit=39），_title_ 未再验证。
      selectors: ['[class*="_time_"]'],
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
