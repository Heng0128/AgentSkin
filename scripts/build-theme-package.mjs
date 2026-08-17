// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package.mjs — Theme Studio export builder
 *
 * Receives a {@link ThemeStudioExportRequest}-shaped payload from the renderer
 * (via `studio:export`) and writes a directory-based `.agentskin-theme` package
 * under `theme-workbench/out/<id>.agentskin-theme/`:
 *
 *   <id>/
 *     manifest.json
 *     preview.png
 *     icon.png
 *     assets/css/<agentId>.css
 *
 * The CSS reuses the same contract as the hand-authored themes:
 *   1. a `:root` block declaring the `--agentskin-*` palette tokens,
 *   2. a host-scoped override block that redirects the agent's OWN design-token
 *      namespace (--vscode-*, --color-*, --wb-*, --cb-*, --dbx-*, --text-*, …)
 *      onto the crafted palette, so the recolor actually takes effect,
 *   3. an optional "craft" layer derived from the 8-dimension toolbox overrides
 *      (radius / spacing / shadow / blur / font / motion).
 *
 * No third-party deps: the preview/icon PNGs are emitted with a tiny zlib-based
 * encoder so the builder runs inside the packaged app without network access.
 *
 * @type {import('node:fs')}
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getAdapter } from '../src/engine/src/adapters/index.mjs';

// ---------------------------------------------------------------------------
// Default palette (used when the renderer sends nothing / partial)
// ---------------------------------------------------------------------------

const DEFAULT_TOKENS = {
  '--agentskin-accent': '#9d8bff',
  '--agentskin-secondary': '#f097c8',
  '--agentskin-bg': '#201a40',
  '--agentskin-surface': '#2b254a',
  '--agentskin-surface-elevated': '#363153',
  '--agentskin-text': '#e8e2ff',
  '--agentskin-muted': '#8e88a9',
  '--agentskin-border': '#9d8bff2e',
  '--agentskin-code-bg': '#15112a',
  '--agentskin-code-fg': '#c9cbe9',
  '--agentskin-input-bg': '#332e51',
  '--agentskin-button-bg': '#9d8bff',
  '--agentskin-focus-ring': '#9d8bff60',
  '--agentskin-selection': 'rgba(157, 139, 255, 0.32)',
};

// ---------------------------------------------------------------------------
// Agent host selectors + native token namespaces to remap
// ---------------------------------------------------------------------------

const HOST_SELECTOR = {
  traework: 'html.agentskin-host-traework body, html.agentskin-host-traework body *',
  qoderwork: 'html.agentskin-host-qoderwork *',
  workbuddy: 'html.agentskin-host-workbuddy body, html.agentskin-host-workbuddy body *',
  doubao: 'html.agentskin-host-doubao *',
  codex: ':root:root:root.agentskin-host-codex, :root:root:root.agentskin-host-codex *',
};

