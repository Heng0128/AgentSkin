// SPDX-License-Identifier: MPL-2.0

/**
 * # doubao landmarks — stable DOM anchors for Doubao (豆包).
 *
 * 2026-09-08 REFRESHED from live CDP probe (scripts/probe-engine/doubao.mjs,
 * chrome://doubao-chat + doubao:// docs, native dark). The previous content
 * was stale: `.dbx-composer` and `[data-testid="composer"]` were fabricated
 * patterns (zero occurrences in any verified evidence) and `.chat-container`
 * never matched. host-root / background-layer are AgentSkin-owned artifacts
 * (present only while a theme is applied) — kept, they are runtime markers,
 * not host anchors.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const doubaoLandmarks = {
  required: [
    {
      name: 'host-root',
      selectors: ['html.agentskin-host-doubao:root', 'html.agentskin-host-doubao'],
    },
  ],
  recommended: [
    {
      name: 'chat-shell',
      // PROBE 2026-09-08: all four testids hit=1 on live chat doc.
      selectors: [
        '[data-testid="chat_list_wrapper"]',
        '[data-testid="chat_route_layout_leftside_nav"]',
        '[data-testid="flow_chat_sidebar"]',
        '[data-testid="chat_input"]',
      ],
    },
    {
      name: 'composer-guidance',
      // PROBE 2026-09-08: [class*="input-guidance"] hit=4.
      selectors: ['[class*="input-guidance"]', '[contenteditable="true"]'],
    },
    {
      name: 'greeting',
      // PROBE 2026-09-08: [class*="greeting-text-"] hit=1 (home view).
      selectors: ['[class*="greeting-text-"]'],
    },
    {
      name: 'background-layer',
      selectors: ['div.agentskin-background-layer'],
    },
  ],
};

export default doubaoLandmarks;
