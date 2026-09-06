// SPDX-License-Identifier: MPL-2.0

/**
 * # zcode landmarks — stable DOM anchors for ZCode.
 *
 * PROBE-VERIFIED selectors from the CSS generators and THEME_SPEC.md.
 * ZCode is a Codex-derived shell with a `--color-*` Tailwind v4 native token
 * system. Shares many structural patterns with Codex but uses its own
 * data-attribute-based sidebar panel.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const zcodeLandmarks = {
  required: [
    {
      name: 'host-root',
      selectors: ['html.agentskin-host-zcode'],
    },
  ],
  recommended: [
    {
      name: 'sidebar',
      selectors: ['[data-workspace-sidebar-panel="true"]', 'aside'],
    },
    {
      name: 'composer',
      selectors: ['[contenteditable="true"]', 'textarea'],
    },
    {
      name: 'sidebar-item',
      selectors: ['[data-slot="button"]'],
    },
    {
      name: 'header',
      selectors: ['header'],
    },
  ],
};

export default zcodeLandmarks;
