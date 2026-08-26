// SPDX-License-Identifier: MPL-2.0
/**
 * Convert Codedrobe Theme → AgentSkin format
 *
 * Source: themes/miku-future-beats-1.2.0.codedrobe-theme
 * Output: themes/miku-future-beats/
 *
 * Maps --miku-* custom vars → --agentskin-* 14-token system
 * Generates CSS for all 6 adapters (codex/qoderwork/traework/workbuddy/doubao/zcode)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE_FILE = join(ROOT, 'themes', 'miku-future-beats-1.2.0.codedrobe-theme');
const OUTPUT_DIR = join(ROOT, 'themes', 'miku-future-beats');

// ===== 1. Read source theme =====
const source = JSON.parse(readFileSync(SOURCE_FILE, 'utf-8'));
console.log(`Loaded: ${source.theme.displayName} v${source.theme.version}`);

// ===== 2. Extract core colors from CSS custom properties =====
// The miku theme uses a consistent palette across all adapters
const MIKU_COLORS = {
  ink: '#163f4b', // primary text
  inkSoft: '#557480', // secondary text / muted
  teal: '#16bfc4', // primary accent
  deepTeal: '#087b86', // darker accent
  cyan: '#74dce4', // lighter accent / secondary
  pink: '#ff8fc8', // decorative
  lavender: '#9f92f8', // decorative
  ice: '#eefbff', // surface tint
  white: '#fbfdff', // background
  line: 'rgba(22, 191, 196, .24)',
  shadow: 'rgba(20, 102, 118, .14)',
};

// ===== 3. Map to AgentSkin 14-token system =====
const tokens = {
  accent: MIKU_COLORS.teal, // #16bfc4
  secondary: MIKU_COLORS.cyan, // #74dce4
  background: MIKU_COLORS.white, // #fbfdff
  foreground: MIKU_COLORS.ink, // #163f4b
  muted: MIKU_COLORS.inkSoft, // #557480
  surface: MIKU_COLORS.ice, // #eefbff
  surfaceElevated: '#eafbfc', // slightly deeper ice
  border: MIKU_COLORS.line, // rgba(22, 191, 196, .24)
  codeBackground: MIKU_COLORS.ice, // #eefbff
  codeForeground: MIKU_COLORS.ink, // #163f4b
  inputBackground: '#f7fdff', // near-white with teal tint
  buttonBackground: MIKU_COLORS.teal, // #16bfc4
  buttonForeground: '#ffffff', // white on teal
  focusRing: 'rgba(22, 191, 196, .6)', // teal focus
};

// ===== 4. Create manifest.json =====
const manifest = {
  $schema: 'https://agentskin.dev/schema/manifest-v2.json',
  schemaVersion: 2,
  id: 'miku-future-beats',
  name: 'miku-future-beats',
  displayName: '初音未来 · Future Beats',
  version: '1.2.0',
  description:
    '和初音未来一起，让灵感、代码与旋律同频闪耀。Miku Future Beats ♫ — Codex × WorkBuddy × QoderWork × TRAE 未来节拍工作台。',
  author: {
    name: 'Codedrobe',
  },
  mode: 'light',
  category: 'anime',
  tags: ['light', 'anime', 'miku', 'teal', 'cyber-pop', 'future-beats'],
  icon: 'icon.png',
  preview: 'preview.png',
  hero: 'hero.png',
  colors: {
    accent: tokens.accent,
    secondary: tokens.secondary,
    background: tokens.background,
    foreground: tokens.foreground,
    muted: tokens.muted,
    surface: tokens.surface,
    surfaceElevated: tokens.surfaceElevated,
    border: tokens.border,
    codeBackground: tokens.codeBackground,
    codeForeground: tokens.codeForeground,
    inputBackground: tokens.inputBackground,
    buttonBackground: tokens.buttonBackground,
    buttonForeground: tokens.buttonForeground,
    focusRing: tokens.focusRing,
  },
  targets: {
    traework: {
      css: 'assets/css/traework.css',
      verification: {
        required: [{ name: 'solo-shell', any: ['.panel-container', '.solo-lite-layout'] }],
        recommended: [
          { name: 'task-sidebar', any: ['.task-list-base', '.task-list-panel'] },
          { name: 'composer', any: ['.chat-input-v2-input-box-editable[contenteditable="true"]'] },
        ],
      },
    },
    qoderwork: {
      css: 'assets/css/qoderwork.css',
      verification: {
        required: [{ name: 'agents-root', any: ['.agents-layout-root'] }],
        recommended: [
          { name: 'sidebar', any: ['.agents-sidebar', '[data-resizable-sidebar]'] },
          { name: 'workspace', any: ['.agents-content-area', '.agents-layout-body'] },
          { name: 'composer', any: ['.chat-input-editor-text[contenteditable="true"]'] },
        ],
      },
    },
    workbuddy: {
      css: 'assets/css/workbuddy.css',
      verification: {
        required: [{ name: 'teams-root', any: ['.teams-container'] }],
        recommended: [
          { name: 'sidebar', any: ['.conversation-sidebar', '.conversation-list'] },
          { name: 'workspace', any: ['.teams-main-content', '.main-content', '.chat-container'] },
          {
            name: 'composer',
            any: [
              '[role="textbox"][contenteditable="true"]',
              '.wb-home-composer [contenteditable="true"]',
            ],
          },
        ],
      },
    },
    doubao: {
      css: 'assets/css/doubao.css',
    },
    codex: {
      css: 'assets/css/codex.css',
    },
    zcode: {
      css: 'assets/css/zcode.css',
    },
  },
  supportedAgents: ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'],
  license: 'MPL-2.0',
  minAppVersion: '2.1.0',
};

// ===== 5. CSS Generation helpers =====

/**
 * Generate the --agentskin-* token block for a given selector
 */
