// SPDX-License-Identifier: MPL-2.0
/**
 * 逆向架构文档生成器 —— “圣经”体系的自动化底座。
 *
 * 读入 `agents-raw-data/<agent>-full-extract.json`（CDP 全量快照），为每个 Agent 产出：
 *  - docs/apps/<agent>/raw/extract-summary.json  原始量化基准（可被上层工具 diff）
 *  - docs/apps/<agent>/raw/extract-summary.md    人读快照汇总
 *  - docs/apps/<agent>/architecture.md           逆向架构文档（实测数据 + 定性骨架）
 *  - docs/apps/<agent>/fragility.md              脆弱性分级 + 升级检查清单
 *
 * 设计原则（对齐 explodex 方法论）：
 *  静态层（asar 解包）与动态层（CDP）分离；本脚本负责动态层量化，静态层若已有
 *  extract-summary.json 会合并进 facts 而不覆盖。
 *
 * 用法：
 *   node scripts/gen-agent-arch-docs.mjs                        # 全 6 agent
 *   node scripts/gen-agent-arch-docs.mjs --only workbuddy       # 单 agent
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'agents-raw-data');
const DOCS_DIR = join(ROOT, 'docs', 'apps');

const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

// 权威元信息（源于适配器分析与历史逆向，优先于纯 scheme 启发式）：
//  - family: 界面技术栈
//  - distributedVars: 是否为 VS Code 分布式变量家族（组件 inline style + 样式表规则，非 :root 集中）
//                    —— 决定 rootVars 必须走聚合策略
const AGENT_META = Object.freeze({
  codex: { family: 'react/tailwind', distributedVars: false },
  doubao: { family: 'chromium-webview', distributedVars: false },
  zcode: { family: 'react-app', distributedVars: false },
  traework: { family: 'vscode-extension (solo-lite)', distributedVars: false },
  workbuddy: { family: 'vscode-family (VS Code 架构)', distributedVars: true },
  qoderwork: { family: 'vscode-family (VS Code 架构)', distributedVars: true },
});

// DOM 树节点形态：{ t:tag, c:class, i:id, s:inlineStyle, ch:children }
const HASH_CLASS_RE = /^[_a-z]{1,2}[A-Za-z0-9_]*_\d+$/;
const NOISE_CLASS_RE = /^__as_|^agent-ui-theme$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function namespaceCounts(varsObj) {
  const m = new Map();
  for (const key of Object.keys(varsObj || {})) {
    const body = key.replace(/^--/, '');
    if (body === '__host') continue;
    const ns = body.includes('-') ? body.slice(0, body.indexOf('-')) : 'none';
    m.set(ns, (m.get(ns) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 收集语义锚点：stable id + 非 hash/噪声 class token（去重） */
function collectAnchors(root) {
  const set = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.i === 'string' && node.i.length > 0) set.add(`id:${node.i}`);
    if (typeof node.c === 'string') {
      for (const cls of node.c.split(/\s+/).filter(Boolean)) {
        if (HASH_CLASS_RE.test(cls) || NOISE_CLASS_RE.test(cls)) continue;
        if (cls.length <= 2) continue;
        set.add(`.${cls}`);
      }
    }
    const ch = node.ch;
    if (Array.isArray(ch)) for (const c of ch) walk(c);
  };
  if (root && typeof root === 'object') walk(root);
  return [...set].sort();
}

/** 从 inline style / sheet 聚合出的 __host 形态（若存在于 rootVariables） */
function hostKindOf(rv) {
  const d = (rv && rv.default) || {};
  if (typeof d['__host'] === 'string') {
    try {
      return JSON.parse(d['__host']);
    } catch {
      return { kind: 'unknown', n: null };
    }
  }
  return null;
}

/** 顶层 DOM 递归可遍历节点数 */
function domNodeCount(root) {
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    n += 1;
    const ch = node.ch;
    if (Array.isArray(ch)) for (const c of ch) walk(c);
  };
  if (root && typeof root === 'object') walk(root);
  return n;
}