// Representative semantic tokens per agent namespace. These are redirected onto
// the crafted palette via valueForToken() so the recolor is visible.
const AGENT_REMAP = {
  traework: [
    '--vscode-editor-background',
    '--vscode-foreground',
    '--vscode-editor-foreground',
    '--vscode-sideBar-background',
    '--vscode-activityBar-background',
    '--vscode-statusBar-background',
    '--vscode-titleBar-activeBackground',
    '--vscode-titleBar-activeForeground',
    '--vscode-titleBar-inactiveBackground',
    '--vscode-tab-activeBackground',
    '--vscode-input-background',
    '--vscode-dropdown-background',
    '--vscode-list-hoverBackground',
    '--vscode-toolbar-hoverBackground',
    '--vscode-textLink-foreground',
    '--vscode-button-background',
    '--vscode-button-foreground',
    '--vscode-button-hoverBackground',
    '--vscode-focusBorder',
    '--vscode-panel-border',
    '--vscode-widget-border',
    '--vscode-scrollbarSlider-background',
    '--vscode-scrollbarSlider-hoverBackground',
    '--vscode-descriptionForeground',
    '--vscode-icube-bg',
    '--vscode-icube-fg',
  ],
  qoderwork: [
    '--color-bg-primary',
    '--color-bg-secondary',
    '--color-bg-tertiary',
    '--color-bg-overlay',
    '--color-text-primary',
    '--color-text-secondary',
    '--color-text-disabled',
    '--color-text-link',
    '--color-accent',
    '--color-accent-hover',
    '--color-brand',
    '--color-brand-hover',
    '--color-fill-input',
    '--color-fill-secondary',
    '--color-line-border',
    '--color-line-divider',
    '--color-code-bg',
    '--color-code-fg',
    '--color-focus-ring',
    '--color-selection',
  ],
  workbuddy: [
    '--wb-accent',
    '--wb-secondary',
    '--wb-surface',
    '--wb-text',
    '--cb-bg-primary',
    '--cb-bg-secondary',
    '--cb-bg-tertiary',
    '--cb-panel-bg-primary',
    '--cb-panel-bg-secondary',
    '--cb-text-primary',
    '--cb-text-secondary',
    '--cb-text-disabled',
    '--cb-text-link',
    '--cb-text-tertiary',
    '--cb-vscode-editor-background',
    '--cb-vscode-foreground',
    '--cb-vscode-titleBar-activeBackground',
    '--cb-vscode-titleBar-activeForeground',
    '--cb-vscode-input-background',
    '--cb-vscode-dropdown-background',
    '--cb-vscode-button-background',
    '--cb-vscode-button-foreground',
    '--cb-vscode-button-hoverBackground',
    '--cb-vscode-list-hoverBackground',
    '--cb-vscode-focusBorder',
    '--cb-vscode-scrollbarSlider-background',
    '--cb-stroke-secondary',
    '--cb-button-dark-background',
    '--cb-button-dark-foreground',
    '--cb-vscode-textLink-foreground',
  ],
  doubao: [
    '--dbx-bg-primary',
    '--dbx-bg-secondary',
    '--dbx-bg-tertiary',
    '--dbx-bg-overlay',
    '--dbx-text-primary',
    '--dbx-text-secondary',
    '--dbx-text-disabled',
    '--dbx-text-link',
    '--dbx-brand',
    '--dbx-brand-hover',
    '--dbx-fill-input',
    '--dbx-fill-secondary',
    '--dbx-line-border',
    '--dbx-line-divider',
    '--dbx-code-bg',
    '--dbx-code-fg',
    '--dbx-focus-ring',
  ],
  codex: [
    '--text-primary',
    '--text-secondary',
    '--text-disabled',
    '--text-link',
    '--bg-primary',
    '--bg-secondary',
    '--bg-tertiary',
    '--fill-input',
    '--line-border',
    '--brand',
    '--brand-hover',
    '--code-bg',
    '--code-fg',
    '--focus-ring',
    '--codex-bg-primary',
    '--codex-bg-secondary',
    '--codex-text-primary',
    '--codex-brand',
  ],
};

// Minimal apply-time verification landmarks (mirrors deepspace-star manifest).
const VERIFICATION = {
  traework: { name: 'solo-shell', any: ['.panel-container', '.solo-lite-layout'] },
  qoderwork: { name: 'agents-root', any: ['.agents-layout-root'] },
  workbuddy: { name: 'teams-root', any: ['.teams-container'] },
  doubao: { name: 'doubao-root', any: ['#root', 'body'] },
  codex: { name: 'codex-root', any: ['main.main-surface', "main[class*='MainContentSurface']"] },
};

const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,0.18)',
  md: '0 4px 14px rgba(0,0,0,0.22)',
  lg: '0 10px 30px rgba(0,0,0,0.28)',
  xl: '0 20px 50px rgba(0,0,0,0.34)',
};

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 优先级规则数组 — 先命中先返回。按语义特异性递减排序。
 *
 * 设计原则（修复 P1）：
 *   1. sideBar / titleBar 等半透明 surface 优先于 bg/background 泛化分支，
 *      避免 --vscode-sideBar-background 被错误映射到 --agentskin-bg（不透明），
 *      破坏 hand-authored 的 color-mix 透 hero 效果。
 *   2. description / muted 优先于 text/foreground 泛化分支，
 *      避免 --vscode-descriptionForeground 被误映射到 --agentskin-text。
 *   3. surface/panel 优先于 bg/background，因为侧栏背景本质是微透明 surface。
 */
