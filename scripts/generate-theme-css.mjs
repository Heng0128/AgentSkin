// SPDX-License-Identifier: MPL-2.0
//
// # generate-theme-css.mjs
//
// Regenerates the per-agent CSS files (assets/css/{traework,qoderwork,workbuddy,doubao}.css)
// for every built-in theme under themes/<id>/ from the manifest colors.
//
// The selectors are based on the DOM landmarks verified by @codedrobe/core's
// adapters (v0.6.0):
//
//   - traework  → TRAE SOLO "solo-lite" React shell (NOT the Monaco workbench):
//                 .panel-container (home route), .solo-lite-layout (conversation
//                 route), .task-list-base / .task-list-panel (sidebar),
//                 .chat-input-v2-input-box-editable (composer).
//   - qoderwork → QoderWork agents layout: .agents-layout-root, .agents-sidebar,
//                 [data-resizable-sidebar], .agents-content-area,
//                 .agents-layout-body, .chat-input-editor-text (composer).
//   - workbuddy → WorkBuddy --cb-* design-variable system on
//                 body[data-application-name=workbuddy], #root background layer,
//                 [data-view-id] panels, .teams-container transparency.
//   - doubao    → 豆包 --dbx-* design-token system (251 tokens) on
//                 :root[data-theme], body background layer, chrome://doubao-chat.
//
// Hero artwork is NOT embedded in the CSS. The engine converts the bundle's
// assets.images.hero into an object URL and exposes it as --codedrobe-art on
// <html>, so the CSS references var(--codedrobe-art, none).
//
// Usage:  node scripts/generate-theme-css.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function parseColor(input) {
  const raw = String(input ?? '').trim();
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
      a: m[2] ? parseInt(m[2], 16) / 255 : 1,
    };
  }
  m = /^#([0-9a-f]{3})$/i.exec(raw);
  if (m) {
    return {
      r: parseInt(m[1][0] + m[1][0], 16),
      g: parseInt(m[1][1] + m[1][1], 16),
      b: parseInt(m[1][2] + m[1][2], 16),
      a: 1,
    };
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(raw);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  }
  throw new Error(`Unsupported color value: ${input}`);
}

/** rgba() string from any supported color notation, overriding alpha. */
function alpha(input, a) {
  const c = parseColor(input);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number((c.a * a).toFixed(3))})`;
}

/** Pre-mixed rgb string: mix(color, white|black, amount) for subtle tints. */
function shade(input, target, a) {
  const c = parseColor(input);
  const t = target === 'white' ? 255 : 0;
  const mix = (v) => Math.round(v + (t - v) * a);
  return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`;
}

/** Raw "R, G, B" string for Doubao's -raw variable pattern. */
function rawRgb(input) {
  const c = parseColor(input);
  return `${c.r}, ${c.g}, ${c.b}`;
}

// ---------------------------------------------------------------------------
// Per-theme art overlay parameters (derived from color characteristics)
// ---------------------------------------------------------------------------

