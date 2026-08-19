// SPDX-License-Identifier: MPL-2.0

/**
 * Merge Selector Harvest — 离线扫描 → 运行时选择器候选
 *
 * 读取 extract-summary.json 的 fragilitySeeds，筛选高稳定性的 data-testid / id / data-attr
 * 种子，去重后映射为 CSS 选择器字符串，输出 selector-harvest.json + 人读 Markdown。
 *
 * 用途：作为运行时锚点注册表的静态补充源。CDP 探针在 Shadow-Root 封闭、懒加载子视图、
 * iframe 内等场景下存在盲区；静态 asar 解包恰能覆盖这些区域。本脚本把两者桥接：
 * 静态种子经稳定性过滤后，以选择器形式注入运行时注册表，提升锚点覆盖率。
 *
 * 输入：
 *   docs/apps/<agentId>/raw/extract-summary.json → fragilitySeeds[]
 *
 * 输出：
 *   docs/apps/<agentId>/raw/selector-harvest.json（紧凑格式）
 *   docs/apps/<agentId>/raw/selector-harvest.md（人读摘要）
 *
 * 用法：
 *   node scripts/merge-selector-harvest.mjs <agentId>
 *   node scripts/merge-selector-harvest.mjs traework
 *   node scripts/merge-selector-harvest.mjs codex ./custom/extract-summary.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============== 常量配置 ==============
const MAPPABLE_KINDS = new Set(['data-testid', 'id', 'data-attr']);

const SEMANTIC_HEURISTICS = [
  { pattern: /input|editor|composer|textarea/, semantic: 'composer' },
  { pattern: /sidebar|nav|menu/, semantic: 'sidebar' },
  { pattern: /message|chat|conversation|thread/, semantic: 'messageList' },
  { pattern: /toolbar|action|command/, semantic: 'toolbar' },
  { pattern: /root|app|main|container/, semantic: 'root' },
];

// ============== CLI 解析 ==============
function parseArgs(argv) {
  const args = { agentId: null, inputPath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      throw new Error(`unknown arg: ${arg}`);
    } else if (args.agentId === null) {
      args.agentId = arg;
    } else if (args.inputPath === null) {
      args.inputPath = resolve(arg);
    } else {
      throw new Error(`unexpected arg: ${arg}`);
    }
  }
  if (args.agentId === null) {
    throw new Error('missing <agentId> argument');
  }
  return args;
}

// ============== 核心映射 ==============

/** Allowed charset for CSS identifiers (anchor names from asar scan). */
const SAFE_ANCHOR_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Validate and escape an anchor name for safe use in a CSS selector.
 * Returns null if the anchor contains unsafe characters.
 */
function safeAnchor(anchor) {
  if (typeof anchor !== 'string' || anchor.length === 0) return null;
  // Only allow safe CSS identifier characters.
  if (!SAFE_ANCHOR_RE.test(anchor)) return null;
  return anchor;
}

function seedToSelector(seed) {
  const anchor = safeAnchor(seed.anchor);
  if (anchor === null) return null;

  switch (seed.kind) {
    case 'data-testid':
      // Use CSS.escape for the attribute value (handles edge cases).
      return `[data-testid="${anchor}"]`;
    case 'id':
      return `#${anchor}`;
    case 'data-attr':
      return `[${anchor}]`;
    default:
      return null;
  }
}

function inferSemantics(anchor) {
  const results = [];
  for (const { pattern, semantic } of SEMANTIC_HEURISTICS) {
    if (pattern.test(anchor)) {
      results.push(semantic);
    }
  }
  return results;
}

function isMappable(seed) {
  return seed.stability === 'high' && MAPPABLE_KINDS.has(seed.kind);
}

