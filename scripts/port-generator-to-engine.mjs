// SPDX-License-Identifier: MPL-2.0
/**
 * # port-generator-to-engine.mjs — V3 切换 Step 2（RFC 2026-09-03 §3.4）
 *
 * 把 6 份生成器模板的输出内容上移进 engines/<agent>/tokens.css + cosmetic.css，
 * 使冻结 per-agent CSS 可以安全删除。移植规则：
 *
 *   1. palette 字面量 var 化：synth 色板的 hex/rgba 在输出中出现的位置
 *      一律替换为 var(--agentskin-*) / color-mix() 表达式（主题无关化）。
 *   2. token 身份块（纯 --agentskin-* 声明，含 color-scheme）跳过 —
 *      palette 层（注入期从 manifest.colors 生成）持有。
 *   3. art 块（含 var(--agentskin-art)）跳过 — 由 palette 层新增的
 *      --agentskin-art-* 参数 + cosmetic 静态 art 规则接管（见后继步骤）。
 *   4. 原生 token 覆盖 → tokens.css；结构规则 → cosmetic.css。
 *      与引擎现有内容去重（token 名 / 选择器级）。
 *   5. 无法 var 化的残字面量 → 报告 flag，人工复核。
 *
 * 幂等：重复运行不产生重复内容（基于标记注释 + 去重集合）。
 * 用法：node scripts/port-generator-to-engine.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINES_DIR = path.join(ROOT, 'engines');
const DRY = process.argv.includes('--dry-run');
const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

const MARK =
  '/* [v3-cutover] ported from generator template — theme-agnostic, do not hand-edit values with palette literals */';

// synth 色板（与 audit 脚本一致）：值必须在输出中唯一可识别。
const SYNTH = {
  mode: 'light',
  colors: {
    accent: '#0a91a8', // → --agentskin-accent
    secondary: '#71dbe2', // → --agentskin-secondary
    background: '#eef7fa', // → --agentskin-bg
    foreground: '#123e4a', // → --agentskin-text
    muted: '#53727d', // → --agentskin-muted
    surface: '#fefefe', // → --agentskin-surface
    surfaceElevated: '#fbfbfc', // → --agentskin-surface-elevated
    border: '#218fa8', // → --agentskin-border
    codeBackground: '#eafafd', // → --agentskin-code-bg
    codeForeground: '#123d4c', // → --agentskin-code-fg
    inputBackground: '#fdf0f4', // → --agentskin-input-bg
    buttonBackground: '#0a91a8', // → --agentskin-button-bg（与 accent 同值，同 var 没问题）
    buttonForeground: '#ffffff', // → --agentskin-button-fg
  },
};

const VAR_MAP = {
  accent: '--agentskin-accent',
  secondary: '--agentskin-secondary',
  background: '--agentskin-bg',
  foreground: '--agentskin-text',
  muted: '--agentskin-muted',
  surface: '--agentskin-surface',
  surfaceElevated: '--agentskin-surface-elevated',
  border: '--agentskin-border',
  codeBackground: '--agentskin-code-bg',
  codeForeground: '--agentskin-code-fg',
  inputBackground: '--agentskin-input-bg',
  buttonBackground: '--agentskin-button-bg',
  buttonForeground: '--agentskin-button-fg',
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** palette 字面量 → var()/color-mix() 表达式。返回 { css, leftovers }。 */
function varify(css) {
  const leftovers = new Set();
  for (const [key, v] of Object.entries(VAR_MAP)) {
    const hex = SYNTH.colors[key];
    const [r, g, b] = hexToRgb(hex);
    // hex（3/6 位，大小写）→ var()
    css = css.replace(new RegExp(`#${hex.slice(1)}\\b`, 'gi'), `var(${v})`);
    // rgba(r, g, b, a) → color-mix(in srgb, var(), a*100%)
    css = css.replace(
      new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*,\\s*([\\d.]+)\\s*\\)`, 'g'),
      (_m, a) => `color-mix(in srgb, var(${v}) ${Math.round(parseFloat(a) * 100)}%, transparent)`,
    );
    // rgb(r, g, b)（无 alpha，shade 派生）→ 无法无损 var 化，记 leftover
    css = css.replace(new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*\\)`, 'g'), (m) => {
      leftovers.add(m);
      return m;
    });
  }
  return { css, leftovers };
}

/** 按块解析 CSS：返回 [{ selector, body, isMedia, raw }]。 */
function parseBlocks(css) {
  const blocks = [];
  const lines = css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    if (line.startsWith('@media')) {
      // 整块透传（含内层），找到配对右括号
      let depth = 0,
        raw = [];
      do {
        raw.push(lines[i]);
        depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
        i++;
      } while (i < lines.length && depth > 0);
      blocks.push({
        selector: raw[0].trim(),
        body: raw.join('\n'),
        isMedia: true,
        raw: raw.join('\n'),
      });
      continue;
    }
    if (line.endsWith('{')) {
      const selector = line.slice(0, -1).trim();
      const body = [];
      i++;
      let depth = 1;
      while (i < lines.length && depth > 0) {
        const l = lines[i].trim();
        depth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
        if (depth > 0) body.push(l);
        else body.push(''); // 消费掉 '}'
        i++;
      }
      blocks.push({ selector, body: body.filter(Boolean).join('\n'), isMedia: false });
      continue;
    }
    i++; // 散行（分号、空行）
  }
  return blocks;
}

