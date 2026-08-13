// SPDX-License-Identifier: MPL-2.0
import { alpha, artLayerCss, shade, tokenBlock } from '../theme-utils.mjs';

function qoderworkCss(t) {
  const c = t.colors;
  const host = 'html.agentskin-host-qoderwork';

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
  const bgLayout = t.isLight
    ? shade(c.background, 'white', 0.02)
    : shade(c.background, 'black', 0.04);
  const bgSpotlight = t.isLight
    ? shade(c.background, 'white', 0.04)
    : shade(c.background, 'black', 0.08);
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

export default qoderworkCss;