const TOKEN_RULES = [
  // --- hover 类（最具体） ---
  {
    pattern: (t) => t.includes('hover'),
    result: (t, _v) => {
      if (
        t.includes('button') ||
        t.includes('accent') ||
        t.includes('brand') ||
        t.includes('primary')
      )
        return 'color-mix(in srgb, var(--agentskin-accent) 85%, #000)';
      if (t.includes('text') || t.includes('link'))
        return 'color-mix(in srgb, var(--agentskin-accent) 80%, #fff)';
      return null; // 非匹配 hover -> 继续
    },
  },
  // --- 侧边栏/标题栏：半透明 surface，必须在 bg/background 之前 ---
  {
    pattern: (t) =>
      t.includes('sidebar') ||
      t.includes('titlebar') ||
      t.includes('statusbar') ||
      t.includes('activitybar'),
    result: (_t, _v) => 'color-mix(in srgb, var(--agentskin-surface) 15%, transparent)',
  },
  // --- elevated / overlay ---
  {
    pattern: (t) => t.includes('elevated') || t.includes('overlay'),
    result: (_t, v) => v('--agentskin-surface-elevated'),
  },
  // --- surface / panel ---
  {
    pattern: (t) => t.includes('surface') || t.includes('panel'),
    result: (_t, v) => v('--agentskin-surface'),
  },
  // --- muted / disabled / description（必须在 text/foreground 之前） ---
  {
    pattern: (t) => t.includes('muted') || t.includes('disabled') || t.includes('description'),
    result: (_t, v) => v('--agentskin-muted'),
  },
  // --- secondary ---
  {
    pattern: (t) => t.includes('secondary'),
    result: (_t, v) => v('--agentskin-secondary'),
  },
  // --- border / line / stroke / divider / widget ---
  {
    pattern: (t) =>
      t.includes('border') ||
      t.includes('line') ||
      t.includes('stroke') ||
      t.includes('divider') ||
      t.includes('widget'),
    result: (_t, v) => v('--agentskin-border'),
  },
  // --- input / fill ---
  {
    pattern: (t) => t.includes('input') || t.includes('fill'),
    result: (_t, v) => v('--agentskin-input-bg'),
  },
  // --- code boundaries (-code- 或尾部 -code-bg/-code-fg) ---
  {
    pattern: (t) => t.includes('-code-') || /-code(?:-bg|-fg)$/.test(t),
    result: (t, v) => (/code-fg/.test(t) ? v('--agentskin-code-fg') : v('--agentskin-code-bg')),
  },
  // --- scrollbar / focus / selection / ring ---
  {
    pattern: (t) =>
      t.includes('scrollbar') ||
      t.includes('focus') ||
      t.includes('selection') ||
      t.includes('ring'),
    result: (_t, v) => v('--agentskin-focus-ring'),
  },
  // --- text / foreground / fg（泛化） ---
  {
    pattern: (t) => t.includes('text') || t.includes('foreground') || t.includes('fg'),
    result: (_t, v) => v('--agentskin-text'),
  },
  // --- accent / brand / link / primary / button ---
  {
    pattern: (t) =>
      t.includes('accent') ||
      t.includes('brand') ||
      t.includes('link') ||
      t.includes('primary') ||
      t.includes('button'),
    result: (_t, v) => v('--agentskin-accent'),
  },
  // --- bg / background（最终 fallback） ---
  {
    pattern: (t) => t.includes('bg') || t.includes('background'),
    result: (_t, v) => v('--agentskin-bg'),
  },
];

/** Map a native agent token name to a crafted palette value (CSS expression).
 *  @see TOKEN_RULES 优先级规则数组。 */
