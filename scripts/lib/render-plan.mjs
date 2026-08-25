// SPDX-License-Identifier: MIT
//
// # render-plan.mjs — RenderPlan Semantic Intermediate Representation
//
// Sits between "14-token theme definition" and "per-agent CSS generation" as
// a version-aware semantic IR. The architecture it enables is:
//
//   theme manifest (14 tokens)
//        │
//        ▼
//   createRenderPlan(agentId, detectedVersion, themeManifest)  →  RenderPlan
//        │                                                          │
//        │   ┌──────────────────────────────────────────────────────┘
//        │   │  .compatibility  — what the target engine supports
//        │   │  .strategy       — how to apply the theme
//        │   │  .version        — resolved version range
//        │   │
//        ▼   ▼
//   renderPlanToCSS(renderPlan, themeManifest)  →  CSS string
//
// Decoupling goal: when a target app ships a breaking DOM/CSS change,
// only the version-descriptor table + strategy logic in this module needs to
// change. The 14-token contract and the CSS generator's core rules stay put.

// ---------------------------------------------------------------------------
// Types (JSDoc — consumed by IDEs / tsc --checkJs, not enforced at runtime)
// ---------------------------------------------------------------------------

/**
 * @typedef {'traework'|'qoderwork'|'workbuddy'|'doubao'|'codex'|'zcode'} AgentId
 */

/**
 * @typedef {'direct'|'overlay'|'layer'} BackgroundMode
 * - `direct`  — declare agentskin tokens + frosted glass over #root art layer
 *               (requires backdrop-filter support).
 * - `overlay` — full-screen fixed overlay with art wash; no backdrop-filter
 *               (fallback for engines without blur support).
 * - `layer`   — layered solid color-mix tints; used when neither direct nor
 *               overlay is appropriate (very constrained engines).
 */

/**
 * @typedef {Object} Compatibility
 * @property {boolean} nativeThemeSupport       Target app exposes a native
 *   theme-switching API (if true, the CSS layer only needs accents + focus).
 * @property {boolean} backdropFilterSupported  backdrop-filter: blur() works
 *   in the target engine's compositor.
 * @property {boolean} cssVariablesSupported    CSS custom properties resolve
 *   in the target engine's cascade.
 * @property {boolean} focusRingAvailable       The engine honours :focus-visible
 *   / box-shadow focus rings.
 */

/**
 * @typedef {Object} Strategy
 * @property {BackgroundMode} backgroundMode   How the art/bg layer is applied.
 * @property {Record<string,string>} tokenMapping  14 agentskin tokens → the
 *   target app's native CSS-variable namespace.
 * @property {string[]} criticalSelectors       Landmark selectors the CSS MUST
 *   style for the theme to render correctly.
 */

/**
 * @typedef {Object} RenderPlan
 * @property {AgentId} agentId
 * @property {string} version                   Resolved version range label.
 * @property {Compatibility} compatibility
 * @property {Strategy} strategy
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 * @property {string[]} warnings
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All six supported adapter identifiers. */
export const AGENT_IDS = Object.freeze([
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
]);

/** The 14 required agentskin tokens (mirrors scripts/theme-tokens.mjs). */
const REQUIRED_TOKENS = Object.freeze([
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-input-bg',
  '--agentskin-button-bg',
  '--agentskin-button-fg',
  '--agentskin-focus-ring',
]);

/** Host selector per agent (mirrors scripts/theme-utils.mjs HOSTS). */
const HOST_SELECTOR = Object.freeze({
  traework: 'html.agentskin-host-traework',
  qoderwork: 'html.agentskin-host-qoderwork',
  workbuddy: 'body[data-application-name="workbuddy"]',
  doubao: 'html.agentskin-host-doubao',
  codex: ':root.agentskin-host-codex',
  zcode: 'html.agentskin-host-zcode',
});