function agentskinTokenBlock(selector, extraProps = '') {
  return `${selector} {
  color-scheme: light !important;
  --agentskin-accent: ${tokens.accent};
  --agentskin-accent-deep: ${MIKU_COLORS.deepTeal};
  --agentskin-secondary: ${tokens.secondary};
  --agentskin-bg: ${tokens.background};
  --agentskin-surface: ${tokens.surface};
  --agentskin-surface-elevated: ${tokens.surfaceElevated};
  --agentskin-text: ${tokens.foreground};
  --agentskin-muted: ${tokens.muted};
  --agentskin-border: ${tokens.border};
  --agentskin-code-bg: ${tokens.codeBackground};
  --agentskin-code-fg: ${tokens.codeForeground};
  --agentskin-input-bg: ${tokens.inputBackground};
  --agentskin-button-bg: ${tokens.buttonBackground};
  --agentskin-focus-ring: ${tokens.focusRing};
  --agentskin-selection: rgba(22, 191, 196, 0.2);
  --agentskin-text-shadow: 0 1px 2px rgba(20, 102, 118, 0.06);
  ${extraProps}
}`;
}

/**
 * Generate the standard --agentskin-* token block for converted CSS
 * Ensures all required tokens are present for check-themes validation
 */
function generateRequiredTokensBlock() {
  return `  --agentskin-bg: ${tokens.background};
  --agentskin-surface: ${tokens.surface};
  --agentskin-surface-elevated: ${tokens.surfaceElevated};
  --agentskin-secondary: ${tokens.secondary};
  --agentskin-code-bg: ${tokens.codeBackground};
  --agentskin-code-fg: ${tokens.codeForeground};
  --agentskin-focus-ring: ${tokens.focusRing};
  --agentskin-selection: rgba(22, 191, 196, 0.2);
  --agentskin-button-bg: ${tokens.buttonBackground};
  --agentskin-input-bg: ${tokens.inputBackground};
  --agentskin-accent-deep: ${MIKU_COLORS.deepTeal};
  --agentskin-accent-secondary: ${MIKU_COLORS.pink};
  --agentskin-accent-tertiary: ${MIKU_COLORS.lavender};
  --agentskin-shadow: ${MIKU_COLORS.shadow};`;
}

