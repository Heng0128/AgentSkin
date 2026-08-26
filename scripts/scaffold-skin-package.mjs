// SPDX-License-Identifier: MPL-2.0

/**
 * # scaffold-skin-package.mjs — Skin package scaffold generator
 *
 * Generates a complete AgentSkin theme package from minimal inputs
 * (name, slug, agent, colors). Inspired by the codex-skin-builder
 * `scaffold_skin.py` pattern: input metadata → output full skin package
 * (manifest + CSS + install/verify/restore scripts + SKILL.md + README.md).
 *
 * The generated package obeys the 14-token theme contract (THEME_SPEC.md)
 * and is compatible with `build-theme-package.mjs` for downstream bundling.
 *
 * @type {import('node:fs')}
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIRED_TOKENS } from './theme-tokens.mjs';
import { HOSTS } from './theme-utils.mjs';
import { luminance } from './utils/color-utils.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported agent identifiers (mirrors the 6 active adapters). */
export const SUPPORTED_AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

/** The 13 manifest color keys that map to the 14 CSS tokens. */
export const MANIFEST_COLOR_KEYS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'muted',
  'surface',
  'surfaceElevated',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
];

/** Slug validation: lowercase letters, digits, hyphens only. */
const SLUG_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

// ---------------------------------------------------------------------------
// Argument parsing (CLI)
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments into a ScaffoldOptions-shaped object.
 * Supports `--key value` and `--key=value` forms.
 *
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Partial<ScaffoldOptions>}
 */
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    let value;
    if (key.includes('=')) {
      const eq = key.indexOf('=');
      value = key.slice(eq + 1);
      const k = key.slice(0, eq);
      options[k] = value;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      value = next;
      i++;
    } else {
      value = 'true';
    }
    // Convert dotted keys (e.g. colors.primary) into nested objects
    if (key.includes('.')) {
      const [parent, child] = key.split('.');
      if (!options[parent]) options[parent] = {};
      options[parent][child] = value;
    } else {
      options[key] = value;
    }
  }
  // Convert string booleans
  if (options.unofficial === 'true') options.unofficial = true;
  return options;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate scaffold options. Returns an array of error messages (empty = valid).
 *
 * @param {Partial<ScaffoldOptions>} options
 * @returns {string[]} Validation error messages.
 */
export function validateOptions(options) {
  const errors = [];
  if (!options.name || typeof options.name !== 'string') {
    errors.push('Missing required option: --name');
  }
  if (!options.slug || typeof options.slug !== 'string') {
    errors.push('Missing required option: --slug');
  } else if (!SLUG_PATTERN.test(options.slug)) {
    errors.push(
      `Invalid slug '${options.slug}': must match ${SLUG_PATTERN} (lowercase letters, digits, hyphens)`,
    );
  }
  if (!options.agent || typeof options.agent !== 'string') {
    errors.push('Missing required option: --agent');
  } else if (!SUPPORTED_AGENTS.includes(options.agent)) {
    errors.push(
      `Unsupported agent '${options.agent}': must be one of ${SUPPORTED_AGENTS.join(', ')}`,
    );
  }
  if (!options.output || typeof options.output !== 'string') {
    errors.push('Missing required option: --output');
  }
  // Validate color values if provided
  if (options.colors && typeof options.colors === 'object') {
    for (const [k, v] of Object.entries(options.colors)) {
      if (typeof v === 'string' && !isValidColor(v)) {
        errors.push(`Invalid color value for '${k}': '${v}'`);
      }
    }
  }
  return errors;
}

/**
 * Basic color validation: hex (#rgb, #rrggbb) or rgba() string.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidColor(value) {
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return true;
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+)?\s*\)$/i.test(value)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Color derivation
// ---------------------------------------------------------------------------

/**
 * Build a complete 14-token color set from user-provided partial colors.
 * Missing tokens are derived from the provided ones using the same logic
 * as `derive-missing-tokens.mjs`.
 *
 * @param {ScaffoldOptions['colors']} colors
 * @returns {Record<string, string>} Complete color map with all 14 keys.
 */