// ============== 主流程 ==============
function runPipeline(agentId, inputPath) {
  const sourcePath = inputPath ?? resolve('docs', 'apps', agentId, 'raw', 'extract-summary.json');
  if (!existsSync(sourcePath)) {
    throw new Error(`input file not found: ${sourcePath}`);
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch (err) {
    throw new Error(`failed to parse ${sourcePath}: ${err.message}`);
  }

  const seeds = summary.fragilitySeeds ?? [];
  const totalSeeds = seeds.length;

  // 过滤 + 去重（按 kind+anchor 联合键去重，保留第一个出现的）
  const seenKeys = new Set();
  const candidates = [];
  for (const seed of seeds) {
    if (!isMappable(seed)) continue;
    const key = `${seed.kind}:${seed.anchor}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const selector = seedToSelector(seed);
    if (selector === null) continue;

    candidates.push({
      selector,
      source: { kind: seed.kind, anchor: seed.anchor, stability: seed.stability },
      suggestedSemantics: inferSemantics(seed.anchor),
    });
  }

  // 按 kind 分桶
  const byKind = { 'data-testid': [], id: [], 'data-attr': [] };
  for (const c of candidates) {
    byKind[c.source.kind]?.push(c);
  }

  const mappedSeeds = candidates.length;
  const filterRate = totalSeeds > 0 ? `${Math.round((1 - mappedSeeds / totalSeeds) * 100)}%` : '0%';

  return {
    output: {
      meta: {
        agentId,
        source: 'extract-summary.json',
        generatedAt: new Date().toISOString(),
        totalSeeds,
        mappedSeeds,
        filterRate,
      },
      candidates,
      byKind,
    },
    outDir: resolve('docs', 'apps', agentId, 'raw'),
  };
}

function writeOutput(result) {
  const { output, outDir } = result;
  mkdirSync(outDir, { recursive: true });

  const jsonPath = resolve(outDir, 'selector-harvest.json');
  const mdPath = resolve(outDir, 'selector-harvest.md');

  writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  writeFileSync(mdPath, renderMarkdown(output));

  return { jsonPath, mdPath };
}

function renderMarkdown(output) {
  const m = output.meta;
  const lines = [];
  lines.push(`# Selector Harvest — ${m.agentId}`);
  lines.push('');
  lines.push(`- **source**: \`${m.source}\``);
  lines.push(`- **generatedAt**: ${m.generatedAt}`);
  lines.push(`- **totalSeeds**: ${m.totalSeeds}`);
  lines.push(`- **mappedSeeds**: ${m.mappedSeeds}`);
  lines.push(`- **filterRate**: ${m.filterRate}`);
  lines.push('');

  lines.push('## By Kind');
  lines.push('');
  for (const [kind, items] of Object.entries(output.byKind)) {
    lines.push(`### ${kind} (${items.length})`);
    for (const item of items.slice(0, 15)) {
      const sem =
        item.suggestedSemantics.length > 0 ? ` → ${item.suggestedSemantics.join(', ')}` : '';
      lines.push(`- \`${item.selector}\`${sem}`);
    }
    if (items.length > 15) {
      lines.push(`- ... 另有 ${items.length - 15} 项`);
    }
    lines.push('');
  }

  lines.push('## All Candidates');
  lines.push('');
  for (const item of output.candidates) {
    const sem =
      item.suggestedSemantics.length > 0
        ? ` — semantics: ${item.suggestedSemantics.join(', ')}`
        : '';
    lines.push(`- \`${item.selector}\`${sem}`);
  }
  lines.push('');

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runPipeline(args.agentId, args.inputPath);
  const { jsonPath, mdPath } = writeOutput(result);
  const m = result.output.meta;
  console.log(`[selector-harvest] ${args.agentId} done`);
  console.log(
    `  totalSeeds: ${m.totalSeeds} → mappedSeeds: ${m.mappedSeeds} (filterRate: ${m.filterRate})`,
  );
  console.log(`  json: ${jsonPath}`);
  console.log(`  md:   ${mdPath}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export { inferSemantics, isMappable, runPipeline, seedToSelector };
