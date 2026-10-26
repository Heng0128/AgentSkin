// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — CDP 运行时探测
 *
 * 通过 CDP 采集 Agent 运行时的 DOM 类名清单、:root CSS 变量、适配器 landmark 命中、
 * bridge 变量可达性、样式 AST、Shadow DOM、Target 枚举等。
 */

import { CdpClient } from '../../src/engine/src/cdp/session.mjs';
import { enumerateTargets } from '../../src/engine/src/runtime/injector.mjs';
import {
  RUNTIME_CLASS_CAP,
  RUNTIME_VAR_CAP,
  SHADOW_RISK_SELECTORS_BY_AGENT,
  SHADOW_RISK_SELECTORS_COMMON,
} from './constants.mjs';
import { OPTIONS } from './utils.mjs';

// ---------------------------------------------------------------------------
// CDP 表达式构建函数
// ---------------------------------------------------------------------------

/** 构建 DOM 类名清单采集表达式。 */
function buildClassInventoryExpression(cap) {
  return `(() => {
    const counts = new Map();
    const walk = (root) => {
      let nodes;
      try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of nodes) {
        const cls = el.className;
        if (typeof cls !== 'string' || !cls) continue;
        for (const name of cls.split(/\\s+/)) {
          if (!name) continue;
          counts.set(name, (counts.get(name) || 0) + 1);
        }
      }
    };
    walk(document);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, ${cap});
    return JSON.stringify({ unique: counts.size, top });
  })()`;
}

/** 构建 :root CSS 变量采集表达式。 */
function buildVarsExpression(cap) {
  return `(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = [];
    for (let i = 0; i < cs.length && names.length < ${cap}; i++) {
      const name = cs[i];
      if (name.startsWith('--') && !name.startsWith('--agentskin-')) names.push(name);
    }
    return JSON.stringify({ unique: names.length, names });
  })()`;
}

/**
 * bridge 可达性探测（修正诊断口径）：
 * getComputedStyle 的对象索引枚举（cs[i]）不覆盖 adoptedStyleSheets / 动态注入的
 * 自定义属性，导致 analyze 把「实际生效的 bridge 变量」误判为「组件作用域不可达」。
 * 改为对每个 bridge 变量在 document.documentElement 和 document.body 上显式
 * getPropertyValue(name) 寻址——实测对 adopted 注入仍能返回计算值（主题色）。
 * 返回 { root: {var: value}, body: {var: value} }，空串值视为不可达（不入结果）。
 */
function buildBridgeReachExpression(vars) {
  const arr = JSON.stringify(vars);
  return `(() => {
    const vars = ${arr};
    const read = (el) => {
      const s = getComputedStyle(el);
      const o = {};
      for (const v of vars) {
        const val = s.getPropertyValue(v).trim();
        if (val) o[v] = val;
      }
      return o;
    };
    return JSON.stringify({ root: read(document.documentElement), body: read(document.body) });
  })()`;
}

/** 解析某 Agent 实际使用的 closed shadow 风险选择器 = COMMON ∪ 种子 ∪ --shadow-seed 增量（common + 分桶）。 */
function resolveShadowRiskSelectors(adapterId) {
  const seed = OPTIONS.shadowSeed ?? { common: [], byAgent: {} };
  return [
    ...SHADOW_RISK_SELECTORS_COMMON,
    ...(seed.common ?? []),
    ...(SHADOW_RISK_SELECTORS_BY_AGENT[adapterId] ?? []),
    ...(seed.byAgent[adapterId] ?? []),
  ];
}

/**
 * 采集样式表 AST：遍历 `document.styleSheets` + `document.adoptedStyleSheets` 的 cssRules，
 * 提取 `:root`/`:host` 变量**声明原文**与主题相关选择器。补 `getComputedStyle` 看不到的盲区——
 * 大量 React-Radix / shadcn / Tailwind 应用把变量声明在构造样式表（adoptedStyleSheets）里，
 * `document.styleSheets` 根本列不到它们，`getComputedStyle` 又只能拿到最终生效值、拿不到声明结构。
 */