/** 14 agentskin tokens → each agent's native CSS-variable namespace. */
const NATIVE_TOKEN_MAP = Object.freeze({
  traework: {
    '--agentskin-bg': '--vscode-editor-background',
    '--agentskin-surface': '--vscode-icube-colorBg2',
    '--agentskin-surface-elevated': '--vscode-icube-colorBg3',
    '--agentskin-text': '--vscode-foreground',
    '--agentskin-muted': '--vscode-descriptionForeground',
    '--agentskin-accent': '--vscode-textLink-foreground',
    '--agentskin-secondary': '--vscode-button-hoverBackground',
    '--agentskin-border': '--vscode-icube-colorLine1',
    '--agentskin-code-bg': '--vscode-editorWidget-background',
    '--agentskin-code-fg': '--vscode-foreground',
    '--agentskin-focus-ring': '--vscode-focusBorder',
    '--agentskin-button-fg': '--vscode-button-foreground',
    '--agentskin-button-bg': '--vscode-button-background',
    '--agentskin-input-bg': '--vscode-input-background',
  },
  codex: {
    '--agentskin-bg': '--color-token-bg-primary',
    '--agentskin-surface': '--color-token-main-surface-primary',
    '--agentskin-surface-elevated': '--color-token-bg-tertiary',
    '--agentskin-text': '--color-token-foreground',
    '--agentskin-muted': '--color-token-text-secondary',
    '--agentskin-accent': '--color-token-primary',
    '--agentskin-secondary': '--color-token-text-link-foreground',
    '--agentskin-border': '--color-token-border',
    '--agentskin-code-bg': '--color-token-diff-surface',
    '--agentskin-code-fg': '--color-token-foreground',
    '--agentskin-focus-ring': '--color-token-focus-border',
    '--agentskin-button-fg': '--color-token-bg-primary',
    '--agentskin-button-bg': '--color-token-primary',
    '--agentskin-input-bg': '--color-token-input-border',
  },
  zcode: {
    '--agentskin-bg': '--color-background',
    '--agentskin-surface': '--color-surface',
    '--agentskin-surface-elevated': '--color-card',
    '--agentskin-text': '--color-foreground',
    '--agentskin-muted': '--color-foreground-subtle',
    '--agentskin-accent': '--color-accent',
    '--agentskin-secondary': '--color-secondary',
    '--agentskin-border': '--color-border',
    '--agentskin-code-bg': '--color-terminal-bg',
    '--agentskin-code-fg': '--color-terminal-fg',
    '--agentskin-focus-ring': '--color-input-border-focused',
    '--agentskin-button-fg': '--color-primary-foreground',
    '--agentskin-button-bg': '--color-primary',
    '--agentskin-input-bg': '--color-input',
  },
  doubao: {
    '--agentskin-bg': '--dg-bg-base-default',
    '--agentskin-surface': '--dg-bg-base-secondary',
    '--agentskin-surface-elevated': '--dg-bg-overlay-l4',
    '--agentskin-text': '--dg-text-primary',
    '--agentskin-muted': '--dg-text-secondary',
    '--agentskin-accent': '--dg-brand',
    '--agentskin-secondary': '--dg-brand-hover',
    '--agentskin-border': '--dg-border-default',
    '--agentskin-code-bg': '--dg-bg-base-default',
    '--agentskin-code-fg': '--dg-text-primary',
    '--agentskin-focus-ring': '--dg-brand',
    '--agentskin-button-fg': '--dg-text-onaccent',
    '--agentskin-button-bg': '--dg-brand',
    '--agentskin-input-bg': '--dg-bg-base-secondary',
  },
  qoderwork: {
    '--agentskin-bg': '--qoder-bg-primary',
    '--agentskin-surface': '--qoder-bg-secondary',
    '--agentskin-surface-elevated': '--qoder-bg-elevated',
    '--agentskin-text': '--qoder-text-primary',
    '--agentskin-muted': '--qoder-text-secondary',
    '--agentskin-accent': '--qoder-accent',
    '--agentskin-secondary': '--qoder-accent-hover',
    '--agentskin-border': '--qoder-border',
    '--agentskin-code-bg': '--qoder-bg-secondary',
    '--agentskin-code-fg': '--qoder-text-primary',
    '--agentskin-focus-ring': '--qoder-focus-ring',
    '--agentskin-button-fg': '--qoder-button-fg',
    '--agentskin-button-bg': '--qoder-accent',
    '--agentskin-input-bg': '--qoder-input-bg',
  },
  workbuddy: {
    '--agentskin-bg': '--wb-bg-primary',
    '--agentskin-surface': '--wb-bg-secondary',
    '--agentskin-surface-elevated': '--wb-bg-elevated',
    '--agentskin-text': '--wb-text-primary',
    '--agentskin-muted': '--wb-text-secondary',
    '--agentskin-accent': '--wb-accent',
    '--agentskin-secondary': '--wb-accent-secondary',
    '--agentskin-border': '--wb-border',
    '--agentskin-code-bg': '--wb-bg-secondary',
    '--agentskin-code-fg': '--wb-text-primary',
    '--agentskin-focus-ring': '--wb-focus-ring',
    '--agentskin-button-fg': '--wb-button-fg',
    '--agentskin-button-bg': '--wb-button-bg',
    '--agentskin-input-bg': '--wb-input-bg',
  },
});

