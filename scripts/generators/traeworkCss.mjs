// SPDX-License-Identifier: MPL-2.0

import { nativeDefectFixCss } from '../native-defect-fixes.mjs';
import { alpha, artLayerCss, shade, sharedChromeRules, tokenBlock } from '../theme-utils.mjs';

function traeworkCss(t) {
  const c = t.colors;
  const host = 'html.agentskin-host-traework';
  const mutedFg = c.muted;
  const disabledFg = alpha(c.foreground, 0.42);
  const lineColor = alpha(c.accent, 0.18);
  const lineHeavy = alpha(c.accent, 0.32);
  const hoverBg = alpha(c.accent, 0.12);
  const hoverBg2 = alpha(c.accent, 0.18);

  return `/* ${t.name} — TRAE Work CN (solo-lite shell)
   Strategy: override --vscode-* / --vscode-icube-* design tokens (the app
   declares them on plain \`body\` selectors; our host-scoped body rule at
   specificity (0,1,2) always outranks them), then layer hero art + structural
   touches on stable solo-lite landmarks. */
${tokenBlock(t)}

/* ---- design token override (global restyle via app's own variable system) ---- */
${host} body {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;

  /* Ink / text */
  --vscode-foreground: ${c.foreground} !important;
  --vscode-icube-colorDefaultText: ${c.foreground} !important;
  --vscode-icube--text-text-default: ${c.foreground} !important;
  --vscode-icube-colorHighlightText: ${c.foreground} !important;
  --vscode-descriptionForeground: ${mutedFg} !important;
  --vscode-icube-colorGrayText: ${mutedFg} !important;
  --vscode-icube-colorDisableText: ${disabledFg} !important;

  /* Brand / links / buttons */
  --vscode-textLink-foreground: ${c.accent} !important;
  --vscode-textLink-activeForeground: ${c.secondary} !important;
  --vscode-button-background: ${c.accent} !important;
  --vscode-button-foreground: ${t.isLight ? '#ffffff' : shade(c.background, 'black', 0.85)} !important;
  --vscode-button-hoverBackground: ${alpha(c.accent, 0.85)} !important;
  --vscode-icube-colorBrand: ${c.accent} !important;
  --vscode-focusBorder: ${alpha(c.accent, 0.6)} !important;

  /* Lines / borders */
  --vscode-icube-colorLine1: ${lineColor} !important;
  --vscode-icube-colorLine2: ${lineHeavy} !important;
  --vscode-icube--border-border-neutral-l1: ${lineColor} !important;
  --vscode-chat-requestBorder: ${alpha(c.accent, 0.25)} !important;
  --vscode-widget-border: ${lineColor} !important;
  --vscode-panel-border: ${lineColor} !important;

  /* Fills / hovers */
  --vscode-toolbar-hoverBackground: ${hoverBg} !important;
  --vscode-icube-colorBtnHover: ${hoverBg} !important;
  --vscode-icube-colorBtnHover2: ${hoverBg2} !important;
  --vscode-list-hoverBackground: ${hoverBg} !important;
  --vscode-list-activeSelectionBackground: ${hoverBg2} !important;
  --vscode-icube--bg-bg-overlay-l2: ${hoverBg} !important;
  --vscode-icube--bg-bg-overlay-l3: ${hoverBg2} !important;
  --vscode-input-background: ${alpha(c.accent, 0.07)} !important;

  /* Surfaces */
  --vscode-editor-background: ${c.background} !important;
  --vscode-icube-colorBg1: ${c.background} !important;
  --vscode-icube-colorBg2: ${c.surface} !important;
  --vscode-icube-colorBg3: ${c.surfaceElevated} !important;
  --vscode-editorWidget-background: ${c.surface} !important;
  --vscode-sideBar-background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  --vscode-widget-shadow: ${alpha(c.accent, 0.15)} !important;
  --vscode-badge-background: ${alpha(c.accent, 0.65)} !important;
  --vscode-badge-foreground: ${t.isLight ? '#ffffff' : c.foreground} !important;
  --vscode-scrollbarSlider-background: ${alpha(c.accent, 0.22)} !important;
  --vscode-scrollbarSlider-hoverBackground: ${alpha(c.accent, 0.38)} !important;
  --vscode-scrollbarSlider-activeBackground: ${alpha(c.accent, 0.52)} !important;

  /* App-level surface variables → transparent for art punch-through */
  --bg-bg-base-default: transparent !important;

  /* Selection (camelCase is the real token; kebab is dead — 0 refs in app source) */
  --vscode-editor-selectionBackground: ${alpha(c.accent, 0.18)} !important;

  /* ===== icube blind-spot completion (2026-08-19) =====
     GitLab对标 l77948032-cyber/Trae-Skin: 41/50 blind-spot tokens verified live
     on 58510 (icube text/bg/icon/invert + menu/dropdown/checkbox/input). */
  /* Input */
  --vscode-input-foreground: ${c.foreground} !important;
  --vscode-input-placeholderForeground: ${alpha(c.foreground, 0.48)} !important;
  --vscode-disabledForeground: ${alpha(c.foreground, 0.42)} !important;

  /* icube text system */
  --vscode-icube-colorTextDefault: ${c.foreground} !important;
  --vscode-icube-colorTextGray: ${c.muted} !important;
  --vscode-icube--text-text-secondary: ${c.muted} !important;
  --vscode-icube--text-text-brand: ${c.accent} !important;
  --vscode-icube--text-text-default-hover: ${c.foreground} !important;
  --vscode-icube--text-text-default-active: ${c.foreground} !important;
  --vscode-icube--text-text-tertiary: ${alpha(c.muted, 0.7)} !important;
  --vscode-icube--text-text-disabled: ${alpha(c.foreground, 0.42)} !important;
  --vscode-icube--text-text-onaccent: ${c.background} !important;

  /* icube backgrounds */
  --vscode-icube--bg-bg-base-default: transparent !important;
  --vscode-icube--bg-bg-base-secondary: color-mix(in srgb, ${c.surface} 88%, transparent) !important;
  --vscode-icube--bg-bg-base-tertiary: color-mix(in srgb, ${c.surfaceElevated} 85%, transparent) !important;
  --vscode-icube--bg-bg-menu: color-mix(in srgb, ${c.surfaceElevated} 92%, transparent) !important;
  --vscode-icube--bg-bg-tooltip: color-mix(in srgb, ${c.surfaceElevated} 94%, transparent) !important;
  --vscode-icube--bg-bg-overlay-l4: color-mix(in srgb, ${c.surface} 78%, transparent) !important;
  --vscode-icube--bg-bg-invert: ${c.surfaceElevated} !important;
  --vscode-icube--bg-bg-invert-hover: ${alpha(c.accent, 0.12)} !important;
  --vscode-icube--bg-bg-invert-active: ${alpha(c.accent, 0.18)} !important;
  --vscode-icube--bg-bg-invert-disabled: ${alpha(c.foreground, 0.04)} !important;

  /* icube icons */
  --vscode-icube--icon-icon-default: ${c.foreground} !important;
  --vscode-icube--icon-icon-default-hover: ${c.accent} !important;
  --vscode-icube--icon-icon-secondary: ${c.muted} !important;
  --vscode-icube--icon-icon-tertiary: ${alpha(c.muted, 0.7)} !important;
  --vscode-icube--icon-icon-disabled: ${alpha(c.foreground, 0.42)} !important;
  --vscode-icube--icon-icon-onaccent: ${c.background} !important;

  /* icube borders */
  --vscode-icube--border-border-neutral-l2: ${alpha(c.accent, 0.24)} !important;
  --vscode-icube--border-border-neutral-l3: ${alpha(c.accent, 0.32)} !important;

  /* Menu / dropdown / checkbox / list (VS Code workbench chrome) */
  --vscode-menu-background: color-mix(in srgb, ${c.surfaceElevated} 92%, transparent) !important;
  --vscode-menu-foreground: ${c.foreground} !important;
  --vscode-menu-border: ${alpha(c.accent, 0.18)} !important;
  --vscode-menu-separatorBackground: ${alpha(c.accent, 0.1)} !important;
  --vscode-dropdown-background: color-mix(in srgb, ${c.surfaceElevated} 94%, transparent) !important;
  --vscode-dropdown-foreground: ${c.foreground} !important;
  --vscode-dropdown-border: ${alpha(c.accent, 0.18)} !important;
  --vscode-checkbox-background: color-mix(in srgb, ${c.surfaceElevated} 90%, transparent) !important;
  --vscode-checkbox-foreground: ${c.foreground} !important;
  --vscode-checkbox-border: ${alpha(c.accent, 0.24)} !important;
  --vscode-list-activeSelectionForeground: ${c.foreground} !important;

  /* ===== Bare-prefix mirror (2026-08-19) =====
     Same families exist bare (--bg-bg-*/--text-text-*/--icon-icon-*),
     verified 25/25 native on 58510. Mirror icube mappings 1:1. */
  --bg-bg-base-tertiary: color-mix(in srgb, ${c.surfaceElevated} 85%, transparent) !important;
  --bg-bg-menu: color-mix(in srgb, ${c.surfaceElevated} 92%, transparent) !important;
  --bg-bg-tooltip: color-mix(in srgb, ${c.surfaceElevated} 94%, transparent) !important;
  --bg-bg-overlay-l3: color-mix(in srgb, ${c.surface} 78%, transparent) !important;
  --bg-bg-overlay-l4: color-mix(in srgb, ${c.surface} 82%, transparent) !important;
  --bg-bg-brand: ${c.accent} !important;
  --bg-bg-brand-hover: color-mix(in srgb, ${c.accent} 88%, white) !important;
  --bg-bg-brand-active: color-mix(in srgb, ${c.accent} 76%, black) !important;
  --bg-bg-brand-disabled: ${alpha(c.accent, 0.35)} !important;
  --bg-bg-invert: ${c.surfaceElevated} !important;
  --bg-bg-invert-hover: ${alpha(c.accent, 0.12)} !important;
  --bg-bg-invert-active: ${alpha(c.accent, 0.18)} !important;
  --bg-bg-invert-disabled: ${alpha(c.foreground, 0.04)} !important;

  --text-text-default: ${c.foreground} !important;
  --text-text-secondary: ${c.muted} !important;
  --text-text-tertiary: ${alpha(c.muted, 0.7)} !important;
  --text-text-default-hover: ${c.foreground} !important;
  --text-text-default-active: ${c.foreground} !important;
  --text-text-brand: ${c.accent} !important;

  --icon-icon-default: ${c.foreground} !important;
  --icon-icon-secondary: ${c.muted} !important;
  --icon-icon-tertiary: ${alpha(c.muted, 0.7)} !important;
  --icon-icon-default-hover: ${c.accent} !important;
  --icon-icon-onaccent: ${c.background} !important;
  --icon-icon-disabled: ${alpha(c.foreground, 0.42)} !important;

  background: transparent !important;
  color: var(--agentskin-text) !important;
}

/* VS Code shell re-declares tokens on .monaco-workbench — override there too */
${host} .monaco-workbench {
  --vscode-sideBar-background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  --vscode-editor-background: transparent !important;
  --vscode-panel-background: transparent !important;
  --vscode-activityBar-background: color-mix(in srgb, var(--agentskin-surface) 12%, transparent) !important;
  --vscode-statusBar-background: color-mix(in srgb, var(--agentskin-surface) 10%, transparent) !important;
  --vscode-titleBar-activeBackground: color-mix(in srgb, var(--agentskin-surface) 8%, transparent) !important;
  --vscode-titleBar-inactiveBackground: color-mix(in srgb, var(--agentskin-surface) 6%, transparent) !important;
  background: transparent !important;
}

/* ---- hero art on #root — palette-driven wash, hero visible right side ---- */
${artLayerCss(host, t)}

/* ---- route surfaces + inner containers transparent for art punch-through ---- */
${host} .panel-container,
${host} .solo-lite-layout,
${host} .solo-lite-chat-panel-container,
${host} [class*="chat-panel"],
${host} [class*="message-list"],
${host} [class*="conversation"],
${host} [class*="main-content"],
${host} [class*="workspace"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--agentskin-text) !important;
}

/* ---- sidebar (frosted glass over art) ---- */
${host} .task-list-base,
${host} .task-list-panel {
  background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  border-right: none !important;
  color: var(--agentskin-text) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}

${host} .task-list-base [class*="item"]:hover,
${host} .task-list-panel [class*="item"]:hover {
  background: ${hoverBg} !important;
}

${host} .task-list-base [class*="active"],
${host} .task-list-panel [class*="active"] {
  background: ${hoverBg2} !important;
  box-shadow: inset 3px 0 0 0 var(--agentskin-accent), inset 0 0 0 1px ${alpha(c.accent, 0.32)} !important;
}

/* ---- composer ---- */
${host} .chat-input-v2-input-box-editable {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent) !important;
  backdrop-filter: blur(14px) saturate(1.1) !important;
  color: var(--agentskin-text) !important;
  caret-color: var(--agentskin-accent) !important;
  border: 1px solid ${alpha(c.accent, 0.25)} !important;
  border-radius: 14px !important;
  box-shadow: none !important;
  transition: border-color 160ms ease, box-shadow 160ms ease !important;
}

${host} .chat-input-v2-input-box-editable:focus,
${host} .chat-input-v2-input-box-editable:focus-within {
  border-color: ${alpha(c.accent, 0.5)} !important;
  box-shadow: 0 0 0 2px ${alpha(c.accent, 0.1)}, 0 4px 18px ${alpha(c.secondary, 0.12)} !important;
}

${host} [class*="chat-input-v2"] [class*="placeholder"] {
  color: var(--agentskin-muted) !important;
}

/* Input outer container: frosted glass instead of opaque bg-base */
${host} [class*="chat-input-primary-glow"] {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 40%, transparent) !important;
  backdrop-filter: blur(14px) saturate(1.1) !important;
  border: 1px solid ${alpha(c.accent, 0.2)} !important;
  box-shadow: none !important;
}

${host} [class*="chat-input-primary-glow"]:focus-within {
  border-color: ${alpha(c.accent, 0.45)} !important;
  box-shadow: 0 0 0 2px ${alpha(c.accent, 0.08)}, 0 4px 16px ${alpha(c.secondary, 0.1)} !important;
}

/* ---- buttons ---- */
${host} button[class*="primary"],
${host} button[class*="send"] {
  background: linear-gradient(135deg, var(--agentskin-accent) 0%, color-mix(in srgb, var(--agentskin-accent) 62%, var(--agentskin-secondary) 38%) 100%) !important;
  color: ${t.isLight ? '#ffffff' : shade(c.background, 'black', 0.85)} !important;
  border: none !important;
  box-shadow: 0 2px 10px var(--agentskin-focus-ring) !important;
  transition: filter 160ms ease, transform 160ms ease, box-shadow 160ms ease !important;
}

${host} button[class*="primary"]:hover,
${host} button[class*="send"]:hover {
  filter: brightness(1.07) !important;
  transform: translateY(-1px) !important;
}

/* ---- message text ---- */
${host} [class*="message"],
${host} article {
  color: var(--agentskin-text);
}

/* ---- native hardcoded visual defects (single source: ../native-defect-fixes.mjs) ---- */
${nativeDefectFixCss('traework', host)}

/* ---- contrast fix: avatar badges with hardcoded light bg ---- */
${host} [class*="agent-avatar"],
${host} [class*="avatar"] {
  background: var(--agentskin-surface) !important;
  color: var(--agentskin-text) !important;
  border-color: var(--agentskin-border) !important;
}

/* ---- "files changed" cards in chat: always transparent (no flicker) ----
   These cards use --vscode-editorWidget-background (opaque surface) normally,
   but native :hover sets background to transparent, causing a visual flicker.
   Make both normal and hover states transparent so the art punches through. */
${host} [class*="file-change"],
${host} [class*="fileChange"],
${host} [class*="changed-file"],
${host} [class*="changedFile"],
${host} [class*="file-card"],
${host} [class*="fileCard"],
${host} [class*="file-tree"],
${host} [class*="fileTree"],
${host} [class*="edit-card"],
${host} [class*="editCard"],
${host} [class*="edit-result"],
${host} [class*="editResult"],
${host} [class*="apply-result"],
${host} [class*="applyResult"],
${host} [class*="modified-file"],
${host} [class*="modifiedFile"],
${host} [class*="change-summary"],
${host} [class*="changeSummary"],
${host} [class*="tool-result"],
${host} [class*="toolResult"],
${host} [class*="result-card"],
${host} [class*="resultCard"],
${host} [class*="chat-file"],
${host} [class*="chatFile"] {
  background: transparent !important;
  background-color: transparent !important;
  border-color: ${alpha(c.accent, 0.15)} !important;
}
${host} [class*="file-change"]:hover,
${host} [class*="fileChange"]:hover,
${host} [class*="changed-file"]:hover,
${host} [class*="changedFile"]:hover,
${host} [class*="file-card"]:hover,
${host} [class*="fileCard"]:hover,
${host} [class*="file-tree"]:hover,
${host} [class*="fileTree"]:hover,
${host} [class*="edit-card"]:hover,
${host} [class*="editCard"]:hover,
${host} [class*="edit-result"]:hover,
${host} [class*="editResult"]:hover,
${host} [class*="apply-result"]:hover,
${host} [class*="applyResult"]:hover,
${host} [class*="modified-file"]:hover,
${host} [class*="modifiedFile"]:hover,
${host} [class*="change-summary"]:hover,
${host} [class*="changeSummary"]:hover,
${host} [class*="tool-result"]:hover,
${host} [class*="toolResult"]:hover,
${host} [class*="result-card"]:hover,
${host} [class*="resultCard"]:hover,
${host} [class*="chat-file"]:hover,
${host} [class*="chatFile"]:hover {
  background: transparent !important;
  background-color: transparent !important;
}

/* ---- contrast fix: markdown file links must use theme accent ---- */
${host} .markdown-file-link,
${host} [class*="file-link"],
${host} a[class*="link"] {
  color: var(--agentskin-accent) !important;
}
${host} .markdown-file-link:hover,
${host} [class*="file-link"]:hover,
${host} a[class*="link"]:hover {
  color: var(--agentskin-secondary) !important;
}

/* ---- contrast fix: mode switcher / tab buttons ---- */
${host} [class*="mode-switcher"] [class*="btn"],
${host} [class*="tab-item"],
${host} [class*="segmented"] [class*="item"] {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
${host} [class*="mode-switcher"] [class*="active"],
${host} [class*="tab-item"][class*="active"],
${host} [class*="segmented"] [class*="active"] {
  color: var(--agentskin-accent) !important;
  background: ${hoverBg} !important;
}
${sharedChromeRules(host, t)}
`;
}

export default traeworkCss;