/**
 * Convert codedrobe CSS to AgentSkin format
 * - Replace codedrobe selectors with agentskin-host selectors
 * - Replace --miku-* / --doll-* vars with --agentskin-* equivalents
 * - Preserve all structural overrides
 */
function convertCSS(css, adapter) {
  let result = css;

  // Replace selector patterns
  // :root.codedrobe-codex-skin → :root.agentskin-host-codex
  // html:root.codedrobe-host-qoderwork → html:root.agentskin-host-qoderwork
  // html.codedrobe-host-traework → html.agentskin-host-traework
  // :root.codedrobe-host-workbuddy → :root.agentskin-host-workbuddy

  result = result.replace(/:root\.codedrobe-codex-skin/g, ':root.agentskin-host-codex');
  result = result.replace(
    /html:root\.codedrobe-host-qoderwork/g,
    'html:root.agentskin-host-qoderwork',
  );
  result = result.replace(/html\.codedrobe-host-traework/g, 'html.agentskin-host-traework');
  result = result.replace(/:root\.codedrobe-host-workbuddy/g, ':root.agentskin-host-workbuddy');
  result = result.replace(/html\.codedrobe-host-workbuddy/g, 'html.agentskin-host-workbuddy');

  // Replace --miku-* custom vars with --agentskin-* (both declarations and var() references)
  // Note: --miku-deep-teal maps to a distinct var to avoid conflicts
  result = result.replace(/--miku-ink-soft/g, '--agentskin-muted');
  result = result.replace(/--miku-deep-teal/g, '--agentskin-accent-deep');
  result = result.replace(/--miku-teal/g, '--agentskin-accent');
  result = result.replace(/--miku-cyan/g, '--agentskin-secondary');
  result = result.replace(/--miku-pink/g, '--agentskin-accent-secondary');
  result = result.replace(/--miku-lavender/g, '--agentskin-accent-tertiary');
  result = result.replace(/--miku-ice/g, '--agentskin-surface');
  result = result.replace(/--miku-white/g, '--agentskin-bg');
  result = result.replace(/--miku-line/g, '--agentskin-border');
  result = result.replace(/--miku-shadow/g, '--agentskin-shadow');
  result = result.replace(/--miku-ink/g, '--agentskin-text');

  // Replace adapter-specific variants
  result = result.replace(/--miku-qw-ink/g, '--agentskin-text');
  result = result.replace(/--miku-qw-muted/g, '--agentskin-muted');
  result = result.replace(/--miku-qw-deep-teal/g, '--agentskin-accent-deep');
  result = result.replace(/--miku-qw-teal/g, '--agentskin-accent');
  result = result.replace(/--miku-qw-cyan/g, '--agentskin-secondary');
  result = result.replace(/--miku-qw-pink/g, '--agentskin-accent-secondary');
  result = result.replace(/--miku-qw-lavender/g, '--agentskin-accent-tertiary');
  result = result.replace(/--miku-qw-ice/g, '--agentskin-surface');
  result = result.replace(/--miku-qw-line/g, '--agentskin-border');
  result = result.replace(/--miku-qw-shadow/g, '--agentskin-shadow');

  result = result.replace(/--miku-tw-ink/g, '--agentskin-text');
  result = result.replace(/--miku-tw-muted/g, '--agentskin-muted');
  result = result.replace(/--miku-tw-deep-teal/g, '--agentskin-accent-deep');
  result = result.replace(/--miku-tw-teal/g, '--agentskin-accent');
  result = result.replace(/--miku-tw-pink/g, '--agentskin-accent-secondary');
  result = result.replace(/--miku-tw-lavender/g, '--agentskin-accent-tertiary');
  result = result.replace(/--miku-tw-line/g, '--agentskin-border');
  result = result.replace(/--miku-tw-shadow/g, '--agentskin-shadow');

  result = result.replace(/--miku-wb-ink/g, '--agentskin-text');
  result = result.replace(/--miku-wb-muted/g, '--agentskin-muted');
  result = result.replace(/--miku-wb-deep-teal/g, '--agentskin-accent-deep');
  result = result.replace(/--miku-wb-teal/g, '--agentskin-accent');
  result = result.replace(/--miku-wb-cyan/g, '--agentskin-secondary');
  result = result.replace(/--miku-wb-pink/g, '--agentskin-accent-secondary');
  result = result.replace(/--miku-wb-lavender/g, '--agentskin-accent-tertiary');
  result = result.replace(/--miku-wb-ice/g, '--agentskin-surface');
  result = result.replace(/--miku-wb-white/g, '--agentskin-bg');
  result = result.replace(/--miku-wb-line/g, '--agentskin-border');
  result = result.replace(/--miku-wb-shadow/g, '--agentskin-shadow');

  // Replace --doll-* vars (workbuddy decorative)
  result = result.replace(/--doll-ink/g, '--agentskin-text');
  result = result.replace(/--doll-ink-soft/g, '--agentskin-muted');
  result = result.replace(/--doll-plum/g, '--agentskin-accent-deep');
  result = result.replace(/--doll-lavender/g, '--agentskin-accent-tertiary');
  result = result.replace(/--doll-pink/g, '--agentskin-accent-secondary');
  result = result.replace(/--doll-blush/g, '--agentskin-surface');
  result = result.replace(/--doll-cream/g, '--agentskin-bg');
  result = result.replace(/--doll-line/g, '--agentskin-border');
  result = result.replace(/--doll-shadow/g, '--agentskin-shadow');
  result = result.replace(/--doll-wb-ink/g, '--agentskin-text');
  result = result.replace(/--doll-wb-muted/g, '--agentskin-muted');
  result = result.replace(/--doll-wb-plum/g, '--agentskin-accent-deep');
  result = result.replace(/--doll-wb-lavender/g, '--agentskin-accent-tertiary');
  result = result.replace(/--doll-wb-pink/g, '--agentskin-accent-secondary');
  result = result.replace(/--doll-wb-cream/g, '--agentskin-bg');
  result = result.replace(/--doll-wb-line/g, '--agentskin-border');
  result = result.replace(/--doll-wb-shadow/g, '--agentskin-shadow');

  // Replace --codedrobe-image-* references (keep as-is, they're engine-provided)

  // Ensure all required --agentskin-* tokens are declared
  // Check which tokens are missing and inject them into the first selector block
  const requiredTokens = [
    '--agentskin-bg',
    '--agentskin-surface',
    '--agentskin-surface-elevated',
    '--agentskin-secondary',
    '--agentskin-code-bg',
    '--agentskin-code-fg',
    '--agentskin-focus-ring',
    '--agentskin-selection',
    '--agentskin-button-bg',
    '--agentskin-input-bg',
  ];

  const missingTokens = requiredTokens.filter((tok) => !result.includes(`${tok}:`));

  if (missingTokens.length > 0) {
    const tokensToInject = missingTokens
      .map((tok) => {
        switch (tok) {
          case '--agentskin-bg':
            return `  --agentskin-bg: ${tokens.background};`;
          case '--agentskin-surface':
            return `  --agentskin-surface: ${tokens.surface};`;
          case '--agentskin-surface-elevated':
            return `  --agentskin-surface-elevated: ${tokens.surfaceElevated};`;
          case '--agentskin-secondary':
            return `  --agentskin-secondary: ${tokens.secondary};`;
          case '--agentskin-code-bg':
            return `  --agentskin-code-bg: ${tokens.codeBackground};`;
          case '--agentskin-code-fg':
            return `  --agentskin-code-fg: ${tokens.codeForeground};`;
          case '--agentskin-focus-ring':
            return `  --agentskin-focus-ring: ${tokens.focusRing};`;
          case '--agentskin-selection':
            return `  --agentskin-selection: rgba(22, 191, 196, 0.2);`;
          case '--agentskin-button-bg':
            return `  --agentskin-button-bg: ${tokens.buttonBackground};`;
          case '--agentskin-input-bg':
            return `  --agentskin-input-bg: ${tokens.inputBackground};`;
          default:
            return null;
        }
      })
      .filter(Boolean)
      .join('\n');

    // Insert after the first opening brace of the first selector block
    const firstBraceIdx = result.indexOf('{');
    if (firstBraceIdx !== -1) {
      const insertPos = firstBraceIdx + 1;
      result = result.substring(0, insertPos) + '\n' + tokensToInject + result.substring(insertPos);
    }
  }

  return result;
}