/** Critical landmark selectors per agent — the CSS MUST hit these. */
const CRITICAL_SELECTORS = Object.freeze({
  traework: [
    'html.agentskin-host-traework .panel-container',
    'html.agentskin-host-traework .task-list-base',
    'html.agentskin-host-traework .chat-input-v2-input-box-editable',
    'html.agentskin-host-traework .solo-common-button',
  ],
  codex: [
    ':root.agentskin-host-codex button.sidebar-item',
    ':root.agentskin-host-codex[data-app-action-sidebar-thread-selected="true"]',
    ':root.agentskin-host-codex .composer-surface-chrome',
  ],
  zcode: [
    'html.agentskin-host-zcode [data-workspace-sidebar-panel="true"]',
    'html.agentskin-host-zcode [data-slot="button"]',
  ],
  doubao: ['html.agentskin-host-doubao #root', 'html.agentskin-host-doubao .sidebar'],
  qoderwork: [
    'html.agentskin-host-qoderwork .agents-layout-root',
    'html.agentskin-host-qoderwork .agents-sidebar',
  ],
  workbuddy: [
    'body[data-application-name="workbuddy"] .teams-container',
    'body[data-application-name="workbuddy"] .conversation-sidebar',
  ],
});

// ---------------------------------------------------------------------------
// Version capability table
//
// Each agent declares an ordered list of version descriptors. The first
// matching descriptor (based on the detected version) supplies compatibility
// field overrides that layer on top of the agent's base compatibility.
// ---------------------------------------------------------------------------

/**
 * Base compatibility for every agent. Version descriptors below override
 * individual fields; anything not overridden keeps the value here.
 */
const BASE_COMPAT = Object.freeze({
  traework: {
    nativeThemeSupport: false,
    backdropFilterSupported: true,
    cssVariablesSupported: true,
    focusRingAvailable: true,
  },
  codex: {
    nativeThemeSupport: false,
    backdropFilterSupported: true,
    cssVariablesSupported: true,
    focusRingAvailable: true,
  },
  zcode: {
    nativeThemeSupport: false,
    backdropFilterSupported: true,
    cssVariablesSupported: true,
    focusRingAvailable: true,
  },
  doubao: {
    nativeThemeSupport: false,
    backdropFilterSupported: true,
    cssVariablesSupported: true,
    focusRingAvailable: true,
  },
  qoderwork: {
    nativeThemeSupport: false,
    backdropFilterSupported: true,
    cssVariablesSupported: true,
    focusRingAvailable: true,
  },
  workbuddy: {
    nativeThemeSupport: false,
    backdropFilterSupported: true,
    cssVariablesSupported: true,
    focusRingAvailable: true,
  },
});

/**
 * Ordered version descriptors per agent. `match(version)` returns true when
 * the detected version falls in the descriptor's range.
 *
 * Range grammar:
 *   "X.Y.Z+"  → version >= X.Y.Z
 *   "<X.Y.Z"  → version <  X.Y.Z
 *   "latest"  → always matches (catch-all)
 *
 * FIRST match wins — order from most-specific to least-specific.
 *
 * @type {Object.<AgentId, Array<{range: string, match: (v: string) => boolean, compat: Partial<Compatibility> }>>}
 */