function buildStyleAstExpression() {
  return `(() => {
    const out = { styleSheets: 0, adoptedSheets: 0, cssRules: 0, adoptedCssRules: 0, rootVars: [], adoptedRootVars: [], themeSelectors: [], errors: [] };
    const selSeen = new Set();
    const THEME_RE = /(dark|light|theme|scheme|contrast|color-mode)/i;
    const collect = (rule, into, seen) => {
      let cssText = '';
      let selectorText = '';
      try { cssText = rule.cssText || ''; selectorText = rule.selectorText || ''; } catch (e) { return; }
      if (!cssText) return;
      const isRootRule = rule.type === 1 && (selectorText === ':root' || selectorText === ':host' || selectorText.startsWith(':root') || selectorText.startsWith(':host'));
      if (isRootRule) {
        const decls = cssText.match(/--[A-Za-z0-9_-]+\\s*:[^;}]+/g);
        if (decls) for (const decl of decls) {
          const name = (decl.match(/^(--[A-Za-z0-9_-]+)/) || [])[1];
          if (name && !name.startsWith('--agentskin-') && !seen.has(name)) {
            seen.add(name);
            into.push({ name, value: decl.slice(decl.indexOf(':') + 1).trim().slice(0, 80) });
          }
        }
      }
      if (selectorText && THEME_RE.test(selectorText) && !selSeen.has(selectorText) && out.themeSelectors.length < 200) {
        selSeen.add(selectorText);
        out.themeSelectors.push(selectorText);
      }
    };
    const rootSeen = new Set();
    const adoptedSeen = new Set();
    for (let i = 0; i < document.styleSheets.length; i++) {
      let rules;
      try { rules = document.styleSheets[i].cssRules; } catch (e) { out.errors.push('cssRules:' + (e.name || '')); continue; }
      if (!rules) continue;
      out.styleSheets += 1;
      for (let j = 0; j < rules.length; j++) { out.cssRules += 1; collect(rules[j], out.rootVars, rootSeen); }
    }
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
      for (const ss of document.adoptedStyleSheets) {
        let rules;
        try { rules = ss.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        out.adoptedSheets += 1;
        for (let j = 0; j < rules.length; j++) { out.adoptedCssRules += 1; collect(rules[j], out.adoptedRootVars, adoptedSeen); }
      }
    }
    return JSON.stringify(out);
  })()`;
}

/** 遍历 Shadow DOM：open shadow root 完整采集，closed shadow 通过 rule 已知风险选择器启发式标记。 */
function buildShadowDomExpression(riskSelectors = []) {
  const riskList = JSON.stringify(riskSelectors);
  return `(() => {
    const out = { openHosts: [], openHostCount: 0, totalShadowEls: 0, adoptedInShadow: 0, closedShadowRisk: [] };
    const MAX_HOSTS = 100;
    const MAX_SCAN = 20000;
    let scanned = 0;
    const walk = (root, depth) => {
      if (depth > 3 || out.openHostCount >= MAX_HOSTS) return;
      let nodes;
      try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of nodes) {
        if (++scanned > MAX_SCAN) return;
        const sr = el.shadowRoot;
        if (!sr) continue;
        out.openHostCount += 1;
        const innerEls = sr.querySelectorAll('*').length;
        out.totalShadowEls += innerEls;
        if (sr.adoptedStyleSheets?.length) out.adoptedInShadow += sr.adoptedStyleSheets.length;
        if (out.openHosts.length < MAX_HOSTS) {
          out.openHosts.push({
            tag: el.tagName?.toLowerCase() ?? '',
            cls: (typeof el.className === 'string' && el.className) ? el.className.split(/\\s+/).slice(0, 3) : [],
            depth,
            innerEls,
            styleSheets: sr.styleSheets?.length ?? 0,
            adopted: sr.adoptedStyleSheets?.length ?? 0,
          });
        }
        walk(sr, depth + 1);
      }
    };
    walk(document, 0);
    const risks = ${riskList};
    for (const sel of risks) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (!el.shadowRoot) {
            out.closedShadowRisk.push({ selector: sel, host: el.tagName?.toLowerCase() ?? '', matches: els.length });
            break;
          }
        }
      } catch (e) { /* 非法选择器跳过 */ }
    }
    return JSON.stringify(out);
  })()`;
}

/**
 * 采集 DOM 上下文：documentElement.dataset、localStorage/sessionStorage 键名、
 * meta color-scheme、prefers-color-scheme。只读，零副作用。
 * 隐私约束：storage 仅采集**键名**；仅 theme 相关键（theme/dark/light/scheme/mode/color/appearance）
 * 才读取其值（值通常为 'dark'/'light' 等短字符串，且截断 200 字符），避免泄露 token 等敏感值。
 */