export function deriveColors(colors = {}) {
  const c = { ...colors };
  const isDark = c.background ? luminance(c.background) < 0.5 : true;

  // Derive missing tokens
  if (!c.accent) c.accent = isDark ? '#7c9cff' : '#3b6fe0';
  if (!c.secondary) c.secondary = isDark ? '#f097c8' : '#d946a8';
  if (!c.background) c.background = isDark ? '#13171a' : '#f5f5f7';
  if (!c.foreground) c.foreground = isDark ? '#f4f0eb' : '#1a1a2e';
  if (!c.muted) c.muted = isDark ? '#cbc9c6' : '#6b7280';
  if (!c.surface) c.surface = isDark ? '#292d30' : '#ffffff';
  if (!c.surfaceElevated) c.surfaceElevated = isDark ? '#373b3e' : '#ffffff';
  if (!c.border) c.border = isDark ? 'rgba(124,156,255,0.18)' : 'rgba(59,111,224,0.18)';
  if (!c.codeBackground) c.codeBackground = isDark ? '#111517' : '#f0f0f4';
  if (!c.codeForeground) c.codeForeground = c.foreground;
  if (!c.inputBackground) c.inputBackground = isDark ? '#24292c' : '#ffffff';
  if (!c.buttonBackground) c.buttonBackground = c.accent;
  if (!c.buttonForeground) c.buttonForeground = isDark ? '#ffffff' : '#1a1a2e';
  if (!c.focusRing) c.focusRing = `${c.accent}60`;
  if (!c.selection) c.selection = `${c.accent}52`;

  return c;
}

// ---------------------------------------------------------------------------
// Manifest generation
// ---------------------------------------------------------------------------

/**
 * Generate the manifest.json content for a scaffolded theme.
 *
 * @param {ScaffoldOptions} options
 * @returns {object} Manifest object (JSON-serializable).
 */
export function generateManifest(options) {
  const colors = deriveColors(options.colors);
  const isDark = luminance(colors.background) < 0.5;
  const mode = isDark ? 'dark' : 'light';
  const hostSelector = HOSTS[options.agent] || `html.agentskin-host-${options.agent}`;

  return {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    format: 'agentskin-theme',
    id: options.slug,
    name: options.slug,
    displayName: options.name,
    version: '1.0.0',
    description: options.description || `Scaffolded theme "${options.name}" for ${options.agent}`,
    author: { name: options.author || 'AgentSkin Scaffold' },
    mode,
    category: 'scaffold',
    tags: ['scaffold', 'custom', mode, options.agent],
    unofficial: true,
    icon: 'icon.png',
    preview: 'preview.png',
    colors: {
      accent: colors.accent,
      secondary: colors.secondary,
      background: colors.background,
      foreground: colors.foreground,
      muted: colors.muted,
      surface: colors.surface,
      surfaceElevated: colors.surfaceElevated,
      border: colors.border,
      codeBackground: colors.codeBackground,
      codeForeground: colors.codeForeground,
      inputBackground: colors.inputBackground,
      buttonBackground: colors.buttonBackground,
      buttonForeground: colors.buttonForeground,
      focusRing: colors.focusRing,
    },
    targets: {
      [options.agent]: {
        css: `assets/css/${options.agent}.css`,
        verification: {
          required: [{ name: `${options.agent}-root`, any: [hostSelector] }],
        },
      },
    },
    supportedAgents: [options.agent],
    license: 'MPL-2.0',
    minAppVersion: '1.0.0',
    probe: {
      tokenNamespaces: ['--agentskin-'],
      styleContract: 'THEME_SPEC.md#探针样式契约',
    },
  };
}

// ---------------------------------------------------------------------------
// CSS generation
// ---------------------------------------------------------------------------

/**
 * Generate the agent CSS file content with all 14 required tokens.
 *
 * @param {ScaffoldOptions} options
 * @returns {string} CSS text.
 */
