// SPDX-License-Identifier: MPL-2.0

/**
 * Static-vs-CDP Gap Analyzer (盲区补采清单)
 *
 * 对比「静态 asar 解包层」(extract-summary.json) 与「动态 CDP 探针层」(cdp-summary.json)，
 * 产出 CDP 探针抓不到的 token 命名空间 / 语义锚点清单。用于人工决定是否回采补全。
 *
 * 为什么需要：CDP 探针存在已知盲区（封闭 Shadow-Root、CORS 样式表、adoptedStyleSheets、
 * CSS-in-JS 内存样式、@property Houdini、iframe 内、懒加载子视图）。这些盲区的静态真源
 * 恰好在 asar 里——本脚本把两者对齐，标出「静态有、运行时 rootVars/anchors 没有」的缺口。
 *
 * 输入（每 Agent）：
 *   - 静态：docs/apps/<id>/raw/extract-summary.json → tokens.namespaces / strings.dataTestids
 *   - 动态：docs/apps/<id>/raw/cdp-summary.json      → rootVariables.perScheme.*.namespaces / anchors.sample
 *
 * 输出：
 *   - docs/apps/<id>/raw/static-cdp-gap.md（人读）+ .json（机器可读）
 *   - --summary 只打印每 Agent 的统计摘要
 *
 * 用法：
 *   node scripts/analyze-static-cdp-gap.mjs                 # 遍历全部 6 Agent
 *   node scripts/analyze-static-cdp-gap.mjs --agent zcode   # 单选
 *   node scripts/analyze-static-cdp-gap.mjs --summary       # 只出摘要
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const AGENTS = ['codex', 'doubao', 'traework', 'qoderwork', 'workbuddy', 'zcode'];

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { agent: null, summary: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent') args.agent = (argv[++i] ?? '').toLowerCase();
    else if (arg === '--summary') args.summary = true;
    else throw new Error(`未知参数: ${arg}`);
  }
  return args;
}

// ── 数据读取 ────────────────────────────────────────────────────────────────
function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function agentInputs(agent) {
  const rawDir = path.join(ROOT, 'docs', 'apps', agent, 'raw');
  const extract = loadJSON(path.join(rawDir, 'extract-summary.json'));
  const cdp = loadJSON(path.join(rawDir, 'cdp-summary.json'));
  return { rawDir, extract, cdp };
}

// 静态 asar token 命名空间 → { ns: Set<varName without --ns-> prefix> }
// collectTokens 已把 `--foo-bar` 归桶为 ns='foo'，vars 值形如 `bar-baz`（已去前缀）。
function staticNamespaces(tokens) {
  const result = new Map();
  const nsMap = tokens?.namespaces ?? {};
  for (const [ns, info] of Object.entries(nsMap)) {
    const vars = new Set((info?.vars ?? []).map((v) => v?.value).filter(Boolean));
    result.set(ns, vars);
  }
  return result;
}

// CDP 运行时 rootVars 命名空间 → { ns: Set<varName> }
function cdpRuntimeNamespaces(rootVariables) {
  const result = new Map();
  const per = rootVariables?.perScheme ?? {};
  for (const scheme of Object.keys(per)) {
    for (const [ns, count] of per[scheme]?.namespaces ?? []) {
      // CDP 只有命名空间级计数（na×N），无逐变量名——将存在性记入集合，值占位。
      if (!result.has(ns)) result.set(ns, new Set());
      result.get(ns).add(`@scheme:${scheme}@count:${count}`);
    }
  }
  // 若 perScheme 为空但 hostKind 有，则无运行时 rootVars（分布式变量场景）。
  return result;
}

// 静态 data-testid 锚点（value 形如 `chat-input`）
function staticTestIds(strings) {
  return new Set((strings?.dataTestids ?? []).map((s) => s?.value).filter(Boolean));
}

// CDP 运行时语义锚点（sample 形如 `.chat-input` 或后接渲染串）——归一化剥离前导 `.`
function cdpAnchorTokens(anchors) {
  const out = new Set();
  for (const a of anchors?.sample ?? []) {
    const bare = String(a).replace(/^[.#]/, '');
    if (bare) out.add(bare);
  }
  return out;
}

// ── 缺口计算 ──────────────────────────────────────────────────────────────
function computeGap(agent, { extract, cdp }) {
  if (!extract) return { agent, skip: 'no extract-summary.json' };
  if (!cdp) return { agent, skip: 'no cdp-summary.json' };

  const staticNS = staticNamespaces(extract.tokens);
  const runtimeNS = cdpRuntimeNamespaces(cdp.rootVariables);

  // 静态有、CDP 运行时无的命名空间（盲区核心）
  const staticOnlyNS = [...staticNS.entries()]
    .filter(([ns]) => !runtimeNS.has(ns))
    .map(([ns, vars]) => ({
      ns,
      varCount: vars.size,
      sampleVars: [...vars].slice(0, 12),
      // 归类盲区成因：这些变量来自 asar 静态 CSS，运行时 rootVars 未暴露
      hint: classifyGap(ns),
    }));
  staticOnlyNS.sort((a, b) => b.varCount - a.varCount);

  // 双向都存在（可用 runtime rootVars 交叉验证）
  const sharedNS = [...staticNS.keys()]
    .filter((ns) => runtimeNS.has(ns))
    .map((ns) => ({ ns, staticVars: staticNS.get(ns).size, runtimeCount: runtimeNS.get(ns).size }));
  sharedNS.sort((a, b) => b.staticVars - a.staticVars);

  // 静态 data-testid 在运行时 anchors 中未命中的锚点
  const staticIds = staticTestIds(extract.strings);
  const cdpAnchors = cdpAnchorTokens(cdp.anchors);
  const unverifiedIds = [...staticIds].filter(
    (id) => /^[A-Za-z][\w-]+$/.test(id) && !cdpAnchors.has(id),
  );
  const verifiedIds = [...staticIds].filter(
    (id) => /^[A-Za-z][\w-]+$/.test(id) && cdpAnchors.has(id),
  );

  return {
    agent,
    cdpVersion: cdp.staticAppVersion ?? cdp.frame?.url ?? null,
    staticVersion: extract.meta?.appVersion ?? null,
    rootVarSource: cdp.distributedVars ? 'distributed' : (cdp.rootVariables?.hostKind ?? 'root'),
    stats: {
      staticNamespaces: staticNS.size,
      runtimeNamespaces: runtimeNS.size,
      staticOnlyNamespaces: staticOnlyNS.length,
      sharedNamespaces: sharedNS.length,
      staticTestIds: staticIds.size,
      verifiedTestIds: verifiedIds.length,
      unverifiedTestIds: unverifiedIds.length,
    },
    staticOnlyNamespaces: staticOnlyNS,
    sharedNamespaces: sharedNS,
    unverifiedTestIds: unverifiedIds,
    verifiedTestIds: verifiedIds,
  };
}

// 盲区成因分类：依据命名空间语义给出补采建议。
// 优先级从高到低匹配，避免被泛化规则吞掉精确定位。
// —— Radix 家族（.rt-*/--base-*）实测（workbuddy §1.3.1 已跟踪回退链）：
//    Radix 组件级变量走 var(--x, fallback) 内联，非 :root 暴露。
//    其回退链只指向两类目标：
//      A. 灰阶/黑白色板（--gray-*/--black-*/--white-*）→ 运行时 rootVars 有基底，可着色、可注入；
//      B. 结构尺寸 token（--space-*/--card-*/--checkbox-* 等）→ 定义在 .rt-* 组件规则里，
//         未进 rootVars；决定尺寸而非主题色，不纳入注入作用域。
//    → Radix 命名空间既不补采、又非 CDP 丢失，可直接消声。
function classifyGap(ns) {
  // 1) Radix 结构/组件级 token——明确无须补采（回退链可着色基底已在运行时，结构 token 不纳入注入）
  const RADIX_NS = new Set([
    'base',
    'rt',
    'radix',
    'space',
    'card',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'tooltip',
    'inset',
    'margin',
    'padding',
    'size',
    'sizing',
  ]);
  if (RADIX_NS.has(ns) || /^(rt|radix)-/.test(ns)) {
    return 'Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采';
  }
  // 2) 未加载功能 chunk 的脚手架库（画板 / 文档 / 弹层预览）——非当前渲染面，CDP 看不到属预期
  if (['td', 'excalidraw', 'katex', 'drawio', 'mermaid', 'hljs', 'docx'].includes(ns)) {
    return '脚手架/独立功能库变量——大概率未加载 chunk，非当前渲染面，CDP 看不到属预期，无需补采';
  }
  // 3) 灰阶/黑白色板——Radix 可着色基底，已被 CDP 聚合到此（若出现于盲区说明带值差异，需比对）
  if (['gray', 'black', 'white'].includes(ns)) {
    return '色板变量——Radix 可着色基底；若出现在盲区需比对具体取值，一般已由 CDP 运行时覆盖';
  }
  // 4) 结构类 design-token（尺寸/圆角/间距/字级，非颜色主题）——Tailwind v4 @theme 生成，
  //    定义在 `:root, :host` 多选择器或组件规则，CDP 聚合回退可能提前返回而漏采；对主题注入无影响
  if (
    [
      'text',
      'radius',
      'container',
      'tracking',
      'leading',
      'spacing',
      'size',
      'animate',
      'blur',
      'drop',
    ].includes(ns)
  ) {
    return '结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛';
  }
  // 5) 常驻不被 rootVars 暴露的设计系统 token → 建议验证是否需要纳入基线
  if (['color', 'tw', 'bg', 'font', 'shadow'].includes(ns)) {
    return 'design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面';
  }
  if (/vscode|cb-|darkmode|dark/i.test(ns)) {
    return 'VS Code 可变色（inline/style 变量），CDP rootVars 收集不到——常见盲区';
  }
  return '静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS';
}