const VERSION_DESCRIPTORS = (() => {
  /**
   * Parse "X.Y.Z" → [X, Y, Z] numeric components. Missing → 0.
   * Everything after a "+" suffix is stripped first.
   * @param {string} v
   * @returns {number[]}
   */
  function parse(v) {
    return v
      .replace(/\+.*$/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  }

  /** Compare two dotted-version arrays → -1 | 0 | 1.
   * @param {string} a
   * @param {string} b
   */
  function cmp(a, b) {
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da < db) return -1;
      if (da > db) return 1;
    }
    return 0;
  }

  /** Build a matcher for a range string.
   * @param {string} range
   * @returns {(v: string) => boolean}
   */
  function matcher(range) {
    if (range === 'latest') return () => true;
    if (range.startsWith('<')) {
      const threshold = range.slice(1);
      return (v) => cmp(v, threshold) < 0;
    }
    // "X.Y.Z+" or bare "X.Y.Z" treated as >=
    const threshold = range.replace(/\+$/, '');
    return (v) => cmp(v, threshold) >= 0;
  }

  /** @param {Array<{range: string, compat: Partial<Compatibility}>}} list */
  function build(list) {
    return list.map((d) => ({ ...d, match: matcher(d.range) }));
  }

  return {
    traework: build([
      {
        range: '<2.5',
        compat: {
          backdropFilterSupported: false,
          focusRingAvailable: false,
        },
      },
      { range: '2.5+', compat: {} },
    ]),
    codex: build([
      { range: '2026.8+', compat: {} },
      { range: '2026.7+', compat: { focusRingAvailable: false } },
    ]),
    zcode: build([{ range: '1.0+', compat: {} }]),
    doubao: build([
      { range: 'latest', compat: {} },
      { range: 'chromium-120+', compat: {} },
    ]),
    qoderwork: build([{ range: '1.0+', compat: {} }]),
    workbuddy: build([{ range: '1.0+', compat: {} }]),
  };
})();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a RenderPlan: the version-aware semantic IR for a given agent + theme.
 *
 * @param {AgentId} agentId            Target adapter identifier.
 * @param {string} detectedVersion     Version string reported by the running
 *   target app (e.g. "2.5.1", "2026.8.3", "latest").
 * @param {object} themeManifest       Source-of-truth manifest object. Only
 *   `.colors` (and optionally `.mode` / `.isLight`) are inspected; the plan
 *   does not mutate this argument.
 * @returns {RenderPlan} The resolved semantic rendering plan.
 * @throws {Error} When agentId is unknown or detectedVersion is empty.
 */
export function createRenderPlan(agentId, detectedVersion, themeManifest) {
  if (!AGENT_IDS.includes(agentId)) {
    throw new Error(`createRenderPlan: unknown agentId "${agentId}"`);
  }
  if (!detectedVersion || typeof detectedVersion !== 'string') {
    throw new Error('createRenderPlan: detectedVersion must be a non-empty string');
  }
  if (!themeManifest || typeof themeManifest !== 'object') {
    throw new Error('createRenderPlan: themeManifest must be an object');
  }

  // Resolve compatibility by layering version-descriptor overrides onto base.
  const base = BASE_COMPAT[agentId];
  const descriptors = VERSION_DESCRIPTORS[agentId];
  let version = 'latest';
  let compat = { ...base };
  for (const desc of descriptors) {
    if (desc.match(detectedVersion)) {
      version = desc.range;
      compat = { ...compat, ...desc.compat };
      break;
    }
  }

  // Resolve background mode from compatibility.
  const backgroundMode = resolveBackgroundMode(compat);

  return {
    agentId,
    version,
    compatibility: compat,
    strategy: {
      backgroundMode,
      tokenMapping: NATIVE_TOKEN_MAP[agentId],
      criticalSelectors: CRITICAL_SELECTORS[agentId],
    },
  };
}

/**
 * Pick a background injection strategy given compatibility flags.
 * @param {Compatibility} compat
 * @returns {BackgroundMode}
 */
function resolveBackgroundMode(compat) {
  if (compat.nativeThemeSupport) return 'layer';
  if (compat.backdropFilterSupported) return 'direct';
  return 'overlay';
}

/**
 * Turn a RenderPlan + theme manifest into a valid CSS string.
 *
 * This is a PURPOSE-BUILT generator that consumes the semantic plan rather
 * than the agent-specific selectors directly. The per-agent generators in
 * scripts/generators/*.mjs remain the production path; this function
 * demonstrates the IR-to-CSS contract and can serve as the canonical baseline.
 *
 * @param {RenderPlan} renderPlan
 * @param {object} themeManifest  Manifest with `.colors` (and optionally
 *   `.mode` / `.isLight`). Not mutated.
 * @returns {string} Complete CSS stylesheet.
 */
export function renderPlanToCSS(renderPlan, themeManifest) {
  const { agentId, compatibility, strategy } = renderPlan;
  const host = HOST_SELECTOR[agentId];
  const colors = themeManifest.colors ?? {};
  const isLight = themeManifest.isLight ?? themeManifest.mode === 'light';

  const sections = [];

  // 1. Agentskin 14-token block scoped to the host.
  sections.push(buildTokenBlock(host, colors, isLight, compatibility));

  // 2. Native-variable bridge: agentskin tokens → app namespace.
  sections.push(buildNativeBridge(host, strategy.tokenMapping));

  // 3. Background / art layer — honours backgroundMode.
  sections.push(buildBackground(host, strategy.backgroundMode, colors));

  // 4. Critical selectors — surfaced landmarks get base styling.
  sections.push(buildCriticalSelectors(strategy.criticalSelectors, colors));

  // 5. Focus-ring utility (only when the engine honours it).
  if (compatibility.focusRingAvailable) {
    sections.push(buildFocusRing(host, colors));
  }

  return sections.join('\n');
}