function valueForToken(token) {
  const t = token.toLowerCase();
  const v = (name) => `var(${name})`;
  for (const rule of TOKEN_RULES) {
    if (rule.pattern(t)) {
      const out = rule.result(t, v);
      if (out !== null) return out;
    }
  }
  return v('--agentskin-bg');
}

// ---------------------------------------------------------------------------
// Tiny PNG encoder (zlib only, no native deps)
// ---------------------------------------------------------------------------

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
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

// ---------------------------------------------------------------------------
// Palette assembly
// ---------------------------------------------------------------------------

export function deriveTokens(root) {
  // A-08 / Q18：拒绝"残缺提取"——调用方传入非空 root 却无任何 --agentskin-* token，
  // 静默回退 DEFAULT_TOKENS 会让产物被默认紫色污染而不报错。此处直接拒绝并说明原因。
  if (root && typeof root === 'object' && Object.keys(root).length > 0) {
    const themed = Object.keys(root).filter((k) => k.startsWith('--agentskin-'));
    if (themed.length === 0) {
      throw new Error(
        `[build-theme-package] deriveTokens: root 含 ${Object.keys(root).length} 个键但无任何 ` +
          '`--agentskin-*` 主题 token —— 疑似残缺提取，拒绝回退到 DEFAULT_TOKENS 掩蔽。',
      );
    }
  }
  const tokens = { ...DEFAULT_TOKENS };
  if (root && typeof root === 'object') {
    for (const [k, val] of Object.entries(root)) {
      if (typeof k === 'string' && k.startsWith('--agentskin-') && typeof val === 'string') {
        tokens[k] = val;
      }
    }
  }
  // --- P1 fix: selection / focus-ring 从 accent 派生，避免 DEFAULT 紫色泄漏 ---
  // 与 build-palette.mjs 行为一致：selection = color-mix(accent 32%), focus-ring = color-mix(accent 40%)。
  // 调用方传入 explicit 值时保留；DEFAULT_TOKENS 仅作回退基线。
  const rootSelection =
    root && typeof root === 'object' ? root['--agentskin-selection'] : undefined;
  const rootFocusRing =
    root && typeof root === 'object' ? root['--agentskin-focus-ring'] : undefined;
  if (rootSelection === undefined || rootSelection === DEFAULT_TOKENS['--agentskin-selection']) {
    tokens['--agentskin-selection'] =
      `color-mix(in srgb, ${tokens['--agentskin-accent']} 32%, transparent)`;
  }
  if (rootFocusRing === undefined || rootFocusRing === DEFAULT_TOKENS['--agentskin-focus-ring']) {
    tokens['--agentskin-focus-ring'] =
      `color-mix(in srgb, ${tokens['--agentskin-accent']} 40%, transparent)`;
  }
  // --- P2 fix: input-bg / button-bg post-override 派生，与 tokenBlock() 一致 ---
  // input-bg = color-mix(surface 82% + accent 18%) 45% + transparent（theme-utils.mjs L220）。
  // button-bg = accent（theme-utils.mjs L208）。
  // 避免 deriveTokens() 在 accent/surface 被 override 后仍回退到 DEFAULT 硬编码值。
  const rootInputBg = root && typeof root === 'object' ? root['--agentskin-input-bg'] : undefined;
  const rootButtonBg = root && typeof root === 'object' ? root['--agentskin-button-bg'] : undefined;
  if (rootInputBg === undefined || rootInputBg === DEFAULT_TOKENS['--agentskin-input-bg']) {
    tokens['--agentskin-input-bg'] =
      `color-mix(in srgb, color-mix(in srgb, ${tokens['--agentskin-surface']} 82%, ${tokens['--agentskin-accent']} 18%) 45%, transparent)`;
  }
  if (rootButtonBg === undefined || rootButtonBg === DEFAULT_TOKENS['--agentskin-button-bg']) {
    tokens['--agentskin-button-bg'] = tokens['--agentskin-accent'];
  }
  const mode = luminance(tokens['--agentskin-bg']) < 0.5 ? 'dark' : 'light';
  return { tokens, mode };
}

