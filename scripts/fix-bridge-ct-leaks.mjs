// SPDX-License-Identifier: MPL-2.0
//
// # fix-bridge-ct-leaks.mjs — 一次性修复已桥接 codex.css 中残留的 var(--ct-*) 引用
//
// 背景: bridge-codex-theme.mjs 的 extractBridgeSection 过滤了 --ct-* 声明但未转换
// 值中的 var(--ct-*) 引用，导致 codex.css 桥接块出现无效 var(--ct-*) 引用。
//
// 用法:
//   node scripts/fix-bridge-ct-leaks.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.resolve(__dirname, '..', 'themes');

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
  '--ct-border-light': '--agentskin-border',
  '--ct-focus': '--agentskin-focus-ring',
  '--ct-selection': '--agentskin-selection',
  '--ct-success': '--agentskin-secondary',
  '--ct-warning': '--agentskin-accent',
  '--ct-danger': '--agentskin-accent',
  '--ct-accent-hover': '--agentskin-accent',
  '--ct-input': '--agentskin-surface-elevated',
};

function transformBridgeReferences(css) {
  // 1) alpha 派生变量（必须先于 accent 本体，避免误匹配）
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
  // 2) 通用映射（按 key 长度降序排列，避免短键误匹配长键）
  const entries = Object.entries(CT_VAR_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [ctVar, skinVar] of entries) {
    const re = new RegExp(`var\\(${ctVar.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}\\)`, 'g');
    css = css.replaceAll(re, `var(${skinVar})`);
  }
  return css;
}

const THEMES = ['github-noir', 'sweet-strawberry-code'];
let fixed = 0;

for (const themeId of THEMES) {
  const cssPath = path.join(THEMES_DIR, themeId, 'assets', 'css', 'codex.css');
  if (!fs.existsSync(cssPath)) {
    console.log(`  [skip] ${themeId}: codex.css not found`);
    continue;
  }

  const original = fs.readFileSync(cssPath, 'utf8');

  const bridgeMarker =
    '/* ===== Bridge: Codex-native --color-token-* overrides (from source theme) =====';
  const bridgeStart = original.indexOf(bridgeMarker);
  if (bridgeStart === -1) {
    console.log(`  [skip] ${themeId}: no bridge section found`);
    continue;
  }

  const before = original.slice(0, bridgeStart);
  let bridgeBlock = original.slice(bridgeStart);

  // 转换桥接块中所有 var(--ct-*) 引用
  bridgeBlock = transformBridgeReferences(bridgeBlock);

  const newCss = before + bridgeBlock;

  const remaining = [...newCss.matchAll(/--ct-[a-zA-Z0-9_-]+/g)].map((m) => m[0]);
  const uniqueRemaining = [...new Set(remaining)].sort();

  fs.writeFileSync(cssPath, newCss, 'utf8');
  fixed++;

  if (uniqueRemaining.length > 0) {
    console.log(`  [warn] ${themeId}: still has --ct-* refs: ${uniqueRemaining.join(', ')}`);
  } else {
    console.log(`  [ok] ${themeId}: all --ct-* references resolved`);
  }
}

console.log(`\nFixed ${fixed} theme(s).`);