export function generateCss(options) {
  const colors = deriveColors(options.colors);
  const isDark = luminance(colors.background) < 0.5;
  const mode = isDark ? 'dark' : 'light';
  const host = HOSTS[options.agent] || `html.agentskin-host-${options.agent}`;
  const agentId = options.agent;

  const lines = [];
  lines.push(`/* ${options.name} — ${agentId} (${mode}) */`);
  lines.push(`/* Generated by scaffold-skin-package.mjs */`);
  lines.push('');

  // :root block with all 14 --agentskin-* tokens
  lines.push(':root {');
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const token of REQUIRED_TOKENS) {
    const value = cssTokenValue(token, colors);
    lines.push(`  ${token}: ${value};`);
  }
  // Extra derived tokens
  lines.push(`  --agentskin-button-fg: ${colors.buttonForeground};`);
  lines.push(
    `  --agentskin-text-shadow: ${isDark ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 2px rgba(255,255,255,0.6)'};`,
  );
  lines.push('}');
  lines.push('');

  // Host-scoped block
  lines.push(`${host} {`);
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const token of REQUIRED_TOKENS) {
    const value = cssTokenValue(token, colors);
    lines.push(`  ${token}: ${value};`);
  }
  lines.push('}');
  lines.push('');

  // Agent-native token remap (minimal set for the target agent)
  const remap = AGENT_TOKEN_REMAP[agentId] || [];
  if (remap.length > 0) {
    lines.push(`/* Redirect ${agentId} native design tokens onto the scaffolded palette */`);
    lines.push(`${host} {`);
    for (const [nativeToken, agentskinToken] of remap) {
      lines.push(`  ${nativeToken}: var(${agentskinToken}) !important;`);
    }
    lines.push('}');
  }

  return lines.join('\n');
}

/**
 * Map a --agentskin-* token name to its CSS value from the color map.
 *
 * @param {string} token
 * @param {Record<string,string>} colors
 * @returns {string}
 */
function cssTokenValue(token, colors) {
  switch (token) {
    case '--agentskin-accent':
      return colors.accent;
    case '--agentskin-secondary':
      return colors.secondary;
    case '--agentskin-bg':
      return colors.background;
    case '--agentskin-surface':
      return colors.surface;
    case '--agentskin-surface-elevated':
      return colors.surfaceElevated;
    case '--agentskin-text':
      return colors.foreground;
    case '--agentskin-muted':
      return colors.muted;
    case '--agentskin-border':
      return colors.border;
    case '--agentskin-code-bg':
      return colors.codeBackground;
    case '--agentskin-code-fg':
      return colors.codeForeground;
    case '--agentskin-input-bg':
      return colors.inputBackground;
    case '--agentskin-button-bg':
      return colors.buttonBackground;
    case '--agentskin-focus-ring':
      return colors.focusRing;
    case '--agentskin-selection':
      return colors.selection;
    default:
      return 'inherit';
  }
}

/**
 * Minimal agent-native token remap table. Each entry maps a native token
 * to the --agentskin-* token it should resolve through.
 */