function buildDomContextExpression() {
  return `(() => {
    const out = { dataset: {}, localStorageKeys: [], sessionStorageKeys: [], themeStorage: [], metaColorScheme: null, prefersDark: null, prefersLight: null };
    const de = document.documentElement;
    if (de && de.dataset) for (const k in de.dataset) out.dataset[k] = de.dataset[k];
    const THEME_KEY_RE = /theme|dark|light|scheme|appearance|color-mode/i;
    const dump = (storage, intoKeys) => {
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (!k) continue;
          intoKeys.push(k);
          if (THEME_KEY_RE.test(k)) {
            let v = null;
            try { v = storage.getItem(k); } catch (e) {}
            if (v != null && String(v).length < 200) out.themeStorage.push({ key: k, value: String(v) });
          }
        }
      } catch (e) { /* storage 被禁用/跨域 */ }
    };
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    const ss = (typeof sessionStorage !== 'undefined') ? sessionStorage : null;
    if (ls) dump(ls, out.localStorageKeys);
    if (ss) dump(ss, out.sessionStorageKeys);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) out.metaColorScheme = meta.getAttribute('content') ?? null;
    try {
      out.prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      out.prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch (e) {}
    return JSON.stringify(out);
  })()`;
}

/** 抽样 landmark 节点的 computed 背景/文字色（只读），供 Layer4 元模型自校验判断 dark/light 特征。 */
function buildLandmarkColorExpression(selectors) {
  return `(() => {
    const sels = ${JSON.stringify(selectors)};
    const samples = [];
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        samples.push({ selector: sel, backgroundColor: cs.backgroundColor, color: cs.color });
      } catch (e) {}
    }
    return JSON.stringify(samples);
  })()`;
}

/** 逐条求值 verification 选择器：是否命中（含是否可见）。 */
function buildLandmarkExpression(selectors) {
  const list = JSON.stringify(selectors);
  return `(() => {
    const selectors = ${list};
    const visible = (node) => {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const out = [];
    for (const sel of selectors) {
      let nodes = [];
      let error = null;
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch (e) { error = String(e?.message ?? e); }
      const matched = nodes.filter(visible);
      out.push({ selector: sel, matches: nodes.length, visible: matched.length, error });
    }
    return JSON.stringify(out);
  })()`;
}

// ---------------------------------------------------------------------------
// CDP 求值与探测
// ---------------------------------------------------------------------------

async function evaluateJson(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    timeout: 12000,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'Runtime.evaluate exception');
  return result.value;
}

/**
 * 探测单个 Agent 的运行时结构。
 * 返回 { ok, port, classInventory, rootVars, bridgeReach, styleAst, shadowDom, domContext, landmarkChecks, landmarkColors, targetEnumeration }。
 */
export async function probeRuntime(adapter, target) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send('Runtime.enable').catch(() => {});
    const classInventory = JSON.parse(
      await evaluateJson(client, buildClassInventoryExpression(RUNTIME_CLASS_CAP)),
    );
    const rootVars = JSON.parse(await evaluateJson(client, buildVarsExpression(RUNTIME_VAR_CAP)));
    const bridgeReach = await evaluateJson(
      client,
      buildBridgeReachExpression((adapter.bridge ?? []).map((e) => e.var)),
    )
      .then((v) => JSON.parse(v))
      .catch(() => ({ root: {}, body: {} }));

    const styleAst = await evaluateJson(client, buildStyleAstExpression())
      .then((v) => JSON.parse(v))
      .catch((e) => ({ error: e.message }));
    const shadowSeeds = resolveShadowRiskSelectors(adapter.id);
    const shadowDom = await evaluateJson(client, buildShadowDomExpression(shadowSeeds))
      .then((v) => JSON.parse(v))
      .catch((e) => ({ error: e.message }));
    const domContext = await evaluateJson(client, buildDomContextExpression())
      .then((v) => JSON.parse(v))
      .catch((e) => ({ error: e.message }));

    const landmarkChecks = [];
    const verification = adapter.verification ?? { rootAny: ['body'], recommended: [] };
    const landmarkSelectors = [];
    for (const sel of verification.rootAny ?? []) landmarkSelectors.push({ name: 'root', sel });
    for (const item of verification.recommended ?? []) {
      for (const sel of item.any ?? []) landmarkSelectors.push({ name: item.name, sel });
    }
    for (const { name, sel } of landmarkSelectors) {
      const results = JSON.parse(await evaluateJson(client, buildLandmarkExpression([sel])));
      const hit = results[0];
      landmarkChecks.push({
        scope: name,
        selector: sel,
        matches: hit.matches,
        visible: hit.visible,
        error: hit.error ?? null,
      });
    }
    const landmarkColors = await evaluateJson(
      client,
      buildLandmarkColorExpression(landmarkSelectors.map(({ sel }) => sel)),
    )
      .then((v) => JSON.parse(v))
      .catch(() => []);
    const targetEnumeration = await enumerateTargets(target.port);
    return {
      ok: true,
      port: target.port,
      title: target.title ?? null,
      classInventory,
      rootVars,
      bridgeReach,
      styleAst,
      shadowDom,
      shadowSeeds,
      domContext,
      landmarkColors,
      targetEnumeration,
      landmarkChecks,
    };
  } finally {
    client.close();
  }
}
