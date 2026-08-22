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
import sharp from 'sharp';
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
  '--ct-border-light': '--agentskin-border',
  '--ct-accent-hover': '--agentskin-accent',
  '--ct-input': '--agentskin-surface-elevated',
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

/** WCAG contrast ratio between two hex colors (≥1). */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Ensure accent/bg contrast meets WCAG UI-component floor (3:1).
 *
 * Codex source themes sometimes ship a pale accent on a near-white canvas
 * (e.g. arina-hashimoto #d4849c on #fff5f7 = 2.59:1) — that fails the
 * theme-token-consistency WCAG gate. Walk the accent toward black (keep the
 * hue, drop lightness) until 3:1, in small steps.
 */
function ensureAccentContrast(accentHex, bgHex) {
  const MIN = 3.0;
  if (!/^#[0-9a-f]{6}$/i.test(accentHex) || !/^#[0-9a-f]{6}$/i.test(bgHex)) return accentHex;
  let best = accentHex;
  let c = contrast(accentHex, bgHex);
  if (c >= MIN) return accentHex;
  const rgb = parseHex(accentHex);
  if (!rgb) return accentHex;
  const [r0, g0, b0] = [rgb.r, rgb.g, rgb.b];
  // Darken by scaling toward black; try up to ~70 % of the way (stays on-hue).
  for (let f = 0.95; f >= 0.3; f -= 0.05) {
    const cand = `#${[r0 * f, g0 * f, b0 * f].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const cc = contrast(cand, bgHex);
    if (cc >= MIN) {
      best = cand;
      c = cc;
      break;
    }
  }
  if (best !== accentHex) {
    console.warn(
      `  [wcag] accent ${accentHex} vs bg ${bgHex} = ${contrast(accentHex, bgHex).toFixed(2)}:1 < 3 — darkened to ${best} (${c.toFixed(2)}:1)`,
    );
  }
  return best;
}

/**
 * Ensure surface is visually lighter than background (luminance ratio > 1.03).
 *
 * The theme-token-consistency "luminance hierarchy" test requires
 * surfaceLum / bgLum > 1.02 (surface above the page backdrop). Some Codex
 * light themes ship a surface DARKER than the canvas (e.g. arina-hashimoto
 * surface=rgba(253,232,238,.92) on #fff5f7, ratio 0.909). Walk the surface
 * toward white (scaled up) until the ratio clears 1.03.
 */
function ensureSurfaceHierarchy(surfaceColor, bgHex, raisedCandidate) {
  if (!/^#[0-9a-f]{6}$/i.test(bgHex)) return surfaceColor;
  // Surface may be rgba() with alpha — blend against white first.
  let sHex = surfaceColor;
  const mRgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(
    surfaceColor,
  );
  if (mRgba) {
    const a = mRgba[4] === undefined ? 1 : Math.min(1, parseFloat(mRgba[4]));
    const [r, g, b] = [mRgba[1], mRgba[2], mRgba[3]].map((v) => Math.round(+v * a + 255 * (1 - a)));
    sHex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(sHex)) return surfaceColor;

  const ratio = luminance(sHex) / luminance(bgHex);
  if (ratio > 1.03) return surfaceColor; // already fine

  // Strategy 1: if the raised/elevated layer is lighter than bg, swap it in —
  // it is semantically the layer above surface and satisfies the hierarchy.
  if (raisedCandidate) {
    const rHex = raisedCandidate;
    const mR2 = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(rHex);
    let rClean = rHex;
    if (mR2) {
      const a = mR2[4] === undefined ? 1 : Math.min(1, parseFloat(mR2[4]));
      const [r, g, b] = [mR2[1], mR2[2], mR2[3]].map((v) => Math.round(+v * a + 255 * (1 - a)));
      rClean = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(rClean) && luminance(rClean) / luminance(bgHex) > 1.03) {
      console.warn(
        `  [surface] surface ${sHex} vs bg ${bgHex} ratio ${ratio.toFixed(3)} < 1.03 — used raised ${rClean} (${(luminance(rClean) / luminance(bgHex)).toFixed(3)})`,
      );
      return rClean;
    }
  }

  // Strategy 2: lighten the surface toward white.
  const rgb = parseHex(sHex);
  if (!rgb) return surfaceColor;
  for (let f = 0.97; f <= 1.4; f += 0.02) {
    const cand = `#${[255 - (255 - rgb.r) * f, 255 - (255 - rgb.g) * f, 255 - (255 - rgb.b) * f]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    const nr = luminance(cand) / luminance(bgHex);
    if (nr > 1.03) {
      console.warn(
        `  [surface] surface ${sHex} vs bg ${bgHex} ratio ${ratio.toFixed(3)} < 1.03 — lightened to ${cand} (${nr.toFixed(3)})`,
      );
      return cand;
    }
  }
  return surfaceColor;
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

/**
 * 当 Codex 源数据的 secondary 候选值全部与 accent 相同时，
 * 派生一个色相偏移的对比绿（黄绿色阶），避免 secondary ≡ accent。
 */
function deriveDistinctSecondary(accentHex) {
  const rgb = parseHex(accentHex);
  if (!rgb) return accentHex;
  // 例: #3fb950 (63,185,80) → #8fa84a (143,168,74)：R+80 G-17 B-6
  // 保持明度接近但色相偏向黄绿，视觉上与 accent 可区分。
  const r = Math.min(255, rgb.r + 80);
  const g = Math.max(0, rgb.g - 17);
  const b = Math.max(0, rgb.b - 6);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function mapPaletteToColors(palette, mode) {
  const isLight = mode === 'light';
  const c = palette;

  // 直接可达的 14 tokens 映射 (Codex 使用 camelCase palette keys)
  let accent = c.accent || c.accent_bright || c.accentBright || '#3b82f6';
  let secondary = c.accent_bright || c.accentBright || c.success || c.warning || accent;
  const background = c.canvas || '#1e1e1e';
  // P2 fix (2026-08-23): 校正 accent/bg 对比度（WCAG UI 组件下限 3:1），
  // 避免移植后主题在 theme-token-consistency 的 WCAG gate 失败。
  accent = ensureAccentContrast(accent, background);
  // P1 fix: 当 secondary 候选值与 accent 完全相同时，派生一个对比色，
  // 避免 14-token 契约中 secondary ≡ accent 丧失语义区分度。
  if (secondary === accent) {
    secondary = deriveDistinctSecondary(accent);
  }
  const foreground = c.text || '#e5e5e5';
  const muted = c.muted || c.faint || '#888888';
  const raisedCandidate = c.raised || c.surface_raised || c.surfaceRaised || c.surface;
  // P3 fix (2026-08-23): 保证 surface 亮度 > bg 亮度（luminance hierarchy
  // 契约 surfaceLum/bgLum > 1.02）。Codex 浅色主题常见 surface 比 canvas 暗
  // （如 arina-hashimoto ratio 0.909），优先用 raised 层，其次向白调亮。
  const surface = ensureSurfaceHierarchy(c.surface || background, background, raisedCandidate);
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

  // 3) 保留源主题的 --ct-* 命名空间（不再重命名为 --agentskin-*）。
  //    FIX 2026-08-23: 之前把 --ct-* 定义重命名为 --agentskin-*，导致：
  //      (a) 与我们 palette token block 的 --agentskin-* 值冲突（C3 staleness 失败）；
  //      (b) 源 CSS 的 --color-* 映射仍引用 var(--ct-*)，重命名定义后引用反而断裂。
  //    现在：--ct-* 定义原样保留 + var(--ct-*) 引用原样保留 —— 源 CSS 是一个自洽的
  //    完整体系，100% 忠实还原。--agentskin-* 由我们的 palette/token block 独立控制。
  // 4) （无全局 --ct-* → --agentskin-* 重命名）

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

function generateManifest(id, displayName, version, mode, colors, hasHero = true) {
  const manifest = {
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
  // hero is optional: only reference hero.png when the source shipped art.
  if (hasHero) manifest.hero = 'hero.png';
  return manifest;
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

/**
 * Detect Codex export format variant:
 *   A) "codex-theme"  — { manifest, css, art?, preview? }  (full CSS embedded)
 *   B) "codex-meta"   — { manifest, readme, art{base64} }  (no CSS, metadata-only)
 * Variant B uses manifest.css as a filename reference, not inline CSS.
 */
function detectAndParse(raw, inputPath) {
  // Try standard JSON parse first
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (jsonErr) {
    // Attempt graceful repair: if the file has a manifest object followed by
    // other fields (readme, art), try slicing at the manifest boundary.
    const manifestStart = raw.indexOf('"manifest": {');
    if (manifestStart === -1) throw jsonErr;
    // Find the matching close brace for the manifest object
    let depth = 0;
    let manifestEnd = -1;
    for (let i = manifestStart; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          manifestEnd = i + 1;
          break;
        }
      }
    }
    if (manifestEnd === -1) throw jsonErr;
    // Build a synthetic parsed object with only the manifest
    const manifestStr = raw.substring(manifestStart + '"manifest": '.length, manifestEnd);
    const manifest = JSON.parse(manifestStr);
    console.warn(
      `  [repair] Recovered manifest from ${path.basename(inputPath)} (truncated after manifest)`,
    );
    return {
      format: 'codex-meta-repaired',
      manifest,
      css: null,
      artBase64: null,
      previewBase64: null,
      _raw: null,
    };
  }

  if (parsed.format === 'codex-theme') {
    // Standard format: full CSS string in parsed.css
    // art/preview may be a base64 string OR an object { base64, ... }.
    const artStr = typeof parsed.art === 'string' ? parsed.art : parsed.art?.base64 || null;
    const prevStr =
      typeof parsed.preview === 'string' ? parsed.preview : parsed.preview?.base64 || null;
    return {
      format: 'codex-theme',
      manifest: parsed.manifest,
      css: parsed.css,
      artBase64: artStr,
      previewBase64: prevStr,
      _raw: parsed,
    };
  }

  // No manifest wrapper: check if it's a flat export (manifest fields at top level)
  if (parsed.manifest && parsed.manifest.palette) {
    return {
      format: 'codex-meta',
      manifest: parsed.manifest,
      css: typeof parsed.css === 'string' && parsed.css.includes('{') ? parsed.css : null,
      artBase64: parsed.art?.base64 || null,
      previewBase64: parsed.preview?.base64 || null,
      _raw: parsed,
    };
  }

  throw new Error(`Unrecognized Codex export format: keys=${Object.keys(parsed).join(',')}`);
}

async function bridgeTheme(inputPath, baseOutDir) {
  const raw = fs.readFileSync(inputPath, 'utf8').replace(/^\uFEFF/, '');
  const detected = detectAndParse(raw, inputPath);

  const manifest = detected.manifest;
  const palette = manifest.palette;
  const rawCss = detected.css; // may be null for metadata-only exports
  const displayName = manifest.displayName || manifest.id;
  const version = manifest.version || '1.0.0';
  const declaredMode = manifest.mode;
  const mode = detectMode(palette, declaredMode);
  const id = sanitizeId(manifest.id);

  console.log(`\n=== Bridging: ${id} (${displayName}) [${mode}] (${detected.format}) ===`);
  console.log(`  Palette keys: ${Object.keys(palette).join(', ')}`);
  console.log(
    `  CSS length: ${rawCss ? rawCss.length : 0} chars ${rawCss ? '' : '(no source CSS — generator-only)'}`,
  );
  console.log(`  Has art: ${!!detected.artBase64}, Has preview: ${!!detected.previewBase64}`);

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

  // 3) 输出目录 — use sanitized id as the canonical directory name
  const themeDir = path.join(baseOutDir, id);
  const cssDir = path.join(themeDir, 'assets', 'css');
  fs.mkdirSync(cssDir, { recursive: true });

  // 4) 生成 manifest.json
  const outManifest = generateManifest(
    id,
    displayName,
    version,
    mode,
    colors,
    !!detected.artBase64,
  );
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

  // 6) codex.css — 完整保留源主题 CSS（最高还原度）
  //    FIX 2026-08-23: 之前用 extractBridgeSection() 只提取 :root 变量块并丢弃
  //    --ct-* 定义，导致源主题 59 个组件级规则（aside/composer/menu/page 等）全部
  //    丢失，CT_VAR_MAP 未覆盖的 --ct-* 引用悬空 → 控件颜色错乱（"只有个别主题正确"）。
  //    现改用 transformCss()：保留全部源 CSS（变量定义 + 组件规则 + 动画），只做
  //    选择器剥离（data-codexthemes-theme → agentskin-host-codex）+ 变量名映射，
  //    实现 100% 忠实还原作者的完整设计。
  if (rawCss) {
    const codexPath = path.join(cssDir, 'codex.css');
    const baseCodex = fs.readFileSync(codexPath, 'utf8');
    const fullCss = transformCss(rawCss, 'codex');
    fs.writeFileSync(
      codexPath,
      baseCodex.trimEnd() +
        `\n\n/* ===== Bridge: FULL source Codex theme CSS (faithful reproduction) ===== */\n` +
        fullCss +
        '\n',
      'utf8',
    );
    console.log(`  ✓ codex.css appended FULL source CSS (${fullCss.length} chars, faithful)`);
  } else {
    console.log(`  - codex.css: no source CSS to bridge (metadata-only export)`);
  }

  // 7) 放置 hero / preview / icon（manifest 契约要求 icon.png + preview.png）
  // 三资源完全独立（2026-08-23 修正）：
  //   - hero.png    ← Codex art（背景艺术图，注入 --agentskin-art，纯背景无 DOM）
  //   - preview.png ← Codex preview（带 UI 的真实截图，仅作预览）
  //   - icon.png    ← Codex art 缩略（256px，与 hero 同源于 art 背景图家族；
  //                  绝不从 preview 派生 —— 预览截图与背景/图标是两个世界）
  // art 是干净背景，preview 是带 DOM 的截图 —— 两者不可互换、互不派生。
  // 7a) art → hero.png（背景图）+ icon.png（独立缩略图）
  if (detected.artBase64) {
    const artBuf = Buffer.from(detected.artBase64, 'base64');
    const heroPath = path.join(themeDir, 'hero.png');
    try {
      fs.writeFileSync(heroPath, artBuf);
      console.log(
        `  ✓ hero.png extracted (${Math.round(detected.artBase64.length / 1024)} KB base64)`,
      );
    } catch (e) {
      console.warn(`  [warn] hero base64 decode failed: ${e.message}`);
    }
    // art 缩略为 icon.png（256px —— 独立图标，来源于背景图，不依赖 preview）
    try {
      const iconBuf = await sharp(artBuf)
        .resize(256, 256, { fit: 'cover', position: 'centre' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      fs.writeFileSync(path.join(themeDir, 'icon.png'), iconBuf);
      console.log(`  ✓ icon.png generated (256px thumbnail from art, ${iconBuf.length} bytes)`);
    } catch (e) {
      console.warn(`  [warn] icon thumbnail failed: ${e.message}`);
    }
  }
  // 7b) preview → preview.png（仅预览，独立来源，不派生其他资源）
  if (detected.previewBase64) {
    const previewPath = path.join(themeDir, 'preview.png');
    try {
      fs.writeFileSync(previewPath, Buffer.from(detected.previewBase64, 'base64'));
      console.log(
        `  ✓ preview.png extracted (${Math.round(detected.previewBase64.length / 1024)} KB base64)`,
      );
    } catch (e) {
      console.warn(`  [warn] preview base64 decode failed: ${e.message}`);
    }
  }

  // 7b) 写入占位说明
  fs.writeFileSync(
    path.join(themeDir, 'BRIDGE_NOTES.md'),
    `# ${displayName} — Bridged from Codex\n\n` +
      `- source: ${path.basename(inputPath)}\n` +
      `- format: ${detected.format}\n` +
      `- mode: ${mode}\n` +
      `- palette keys: ${Object.keys(palette).join(', ')}\n` +
      `- has source CSS: ${rawCss ? 'yes (bridged)' : 'no (metadata-only export)'}\n` +
      `- art: ${detected.artBase64 ? 'extracted to assets/art.png' : 'none'}\n` +
      `- preview: ${detected.previewBase64 ? 'present (base64)' : 'none'}\n\n` +
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

/**
 * 将桥接块值中残留的 var(--ct-*) 引用转换为 --agentskin-* 引用。
 * --ct-accent-soft/softer/glow 等 alpha 派生变量直接展开为 color-mix 表达式，
 * 其余按 CT_VAR_MAP 映射保序替换（长键优先避免误匹配）。
 */
function transformBridgeReferences(css) {
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
  const entries = Object.entries(CT_VAR_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [ctVar, skinVar] of entries) {
    const escaped = ctVar.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const re = new RegExp(`var\\(${escaped}\\)`, 'g');
    css = css.replaceAll(re, `var(${skinVar})`);
  }
  return css;
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

  // 将 output block 中残留的 var(--ct-*) 引用转换为 --agentskin-*
  result = transformBridgeReferences(result);

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