/**
 * Validate a RenderPlan for structural integrity.
 *
 * @param {RenderPlan} renderPlan
 * @returns {ValidationResult} `{ valid, errors, warnings }`.
 */
export function validateRenderPlan(renderPlan) {
  const errors = [];
  const warnings = [];

  if (!renderPlan || typeof renderPlan !== 'object') {
    return { valid: false, errors: ['renderPlan must be an object'], warnings: [] };
  }

  // agentId.
  if (!AGENT_IDS.includes(renderPlan.agentId)) {
    errors.push(`agentId "${renderPlan?.agentId}" is not one of: ${AGENT_IDS.join(', ')}`);
  }

  // version.
  if (!renderPlan.version || typeof renderPlan.version !== 'string') {
    errors.push('version must be a non-empty string');
  }

  // compatibility.
  const compat = renderPlan.compatibility;
  if (!compat || typeof compat !== 'object') {
    errors.push('compatibility must be an object');
  } else {
    for (const key of [
      'nativeThemeSupport',
      'backdropFilterSupported',
      'cssVariablesSupported',
      'focusRingAvailable',
    ]) {
      if (typeof compat[key] !== 'boolean') {
        errors.push(`compatibility.${key} must be a boolean`);
      }
    }
  }

  // strategy.
  const strategy = renderPlan.strategy;
  if (!strategy || typeof strategy !== 'object') {
    errors.push('strategy must be an object');
  } else {
    // backgroundMode.
    if (!['direct', 'overlay', 'layer'].includes(strategy.backgroundMode)) {
      errors.push(
        `strategy.backgroundMode "${strategy?.backgroundMode}" must be direct | overlay | layer`,
      );
    }
    // tokenMapping (must cover all 14 tokens).
    if (!strategy.tokenMapping || typeof strategy.tokenMapping !== 'object') {
      errors.push('strategy.tokenMapping must be an object');
    } else {
      for (const token of REQUIRED_TOKENS) {
        if (!strategy.tokenMapping[token]) {
          errors.push(`strategy.tokenMapping missing entry for ${token}`);
        }
      }
    }
    // criticalSelectors.
    if (!Array.isArray(strategy.criticalSelectors) || strategy.criticalSelectors.length === 0) {
      errors.push('strategy.criticalSelectors must be a non-empty array');
    }
  }

  if (compat && typeof compat.nativeThemeSupport === 'boolean' && compat.nativeThemeSupport) {
    warnings.push(
      'nativeThemeSupport=true — the CSS layer may be redundant if the target app already switches palettes natively',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// CSS section builders (internal)
// ---------------------------------------------------------------------------

/**
 * Build the 14-token agentskin palette block scoped to `host`.
 *
 * When cssVariablesSupported is false, tokens are still declared under :root
 * but are not the primary mechanism — downstream overrides use literal colours.
 *
 * @param {string} host
 * @param {Record<string,string>} colors
 * @param {boolean} isLight
 * @param {Compatibility} compat
 * @returns {string}
 */
function buildTokenBlock(host, colors, isLight, compat) {
  const scope = compat.cssVariablesSupported ? host : ':root';
  const c = colors;
  const scheme = isLight ? 'light' : 'dark';
  const buttonFg = c.buttonForeground || (isLight ? '#000000' : '#ffffff');
  return `/* ${host} — 14-token agentskin palette (RenderPlan IR) */
${scope} {
  color-scheme: ${scheme} !important;
  --agentskin-accent: ${c.accent ?? '#4a90d9'};
  --agentskin-secondary: ${c.secondary ?? '#7a8a99'};
  --agentskin-bg: ${c.background ?? '#1e1e1e'};
  --agentskin-surface: ${c.surface ?? '#2a2a2a'};
  --agentskin-surface-elevated: ${c.surfaceElevated ?? '#333333'};
  --agentskin-text: ${c.foreground ?? '#e0e0e0'};
  --agentskin-muted: ${c.muted ?? '#888888'};
  --agentskin-border: ${c.border ?? '#4a90d92e'};
  --agentskin-code-bg: ${c.codeBackground ?? '#161616'};
  --agentskin-code-fg: ${c.codeForeground ?? '#cdd6e0'};
  --agentskin-input-bg: ${c.inputBackground ?? 'color-mix(in srgb, var(--agentskin-surface) 45%, transparent)'};
  --agentskin-button-bg: ${c.buttonBackground ?? c.accent ?? '#4a90d9'};
  --agentskin-button-fg: ${buttonFg};
  --agentskin-focus-ring: ${c.focusRing ?? 'color-mix(in srgb, var(--agentskin-accent) 40%, transparent)'};
}`;
}

/**
 * Bridge agentskin tokens → the target app's native variable namespace.
 *
 * @param {string} host
 * @param {Record<string,string>} tokenMapping
 * @returns {string}
 */
function buildNativeBridge(host, tokenMapping) {
  const lines = Object.entries(tokenMapping).map(
    ([skin, native]) => `  ${native}: var(${skin}) !important;`,
  );
  return `/* Native variable bridge: agentskin → app namespace */
${host} {
${lines.join('\n')}
}`;
}

/**
 * Build the art / background section, respecting backgroundMode.
 *
 * - `direct`   — frosted glass over #root::before (backdrop-filter).
 * - `overlay`  — fixed overlay with art wash; no blur (fallback).
 * - `layer`    — translucent colour-mix tints only.
 *
 * @param {string} host
 * @param {BackgroundMode} mode
 * @param {Record<string,string>} colors
 * @returns {string}
 */
function buildBackground(host, mode, colors) {
  const bg = colors.background ?? '#1e1e1e';
  const accent = colors.accent ?? '#4a90d9';
  const surface = colors.surface ?? '#2a2a2a';
  if (mode === 'direct') {
    return `/* Background: direct — frosted glass over #root art layer */
${host} #root {
  color: var(--agentskin-text) !important;
  background: transparent !important;
  backdrop-filter: blur(24px) saturate(1.15) !important;
}
${host} #root::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, ${surface} 38%, transparent) 0 16%,
      color-mix(in srgb, ${surface} 14%, transparent) 44%,
      transparent 70%),
    radial-gradient(120% 80% at 84% 14%,
      color-mix(in srgb, ${accent} 20%, transparent), transparent 60%),
    var(--agentskin-art, none) right center / cover no-repeat !important;
}`;
  }

  if (mode === 'overlay') {
    return `/* Background: overlay — fixed wash, no blur */
${host} #root {
  color: var(--agentskin-text) !important;
  position: relative;
}
${host} #root::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background:
    linear-gradient(180deg, ${bg} 0%, color-mix(in srgb, ${bg} 88%, ${accent}) 100%) !important;
}
${host} #root::after {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background: var(--agentskin-art, none) right center / cover no-repeat !important;
  opacity: 0.32 !important;
}`;
  }

  // mode === 'layer'
  return `/* Background: layer — translucent colour tints (minimal) */
${host} #root {
  color: var(--agentskin-text) !important;
  background: color-mix(in srgb, ${bg} 92%, transparent) !important;
}`;
}

/**
 * Apply base styling to the critical landmark selectors so they obey the
 * theme even before the full generator runs.
 *
 * @param {string[]} selectors
 * @param {Record<string,string>} colors
 * @returns {string}
 */
function buildCriticalSelectors(selectors, colors) {
  const lines = selectors.map(
    (sel) => `${sel} {
  color: var(--agentskin-text, ${colors.foreground ?? '#e0e0e0'}) !important;
  background-color: color-mix(in srgb, var(--agentskin-surface, ${colors.surface ?? '#2a2a2a'}) 45%, transparent) !important;
  border-color: var(--agentskin-border, ${colors.border ?? '#4a90d92e'}) !important;
}`,
  );
  return `/* Critical selectors (RenderPlan landmarks) */
${lines.join('\n\n')}`;
}

/**
 * Emit a focus-ring utility rule scoped to the host.
 * @param {string} host
 * @param {Record<string,string>} colors
 * @returns {string}
 */
function buildFocusRing(host, colors) {
  return `/* Focus-ring utility (engine honours :focus-visible) */
${host} :focus-visible,
${host} [contenteditable="true"]:focus,
${host} input:focus,
${host} textarea:focus {
  outline: none !important;
  box-shadow: 0 0 0 2px var(--agentskin-focus-ring, ${colors.focusRing ?? 'color-mix(in srgb, var(--agentskin-accent) 40%, transparent)'}) !important;
}`;
}
