// SPDX-License-Identifier: MPL-2.0
/**
 * # audit-engine-coverage.mjs — V3 切换门禁（RFC 2026-09-03 §3.4）
 *
 * 证明 V2 主题包的冻结 per-agent CSS 可以安全删除：其内容 100% 可由
 * 「manifest.colors + 引擎 tokens/cosmetic 层」重构。
 *
 * 三道门：
 *   A. 冻结同构性 — 同一 agent 的全部主题冻结 CSS 剥离色值后逐字节同构
 *      → 冻结产物不含手写内容，删除不丢主题个性。
 *   B. token 覆盖 — 生成器输出覆盖的原生 token 名集合 ⊆ 引擎 tokens.css 集合
 *      → 运行时映射无缺口。
 *   C. 结构规则覆盖 — 生成器输出中的选择器集合 ⊆ 引擎 cosmetic/tokens 集合
 *      → 背景层/透明化等结构规则已上移。
 *
 * 输出：docs/reports/<date>-v3-engine-coverage-audit.md
 * 退出码：0 = 三门全过；1 = 任一门失败（批量升级不得执行）。
 *
 * 用法：node scripts/audit-engine-coverage.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const ENGINES_DIR = path.join(ROOT, 'engines');
const REPORTS_DIR = path.join(ROOT, 'docs', 'reports');

const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

// ── helpers ─────────────────────────────────────────────────────────

/** 剥离注释 + 色值 + 数值 + 声明值，得到"选择器+属性名"骨架用于同构比较。
 *  依据：冻结 CSS 由生成器从 palette 派生一切值（含渐变百分比、阴影参数、
 *  color-scheme），主题间只允许 palette 派生值不同，结构（选择器+属性名）必须同构。 */
function structuralSkeleton(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments
    .replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, 'C') // nested-safe first
    .replace(/#[0-9a-fA-F]{3,8}\b/g, 'C')
    .replace(/rgba?\([^()]*\)/g, 'C')
    .replace(/(^|[^-\w.])\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr)?\b/g, '$1N')
    .replace(/^(\s*(?:--)?[a-zA-Z][a-zA-Z0-9-]*\s*):[^;{}]*;/gm, '$1:;') // declaration values → 空
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** 提取被声明（覆盖）的 custom property 名。var() 内的引用不含冒号，不会误中。 */
function declaredTokens(css) {
  const set = new Set();
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) set.add(m[1]);
  return set;
}

/** 提取选择器集合（`selector {` 行），归一化空白。 */
function selectors(css) {
  const set = new Set();
  for (const line of css.split('\n')) {
    const t = line.trim();
    if (t.endsWith('{') && !t.startsWith('/*')) set.add(t.replace(/\s+/g, ' '));
  }
  return set;
}

function fmtSet(set) {
  return (
    [...set]
      .sort()
      .map((s) => `  - ${s}`)
      .join('\n') || '  (none)'
  );
}

// ── load themes ─────────────────────────────────────────────────────

const themeIds = fs
  .readdirSync(THEMES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(THEMES_DIR, n, 'manifest.json')));

const v2Themes = [];
for (const id of themeIds) {
  const manifest = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, id, 'manifest.json'), 'utf8'));
  const cssDir = path.join(THEMES_DIR, id, 'assets', 'css');
  const cssFiles = fs.existsSync(cssDir) ? fs.readdirSync(cssDir) : [];
  if (cssFiles.length > 0) v2Themes.push({ id, manifest, cssDir });
}

console.log(`themes: ${themeIds.length} total, ${v2Themes.length} with frozen CSS\n`);

// ── load generators ─────────────────────────────────────────────────

const { GENERATORS, buildContext } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'shared', 'theme', 'theme-generators.mjs')).href
);

// ── Gate A: frozen ≡ current generator output（删除安全门禁）─────────
// 每主题每 agent：冻结 CSS 骨架 vs 当前生成器输出骨架。不一致 = 手改或
// 旧模板残留，其额外规则在删除冻结文件后会丢失，须人工裁决。

