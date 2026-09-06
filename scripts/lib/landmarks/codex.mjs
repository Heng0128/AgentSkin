// SPDX-License-Identifier: MPL-2.0

/**
 * # codex landmarks — stable DOM anchors for OpenAI Codex.
 *
 * PROBE-VERIFIED selectors from the CSS generators and THEME_SPEC.md.
 * Codex uses a `--color-token-*` design token system with an app-shell
 * layout: left sidebar panel, main surface, and composer.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const codexLandmarks = {
  required: [
    {
      name: 'host-root',
      selectors: [':root.agentskin-host-codex', 'html.agentskin-host-codex'],
    },
  ],
  recommended: [
    {
      name: 'sidebar',
      selectors: ['.app-shell-left-panel', 'aside'],
    },
    {
      name: 'main-surface',
      selectors: ['main.main-surface', 'main', '[role="main"]'],
    },
    {
      name: 'composer',
      selectors: [
        '.composer-surface-chrome',
        '[class*="_multilineSurface_"]',
        '[contenteditable="true"]',
      ],
    },
    {
      name: 'header',
      selectors: ['header.app-header-tint', 'header'],
    },
    {
      name: 'sidebar-item',
      selectors: ['button.sidebar-item'],
    },
  ],
};

export default codexLandmarks;