function familyOf(securityOrigin, url, agent) {
  if (agent === 'codex') return 'react/tailwind';
  if (/vscode-file|vscode-app|chromium/i.test(securityOrigin)) return 'vscode-extension';
  if (/chrome:\/\//i.test(securityOrigin)) return 'chromium-webview';
  if (/app\.asar\/out\/renderer/i.test(url || '')) return 'react-app';
  return 'electron-renderer';
}

function buildFacts(agent, j, staticSummary) {
  const meta = j.meta || {};
  const dq = meta.dataQuality || {};
  const frame = ((j.frameSnapshot && j.frameSnapshot.frames) || [])[0] || {};
  const stats = j.stats || {};
  const rv = j.rootVariables || {};
  const host = hostKindOf(rv);
  const domDefault = (j.dom || {}).default;
  const anchors = domDefault ? collectAnchors(domDefault) : [];
  const staticMeta = staticSummary && staticSummary.meta ? staticSummary.meta : {};
  const metaOverride = AGENT_META[agent] || {};
  const distributed = metaOverride.distributedVars ?? false;
  // 分布式家族：快照未持久化 __host，直接以权威元信息标注（供文档/脆弱性判定）
  const effectiveHostKind =
    host ||
    (distributed
      ? { kind: 'aggregated-inline-or-rules', n: Object.keys(rv.default || {}).length }
      : null);

  return {
    agent,
    family:
      staticMeta.family || metaOverride.family || familyOf(frame.securityOrigin, frame.url, agent),
    distributedVars: distributed,
    sweepOverride: !!metaOverride.family,
    staticAppVersion: staticMeta.appVersion || null,
    staticSource: staticMeta.appPath || staticMeta.sources?.[0] || null,
    extractedAt: meta.extractedAt || null,
    port: meta.port ?? null,
    wsDebugUrl: meta.wsDebugUrl || null,
    frame: { url: frame.url, securityOrigin: frame.securityOrigin, frameId: frame.frameId },
    dataQuality: {
      totalNodes: dq.totalNodes || null,
      corsBlockedSheets: dq.corsBlockedSheets ?? null,
      failedSchemes: dq.failedSchemes || [],
      truncated: dq.truncated || null,
      multiFrame: dq.multiFrame ?? null,
      iframeCount: dq.iframeCount ?? null,
      apiNative: Object.entries(dq.apiFingerprint || {})
        .filter(([, v]) => typeof v === 'object')
        .every(([, v]) => v.native !== false),
    },
    stats: {
      rootVars: stats.rootVars || null,
      domNodes: stats.domNodes || null,
      styleVars: stats.styleVars || null,
    },
    rootVariables: {
      perScheme: Object.fromEntries(
        ['default', 'dark', 'light'].map((s) => [
          s,
          {
            count: Object.keys(rv[s] || {}).filter((k) => k !== '__host').length,
            namespaces: namespaceCounts(rv[s]),
          },
        ]),
      ),
      hostKind: effectiveHostKind,
    },
    stylesheets: {
      count: (j.stylesheets || {}).count ?? null,
      corsErrors: ((j.stylesheets || {}).sheets || []).filter((s) => s.hasError).length,
    },
    anchors: { count: anchors.length, sample: anchors.slice(0, 40) },
    domNodeCount: domNodeCount(domDefault),
  };
}

function mdAnchors(anchors) {
  if (anchors.length === 0) return '_（本次 DOM 无稳定 id/class 锚点，可能为空态或惰性渲染）_';
  return anchors.map((a) => `- \`${a}\``).join('\n');
}

function mdNamespaces(ns) {
  if (!ns || ns.length === 0) return '_（无变量）_';
  return ns.map(([k, v]) => `\`--${k}-*\` ×${v}`).join('、');
}

function escapeParen(s) {
  return String(s ?? '').replace(/[()]/g, (c) => (c === '(' ? '\\(' : '\\)'));
}

function renderSummaryMd(f) {
  const L = [];
  L.push(`# Extract Summary — ${f.agent}`);
  L.push('');
  L.push(`- **family**: ${f.family}`);
  L.push(`- **extractedAt**: ${f.extractedAt}`);
  if (f.staticAppVersion) L.push(`- **appVersion(asar)**: ${f.staticAppVersion}`);
  if (f.staticSource) L.push(`- **source**: \`${f.staticSource}\``);
  L.push(`- **port**: ${f.port ?? '(auto-discovered)'}`);
  L.push('');
  L.push('## Frame');
  L.push('');
  L.push(`- **url**: \`${escapeParen(f.frame.url)}\``);
  L.push(`- **securityOrigin**: \`${f.frame.securityOrigin}\``);
  L.push(`- **frameId**: \`${f.frame.frameId}\``);
  L.push('');
  L.push('## Data Quality');
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|------|----|');
  L.push(`| totalNodes | ${JSON.stringify(f.dataQuality.totalNodes)} |`);
  L.push(`| corsBlockedSheets | ${f.dataQuality.corsBlockedSheets} |`);
  L.push(`| failedSchemes | ${f.dataQuality.failedSchemes.join(', ') || '_无_'} |`);
  L.push(`| truncated | ${JSON.stringify(f.dataQuality.truncated)} |`);
  L.push(`| multiFrame / iframes | ${f.dataQuality.multiFrame} / ${f.dataQuality.iframeCount} |`);
  L.push(`| apiStillNative | ${f.dataQuality.apiNative} |`);
  L.push('');
  L.push('## Stats');
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|------|----|');
  L.push(`| rootVars | ${JSON.stringify(f.stats.rootVars)} |`);
  L.push(`| domNodes | ${JSON.stringify(f.stats.domNodes)} |`);
  L.push(`| styleVars | ${JSON.stringify(f.stats.styleVars)} |`);
  L.push(`| stylesheets / corsErr | ${f.stylesheets.count} / ${f.stylesheets.corsErrors} |`);
  L.push('');
  L.push('## rootVariables 命名空间（每 scheme）');
  L.push('');
  for (const scheme of ['default', 'dark', 'light']) {
    const p = f.rootVariables.perScheme[scheme];
    L.push(`### ${scheme}（${p.count}）`);
    L.push('');
    L.push(mdNamespaces(p.namespaces));
    L.push('');
  }
  L.push('## rootVariables 来源形态（__host）');
  L.push('');
  L.push(
    f.rootVariables.hostKind
      ? `**${f.rootVariables.hostKind.kind}**（${f.rootVariables.hostKind.n} 变量）`
      : '_（无 `__host` 标注，走原生 `:root` 快路径）_',
  );
  L.push('');
  L.push('## 语义锚点（stable id / class，非 hash）');
  L.push('');
  L.push(mdAnchors(f.anchors.sample));
  L.push('');
  return L.join('\n');
}

function renderArchitectureMd(f) {
  const L = [];
  L.push('# ${f.agent} 架构文档 (AgentSkin)'.replace('${f.agent}', f.agent));
  L.push('');
  L.push('> 逆向理解产物。基于 CDP 全量快照（`cdp-full-extract`）动态提取，未写回任何原应用文件。');
  L.push(`> 动态布局来源：\`agents-raw-data/${f.agent}-full-extract.json\`；`);
  if (f.staticSource) {
    L.push('> 静态 asar 层：`raw/extract-summary.json`（来源 `extract-asar-summary.mjs`）。');
  } else {
    L.push('> 静态 asar 层：_暂无解包汇总_（可跑 `extract-asar-summary.mjs` 后合并）。');
  }
  L.push('> 目标：支撑深度主题注入 / 脆弱性分级 / 语义锚点维护。');
  L.push('');
  L.push('## 1. 包身份（CDP 运行时侧）');
  L.push('');
  L.push('| 项 | 值 |');
  L.push('|----|----|');
  L.push(`| agent | \`${f.agent}\` |`);
  L.push(`| family | ${f.family} |`);
  L.push(`| 渲染 URL | \`${escapeParen(f.frame.url)}\` |`);
  L.push(`| securityOrigin | \`${f.frame.securityOrigin}\` |`);
  L.push(`| frameId | \`${f.frame.frameId}\` |`);
  L.push(`| 快照时间 | ${f.extractedAt} |`);
  if (f.staticAppVersion) L.push(`| asar 版本 | ${f.staticAppVersion} |`);
  if (f.staticSource) L.push(`| asar 来源 | \`${f.staticSource}\` |`);
  L.push('');
  L.push('> 说明：目前无完整静态解包汇总，本节主要反映 CDP 运行时可见的渲染面身份。');
  L.push('> 完整进程模型 / 打包拓扑需补 `extract-asar-summary.mjs` 后回填。');
  L.push('');
  L.push('## 2. 渲染面与安全上下文');
  L.push('');
  L.push(`- **scheme**：\`${f.frame.securityOrigin}\`（决定 CDP 暴露面与 CSP 特征）。`);
  L.push(
    `- **frame**：主 renderer 单 frame，${f.dataQuality.multiFrame ? `${f.dataQuality.iframeCount} 个 iframe 聚合` : '无多 frame 标记'}。`,
  );
  L.push(`- **DOM 规模**：${JSON.stringify(f.dataQuality.totalNodes)}（dataQuality.totalNodes）。`);
  L.push(`- **DOM 树实际可遍历节点**：${f.domNodeCount}（dom.default 递归计数）。`);
  L.push(
    `- **stylesheets**：${f.stylesheets.count} 张，CORS 错误 ${f.stylesheets.corsErrors} 张。`,
  );
  L.push(
    `- **API 污染检测**：核心探测 API（querySelectorAll/getComputedStyle/matchMedia/getPropertyValue）${f.dataQuality.apiNative ? '仍为原生' : '被污染'}。`,
  );
  L.push('');
  L.push('> 注入可行性先决：无 CORS 阻断、DOM 未截断、API 未被覆盖，CDP 动态注入才可信。');
  L.push('');
  L.push('## 3. 变量体系（rootVariables + styleVars）');
  L.push('');
  L.push('| scheme | rootVariable 数量 | 主要命名空间 |');
  L.push('|--------|------------------|--------------|');
  for (const scheme of ['default', 'dark', 'light']) {
    const p = f.rootVariables.perScheme[scheme];
    L.push(`| ${scheme} | ${p.count} | ${mdNamespaces(p.namespaces)} |`);
  }
  L.push('');
  L.push('### 变量来源形态');
  L.push('');
  if (f.rootVariables.hostKind) {
    L.push(
      `根据 \`__host\` 标注，变量为 **${f.rootVariables.hostKind.kind}**（聚合 ${f.rootVariables.hostKind.n} 个）。`,
    );
    L.push(
      '> 提示：`aggregated-inline-or-rules` 或 `merged-root-plus-distributed` 表示变量分散在组件 inline style 与样式表规则中（典型如 VS Code 家族 WorkBuddy/QoderWork）。',
    );
    L.push(
      '> 这类应用 `rootVars` 必须走 `cdp-full-extract.getRootComputedVariables` 的聚合策略，仅读 `documentElement` 会误判为 0。',
    );
  } else {
    L.push(
      '`rootVariables` 未带 `__host` 标注，走原生 `:root` 快路径（变量集中在设计系统 token 上）。',
    );
  }
  L.push('');
  const sv = f.stats.styleVars;
  if (sv) L.push(`- **styleVars**（scheme 分布）：${JSON.stringify(sv)}。`);
  L.push('');
  L.push('## 4. DOM 与语义锚点');
  L.push('');
  L.push(`- **domNodes**：${JSON.stringify(f.stats.domNodes)}。`);
  L.push(`- **稳定锚点**（stable id + 非 hash class）：共 ${f.anchors.count} 个，样例：`);
  L.push('');
  L.push(mdAnchors(f.anchors.sample));
  L.push('');
  L.push(
    '> 锚点采集规则：过滤 css-module hash（`_pk7td_1`）、噪声类（`__as_*`）、单/双字符工具类。',
  );
  L.push('> 升级后使用 `scripts/snapshot-compare.mjs` diff 语义锚点新增/消失。');
  L.push('');
  L.push('## 5. 注入面与脆弱性提示');
  L.push('');
  L.push(`- **安全上下文**：\`${f.frame.securityOrigin}\`。`);
  L.push(
    `- **多 frame / OOPIF**：${f.dataQuality.multiFrame ? '是，注意跨 target 聚合' : '否，单 target 即可覆盖'}。`,
  );
  L.push(`- **DOM 截断**：${JSON.stringify(f.dataQuality.truncated)}。`);
  L.push('- **应用到注入的对象形态**：详见 `fragility.md`。');
  L.push('');
  L.push('## 6. raw/ 快照与升级 diff');
  L.push('');
  L.push('```bash');
  L.push(`cd ${ROOT}`);
  L.push(
    `node scripts/cdp-full-extract.mjs --agent ${f.agent}   # 生成新版 agents-raw-data/${f.agent}-full-extract.json`,
  );
  L.push(`node scripts/gen-agent-arch-docs.mjs --only ${f.agent}  # 重新生成 raw/ 快照与文档`);
  L.push(
    `node scripts/snapshot-compare.mjs agents-raw-data/${f.agent}-full-extract.json agents-raw-data/${f.agent}-full-extract.json --out docs/apps/${f.agent}/raw/upgrade-diff.md`,
  );
  L.push('```');
  L.push('');
  return L.join('\n');
}

function renderFragilityMd(f) {
  const distributed = f.distributedVars;
  const L = [];
  L.push(`# ${f.agent} 脆弱性分级（sdk-fragility）`);
  L.push('');
  L.push('> 与 [architecture.md](./architecture.md) 配套。依赖点按[升级崩溃概率]分级；');
  L.push(`> 动态层数据来自 \`agents-raw-data/${f.agent}-full-extract.json\`（CDP 全量快照）。`);
  L.push('');
  L.push('## 1. 依赖点分级');
  L.push('');
  L.push('| 等级 | 依赖点 | 崩溃概率 | 说明 |');
  L.push('|------|--------|---------|------|');
  L.push(
    `| Low | \`${f.frame.securityOrigin}\` 渲染面身份 | Unlikely | scheme 稳定，决定 CDP 暴露面 |`,
  );
  if (distributed) {
    L.push(
      '| Medium | 变量聚合策略（inline style + 样式表 :root/body） | Sometimes | VS Code 家族分布式变量，结构会演化 |',
    );
    L.push(
      '| Medium | `rootVars` 计算的 `__host` 形态 | Sometimes | `aggregated-inline-or-rules` 依赖组件 inline style 分布 |',
    );
    L.push('| Medium | 变量命名空间分布 | Sometimes | 变量前缀及声明位置随版本变 |');
  } else {
    L.push('| Low | 原生 `:root` 变量（命名空间） | Unlikely | 设计系统 token，集中声明 |');
    L.push('| Low | 变量来源走原生快路径 | Unlikely | `documentElement` 计算即可覆盖 |');
  }
  L.push('| High | 非 hash class 语义选择器 | Very likely | 非公开 API，随组件重构变化 |');
  L.push('| High | 组件 DOM 结构（div 层级） | Very likely | 布局重构即崩 |');
  L.push('| Medium | DOM 树节点数 / 锚点集合 | Sometimes | 惰性渲染与空态影响采集 |');
  if (f.dataQuality.corsBlockedSheets > 0 || f.dataQuality.truncated?.default) {
    L.push('| High | 本次快照数据质量 | Often | CORS 阻断或 DOM 截断 → 锚点/变量不可信 |');
  }
  L.push('');
  L.push('## 2. 反模式与铁律');
  L.push('');
  L.push('- ❌ 不依赖 minified JS 变量名 / hash css-module class（`_pk7td_1`）——每次构建都变。');
  L.push('- ✅ 可依赖字符串字面量：`data-*`、稳定的 `id`、命名空间变量前缀。');
  L.push('- ⚠️ 谨慎依赖运行时对象结构（fiber walk 发现）——名字不变但 shape 会变。');
  if (distributed) {
    L.push('- ⚠️ 分布式变量：采集必须聚合 inline style + 样式表规则，禁止只读 `documentElement`。');
  }
  L.push('');
  L.push('## 3. 升级检查清单');
  L.push('');
  L.push(`- [ ] 重新跑 CDP 全量快照：\`node scripts/cdp-full-extract.mjs --agent ${f.agent}\``);
  L.push(
    `- [ ] 与上一版 diff：\`node scripts/snapshot-compare.mjs <旧> <新> --out docs/apps/${f.agent}/raw/upgrade-diff.md\``,
  );
  L.push('- [ ] 检查变量命名空间是否消失/改名（尤其默认 scheme）。');
  L.push('- [ ] 检查语义锚点新增/消失（stable id / class）。');
  L.push('- [ ] 若为分布式变量家族，确认 `rootVars` 聚合策略仍命中（非 0）。');
  L.push('- [ ] 跑 E2E 注入验证，确认主题注入生效且内部控件无意外命中。');
  L.push('- [ ] 更新本文件与 architecture.md 的快照时间/版本行。');
  L.push('');
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const force = args.includes('--force');
  const agents = only ? [only] : AGENTS;

  let ok = true;
  for (const agent of agents) {
    const jpath = join(RAW_DIR, `${agent}-full-extract.json`);
    if (!existsSync(jpath)) {
      console.error(`x 缺快照: ${jpath}`);
      ok = false;
      continue;
    }
    const j = readJson(jpath);

    // 静态 asar 层汇总（始终保留，不被本脚本覆盖）
    const staticPath = join(DOCS_DIR, agent, 'raw', 'extract-summary.json');
    const staticSummary = existsSync(staticPath) ? readJson(staticPath) : null;

    const facts = buildFacts(agent, j, staticSummary);
    const outDir = join(DOCS_DIR, agent, 'raw');
    mkdirSync(outDir, { recursive: true });

    // 动态 CDP 层快照：cdp-summary.*（与静态 extract-summary.* 分离）
    writeFileSync(join(outDir, 'cdp-summary.json'), JSON.stringify(facts, null, 2) + '\n');
    writeFileSync(join(outDir, 'cdp-summary.md'), renderSummaryMd(facts) + '\n');
    writeFileSync(join(DOCS_DIR, agent, 'fragility.md'), renderFragilityMd(facts) + '\n');

    // architecture.md 仅当缺失或 --force 时写，避免覆盖人工精修的文档（如 codex）
    const archPath = join(DOCS_DIR, agent, 'architecture.md');
    if (force || !existsSync(archPath)) {
      writeFileSync(archPath, renderArchitectureMd(facts) + '\n');
    } else {
      console.log(`  (保留已有 ${agent}/architecture.md，用 --force 覆盖)`);
    }

    console.log(
      `ok ${agent}: family=${facts.family} rootVars=${JSON.stringify(facts.stats.rootVars)} anchors=${facts.anchors.count} host=${facts.rootVariables.hostKind?.kind ?? 'native'}`,
    );
  }
  if (!ok) process.exit(1);
}

main();