const gateA = { pass: true, perThemeAgent: {} };
let gateAPass = 0;
for (const t of v2Themes) {
  const deviations = [];
  for (const agent of AGENTS) {
    const file = path.join(t.cssDir, `${agent}.css`);
    if (!fs.existsSync(file)) continue;
    const frozen = structuralSkeleton(fs.readFileSync(file, 'utf8'));
    let current;
    try {
      current = structuralSkeleton(GENERATORS[agent](buildContext(t.id, t.manifest)));
    } catch (e) {
      deviations.push(`${agent}: generator threw — ${e.message}`);
      continue;
    }
    if (frozen !== current) {
      const frozenLines = new Set(frozen.split('\n'));
      const currentLines = new Set(current.split('\n'));
      const lost = [...frozenLines].filter((l) => !currentLines.has(l));
      const added = [...currentLines].filter((l) => !frozenLines.has(l));
      deviations.push(`${agent}: ${lost.length} lost / ${added.length} evolved`);
      gateA.perThemeAgent[`${t.id}/${agent}`] = { lost, added };
    }
  }
  if (deviations.length === 0) {
    gateAPass++;
    console.log(`[A] ${t.id}: ✓ frozen ≡ current generator (all agents)`);
  } else {
    gateA.pass = false;
    console.log(`[A] ${t.id}: ✗ ${deviations.length} agent(s) deviate — ${deviations.join('; ')}`);
  }
}
console.log(
  `[A] summary: ${gateAPass}/${v2Themes.length} themes fully explained by current generators\n`,
);

// ── engine layers + synth palettes (for Gate B/C) ───────────────────

// 合成色板：dark + light 各跑一次，token/选择器集合取并集。
const SYNTH = [
  {
    mode: 'light',
    colors: {
      accent: '#0d9aa0',
      secondary: '#74dce4',
      background: '#f0f8fa',
      foreground: '#163f4b',
      muted: '#557480',
      surface: '#ffffff',
      surfaceElevated: '#ffffff',
      border: '#249aa0',
      codeBackground: '#eefbff',
      codeForeground: '#163f4b',
      inputBackground: '#fef1f5',
      buttonBackground: '#0d9aa0',
      buttonForeground: '#ffffff',
    },
  },
  {
    mode: 'dark',
    colors: {
      accent: '#5ad1e0',
      secondary: '#243b47',
      background: '#10181c',
      foreground: '#d8e8ec',
      muted: '#6a8894',
      surface: '#16232a',
      surfaceElevated: '#1c2c35',
      border: '#2a5a64',
      codeBackground: '#0c1418',
      codeForeground: '#9adcf0',
      inputBackground: '#18242c',
      buttonBackground: '#5ad1e0',
      buttonForeground: '#062a30',
    },
  },
];

function generatorOutput(agent) {
  const gen = GENERATORS[agent];
  const outs = SYNTH.map((s) => gen(buildContext('audit-synth', s)));
  return outs.join('\n');
}

function engineCss(agent) {
  const parts = [];
  for (const f of ['tokens.css', 'cosmetic.css']) {
    const p = path.join(ENGINES_DIR, agent, f);
    if (fs.existsSync(p)) parts.push(fs.readFileSync(p, 'utf8'));
  }
  return parts.join('\n');
}

// ── Gate B: native token coverage ───────────────────────────────────

const gateB = { pass: true, perAgent: {} };
for (const agent of AGENTS) {
  const genTokens = declaredTokens(generatorOutput(agent));
  const engineTokens = declaredTokens(engineCss(agent));
  const genNative = new Set([...genTokens].filter((t) => !t.startsWith('--agentskin')));
  const engineNative = new Set([...engineTokens].filter((t) => !t.startsWith('--agentskin')));
  const gaps = [...genNative].filter((t) => !engineNative.has(t));
  gateB.perAgent[agent] = {
    generatorNative: genNative.size,
    engineNative: engineNative.size,
    gaps,
  };
  if (gaps.length > 0) {
    gateB.pass = false;
    console.log(`[B] ${agent}: ✗ ${gaps.length} native tokens in generator but NOT in engine:`);
    console.log(fmtSet(new Set(gaps)));
  } else {
    console.log(`[B] ${agent}: ✓ all ${genNative.size} generator native tokens covered by engine`);
  }
}