/**
 * Generate Doubao CSS (thematic token overrides for --dbx-* system)
 */
function generateDoubaoCSS() {
  return `/* Miku Future Beats · 豆包 (Doubao) (--dbx-* design tokens)
   Strategy: override the semantic layer of Doubao's 251-token --dbx-* system
   (text/bg/fill/line/code/brand) while leaving the neutral scale, static alpha
   ramps, and color palettes untouched. Selector specificity (0,2,1) beats both
   :root[data-theme="dark"] (0,1,1) and the light selector list. */

${agentskinTokenBlock('html.agentskin-host-doubao', 'text-shadow: var(--agentskin-text-shadow);')}

/* ===== Native token overrides ===== */
html.agentskin-host-doubao:root {
  color-scheme: light !important;

  /* Backgrounds */
  --dbx-bg-body-web: ${tokens.background} !important;
  --dbx-bg-base-web: ${tokens.background} !important;
  --dbx-bg-base-2: ${tokens.surface} !important;
  --dbx-bg-base-5: #eafbfc !important;
  --dbx-bg-float: ${tokens.surfaceElevated} !important;
  --dbx-bg-body-overlay-web: ${tokens.surface} !important;
  --dbx-bg-body-white: ${tokens.background} !important;
  --dbx-bg-body-mac: rgba(251, 253, 255, 0.85) !important;
  --dbx-bg-base-mac: rgba(22, 63, 75, 0.03) !important;
  --dbx-bg-browser-win: ${tokens.background} !important;
  --dbx-bg-browser-mac: rgba(251, 253, 255, 0.7) !important;
  --dbx-bg-body-launcher: rgba(238, 251, 255, 0.8) !important;
  --dbx-bg-body-overlay-launcher: rgba(238, 251, 255, 0.45) !important;
  --dbx-bg-float-launcher: rgba(234, 251, 252, 0.6) !important;
  --dbx-bg-body-overlay-mac: rgba(238, 251, 255, 0.6) !important;
  --dbx-bg-body-overlay-white: rgba(238, 251, 255, 0.6) !important;
  --dbx-bg-base-2-mobile: ${tokens.surface} !important;
  --dbx-bg-base-2-overlay-mobile: ${tokens.surface} !important;
  --dbx-bg-base-3-mobile: ${tokens.surfaceElevated} !important;
  --dbx-bg-base-3-enterprisebubble: ${tokens.surfaceElevated} !important;

  /* Text hierarchy */
  --dbx-text-main: ${tokens.foreground} !important;
  --dbx-text-secondary: ${tokens.muted} !important;
  --dbx-text-tertiary: rgba(22, 63, 75, 0.55) !important;
  --dbx-text-quaternary: rgba(22, 63, 75, 0.4) !important;
  --dbx-text-disabled: rgba(22, 63, 75, 0.3) !important;
  --dbx-text-brand: ${tokens.accent} !important;
  --dbx-text-link: ${tokens.accent} !important;
  --dbx-text-hover: ${tokens.deepTeal} !important;
  --dbx-text-active: ${tokens.deepTeal} !important;
  --dbx-text-onbrand: #ffffff !important;

  /* Borders / dividers */
  --dbx-line-main: ${tokens.border} !important;
  --dbx-line-secondary: rgba(22, 191, 196, 0.14) !important;
  --dbx-line-tertiary: rgba(22, 191, 196, 0.09) !important;
  --dbx-line-brand: ${tokens.accent} !important;

  /* Fills / hovers */
  --dbx-fill-main: ${tokens.surface} !important;
  --dbx-fill-secondary: rgba(22, 191, 196, 0.08) !important;
  --dbx-fill-tertiary: rgba(22, 191, 196, 0.12) !important;
  --dbx-fill-hover: rgba(22, 191, 196, 0.1) !important;
  --dbx-fill-active: rgba(22, 191, 196, 0.16) !important;
  --dbx-fill-brand: ${tokens.accent} !important;
  --dbx-fill-brand-hover: ${tokens.deepTeal} !important;
  --dbx-fill-brand-active: #0e9ba1 !important;

  /* Brand / accent */
  --dbx-brand: ${tokens.accent} !important;
  --dbx-brand-hover: ${tokens.deepTeal} !important;
  --dbx-brand-active: #0e9ba1 !important;
  --dbx-brand-text: #ffffff !important;
  --dbx-brand-bg: rgba(22, 191, 196, 0.1) !important;
  --dbx-brand-border: rgba(22, 191, 196, 0.24) !important;

  /* Code surfaces */
  --dbx-code-bg: ${tokens.codeBackground} !important;
  --dbx-code-text: ${tokens.codeForeground} !important;
  --dbx-code-comment: ${tokens.muted} !important;
  --dbx-code-keyword: ${tokens.accent} !important;
  --dbx-code-string: #0e9ba1 !important;
  --dbx-code-number: ${tokens.lavender} !important;

  /* Shadows */
  --dbx-shadow-sm: 0 1px 2px rgba(20, 102, 118, 0.06) !important;
  --dbx-shadow-md: 0 4px 8px rgba(20, 102, 118, 0.1) !important;
  --dbx-shadow-lg: 0 8px 16px rgba(20, 102, 118, 0.14) !important;
  --dbx-shadow-xl: 0 12px 24px rgba(20, 102, 118, 0.18) !important;
}
`;
}

