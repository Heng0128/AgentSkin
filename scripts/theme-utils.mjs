// SPDX-License-Identifier: MPL-2.0
//
// # theme-utils.mjs — pure CSS utility functions for theme generation (no I/O).
//
// Extracted from theme-generators.mjs so the per-agent generators and this
// utility module can be imported separately. All functions are pure:
// colors in, CSS string out.

import { luminance } from './utils/color-utils.mjs';

export function parseColor(input) {
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
export function alpha(input, a) {
  const c = parseColor(input);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number((c.a * a).toFixed(3))})`;
}

/** Pre-mixed rgb string: mix(color, white|black, amount) for subtle tints. */
export function shade(input, target, a) {
  const c = parseColor(input);
  const t = target === 'white' ? 255 : 0;
  const mix = (v) => Math.round(v + (t - v) * a);
  return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`;
}

/** Raw "R, G, B" string for Doubao's -raw variable pattern. */
export function rawRgb(input) {
  const c = parseColor(input);
  return `${c.r}, ${c.g}, ${c.b}`;
}

// ---------------------------------------------------------------------------
// Color fallbacks — used by buildContext to substitute missing/invalid colors
// so downstream generators (tokenBlock, shellTokenOverrides, …) never crash
// on a malformed value (H-6).
// ---------------------------------------------------------------------------

const COLOR_FALLBACKS = {
  accent: '#4a90d9',
  secondary: '#7a8a99',
  background: '#1e1e1e',
  foreground: '#e0e0e0',
  muted: '#888888',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  inputBackground: '#2a2a2a',
  buttonBackground: '#4a90d918',
  buttonForeground: '#4a90d9',
  // NOTE: focusRing is intentionally NOT in COLOR_FALLBACKS. It is a derived
  // token (color-mix(accent 40%), see build-palette.mjs + deriveTokens()).
  // The "absent" state must reach tokenBlock() so it can derive from accent
  // instead of emitting a hardcoded fallback that ignores the theme accent.
  // buildContext() handles focusRing explicitly below.
};

const COLOR_KEYS = Object.keys(COLOR_FALLBACKS);

/**
 * Try to parse a color value, returning the parsed object on success or
 * null on failure (logging a diagnostic warning).  Lets buildContext
 * detect invalid colors and substitute a safe fallback instead of
 * propagating the throw into the CSS generators.
 */
