// SPDX-License-Identifier: MPL-2.0
/**
 * CDP 快照 diff —— 版本升级后的锚点变化监控（explodex `cdp-layout-snapshot` 思路的落地版）。
 *
 * 输入两份 `-full-extract.json`（同一 Agent 的旧/新快照），输出 markdown diff：
 *  - meta / dataQuality（CORS 阻断、api 污染、DOM 截断、切换失败 scheme）
 *  - rootVariables 命名空间与变量集合（新增 / 消失 / 取值变化）
 *  - stylesheets 计数与 CORS 错误
 *  - stats（rootVars / domNodes / styleVars）
 *  - 语义锚点（DOM 树中的 stable id + 非 hash class token）新增 / 消失
 *
 * 用法：
 *   node scripts/snapshot-compare.mjs <old.json> <new.json>
 *   node scripts/snapshot-compare.mjs <old.json> <new.json> --out compare-report.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// DOM 树节点形态：{ t:tag, c:class, i:id, s:inlineStyle, ch:children }
const HASH_CLASS_RE = /^[_a-z]{1,2}[A-Za-z0-9_]*_\d+$/; // css-module hash（_pk7td_1）
const NOISE_CLASS_RE = /^__as_|^agent-ui-theme$/; // 我们注入/临时类，不计锚点

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

/** 取 rootVariables 三态对象：{default:{},dark:{},light:{}} */
function rootVarsOf(j) {
  const rv = j.rootVariables || {};
  return { default: rv.default || {}, dark: rv.dark || {}, light: rv.light || {} };
}

/** 变量命名空间统计：'--cb-*' -> 'cb'，'--:root...' 归类 '<none>' */
function namespaceCounts(varsObj) {
  const m = new Map();
  for (const key of Object.keys(varsObj)) {
    const body = key.replace(/^--/, '');
    const ns = body.includes('-') ? body.slice(0, body.indexOf('-')) : 'none';
    m.set(ns, (m.get(ns) || 0) + 1);
  }
  // 排序后返回
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** 三态变量集合 diff（key 集合）：used/added/removed/changed */
function diffVars(oldVars, newVars, scheme) {
  const o = oldVars || {};
  const n = newVars || {};
  const added = Object.keys(n).filter((k) => !(k in o));
  const removed = Object.keys(o).filter((k) => !(k in n));
  const changed = Object.keys(n).filter((k) => k in o && o[k] !== n[k]);
  const used = Object.keys(n).length;
  return { scheme, used, added, removed, changed };
}

/** 收集稳态语义锚点：stable id + 非 hash class token（去重） */
function collectAnchors(root) {
  const set = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.i === 'string' && node.i.length > 0) set.add(`id:${node.i}`);
    if (typeof node.c === 'string') {
      for (const cls of node.c.split(/\s+/).filter(Boolean)) {
        if (HASH_CLASS_RE.test(cls) || NOISE_CLASS_RE.test(cls)) continue;
        if (cls.length <= 2) continue; // 单/双字符 class 多为工具类，噪声
        set.add(`.${cls}`);
      }
    }
    const ch = node.ch;
    if (Array.isArray(ch)) {
      for (const c of ch) walk(c);
    }
  };
  if (root && typeof root === 'object') walk(root);
  return set;
}

function diffAnchors(oldRoot, newRoot) {
  const o = collectAnchors(oldRoot);
  const n = collectAnchors(newRoot);
  const added = [...n].filter((a) => !o.has(a));
  const removed = [...o].filter((a) => !n.has(a));
  return { added: added.sort(), removed: removed.sort() };
}

function fmtList(arr, limit = 12) {
  if (arr.length === 0) return '_（无）_';
  const head = arr.slice(0, limit).join('` `');
  const extra = arr.length > limit ? ` 等 ${arr.length} 项` : '';
  return '`' + head + '`' + extra;
}