const AGENT_TOKEN_REMAP = {
  traework: [
    ['--vscode-editor-background', '--agentskin-bg'],
    ['--vscode-foreground', '--agentskin-text'],
    ['--vscode-editor-foreground', '--agentskin-text'],
    ['--vscode-sideBar-background', '--agentskin-surface'],
    ['--vscode-button-background', '--agentskin-accent'],
    ['--vscode-button-foreground', '--agentskin-button-fg'],
    ['--vscode-focusBorder', '--agentskin-focus-ring'],
    ['--vscode-textLink-foreground', '--agentskin-accent'],
  ],
  qoderwork: [
    ['--color-bg-primary', '--agentskin-bg'],
    ['--color-bg-secondary', '--agentskin-surface'],
    ['--color-text-primary', '--agentskin-text'],
    ['--color-text-secondary', '--agentskin-muted'],
    ['--color-accent', '--agentskin-accent'],
    ['--color-brand', '--agentskin-accent'],
    ['--color-line-border', '--agentskin-border'],
    ['--color-code-bg', '--agentskin-code-bg'],
    ['--color-code-fg', '--agentskin-code-fg'],
    ['--color-focus-ring', '--agentskin-focus-ring'],
  ],
  workbuddy: [
    ['--cb-bg-primary', '--agentskin-bg'],
    ['--cb-bg-secondary', '--agentskin-surface'],
    ['--cb-text-primary', '--agentskin-text'],
    ['--cb-text-secondary', '--agentskin-muted'],
    ['--cb-text-link', '--agentskin-accent'],
    ['--cb-vscode-editor-background', '--agentskin-bg'],
    ['--cb-vscode-foreground', '--agentskin-text'],
    ['--cb-vscode-button-background', '--agentskin-accent'],
    ['--cb-vscode-button-foreground', '--agentskin-button-fg'],
    ['--cb-vscode-focusBorder', '--agentskin-focus-ring'],
    ['--cb-vscode-textLink-foreground', '--agentskin-accent'],
  ],
  doubao: [
    ['--dbx-bg-primary', '--agentskin-bg'],
    ['--dbx-bg-secondary', '--agentskin-surface'],
    ['--dbx-text-primary', '--agentskin-text'],
    ['--dbx-text-secondary', '--agentskin-muted'],
    ['--dbx-text-link', '--agentskin-accent'],
    ['--dbx-brand', '--agentskin-accent'],
    ['--dbx-line-border', '--agentskin-border'],
    ['--dbx-code-bg', '--agentskin-code-bg'],
    ['--dbx-code-fg', '--agentskin-code-fg'],
    ['--dbx-focus-ring', '--agentskin-focus-ring'],
  ],
  codex: [
    ['--text-primary', '--agentskin-text'],
    ['--text-secondary', '--agentskin-muted'],
    ['--bg-primary', '--agentskin-bg'],
    ['--bg-secondary', '--agentskin-surface'],
    ['--fill-input', '--agentskin-input-bg'],
    ['--line-border', '--agentskin-border'],
    ['--brand', '--agentskin-accent'],
    ['--brand-hover', '--agentskin-accent'],
    ['--code-bg', '--agentskin-code-bg'],
    ['--code-fg', '--agentskin-code-fg'],
    ['--focus-ring', '--agentskin-focus-ring'],
  ],
  zcode: [
    ['--text-primary', '--agentskin-text'],
    ['--text-secondary', '--agentskin-muted'],
    ['--bg-primary', '--agentskin-bg'],
    ['--bg-secondary', '--agentskin-surface'],
    ['--fill-input', '--agentskin-input-bg'],
    ['--line-border', '--agentskin-border'],
    ['--brand', '--agentskin-accent'],
    ['--code-bg', '--agentskin-code-bg'],
    ['--code-fg', '--agentskin-code-fg'],
    ['--focus-ring', '--agentskin-focus-ring'],
  ],
};

// ---------------------------------------------------------------------------
// Script generation (install / verify / restore)
// ---------------------------------------------------------------------------

/**
 * Generate the install.mjs script content.
 *
 * @param {ScaffoldOptions} options
 * @returns {string}
 */
export function generateInstallScript(options) {
  return `// SPDX-License-Identifier: MPL-2.0
// Install script for "${options.name}" (${options.slug})
// Copies the scaffolded theme into the AgentSkin themes directory.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themeDir = path.resolve(__dirname, '..');
const targetDir = path.join(
  process.env.AGENTSKIN_THEMES_DIR || path.join(process.env.USERPROFILE || '.', '.agentskin', 'themes'),
  '${options.slug}',
);

fs.mkdirSync(targetDir, { recursive: true });
const files = ['manifest.json', 'SKILL.md', 'README.md'];
for (const f of files) {
  const src = path.join(themeDir, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetDir, f));
}
// Copy assets/css
const cssSrc = path.join(themeDir, 'assets', 'css');
const cssDst = path.join(targetDir, 'assets', 'css');
if (fs.existsSync(cssSrc)) {
  fs.mkdirSync(cssDst, { recursive: true });
  for (const f of fs.readdirSync(cssSrc)) {
    fs.copyFileSync(path.join(cssSrc, f), path.join(cssDst, f));
  }
}
console.log('Installed "${options.name}" to', targetDir);
`;
}

