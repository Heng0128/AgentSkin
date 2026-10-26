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
      // 2026-09-08 probe: aside 零命中（ZCode 不用原生 aside 标签）；承载为实证 data-* 锚。
      selectors: ['[data-workspace-sidebar-panel="true"]'],
    },
    {
      name: 'composer',
      // 2026-09-08 probe: 聊天窗 textarea 零命中（输入为 contenteditable）。
      selectors: ['[contenteditable="true"]'],
    },
    {
      name: 'sidebar-item',
      // 未再验证（2026-09-08 探针该组零命中）——保留观察一个版本周期。
      selectors: ['[data-slot="button"]'],
    },
    {
      name: 'header',
      // 2026-09-08 probe: 原生 header 零命中（anchors 注册表 header 角色同报 DRIFT）。
      // 不臆造替代名；待编辑器窗/新视图复验后回填实证锚点。
      selectors: ['header'],
    },
  ],
};

export default zcodeLandmarks;