/** Relative luminance (0–1) from a parsed color. */
function luminance(input) {
  const c = parseColor(input);
  const [rs, gs, bs] = [c.r / 255, c.g / 255, c.b / 255].map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** HSL saturation (0–1) from a parsed color. */
function saturation(input) {
  const c = parseColor(input);
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/**
 * Compute per-theme art overlay parameters.
 * - Dark themes with very dark bg → less wash (hero blends naturally)
 * - Light themes → more wash (protect readability)
 * - High accent saturation → stronger radial glow
 * - Secondary used for glow when it contrasts with accent hue
 */
function computeArtParams(t) {
  const c = t.colors;
  const bgLum = luminance(c.background);
  const accentSat = saturation(c.accent);

  // Wash opacity: left-side (strongest) and bottom fade.
  // Kept deliberately low so the hero art stays visible and the color
  // overlay feels like a tint rather than a solid block.
  let washLeft, washMid, washBottom;
  if (t.isLight) {
    washLeft = 42; washMid = 14; washBottom = 38;
  } else if (bgLum < 0.012) {
    // Very dark bg (arina, gothic, midnight-aurora): hero dominates
    washLeft = 26; washMid = 8; washBottom = 20;
  } else if (bgLum < 0.03) {
    // Dark colored bg (naruto, sasuke, wuthering, deepspace-star): light wash
    washLeft = 32; washMid = 12; washBottom = 26;
  } else {
    // Moderate dark bg
    washLeft = 38; washMid = 14; washBottom = 32;
  }

  // Radial glow strength: pushed higher for strong visual impact
  const glowStrength = t.isLight
    ? Math.round(14 + accentSat * 12)   // 14–26% for light
    : Math.round(16 + accentSat * 20);  // 16–36% for dark

  // Glow color: use secondary if it has different hue from accent (contrast)
  const glowColor = saturation(c.secondary) > 0.3 && c.secondary !== c.accent
    ? 'var(--agentskin-secondary)'
    : 'var(--agentskin-accent)';

  return { washLeft, washMid, washBottom, glowStrength, glowColor };
}

/** Generate the shared art-layer CSS block for a given host selector.
 *  Uses #root::before with position:fixed instead of background-attachment:fixed
 *  to avoid duplication when child elements have CSS transform (new containing block). */
function artLayerCss(host, t) {
  const p = computeArtParams(t);
  return `${host} #root {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
${host} #root::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--agentskin-surface) ${p.washLeft}%, transparent) 0 16%,
      color-mix(in srgb, var(--agentskin-surface) ${p.washMid}%, transparent) 44%,
      transparent 70%),
    linear-gradient(180deg, transparent 0 50%,
      color-mix(in srgb, var(--agentskin-surface) ${p.washBottom}%, transparent) 86% 100%),
    radial-gradient(120% 80% at 84% 14%,
      color-mix(in srgb, ${p.glowColor} ${p.glowStrength}%, transparent), transparent 60%),
    var(--codedrobe-art, none) right center / cover no-repeat !important;
}`;
}

// ---------------------------------------------------------------------------
// Shared token block (parsed by theme-library extractColors / detectMode)
// ---------------------------------------------------------------------------

function tokenBlock(t) {
  const c = t.colors;
  return `:root {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;
  --agentskin-accent: ${c.accent};
  --agentskin-secondary: ${c.secondary};
  --agentskin-bg: ${c.background};
  --agentskin-surface: ${c.surface};
  --agentskin-surface-elevated: ${c.surfaceElevated};
  --agentskin-text: ${c.foreground};
  --agentskin-muted: ${c.muted};
  --agentskin-border: ${c.border};
  --agentskin-code-bg: ${c.codeBackground};
  --agentskin-code-fg: ${c.codeForeground};
  --agentskin-input-bg: color-mix(in srgb, color-mix(in srgb, ${c.surface} 82%, ${c.accent} 18%) 45%, transparent);
  --agentskin-button-bg: ${c.accent};
  --agentskin-focus-ring: ${c.focusRing};
  --agentskin-selection: ${alpha(c.accent, 0.32)};
  --agentskin-text-shadow: ${t.isLight ? '0 1px 2px rgba(255,255,255,0.6)' : '0 1px 3px rgba(0,0,0,0.5)'};
  text-shadow: var(--agentskin-text-shadow);
}`;
}

/** Scoped generic rules shared by the two shell-style agents. */
function sharedChromeRules(host, t) {
  const c = t.colors;
  const textShadow = t.isLight
    ? '0 1px 2px rgba(255,255,255,0.6)'
    : '0 1px 3px rgba(0,0,0,0.5)';
  return `
/* Text readability on frosted glass */
${host} body {
  text-shadow: ${textShadow} !important;
}

${host} input,
${host} textarea,
${host} [contenteditable="true"] {
  text-shadow: ${textShadow} !important;
}

/* Links */
${host} a {
  color: var(--agentskin-accent) !important;
}

/* Selection */
${host} ::selection {
  background: var(--agentskin-selection) !important;
}

/* Generic inputs */
${host} input,
${host} textarea,
${host} select {
  background: var(--agentskin-input-bg) !important;
  color: var(--agentskin-text) !important;
  border-color: var(--agentskin-border) !important;
}

${host} input:focus,
${host} textarea:focus,
${host} select:focus {
  outline: none !important;
  border-color: var(--agentskin-accent) !important;
  box-shadow: 0 0 0 2px var(--agentskin-focus-ring) !important;
}

/* Inline code & code blocks */
${host} code {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid ${alpha(c.border, 0.6)} !important;
  border-radius: 6px !important;
}

${host} pre {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid ${alpha(c.border, 0.6)} !important;
  border-left: 3px solid ${alpha(c.accent, 0.5)} !important;
  border-radius: 10px !important;
}

${host} pre code {
  border: none !important;
}

/* Scrollbars */
${host} ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

${host} ::-webkit-scrollbar-track {
  background: transparent;
}

${host} ::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, ${alpha(c.accent, 0.3)} 0%, ${alpha(c.secondary, 0.3)} 100%) !important;
  border-radius: 8px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
}

${host} ::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, ${alpha(c.accent, 0.5)} 0%, ${alpha(c.secondary, 0.5)} 100%) !important;
  background-clip: padding-box !important;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  ${host} *,
  ${host} *::before,
  ${host} *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}`;
}

// ---------------------------------------------------------------------------
// TRAE Work CN (TRAE SOLO solo-lite shell)
// ---------------------------------------------------------------------------

function traeworkCss(t) {
  const c = t.colors;
  const host = 'html.codedrobe-host-traework';
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

  /* Selection */
  --vscode-editor-selectionBackground: ${alpha(c.accent, 0.18)} !important;
  --vscode-selection-background: ${alpha(c.accent, 0.24)} !important;

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

/* ---- message bubbles: kill native squared box-shadow on side bubbles ---- */
${host} [class*="message-bubble"],
${host} [class*="messageBubble"],
${host} [class*="msg-bubble"],
${host} [class*="chat-bubble"],
${host} [class*="bubble"],
${host} [class*="message-content"],
${host} [class*="msg-content"] {
  box-shadow: none !important;
  outline: none !important;
}

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

// ---------------------------------------------------------------------------
// QoderWork CN — native --color-* design-token override strategy
// Selector: html:root.codedrobe-host-qoderwork (0,2,1) > :root[data-theme] (0,2,0)
// ---------------------------------------------------------------------------

function qoderworkCss(t) {
  const c = t.colors;
  const host = 'html.codedrobe-host-qoderwork';

  // Derived palette from theme colors
  const accentHover = shade(c.accent, t.isLight ? 'black' : 'white', 0.15);
  const accentActive = shade(c.accent, t.isLight ? 'black' : 'white', 0.25);
  const accentBg = alpha(c.accent, t.isLight ? 0.08 : 0.12);
  const accentBgHover = alpha(c.accent, t.isLight ? 0.14 : 0.18);
  const accentBorder = alpha(c.accent, 0.35);
  const accentBorderHover = alpha(c.accent, 0.55);
  const textSecondary = c.muted;
  const textTertiary = alpha(c.foreground, 0.55);
  const textQuaternary = alpha(c.foreground, 0.4);
  const borderSecondary = alpha(c.border, 0.6);
  const borderTertiary = alpha(c.border, 0.35);
  const fillPrimary = alpha(c.foreground, t.isLight ? 0.12 : 0.16);
  const fillSecondary = alpha(c.foreground, t.isLight ? 0.07 : 0.1);
  const fillTertiary = alpha(c.foreground, t.isLight ? 0.04 : 0.06);
  const fillQuaternary = alpha(c.foreground, t.isLight ? 0.02 : 0.03);
  const bgContainer = c.background;
  const bgElevated = `color-mix(in srgb, ${c.surfaceElevated} 85%, ${c.accent} 15%)`;
  const bgLayout = t.isLight ? shade(c.background, 'white', 0.02) : shade(c.background, 'black', 0.04);
  const bgSpotlight = t.isLight ? shade(c.background, 'white', 0.04) : shade(c.background, 'black', 0.08);
  const shadowBase = t.isLight ? '0, 0, 0' : '0, 0, 0';
  const highlightBase = t.isLight ? '255, 255, 255' : '255, 255, 255';

  return `/* ${t.name} — QoderWork CN (--color-* design tokens) */
${tokenBlock(t)}

/* ===== Native token overrides (wins over :root[data-theme]) ===== */
${host}:root {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;

  /* Primary / brand */
  --color-primary: ${c.accent} !important;
  --color-primary-hover: ${accentHover} !important;
  --color-primary-active: ${accentActive} !important;
  --color-primary-bg: ${accentBg} !important;
  --color-primary-bg-hover: ${accentBgHover} !important;
  --color-primary-border: ${accentBorder} !important;
  --color-primary-border-hover: ${accentBorderHover} !important;
  --color-primary-text: ${c.foreground} !important;
  --color-primary-text-hover: ${accentHover} !important;
  --color-primary-text-active: ${accentActive} !important;
  --color-text-on-primary: ${t.isLight ? '#ffffff' : shade(c.background, 'black', 0.85)} !important;

  /* Text hierarchy */
  --color-text: ${c.foreground} !important;
  --color-text-secondary: ${textSecondary} !important;
  --color-text-tertiary: ${textTertiary} !important;
  --color-text-quaternary: ${textQuaternary} !important;
  --color-text-base: ${c.foreground} !important;
  --color-muted: ${c.muted} !important;
  --color-muted-foreground: ${alpha(c.muted, 0.8)} !important;

  /* Backgrounds */
  --color-bg-container: ${bgContainer} !important;
  --color-bg-elevated: ${bgElevated} !important;
  --color-bg-layout: ${bgLayout} !important;
  --color-bg-spotlight: ${bgSpotlight} !important;
  --color-bg-base: ${bgContainer} !important;
  --color-bg-mask: ${alpha(c.background, 0.6)} !important;
  --color-bg-highlight: ${alpha(c.accent, 0.06)} !important;
  --color-bg-highlight-hover: ${alpha(c.accent, 0.1)} !important;
  --color-background: var(--color-bg-container) !important;
  --color-popover: ${t.isLight ? '#000' : c.surfaceElevated} !important;
  --color-white-opacity: ${t.isLight ? '#000' : '#fff'} !important;
  --color-black-opacity: ${t.isLight ? '#fff' : '#000'} !important;

  /* Borders */
  --color-border: ${c.border} !important;
  --color-border-secondary: ${borderSecondary} !important;
  --color-border-tertiary: ${borderTertiary} !important;

  /* Fills */
  --color-fill: ${fillPrimary} !important;
  --color-fill-secondary: ${fillSecondary} !important;
  --color-fill-tertiary: ${fillTertiary} !important;
  --color-fill-quaternary: ${fillQuaternary} !important;
  --color-fill-disable: ${alpha(c.foreground, 0.08)} !important;

  /* Links */
  --color-link: ${c.accent} !important;

  /* Semantic: error */
  --color-error: #ff4d4f !important;
  --color-error-hover: #ff7875 !important;
  --color-error-bg: ${t.isLight ? '#fff2f0' : 'rgba(255, 77, 79, 0.12)'} !important;
  --color-error-bg-hover: ${t.isLight ? '#fff1f0' : 'rgba(255, 77, 79, 0.18)'} !important;
  --color-error-border: ${t.isLight ? '#ffccc7' : 'rgba(255, 77, 79, 0.35)'} !important;
  --color-error-border-hover: ${t.isLight ? '#ffa39e' : 'rgba(255, 77, 79, 0.55)'} !important;

  /* Semantic: info */
  --color-info: #0b83f1 !important;
  --color-info-hover: #5ebcff !important;
  --color-info-bg: ${t.isLight ? '#e6f7ff' : 'rgba(11, 131, 241, 0.12)'} !important;
  --color-info-bg-hover: ${t.isLight ? '#d0efff' : 'rgba(11, 131, 241, 0.18)'} !important;
  --color-info-border: ${t.isLight ? '#b0e3ff' : 'rgba(11, 131, 241, 0.35)'} !important;
  --color-info-border-hover: ${t.isLight ? '#87d1ff' : 'rgba(11, 131, 241, 0.55)'} !important;

  /* Semantic: success (tied to accent) */
  --color-success: ${c.accent} !important;
  --color-success-hover: ${accentHover} !important;
  --color-success-bg: ${accentBg} !important;
  --color-success-bg-hover: ${accentBgHover} !important;
  --color-success-border: ${accentBorder} !important;
  --color-success-border-hover: ${accentBorderHover} !important;

  /* Semantic: warning */
  --color-warning: #faad14 !important;
  --color-warning-hover: #ffd666 !important;
  --color-warning-bg: ${t.isLight ? '#fffbe6' : 'rgba(250, 173, 20, 0.12)'} !important;
  --color-warning-bg-hover: ${t.isLight ? '#fff1b8' : 'rgba(250, 173, 20, 0.18)'} !important;
  --color-warning-border: ${t.isLight ? '#ffe5bf' : 'rgba(250, 173, 20, 0.35)'} !important;
  --color-warning-border-hover: ${t.isLight ? '#ffd666' : 'rgba(250, 173, 20, 0.55)'} !important;

  /* Diff */
  --color-diff-insert: ${alpha(c.accent, 0.7)} !important;
  --color-diff-insert-bg: ${alpha(c.accent, 0.12)} !important;
  --color-diff-remove: #fc6b83 !important;
  --color-diff-remove-bg: ${t.isLight ? '#e3d1d5' : 'rgba(252, 107, 131, 0.12)'} !important;

  /* Accent palette (derived from theme secondary + accent) */
  --color-pink: ${c.secondary} !important;
  --color-pink-bg: ${alpha(c.secondary, 0.1)} !important;
  --color-pink-hover: ${shade(c.secondary, 'white', 0.2)} !important;
  --color-purple: ${shade(c.accent, 'black', 0.2)} !important;
  --color-purple-bg: ${alpha(c.accent, 0.08)} !important;
  --color-purple-hover: ${shade(c.accent, 'white', 0.2)} !important;
  --color-yellow: #fac414 !important;
  --color-yellow-bg: ${t.isLight ? '#fff3cf' : 'rgba(250, 196, 20, 0.1)'} !important;
  --color-yellow-hover: #f1d372 !important;
  --color-orange: #fa8125 !important;
  --color-orange-bg: ${t.isLight ? '#ffefde' : 'rgba(250, 129, 37, 0.1)'} !important;
  --color-orange-hover: #e88c45 !important;
  --color-teal: ${shade(c.accent, 'black', 0.1)} !important;
  --color-teal-bg: ${alpha(c.accent, 0.08)} !important;
  --color-teal-hover: ${shade(c.accent, 'white', 0.15)} !important;
  --color-blue: #0090ff !important;
  --color-blue-bg: ${t.isLight ? '#deedff' : 'rgba(0, 144, 255, 0.1)'} !important;
  --color-blue-hover: #72bcf5 !important;
  --color-mauve: ${alpha(c.muted, 0.7)} !important;
  --color-mauve-bg: ${alpha(c.muted, 0.06)} !important;
  --color-mauve-hover: ${alpha(c.muted, 0.4)} !important;
  --color-slate: ${t.isLight ? '#1e293b' : '#94a3b8'} !important;
  --color-slate-bg: ${t.isLight ? '#e2e8f0' : 'rgba(148, 163, 184, 0.1)'} !important;
  --color-slate-hover: ${t.isLight ? '#475569' : '#cbd5e1'} !important;
  --color-lavender: ${shade(c.secondary, 'white', 0.3)} !important;
  --color-lavender-bg: ${alpha(c.secondary, 0.08)} !important;
  --color-lavender-hover: ${shade(c.secondary, 'white', 0.5)} !important;
  --color-sage: ${shade(c.accent, 'black', 0.15)} !important;
  --color-sage-bg: ${alpha(c.accent, 0.06)} !important;
  --color-sage-hover: ${alpha(c.accent, 0.12)} !important;

  /* Shadows */
  --color-shadow-2xs: rgba(${shadowBase}, 0.03) !important;
  --color-shadow-xs: rgba(${shadowBase}, 0.04) !important;
  --color-shadow-sm: rgba(${shadowBase}, 0.06) !important;
  --color-shadow-md: rgba(${shadowBase}, 0.08) !important;
  --color-shadow-lg: rgba(${shadowBase}, 0.1) !important;
  --color-shadow-xl: rgba(${shadowBase}, 0.12) !important;
  --color-shadow-2xl: rgba(${shadowBase}, 0.16) !important;
  --color-shadow-3xl: rgba(${shadowBase}, 0.3) !important;
  --color-shadow-scrim: rgba(${shadowBase}, 0.55) !important;

  /* Highlights */
  --color-highlight-xs: rgba(${highlightBase}, 0.15) !important;
  --color-highlight-sm: rgba(${highlightBase}, 0.18) !important;
  --color-highlight-md: rgba(${highlightBase}, 0.22) !important;
  --color-highlight-lg: rgba(${highlightBase}, 0.35) !important;
  --color-highlight-xl: rgba(${highlightBase}, 0.4) !important;

  /* Layout tokens — transparent so #root hero art shows through */
  --agents-layout-bg: transparent !important;
  --agents-content-area-bg: transparent !important;
  --agents-fade-bg: transparent !important;
  --agents-content-area-gap: 4px !important;
  --agents-content-area-radius: 6px !important;
  --settings-nav-row-selected-bg: var(--color-fill-secondary) !important;

  /* Chat input parchment — keep extremely subtle to avoid jarring border */
  --chat-input-parchment-edge: ${alpha(c.accent, 0.12)} !important;
  --chat-input-parchment-glow: ${alpha(c.secondary, 0.06)} !important;
  --chat-input-parchment-halo: transparent !important;
}

/* ===== Art layer on #root — palette-driven wash, hero visible right side ===== */
${artLayerCss(host, t)}

/* Layout shell + inner containers transparent so #root art shows through */
${host} .agents-layout-root,
${host} .agents-layout-body,
${host} .agents-content-area,
${host} [class*="agents-content"],
${host} [class*="chat-panel"],
${host} [class*="message-list"],
${host} [class*="conversation-panel"],
${host} [class*="workspace-panel"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
}

/* Sidebar: frosted glass over art (only the actual .agents-sidebar element) */
${host} .agents-sidebar {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 20%, transparent) !important;
  border-right: 1px solid ${alpha(c.accent, 0.1)} !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}

${host} .agents-sidebar [class*="item"]:hover {
  background: var(--color-primary-bg-hover) !important;
}

${host} .agents-sidebar [class*="active"] {
  background: var(--color-primary-bg-hover) !important;
  box-shadow: inset 3px 0 0 0 var(--color-primary), inset 0 0 0 1px var(--color-primary-border) !important;
}

/* Right panel: frosted glass matching left sidebar */
${host} [data-resizable-sidebar]:not(.agents-sidebar) {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 20%, transparent) !important;
  border-left: 1px solid ${alpha(c.accent, 0.1)} !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}

/* Composer focus ring uses native tokens */
${host} .chat-input-editor-text:focus,
${host} .chat-input-editor-text:focus-within {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 3px var(--color-primary-bg-hover), 0 4px 18px ${alpha(c.secondary, 0.2)} !important;
}

/* Selection */
${host} ::selection {
  background: ${alpha(c.accent, 0.28)} !important;
}

/* Links */
${host} a {
  color: var(--color-primary) !important;
  transition: opacity 120ms ease;
}
${host} a:hover {
  opacity: 0.82;
}

/* Code blocks */
${host} code {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid ${alpha(c.border, 0.6)} !important;
  border-radius: 6px !important;
}

${host} pre {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid ${alpha(c.border, 0.6)} !important;
  border-left: 3px solid ${alpha(c.accent, 0.5)} !important;
  border-radius: 10px !important;
}

${host} pre code {
  border: none !important;
}

/* Generic inputs focus ring */
${host} input:focus,
${host} textarea:focus,
${host} select:focus {
  outline: none !important;
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px ${alpha(c.accent, 0.15)} !important;
}

/* Scrollbars */
${host} ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

${host} ::-webkit-scrollbar-track {
  background: transparent;
}

${host} ::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, ${alpha(c.accent, 0.3)} 0%, ${alpha(c.secondary, 0.3)} 100%) !important;
  border-radius: 8px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
}

${host} ::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, ${alpha(c.accent, 0.5)} 0%, ${alpha(c.secondary, 0.5)} 100%) !important;
  background-clip: padding-box !important;
}

@media (prefers-reduced-motion: reduce) {
  ${host} *,
  ${host} *::before,
  ${host} *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
}

// ---------------------------------------------------------------------------
// WorkBuddy (--cb-* design-variable system + #root hero layer)
// ---------------------------------------------------------------------------

function workbuddyCss(t) {
  const c = t.colors;
  const titleBarFg = t.isLight ? '#1f2937' : '#ffffff';
  const hoverMix = t.isLight ? '#000000' : '#000000';

  return `/* ${t.name} — WorkBuddy (--cb-* design tokens) */
${tokenBlock(t)}

body[data-application-name="workbuddy"] {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;
  --wb-accent: ${c.accent};
  --wb-secondary: ${c.secondary};
  --wb-surface: ${c.background};
  --wb-text: ${c.foreground};

  /* Backgrounds */
  --cb-bg-primary: var(--wb-surface) !important;
  --cb-bg-secondary: color-mix(in srgb, var(--wb-surface) 94%, transparent) !important;
  --cb-panel-bg-primary: color-mix(in srgb, var(--wb-surface) 88%, transparent) !important;
  --cb-team-member-card-background: color-mix(in srgb, var(--wb-surface) 88%, transparent) !important;

  /* Text */
  --cb-text-primary: var(--wb-text) !important;
  --cb-text-secondary: color-mix(in srgb, var(--wb-text) 70%, transparent) !important;
  --cb-text-disabled: color-mix(in srgb, var(--wb-text) 42%, transparent) !important;
  --cb-text-link: var(--wb-accent) !important;
  --cb-text-error-active: var(--wb-accent) !important;

  /* VS Code token wrappers */
  --cb-vscode-editor-background: var(--wb-surface) !important;
  --cb-vscode-sideBar-background: color-mix(in srgb, var(--wb-surface) 15%, transparent) !important;
  --cb-vscode-foreground: var(--wb-text) !important;
  --cb-vscode-editor-foreground: var(--wb-text) !important;
  --cb-vscode-descriptionForeground: color-mix(in srgb, var(--wb-text) 70%, transparent) !important;
  --cb-vscode-titleBar-activeBackground: var(--wb-accent) !important;
  --cb-vscode-titleBar-activeForeground: ${titleBarFg} !important;
  --cb-vscode-titleBar-inactiveBackground: color-mix(in srgb, var(--wb-accent) 80%, var(--wb-surface)) !important;
  --cb-vscode-titleBar-inactiveForeground: color-mix(in srgb, ${titleBarFg} 70%, transparent) !important;
  --cb-titlebar-control-hover-background: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-input-background: color-mix(in srgb, var(--wb-surface) 88%, transparent) !important;
  --cb-vscode-dropdown-background: color-mix(in srgb, var(--wb-surface) 94%, transparent) !important;
  --cb-vscode-list-hoverBackground: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-toolbar-hoverBackground: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-scrollbarSlider-background: color-mix(in srgb, var(--wb-accent) 30%, transparent) !important;
  --cb-vscode-scrollbarSlider-hoverBackground: color-mix(in srgb, var(--wb-accent) 50%, transparent) !important;
  --cb-vscode-textLink-foreground: var(--wb-accent) !important;
  --cb-vscode-widget-border: color-mix(in srgb, var(--wb-accent) 45%, transparent) !important;
  --cb-vscode-panel-border: color-mix(in srgb, var(--wb-accent) 30%, transparent) !important;

  /* Buttons */
  --cb-button-dark-background: var(--wb-accent) !important;
  --cb-button-dark-foreground: ${titleBarFg} !important;
  --cb-button-dark-hover-background: color-mix(in srgb, var(--wb-accent) 85%, ${hoverMix}) !important;
  --cb-vscode-button-background: var(--wb-accent) !important;
  --cb-vscode-button-foreground: ${titleBarFg} !important;
  --cb-vscode-button-hoverBackground: color-mix(in srgb, var(--wb-accent) 85%, ${hoverMix}) !important;

  /* Strokes */
  --cb-stroke-secondary: color-mix(in srgb, var(--wb-accent) 45%, transparent) !important;
  --cb-markdown-hr-border-color: color-mix(in srgb, var(--wb-accent) 30%, transparent) !important;

  /* Additional backgrounds */
  --cb-bg-tertiary: color-mix(in srgb, var(--wb-surface) 82%, var(--wb-accent) 6%) !important;
  --cb-bg-overlay: color-mix(in srgb, var(--wb-surface) 90%, transparent) !important;
  --cb-panel-bg-secondary: color-mix(in srgb, var(--wb-surface) 78%, var(--wb-accent) 10%) !important;

  /* Additional text */
  --cb-text-tertiary: color-mix(in srgb, var(--wb-text) 50%, transparent) !important;
  --cb-text-link-hover: var(--wb-secondary) !important;

  /* Ghost / secondary buttons */
  --cb-button-ghost-hover-background: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-button-secondaryBackground: color-mix(in srgb, var(--wb-surface) 70%, var(--wb-accent) 12%) !important;

  /* Focus & selection */
  --cb-vscode-focusBorder: color-mix(in srgb, var(--wb-accent) 40%, transparent) !important;
  --cb-vscode-list-activeSelectionForeground: var(--wb-text) !important;
  --cb-vscode-list-inactiveSelectionBackground: color-mix(in srgb, var(--wb-accent) 10%, transparent) !important;
}

/* Hero art layer: palette-driven wash, hero visible right side */
${artLayerCss('', t).replace(/^ #root/m, '#root')}

/* teams-container is #root's direct child and ships an opaque grey base */
.teams-container,
.teams-container.is-mac {
  background: transparent !important;
}

/* Grid item containers go transparent so the art shows through */
[data-view-id] {
  background: transparent !important;
}

/* Inner content layers transparent (otherwise they cover the art) */
.conversation-list,
.chat-container,
.wb-cb-chat,
.chat-main,
.message-list,
.main-content,
.main-content--welcome,
.sidebar-next,
.teams-content-wrapper,
.teams-main-content {
  background: transparent !important;
}

/* Topbar: menubar + window controls (both outside #root, need explicit styling) */
#workbuddy-menubar-container,
.codebuddy-menubar,
#workbuddy-window-controls-container,
.workbuddy-window-controls {
  background: color-mix(in srgb, var(--agentskin-surface) 8%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
  border-bottom: none !important;
}

.workbuddy-window-control-button {
  background: transparent !important;
  color: var(--agentskin-text) !important;
  transition: background 140ms ease, color 140ms ease !important;
}

.workbuddy-window-control-button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
  color: var(--agentskin-text) !important;
}

.workbuddy-window-control-button.close:hover {
  background: #e53935 !important;
  color: #ffffff !important;
}

/* Composer main area: semi-transparent instead of opaque rgb(31,31,31) */
[class*="_mainArea_"] {
  background: color-mix(in srgb, var(--agentskin-surface) 50%, transparent) !important;
  backdrop-filter: blur(14px) !important;
  border: 1px solid ${alpha(c.accent, 0.25)} !important;
  border-radius: 12px !important;
}

/* Sidebar section labels & collapsible headers: transparent (incl. CSS module variants) */
.conversation-section-label,
.collapsible-section-header[class*="_header_"][class*="_headerSticky_"],
[class*="_headerTopPadding_"][class*="collapsible"] {
  background: transparent !important;
  background-color: transparent !important;
}

/* Anonymous layout panels directly under .teams-container (504x502 opaque blocks) */
.teams-container > div {
  background: transparent !important;
}

/* Grid view internal containers */
[class*="_gridViewItem_"] > div,
[class*="_gridView_"] > div > div {
  background: transparent !important;
}

/* Sidebar search box */
.my-files-search {
  background: color-mix(in srgb, var(--agentskin-surface) 30%, transparent) !important;
  border: 1px solid ${alpha(c.accent, 0.15)} !important;
  border-radius: 8px !important;
  backdrop-filter: blur(8px) !important;
}

/* Tencent docs auth guide strip */
.tencent-docs-auth-guide__permissions {
  background: transparent !important;
}

/* Sidebar: frosted glass */
[data-view-id="sidebar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  border-right: none !important;
  backdrop-filter: blur(24px) saturate(1.15);
}

/* Main content: open top, light bottom for readability */
[data-view-id="main-content"] {
  background: linear-gradient(180deg, transparent 0 55%, color-mix(in srgb, var(--agentskin-bg) 42%, transparent) 100%) !important;
}

/* Detail panel: frosted glass */
[data-view-id="detail-panel"] {
  background: color-mix(in srgb, var(--agentskin-surface) 72%, transparent) !important;
  backdrop-filter: blur(18px) saturate(1.08);
}

/* Composer focus ring */
[role="textbox"][contenteditable="true"]:focus,
.wb-home-composer [contenteditable="true"]:focus {
  outline: none !important;
  box-shadow: 0 0 0 2px ${alpha(c.accent, 0.4)}, 0 4px 18px ${alpha(c.secondary, 0.2)} !important;
}

/* Selection & scrollbars */
body[data-application-name="workbuddy"] ::selection {
  background: ${alpha(c.accent, 0.32)} !important;
}

body[data-application-name="workbuddy"] ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

body[data-application-name="workbuddy"] ::-webkit-scrollbar-track {
  background: transparent;
}

body[data-application-name="workbuddy"] ::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, ${alpha(c.accent, 0.3)} 0%, ${alpha(c.secondary, 0.3)} 100%) !important;
  border-radius: 8px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
}

body[data-application-name="workbuddy"] ::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, ${alpha(c.accent, 0.5)} 0%, ${alpha(c.secondary, 0.5)} 100%) !important;
  background-clip: padding-box !important;
}

/* Component touches — buttons, code, links, sidebar motion. Brings WorkBuddy
   to the same polish level as the qoderwork/traework sheets so all three
   agents feel equally crafted instead of workbuddy being the plain one. */
button[class*="primary"],
button[class*="send"],
[class*="composer"] button[class*="submit"] {
  background: linear-gradient(135deg, var(--wb-accent) 0%, color-mix(in srgb, var(--wb-accent) 62%, var(--wb-secondary) 38%) 100%) !important;
  color: ${t.isLight ? '#1f2937' : '#ffffff'} !important;
  border: none !important;
  box-shadow: 0 2px 10px var(--agentskin-focus-ring) !important;
  transition: filter 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}

button[class*="primary"]:hover,
button[class*="send"]:hover,
[class*="composer"] button[class*="submit"]:hover {
  filter: brightness(1.07);
  transform: translateY(-1px);
}

code {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid ${alpha(c.accent, 0.14)} !important;
  border-radius: 6px !important;
}

pre {
  background: var(--agentskin-code-bg) !important;
  color: var(--agentskin-code-fg) !important;
  border: 1px solid ${alpha(c.accent, 0.14)} !important;
  border-left: 3px solid ${alpha(c.accent, 0.5)} !important;
  border-radius: 10px !important;
}

pre code {
  border: none !important;
}

a {
  color: var(--wb-accent) !important;
  transition: opacity 120ms ease;
}

a:hover {
  opacity: 0.82;
}

/* Sidebar item motion */
[data-view-id="sidebar"] [class*="item"],
.conversation-list [class*="item"] {
  transition: background 140ms ease;
}

.menubar-menu-title,
[class*="menubar"] [class*="title"],
[class*="menu-bar"] [class*="label"] {
  color: var(--cb-text-secondary) !important;
}
.menubar-menu-title:hover,
[class*="menubar"] [class*="title"]:hover,
[class*="menu-bar"] [class*="label"]:hover {
  color: var(--cb-text-primary) !important;
}

/* Input slot: frosted glass instead of opaque rgb(41,41,41) */
.wb-home-composer__input-slot {
  background: color-mix(in srgb, var(--agentskin-surface) 40%, transparent) !important;
  backdrop-filter: blur(12px) saturate(1.1) !important;
  border: 1px solid ${alpha(c.accent, 0.22)} !important;
  border-radius: 18px !important;
  transition: border-color 180ms ease, box-shadow 180ms ease !important;
}

.wb-home-composer__input-slot:focus-within {
  border-color: ${alpha(c.accent, 0.5)} !important;
  box-shadow: 0 0 0 2px ${alpha(c.accent, 0.12)}, 0 4px 20px ${alpha(c.accent, 0.08)} !important;
}

/* Quick action pills: semi-transparent accent tint instead of opaque rgb(31,31,31) */
.quick-actions__item {
  background: color-mix(in srgb, var(--agentskin-surface) 35%, transparent) !important;
  border: 1px solid ${alpha(c.accent, 0.18)} !important;
  color: var(--cb-text-secondary) !important;
  backdrop-filter: blur(8px) !important;
  box-shadow: none !important;
  outline: none !important;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease !important;
}

.quick-actions__item:hover {
  background: color-mix(in srgb, var(--wb-accent) 18%, transparent) !important;
  border-color: ${alpha(c.accent, 0.4)} !important;
  color: var(--cb-text-primary) !important;
}

/* Quick actions container: kill side shadow rendering (the jarring squared
   shadow on both sides of the recommendation area above the input). */
.quick-actions,
.quick-actions__list,
[class*="quick-action"]:not(.quick-actions__item) {
  box-shadow: none !important;
  outline: none !important;
}
.quick-actions *,
.quick-actions__list * {
  box-shadow: none !important;
  outline: none !important;
}

/* Message bubbles: subtle frosted surfaces */
[class*="message-bubble"],
[class*="messageBubble"],
[class*="msg-content"] {
  background: color-mix(in srgb, var(--agentskin-surface) 38%, transparent) !important;
  backdrop-filter: blur(10px) !important;
  border: 1px solid ${alpha(c.accent, 0.12)} !important;
  border-radius: 14px !important;
}

[class*="message-bubble"][class*="assistant"],
[class*="messageBubble"][class*="assistant"],
[class*="msg-content"][class*="bot"] {
  background: color-mix(in srgb, var(--agentskin-surface) 30%, transparent) !important;
  border-color: ${alpha(c.secondary, 0.15)} !important;
}

/* Composer container focus glow */
.wb-home-composer:focus-within [class*="_mainArea_"] {
  border-color: ${alpha(c.accent, 0.4)} !important;
  box-shadow: 0 2px 24px ${alpha(c.accent, 0.1)} !important;
}

@media (prefers-reduced-motion: reduce) {
  body[data-application-name="workbuddy"] *,
  body[data-application-name="workbuddy"] *::before,
  body[data-application-name="workbuddy"] *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
}

// ---------------------------------------------------------------------------
// Doubao (豆包) — Chromium desktop assistant, Semi Design (--semi-color-*) token system
// ---------------------------------------------------------------------------

function doubaoCss(t) {
  const c = t.colors;
  const host = 'html.codedrobe-host-doubao';
  const p = computeArtParams(t);

  return `/* ${t.name} — 豆包 (Doubao) (--dbx-* design tokens)
   Strategy: override the semantic layer of Doubao's 251-token --dbx-* system
   (text/bg/fill/line/code/brand) while leaving the neutral scale, static alpha
   ramps, and color palettes untouched. Selector specificity (0,2,1) beats both
   :root[data-theme="dark"] (0,1,1) and the light selector list. */
${tokenBlock(t)}

/* ===== Native token overrides ===== */
${host}:root {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;

  /* Backgrounds */
  --dbx-bg-body-web: ${c.background} !important;
  --dbx-bg-base-web: ${c.background} !important;
  --dbx-bg-base-2: color-mix(in srgb, ${c.surface} 55%, ${c.background}) !important;
  --dbx-bg-base-5: ${c.surface} !important;
  --dbx-bg-float: ${c.surfaceElevated} !important;
  --dbx-bg-body-overlay-web: ${c.surface} !important;
  --dbx-bg-body-white: ${c.background} !important;
  --dbx-bg-body-mac: ${alpha(c.background, 0.85)} !important;
  --dbx-bg-base-mac: ${alpha(c.foreground, 0.03)} !important;
  --dbx-bg-browser-win: ${c.background} !important;
  --dbx-bg-browser-mac: ${alpha(c.background, 0.7)} !important;
  --dbx-bg-body-launcher: ${alpha(c.surface, 0.8)} !important;
  --dbx-bg-body-overlay-launcher: ${alpha(c.surface, 0.45)} !important;
  --dbx-bg-float-launcher: ${alpha(c.surfaceElevated, 0.6)} !important;
  --dbx-bg-body-overlay-mac: ${alpha(c.surface, 0.6)} !important;
  --dbx-bg-body-overlay-white: ${alpha(c.surface, 0.6)} !important;
  --dbx-bg-base-2-mobile: ${c.surface} !important;
  --dbx-bg-base-2-overlay-mobile: ${c.surface} !important;
  --dbx-bg-base-3-mobile: ${c.surfaceElevated} !important;
  --dbx-bg-base-3-enterprisebubble: ${c.surfaceElevated} !important;
  --dbx-bg-base-4-action: ${c.foreground} !important;
  --dbx-bg-base-1-overlay-mobile: ${c.background} !important;
  --dbx-bg-mask: rgba(0, 0, 0, 0.4) !important;
  --dbx-bg-blur-md: 100px !important;

  /* Text hierarchy */
  --dbx-text-primary: ${c.foreground} !important;
  --dbx-text-secondary: ${c.muted} !important;
  --dbx-text-tertiary: ${alpha(c.muted, 0.7)} !important;
  --dbx-text-disable: ${alpha(c.muted, 0.4)} !important;
  --dbx-text-markdown: ${alpha(c.foreground, 0.95)} !important;
  --dbx-text-n00-primary: ${c.background} !important;
  --dbx-text-n00-secondary: ${alpha(c.background, 0.8)} !important;
  --dbx-text-n00-tertiary: ${alpha(c.background, 0.6)} !important;
  --dbx-text-n00-disable: ${alpha(c.background, 0.3)} !important;
  --dbx-text-highlight: ${c.accent} !important;
  --dbx-text-highlight-secondary: ${alpha(c.accent, 0.6)} !important;
  --dbx-text-highlight-hover: color-mix(in srgb, ${c.accent} 75%, #fff) !important;
  --dbx-text-highlight-disable: ${alpha(c.accent, 0.3)} !important;

  /* Brand / Fill */
  --dbx-brand-default: ${c.accent} !important;
  --dbx-fill-highlight: ${c.accent} !important;
  --dbx-fill-highlight-hover: color-mix(in srgb, ${c.accent} 80%, #fff) !important;
  --dbx-fill-highlight-disable: ${alpha(c.accent, 0.3)} !important;
  --dbx-fill-highlight-trans-10: ${alpha(c.accent, 0.06)} !important;
  --dbx-fill-highlight-trans-10-blank: ${alpha(c.accent, 0.06)} !important;
  --dbx-fill-primary-50: ${c.accent} !important;
  --dbx-fill-primary-60: ${shade(c.accent, 'black', 0.85)} !important;
  --dbx-fill-primary-transparent-1: ${alpha(c.accent, 0.12)} !important;
  --dbx-fill-banner: ${c.surfaceElevated} !important;
  --dbx-fill-trans-10: ${alpha(c.foreground, 0.03)} !important;
  --dbx-fill-trans-10-hover: ${alpha(c.foreground, 0.05)} !important;
  --dbx-fill-trans-10-disable: ${alpha(c.foreground, 0.03)} !important;
  --dbx-fill-trans-20: ${alpha(c.foreground, 0.05)} !important;
  --dbx-fill-trans-20-hover: ${alpha(c.foreground, 0.08)} !important;
  --dbx-fill-trans-20-disable: ${alpha(c.foreground, 0.05)} !important;
  --dbx-fill-trans-30: ${alpha(c.foreground, 0.08)} !important;
  --dbx-fill-trans-30-hover: ${alpha(c.foreground, 0.12)} !important;
  --dbx-fill-trans-30-disable: ${alpha(c.foreground, 0.08)} !important;

  /* Lines / Borders */
  --dbx-line-divider-5: ${alpha(c.border, 0.5)} !important;
  --dbx-line-divider-10: ${c.border} !important;
  --dbx-line-7: ${alpha(c.border, 0.7)} !important;
  --dbx-line-10: ${c.border} !important;
  --dbx-line-15: color-mix(in srgb, ${c.border} 80%, ${c.foreground} 20%) !important;
  --dbx-line-20-hover: color-mix(in srgb, ${c.border} 60%, ${c.foreground} 40%) !important;
  --dbx-line-highlight: ${alpha(c.accent, 0.2)} !important;

  /* Code block */
  --dbx-code-text: ${c.codeForeground} !important;
  --dbx-code-doc: ${c.muted} !important;
  --dbx-code-link: ${c.accent} !important;

  /* Function: info tied to accent */
  --dbx-function-info: ${c.accent} !important;
  --dbx-function-info-hover: color-mix(in srgb, ${c.accent} 80%, #fff) !important;
  --dbx-function-info-disable: ${alpha(c.accent, 0.3)} !important;

  /* Switch */
  --dbx-symbol-switch-toggle-disable: ${alpha(c.muted, 0.3)} !important;
}

/* ===== Real Doubao token system: Semi Design (--semi-color-*) =====
   Probe (2026-07-23) found Doubao ships 268 --semi-* tokens + 12 --gray* +
   64 semantic vars (--normal-bg, --hover-bg-color, --active-bg-color,
   --static-bg-color, --error-*, --scrollbar-*, --input-guidance-*, ...).
   The --dbx-*/--s-color-*/--ffc-* blocks below target tokens that do NOT
   exist in Doubao and are dead; the real theming happens via --semi-color-*. */
${host}:root {
  /* Background layers */
  --semi-color-bg-0: ${c.background} !important;
  --semi-color-bg-1: ${c.surface} !important;
  --semi-color-bg-2: ${c.surfaceElevated} !important;
  --semi-color-bg-3: ${c.surfaceElevated} !important;
  --semi-color-bg-4: color-mix(in srgb, ${c.surfaceElevated} 92%, #fff) !important;

  /* Text hierarchy */
  --semi-color-text-0: ${c.foreground} !important;
  --semi-color-text-1: ${c.muted} !important;
  --semi-color-text-2: ${alpha(c.muted, 0.75)} !important;
  --semi-color-text-3: ${alpha(c.muted, 0.45)} !important;

  /* Primary / brand */
  --semi-color-primary: ${c.accent} !important;
  --semi-color-primary-hover: ${shade(c.accent, 'black', 0.12)} !important;
  --semi-color-primary-active: ${shade(c.accent, 'black', 0.24)} !important;
  --semi-color-primary-light-default: ${alpha(c.accent, 0.12)} !important;
  --semi-color-primary-light-hover: ${alpha(c.accent, 0.18)} !important;
  --semi-color-primary-light-active: ${alpha(c.accent, 0.24)} !important;
  --semi-color-primary-disabled: ${alpha(c.accent, 0.35)} !important;

  /* Secondary / tertiary */
  --semi-color-secondary: ${c.secondary} !important;
  --semi-color-secondary-hover: ${shade(c.secondary, 'black', 0.12)} !important;
  --semi-color-secondary-active: ${shade(c.secondary, 'black', 0.24)} !important;
  --semi-color-secondary-light-default: ${alpha(c.secondary, 0.12)} !important;
  --semi-color-secondary-light-hover: ${alpha(c.secondary, 0.18)} !important;
  --semi-color-tertiary: ${alpha(c.foreground, 0.06)} !important;
  --semi-color-tertiary-hover: ${alpha(c.foreground, 0.1)} !important;
  --semi-color-tertiary-light-default: ${alpha(c.foreground, 0.06)} !important;

  /* Fills */
  --semi-color-fill-0: ${alpha(c.foreground, 0.04)} !important;
  --semi-color-fill-1: ${alpha(c.foreground, 0.08)} !important;
  --semi-color-fill-2: ${alpha(c.foreground, 0.12)} !important;

  /* Border / disabled */
  --semi-color-border: ${c.border} !important;
  --semi-color-disabled-bg: ${alpha(c.foreground, 0.04)} !important;
  --semi-color-disabled-border: ${alpha(c.border, 0.5)} !important;
  --semi-color-disabled-fill: ${alpha(c.foreground, 0.04)} !important;
  --semi-color-disabled-text: ${alpha(c.muted, 0.4)} !important;

  /* Links / highlight / shadow / nav */
  --semi-color-link: ${c.accent} !important;
  --semi-color-link-hover: ${shade(c.accent, 'black', 0.12)} !important;
  --semi-color-link-active: ${shade(c.accent, 'black', 0.24)} !important;
  --semi-color-link-visited: ${alpha(c.accent, 0.7)} !important;
  --semi-color-highlight: ${alpha(c.accent, 0.18)} !important;
  --semi-color-highlight-bg: ${alpha(c.accent, 0.14)} !important;
  --semi-color-shadow: ${alpha(c.accent, 0.18)} !important;
  --semi-color-nav-bg: ${c.surface} !important;
  --semi-color-overlay-bg: ${alpha(c.background, 0.6)} !important;

  /* Gray ramp (gray1 lightest -> gray12 darkest) */
  --gray1: ${c.foreground} !important;
  --gray2: color-mix(in srgb, ${c.foreground} 90%, ${c.background}) !important;
  --gray3: color-mix(in srgb, ${c.foreground} 80%, ${c.background}) !important;
  --gray4: color-mix(in srgb, ${c.foreground} 70%, ${c.background}) !important;
  --gray5: color-mix(in srgb, ${c.foreground} 60%, ${c.background}) !important;
  --gray6: color-mix(in srgb, ${c.foreground} 50%, ${c.background}) !important;
  --gray7: color-mix(in srgb, ${c.foreground} 40%, ${c.background}) !important;
  --gray8: color-mix(in srgb, ${c.foreground} 30%, ${c.background}) !important;
  --gray9: color-mix(in srgb, ${c.foreground} 22%, ${c.background}) !important;
  --gray10: color-mix(in srgb, ${c.foreground} 15%, ${c.background}) !important;
  --gray11: color-mix(in srgb, ${c.foreground} 8%, ${c.background}) !important;
  --gray12: ${c.background} !important;

  /* Real Doubao semantic vars (verified via CDP probe 2026-07-23) */
  --normal-bg: ${c.surface} !important;
  --normal-bg-hover: ${c.surfaceElevated} !important;
  --normal-text: ${c.foreground} !important;
  --normal-border: ${c.border} !important;
  --hover-bg-color: ${alpha(c.foreground, 0.06)} !important;
  --active-bg-color: ${alpha(c.accent, 0.14)} !important;
  --static-bg-color: ${c.background} !important;
  --error-bg: rgba(255, 77, 79, 0.12) !important;
  --error-border: rgba(255, 77, 79, 0.4) !important;
  --error-text: rgb(255, 99, 101) !important;
  --warning-bg: rgba(255, 168, 0, 0.12) !important;
  --warning-border: rgba(255, 168, 0, 0.4) !important;
  --warning-text: rgb(255, 183, 77) !important;
  --success-bg: rgba(0, 184, 96, 0.12) !important;
  --success-border: rgba(0, 184, 96, 0.4) !important;
  --success-text: rgb(38, 200, 120) !important;
  --info-bg: ${alpha(c.accent, 0.12)} !important;
  --info-border: ${alpha(c.accent, 0.4)} !important;
  --info-text: ${c.accent} !important;
  --scrollbar-color-active: ${alpha(c.accent, 0.5)} !important;
  --scrollbar-color-hover: ${alpha(c.accent, 0.4)} !important;
  --scrollthumbcolor: ${alpha(c.accent, 0.35)} !important;
  --input-guidance-input-container-background: color-mix(in srgb, color-mix(in srgb, ${c.surface} 78%, ${c.accent} 22%) 45%, transparent) !important;
  --input-guidance-input-container-border: ${alpha(c.accent, 0.15)} !important;
  --input-guidance-input-editor-color: ${c.foreground} !important;
  --input-guidance-input-editor-placeholder-color: ${alpha(c.muted, 0.6)} !important;
  --left-side: ${c.surface} !important;
}

/* ===== Body-level overrides =====
   :root[data-theme="dark"] body sets --dbx-bg-body-web at (0,2,1).
   Our html.codedrobe-host-doubao:root body = (0,2,2) beats it. */
${host}:root body {
  /* Body bg is handled by the art layer (body::before) — token must be transparent
     so elements referencing it don't paint an opaque block over the hero. */
  --dbx-bg-body-web: transparent !important;

  /* --chat-bg-color drives main content area background — transparent to reveal body art */
  --chat-bg-color: transparent !important;

  /* --s-color-* secondary token system (chat input, panels, cards) */
  --s-color-bg-body: transparent !important;
  --s-color-bg-body-raw: 0, 0, 0 !important;
  --s-color-bg-primary: var(--agentskin-surface) !important;
  --s-color-bg-secondary: color-mix(in srgb, var(--agentskin-surface) 92%, transparent) !important;
  --s-color-bg-tertiary: color-mix(in srgb, var(--agentskin-surface) 85%, transparent) !important;
  --s-color-bg-trans: color-mix(in srgb, var(--agentskin-text) 5%, transparent) !important;
  --s-color-bg-trans-raw: ${rawRgb(c.foreground)} !important;
  --s-color-bg-trans-tertiary: color-mix(in srgb, var(--agentskin-text) 3%, transparent) !important;
  --s-color-bg-trans-tertiary-raw: ${rawRgb(c.foreground)} !important;
  --s-color-bg-trans-primary: color-mix(in srgb, var(--agentskin-text) 6%, transparent) !important;
  --s-color-bg-trans-primary-raw: ${rawRgb(c.foreground)} !important;
  --s-color-bg-trans-secondary: color-mix(in srgb, var(--agentskin-text) 10%, transparent) !important;
  --s-color-bg-trans-secondary-raw: ${rawRgb(c.foreground)} !important;
  --s-color-bg-float: var(--agentskin-surface-elevated) !important;
  --s-color-bg-dialogs: var(--agentskin-surface-elevated) !important;
  --s-color-bg-dialogs-raw: ${rawRgb(c.surfaceElevated)} !important;
  --s-color-bg-dialogs-grey: var(--agentskin-surface) !important;
  --s-color-bg-tip: var(--agentskin-surface-elevated) !important;
  --s-color-bg-tip-raw: ${rawRgb(c.surfaceElevated)} !important;
  --s-color-bg-dm-fill: ${alpha(c.foreground, 0)} !important;
  --s-color-bg-dm-fill-raw: ${rawRgb(c.foreground)} !important;
  --s-color-bg-toolbox-item: var(--agentskin-surface) !important;
  --s-color-bg-toolbox-item-hover: var(--agentskin-surface-elevated) !important;
  --s-color-bg-guide-btn: var(--agentskin-surface) !important;
  --s-color-bg-guide-btn-hover: color-mix(in srgb, var(--agentskin-text) 4%, transparent) !important;
  --s-color-text-primary: var(--agentskin-text) !important;
  --s-color-text-primary-raw: var(--agentskin-text) !important;
  --s-color-text-secondary: var(--agentskin-muted) !important;
  --s-color-text-tertiary: color-mix(in srgb, var(--agentskin-muted) 70%, transparent) !important;
  --s-color-text-quaternary: color-mix(in srgb, var(--agentskin-muted) 50%, transparent) !important;
  --s-color-text-disable: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;
  --s-color-border-tertiary: var(--agentskin-border) !important;
  --s-color-border-secondary: color-mix(in srgb, var(--agentskin-accent) 25%, transparent) !important;
  --s-color-alert-raw: var(--agentskin-accent) !important;

  /* --ffc-* component token system (float cards, buttons, scrollbars) */
  --ffc-text-primary: var(--agentskin-text) !important;
  --ffc-text-secondary: var(--agentskin-muted) !important;
  --ffc-text-tertiary: color-mix(in srgb, var(--agentskin-muted) 70%, transparent) !important;
  --ffc-text-disabled: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;
  --ffc-text-highlight: var(--agentskin-accent) !important;
  --ffc-text-highlight-hover: color-mix(in srgb, var(--agentskin-accent) 80%, #fff) !important;
  --ffc-bg-float: var(--agentskin-surface-elevated) !important;
  --ffc-bg-subtle: color-mix(in srgb, var(--agentskin-surface) 90%, transparent) !important;
  --ffc-fill-trans-10: color-mix(in srgb, var(--agentskin-text) 3%, transparent) !important;
  --ffc-fill-trans-10-hover: color-mix(in srgb, var(--agentskin-text) 5%, transparent) !important;
  --ffc-fill-trans-20: color-mix(in srgb, var(--agentskin-text) 5%, transparent) !important;
  --ffc-fill-trans-20-hover: color-mix(in srgb, var(--agentskin-text) 8%, transparent) !important;
  --ffc-fill-highlight: var(--agentskin-accent) !important;
  --ffc-fill-highlight-hover: color-mix(in srgb, var(--agentskin-accent) 80%, #fff) !important;
  --ffc-fill-highlight-subtle: color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
  --ffc-fill-highlight-trans-10-blank: color-mix(in srgb, var(--agentskin-accent) 6%, transparent) !important;
  --ffc-line-10: var(--agentskin-border) !important;
  --ffc-line-15: color-mix(in srgb, var(--agentskin-border) 80%, var(--agentskin-text) 20%) !important;
  --ffc-line-highlight: color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
  --ffc-scrollbar-color: color-mix(in srgb, var(--agentskin-accent) 25%, transparent) !important;
  --ffc-scrollbar-hover-color: color-mix(in srgb, var(--agentskin-accent) 45%, transparent) !important;
  --ffc-color-brand-primary-default: var(--agentskin-accent) !important;
  --ffc-color-accents-blue: var(--agentskin-accent) !important;
  --ffc-color-text-disable: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;
  --ffc-button-brand-icon-bg: var(--agentskin-accent) !important;
  --ffc-button-brand-icon-hover-bg: color-mix(in srgb, var(--agentskin-accent) 80%, #fff) !important;
  --ffc-button-brand-icon-disabled-bg: color-mix(in srgb, var(--agentskin-text) 4%, transparent) !important;
  --ffc-button-brand-icon-disabled-color: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;
  --ffc-fill-disabled: color-mix(in srgb, var(--agentskin-text) 4%, transparent) !important;
  --ffc-textarea-color: var(--agentskin-text) !important;
  --ffc-textarea-placeholder-color: color-mix(in srgb, var(--agentskin-muted) 55%, transparent) !important;
  --ffc-textarea-disabled-color: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;
  --ffc-ai-edit-textarea-color: var(--agentskin-text) !important;
  --ffc-ai-edit-textarea-placeholder-color: color-mix(in srgb, var(--agentskin-muted) 55%, transparent) !important;
  --ffc-text-primary-0085: color-mix(in srgb, var(--agentskin-text) 85%, transparent) !important;

  /* --s-color-brand-primary-* (drives ALL primary buttons, links, active states) */
  --s-color-brand-primary-default: var(--agentskin-accent) !important;
  --s-color-brand-primary-default-raw: ${rawRgb(c.accent)} !important;
  --s-color-brand-primary-hover: ${shade(c.accent, 'black', 0.15)} !important;
  --s-color-brand-primary-hover-raw: ${rawRgb(shade(c.accent, 'black', 0.15))} !important;
  --s-color-brand-primary-pressed: ${shade(c.accent, 'black', 0.3)} !important;
  --s-color-brand-primary-pressed-raw: ${rawRgb(shade(c.accent, 'black', 0.3))} !important;
  --s-color-brand-primary-disable: ${alpha(c.accent, 0.3)} !important;
  --s-color-brand-primary-transparent-1: ${alpha(c.accent, 0.06)} !important;
  --s-color-brand-primary-transparent-2: ${alpha(c.accent, 0.1)} !important;
  --s-color-brand-primary-transparent-3: ${alpha(c.accent, 0.15)} !important;

  /* --s-color-ai-* (AI button gradients, AI text) */
  --s-color-ai-button: radial-gradient(105.79% 117.52% at 9.98% 22.03%, var(--agentskin-accent) 0%, ${shade(c.accent, 'black', 0.2)} 100%) !important;
  --s-color-ai-button-fill: radial-gradient(125.81% 83.73% at 21.13% 50%, var(--agentskin-accent) 0%, ${shade(c.accent, 'black', 0.15)} 100%) !important;
  --s-color-ai-text: linear-gradient(301deg, ${shade(c.accent, 'white', 0.3)} 23.93%, var(--agentskin-accent) 92.76%) !important;
  --s-color-ai-solid: radial-gradient(125.81% 83.73% at 21.13% 50%, var(--agentskin-accent) 0%, ${shade(c.accent, 'black', 0.15)} 100%) !important;
  --s-color-ai-solid-disable: radial-gradient(125.81% 83.73% at 21.13% 50%, ${alpha(c.accent, 0.4)} 0%, ${alpha(shade(c.accent, 'black', 0.15), 0.4)} 100%) !important;
  --s-color-ai-button-fill-disable: radial-gradient(163.38% 139.31% at 19.33% 22.04%, ${alpha(c.accent, 0.3)} 0%, ${alpha(shade(c.accent, 'black', 0.2), 0.3)} 100%) !important;
  --s-color-ai-line: linear-gradient(301deg, ${shade(c.accent, 'white', 0.35)} 23.93%, var(--agentskin-accent) 92.76%) !important;
  --s-color-ai-line-disable: linear-gradient(301deg, ${alpha(shade(c.accent, 'white', 0.35), 0.3)} 23.93%, ${alpha(c.accent, 0.3)} 92.76%) !important;

  /* System / accent colors */
  --s-color-system-info: var(--agentskin-accent) !important;
  --s-color-system-info-raw: ${rawRgb(c.accent)} !important;
  --s-color-system-info-lighten: ${shade(c.accent, 'white', 0.85)} !important;
  --s-color-system-info-lighten-raw: ${rawRgb(shade(c.accent, 'white', 0.85))} !important;
  --s-color-system-info-darken: ${shade(c.accent, 'black', 0.2)} !important;
  --s-color-system-info-darken-raw: ${rawRgb(shade(c.accent, 'black', 0.2))} !important;
  --s-color-accents-blue: var(--agentskin-accent) !important;
  --s-color-accents-blue-raw: ${rawRgb(c.accent)} !important;
  --s-color-suggest: ${shade(c.accent, 'white', 0.3)} !important;
  --s-color-suggest-raw: ${rawRgb(shade(c.accent, 'white', 0.3))} !important;

  /* Backgrounds (surfaces) */
  --s-color-bg-quaternary: color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-bg)) !important;
  --s-color-bg-quaternary-raw: ${rawRgb(shade(c.surface, 'black', 0.06))} !important;
  --s-color-bg-base: color-mix(in srgb, var(--agentskin-surface) 88%, var(--agentskin-bg)) !important;
  --s-color-bg-base-raw: ${rawRgb(shade(c.surface, 'black', 0.04))} !important;
  --s-color-bg-content-base: color-mix(in srgb, var(--agentskin-surface) 94%, var(--agentskin-bg)) !important;
  --s-color-bg-content-base-raw: ${rawRgb(shade(c.surface, 'black', 0.02))} !important;
  --s-color-bg-disable: color-mix(in srgb, var(--agentskin-muted) 35%, var(--agentskin-surface)) !important;
  --s-color-bg-disable-raw: ${rawRgb(shade(c.muted, 'white', 0.5))} !important;
  --s-color-bg-outlined-btn: transparent !important;
  --s-color-bg-outlined-btn-raw: ${rawRgb(c.surface)} !important;
  --s-color-bg-outlined-btn-hover: ${alpha(c.accent, 0.1)} !important;
  --s-color-bg-outlined-btn-hover-raw: ${rawRgb(c.accent)} !important;
  --s-color-bg-native-dialog: color-mix(in srgb, var(--agentskin-surface) 92%, var(--agentskin-bg)) !important;
  --s-color-bg-native-dialog-raw: ${rawRgb(shade(c.surface, 'black', 0.03))} !important;
  --s-color-bg-native-spotlight: color-mix(in srgb, var(--agentskin-surface) 60%, transparent) !important;
  --s-color-bg-native-spotlight-raw: ${rawRgb(c.surface)} !important;

  /* PC-specific backgrounds */
  --s-bg-pc-base-grey: color-mix(in srgb, var(--agentskin-surface) 90%, var(--agentskin-bg)) !important;
  --s-bg-pc-base-grey-raw: ${rawRgb(shade(c.surface, 'black', 0.03))} !important;
  --s-bg-pc-base-systemblur: color-mix(in srgb, var(--agentskin-surface) 60%, transparent) !important;
  --s-bg-pc-base-systemblur-raw: ${rawRgb(c.surface)} !important;
  --s-bg-pc-body: color-mix(in srgb, var(--agentskin-surface) 50%, transparent) !important;
  --s-bg-pc-body-raw: ${rawRgb(c.surface)} !important;
  --s-bg-pc-tabbar: color-mix(in srgb, var(--agentskin-surface) 78%, var(--agentskin-bg)) !important;
  --s-bg-pc-tabbar-raw: ${rawRgb(shade(c.surface, 'black', 0.08))} !important;
  --s-color-bg-PC-base-grey: color-mix(in srgb, var(--agentskin-surface) 90%, var(--agentskin-bg)) !important;
  --s-color-bg-PC-base-systemblur: color-mix(in srgb, var(--agentskin-surface) 60%, transparent) !important;
  --s-color-bg-pc-body: color-mix(in srgb, var(--agentskin-surface) 50%, transparent) !important;
  --s-color-bg-pc-body-active: color-mix(in srgb, var(--agentskin-surface) 70%, transparent) !important;

  /* Borders */
  --s-color-border-primary: color-mix(in srgb, var(--agentskin-border) 60%, transparent) !important;
  --s-color-border-primary-raw: ${rawRgb(c.border)} !important;
  --s-color-border-card: var(--agentskin-border) !important;
  --s-color-border-card-raw: ${rawRgb(c.border)} !important;
  --s-color-border-quaternary: color-mix(in srgb, var(--agentskin-border) 30%, transparent) !important;
  --s-color-border-quaternary-raw: ${rawRgb(c.border)} !important;

  /* Fills */
  --s-color-fill-secondary: color-mix(in srgb, var(--agentskin-border) 50%, var(--agentskin-surface)) !important;

  /* Invert backgrounds (dark panels on light apps, or vice versa) */
  --s-color-bg-invert-primary: var(--agentskin-surface-elevated) !important;
  --s-color-bg-invert-primary-raw: ${rawRgb(c.surfaceElevated)} !important;
  --s-color-bg-invert-secondary: color-mix(in srgb, var(--agentskin-surface-elevated) 88%, var(--agentskin-bg)) !important;
  --s-color-bg-invert-secondary-raw: ${rawRgb(shade(c.surfaceElevated, 'black', 0.05))} !important;
  --s-color-bg-invert-tertiary: color-mix(in srgb, var(--agentskin-surface-elevated) 80%, var(--agentskin-bg)) !important;
  --s-color-bg-invert-tertiary-raw: ${rawRgb(shade(c.surfaceElevated, 'black', 0.1))} !important;
  --s-color-bg-invert-quaternary: color-mix(in srgb, var(--agentskin-surface-elevated) 70%, var(--agentskin-bg)) !important;
  --s-color-bg-invert-quaternary-raw: ${rawRgb(shade(c.surfaceElevated, 'black', 0.15))} !important;

  /* Inverse backgrounds (parallel "inverse" system — counterpart panels) */
  --s-color-bg-inverse-primary: var(--agentskin-surface-elevated) !important;
  --s-color-bg-inverse-primary-raw: ${rawRgb(c.surfaceElevated)} !important;
  --s-color-bg-inverse-secondary: color-mix(in srgb, var(--agentskin-surface-elevated) 88%, var(--agentskin-bg)) !important;
  --s-color-bg-inverse-secondary-raw: ${rawRgb(shade(c.surfaceElevated, 'black', 0.05))} !important;
  --s-color-bg-inverse-tertiary: color-mix(in srgb, var(--agentskin-surface-elevated) 80%, var(--agentskin-bg)) !important;
  --s-color-bg-inverse-tertiary-raw: ${rawRgb(shade(c.surfaceElevated, 'black', 0.1))} !important;
  --s-color-bg-inverse-quarternary: color-mix(in srgb, var(--agentskin-surface-elevated) 70%, var(--agentskin-bg)) !important;
  --s-color-bg-inverse-quarternary-raw: ${rawRgb(shade(c.surfaceElevated, 'black', 0.15))} !important;
  --s-color-bg-inverse-disable: color-mix(in srgb, var(--agentskin-muted) 40%, var(--agentskin-surface)) !important;
  --s-color-bg-inverse-disable-raw: ${rawRgb(shade(c.muted, 'white', 0.4))} !important;
  --s-color-bg-inverse-trans: color-mix(in srgb, var(--agentskin-text) 4%, transparent) !important;
  --s-color-bg-inverse-trans-tertiary: color-mix(in srgb, var(--agentskin-text) 3%, transparent) !important;
  --s-color-bg-inverse-trans-quarternary: color-mix(in srgb, var(--agentskin-text) 2%, transparent) !important;

  /* Invert text (text on dark/light inverted panels) */
  --s-color-text-invert-primary: var(--agentskin-text) !important;
  --s-color-text-invert-primary-raw: ${rawRgb(c.foreground)} !important;
  --s-color-text-invert-secondary: color-mix(in srgb, var(--agentskin-text) 85%, transparent) !important;
  --s-color-text-invert-tertiary: color-mix(in srgb, var(--agentskin-muted) 70%, transparent) !important;
  --s-color-text-invert-quaternary: color-mix(in srgb, var(--agentskin-muted) 50%, transparent) !important;
  --s-color-text-invert-disable: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;

  /* Intact text (text that should not be affected by theming) */
  --s-color-text-intact-primary: var(--agentskin-text) !important;
  --s-color-text-intact-primary-raw: ${rawRgb(c.foreground)} !important;
  --s-color-text-intact-secondary: color-mix(in srgb, var(--agentskin-text) 85%, transparent) !important;
  --s-color-text-intact-tertiary: color-mix(in srgb, var(--agentskin-muted) 70%, transparent) !important;
  --s-color-text-intact-quaternary: color-mix(in srgb, var(--agentskin-muted) 50%, transparent) !important;
  --s-color-text-intact-disable: color-mix(in srgb, var(--agentskin-muted) 40%, transparent) !important;

  /* Raw background values (used by rgba(var(--raw), alpha) patterns) */
  --s-color-bg-primary-raw: ${rawRgb(c.surface)} !important;
  --s-color-bg-secondary-raw: ${rawRgb(shade(c.surface, 'white', 0.04))} !important;
  --s-color-bg-tertiary-raw: ${rawRgb(shade(c.surface, 'black', 0.04))} !important;
  --s-color-bg-float-raw: ${rawRgb(c.surfaceElevated)} !important;

  /* Invert borders */
  --s-color-border-invert-primary: color-mix(in srgb, var(--agentskin-border) 60%, transparent) !important;
  --s-color-border-invert-primary-raw: ${rawRgb(c.border)} !important;
  --s-color-border-invert-tertiary: color-mix(in srgb, var(--agentskin-border) 30%, transparent) !important;
  --s-color-border-invert-tertiary-raw: ${rawRgb(c.border)} !important;
  --s-color-border-secondary-raw: ${rawRgb(c.border)} !important;
  --s-color-border-tertiary-raw: ${rawRgb(c.border)} !important;

  /* System status colors — fixed semantic hues independent of theme accent.
     Previously all derived from c.accent, making success/warning/error
     indistinguishable (all looked like the brand color). Now each uses its
     canonical hue, blended with the theme bg for harmony. */
  --s-color-system-success: #3ecf8e !important;
  --s-color-system-success-raw: 62, 207, 142 !important;
  --s-color-system-success-lighten: color-mix(in srgb, #3ecf8e 14%, var(--agentskin-bg)) !important;
  --s-color-system-success-lighten-raw: 62, 207, 142 !important;
  --s-color-system-success-darken: color-mix(in srgb, #3ecf8e 75%, #000) !important;
  --s-color-system-success-darken-raw: 47, 155, 107 !important;
  --s-color-system-alert: var(--agentskin-accent) !important;
  --s-color-system-alert-lighten: color-mix(in srgb, var(--agentskin-accent) 12%, var(--agentskin-bg)) !important;
  --s-color-system-alert-lighten-raw: ${rawRgb(c.accent)} !important;
  --s-color-system-alert-darken: ${shade(c.accent, 'black', 0.2)} !important;
  --s-color-system-alert-darken-raw: ${rawRgb(shade(c.accent, 'black', 0.2))} !important;
  --s-color-system-warning: #f5a623 !important;
  --s-color-system-warning-raw: 245, 166, 35 !important;
  --s-color-system-warning-lighten: color-mix(in srgb, #f5a623 14%, var(--agentskin-bg)) !important;
  --s-color-system-warning-lighten-raw: 245, 166, 35 !important;
  --s-color-system-warning-darken: color-mix(in srgb, #f5a623 75%, #000) !important;
  --s-color-system-warning-darken-raw: 184, 125, 26 !important;

  /* Accent palette — grey stays theme-derived; green/yellow/red use fixed
     semantic hues so tags/badges keep their meaning across themes. */
  --s-color-accents-grey-pale: color-mix(in srgb, var(--agentskin-muted) 15%, var(--agentskin-surface)) !important;
  --s-color-accents-grey-pale-raw: ${rawRgb(shade(c.muted, 'white', 0.3))} !important;
  --s-color-accents-grey: var(--agentskin-muted) !important;
  --s-color-accents-grey-raw: ${rawRgb(c.muted)} !important;
  --s-color-accents-green: #3ecf8e !important;
  --s-color-accents-green-raw: 62, 207, 142 !important;
  --s-color-accents-yellow: #f5a623 !important;
  --s-color-accents-yellow-raw: 245, 166, 35 !important;
  --s-color-accents-red: #e64949 !important;
  --s-color-accents-red-raw: 230, 73, 73 !important;
  --s-color-accents-purple: var(--agentskin-secondary) !important;
  --s-color-accents-purple-raw: ${rawRgb(c.secondary)} !important;
  --s-color-accents-orange: ${shade(c.accent, 'black', 0.1)} !important;
  --s-color-accents-orange-raw: ${rawRgb(shade(c.accent, 'black', 0.1))} !important;

  /* Alert/warning/success semantic colors — fixed hues, independent of accent */
  --s-color-alert: var(--agentskin-accent) !important;
  --s-color-warning: #f5a623 !important;
  --s-color-warning-raw: 245, 166, 35 !important;
  --s-color-success: #3ecf8e !important;
  --s-color-success-raw: 62, 207, 142 !important;
  --s-color-element-comment: ${alpha(c.accent, 0.2)} !important;
  --s-color-element-comment-raw: ${rawRgb(c.accent)} !important;

  /* Glow gradients — accent-driven */
  --s-color-glow-grey: linear-gradient(283deg, ${alpha(c.muted, 0.8)} 0%, ${alpha(c.muted, 0.6)} 100%) !important;
  --s-color-glow-blue: linear-gradient(283deg, ${alpha(c.accent, 0.8)} 0%, ${alpha(c.secondary, 0.8)} 100%) !important;
  --s-color-glow-green: linear-gradient(283deg, ${alpha(shade(c.accent, 'white', 0.2), 0.8)} 0%, ${alpha(shade(c.accent, 'white', 0.1), 0.8)} 100%) !important;
  --s-color-glow-yellow: linear-gradient(283deg, ${alpha(shade(c.accent, 'white', 0.4), 0.8)} 0%, ${alpha(shade(c.accent, 'white', 0.2), 0.8)} 100%) !important;
  --s-color-glow-red: linear-gradient(283deg, ${alpha(shade(c.accent, 'black', 0.2), 0.8)} 0%, ${alpha(shade(c.accent, 'black', 0.3), 0.8)} 100%) !important;
  --s-color-glow-purple: linear-gradient(283deg, ${alpha(c.secondary, 0.8)} 0%, ${alpha(shade(c.secondary, 'black', 0.1), 0.8)} 100%) !important;
  --s-color-glow-black: radial-gradient(64.76% 100% at 49.62% 100%, ${alpha(c.foreground, 0.15)} 0%, transparent 70%) !important;
  --s-color-glow-black-hover: radial-gradient(64.76% 100% at 49.62% 100%, ${alpha(c.foreground, 0.25)} 0%, transparent 70%) !important;
  --s-color-glow-white: radial-gradient(64.76% 100% at 49.62% 100%, ${alpha(c.foreground, 0.1)} 0%, transparent 70%) !important;
  --s-color-glow-white-hover: radial-gradient(64.76% 100% at 49.62% 100%, ${alpha(c.foreground, 0.2)} 0%, transparent 70%) !important;

  /* Gradient backgrounds — themed washes */
  --s-color-gradient-blue: linear-gradient(93deg, ${alpha(c.accent, 0.06)} -1.22%, ${alpha(c.secondary, 0.06)} 101.66%) !important;
  --s-color-gradient-blue-hover: linear-gradient(93deg, ${alpha(c.accent, 0.08)} -1.22%, ${alpha(c.secondary, 0.08)} 101.66%) !important;
  --s-color-gradient-blue-orange: linear-gradient(87deg, ${alpha(c.accent, 0.06)} 5.11%, ${alpha(shade(c.accent, 'white', 0.2), 0.06)} 95.48%) !important;
  --s-color-gradient-blue-purple: linear-gradient(88deg, ${alpha(c.accent, 0.06)} 12.33%, ${alpha(c.secondary, 0.06)} 102.89%) !important;
  --s-color-gradient-purple-trans: linear-gradient(283deg, ${alpha(c.secondary, 0.05)} 0%, ${alpha(shade(c.secondary, 'black', 0.1), 0.05)} 100%) !important;

  /* Horizon gradients — subtle themed washes on white */
  --s-color-horizon-gradient-blue: linear-gradient(109deg, var(--agentskin-bg) 45.34%, ${alpha(c.accent, 0.08)} 102.43%) !important;
  --s-color-horizon-gradient-red: linear-gradient(109deg, var(--agentskin-bg) 45.34%, ${alpha(shade(c.accent, 'black', 0.2), 0.08)} 102.43%) !important;
  --s-color-horizon-gradient-purple: linear-gradient(109deg, var(--agentskin-bg) 45.34%, ${alpha(c.secondary, 0.08)} 102.43%) !important;
  --s-color-horizon-gradient-green: linear-gradient(109deg, var(--agentskin-bg) 45.34%, ${alpha(shade(c.accent, 'white', 0.2), 0.08)} 102.43%) !important;
  --s-color-horizon-gradient-grey: linear-gradient(109deg, var(--agentskin-bg) 45.34%, ${alpha(c.muted, 0.08)} 102.43%) !important;

  /* Chat-level token overrides (code blocks, task cards) */
  --chat-bg-color: transparent !important;
  --chat-md-codeblock-bg-color: var(--agentskin-code-bg) !important;
  --chat-md-codeblock-header-bg-color: var(--agentskin-surface) !important;
  --chat-task-card-container-bg-color: color-mix(in srgb, var(--agentskin-surface) 88%, var(--agentskin-bg)) !important;

  /* FFC static/neutral tokens */
  --ffc-text-static-white: var(--agentskin-text) !important;
  --ffc-static-black: var(--agentskin-bg) !important;
  --ffc-button-brand-icon-color: #ffffff !important;
  --ffc-neutral-00-60: ${alpha(c.foreground, 0.6)} !important;
  --ffc-neutral-1000-5: ${alpha(c.muted, 0.05)} !important;
  --ffc-skeleton-start: ${alpha(c.foreground, 0.04)} !important;
  --ffc-skeleton-middle: ${alpha(c.foreground, 0.08)} !important;

  /* Brand shadows — disabled to prevent jarring line above input area */
  --s-shadow-lv1-brand: none !important;
  --s-shadow-lv2-brand: none !important;
  --s-shadow-lv3-brand: none !important;
  --s-shadow-lv4-brand: none !important;
  --s-shadow-lv5-brand: none !important;
  --s-shadow-level0-brand: none !important;
  --s-shadow-level1-brand: none !important;
  --s-shadow-level2-brand: none !important;
  --s-shadow-level3-brand: none !important;
  --s-shadow-level4-brand: none !important;
  --s-shadow-level5-brand: none !important;
}

/* ===== Art layer: body::before fixed pseudo-element =====
   Using a fixed pseudo-element instead of background-attachment:fixed on body
   because Doubao's DOM has transformed children that create new containing
   blocks, causing background-attachment:fixed to duplicate the hero image. */
${host} body {
  color: ${c.foreground} !important;
  background: transparent !important;
}
${host} body::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--agentskin-surface) ${p.washLeft}%, transparent) 0 16%,
      color-mix(in srgb, var(--agentskin-surface) ${p.washMid}%, transparent) 44%,
      transparent 70%),
    linear-gradient(180deg, transparent 0 50%,
      color-mix(in srgb, var(--agentskin-surface) ${p.washBottom}%, transparent) 86% 100%),
    radial-gradient(120% 80% at 84% 14%,
      color-mix(in srgb, ${p.glowColor} ${p.glowStrength}%, transparent), transparent 60%),
    var(--codedrobe-art, none) right center / cover no-repeat !important;
}

/* ===== Transparency punch-through ===== */
${host} [class*="container"],
${host} [class*="chat-wrapper"],
${host} [class*="message-list"],
${host} [class*="conversation"],
${host} [class*="sidebar"],
${host} [class*="panel"]:not([class*="float"]):not([class*="modal"]) {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}

/* Main layout containers — fully transparent so body art shows through directly */
${host} [class*="bg-s-color-bg-body"],
${host} [class*="center-bg"],
${host} [class*="main-with-nav"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}

/* ===== Titlebar (header row with minimize/maximize/close) =====
   NOTE: only target "h-header-height" (the actual titlebar element).
   The broader "header-height" pattern accidentally matches the main content
   area (class contains -mt-[var(--header-height)]) and blocks the hero. */
${host} [class*="h-header-height"] {
  background: color-mix(in srgb, var(--agentskin-surface) 8%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
  border-bottom: none !important;
}

${host} [class*="h-header-height"] button {
  background: transparent !important;
  color: var(--agentskin-text) !important;
  transition: background 140ms ease !important;
}

${host} [class*="h-header-height"] button:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
}

/* Suggestion / welcome / guide / topic cards — subtle surface tint, no border */
${host} [class*="suggest"],
${host} [class*="welcome"],
${host} [class*="guide"],
${host} [class*="recommend"],
${host} [class*="topic"],
${host} [class*="quick-action"],
${host} [class*="shortcut"] {
  background: color-mix(in srgb, var(--agentskin-surface) 20%, transparent) !important;
  border: none !important;
  backdrop-filter: blur(8px) !important;
}

${host} [class*="suggest"]:hover,
${host} [class*="welcome"]:hover,
${host} [class*="guide"]:hover,
${host} [class*="recommend"]:hover,
${host} [class*="topic"]:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
}

/* Suggestion cards: kill ALL border-like effects + stacked backdrop-filter */
${host} [class*="suggest"],
${host} [class*="recommend"],
${host} [class*="topic"] {
  outline: none !important;
  box-shadow: none !important;
  border-image: none !important;
}
${host} [class*="suggest"] *,
${host} [class*="recommend"] *,
${host} [class*="topic"] * {
  border-color: transparent !important;
  outline: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

/* Hide Doubao's own welcome illustration / decorative images (pink character etc.)
   so our hero.webp on body::before shows through cleanly */
${host} [class*="welcome"] img,
${host} [class*="home-bg"] img,
${host} [class*="illustration"],
${host} [class*="home-illustration"],
${host} [class*="welcome-image"],
${host} [class*="guide-image"],
${host} [class*="mascot"] {
  display: none !important;
}

/* Hide broken decorative elements (black blocks) near heading */
${host} [class*="welcome"] svg,
${host} [class*="home-header"] img,
${host} [class*="greeting"] img,
${host} [class*="logo-decoration"] {
  display: none !important;
}

/* Hide greeting pseudo-element color block (opaque dark ::after overlay) */
${host} [class*="greeting-text"]::after,
${host} [class*="greeting-text"]::before {
  display: none !important;
}

/* Input area — warm frosted glass, accent-harmonized border (ref: qoderwork composer) */
${host} [class*="input-box"],
${host} [class*="chat-input"],
${host} [class*="composer"],
${host} [class*="input-container"],
${host} [class*="editor-wrap"],
${host} [class*="input-guidance"],
${host} [class*="input-wrapper"],
${host} [class*="input-area"] {
  background: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent) !important;
  border: 1px solid ${alpha(c.accent, 0.15)} !important;
  border-radius: var(--dbx-radius-4xl, 24px) !important;
  border-image: none !important;
  outline: none !important;
  box-shadow: none !important;
  backdrop-filter: blur(24px) saturate(1.25) !important;
  overflow: hidden !important;
}

${host} [class*="input-box"]:focus-within,
${host} [class*="chat-input"]:focus-within,
${host} [class*="composer"]:focus-within,
${host} [class*="input-guidance"]:focus-within {
  border-color: ${alpha(c.accent, 0.3)} !important;
}

/* Kill pseudo-element decorations (shadow line above input) */
${host} [class*="input-box"]::before,
${host} [class*="chat-input"]::before,
${host} [class*="input-guidance"]::before,
${host} [class*="composer"]::before,
${host} [class*="input-box"]::after,
${host} [class*="chat-input"]::after,
${host} [class*="input-guidance"]::after,
${host} [class*="composer"]::after {
  display: none !important;
}

/* Inner elements: no extra borders, only harmonized accent tint */
${host} [class*="input-box"] *,
${host} [class*="chat-input"] *,
${host} [class*="composer"] *,
${host} [class*="input-container"] *,
${host} [class*="input-guidance"] * {
  border-color: ${alpha(c.accent, 0.1)} !important;
  outline: none !important;
  box-shadow: none !important;
}

/* Innermost editor/textarea (where the cursor lives): remove border entirely
   so the user only sees the outer container's border, not a stacked inner one. */
${host} [class*="input-box"] textarea,
${host} [class*="chat-input"] textarea,
${host} [class*="composer"] textarea,
${host} [class*="input-guidance"] textarea,
${host} [class*="input-box"] [contenteditable="true"],
${host} [class*="chat-input"] [contenteditable="true"],
${host} [class*="composer"] [contenteditable="true"],
${host} [class*="input-guidance"] [contenteditable="true"],
${host} [class*="input-box"] [class*="editor"],
${host} [class*="chat-input"] [class*="editor"],
${host} [class*="composer"] [class*="editor"],
${host} [class*="input-guidance"] [class*="editor"] {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
}

/* ===== Frosted sidebar — ultra transparent ===== */
${host} [class*="sidebar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 10%, transparent) !important;
  border-right: none !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}

/* Sidebar conversation items — transparent with accent hover */
${host} [class*="sidebar"] [class*="item"],
${host} [class*="sidebar"] [class*="session"],
${host} [class*="sidebar"] a,
${host} [class*="nav-list"] [class*="item"] {
  background: transparent !important;
}

${host} [class*="sidebar"] [class*="item"]:hover,
${host} [class*="sidebar"] [class*="session"]:hover,
${host} [class*="sidebar"] a:hover {
  background: color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
}

/* ===== Extra punch-through: Doubao opaque containers ===== */
${host} [class*="content-area"],
${host} [class*="chat-content"],
${host} [class*="main-content"],
${host} [class*="layout-body"],
${host} [class*="page-wrapper"],
${host} [class*="chat-area"],
${host} [class*="message-container"],
${host} [class*="card-container"],
${host} [class*="list-wrapper"],
${host} [class*="scroll-area"],
${host} [class*="body-wrapper"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}

/* ===== Message bubbles: subtle surface tint, no border ===== */
${host} [class*="message"][class*="bubble"],
${host} [class*="msg-content"],
${host} [class*="message-content"],
${host} [class*="bubble"] {
  background: color-mix(in srgb, var(--agentskin-surface) 25%, transparent) !important;
  border: none !important;
  backdrop-filter: blur(6px) !important;
}

/* ===== Active nav / selected items: accent tint only ===== */
${host} [class*="active"],
${host} [class*="selected"],
${host} [aria-selected="true"] {
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
  border: none !important;
}

/* ===== Button color harmonization =====
   Unify all button variants around a coherent palette:
   - Primary/brand: accent fill + clean white text (not muddy background brown)
   - Outlined/secondary: transparent + accent border + accent text
   - Ghost/icon: transparent + accent hover tint
   - AI buttons: keep gradient but align text color */
${host} button[class*="primary"],
${host} button[class*="send"],
${host} [class*="btn-primary"],
${host} [class*="btn-brand"] {
  background: ${c.accent} !important;
  color: #ffffff !important;
  border: none !important;
  transition: filter 140ms ease, background 140ms ease !important;
}

${host} button[class*="primary"]:hover,
${host} button[class*="send"]:hover,
${host} [class*="btn-primary"]:hover,
${host} [class*="btn-brand"]:hover {
  background: ${shade(c.accent, 'black', 0.12)} !important;
  filter: brightness(1.05) !important;
}

${host} button[class*="primary"]:active,
${host} button[class*="send"]:active,
${host} [class*="btn-primary"]:active,
${host} [class*="btn-brand"]:active {
  background: ${shade(c.accent, 'black', 0.24)} !important;
  filter: brightness(0.95) !important;
}

/* Outlined / secondary buttons: transparent bg + accent border + accent text */
${host} button[class*="outlined"],
${host} button[class*="secondary"],
${host} [class*="btn-outlined"],
${host} [class*="btn-secondary"],
${host} [class*="outline-btn"] {
  background: transparent !important;
  color: var(--agentskin-accent) !important;
  border: 1px solid ${alpha(c.accent, 0.4)} !important;
  transition: background 140ms ease, border-color 140ms ease !important;
}

${host} button[class*="outlined"]:hover,
${host} button[class*="secondary"]:hover,
${host} [class*="btn-outlined"]:hover,
${host} [class*="btn-secondary"]:hover,
${host} [class*="outline-btn"]:hover {
  background: ${alpha(c.accent, 0.1)} !important;
  border-color: ${alpha(c.accent, 0.6)} !important;
}

/* Ghost / icon buttons: transparent + accent hover */
${host} button[class*="ghost"],
${host} button[class*="icon"]:not([class*="icon-bg"]),
${host} [class*="btn-ghost"],
${host} [class*="icon-btn"]:not([class*="brand"]) {
  background: transparent !important;
  color: var(--agentskin-text) !important;
  border: none !important;
  transition: background 140ms ease, color 140ms ease !important;
}

${host} button[class*="ghost"]:hover,
${host} button[class*="icon"]:not([class*="icon-bg"]):hover,
${host} [class*="btn-ghost"]:hover,
${host} [class*="icon-btn"]:not([class*="brand"]):hover {
  background: ${alpha(c.accent, 0.12)} !important;
  color: var(--agentskin-accent) !important;
}

/* AI buttons: align text to white for consistency with primary */
${host} [class*="ai-button"],
${host} [class*="ai-btn"],
${host} button[class*="ai"] {
  color: #ffffff !important;
}

/* Disabled state: unified muted appearance */
${host} button:disabled,
${host} button[class*="disabled"],
${host} [class*="btn"][class*="disabled"] {
  background: ${alpha(c.foreground, 0.08)} !important;
  color: ${alpha(c.muted, 0.5)} !important;
  border: none !important;
  cursor: not-allowed !important;
  opacity: 1 !important;
}

/* ===== Vignette edge glow for drama =====
   Kept subtle (18%) so the hero art stays visible through the edges. */
${host} body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background:
    radial-gradient(ellipse 120% 100% at 50% 50%, transparent 60%, ${alpha(c.background, 0.18)} 100%),
    linear-gradient(180deg, ${alpha(c.accent, 0.03)} 0%, transparent 8%),
    linear-gradient(0deg, ${alpha(c.accent, 0.04)} 0%, transparent 6%);
}

/* ===== Selection ===== */
${host} ::selection {
  background: ${alpha(c.accent, 0.32)} !important;
}

/* ===== Scrollbars ===== */
${host} ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

${host} ::-webkit-scrollbar-track {
  background: transparent;
}

${host} ::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg,
    ${alpha(c.accent, 0.3)} 0%,
    ${alpha(c.secondary, 0.3)} 100%) !important;
  border-radius: 8px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
}

${host} ::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg,
    ${alpha(c.accent, 0.5)} 0%,
    ${alpha(c.secondary, 0.5)} 100%) !important;
  background-clip: padding-box !important;
}

@media (prefers-reduced-motion: reduce) {
  ${host} *,
  ${host} *::before,
  ${host} *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const GENERATORS = {
  traework: traeworkCss,
  qoderwork: qoderworkCss,
  workbuddy: workbuddyCss,
  doubao: doubaoCss,
};

function buildContext(id, manifest) {
  const c = manifest.colors ?? {};
  const required = ['accent', 'secondary', 'background', 'foreground', 'muted', 'surface',
    'surfaceElevated', 'border', 'codeBackground', 'codeForeground', 'inputBackground',
    'buttonBackground', 'buttonForeground', 'focusRing'];
  for (const key of required) {
    if (!c[key]) throw new Error(`themes/${id}: missing colors.${key}`);
  }
  const mode = manifest.mode === 'light' ? 'light' : 'dark'; // auto → dark (dark canvas)
  return {
    id,
    name: manifest.displayName || manifest.name,
    mode,
    isLight: mode === 'light',
    colors: c,
  };
}

let count = 0;
let stale = 0;
const verifyMode = process.argv.includes('--verify') || process.argv.includes('-v');

for (const id of fs.readdirSync(THEMES_DIR).sort()) {
  const themeDir = path.join(THEMES_DIR, id);
  const manifestPath = path.join(themeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  // Flat / CSS-only themes (e.g. the WeChat skin) ship hand-written CSS and
  // declare "art": false; the art-based generator must not clobber them.
  if (manifest.art === false) {
    console.log(`[generate-theme-css] ${id}: skipped (flat theme, art=false)`);
    continue;
  }
  const ctx = buildContext(id, manifest);
  const cssDir = path.join(themeDir, 'assets', 'css');
  if (!verifyMode) fs.mkdirSync(cssDir, { recursive: true });
  for (const [agent, generate] of Object.entries(GENERATORS)) {
    const css = generate(ctx);
    const cssPath = path.join(cssDir, `${agent}.css`);
    if (verifyMode) {
      if (!fs.existsSync(cssPath)) {
        console.error(`[generate-theme-css:verify] ${id}/${agent}.css MISSING — run 'npm run generate:theme-css'`);
        stale++;
        continue;
      }
      const actual = fs.readFileSync(cssPath, 'utf8');
      if (actual !== css) {
        console.error(`[generate-theme-css:verify] ${id}/${agent}.css STALE — run 'npm run generate:theme-css'`);
        stale++;
      }
    } else {
      fs.writeFileSync(cssPath, css, 'utf8');
      count += 1;
    }
  }
  if (!verifyMode) {
    console.log(`[generate-theme-css] ${id} (${ctx.mode})${manifest.dynamic ? ` [dynamic:${manifest.dynamic}]` : ''}`);
  }
}

if (verifyMode) {
  if (stale > 0) {
    console.error(`\n[generate-theme-css:verify] ${stale} CSS file(s) stale or missing.`);
    process.exit(1);
  }
  console.log(`[generate-theme-css:verify] all CSS files up-to-date.`);
} else {
  console.log(`[generate-theme-css] wrote ${count} CSS files.`);
}
