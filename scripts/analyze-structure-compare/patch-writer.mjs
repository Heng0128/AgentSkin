// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 补丁自动写回
 *
 * 将「确定性删除」类建议直接落到适配器源码。
 * 通过括号平衡扫描 + 顶层逗号切分，把死 landmark 选择器 / 失效 bridge entry
 * 从 verification.rootAny / recommended.<scope>.any / bridge 数组中精确移除，
 * 保持源码结构合法（不破坏其它元素）。仅支持确定性删除；
 * switch_to_component_injection 需设计决策（组件级注入实现），保持人工落地。
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** 括号平衡扫描：从 openIndex（指向 '[' 或 '{'）返回 {start,end}，找不到返回 null。 */
function balancedSpan(src, openIndex, close) {
  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && ch === close) return { start: openIndex, end: i + 1 };
    }
  }
  return null;
}

function arraySpan(src, openIndex) {
  return balancedSpan(src, openIndex, ']');
}

function objectSpan(src, openIndex) {
  return balancedSpan(src, openIndex, '}');
}

/** 返回 region（数组内层区间）中所有顶层逗号位置。 */
function topLevelCommas(src, region) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  for (let i = region.start; i < region.end; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) out.push(i);
  }
  return out;
}

/** 顶层逗号切分：返回 region 内每个直接子元素（不含空元素）的 {start,end}。 */
function splitTopLevelElements(src, region) {
  const commas = topLevelCommas(src, region);
  const els = [];
  let start = region.start;
  for (const c of commas) {
    els.push({ start, end: c });
    start = c + 1;
  }
  els.push({ start, end: region.end });
  return els.filter((el) => src.slice(el.start, el.end).trim().length > 0);
}

/** 从 region 中删除元素 el（连同其尾随分隔逗号），返回新源码。 */
function removeElementAt(src, region, el) {
  const commas = topLevelCommas(src, region);
  const trailing = commas.find((c) => c === el.end);
  if (trailing !== undefined) return src.slice(0, el.start) + src.slice(trailing + 1);
  const before = [...commas].reverse().find((c) => c < el.start);
  const start = before ?? el.start;
  return src.slice(0, start) + src.slice(el.end);
}

/** 查找 src 的 [from,to) 内 `key:` 后的数组区间，返回绝对 {start,end}。 */
function findKeyedArray(src, key, from = 0, to = src.length) {
  const slice = src.slice(from, to);
  const re = new RegExp(`\\b${key}\\s*:\\s*(\\[)`);
  const m = re.exec(slice);
  if (!m) return null;
  const openRel = m.index + m[0].length - 1;
  const span = arraySpan(slice, openRel);
  if (!span) return null;
  return { start: from + span.start, end: from + span.end };
}

/** 在 recommended 数组内查找 `name` 等于 name 的直接子对象区间。 */
function findNamedObject(src, rec, name) {
  const inner = { start: rec.start + 1, end: rec.end - 1 };
  for (const el of splitTopLevelElements(src, inner)) {
    if (!src.slice(el.start, el.end).trim().startsWith('{')) continue;
    const obj = objectSpan(src, el.start);
    if (!obj) continue;
    const m = /\bname\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(
      src.slice(obj.start, obj.end),
    );
    if (!m) continue;
    const quote = m[1][0];
    const val = m[1].slice(1, -1).replace(quote === '"' ? /\\"/g : /\\'/g, quote);
    if (val === name) return obj;
  }
  return null;
}

/** 在数组 arr 内按 test(元素文本) 找到并删除元素；找不到返回 changed:false。 */
function removeElementByTest(src, arr, test, desc) {
  const inner = { start: arr.start + 1, end: arr.end - 1 };
  const el = splitTopLevelElements(src, inner).find((e) => test(src.slice(e.start, e.end)));
  if (!el) return { changed: false, reason: `未找到目标元素（${desc}）` };
  const next = removeElementAt(src, inner, el);
  if (next === src) return { changed: false, reason: `移除无变化（${desc}）` };
  return { changed: true, src: next, element: src.slice(el.start, el.end).trim() };
}

/** 对单个 patch action 执行精确删除，返回 { changed, src?, element?, reason? }。 */
function removePatch(src, action) {
  if (action.type === 'remove_verification_selector') {
    const target = action.patch?.current ?? action.target;
    if (typeof target !== 'string') return { changed: false, reason: '选择器非字符串' };
    const quoted = JSON.stringify(target);
    if (action.scope === 'root') {
      const arr = findKeyedArray(src, 'rootAny');
      if (!arr) return { changed: false, reason: 'verification.rootAny 数组未找到' };
      return removeElementByTest(src, arr, (t) => t.trim() === quoted, `rootAny 移除 ${target}`);
    }
    const rec = findKeyedArray(src, 'recommended');
    if (!rec) return { changed: false, reason: 'verification.recommended 数组未找到' };
    const obj = findNamedObject(src, rec, action.scope);
    if (!obj) return { changed: false, reason: `recommended 内未找到 ${action.scope} 域` };
    const any = findKeyedArray(src, 'any', obj.start, obj.end);
    if (!any) return { changed: false, reason: `${action.scope}.any 数组未找到` };
    return removeElementByTest(
      src,
      any,
      (t) => t.trim() === quoted,
      `${action.scope}.any 移除 ${target}`,
    );
  }
  if (action.type === 'remove_bridge_entry') {
    const arr = findKeyedArray(src, 'bridge');
    if (!arr) return { changed: false, reason: 'bridge 数组未找到' };
    const marker = `var: ${JSON.stringify(action.var)}`;
    return removeElementByTest(src, arr, (t) => t.includes(marker), `bridge 移除 ${action.var}`);
  }
  return { changed: false, reason: '非自动落地类型（需人工决策）' };
}

/**
 * 批量执行补丁写回。仅落地确定性删除类建议；
 * 返回按文件汇总的结果（含未命中原因与 dry-run 标记），不抛出异常。
 */
export function applyPatchActions(actions, { dryRun = false } = {}) {
  const byFile = new Map();
  for (const a of actions) {
    if (a.type !== 'remove_verification_selector' && a.type !== 'remove_bridge_entry') continue;
    if (!a.sourceFile) continue;
    if (!byFile.has(a.sourceFile)) byFile.set(a.sourceFile, []);
    byFile.get(a.sourceFile).push(a);
  }
  const results = [];
  for (const [file, list] of byFile) {
    let src;
    try {
      src = readFileSync(file, 'utf-8');
    } catch (e) {
      results.push({
        file,
        error: String(e.message ?? e),
        applied: 0,
        missed: list.length,
        skipped: 0,
      });
      continue;
    }
    const applied = [];
    const missed = [];
    let modified = src;
    for (const a of list) {
      const res = removePatch(modified, a);
      if (res.changed) {
        modified = res.src;
        applied.push({
          type: a.type,
          target: a.target ?? a.var,
          scope: a.scope,
          location: a.patch?.location,
          element: res.element,
        });
      } else {
        missed.push({
          type: a.type,
          target: a.target ?? a.var,
          scope: a.scope,
          location: a.patch?.location,
          reason: res.reason,
        });
      }
    }
    const wrote = modified !== src && !dryRun;
    if (wrote) writeFileSync(file, modified, 'utf-8');
    results.push({
      file,
      dryRun,
      wrote,
      appliedCount: applied.length,
      missedCount: missed.length,
      applied,
      missed,
    });
  }
  return results;
}
