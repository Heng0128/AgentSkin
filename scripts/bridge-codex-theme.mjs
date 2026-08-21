// SPDX-License-Identifier: MPL-2.0
//
// # bridge-codex-theme.mjs — Codex → AgentSkin 主题桥接适配
//
// 功能:
//   1. 解析 Codex JSON 主题文件（--ct-* 调色板 + CSS）
//   2. 将 Codex palette 映射到 AgentSkin 14-token 契约
//   3. 转换 CSS: --ct-* → --agentskin-*，剥离 data-codexthemes-theme 选择器
//   4. 生成标准 AgentSkin 主题结构: manifest.json + assets/css/{agent}.css × 6
//
// 用法:
//   node scripts/bridge-codex-theme.mjs <codex-theme.json> [more.json ...]
//
// 示例:
//   node scripts/bridge-codex-theme.mjs \
//     ../.agnes/codex-themes-downloaded/github-noir.zip \
//     ../.agnes/codex-themes-downloaded/obsidian-poise.zip \
//     ../.agnes/codex-themes-downloaded/sweet-strawberry-code.zip

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, GENERATORS } from './theme-generators.mjs';
import { HOSTS } from './theme-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.resolve(__dirname, '..', 'themes');
const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

// =============================================================================
// 变量映射表 — Codex --ct-* → AgentSkin --agentskin-*
// =============================================================================

/** Codex --ct-* 变量 → AgentSkin --agentskin-* 映射 */
const CT_VAR_MAP = {
  '--ct-canvas': '--agentskin-bg',
  '--ct-canvas-deep': '--agentskin-bg',
  '--ct-surface': '--agentskin-surface',
  '--ct-surface-raised': '--agentskin-surface',
  '--ct-raised': '--agentskin-surface-elevated',
  '--ct-raised-strong': '--agentskin-surface-elevated',
  '--ct-code': '--agentskin-code-bg',
  '--ct-text': '--agentskin-text',
  '--ct-muted': '--agentskin-muted',
  '--ct-faint': '--agentskin-muted',
  '--ct-accent': '--agentskin-accent',
  '--ct-accent-bright': '--agentskin-accent',
  '--ct-accent-deep': '--agentskin-accent',
  '--ct-border': '--agentskin-border',
  '--ct-border-strong': '--agentskin-border',
  '--ct-border-subtle': '--agentskin-border',
  '--ct-focus': '--agentskin-focus-ring',
  '--ct-selection': '--agentskin-selection',
  '--ct-success': '--agentskin-secondary',
  '--ct-warning': '--agentskin-accent',
  '--ct-danger': '--agentskin-accent',
};

/** Codex palette key → AgentSkin colors prop key 映射 */
const PALETTE_TO_COLOR_KEY = {
  canvas: 'background',
  surface: 'surface',
  raised: 'surfaceElevated',
  text: 'foreground',
  muted: 'muted',
  accent: 'accent',
  focus: 'focusRing',
  success: 'secondary',
  border: 'border',
};

// =============================================================================
// 颜色工具
// =============================================================================