/**
 * Generate ZCode CSS (thematic token overrides for --color-* Tailwind v4 system)
 */
function generateZCodeCSS() {
  return `/* Miku Future Beats · ZCode (--color-* Tailwind v4 native tokens + engine flat semantic layer) */

${agentskinTokenBlock('html.agentskin-host-zcode', 'text-shadow: var(--agentskin-text-shadow);')}

/* ===== Native token overrides ===== */
html.agentskin-host-zcode {
  color-scheme: light !important;

  /* Text hierarchy */
  --text-primary: ${tokens.foreground} !important;
  --text-secondary: ${tokens.muted} !important;
  --text-tertiary: rgba(22, 63, 75, 0.55) !important;
  --text-quaternary: rgba(22, 63, 75, 0.4) !important;

  /* Backgrounds — transparent for art punch-through */
  --bg-primary: ${tokens.background} !important;
  --gb-secondary: ${tokens.surface} !important;
  --bg-tertiary: ${tokens.surfaceElevated} !important;
  --bg-elevated: ${tokens.surfaceElevated} !important;
  --bg-base: ${tokens.background} !important;
  --bg-canvas: ${tokens.background} !important;
  --bg-surface: ${tokens.surface} !important;
  --bg-hover: rgba(22, 191, 196, 0.08) !important;
  --bg-active: rgba(22, 191, 196, 0.12) !important;
  --bg-selected: rgba(22, 191, 196, 0.1) !important;

  /* Borders */
  --border-xsubtle: rgba(22, 191, 196, 0.06) !important;
  --border-subtle: rgba(22, 191, 196, 0.09) !important;
  --border-medium: ${tokens.border} !important;
  --border-strong: rgba(22, 191, 196, 0.3) !important;

  /* Accent / brand */
  --accent: ${tokens.accent} !important;
  --accent-hover: ${tokens.deepTeal} !important;
  --accent-active: #0e9ba1 !important;
  --accent-foreground: #ffffff !important;
  --accent-subtle: rgba(22, 191, 196, 0.1) !important;

  /* Semantic colors */
  --success: #16bfc4 !important;
  --warning: #f59e0b !important;
  --error: #ef4444 !important;
  --info: #9f92f8 !important;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(20, 102, 118, 0.06) !important;
  --shadow-md: 0 4px 8px rgba(20, 102, 118, 0.1) !important;
  --shadow-lg: 0 8px 16px rgba(20, 102, 118, 0.14) !important;

  /* Ring / focus */
  --ring: ${tokens.focusRing} !important;
  --ring-offset: ${tokens.background} !important;
}
`;
}