// ── 输出 ────────────────────────────────────────────────────────────────────
function renderMarkdown(gap) {
  if (gap.skip) {
    return `# static-vs-CDP gap — ${gap.agent}\n\n**跳过**: ${gap.skip}\n`;
  }
  const L = [];
  L.push(`# static-vs-CDP gap — ${gap.agent}`);
  L.push('');
  L.push(
    `- **static version**: ${gap.staticVersion ?? '?'} | **CDP source**: ${gap.cdpVersion ?? '?'}`,
  );
  L.push(`- **rootVar 来源形态**: ${gap.rootVarSource}`);
  L.push('');
  L.push('## 统计');
  L.push('');
  L.push(`| 项 | 静态 asar | CDP 运行时 | 缺口 |`);
  L.push('|----|----------|-----------|------|');
  L.push(
    `| token 命名空间 | ${gap.stats.staticNamespaces} | ${gap.stats.runtimeNamespaces} | ${gap.stats.staticOnlyNamespaces} |`,
  );
  L.push(
    `| data-testid 锚点 | ${gap.stats.staticTestIds} | ${gap.stats.verifiedTestIds}（命中） | ${gap.stats.unverifiedTestIds}（未验证） |`,
  );
  L.push('');
  L.push(`## 盲区 token 命名空间（静态有、CDP rootVars 无）— ${gap.stats.staticOnlyNamespaces} 个`);
  L.push('');
  if (gap.staticOnlyNamespaces.length === 0) {
    L.push('_无_（静态命名空间全部被 CDP rootVars 覆盖）');
  } else {
    L.push('| 命名空间 | 变量数 | 样本变量 | 成因提示 |');
    L.push('|---------|-------|---------|---------|');
    for (const ns of gap.staticOnlyNamespaces) {
      const sample = ns.sampleVars.slice(0, 6).join(', ') + (ns.varCount > 6 ? ' …' : '');
      L.push(`| \`--${ns.ns}-*\` | ${ns.varCount} | \`${sample}\` | ${ns.hint} |`);
    }
  }
  L.push('');
  L.push(
    `## 未验证 data-testid 锚点（静态有、CDP anchors 未见）— ${gap.stats.unverifiedTestIds} 个`,
  );
  L.push('');
  if (gap.unverifiedTestIds.length === 0) {
    L.push('_无_');
  } else {
    L.push(
      '> 可能是语义锚点，但当前 CDP 快照未在 anchors 采样中暴露；需确认是否因懒加载 / 封闭 shadow root 未渲染。',
    );
    L.push('');
    L.push('```text');
    L.push(gap.unverifiedTestIds.slice(0, 80).join('\n'));
    if (gap.unverifiedTestIds.length > 80) L.push(`…（共 ${gap.unverifiedTestIds.length}）`);
    L.push('```');
  }
  return L.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const agents = args.agent ? AGENTS.filter((a) => a === args.agent) : AGENTS;
  if (agents.length === 0) throw new Error(`未知 agent: ${args.agent}`);

  const reports = [];
  for (const agent of agents) {
    const { rawDir, extract, cdp } = agentInputs(agent);
    const gap = computeGap(agent, { extract, cdp });
    reports.push(gap);
    if (!args.summary && !gap.skip) {
      const mdPath = path.join(rawDir, 'static-cdp-gap.md');
      const jsPath = path.join(rawDir, 'static-cdp-gap.json');
      fs.writeFileSync(mdPath, renderMarkdown(gap));
      fs.writeFileSync(jsPath, JSON.stringify(gap, null, 2));
    }
  }

  if (args.summary) {
    console.log(`Agent | 静态NS | 运行时NS | 盲区NS | static-testid | 未验证id`);
    console.log(`------|-------|---------|--------|---------------|----------`);
    for (const g of reports) {
      if (g.skip) {
        console.log(`${g.agent} | — | — | — | — | ${g.skip}`);
      } else {
        const s = g.stats;
        console.log(
          `${g.agent} | ${s.staticNamespaces} | ${s.runtimeNamespaces} | ${s.staticOnlyNamespaces} | ${s.staticTestIds} | ${s.unverifiedTestIds}`,
        );
      }
    }
    return;
  }

  for (const g of reports) {
    if (g.skip) {
      console.log(`[gap] ${g.agent}: ${g.skip}`);
    } else {
      console.log(
        `[gap] ${g.agent}: written docs/apps/${g.agent}/raw/static-cdp-gap.{md,json} — 盲区NS ${g.stats.staticOnlyNamespaces}, 未验证id ${g.stats.unverifiedTestIds}/${g.stats.staticTestIds}`,
      );
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { computeGap, renderMarkdown };