function manifestColors(tokens) {
  const accent = tokens['--agentskin-accent'];
  const buttonBg = tokens['--agentskin-button-bg'] || accent;
  // buttonForeground: 基于按钮背景亮度决定文字色（暗色背景 -> 白字，亮色背景 -> 近黑）。
  // 替代硬编码 '#ffffff'，与源主题 buttonForeground 语义一致。
  const buttonFg = luminance(buttonBg) < 0.5 ? '#ffffff' : '#1a1a2e';
  return {
    accent,
    secondary: tokens['--agentskin-secondary'],
    background: tokens['--agentskin-bg'],
    foreground: tokens['--agentskin-text'],
    muted: tokens['--agentskin-muted'],
    surface: tokens['--agentskin-surface'],
    surfaceElevated: tokens['--agentskin-surface-elevated'],
    border: tokens['--agentskin-border'],
    codeBackground: tokens['--agentskin-code-bg'],
    codeForeground: tokens['--agentskin-code-fg'],
    inputBackground: tokens['--agentskin-input-bg'],
    buttonBackground: tokens['--agentskin-button-bg'],
    buttonForeground: buttonFg,
    focusRing: tokens['--agentskin-focus-ring'],
    selection: tokens['--agentskin-selection'],
  };
}

// ---------------------------------------------------------------------------
// CSS assembly
// ---------------------------------------------------------------------------

function buildAgentCss(agentId, palette, signature) {
  const lines = [];
  const mode = palette.mode === 'light' ? 'light' : 'dark';
  lines.push(`/* AgentSkin Studio export — ${agentId} */`);
  lines.push(':root {');
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const [k, val] of Object.entries(palette.tokens)) lines.push(`  ${k}: ${val};`);
  lines.push('}');
  lines.push('');

  const host =
    HOST_SELECTOR[agentId] ||
    `html.agentskin-host-${agentId} body, html.agentskin-host-${agentId} body *`;
  const remap = AGENT_REMAP[agentId] || [];
  lines.push(`/* Redirect ${agentId} native design tokens onto the crafted palette */`);
  lines.push(`${host} {`);
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const tk of remap) lines.push(`  ${tk}: ${valueForToken(tk)} !important;`);
  lines.push('}');
  lines.push('');

  const craft = buildCraft(agentId, signature);
  if (craft) {
    lines.push(craft);
    lines.push('');
  }
  return lines.join('\n');
}

