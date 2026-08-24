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
${shellStructureCss(host, t, 'codex')}
${sharedChromeRules(host, t)}

/* ===== Codex component-level interaction layering =====
   Codex sidebar rows are <button class="sidebar-item">; the active thread is
   flagged with data-app-action-sidebar-thread-selected="true" (Tailwind data-*
   variant), NOT [aria-current] / [class*=active]. PROBE-VERIFIED 2026-08-23:
   - sidebar items: button.sidebar-item (exact class; do NOT use [class*="item"])
   - active thread: [data-app-action-sidebar-thread-selected="true"]
   - active thread row: [data-app-action-sidebar-thread-active="true"]
   - project rows: [data-app-action-sidebar-project-id] (exact, not [class*=active])
   Give hover + selected an accent-tinted lift so the sidebar reads before/after
   instead of blending into the frosted base. Scoped to .sidebar-item and the
   verified data-app-action-* state attributes ONLY — no broad descendants. */
${host} button.sidebar-item {
  transition: background-color 120ms ease !important;
}
${host} button.sidebar-item:hover,
${host} [data-app-action-sidebar-project-id]:hover {
  background: ${hoverBg} !important;
}
${host} button.sidebar-item[data-app-action-sidebar-thread-selected="true"],
${host} [data-app-action-sidebar-thread-selected="true"],
${host} [data-app-action-sidebar-thread-active="true"],
${host} button.sidebar-item[data-app-action-sidebar-project-collapsed="false"] {
  background: ${activeBg} !important;
  box-shadow: inset 3px 0 0 0 var(--agentskin-accent) !important;
}

/* Composer focus: keep frosted but leaner so focus reads without a solid fill */
${host} [contenteditable="true"]:focus,
${host} [contenteditable="true"]:focus-within {
  background: ${focusInputBg} !important;
}

/* ===== Top toolbar (header) — frosted glass over art =====
   PROBE-VERIFIED 2026-08-23 (live codex): the fixed top toolbar is
   header.pointer-events-none.fixed.z-30 (46px tall, spans the main column).
   It inherits an opaque --color-token-bg-primary fill that blocks the
   #root::before art layer. Give it the frosted-glass treatment instead —
   scoped to the exact header role classes, not a broad header selector. */
${host} header.pointer-events-none.fixed {
  background: color-mix(in srgb, var(--agentskin-surface) 45%, transparent) !important;
  backdrop-filter: blur(20px) saturate(1.12) !important;
  border-bottom: 1px solid color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
}

/* ---- native hardcoded visual defects (single source: ../native-defect-fixes.mjs) ----
   Codex 没有独立的清除类缺陷规则（原生缺陷已由 token 覆盖 + 组件着色块消解）；
   注册表为空。今后若发现新缺陷，加入共享模块后即自动带上。 */
${nativeDefectFixCss('codex', host)}
`;
}

export default codexCss;
