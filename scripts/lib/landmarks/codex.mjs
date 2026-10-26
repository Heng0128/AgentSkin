// SPDX-License-Identifier: MPL-2.0

/**
 * # codex landmarks — stable DOM anchors for OpenAI Codex.
 *
 * PROBE-VERIFIED selectors from the CSS generators and THEME_SPEC.md.
 * Codex uses a `--color-token-*` design token system with an app-shell
 * layout: left sidebar panel, main surface, and composer.
 *
 * Selector contract synced with upstream Codex-Dream-Skin selectors.json
 * (2026-08-27, verified 26.715 → 26.818 on both platforms): keep legacy
 * anchors, append stable attributes / CSS-Module prefixes, never match a
 * full hash. [role=main] exists ONLY on the home route — degraded fallback.
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
      selectors: ['aside.app-shell-left-panel', '.app-shell-left-panel', 'aside'],
    },
    {
      name: 'main-surface',
      selectors: [
        'main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])',
        'main',
        '[role="main"]',
      ],
    },
    {
      name: 'composer',
      // 2026-09-08 probe: 复合 :is() 经 data-composer-*-variant 承载存活；
      // 裸 .composer-surface-chrome 与 _multilineSurface_ 零命中（已轮换），移除。
      selectors: [
        ':is(.composer-surface-chrome, [class*="_ComposerLayoutRoot_"], [data-composer-surface-variant][data-composer-radius-variant])',
        '[contenteditable="true"]',
      ],
    },
    {
      name: 'header',
      selectors: [
        'header:is(.app-header-tint, [data-app-shell-header-edge-scroll], [class*="_Header_"])',
        'header',
      ],
    },
    {
      name: 'sidebar-item',
      selectors: ['button.sidebar-item'],
    },
  ],
};

export default codexLandmarks;