/**
 * Generate the verify.mjs script content.
 *
 * @param {ScaffoldOptions} options
 * @returns {string}
 */
export function generateVerifyScript(options) {
  return `// SPDX-License-Identifier: MPL-2.0
// Verify script for "${options.name}" (${options.slug})
// Checks that the theme package is well-formed and complete.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themeDir = path.resolve(__dirname, '..');
const errors = [];

// Check manifest.json
const manifestPath = path.join(themeDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  errors.push('Missing manifest.json');
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.id !== '${options.slug}') {
    errors.push('manifest.id does not match slug');
  }
  if (!manifest.colors || typeof manifest.colors !== 'object') {
    errors.push('manifest.colors missing');
  }
}

// Check CSS file
const cssPath = path.join(themeDir, 'assets', 'css', '${options.agent}.css');
if (!fs.existsSync(cssPath)) {
  errors.push('Missing CSS file: assets/css/${options.agent}.css');
}

if (errors.length > 0) {
  console.error('Verification FAILED:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}
console.log('Verification PASSED for "${options.name}"');
`;
}

/**
 * Generate the restore.mjs script content.
 *
 * @param {ScaffoldOptions} options
 * @returns {string}
 */
export function generateRestoreScript(options) {
  return `// SPDX-License-Identifier: MPL-2.0
// Restore script for "${options.name}" (${options.slug})
// Removes the theme from the AgentSkin themes directory.

import fs from 'node:fs';
import path from 'node:path';

const targetDir = path.join(
  process.env.AGENTSKIN_THEMES_DIR || path.join(process.env.USERPROFILE || '.', '.agentskin', 'themes'),
  '${options.slug}',
);

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log('Removed "${options.name}" from', targetDir);
} else {
  console.log('Theme "${options.name}" is not installed.');
}
`;
}

// ---------------------------------------------------------------------------
// SKILL.md generation
// ---------------------------------------------------------------------------

/**
 * Generate SKILL.md content.
 *
 * @param {ScaffoldOptions} options
 * @returns {string}
 */
export function generateSkillMd(options) {
  const colors = deriveColors(options.colors);
  return `---
name: ${options.slug}
version: 1.0.0
agent: ${options.agent}
---

# ${options.name}

${options.description || `Scaffolded theme for ${options.agent}.`}

## Tokens

| Token | Value |
|-------|-------|
${REQUIRED_TOKENS.map((t) => `| \`${t}\` | \`${cssTokenValue(t, colors)}\` |`).join('\n')}

## Installation

\`\`\`bash
node scripts/install.mjs
\`\`\`

## Verification

\`\`\`bash
node scripts/verify.mjs
\`\`\`

## Restore

\`\`\`bash
node scripts/restore.mjs
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// README.md generation
// ---------------------------------------------------------------------------

/**
 * Generate README.md content.
 *
 * @param {ScaffoldOptions} options
 * @returns {string}
 */
export function generateReadme(options) {
  return `# ${options.name}

${options.description || `Scaffolded AgentSkin theme for ${options.agent}.`}

## Structure

\`\`\`
${options.slug}/
├── manifest.json          # Theme manifest (14-token contract)
├── assets/
│   ├── css/
│   │   └── ${options.agent}.css    # Theme styles
│   └── images/            # Image resources
├── scripts/
│   ├── install.mjs        # Install script
│   ├── verify.mjs         # Verify script
│   └── restore.mjs        # Restore script
├── SKILL.md               # Skill metadata
└── README.md              # This file
\`\`\`

## Usage

1. Customize colors in \`manifest.json\` (14-token contract)
2. Edit \`assets/css/${options.agent}.css\` for styling
3. Run \`node scripts/install.mjs\` to install
4. Run \`node scripts/verify.mjs\` to verify

## Agent

Target: \`${options.agent}\`

## License

MPL-2.0
`;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (zlib only, no native deps) — placeholder images
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** pixelFn(x, y) -> [r, g, b] */
function makePng(width, height, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Parse a hex color to [r, g, b]. */
function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [124, 156, 255];
  return [
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
  ];
}