// ── Gate C: structural selector coverage ────────────────────────────

const gateC = { pass: true, perAgent: {} };
for (const agent of AGENTS) {
  const genSels = selectors(generatorOutput(agent));
  const engineSels = selectors(engineCss(agent));
  // 引擎选择器允许前缀扩展（如逗号列表拆分），做"包含"比较：
  // 生成器的每个选择器要么原样存在，要么其每个逗号分支都存在于引擎集合。
  const engineAtomic = new Set();
  for (const s of engineSels) for (const part of s.split(',')) engineAtomic.add(part.trim());
  const gaps = [];
  for (const s of genSels) {
    for (const part of s.split(',')) {
      if (!engineAtomic.has(part.trim())) {
        gaps.push(part.trim());
        break; // 该选择器有未覆盖分支即记一次
      }
    }
  }
  gateC.perAgent[agent] = { generatorSelectors: genSels.size, gaps };
  if (gaps.length > 0) {
    gateC.pass = false;
    console.log(`[C] ${agent}: ✗ ${gaps.length} selectors in generator but NOT in engine:`);
    console.log(fmtSet(new Set(gaps)));
  } else {
    console.log(`[C] ${agent}: ✓ all ${genSels.size} generator selectors covered by engine`);
  }
}

// ── report ──────────────────────────────────────────────────────────

const allPass = gateA.pass && gateB.pass && gateC.pass;
const date = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push('# V3 切换门禁 — 引擎覆盖度审计报告', '');
lines.push(`- 日期: ${date}`);
lines.push(`- 结论: **${allPass ? 'PASS — 可执行批量升级' : 'FAIL — 禁止批量升级'}**`, '');
lines.push('## Gate A 冻结同构性', '');
lines.push('| agent | 同构 | 结构变体数 |', '|---|---|---|');
for (const a of AGENTS)
  lines.push(
    `| ${a} | ${gateA.perAgent[a].homogeneous ? '✓' : '✗'} | ${gateA.perAgent[a].variants} |`,
  );
lines.push('', '## Gate B 原生 token 覆盖', '');
for (const a of AGENTS) {
  const g = gateB.perAgent[a];
  lines.push(
    `- **${a}**: 生成器 ${g.generatorNative} / 引擎 ${g.engineNative}${g.gaps.length ? `，缺口 ${g.gaps.length}:\n${fmtSet(new Set(g.gaps))}` : '，无缺口'}`,
  );
}
lines.push('', '## Gate C 结构选择器覆盖', '');
for (const a of AGENTS) {
  const g = gateC.perAgent[a];
  lines.push(
    `- **${a}**: 生成器 ${g.generatorSelectors} 个选择器${g.gaps.length ? `，未覆盖 ${g.gaps.length}:\n${fmtSet(new Set(g.gaps))}` : '，全部覆盖'}`,
  );
}
lines.push('', '## 结论', '');
lines.push(
  allPass
    ? '冻结 per-agent CSS 的全部内容可由 manifest.colors（palette 层）+ 引擎 tokens/cosmetic 层重构，删除安全。'
    : '存在引擎层缺口，须先按上方缺口清单补齐 engines/<agent>/ 层，重跑本审计通过后才能执行批量升级。',
);

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const reportPath = path.join(REPORTS_DIR, `${date}-v3-engine-coverage-audit.md`);
fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(`\nreport → ${path.relative(ROOT, reportPath)}`);
process.exit(allPass ? 0 : 1);
