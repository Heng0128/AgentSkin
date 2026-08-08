// SPDX-License-Identifier: MPL-2.0
import { tokenBlock, computeArtParams, alpha, shade, rawRgb } from '../theme-utils.mjs';

function doubaoCss(t) {
  const c = t.colors;
  const host = 'html.agentskin-host-doubao';
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
   Our html.agentskin-host-doubao:root body = (0,2,2) beats it. */
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
    var(--agentskin-art, none) right center / cover no-repeat !important;
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

export default doubaoCss;