function tryParseColor(input, ctx) {
  try {
    return parseColor(input);
  } catch {
    console.warn(`theme-utils: ${ctx} invalid color "${input}", using fallback`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-theme art overlay parameters (derived from color characteristics)
// ---------------------------------------------------------------------------

/** HSL saturation (0–1) from a parsed color. */
export function saturation(input) {
  const c = parseColor(input);
  const r = c.r / 255,
    g = c.g / 255,
    b = c.b / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
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
export function computeArtParams(t) {
  const c = t.colors;
  const bgLum = luminance(c.background);
  const accentSat = saturation(c.accent);

  // Wash opacity: left-side (strongest) and bottom fade.
  // Kept deliberately low so the hero art stays visible and the color
  // overlay feels like a tint rather than a solid block.
  let washLeft, washMid, washBottom;
  if (t.isLight) {
    washLeft = 42;
    washMid = 14;
    washBottom = 38;
  } else if (bgLum < 0.012) {
    // Very dark bg (arina, gothic, midnight-aurora): hero dominates
    washLeft = 26;
    washMid = 8;
    washBottom = 20;
  } else if (bgLum < 0.03) {
    // Dark colored bg (naruto, sasuke, wuthering, deepspace-star): light wash
    washLeft = 32;
    washMid = 12;
    washBottom = 26;
  } else {
    // Moderate dark bg
    washLeft = 38;
    washMid = 14;
    washBottom = 32;
  }

  // Radial glow strength: pushed higher for strong visual impact
  const glowStrength = t.isLight
    ? Math.round(14 + accentSat * 12) // 14–26% for light
    : Math.round(16 + accentSat * 20); // 16–36% for dark

  // Glow color: use secondary if it has different hue from accent (contrast)
  const glowColor =
    saturation(c.secondary) > 0.3 && c.secondary !== c.accent
      ? 'var(--agentskin-secondary)'
      : 'var(--agentskin-accent)';

  return { washLeft, washMid, washBottom, glowStrength, glowColor };
}

/** Generate the shared art-layer CSS block for a given host selector.
 *  Uses #root::before with position:fixed instead of background-attachment:fixed
 *  to avoid duplication when child elements have CSS transform (new containing block). */
export function artLayerCss(host, t) {
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
    var(--agentskin-art, none) right center / cover no-repeat !important;
}`;
}

// ---------------------------------------------------------------------------
// Shared token block (parsed by theme-library extractColors / detectMode)
// ---------------------------------------------------------------------------

/**
 * Generate the 14-token agentskin palette block.
 *
 * @param {object} t - Theme context from buildContext().
 * @param {string} [host=':root'] - CSS selector to scope variables under.
 * @param {Record<string,string>|null} [bridge=null] - Optional variable bridge
 *   map: client-native CSS variable → agentskin token reference or literal color.
 *   When provided, each entry is emitted inside the same `:root` block so the
 *   client application resolves its native namespace through the bridge.
 * @returns {string} CSS declaration block.
 */
export function tokenBlock(t, host = ':root', bridge = null) {
  const c = t.colors;
  const bridgeEntries = bridge && typeof bridge === 'object' ? Object.entries(bridge) : [];
  const bridgeLines = bridgeEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const bridgeBlock = bridgeLines ? `\n${bridgeLines}` : '';
  return `${host} {
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
  --agentskin-focus-ring: ${c.focusRing || `color-mix(in srgb, ${c.accent} 40%, transparent)`};
  --agentskin-selection: color-mix(in srgb, ${c.accent} 32%, transparent);
  --agentskin-text-shadow: ${t.isLight ? '0 1px 2px rgba(255,255,255,0.6)' : '0 1px 3px rgba(0,0,0,0.5)'};
  text-shadow: var(--agentskin-text-shadow);${bridgeBlock}
}`;
}

/** Scoped generic rules shared by the two shell-style agents. */
export function sharedChromeRules(host, t) {
  const c = t.colors;
  const textShadow = t.isLight ? '0 1px 2px rgba(255,255,255,0.6)' : '0 1px 3px rgba(0,0,0,0.5)';
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
// ZCode / Codex (generic --text-*/--bg-* design-token shells)
// ---------------------------------------------------------------------------

/** Native design-token override block shared by the two shell-style agents.
 *  Both ZCode and Codex expose a flat text/bg/accent CSS-variable system;
 *  overriding the variables on :root (they inherit everywhere) is cheaper
 *  than the historical per-element `host *` scoping. */
export function shellTokenOverrides(host, t) {
  const c = t.colors;
  const accentHover = shade(c.accent, 'white', 0.15);
  const accentPressed = shade(c.accent, 'white', 0.25);
  const buttonPrimaryFg = t.isLight ? '#ffffff' : shade(c.background, 'black', 0.85);
  const inputMix = `color-mix(in srgb, color-mix(in srgb, ${c.surface} 82%, ${c.accent} 18%) 45%, transparent)`;
  const sidebarMix = `color-mix(in srgb, color-mix(in srgb, ${c.surface} 82%, ${c.accent} 18%) 22%, transparent)`;
  const panelBg = `color-mix(in srgb, ${c.surface} 14%, transparent)`;
  return `${host} {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;

  /* Text hierarchy */
  --text-primary: ${c.foreground} !important;
  --text-secondary: ${c.muted} !important;
  --text-tertiary: ${alpha(c.foreground, 0.55)} !important;
  --text-quaternary: ${alpha(c.foreground, 0.4)} !important;

  /* Backgrounds — transparent for art punch-through */
  --bg-primary: transparent !important;
  --bg-secondary: ${shade(c.surface, 'black', 0.1)} !important;
  --bg-tertiary: color-mix(in srgb, ${c.surfaceElevated} 85%, ${c.accent} 15%) !important;
  --bg-elevated: ${c.surfaceElevated} !important;
  --bg-base: transparent !important;
  --bg-canvas: transparent !important;
  --bg-surface: color-mix(in srgb, ${c.surface} 80%, transparent) !important;
  --bg-hover: ${alpha(c.accent, 0.1)} !important;
  --bg-active: ${alpha(c.accent, 0.16)} !important;
  --bg-selected: ${alpha(c.accent, 0.14)} !important;

  /* Borders */
  --border-xsubtle: ${alpha(c.accent, 0.045)} !important;
  --border-subtle: ${alpha(c.accent, 0.09)} !important;
  --border-medium: ${alpha(c.accent, 0.18)} !important;
  --border-strong: ${alpha(c.accent, 0.144)} !important;

  /* Accent / brand */
  --accent: ${c.accent} !important;
  --accent-hover: ${accentHover} !important;
  --accent-pressed: ${accentPressed} !important;
  --accent-soft: ${alpha(c.accent, 0.12)} !important;
  --accent-soft-hover: ${alpha(c.accent, 0.18)} !important;

  /* Buttons */
  --button-primary-bg: ${c.accent} !important;
  --button-primary-fg: ${buttonPrimaryFg} !important;
  --button-primary-hover: ${accentHover} !important;
  --button-secondary-bg: ${alpha(c.foreground, 0.12)} !important;
  --button-secondary-fg: ${c.foreground} !important;

  /* Links */
  --link: ${c.accent} !important;
  --link-hover: ${accentHover} !important;

  /* Input / composer */
  --input-bg: ${inputMix} !important;
  --input-border: ${alpha(c.accent, 0.18)} !important;
  --input-focus-ring: ${alpha(c.accent, 0.4)} !important;

  /* Sidebar / panels */
  --sidebar-bg: ${sidebarMix} !important;
  --panel-bg: ${panelBg} !important;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12) !important;
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.18) !important;
  --shadow-xl: 0 12px 40px rgba(0, 0, 0, 0.24) !important;

  /* Selection */
  --selection-bg: ${alpha(c.accent, 0.28)} !important;

  /* Code blocks */
  --code-bg: ${c.codeBackground} !important;
  --code-fg: ${c.codeForeground} !important;
}`;
}

// ---------------------------------------------------------------------------
// Codex native token overrides (--color-token-* system)
// ---------------------------------------------------------------------------

/**
 * Codex-native token overrides.
 *
 * Live Codex (v26.x, `app://-/`) drives its ENTIRE visual identity through the
 * `--color-token-*` namespace pinned on :root — 25 tokens as of the v26.814
 * probe (bg-primary, side-bar-background, main-surface-primary, foreground /
 * text-*, border*, primary, focus-border, dropdown-*, list-hover-background,
 * …). The shared `shellTokenOverrides` block instead maps the palette onto a
 * flat `--text-*` / `--bg-*` / `--accent-*` system that Codex does NOT expose
 * (confirmed: `:root` 0, aggregated 0) → silent no-op, leaving Codex on its
 * native colors and making every theme "fake-complete" on Codex.
 *
 * This function maps the 14-token palette onto the REAL `--color-token-*`
 * system. Borders follow the established accent-alpha derivation used by
 * `shellTokenOverrides` (subtle, theme-tinted). Semantic/fixed tokens are left
 * native on purpose: `--color-token-editor-warning-foreground` (warning hue)
 * and `--color-token-charts-blue` (data-viz brand) must not be re-skinned.
 *
 * Helper vars (`--accent` / `--bg-hover` / `--bg-active` / `--bg-selected`)
 * are re-declared here because `shellStructureCss` consumes them and we no
 * longer call `shellTokenOverrides`.
 */
export function codexColorTokenOverrides(host, t) {
  const c = t.colors;
  const bLight = alpha(c.accent, 0.045);
  const bDefault = alpha(c.accent, 0.09);
  const bHeavy = alpha(c.accent, 0.156);
  const hoverBg = alpha(c.accent, 0.078);
  const focusB = alpha(c.accent, 0.76);
  return `${host} {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;

  /* Accent / brand */
  --color-token-primary: ${c.accent} !important;
  --color-token-text-link-foreground: ${c.accent} !important;
  --color-token-focus-border: ${focusB} !important;

  /* App + surface backgrounds */
  --color-token-bg-primary: ${c.background} !important;
  --color-token-side-bar-background: ${c.background} !important;
  --color-token-bg-secondary: color-mix(in srgb, ${c.background} 92%, transparent) !important;
  --color-token-bg-tertiary: color-mix(in srgb, ${c.background} 85%, transparent) !important;
  --color-token-main-surface-primary: ${c.surface} !important;
  --color-token-diff-surface: color-mix(in srgb, ${c.surface} 94%, ${c.foreground}) !important;
  --color-token-dropdown-background: ${c.surfaceElevated} !important;
  --color-token-dropdown-foreground: ${c.foreground} !important;

  /* Foreground / text */
  --color-token-foreground: ${c.foreground} !important;
  --color-token-text-primary: ${c.foreground} !important;
  --color-token-text-secondary: color-mix(in srgb, ${c.foreground} 65%, transparent) !important;
  --color-token-text-tertiary: ${alpha(c.foreground, 0.498)} !important;
  --color-token-description-foreground: ${alpha(c.foreground, 0.498)} !important;

  /* Borders */
  --color-token-border: ${bDefault} !important;
  --color-token-border-default: ${bDefault} !important;
  --color-token-border-light: ${bLight} !important;
  --color-token-border-heavy: ${bHeavy} !important;
  --color-token-input-border: ${bHeavy} !important;

  /* Interaction surfaces */
  --color-token-list-hover-background: ${hoverBg} !important;
  --color-token-scrollbar-slider-hover-background: ${bHeavy} !important;

  /* Helper vars consumed by shellStructureCss */
  --accent: ${c.accent} !important;
  --bg-hover: ${alpha(c.accent, 0.1)} !important;
  --bg-active: ${alpha(c.accent, 0.16)} !important;
  --bg-selected: ${alpha(c.accent, 0.14)} !important;
}`;
}

// ---------------------------------------------------------------------------
// ZCode native token overrides (--color-* Tailwind v4 system)
// ---------------------------------------------------------------------------

/**
 * ZCode-native token overrides.
 *
 * Live ZCode (`file://` Vite/React build, Tailwind v4) drives its visual
 * identity through the `--color-*` family declared on :root / .dark /
 * .theme-zai-dark — 257 tokens as of the 50894 probe (background / surface /
 * foreground / border / accent / card / panel / sidebar / input / popover /
 * tooltip / menu / terminal / diff / interaction-* / *-node …). The shared
 * `shellTokenOverrides` block maps the palette onto a flat `--text-*` /
 * `--bg-*` / `--accent-*` system that ZCode does NOT consume natively — those
 * flat tokens exist only as the engine's own semantic layer consumed by
 * `engines/zcode/adapter.mjs` structural CSS (`var(--x, fallback)`).
 *
 * This function maps the 14-token palette onto the REAL `--color-*` system so
 * the theme layer (author-controlled) takes over the primary visual identity,
 * matching the codex `--color-token-*` approach. Coverage mirrors the 65
 * tokens previously hardcoded in `engines/zcode/tokens.css` (now a no-op
 * placeholder), with backgrounds kept semi-transparent for art punch-through
 * and semantic states (destructive/success/warning) deliberately left native.
 */
export function zcodeColorTokenOverrides(host, t) {
  const c = t.colors;
  return `${host} {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;

  /* --- Backgrounds: transparent for art punch-through --- */
  --color-background: transparent !important;
  --color-surface: transparent !important;

  /* Surfaces — SEMI-TRANSPARENT (frosted glass): hero art shows through.
     Opaque surfaces would hide the background, which is the point. */
  --color-card: color-mix(in srgb, ${c.surface} 55%, transparent) !important;
  --color-panel: color-mix(in srgb, ${c.surface} 45%, transparent) !important;
  --color-sidebar: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-header: color-mix(in srgb, ${c.surface} 50%, transparent) !important;
  --color-tab: color-mix(in srgb, ${c.surface} 50%, transparent) !important;
  --color-tab-active: color-mix(in srgb, ${c.surfaceElevated} 65%, transparent) !important;
  --color-popover: color-mix(in srgb, ${c.surfaceElevated} 82%, transparent) !important;
  --color-menu: color-mix(in srgb, ${c.surface} 75%, transparent) !important;
  --color-toast: color-mix(in srgb, ${c.surfaceElevated} 85%, transparent) !important;
  --color-tooltip: color-mix(in srgb, ${c.surfaceElevated} 85%, transparent) !important;
  --color-input: color-mix(in srgb, ${c.surface} 72%, transparent) !important;
  --color-input-focused: color-mix(in srgb, ${c.surfaceElevated} 78%, transparent) !important;
  --color-background-alt: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-background-win-alt: color-mix(in srgb, ${c.surface} 40%, transparent) !important;

  /* Hover / selected tints (transparent-based so the background still shows) */
  --color-surface-hover: color-mix(in srgb, ${c.accent} 10%, transparent) !important;
  --color-selected: color-mix(in srgb, ${c.accent} 16%, transparent) !important;
  --color-hover: color-mix(in srgb, ${c.accent} 10%, transparent) !important;

  /* --- Foregrounds --- */
  --color-foreground: ${c.foreground} !important;
  --color-foreground-subtle: ${c.muted} !important;
  --color-foreground-subtlest: color-mix(in srgb, ${c.muted} 65%, transparent) !important;
  --color-foreground-inverse: ${c.background} !important;

  /* --- Borders --- */
  --color-border: ${c.border} !important;
  --color-border-hover: color-mix(in srgb, ${c.accent} 30%, transparent) !important;
  --color-input-border: ${c.border} !important;
  --color-input-border-hover: color-mix(in srgb, ${c.accent} 35%, transparent) !important;
  --color-input-border-focused: ${c.accent} !important;
  --color-card-border: ${c.border} !important;
  --color-tab-border: ${c.border} !important;
  --color-popover-border: ${c.border} !important;

  /* --- Accent / brand (primary actions, active states) --- */
  --color-accent: ${c.accent} !important;
  --color-brand: ${c.accent} !important;
  --color-primary: ${c.accent} !important;
  --color-primary-foreground: ${c.background} !important;
  --color-secondary: color-mix(in srgb, ${c.surfaceElevated} 60%, transparent) !important;
  --color-destructive: #e5484d !important;
  --color-destructive-foreground: #fff !important;
  --color-success: #46a758 !important;
  --color-success-foreground: #fff !important;
  --color-warning: #f5a524 !important;
  --color-warning-foreground: #1a1a1a !important;

  /* --- Interaction ask (agent message surfaces) — frosted --- */
  --color-interaction-ask-fill: color-mix(in srgb, ${c.accent} 12%, transparent) !important;
  --color-interaction-ask-surface: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-interaction-ask-foreground: ${c.foreground} !important;
  --color-interaction-confirmation-surface: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-interaction-confirmation-foreground: ${c.foreground} !important;

  /* --- Node / command / file tree surfaces — frosted --- */
  --color-command-node: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-command-node-hover: color-mix(in srgb, ${c.accent} 10%, transparent) !important;
  --color-command-node-foreground: ${c.foreground} !important;
  --color-session-node: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-session-node-hover: color-mix(in srgb, ${c.accent} 10%, transparent) !important;
  --color-session-node-foreground: ${c.foreground} !important;
  --color-file-node: color-mix(in srgb, ${c.surface} 40%, transparent) !important;
  --color-file-node-hover: color-mix(in srgb, ${c.accent} 10%, transparent) !important;
  --color-file-node-foreground: ${c.foreground} !important;

  /* --- Terminal --- */
  --color-terminal-bg: ${c.codeBackground} !important;
  --color-terminal-fg: ${c.codeForeground} !important;
  --color-terminal-selection: color-mix(in srgb, ${c.accent} 32%, transparent) !important;
  --color-terminal-selection-inactive: color-mix(in srgb, ${c.accent} 20%, transparent) !important;

  /* --- Code / diff / find --- */
  --color-markdown-inline-code: ${c.codeForeground} !important;
  --color-diff-added: color-mix(in srgb, #46a758 40%, transparent) !important;
  --color-diff-removed: color-mix(in srgb, #e5484d 40%, transparent) !important;
  --color-find-highlight: color-mix(in srgb, ${c.accent} 30%, transparent) !important;
  --color-find-highlight-active: color-mix(in srgb, ${c.accent} 45%, transparent) !important;

  /* --- Secondary surfaces (2026-08-19, reverse blind-spot) ---
     Live 50894: popover-foreground / menu-hover / tooltip-tag* /
     card-selected / *-node (subagent/plugin/skill) / diff-*-foreground were
     unthemed. Terminal 16-color ANSI palette is intentionally left native
     (functional semantic colors, like codex charts-blue). */
  --color-popover-foreground: ${c.foreground} !important;
  --color-popover-header: ${c.surfaceElevated} !important;
  --color-menu-hover: color-mix(in srgb, ${c.accent} 12%, transparent) !important;
  --color-tooltip-tag: color-mix(in srgb, ${c.surfaceElevated} 92%, transparent) !important;
  --color-tooltip-tag-foreground: ${c.muted} !important;
  --color-card-selected: color-mix(in srgb, ${c.surface} 72%, ${c.accent} 28%) !important;
  --color-diff-added-foreground: ${c.foreground} !important;
  --color-diff-removed-foreground: ${c.foreground} !important;
  --color-subagent-node: color-mix(in srgb, ${c.surface} 55%, transparent) !important;
  --color-subagent-node-hover: color-mix(in srgb, ${c.accent} 12%, transparent) !important;
  --color-subagent-node-foreground: ${c.foreground} !important;
  --color-plugin-node: color-mix(in srgb, ${c.surface} 55%, transparent) !important;
  --color-plugin-node-hover: color-mix(in srgb, ${c.accent} 12%, transparent) !important;
  --color-plugin-node-foreground: ${c.foreground} !important;
  --color-skill-node: color-mix(in srgb, ${c.surface} 55%, transparent) !important;
  --color-skill-node-hover: color-mix(in srgb, ${c.accent} 12%, transparent) !important;
  --color-skill-node-foreground: ${c.foreground} !important;
  --color-icon-blue: ${c.accent} !important;
}`;
}

/** Structural chrome shared by the shell-style agents (art layer, frosted
 *  sidebar/composer, popovers).
 *
 *  OVER-RENDERING FIX (2026-08-23): the legacy `[class*="item"]` /
 *  `[class*="active"]` / `button[class*="primary"]` sub-string selectors
 *  over-matched container internals (probe-verified: doubao 217 items, codex
 *  137 items, zcode 139 items). All selectors below now use per-agent PROBE-
 *  VERIFIED exact anchors:
 *    - codex: nav.app-shell-left-panel / button.sidebar-item /
 *             [data-app-action-sidebar-thread-selected="true"]
 *    - zcode: [data-workspace-sidebar-panel="true"] / [data-slot="button"] /
 *             [data-state="active"] / [data-testid="..."]
 *  `agent` selects the anchor set; unknown agents fall back to host-scoped
 *  role selectors only (no class sub-string matching). */
export function shellStructureCss(host, t, agent = 'generic') {
  const c = t.colors;
  const inputMix = `color-mix(in srgb, color-mix(in srgb, ${c.surface} 82%, ${c.accent} 18%) 45%, transparent)`;
  const sidebarMix = `color-mix(in srgb, color-mix(in srgb, ${c.surface} 82%, ${c.accent} 18%) 22%, transparent)`;
  const popoverBg = `color-mix(in srgb, ${c.surfaceElevated} 94%, transparent)`;

  // PROBE-VERIFIED sidebar anchors per agent (2026-08-23).
  const SIDEBAR_ROOT = {
    codex: '.app-shell-left-panel',
    zcode: '[data-workspace-sidebar-panel="true"]',
  };
  // PROBE-VERIFIED sidebar item hover + active anchors per agent.
  const ITEM_HOVER = {
    codex: 'button.sidebar-item:hover, [data-app-action-sidebar-project-id]:hover',
    zcode: '[data-slot="button"]:hover',
  };
  const ITEM_ACTIVE = {
    codex:
      '[data-app-action-sidebar-thread-selected="true"], [data-app-action-sidebar-thread-active="true"]',
    zcode: '[data-state="active"], [aria-current]',
  };

  const sidebarRoot = SIDEBAR_ROOT[agent] ?? 'aside, nav';
  const itemHover = ITEM_HOVER[agent] ?? '';
  const itemActive = ITEM_ACTIVE[agent] ?? '';

  // Prefix every comma-separated selector in the per-agent anchors with the host
  // scope — otherwise the 2nd+ selectors leak globally (over-rendering).
  const scopeAll = (sel) =>
    sel
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `${host} ${s}`)
      .join(',\n');
  const hoverScoped = itemHover ? scopeAll(itemHover) : '';
  const activeScoped = itemActive ? scopeAll(itemActive) : '';

  // Composer / input anchor (kept generic — contenteditable is a standard role).
  const composerSel =
    agent === 'codex'
      ? '.composer-surface-chrome, [class*="_multilineSurface_"]'
      : '[contenteditable="true"], textarea';
  const composerScoped = scopeAll(composerSel);

  return `/* ---- hero art on #root — palette-driven wash, hero visible right side ---- */
${artLayerCss(host, t)}

/* Root + main surfaces transparent so #root art shows through */
${host} #root,
${host} main,
${host} [role="main"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--agentskin-text) !important;
}

/* Sidebar: frosted glass over art (PROBE-VERIFIED exact root) */
${host} ${sidebarRoot} {
  background: ${sidebarMix} !important;
  border-right: 1px solid ${alpha(c.accent, 0.1)} !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}
${
  hoverScoped
    ? `${hoverScoped} {
  background: ${alpha(c.accent, 0.1)} !important;
}`
    : ''
}
${
  activeScoped
    ? `${activeScoped} {
  background: ${alpha(c.accent, 0.16)} !important;
  box-shadow: inset 3px 0 0 0 var(--agentskin-accent) !important;
}`
    : ''
}

/* Composer / input: frosted glass */
${composerScoped} {
  background: ${inputMix} !important;
  backdrop-filter: blur(14px) saturate(1.1) !important;
  color: var(--agentskin-text) !important;
  caret-color: var(--agentskin-accent) !important;
  border: 1px solid ${alpha(c.accent, 0.25)} !important;
  border-radius: 14px !important;
  box-shadow: none !important;
}

${composerScoped}:focus,
${host} [contenteditable="true"]:focus,
${host} [contenteditable="true"]:focus-within {
  border-color: ${alpha(c.accent, 0.5)} !important;
  box-shadow: 0 0 0 2px ${alpha(c.accent, 0.1)}, 0 4px 18px ${alpha(c.secondary, 0.12)} !important;
}

/* Message text (role-scoped — no [class*="message"] sub-string spray) */
${host} [role="log"],
${host} article {
  color: var(--agentskin-text);
}

/* Popovers / modals: frosted glass (role-scoped + exact classes only) */
${host} [role="dialog"],
${host} [role="menu"],
${host} [role="tooltip"],
${host} [role="listbox"] {
  background: ${popoverBg} !important;
  border: none !important;
  backdrop-filter: blur(18px) saturate(1.08) !important;
}`;
}

// ---------------------------------------------------------------------------
// Aurora Glass signature (manifest.signature = "aurora-glass")
//
// Opt-in crafted layer. Appended by generate-theme-css.mjs ONLY when a theme
// declares `signature: "aurora-glass"` in its manifest, so existing themes are
// untouched and `generate-theme-css --verify` stays deterministic. It layers a
// slowly drifting aurora behind the frosted glass, adds a specular rim-light to
// panels, an iridescent sheen sweep on primary buttons, and a breathing focus
// glow on the composer — design craft beyond flat color/background swaps.
// ---------------------------------------------------------------------------

/** Per-agent host selector (mirrors the values hardcoded in ./generators/*). */
export const HOSTS = Object.freeze({
  traework: 'html.agentskin-host-traework',
  qoderwork: 'html.agentskin-host-qoderwork',
  workbuddy: 'body[data-application-name="workbuddy"]',
  doubao: 'html.agentskin-host-doubao',
  codex: ':root.agentskin-host-codex',
  zcode: 'html.agentskin-host-zcode',
});

export function auroraGlassSignature(t, host) {
  const c = t.colors;
  // Doubao mounts on <body> (no #root); every other agent has #root.
  const artTarget = host === HOSTS.doubao ? `${host} body::before` : `${host} #root::before`;

  return `
/* ===== Aurora Glass signature (manifest.signature = "aurora-glass") ===== */

/* --- living aurora backdrop: replaces the static art wash with drifting bands --- */
${artTarget} {
  background:
    radial-gradient(120% 80% at 82% 14%, ${alpha(c.secondary, 0.32)}, transparent 60%),
    linear-gradient(118deg, ${alpha(c.accent, 0.18)} 0%, transparent 40%),
    linear-gradient(242deg, ${alpha(c.secondary, 0.2)} 0%, transparent 44%),
    linear-gradient(180deg, ${c.background} 0%, color-mix(in srgb, ${c.background} 72%, #060912) 100%) !important;
  background-size: 200% 200%, 190% 190%, 190% 190%, 100% 100% !important;
  background-repeat: no-repeat !important;
}
@media (prefers-reduced-motion: no-preference) {
  @keyframes __aurora_glass_drift {
    0%   { background-position: 0% 0%, 100% 18%, 50% 82%, 0 0; }
    50%  { background-position: 22% 34%, 68% 58%, 28% 38%, 0 0; }
    100% { background-position: 0% 0%, 100% 18%, 50% 82%, 0 0; }
  }
  @keyframes __aurora_glass_sheen {
    0%   { transform: translateX(-130%) skewX(-18deg); }
    55%  { transform: translateX(240%) skewX(-18deg); }
    100% { transform: translateX(240%) skewX(-18deg); }
  }
  @keyframes __aurora_glass_breathe {
    0%, 100% { box-shadow: 0 0 0 1px ${alpha(c.accent, 0.32)}, 0 0 16px ${alpha(c.secondary, 0.16)}; }
    50%      { box-shadow: 0 0 0 1px ${alpha(c.accent, 0.58)}, 0 0 30px ${alpha(c.secondary, 0.3)}; }
  }
  ${artTarget} {
    animation: __aurora_glass_drift 28s ease-in-out infinite !important;
  }
}

/* --- glass specular rim-light: panels read as real glass, not flat fills --- */
${host} aside,
${host} nav,
${host} [role="dialog"],
${host} [role="menu"],
${host} [role="tooltip"],
${host} [class*="popover"],
${host} [class*="modal"],
${host} [class*="sidebar"] {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 0 0 1px ${alpha(c.accent, 0.1)},
    0 10px 34px rgba(4, 8, 16, 0.42) !important;
}

/* --- iridescent sheen sweep on primary / send buttons (liquid highlight) --- */
${host} button[class*="primary"],
${host} button[class*="send"],
${host} button[class*="submit"] {
  position: relative !important;
  overflow: hidden !important;
}
${host} button[class*="primary"]::after,
${host} button[class*="send"]::after,
${host} button[class*="submit"]::after {
  content: '' !important;
  position: absolute !important;
  inset: 0 !important;
  background: linear-gradient(100deg, transparent 0%, rgba(255, 255, 255, 0.30) 50%, transparent 100%) !important;
  transform: translateX(-130%) skewX(-18deg) !important;
  pointer-events: none !important;
  opacity: 0 !important;
}
@media (prefers-reduced-motion: no-preference) {
  ${host} button[class*="primary"]:hover::after,
  ${host} button[class*="send"]:hover::after,
  ${host} button[class*="submit"]:hover::after {
    opacity: 1 !important;
    animation: __aurora_glass_sheen 1.05s ease-out !important;
  }
}

/* --- breathing focus glow on the composer / inputs --- */
${host} [contenteditable="true"]:focus,
${host} [contenteditable="true"]:focus-within,
${host} textarea:focus,
${host} input:focus {
  animation: __aurora_glass_breathe 3.6s ease-in-out infinite !important;
}
`;
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildContext(id, manifest, scheme = null) {
  const inputColors = scheme?.colors ?? manifest.colors ?? {};

  // H-7: only background + foreground are required (per THEME_SPEC).
  if (!inputColors.background)
    throw new Error(`themes/${id}: missing colors.background (required)`);
  if (!inputColors.foreground)
    throw new Error(`themes/${id}: missing colors.foreground (required)`);

  // H-6: validate every color; missing or invalid values fall back to
  // COLOR_FALLBACKS so no generator ever sees a malformed input.
  const colors = {};
  for (const key of COLOR_KEYS) {
    const val = inputColors[key];
    if (val && tryParseColor(val, `${id}/colors.${key}`)) {
      colors[key] = val;
    } else {
      colors[key] = COLOR_FALLBACKS[key];
    }
  }

  // focusRing: copy from manifest only when explicitly declared + valid.
  // Otherwise leave undefined so tokenBlock() falls back to color-mix(accent 40%),
  // matching deriveTokens() and build-palette.mjs (divergence fix P1-1).
  if (inputColors.focusRing && tryParseColor(inputColors.focusRing, `${id}/colors.focusRing`)) {
    colors.focusRing = inputColors.focusRing;
  } else {
    delete colors.focusRing; // not a COLOR_KEY, already absent — belt-and-braces
  }

  const mode = (scheme?.mode ?? manifest.mode) === 'light' ? 'light' : 'dark'; // auto → dark (dark canvas)
  return {
    id,
    name: manifest.displayName || manifest.name,
    mode,
    isLight: mode === 'light',
    signature: manifest.signature ?? null,
    variableBridge:
      manifest.variableBridge && typeof manifest.variableBridge === 'object'
        ? manifest.variableBridge
        : null,
    colors,
  };
}