function parseHex(input) {
  const raw = String(input || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^#([0-9a-f]{3})$/i.exec(raw);
  if (m) {
    const full = m[1]
      .split('')
      .map((c) => c + c)
      .join('');
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return null;
}

function luminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 根据背景亮度决定前景文本色（用于 buttonForeground） */
function autoFg(bgHex, isLight) {
  const lum = luminance(bgHex);
  // 亮色背景或亮模式: 深色文本; 暗色背景/暗模式: 浅色文本
  if (isLight) return lum > 0.6 ? '#1a1416' : '#5a3d44';
  return lum > 0.3 ? '#0d0d0f' : '#ffffff';
}

// =============================================================================
// Palette → AgentSkin 14 tokens 映射
// =============================================================================

/** Codex palette 模式：根据调色板色温判定 'dark' / 'light' */
function detectMode(palette, declaredMode) {
  if (declaredMode === 'dark' || declaredMode === 'light') return declaredMode;
  // fallback: 根据 canvas 亮度判定
  const lum = palette.canvas && palette.canvas.startsWith('#') ? luminance(palette.canvas) : 0.5;
  return lum < 0.3 ? 'dark' : 'light';
}

function mapPaletteToColors(palette, mode) {
  const isLight = mode === 'light';
  const c = palette;

  // 直接可达的 14 tokens 映射 (Codex 使用 camelCase palette keys)
  const accent = c.accent || c.accent_bright || c.accentBright || '#3b82f6';
  const secondary = c.accent_bright || c.accentBright || c.success || c.warning || accent;
  const background = c.canvas || '#1e1e1e';
  const foreground = c.text || '#e5e5e5';
  const muted = c.muted || c.faint || '#888888';
  const surface = c.surface || background;
  const surfaceElevated = c.raised || c.surface_raised || c.surfaceRaised || surface;
  const border =
    c.border ||
    c.border_subtle ||
    c.borderSubtle ||
    c.border_strong ||
    c.borderStrong ||
    'rgba(128,128,128,0.18)';
  const codeBg = c.code || c.terminal_background || c.terminalBackground || background;
  const codeFg = c.terminal_foreground || c.terminalForeground || foreground;
  const inputBg = c.input || surface;
  const buttonBg = accent;
  const buttonForeground = autoFg(accent, isLight);
  const focusRing = c.focus || c.accent_bright || c.accentBright || accent;
  // selection 无法从 Codex palette 直接映射（--ct-selection 依赖 accent alpha），使用 accent 替代

  return {
    accent,
    secondary,
    background,
    foreground,
    muted,
    surface,
    surfaceElevated,
    border,
    codeBackground: codeBg,
    codeForeground: codeFg,
    inputBackground: inputBg,
    buttonBackground: buttonBg,
    buttonForeground,
    focusRing,
    // selection 由 tokenBlock 用 color-mix(accent 32%) 派生，这里记录 accent
    _accentForSelection: accent,
    _mode: mode,
    _isLight: isLight,
  };
}

// =============================================================================
// CSS 转换 — --ct-* → --agentskin-*
// =============================================================================

function transformCss(rawCss, hostId) {
  let css = rawCss;

  // 1) 剥离 data-codexthemes-theme 选择器 → :root.agentskin-host-<agent>
  const themeSelectorRe = /:root\[data-codexthemes-theme\s*=\s*"[^"]*"\]/g;
  css = css.replace(themeSelectorRe, ':root.agentskin-host-codex');

  // 2) 选择器命名空间: .agentskin-host-codex 已经在 :root 上，不需要额外命名空间
  //    Codex 裸引用 (html, body, main 等) 保持原样（CDP 注入上下文已隔离）

  // 3) --ct-* 变量名 → --agentskin-* 替换（仅变量引用: var(--ct-xxx) 定义与引用）
  //    先替换 --ct-xxx: （定义），再替换 var(--ct-xxx)（引用）
  for (const [ctVar, skinVar] of Object.entries(CT_VAR_MAP)) {
    // CSS 自定义属性定义: --ct-xxx: <value>;
    css = css.replaceAll(`${ctVar}:`, `${skinVar}-codex-bridge:`);
  }
  // 重命名中间 token 到最终 token: --agentskin-xxx-codex-bridge → --agentskin-xxx
  css = css.replaceAll('-codex-bridge:', ':');

  // 4) var(--ct-xxx) 引用 → var(--agentskin-xxx)
  for (const [ctVar, skinVar] of Object.entries(CT_VAR_MAP)) {
    const ctRef = ctVar.replace('--', '');
    const skinRef = skinVar.replace('--', '');
    css = css.replaceAll(`var(${ctRef}`, `var(${skinRef}`);
  }

  // 5) --ct-accent-soft/softer/glow 等 alpha 派生变量 → color-mix 表达式
  //    这些在 AgentSkin 中由 tokenBlock 派生，直接用 color-mix 展开
  css = css.replaceAll(
    /var\(--ct-accent-soft\)/g,
    'color-mix(in srgb, var(--agentskin-accent) 13%, transparent)',
  );
  css = css.replaceAll(
    /var\(--ct-accent-softer\)/g,
    'color-mix(in srgb, var(--agentskin-accent) 8%, transparent)',
  );
  css = css.replaceAll(
    /var\(--ct-accent-glow\)/g,
    'color-mix(in srgb, var(--agentskin-accent) 30%, transparent)',
  );
  css = css.replaceAll(/var\(--ct-accent-bright\)/g, 'var(--agentskin-accent)');
  css = css.replaceAll(/var\(--ct-accent-deep\)/g, 'var(--agentskin-accent)');
  css = css.replaceAll(/var\(--ct-raised-strong\)/g, 'var(--agentskin-surface-elevated)');

  // 6) 移除 Codex 特有 typography 变量（AgentSkin 不消费它们）
  //    --ct-font-display/body/mono — 不映射，直接删除声明
  css = css.replace(/\s*--ct-font-[a-z]+:\s*[^;]+;/g, '');

  // 7) 移除 --ct-shadow（AgentSkin 不消费）
  css = css.replace(/\s*--ct-shadow:\s*[^;]+;/g, '');

  // 8) 确保 CSS 中 color-scheme 与 mode 匹配（:root block 内）
  //    已在步骤 1 替换选择器时保留了原有 color-scheme，由调用方确保正确

  return css;
}

// =============================================================================
// 构建原生产物 (assets/css)
// =============================================================================

function generateAgentCss(ctx, agentId) {
  const gen = GENERATORS[agentId];
  if (!gen) return null;
  return gen(ctx);
}

function generateManifest(id, displayName, version, mode, colors) {
  return {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    id,
    name: id,
    displayName,
    version: version || '1.0.0',
    description: `Bridged from Codex theme "${displayName}". Auto-generated by bridge-codex-theme.mjs.`,
    author: { name: 'Codex Bridge' },
    mode,
    category: 'bridged',
    tags: [mode, 'codex-bridged'],
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
    targets: Object.fromEntries(AGENTS.map((a) => [a, { css: `assets/css/${a}.css` }])),
    supportedAgents: AGENTS,
    license: 'MPL-2.0',
    minAppVersion: '1.0.0',
  };
}

// =============================================================================
// 主流程
// =============================================================================

function sanitizeId(id) {
  return id
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

async function bridgeTheme(inputPath, baseOutDir) {
  const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);

  if (parsed.format !== 'codex-theme') {
    console.warn(`  [skip] ${inputPath}: not a codex-theme (format=${parsed.format})`);
    return { ok: false, reason: 'not-codex-theme' };
  }

  const manifest = parsed.manifest;
  const palette = manifest.palette;
  const rawCss = parsed.css;
  const displayName = manifest.displayName || manifest.id;
  const version = manifest.version || '1.0.0';
  const declaredMode = manifest.mode;
  const mode = detectMode(palette, declaredMode);
  const id = sanitizeId(manifest.id);

  console.log(`\n=== Bridging: ${id} (${displayName}) [${mode}] ===`);
  console.log(`  Palette keys: ${Object.keys(palette).join(', ')}`);
  console.log(`  CSS length: ${rawCss.length} chars`);
  console.log(`  Has art: ${!!parsed.art}, Has preview: ${!!parsed.preview}`);

  // 1) Map palette → colors
  const colors = mapPaletteToColors(palette, mode);
  console.log(
    `  Mapped accent=${colors.accent}, bg=${colors.background}, text=${colors.foreground}`,
  );

  // 2) 构建 buildContext 兼容对象（用于 AgentSkin CSS 生成器）
  //    buildContext 需要对象 { id, manifest, scheme? }
  //    manifest 需要: displayName, colors, mode
  const fakeManifest = {
    displayName,
    mode,
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
  };
  const ctx = buildContext(id, fakeManifest);

  // 3) 输出目录
  const themeDir = path.join(baseOutDir, `new-${id}`);
  const cssDir = path.join(themeDir, 'assets', 'css');
  fs.mkdirSync(cssDir, { recursive: true });

  // 4) 生成 manifest.json
  const outManifest = generateManifest(id, displayName, version, mode, colors);
  fs.writeFileSync(
    path.join(themeDir, 'manifest.json'),
    JSON.stringify(outManifest, null, 2) + '\n',
    'utf8',
  );
  console.log(`  ✓ manifest.json`);

  // 5) 生成各 agent CSS（使用 AgentSkin 生成器）
  for (const agent of AGENTS) {
    const css = generateAgentCss(ctx, agent);
    if (css) {
      fs.writeFileSync(path.join(cssDir, `${agent}.css`), css, 'utf8');
    }
  }
  console.log(`  ✓ assets/css/{${AGENTS.join(',')}}.css`);

  // 6) 对 codex.css 额外追加转换后的 Codex 原主题 CSS（保留 --color-token-* 桥接与编码细节）
  const codexTransformed = transformCss(rawCss, 'codex');
  // 找到 codex.css 并追加（替换生成器产的 token block 之后）
  const codexPath = path.join(cssDir, 'codex.css');
  const baseCodex = fs.readFileSync(codexPath, 'utf8');
  // 只提取 Codex CSS 中的 --color-token-* 桥接部分（跳过 --ct-* 已被 token block 覆盖的 :root block）
  const bridgeSection = extractBridgeSection(rawCss);
  if (bridgeSection) {
    fs.writeFileSync(
      codexPath,
      baseCodex.trimEnd() +
        `\n\n/* ===== Bridge: Codex-native --color-token-* overrides (from source theme) ===== */\n` +
        bridgeSection +
        '\n',
      'utf8',
    );
    console.log(`  ✓ codex.css appended Codex-native bridge`);
  }

  // 7) 放置 icon / preview（Codex 不内嵌这些，仅写占位说明）
  fs.writeFileSync(
    path.join(themeDir, 'BRIDGE_NOTES.md'),
    `# ${displayName} — Bridged from Codex\n\n` +
      `- source: ${path.basename(inputPath)}\n` +
      `- mode: ${mode}\n` +
      `- palette keys: ${Object.keys(palette).join(', ')}\n` +
      `- art: ${parsed.art ? 'present (base64, not extracted)' : 'none'}\n` +
      `- preview: ${parsed.preview ? 'present (base64, not extracted)' : 'none'}\n\n` +
      `## TODO\n` +
      `- [ ] Add icon.png / preview.png\n` +
      `- [ ] Verify visual fidelity manually\n` +
      `- [ ] Run \`npm run check:themes\`\n`,
    'utf8',
  );

  // 8) palette.css (build-palette 风格 — 用于视觉一致性)
  const paletteCss = [
    `/* palette.css — ${id} (${displayName}) */`,
    `/* Auto-generated from Codex palette by bridge-codex-theme.mjs — do not edit. */`,
    `:root {`,
    `  --agentskin-bg: ${colors.background};`,
    `  --agentskin-surface: ${colors.surface};`,
    `  --agentskin-surface-elevated: ${colors.surfaceElevated};`,
    `  --agentskin-text: ${colors.foreground};`,
    `  --agentskin-muted: ${colors.muted};`,
    `  --agentskin-accent: ${colors.accent};`,
    `  --agentskin-secondary: ${colors.secondary};`,
    `  --agentskin-border: ${colors.border};`,
    `  --agentskin-code-bg: ${colors.codeBackground};`,
    `  --agentskin-code-fg: ${colors.codeForeground};`,
    `  --agentskin-focus-ring: ${colors.focusRing};`,
    `  --agentskin-selection: color-mix(in srgb, ${colors.accent} 32%, transparent);`,
    ``,
    `  /* Derived raw RGB values */`,
    `  --agentskin-accent-raw: ${toRaw(colors.accent)};`,
    `  --agentskin-secondary-raw: ${toRaw(colors.secondary)};`,
    `  --agentskin-text-raw: ${toRaw(colors.foreground)};`,
    `  --agentskin-muted-raw: ${toRaw(colors.muted)};`,
    `  --agentskin-surface-raw: ${toRaw(colors.surface)};`,
    `  --agentskin-surface-elevated-raw: ${toRaw(colors.surfaceElevated)};`,
    `  --agentskin-bg-raw: ${toRaw(colors.background)};`,
    `  --agentskin-border-raw: ${toRaw(colors.border)};`,
    `}`,
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(themeDir, 'palette.css'), paletteCss, 'utf8');
  console.log(`  ✓ palette.css`);

  return { ok: true, id, mode, dir: themeDir };
}

function toRaw(color) {
  // 支持 hex / rgba(r,g,b,a)
  if (typeof color !== 'string') return '128, 128, 128';
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) {
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const m2 = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (m2) return `${m2[1]}, ${m2[2]}, ${m2[3]}`;
  return '128, 128, 128';
}

/** 提取 Codex CSS 中的 --color-token-* 桥接块（从 ":root {" 开始到第一个 "}" 之前的整个块之后的 rules），用于追加到 agentskin codex.css */
function extractBridgeSection(rawCss) {
  // Codex CSS 中包含一个 block 将 --ct-* bridge 到 --color-token-* / --color-background-* / --color-text-*
  // 我们需要的是: ":root {" 之后的整个变量 block（但只保留 --color-token-* / --color-background-* / --color-text-* 声明）
  const rootStart = rawCss.indexOf(':root[data-codexthemes-theme');
  if (rootStart === -1) return null;

  // 找到对应的 }
  let depth = 0;
  let blockEnd = -1;
  for (let i = rootStart; i < rawCss.length; i++) {
    if (rawCss[i] === '{') depth++;
    if (rawCss[i] === '}') {
      depth--;
      if (depth === 0) {
        blockEnd = i + 1;
        break;
      }
    }
  }
  if (blockEnd === -1) return null;

  const block = rawCss.substring(rootStart, blockEnd);

  // 提取所有自定义属性声明（已知 bridge / token / color-* namespace）
  const lines = block.split(/[\r\n]+/);
  const bridgeLines = lines.filter((l) => {
    const t = l.trim();
    if (!t.startsWith('--')) return false;
    // 跳过 --ct-* 变量（由 agentskin token block 覆盖）
    if (t.startsWith('--ct-')) return false;
    // 跳过 font 和 shadow
    if (t.startsWith('--ct-font')) return false;
    return true;
  });

  if (bridgeLines.length === 0) return null;

  // 构建独立 block: :root.agentskin-host-codex { bridged tokens }
  // 替换选择器
  let result = `:root.agentskin-host-codex {\n`;
  result += bridgeLines.map((l) => `  ${l.trim()}`).join('\n');
  result += '\n}\n';

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/bridge-codex-theme.mjs <codex-theme.json> [...]');
    console.error(
      'Example: node scripts/bridge-codex-theme.mjs ../.agnes/codex-themes-downloaded/github-noir.zip',
    );
    process.exit(1);
  }

  const results = [];
  for (const inputRel of args) {
    const input = path.isAbsolute(inputRel) ? inputRel : path.resolve(process.cwd(), inputRel);
    if (!fs.existsSync(input)) {
      console.error(`  [skip] not found: ${input}`);
      results.push({ input, ok: false, reason: 'not-found' });
      continue;
    }
    try {
      const r = await bridgeTheme(input, THEMES_DIR);
      results.push({ input, ...r });
    } catch (e) {
      console.error(`  [ERROR] ${input}: ${e.stack || e.message}`);
      results.push({ input, ok: false, reason: e.message });
    }
  }

  console.log('\n=== Bridge Summary ===');
  for (const r of results) {
    const status = r.ok ? `OK   (${r.id}, ${r.mode})` : `FAIL (${r.reason ?? 'unknown'})`;
    console.log(`  ${status}  ← ${path.basename(r.input)}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main();