function buildCraft(agentId, signature) {
  if (!signature || typeof signature !== 'object') return '';
  const el = `html.agentskin-host-${agentId}`;
  const out = ['/* Craft overrides — Studio toolbox dimensions */'];
  if (signature.radius) {
    out.push(
      `${el} button, ${el} input, ${el} textarea, ${el} select, ${el} [role="textbox"], ${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"] { border-radius: ${signature.radius} !important; }`,
    );
    out.push(`:root { --as-radius: ${signature.radius}; }`);
  }
  if (signature.spacing != null) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="sidebar"], ${el} [class*="Panel"], ${el} [class*="Sidebar"] { padding: ${signature.spacing}px !important; }`,
    );
    out.push(`:root { --as-spacing: ${signature.spacing}px; }`);
  }
  if (signature.shadowLevel && signature.shadowLevel !== 'none' && SHADOWS[signature.shadowLevel]) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="card"], ${el} [class*="elevated"], ${el} [class*="surface"] { box-shadow: ${SHADOWS[signature.shadowLevel]} !important; }`,
    );
    out.push(`:root { --as-shadow-level: ${signature.shadowLevel}; }`);
  }
  if (signature.blurPx != null && signature.blurPx > 0) {
    out.push(
      `${el} [class*="sidebar"], ${el} [class*="overlay"], ${el} [class*="modal"], ${el} [class*="navbar"], ${el} [class*="topbar"], ${el} header { backdrop-filter: blur(${signature.blurPx}px) !important; }`,
    );
    out.push(`:root { --as-blur: ${signature.blurPx}px; }`);
  }
  if (signature.fontSize != null) {
    out.push(`${el} body { font-size: ${signature.fontSize}px !important; }`);
    out.push(`:root { --as-font-size: ${signature.fontSize}px; }`);
  }
  if (signature.fontFam) {
    out.push(`${el} body { font-family: ${signature.fontFam} !important; }`);
    out.push(`:root { --as-font-family: ${signature.fontFam}; }`);
  }
  if (signature.duration) {
    out.push(`${el} body, ${el} body * { transition-duration: ${signature.duration} !important; }`);
    out.push(`:root { --as-transition-duration: ${signature.duration}; }`);
  }
  if (signature.timing) {
    out.push(
      `${el} body, ${el} body * { transition-timing-function: ${signature.timing} !important; }`,
    );
    out.push(`:root { --as-transition-timing: ${signature.timing}; }`);
  }
  // color (re-themed by role)
  if (signature.accent) {
    out.push(
      `${el} [class*="accent"], ${el} [class*="Accent"], ${el} [class*="primary"], ${el} [class*="Primary"], ${el} [class*="active"], ${el} [class*="Active"], ${el} [class*="selected"], ${el} [class*="Selected"], ${el} a { color: ${signature.accent} !important; border-color: ${signature.accent} !important; }`,
    );
    out.push(
      `${el} [class*="accent"], ${el} [class*="Accent"], ${el} [class*="primary"], ${el} [class*="Primary"], ${el} [class*="selected"], ${el} [class*="Selected"] { background-color: ${signature.accent} !important; }`,
    );
    out.push(
      `:root { --agentskin-accent: ${signature.accent}; --as-accent: ${signature.accent}; }`,
    );
  }
  if (signature.background) {
    out.push(
      `${el} body, ${el} [class*="root"], ${el} [class*="Root"] { background-color: ${signature.background} !important; }`,
    );
    out.push(
      `:root { --agentskin-background: ${signature.background}; --as-bg: ${signature.background}; }`,
    );
  }
  if (signature.foreground) {
    out.push(`${el} body, ${el} body * { color: ${signature.foreground} !important; }`);
    out.push(
      `:root { --agentskin-foreground: ${signature.foreground}; --as-fg: ${signature.foreground}; }`,
    );
  }
  if (signature.surface) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"], ${el} [class*="Card"], ${el} [class*="surface"], ${el} [class*="Surface"] { background-color: ${signature.surface} !important; }`,
    );
    out.push(
      `:root { --agentskin-surface: ${signature.surface}; --as-surface: ${signature.surface}; }`,
    );
  }
  // gradient accent background (bakeable)
  if (signature.gradientAccent) {
    const g =
      signature.accent && signature.background
        ? `linear-gradient(135deg, ${signature.accent} 0%, ${signature.background} 72%)`
        : 'linear-gradient(135deg, var(--agentskin-accent) 0%, var(--agentskin-bg) 72%)';
    out.push(
      `${el} body, ${el} [class*="root"], ${el} [class*="Root"] { background-image: ${g} !important; }`,
    );
    out.push(`:root { --as-grad: ${g}; }`);
  }
  // structure
  if (signature.borderWidth != null) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"], ${el} [class*="Card"], ${el} [class*="surface"], ${el} [class*="Surface"], ${el} [class*="sidebar"], ${el} [class*="Sidebar"] { border-width: ${signature.borderWidth}px !important; }`,
    );
  }
  if (signature.lineHeight != null) {
    out.push(`${el} body, ${el} body * { line-height: ${signature.lineHeight} !important; }`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

function slugify(name) {
  return (
    (name || 'studio-theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'studio-theme'
  );
}

function buildManifest(request, agentId, palette) {
  const id =
    (request.meta?.id && slugify(request.meta.id)) ||
    slugify(request.meta?.name) ||
    `${agentId}-studio-${new Date().toISOString().slice(0, 10)}`;
  const name = request.meta?.name || 'Studio Theme';
  const author = request.meta?.author || 'AgentSkin Studio';
  const mode = palette.mode;
  const verify = VERIFICATION[agentId];
  return {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    format: 'agentskin-theme',
    id,
    name,
    displayName: name,
    version: '1.0.0',
    description: `由 AgentSkin 工作室导出（${agentId}）`,
    author: { name: author },
    mode,
    targets: {
      [agentId]: {
        css: `assets/css/${agentId}.css`,
        verification: verify ? { required: [{ name: verify.name, any: verify.any }] } : undefined,
      },
    },
    colors: manifestColors(palette.tokens),
    preview: 'preview.png',
    icon: 'icon.png',
    category: 'studio',
    tags: ['studio', 'custom', mode],
    unofficial: true,
    supportedAgents: [agentId],
    probe: {
      tokenNamespaces: [
        '--agentskin-',
        '--cb-',
        '--vscode-',
        '--color-',
        '--dbx-',
        '--wb-',
        '--text-',
      ],
      styleContract: 'THEME_SPEC.md#探针样式契约',
    },
  };
}

// ---------------------------------------------------------------------------
// Preview / icon raster (palette-driven)
// ---------------------------------------------------------------------------

function buildPreview(palette) {
  const bg = hexToRgb(palette.tokens['--agentskin-bg']) || [32, 26, 64];
  const surface = hexToRgb(palette.tokens['--agentskin-surface']) || [43, 37, 74];
  const accent = hexToRgb(palette.tokens['--agentskin-accent']) || [157, 139, 255];
  const W = 480;
  const H = 300;
  return makePng(W, H, (x, y) => {
    const t = y / H;
    const r = Math.round(bg[0] + (surface[0] - bg[0]) * t);
    const g = Math.round(bg[1] + (surface[1] - bg[1]) * t);
    const b = Math.round(bg[2] + (surface[2] - bg[2]) * t);
    // accent rounded bar near bottom
    const inBar = y > H - 70 && x > 40 && x < W - 40 && y - (H - 70) < 36;
    if (inBar) return accent;
    return [r, g, b];
  });
}

function buildIcon(palette) {
  const accent = hexToRgb(palette.tokens['--agentskin-accent']) || [157, 139, 255];
  const W = 128;
  const H = 128;
  const rad = 28;
  return makePng(W, H, (x, y) => {
    const dx = Math.min(x, W - 1 - x);
    const dy = Math.min(y, H - 1 - y);
    const corner = Math.min(dx, dy);
    if (corner < rad - 6) {
      const edge = rad - corner;
      if (edge > 6) return [0, 0, 0]; // transparent-ish (will be clipped by rounded corner)
    }
    return accent;
  });
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildThemePackage(request, outDir) {
  // A-10 / Q13：非法或缺失 agentId 直接拒绝，避免静默生成"空白主题包"。
  if (!request?.agentId || typeof request.agentId !== 'string') {
    throw new Error(
      '[build-theme-package] Missing request.agentId — must be one of: ' +
        ['codex', 'doubao', 'workbuddy', 'qoderwork', 'traework', 'zcode'].join(', '),
    );
  }
  getAdapter(request.agentId); // 抛错即拒绝非法 agentId
  const agentId = request.agentId;
  const palette = deriveTokens(request?.root);
  const manifest = buildManifest(request, agentId, palette);
  const css = buildAgentCss(agentId, palette, request?.signature);

  const pkgDir = path.join(outDir, `${manifest.id}.agentskin-theme`);
  fs.mkdirSync(path.join(pkgDir, 'assets', 'css'), { recursive: true });

  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(pkgDir, 'assets', 'css', `${agentId}.css`), css, 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'preview.png'), buildPreview(palette));
  fs.writeFileSync(path.join(pkgDir, 'icon.png'), buildIcon(palette));

  return pkgDir;
}

// Allow direct CLI invocation for local testing (not used by the app).
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || path.join(process.cwd(), 'theme-workbench', 'out');
  const dir = await buildThemePackage(
    {
      agentId: 'workbuddy',
      meta: { name: 'CLI Test', author: 'tester' },
      root: {},
      signature: { radius: '14px', shadowLevel: 'md' },
    },
    out,
  );
  console.log('wrote', dir);
}
