// SPDX-License-Identifier: MPL-2.0

import { nativeDefectFixCss } from '../native-defect-fixes.mjs';
import {
  codexColorTokenOverrides,
  sharedChromeRules,
  shellStructureCss,
  tokenBlock,
} from '../theme-utils.mjs';

function codexCss(t) {
  const host = ':root.agentskin-host-codex';
  const hoverBg = `color-mix(in srgb, var(--agentskin-accent) 10%, transparent)`;
  const activeBg = `color-mix(in srgb, var(--agentskin-accent) 16%, transparent)`;
  const focusInputBg = `color-mix(in srgb, var(--agentskin-input-bg) 82%, var(--agentskin-accent) 18%)`;
  return `/* ${t.name} — OpenAI Codex (--color-token-* design tokens) */
${tokenBlock(t, host, t.variableBridge)}

/* ===== Native token overrides (Codex --color-token-* system) ===== */
${codexColorTokenOverrides(host, t)}
${shellStructureCss(host, t)}
${sharedChromeRules(host, t)}

/* ===== Codex component-level interaction layering =====
   Codex sidebar rows are <button class="sidebar-item">; the active thread is
   flagged with the data-app-action-sidebar-thread-selected attribute (Tailwind
   data-* variant), NOT [aria-current] / [class*=active]. Give hover + selected
   an accent-tinted lift so the sidebar reads before/after instead of blending
   into the frosted base — restores hover/selected interaction-state feedback.
   Colors stay alpha-based so the frosted/backdrop-filter surfaces are preserved. */
${host} button.sidebar-item,
${host} [class*="sidebar"] button,
${host} nav button,
${host} aside button {
  transition: background-color 120ms ease !important;
}
${host} button.sidebar-item:hover,
${host} [class*="sidebar"] button:hover,
${host} nav button:hover,
${host} aside button:hover {
  background: ${hoverBg} !important;
}
${host} button.sidebar-item[data-app-action-sidebar-thread-selected],
${host} [data-app-action-sidebar-thread-selected],
${host} nav button[data-state="active"],
${host} [class*="sidebar"] button[data-state="active"],
${host} aside [class*="active"] {
  background: ${activeBg} !important;
  box-shadow: inset 3px 0 0 0 var(--agentskin-accent) !important;
}

/* Composer focus: keep frosted but leaner so focus reads without a solid fill */
${host} [contenteditable="true"]:focus,
${host} [contenteditable="true"]:focus-within {
  background: ${focusInputBg} !important;
}

/* ---- native hardcoded visual defects (single source: ../native-defect-fixes.mjs) ----
   Codex 没有独立的清除类缺陷规则（原生缺陷已由 token 覆盖 + 组件着色块消解）；
   注册表为空。今后若发现新缺陷，加入共享模块后即自动带上。 */
${nativeDefectFixCss('codex', host)}
`;
}

export default codexCss;