/**
 * Generate a placeholder icon PNG (128x128, accent rounded square).
 *
 * @param {string} accent - Hex accent color.
 * @returns {Buffer}
 */
export function generateIconPng(accent) {
  const [r, g, b] = hexToRgb(accent);
  const W = 128;
  const H = 128;
  const rad = 28;
  return makePng(W, H, (x, y) => {
    const dx = Math.min(x, W - 1 - x);
    const dy = Math.min(y, H - 1 - y);
    const corner = Math.min(dx, dy);
    if (corner < rad - 6) {
      const edge = rad - corner;
      if (edge > 6) return [0, 0, 0];
    }
    return [r, g, b];
  });
}

/**
 * Generate a placeholder preview PNG (240x150, gradient from bg to surface).
 *
 * @param {string} bg - Hex background color.
 * @param {string} surface - Hex surface color.
 * @param {string} accent - Hex accent color.
 * @returns {Buffer}
 */
export function generatePreviewPng(bg, surface, accent) {
  const bgRgb = hexToRgb(bg);
  const surfRgb = hexToRgb(surface);
  const accRgb = hexToRgb(accent);
  const W = 240;
  const H = 150;
  return makePng(W, H, (x, y) => {
    const t = y / H;
    const r = Math.round(bgRgb[0] + (surfRgb[0] - bgRgb[0]) * t);
    const g = Math.round(bgRgb[1] + (surfRgb[1] - bgRgb[1]) * t);
    const b = Math.round(bgRgb[2] + (surfRgb[2] - bgRgb[2]) * t);
    const inBar = y > H - 40 && x > 20 && x < W - 20 && y - (H - 40) < 20;
    if (inBar) return accRgb;
    return [r, g, b];
  });
}

// ---------------------------------------------------------------------------
// Main scaffold function
// ---------------------------------------------------------------------------

/**
 * Scaffold a complete skin package at the given output directory.
 * Creates the directory structure and writes all files.
 *
 * @param {ScaffoldOptions} options
 * @returns {string} The absolute path to the created package directory.
 */
export function scaffoldSkinPackage(options) {
  const errors = validateOptions(options);
  if (errors.length > 0) {
    throw new Error(`Invalid scaffold options:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  const pkgDir = path.resolve(options.output);
  const colors = deriveColors(options.colors);

  // Create directory structure
  fs.mkdirSync(path.join(pkgDir, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, 'assets', 'images'), { recursive: true });
  fs.mkdirSync(path.join(pkgDir, 'scripts'), { recursive: true });

  // Write manifest.json
  const manifest = generateManifest(options);
  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  // Write CSS
  const css = generateCss(options);
  fs.writeFileSync(path.join(pkgDir, 'assets', 'css', `${options.agent}.css`), css, 'utf8');

  // Write scripts
  fs.writeFileSync(
    path.join(pkgDir, 'scripts', 'install.mjs'),
    generateInstallScript(options),
    'utf8',
  );
  fs.writeFileSync(
    path.join(pkgDir, 'scripts', 'verify.mjs'),
    generateVerifyScript(options),
    'utf8',
  );
  fs.writeFileSync(
    path.join(pkgDir, 'scripts', 'restore.mjs'),
    generateRestoreScript(options),
    'utf8',
  );

  // Write SKILL.md + README.md
  fs.writeFileSync(path.join(pkgDir, 'SKILL.md'), generateSkillMd(options), 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'README.md'), generateReadme(options), 'utf8');

  // Write placeholder images
  fs.writeFileSync(path.join(pkgDir, 'icon.png'), generateIconPng(colors.accent));
  fs.writeFileSync(
    path.join(pkgDir, 'preview.png'),
    generatePreviewPng(colors.background, colors.surface, colors.accent),
  );

  return pkgDir;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const dir = scaffoldSkinPackage(opts);
    console.log('Scaffolded theme package at:', dir);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