// ===== 6. Decode and save images =====
function decodeImage(base64Str, outputPath) {
  const buffer = Buffer.from(base64Str, 'base64');
  writeFileSync(outputPath, buffer);
  console.log(`  Saved: ${outputPath.replace(OUTPUT_DIR + '/', '')} (${buffer.length} bytes)`);
}

function decodeImageWithAlpha(base64Str, outputPath) {
  const buffer = Buffer.from(base64Str, 'base64');
  writeFileSync(outputPath, buffer);
  console.log(`  Saved: ${outputPath.replace(OUTPUT_DIR + '/', '')} (${buffer.length} bytes)`);
}

// ===== 7. Main conversion =====
console.log('\n--- Converting Codedrobe Theme → AgentSkin ---\n');

// Create directory structure
mkdirSync(OUTPUT_DIR, { recursive: true });
mkdirSync(join(OUTPUT_DIR, 'assets', 'css'), { recursive: true });

// Save manifest
writeFileSync(join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('✓ manifest.json');

// Save icon (use hero as icon placeholder)
const heroBase64 = source.assets.images.hero.base64;
const textureBase64 = source.assets.images.texture.base64;

decodeImage(heroBase64, join(OUTPUT_DIR, 'hero.png'));
decodeImage(heroBase64, join(OUTPUT_DIR, 'icon.png')); // Use hero as icon
decodeImage(heroBase64, join(OUTPUT_DIR, 'preview.png')); // Use hero as preview

// Save texture as additional asset
decodeImage(textureBase64, join(OUTPUT_DIR, 'texture.png'));

// Convert and save CSS for each adapter
console.log('\n--- Converting CSS ---\n');

// Codex
const codexCSS = convertCSS(source.targets.codex.css, 'codex');
writeFileSync(join(OUTPUT_DIR, 'assets', 'css', 'codex.css'), codexCSS);
console.log('✓ assets/css/codex.css');

// QoderWork
const qoderworkCSS = convertCSS(source.targets.qoderwork.css, 'qoderwork');
writeFileSync(join(OUTPUT_DIR, 'assets', 'css', 'qoderwork.css'), qoderworkCSS);
console.log('✓ assets/css/qoderwork.css');

// TRAE Work
const traeworkCSS = convertCSS(source.targets.traework.css, 'traework');
writeFileSync(join(OUTPUT_DIR, 'assets', 'css', 'traework.css'), traeworkCSS);
console.log('✓ assets/css/traework.css');

// WorkBuddy
const workbuddyCSS = convertCSS(source.targets.workbuddy.css, 'workbuddy');
writeFileSync(join(OUTPUT_DIR, 'assets', 'css', 'workbuddy.css'), workbuddyCSS);
console.log('✓ assets/css/workbuddy.css');

// Doubao (generated)
const doubaoCSS = generateDoubaoCSS();
writeFileSync(join(OUTPUT_DIR, 'assets', 'css', 'doubao.css'), doubaoCSS);
console.log('✓ assets/css/doubao.css (generated)');

// ZCode (generated)
const zcodeCSS = generateZCodeCSS();
writeFileSync(join(OUTPUT_DIR, 'assets', 'css', 'zcode.css'), zcodeCSS);
console.log('✓ assets/css/zcode.css (generated)');

console.log('\n--- Conversion Complete ---');
console.log(`Output: ${OUTPUT_DIR}`);
console.log('\nNext steps:');
console.log('  1. Review manifest.json for accuracy');
console.log('  2. Run: npm run check');
console.log('  3. Test in AgentSkin Studio');