function fmtKvLines(schemes) {
  const { used, added, removed, changed, scheme } = schemes;
  const lines = [];
  lines.push(
    `- **${scheme}**：使用 ${used} | 新增 ${added.length} | 消失 ${removed.length} | 取值变化 ${changed.length}`,
  );
  if (added.length) lines.push(`  - 新增：${fmtList(added)}`);
  if (removed.length) lines.push(`  - 消失：${fmtList(removed)}`);
  if (changed.length) lines.push(`  - 取值变化：${fmtList(changed)}`);
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      '用法: node scripts/snapshot-compare.mjs <old-full-extract.json> <new-full-extract.json> [--out report.md]',
    );
    process.exit(1);
  }
  const oldPath = args[0];
  const newPath = args[1];
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  const oldJ = readJson(oldPath);
  const newJ = readJson(newPath);

  const oldMeta = oldJ.meta || {};
  const newMeta = newJ.meta || {};
  const oldDQ = oldMeta.dataQuality || {};
  const newDQ = newMeta.dataQuality || {};

  const report = [];
  report.push(
    `# 快照 diff：${newMeta.agent || oldMeta.agent || 'unknown'} (${newMeta.agent || '?'})`,
  );
  report.push('');
  report.push(`| 项 | 旧 | 新 |`);
  report.push(`|----|----|----|`);
  report.push(`| extractedAt | ${oldMeta.extractedAt || '?'} | ${newMeta.extractedAt || '?'} |`);
  report.push(`| CDP port | ${oldMeta.port ?? '?'} | ${newMeta.port ?? '?'} |`);
  report.push('');

  report.push('## 1. 数据质量（dataQuality）');
  report.push('| 指标 | 旧 | 新 |');
  report.push('|------|----|----|');
  for (const k of [
    'totalNodes',
    'corsBlockedSheets',
    'apiPolluted',
    'truncated',
    'failedSchemes',
  ]) {
    const ov = JSON.stringify(oldDQ[k]);
    const nv = JSON.stringify(newDQ[k]);
    const flag = JSON.stringify(oldDQ[k]) !== JSON.stringify(newDQ[k]) ? ' ◀︎ 变化' : '';
    report.push(`| ${k} | ${ov} | ${nv}${flag} |`);
  }
  report.push('');

  const oldRoot = rootVarsOf(oldJ);
  const newRoot = rootVarsOf(newJ);

  report.push('## 2. rootVariables 命名空间分布（default）');
  const oldNS = namespaceCounts(oldRoot.default);
  const newNS = new Map(namespaceCounts(newRoot.default));
  const union = new Set([...oldNS.map(([ns]) => ns), ...newNS.keys()]);
  report.push('| namespace | 旧 | 新 |');
  report.push('|-----------|----|----|');
  for (const ns of union) {
    const o = oldNS.find(([x]) => x === ns);
    const v = newNS.get(ns);
    const flag = (o ? o[1] : 0) !== (v ?? 0) ? ' ◀︎' : '';
    report.push(`| \`--${ns}-*\` | ${o ? o[1] : 0} | ${v ?? 0}${flag} |`);
  }
  report.push('');

  report.push('## 3. 变量集合 diff');
  for (const scheme of ['default', 'dark', 'light']) {
    report.push(fmtKvLines(diffVars(oldRoot[scheme], newRoot[scheme], scheme)));
  }
  report.push('');

  const oldSs = oldJ.stylesheets || {};
  const newSs = newJ.stylesheets || {};
  report.push('## 4. stylesheets');
  report.push(`| 指标 | 旧 | 新 |`);
  report.push(`|------|----|----|`);
  report.push(
    `| count | ${oldSs.count ?? '?'} | ${newSs.count ?? '?'}${oldSs.count !== newSs.count ? ' ◀︎' : ''} |`,
  );
  const ocors = (oldSs.sheets || []).filter((s) => s.hasError).length;
  const ncors = (newSs.sheets || []).filter((s) => s.hasError).length;
  report.push(`| sheet with error | ${ocors} | ${ncors}${ocors !== ncors ? ' ◀︎' : ''} |`);
  report.push('');

  const oldSt = oldJ.stats || {};
  const newSt = newJ.stats || {};
  report.push('## 5. stats');
  report.push('| 指标 | 旧 | 新 |');
  report.push('|------|----|----|');
  for (const k of ['rootVars', 'domNodes', 'styleVars']) {
    const ov = JSON.stringify(oldSt[k]);
    const nv = JSON.stringify(newSt[k]);
    const flag = ov !== nv ? ' ◀︎' : '';
    report.push(`| ${k} | ${ov} | ${nv}${flag} |`);
  }
  report.push('');

  const oldDom = (oldJ.dom || {}).default;
  const newDom = (newJ.dom || {}).default;
  const anchors = diffAnchors(oldDom, newDom);
  report.push('## 6. 语义锚点（stable id + class）');
  report.push(`- 新增 ${anchors.added.length} 项：`);
  report.push(`  ${fmtList(anchors.added, 20)}`);
  report.push(`- 消失 ${anchors.removed.length} 项（回到老版本则恢复）：`);
  report.push(`  ${fmtList(anchors.removed, 20)}`);
  report.push('');

  const md = report.join('\n');
  if (outPath) {
    writeFileSync(resolve(outPath), md);
    console.log(`已写入 ${outPath}`);
  } else {
    console.log(md);
  }
}

main();
