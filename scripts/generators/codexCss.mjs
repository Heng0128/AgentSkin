// SPDX-License-Identifier: MPL-2.0
import {
  sharedChromeRules,
  shellStructureCss,
  shellTokenOverrides,
  tokenBlock,
} from '../theme-utils.mjs';

function codexCss(t) {
  const host = 'html.agentskin-host-codex';
  const c = t.colors;
  const hoverBg = `color-mix(in srgb, var(--agentskin-accent) 10%, transparent)`;
  const activeBg = `color-mix(in srgb, var(--agentskin-accent) 16%, transparent)`;
  const focusInputBg = `color-mix(in srgb, var(--agentskin-input-bg) 82%, var(--agentskin-accent) 18%)`;
  return `/* ${t.name} — OpenAI Codex (--text-*/--bg-* design tokens) */
${tokenBlock(t, host)}

/* ===== Native token overrides ===== */
${shellTokenOverrides(host, t)}
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
}`;
}

export default codexCss;
