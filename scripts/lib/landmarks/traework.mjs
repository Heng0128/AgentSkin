// SPDX-License-Identifier: MPL-2.0

/**
 * # traework landmarks — stable DOM anchors for TRAE Work.
 *
 * These landmarks are derived from PROBE-VERIFIED selectors in the CSS
 * generators and THEME_SPEC.md. They represent the structural nodes that
 * themes rely on for TRAE Work's solo-lite shell.
 *
 * Each landmark exports `{ required, recommended }` where:
 *   - `required`:    must be present for any theme to render correctly.
 *   - `recommended`: optional; themes may enhance these if present.
 */

/** @type {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] }} */
export const traeworkLandmarks = {
  required: [
    {
      name: 'solo-shell',
      // 2026-09-08 probe: .solo-lite-layout 零命中（anchors 注册表 2026-08-23 亦判死）；
      // 承载为 .panel-container + .solo-lite。
      selectors: ['.panel-container', '.solo-lite'],
    },
    {
      name: 'host-root',
      selectors: ['html.agentskin-host-traework', 'body'],
    },
  ],
  recommended: [
    {
      name: 'task-sidebar',
      selectors: ['.task-list-base', '.task-list-panel'],
    },
    {
      name: 'composer',
      selectors: [
        ".chat-input-v2-input-box-editable[contenteditable='true']",
        '[contenteditable="true"]',
      ],
    },
    {
      name: 'panel-content',
      // 2026-09-08 probe: .solo-lite-panel-container 零命中（注册表同判 dead）。
      selectors: ['.panel-content'],
    },
  ],
};

export default traeworkLandmarks;