function declaredTokens(body) {
  return new Set([...body.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function existingTokens(css) {
  // 只统计"声明"，忽略 var() 引用（var(--x) 无冒号跟随）
  return new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function existingSelectors(css) {
  const set = new Set();
  for (const line of css.split('\n')) {
    const t = line.trim();
    if (t.endsWith('{') && !t.startsWith('/*') && !t.startsWith('@')) {
      for (const part of t.slice(0, -1).trim().split(',')) set.add(part.trim());
    }
  }
  return set;
}

// ── main ────────────────────────────────────────────────────────────

const { GENERATORS, buildContext } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'shared', 'theme', 'theme-generators.mjs')).href
);

const summary = [];
for (const agent of AGENTS) {
  const genOut = GENERATORS[agent](buildContext('engine-port', SYNTH));
  const { css: varified, leftovers } = varify(genOut);
  const blocks = parseBlocks(varified);

  const tokensPath = path.join(ENGINES_DIR, agent, 'tokens.css');
  const cosmeticPath = path.join(ENGINES_DIR, agent, 'cosmetic.css');
  const engineTokens = existingTokens(fs.readFileSync(tokensPath, 'utf8'));
  const engineCosmetic = fs.readFileSync(cosmeticPath, 'utf8');
  const engineSels = existingSelectors(engineCosmetic);

  const tokenBlocks = [];
  const cosmeticBlocks = [];
  let skippedPalette = 0,
    skippedArt = 0;
  const seenSels = new Set();

  for (const b of blocks) {
    const tokens = declaredTokens(b.body);
    const nativeTokens = [...tokens].filter((t) => !t.startsWith('--agentskin'));
    const hasStructural = b.body
      .split('\n')
      .some((l) => /^[a-z-]+\s*:/i.test(l.trim()) && !l.trim().startsWith('--'));
    const isArt = b.body.includes('var(--agentskin-art') || b.body.includes('--agentskin-art,');
    const isPaletteIdentity = !hasStructural && nativeTokens.length === 0 && tokens.size > 0;

    if (isArt) {
      skippedArt++;
      continue;
    }
    if (isPaletteIdentity) {
      skippedPalette++;
      continue;
    }

    if (b.isMedia) {
      cosmeticBlocks.push(b.raw);
      continue;
    }

    if (nativeTokens.length > 0 && !hasStructural) {
      // 纯 token 覆盖块 — 逐 token 去重
      const newTokens = nativeTokens.filter((t) => !engineTokens.has(t));
      if (newTokens.length === 0) continue;
      const kept = b.body
        .split('\n')
        .filter((l) => {
          const m = l.match(/(--[a-zA-Z0-9-]+)\s*:/);
          return !m || engineTokens.has(m[1]) === false;
        })
        .join('\n');
      if (kept.trim()) {
        tokenBlocks.push(`${b.selector} {\n${kept}\n}`);
        for (const t of newTokens) engineTokens.add(t);
      }
      continue;
    }

    // 结构块（或混合块）— 选择器去重后进 cosmetic
    const parts = b.selector.split(',').map((s) => s.trim());
    const newParts = parts.filter((p) => !engineSels.has(p) && !seenSels.has(p));
    if (newParts.length === 0) continue;
    // 混合块中的新 token 也记入已见，避免 tokens 重复
    for (const t of nativeTokens) engineTokens.add(t);
    for (const p of newParts) seenSels.add(p);
    const sel = newParts.length === parts.length ? b.selector : newParts.join(',\n');
    cosmeticBlocks.push(`${sel} {\n${b.body}\n}`);
  }

  const report = {
    agent,
    tokenBlocks: tokenBlocks.length,
    cosmeticBlocks: cosmeticBlocks.length,
    skippedPalette,
    skippedArt,
    leftovers: [...leftovers],
  };
  summary.push(report);
  console.log(
    `${agent}: +${tokenBlocks.length} token块, +${cosmeticBlocks.length} 结构块 (跳过 palette=${skippedPalette}, art=${skippedArt})${leftovers.length ? ` ⚠ 残字面量: ${leftovers.join(' ')}` : ''}`,
  );

  if (!DRY && (tokenBlocks.length || cosmeticBlocks.length)) {
    if (tokenBlocks.length) {
      fs.appendFileSync(tokensPath, `\n\n${MARK}\n\n${tokenBlocks.join('\n\n')}\n`, 'utf8');
    }
    if (cosmeticBlocks.length) {
      fs.appendFileSync(cosmeticPath, `\n\n${MARK}\n\n${cosmeticBlocks.join('\n\n')}\n`, 'utf8');
    }
  }
}

if (DRY) console.log('\n(dry-run — 未写入)');
else
  console.log(
    '\n已写入 engines/<agent>/{tokens,cosmetic}.css — 重跑 audit-engine-coverage.mjs 验证',
  );
