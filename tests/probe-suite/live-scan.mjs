// SPDX-License-Identifier: MPL-2.0

/**
 * live-scan.mjs — 现行 CDP 探究（只读快照）
 *
 * 对 6 个 Agent 逐一连接（不做任何主题切换/写入），采集三方面「现状」：
 * 1. token 理解：`:root` 实际 CSS 变量命名空间 + 样例，用于核对 A-17 白名单
 * 2. DOM 结构：标签/类/ID 分布、语义 landmark、open shadow root 计数
 * 3. CSS 样式：style/link/adoptedStyleSheets 来源统计、关键选择器计算样式采样
 *
 * 只读、无注入、无副作用；输出 per-agent JSON + 控制台摘要。
 * 用法: node tests/probe-suite/live-scan.mjs [agentId ...]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_CONFIG } from './probe-config.mjs';
import {
  buildCssVariableProbe,
  buildDomStructureProbe,
  buildComputedStyleSampleProbe,
} from './dom-probe-expression.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'output');

class CdpClient {
  constructor(wsUrl, timeout = 8000) {
    this.wsUrl = wsUrl;
    this.timeout = timeout;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WS error: ${e.message || 'conn failed'}`));
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve: ok, reject: bad } = this.pending.get(data.id);
          this.pending.delete(data.id);
          data.error ? bad(new Error(JSON.stringify(data.error))) : ok(data.result);
        }
      };
      setTimeout(() => reject(new Error('WS connect timeout')), this.timeout);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => this.pending.delete(id), this.timeout);
    });
  }
  close() {
    if (this.ws) this.ws.close();
  }
}

// token 命名空间探测：扫描所有样式表已声明的 --* 变量，归纳命名空间前缀。
// 注意：此字符串会被 embedded 进页面求值，正则里的 `\s` 必须写成 `\\s`，
// 否则外层模板字符串会先把 `\\` → `\`、`\s` → `s`，得到错误的正则 `[^-s]`。
function buildTokenNamespaceProbe(sampleCap = 5) {
  return `(() => {
    const seen = new Map(); // name -> {source, declared}
    const scan = (sheet, source) => {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) return;
        for (const rule of rules) {
          if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
              const n = rule.style[i];
              if (n.startsWith('--') && !seen.has(n)) {
                seen.set(n, { source, declared: rule.style.getPropertyValue(n).trim() });
              }
            }
          }
          try { if (rule.cssRules) for (const sub of rule.cssRules) scan({ cssRules: [sub] }, source + '>sub'); } catch {}
        }
      } catch {}
    };
    for (const sheet of document.styleSheets) scan(sheet, sheet.href || 'inline');

    const rootStyle = document.documentElement.style;
    const inlineVars = [];
    for (let i = 0; i < rootStyle.length; i++) {
      const n = rootStyle[i];
      inlineVars.push([n, rootStyle.getPropertyValue(n).trim().slice(0, 60)]);
    }
    const cs = getComputedStyle(document.documentElement);
    const nsMap = new Map();
    const out = [];
    for (const [name, info] of seen) {
      // 命名空间 = 第一段（--<家庭>-）→ --vscode-chat-font-size → --vscode-
      const m = name.match(/^(--[^-\\s]+)-/);
      const ns = m ? m[1] + '-' : name;
      if (!nsMap.has(ns)) nsMap.set(ns, 0);
      nsMap.set(ns, nsMap.get(ns) + 1);
      info.computed = cs.getPropertyValue(name).trim();
      out.push({ name, ns, source: info.source, declared: info.declared.slice(0, 80), computed: info.computed.slice(0, 80) });
    }

    // 每个命名空间只保留前 sampleCap 个样例名
    const sampleByNs = new Map();
    for (const t of out) {
      if (!sampleByNs.has(t.ns)) sampleByNs.set(t.ns, []);
      const arr = sampleByNs.get(t.ns);
      if (arr.length < ${sampleCap}) arr.push(t.name);
    }
    const namespace = {};
    for (const [ns, count] of nsMap) namespace[ns] = { count, samples: sampleByNs.get(ns) || [] };

    return {
      declaredVarCount: out.length,
      namespace,
      inlineRootVars: inlineVars,
    };
  })()`;
}

// 语义 landmark 探测：items 内联在 buildLandmarkProbe 内。
function buildLandmarkProbe() {
  return `(() => {
    const items = [
      ['sidebar', 'aside, [class*="sidebar"], [class*="side-bar"]'],
      ['composer', '[class*="composer"], [contenteditable="true"]'],
      ['chatMain', 'main, [class*="chat"], [class*="thread"]'],
      ['input', 'textarea, [contenteditable="true"]'],
      ['nav', 'nav, header'],
      ['tree', '[class*="tree"], [class*="list"], ul'],
      ['toolbar', '[class*="toolbar"], [class*="commandbar"]'],
    ];
    const PROPS = ['color', 'background-color', 'border-color', 'border-radius', 'font-family', 'font-size'];
    const results = {};
    for (const [key, selExpr] of items) {
      try {
        const el = document.querySelector(selExpr);
        if (!el) { results[key] = { found: false }; continue; }
        const cs = getComputedStyle(el);
        const props = {};
        for (const p of PROPS) {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') props[p] = v.slice(0, 60);
        }
        results[key] = { found: true, tag: el.tagName.toLowerCase(), count: document.querySelectorAll(selExpr).length, props };
      } catch { results[key] = { found: false, error: 'skip' }; }
    }
    return results;
  })()`;
}

function buildCssSourceProbe() {
  return `(() => {
    const sheets = [];
    for (const s of document.styleSheets) {
      let rc = 0;
      try { rc = (s.cssRules || []).length; } catch {}
      sheets.push({ href: (s.href || 'inline').slice(0, 120), rules: rc });
    }
    let adopted = 0;
    try { adopted = (document.adoptedStyleSheets || []).length; } catch {}
    return {
      styleTags: document.querySelectorAll('style').length,
      linkTags: document.querySelectorAll('link[rel="stylesheet"]').length,
      sheets,
      adoptedStyleSheets: adopted,
    };
  })()`;
}

async function scanAgent(agentId) {
  const cfg = AGENT_CONFIG[agentId];
  const client = new CdpClient();
  const pageTarget = await (async () => {
    const r = await fetch(`http://127.0.0.1:${cfg.port}/json`);
    const list = await r.json();
    return list.find((t) => t.type === 'page');
  })();

  const result = { agent: agentId, port: cfg.port, status: 'ok', wsReady: !!pageTarget?.webSocketDebuggerUrl };
  if (!pageTarget?.webSocketDebuggerUrl) {
    result.status = 'no-page-target';
    return result;
  }
  client.wsUrl = pageTarget.webSocketDebuggerUrl;
  await client.connect();
  await client.send('Runtime.enable').catch(() => {});

  const evalu = async (expression) => {
    const res = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res?.exceptionDetails) return { __exc__: res.exceptionDetails.text };
    return res?.result?.value;
  };

  const [title, tokens, dom, sources, landmarks] = await Promise.all([
    evalu('document.title'),
    evalu(buildTokenNamespaceProbe()),
    evalu(buildDomStructureProbe()),
    evalu(buildCssSourceProbe()),
    evalu(buildLandmarkProbe()),
  ]);

  result.title = title;
  result.token = tokens;
  result.dom = dom?.summary || dom;
  result.dom_topClasses = dom?.topClasses?.slice(0, 40);
  result.css = sources;
  result.landmarks = landmarks;

  client.close();
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const agents = args.length ? args : Object.keys(AGENT_CONFIG);
  mkdirSync(OUT_DIR, { recursive: true });
  const all = {};
  for (const id of agents) {
    process.stdout.write(`\n=== ${id} (${AGENT_CONFIG[id].port}) ===\n`);
    try {
      const r = await scanAgent(id);
      all[id] = r;
      if (r.status !== 'ok') { console.log(`  ${r.status} (${r.wsReady ? 'ws-ready' : 'no-ws'})`); continue; }
      console.log('  title: ' + r.title);
      const ns = Object.keys(r.token?.namespace || {}).sort((a, b) => r.token.namespace[b].count - r.token.namespace[a].count);
      const nsStr = ns.slice(0, 14).map((n) => ' ' + n + '=' + r.token.namespace[n].count).join(',');
      console.log('  token 命名空间(' + ns.length + '):' + nsStr);
      console.log('  声明变量=' + r.token?.declaredVarCount + ' inlineRootVars=' + r.token?.inlineRootVars?.length + ' dom=' + r.dom?.totalElements + '/' + r.dom?.uniqueTags + 'tag adopted=' + r.css?.adoptedStyleSheets);
      const found = Object.entries(r.landmarks || {}).filter(([, v]) => v && v.found);
      console.log('  landmarks(' + found.length + '): ' + found.map(([k, v]) => k + '=' + v.count).join(', '));
    } catch (e) {
      all[id] = { agent: id, status: 'error', error: e.message };
      console.log(`  ERROR ${e.message}`);
    }
  }
  const out = join(OUT_DIR, 'live-scan-now.json');
  writeFileSync(out, JSON.stringify(all, null, 2));
  console.log(`\n已写入 ${out}`);
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });